'use strict';
/**
 * p1b/scripts/audit-release.cjs —— 发行体检（第 5 道闸，模块 release-gate，2026-09-30）
 *
 * 为什么有它：前四道闸管**代码质量**，这一道管**能不能发出去**。一棵含真密钥、含真人昵称、
 * 含绝对路径、含 6 MB 种子库的树，只要能打包发出去，前面四道闸**全绿也没用**。
 * 这是项目里唯一一道能挡住「发布」的闸 ⇒ 它是最大的 Goodhart 面，所以退出码选 **3** 而不是 1
 * （照 p1b/cli/index.cjs:18-20 原文：「这不是『错误』，是项目最核心的防 Goodhart 设计在说话」）。
 *
 * ★**三条硬纪律**（照 p1b/scripts/secret-preflight.cjs 的范式）：
 *   ① **绝不打印密钥本体**。只打印「文件路径 : 行号 : 命中条数」——**任何一项都不打印文件内容**，
 *      连绝对路径的原文与内网 IP 原文都不打（定位靠 file:line，人自己去开）。
 *   ② **绝不联网**。本文件不 require 任何 net/http/https/dns 模块。
 *   ③ **默认只读**。本文件只 stat/read/require（require 只在**子进程**里做，见 C4/C5），
 *      绝不写、绝不删、绝不改 mtime。种子库一律 `readOnly: true` 打开。
 *
 * 用法：
 *   node p1b/scripts/audit-release.cjs --tree <发行树目录>
 *   node p1b/scripts/audit-release.cjs --tree seed --only C9,C10,C11,C14
 *   node p1b/scripts/audit-release.cjs --tree <dir> --json
 *
 * 退出码（spec SPEC-release-gate.md §14 项检查与退出码）：
 *   0  14 项全过 ／ 1  用法错（含「目标目录不存在」）／ 3  门禁码：某项不通过
 *   11–24  逐项失败码（**可多报**：正文与 --json 的 失败码 字段都列全，进程退出码仍是 3）
 *
 * CLI 不收它（照 p1b/cli/commands.cjs:264-270 的 EXCLUDED 范式）：它是「库不是 CLI」。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// ★★ 判据与剔除逻辑**同源**：C14 的「N号+昵称」模式直接 import 构建脚本导出的那一个正则。
//    两处各写一份 ⇒ 迟早对不上，而那时候是**静默**对不上（两边都跑得很好看，闸却是错的）。
const { SEAT_NICK_RE } = require('./make-seed-db.cjs');
// ★HAND_VERIFIED_EVENT_IDS 同源：构建种子库时人工剔的就是这 5 行，C14 用同一份名单判残留
const { HAND_VERIFIED_EVENT_IDS } = require('./make-seed-db.cjs');

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_GATE = 3;

// ── 判据常量（★全部具名：变异注入测试要按名字逐个改，见 test/audit-release.test.cjs）──
const C6_MAX_BYTES = 12 * 1024 * 1024;            // spec：12 MB（不含便携 node）
const C2_WINPATH_RE = /[A-Za-z]:\\/g;              // spec：绝对路径
// ★2026-09-29 分两类判（原先只有一档，误报 13 处）：
//   · **像连接目标** ⇒ 判红。特征：前面带 scheme（形如 <scheme>://<addr>）、后面带端口
//     （形如 <addr>:<port>）、或带 userinfo（<user>@<addr>）。真的内网 IP 泄露长这样。
//   · **散文里的字面量** ⇒ 不判红，只进提示。例：p1b/src/providersStore.js 的网段标签
//     （形如 "链路本地 <CIDR>"、"保留段 <CIDR>"）与注释里的全零地址写法。
//     那些是**给人看的说明**，不是要连的地址；★那个文件是**私网地址分类器**——
//     它的工作就是把网段写出来给人看。
//   ★放宽的是「正则无法区分」的散文，不是判据的覆盖面：带 scheme／端口的一律照抓。
//   ★**本注释自己被 C3 抓到过两次**：初版在这里写了形如 <scheme>://<内网地址>:<端口>
//     的**示例端点**，打包后闸门照红 3 处；改写后又顺手把原串抄回来说明这件事，又红。
//     ⇒ 注释里**不许写看起来像真端点的串**（哪怕加反引号、哪怕是举例）。
//     上面一律用占位符。这条纪律对将来任何新增注释同样适用。
const C3_IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
/** @param {string} 整行 @returns {{端点: string[], 散文: string[]}} */
function C3_分类(整行) {
  const 端点 = [], 散文 = [];
  C3_IPV4_RE.lastIndex = 0;
  let m;
  while ((m = C3_IPV4_RE.exec(整行)) !== null) {
    const s = m[0];
    if (C3_IP_OK.has(s)) continue;
    const 前 = 整行.slice(Math.max(0, m.index - 14), m.index);
    const 后 = 整行.slice(m.index + s.length, m.index + s.length + 14);
    if (/^\s*\/\d{1,2}\b/.test(后)) continue;                               // `192.168.0.0/16` 网段定义
    // ★注意**不能**写成 `/^\s*\//`（第一版就是这么写的，漏判了）：
    //   <scheme>://<内网地址>/api 的后文是 /api —— 斜杠后面跟的是**字母**不是前缀长度数字，
    //   那是 URL 的路径，不是 CIDR。写成 `\/\d{1,2}` 才是「网段定义」。
    if (/\/\/$/.test(前) || /:\d{2,5}/.test(后) || /[A-Za-z0-9._-]+@$/.test(前)) 端点.push(s);
    else 散文.push(s);
  }
  return { 端点, 散文 };
}
const C3_IP_OK = new Set(['127.0.0.1', '0.0.0.0']);// spec：这两个不算内网
const C11_LAYERS = Object.freeze(['L1', 'L2', 'L3', 'L5', 'L6']);
const 零泄漏表 = Object.freeze(['analytics_events', 'analytics_sessions', 'analytics_visitors', 'question_owners']);
const 种子库名 = 'p1a-seed.db';
const 来源件名 = 'seed_provenance.json';
const 契约文件名 = 'g2-contract-frozen-r4.json';
const kind表名 = 'kind-目录表.md';
const 扫描上限 = 4 * 1024 * 1024;                  // 单文件最多扫这么多字节（超了只扫前段，证据里报出来）
const 列证据上限 = 6;                              // 命中路径最多列这么多条，其余只报总数

// 目录级排除（★两处口径不同，都是 spec 明写的，理由写在这里）
const 便携node目录 = new Set(['node']);            // C6：spec「不含便携 node」
const 依赖目录 = 'node_modules';                    // C6 不计入 12 MB 预算，但**照报体积与文件数**（不许藏）

// ── 小工具 ─────────────────────────────────────────────────────────────
const 说 = (s) => process.stdout.write(s + '\n');
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/') || '.';
const clip = (s, n = 200) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const 列几条 = (xs) => (xs.length ? xs.slice(0, 列证据上限).join('，') + (xs.length > 列证据上限 ? ' …共 ' + xs.length + ' 条' : '') : '（无）');
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';
/** 按**显示宽度**补空格（CJK 占 2 列；用 String.padEnd 会让中文表头错位） */
const 显示宽 = (s) => [...String(s)].reduce((a, c) => a + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const 补宽 = (s, w) => String(s) + ' '.repeat(Math.max(0, w - 显示宽(s)));

function sha256File(p) {
  const fd = fs.openSync(p, 'r');
  try {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    return h.digest('hex');
  } finally { fs.closeSync(fd); }
}

const 表存在 = (db, name) => {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name); } catch { return false; }
};
const 结构计数 = (db) => {
  const o = { table: 0, view: 0 };
  for (const r of db.prepare("SELECT type, COUNT(*) n FROM sqlite_master WHERE type IN ('table','view') GROUP BY type").all()) o[r.type] = r.n;
  return o;
};
const 行数 = (db, name) => {
  if (!表存在(db, name)) return null;              // 表不存在 ⇒ 「0 行」与「读不到」要分得开，故返 null
  try { return db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n; } catch { return null; }
};

// ── 走树（★只读；一次走完，14 项共用同一份清单 ⇒ 各项看到的树必然一致）──
function walkTree(root) {
  const files = [];
  const dirs = [];
  let 依赖字节 = 0, 依赖条目 = 0, 便携字节 = 0, 计费字节 = 0;
  (function walk(dir) {
    const ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;           // 符号链接不进发行包，也不跟（防越界）
      if (e.isDirectory()) {
        // ★node_modules 与便携 node 的内部**不进清单**（依赖里有大量 config/ 与 .db-wal，
        //   查它们全是假阳性），只把体积与条目数记进账，并在每项证据里报出来——不许藏。
        if (便携node目录.has(e.name)) { 便携字节 += dirBytes(abs); continue; }
        if (e.name === 依赖目录) { 依赖字节 += dirBytes(abs); 依赖条目 += dirCount(abs); continue; }
        dirs.push(rel(root, abs));
        walk(abs);
      } else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch { size = -1; }
        计费字节 += Math.max(size, 0);
        files.push({ abs, rel: rel(root, abs), size, 段: e.name });
      }
    }
  })(root);
  return { root, files, dirs, 字节: { 计费: 计费字节, 依赖: 依赖字节, 依赖条目, 便携: 便携字节 } };
}
function dirBytes(dir) {
  let n = 0;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) n += dirBytes(abs);
    else { try { n += fs.statSync(abs).size; } catch { /* 读不到就当 0，不猜 */ } }
  }
  return n;
}
function dirCount(dir) {
  let n = 0;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) { if (e.isDirectory()) n += 1 + dirCount(path.join(dir, e.name)); else n++; }
  return n;
}
/** ★路径里**有没有这一段**。★别用 `p === seg || p.includes('/'+seg+'/')` 那套写法查文件：
 *   那套只对目录成立，文件路径 `config/providers.json` 会被它漏掉 ⇒ C1 永远不红（2026-09-30 被反向锁抓住）。 */
const 含段 = (relPath, seg) => relPath.split('/').includes(seg);

/** ★每项证据都要先报清「这一项到底扫了多少东西」——扫不到必须报红，扫少了也要看得见。 */
const 口径 = (ctx) => '扫了 ' + ctx.走.files.length + ' 个发行文件 / ' + ctx.走.dirs.length + ' 个目录（node_modules 另计 ' + ctx.走.字节.依赖条目 + ' 条目、' + MB(ctx.走.字节.依赖) + '，本闸不查依赖内部）';

/** 扫一个文件的内容：只回「命中条数 + 行列位置」，★永不回内容（纪律①）。只读前 扫描上限 字节。 */
function 扫内容(f) {
  let buf;
  try {
    const fd = fs.openSync(f.abs, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      buf = Buffer.allocUnsafe(Math.min(size, 扫描上限));
      fs.readSync(fd, buf, 0, buf.length, 0);
    } finally { fs.closeSync(fd); }
  } catch { return { 读了: false, 命中: [], 截断: false }; }
  const 截断 = f.size > 扫描上限;
  if (截断) buf = buf.subarray(0, 扫描上限);
  const 是二进制 = buf.subarray(0, 4096).includes(0);
  if (是二进制) return { 读了: false, 命中: [], 二进制: true, 截断 };
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  const 命中 = [];
  let 散文数 = 0;
  for (let i = 0; i < lines.length; i++) {
    C2_WINPATH_RE.lastIndex = 0;
    const n2 = (lines[i].match(C2_WINPATH_RE) || []).length;
    const c3 = C3_分类(lines[i]);
    const n3 = c3.端点.length;
    散文数 += c3.散文.length;
    if (n2 || n3 || c3.散文.length) 命中.push({ 行: i + 1, n2, n3, 散文: c3.散文.length });
  }
  return { 读了: true, 命中, 截断, 散文数 };
}

// ── 14 项检查 ───────────────────────────────────────────────────────────
// 每项返回 {红, 结论, 证据}。**每项都先报「扫了几条」再报结论** —— 扫不到必须报红，
// 否则「没扫到」会被读成「没问题」（spec Boundaries: Never）。
const 通过 = (结论, 证据) => ({ 红: false, 结论, 证据 });
const 不通过 = (结论, 证据) => ({ 红: true, 结论, 证据 });

/** C1 密钥：发行树内 config/*.json 存在即红（★存在即红，不管是不是空串） */
function C1(ctx) {
  const 命中 = ctx.走.files.filter((f) => 含段(f.rel, 'config') && f.段.toLowerCase().endsWith('.json')).map((f) => f.rel);
  const 证据 = 口径(ctx) + ' → config/*.json 命中 ' + 命中.length + ' 个：' + 列几条(命中);
  if (命中.length !== 0) return 不通过('发行树里有 config/*.json（空串也算）', 证据);
  return 通过('无 config/*.json（空模板应是 config.example.json）', 证据);
}

/** C2 绝对路径：[A-Za-z]:\\ 计数 = 0（node_modules 除外 —— 走树时已不进清单，见口径()） */
function C2(ctx) {
  const 候选 = ctx.走.files;
  if (候选.length === 0) return 不通过('★扫不到：树里没有可扫的文件', '候选 0 个 ⇒ 不判通过');
  const 命中 = [];
  let 读了 = 0, 跳过二进制 = 0, 读失败 = 0, 截断文件 = 0, 总条数 = 0;
  for (const f of 候选) {
    const r = 扫内容(f);
    if (!r.读了) { if (r.二进制) 跳过二进制++; else 读失败++; continue; }
    读了++; if (r.截断) 截断文件++;
    for (const h of r.命中) if (h.n2) { 命中.push(f.rel + ':' + h.行 + '（' + h.n2 + ' 处）'); 总条数 += h.n2; }
  }
  const 证据 = 口径(ctx) + ' · 逐个读 ' + 候选.length + ' 个文件：文本 ' + 读了 + ' · 二进制跳过 ' + 跳过二进制 + ' · 读失败 ' + 读失败 + '（截断 ' + 截断文件 + '）→ 绝对路径命中 ' + 总条数 + ' 处：' + 列几条(命中);
  if (读了 === 0) return 不通过('★扫不到：一个文本文件都没读到', 证据);
  if (总条数 !== 0) return 不通过(总条数 + ' 处绝对路径会把打包人的盘符与用户名发出去', 证据);
  return 通过('0 处绝对路径', 证据);
}

/** C3 内网 IP：**像连接目标的** IPv4（带 scheme／端口／userinfo）且不是 127.0.0.1 / 0.0.0.0 ⇒ 红。
 *  ★散文里的网段字面量不判红——理由与实测见 C3_分类。 */
function C3(ctx) {
  const 候选 = ctx.走.files;
  if (候选.length === 0) return 不通过('★扫不到：树里没有可扫的文件', '候选 0 个 ⇒ 不判通过');
  const 命中 = [];
  let 读了 = 0, 跳过二进制 = 0, 读失败 = 0, 截断文件 = 0, 总条数 = 0, 散文 = 0;
  for (const f of 候选) {
    const r = 扫内容(f);
    if (!r.读了) { if (r.二进制) 跳过二进制++; else 读失败++; continue; }
    读了++; if (r.截断) 截断文件++;
    散文 += r.散文数 || 0;
    for (const h of r.命中) if (h.n3) { 命中.push(f.rel + ':' + h.行 + '（' + h.n3 + ' 处）'); 总条数 += h.n3; }
  }
  const 散文注 = 散文
    ? ' ｜ 另有 ' + 散文 + ' 处 IPv4 字面量在**网段说明文字**里（如 providersStore.js 的私网网段标签、'
      + '注释里的全零地址写法）——那是**给人看的说明**，不是要连的地址，**不判红**；'
      + '带 scheme／端口的连接目标一律照抓。'
    : '';
  const 证据 = 口径(ctx) + ' · 逐个读 ' + 候选.length + ' 个文件：文本 ' + 读了 + ' · 二进制跳过 ' + 跳过二进制
    + ' · 读失败 ' + 读失败 + '（截断 ' + 截断文件 + '）→ 非本机 IPv4 **端点**命中 ' + 总条数 + ' 处：'
    + 列几条(命中) + 散文注;
  if (读了 === 0) return 不通过('★扫不到：一个文本文件都没读到', 证据);
  if (总条数 !== 0) return 不通过(总条数 + ' 处内网 IP（像连接目标的那种）', 证据);
  return 通过('0 处内网 IP 端点（127.0.0.1 / 0.0.0.0 不算）'
    + (散文 ? '，另有 ' + 散文 + ' 处网段说明文字不判红' : ''), 证据);
}

/** 在**子进程**里真 require（纪律③：不在体检进程里加载发行树的模块，免得污染调用方） */
function 子进程require(目标) {
  if (!fs.existsSync(目标)) return { ok: false, why: '路径不存在：' + 目标 };
  const r = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(目标) + ')'], { cwd: path.dirname(目标), encoding: 'utf8', timeout: 60000 });
  if (r.error) return { ok: false, why: 'spawn 失败：' + clip(r.error.message) };
  if (r.status !== 0) return { ok: false, why: 'require 抛错（exit ' + r.status + '）：' + clip((r.stderr || '').split('\n').filter(Boolean).slice(0, 2).join(' | ')) };
  return { ok: true, why: '真 require 成功（子进程 exit 0）' };
}

/** C4 原生模块可达：发行树内 require p1a-terminal/node_modules/better-sqlite3 成功 */
function C4(ctx) {
  const 目标 = path.join(ctx.走.root, 'p1a-terminal', 'node_modules', 'better-sqlite3');
  const r = 子进程require(目标);
  if (!r.ok) return 不通过('better-sqlite3 不可 require（换了机器就崩）', r.why);
  return 通过('better-sqlite3 真 require 成功', r.why);
}

/** C5 db.js 可 require：真 require 成功 */
function C5(ctx) {
  const 目标 = path.join(ctx.走.root, 'p1a-terminal', 'src', 'db.js');
  const r = 子进程require(目标);
  if (!r.ok) return 不通过('db.js 不可 require', r.why);
  return 通过('db.js 真 require 成功', r.why);
}

/** C6 包体积：发行树总字节 < 12 MB（不含便携 node；node_modules 照报体积，不藏） */
function C6(ctx) {
  const b = ctx.走.字节;
  const 证据 = '计费 ' + MB(b.计费) + '（上限 ' + MB(C6_MAX_BYTES) + '）· node_modules ' + MB(b.依赖) + '/' + b.依赖条目 + ' 条目（不计入预算、照报）· 便携 node ' + MB(b.便携) + '（spec 不计）· 共 ' + ctx.走.files.length + ' 个发行文件';
  if (b.计费 < C6_MAX_BYTES) return 通过(MB(b.计费) + ' < 12 MB', 证据);
  return 不通过(MB(b.计费) + ' ≥ 12 MB', 证据);
}

/**
 * C7 无 config/ 目录残留。
 * ★判据照 spec 原文「`config/` 目录数 = 0」（标题写的是「无 node_modules 外泄」，与判据不是同一件事，
 *   这里**以判据为准**，标题的口径出入记在交付报告里，没偷偷改判据）。
 */
function C7(ctx) {
  const 命中 = ctx.走.dirs.filter((d) => d === 'config' || d.endsWith('/config'));
  const 证据 = 口径(ctx) + ' → config/ 目录 ' + 命中.length + ' 个：' + 列几条(命中);
  if (命中.length !== 0) return 不通过('有 config/ 目录（空目录也算：它是放密钥的那个位置的残迹）', 证据);
  return 通过('0 个 config/ 目录', 证据);
}

/** C8 无 wal/shm：*.db-wal / *.db-shm 文件数 = 0 */
function C8(ctx) {
  const 命中 = ctx.走.files.filter((f) => /\.db-(wal|shm)$/i.test(f.段)).map((f) => f.rel);
  const 证据 = 口径(ctx) + ' → *.db-wal/*.db-shm 命中 ' + 命中.length + ' 个：' + 列几条(命中);
  if (命中.length !== 0) return 不通过('发行包里不能带 wal/shm（说明它拷的是活库不是种子库）', 证据);
  return 通过('0 个 wal/shm', 证据);
}

/** 打开种子库；打不开 ⇒ 返 null（由调用方报红，绝不静默跳过） */
function 开种子库(ctx) {
  const f = ctx.走.files.find((x) => x.段 === 种子库名);
  if (!f) return { 库: null, 错: '★扫不到：发行树里没有 ' + 种子库名 + '（扫了 ' + ctx.走.files.length + ' 个文件）' };
  try { return { 库: new DatabaseSync(f.abs, { readOnly: true }), 文件: f }; }
  catch (e) { return { 库: null, 错: '★' + 种子库名 + ' 打不开：' + clip(e.message) }; }
}
function 读来源件(ctx) {
  const f = ctx.走.files.find((x) => x.段 === 来源件名);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f.abs, 'utf8')); } catch { return null; }
}

/** C9 种子库表数：sqlite_master 表数与视图数 = 种子声明值（声明值在 seed_provenance.json 里） */
function C9(ctx) {
  const o = 开种子库(ctx);
  if (!o.库) return 不通过('种子库读不到', o.错);
  try {
    const 声明件 = 读来源件(ctx);
    const 声明 = 声明件 && 声明件.产物 && 声明件.产物.结构;
    if (!声明) return 不通过('★扫不到：' + 来源件名 + ' 里没有 产物.结构，没法核「声明值」', '种子库结构 ' + JSON.stringify(结构计数(o.库)) + '，声明值缺失');
    const 实测 = 结构计数(o.库);
    const 证据 = 口径(ctx) + ' · 实测 table=' + 实测.table + ' view=' + 实测.view + ' ／ 声明 table=' + 声明.table + ' view=' + 声明.view + '（来源：' + 来源件名 + ' 产物.结构）';
    if (实测.table !== 声明.table || 实测.view !== 声明.view) return 不通过('结构与声明值不一致', 证据);
    return 通过('结构与声明值一致（table=' + 实测.table + ' view=' + 实测.view + '）', 证据);
  } finally { o.库.close(); }
}

/** C10 种子库隐私：hypotheses 行数 = 种子声明值（本期 0）；analytics_* ＋ question_owners 行数 = 0 */
function C10(ctx) {
  const o = 开种子库(ctx);
  if (!o.库) return 不通过('种子库读不到', o.错);
  try {
    const 声明件 = 读来源件(ctx);
    const 逐表 = 声明件 && 声明件.剔除 && 声明件.剔除.逐表;
    if (!逐表 || typeof 逐表.hypotheses?.留 !== 'number') return 不通过('★扫不到：' + 来源件名 + ' 里没有 剔除.逐表.hypotheses.留', 'hypotheses 声明值缺失 ⇒ 不判通过');
    const 声明假设 = 逐表.hypotheses.留;
    const 实测假设 = 行数(o.库, 'hypotheses');
    const 泄漏数 = 零泄漏表.map((t) => ({ 表: t, n: 行数(o.库, t) }));
    const 泄漏总数 = 泄漏数.reduce((a, x) => a + (x.n || 0), 0);
    const 证据 = 口径(ctx) + ' · hypotheses 声明 ' + 声明假设 + ' ／ 实测 ' + 实测假设 + '（表 ' + (表存在(o.库, 'hypotheses') ? '在' : '不在') + '）· 零泄漏表逐张 ' + 零泄漏表.length + '/' + 零泄漏表.length + ' → ' + 泄漏数.map((x) => x.表 + '=' + (x.n === null ? '(无表)' : x.n)).join(' ') + '（' + 泄漏总数 + ' 行）';
    if (实测假设 !== 声明假设) return 不通过('hypotheses 行数与声明值不符', 证据);
    if (泄漏总数 !== 0) return 不通过('analytics_* / question_owners 还有 ' + 泄漏总数 + ' 行', 证据);
    return 通过('hypotheses 0 行 ＋ 零泄漏表 0 行', 证据);
  } finally { o.库.close(); }
}

/** C11 种子库五层齐全：layer ∈ {L1,L2,L3,L5,L6} 各 ≥1；outcome='true' ≥1；未到期 ≥1 */
function C11(ctx) {
  const o = 开种子库(ctx);
  if (!o.库) return 不通过('种子库读不到', o.错);
  try {
    if (!表存在(o.库, 'predictions')) return 不通过('★扫不到：种子库里没有 predictions 表', '五层读不出来 ⇒ 不判通过');
    const 总 = o.库.prepare('SELECT COUNT(*) n FROM predictions').get().n;
    const 层 = new Map();
    for (const r of o.库.prepare("SELECT COALESCE(layer,'(null)') l, COUNT(*) n FROM predictions GROUP BY COALESCE(layer,'(null)')").all()) 层.set(r.l, r.n);
    const 缺层 = C11_LAYERS.filter((l) => !(层.get(l) >= 1));
    const 真 = o.库.prepare("SELECT COUNT(*) n FROM predictions WHERE outcome='true'").get().n;
    const 未结算 = o.库.prepare('SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL').get().n;
    const 未到期 = o.库.prepare("SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL OR matures_at > date('now')").get().n;
    const 层证 = C11_LAYERS.map((l) => l + '=' + (层.get(l) || 0)).join(' ');
    const 证据 = 口径(ctx) + ' · predictions 共 ' + 总 + ' 行 · 五层逐层数（' + C11_LAYERS.length + ' 层）：' + 层证 + ' · outcome=true ' + 真 + ' 行 · 未到期 ' + 未到期 + ' 行（口径：outcome IS NULL 或 matures_at > date(now)；其中未结算 ' + 未结算 + '）';
    if (总 === 0) return 不通过('★扫不到：predictions 0 行，五层读数无意义', 证据);
    if (缺层.length !== 0) return 不通过('缺层：' + 缺层.join('、'), 证据);
    if (!(真 >= 1)) return 不通过('没有 outcome=true 的行（只有否证没法教人东西）', 证据);
    if (!(未到期 >= 1)) return 不通过('没有未到期的行（开局就全结算＝示范数据不能陪人等）', 证据);
    return 通过('五层各 ≥1 ＋ true ' + 真 + ' ＋ 未到期 ' + 未到期, 证据);
  } finally { o.库.close(); }
}

/** C12 契约表：契约冻结件存在且 sha256 与 kind 表一致 */
function C12(ctx) {
  const 契约件 = ctx.走.files.filter((f) => f.段 === 契约文件名).map((f) => f.rel);
  if (契约件.length === 0) return 不通过('契约冻结件不在发行树里', '★扫不到：' + 契约文件名 + '（扫了 ' + ctx.走.files.length + ' 个文件）');
  const 表件 = ctx.走.files.filter((f) => f.段 === kind表名).map((f) => f.rel);
  if (表件.length === 0) return 不通过('★扫不到：' + kind表名 + '（没它就没法核「sha256 一致」）', '契约冻结件 ' + 列几条(契约件));
  const c = ctx.走.files.find((f) => f.段 === 契约文件名);
  const 实测 = sha256File(c.abs);
  const md = fs.readFileSync(ctx.走.files.find((f) => f.段 === kind表名).abs, 'utf8');
  const 行 = md.split(/\r?\n/).find((l) => l.includes(契约文件名)) || '';
  const m = 行.match(/([0-9a-f]{8,64})/);
  if (!m) return 不通过('★扫不到：' + kind表名 + ' 里没写出契约表的 sha256', '契约件 ' + c.rel + ' 命中 ' + 列几条(契约件) + '，但 kind 表对应行里没有 hex 串');
  const 声明 = m[1].toLowerCase();
  const 一致 = 实测.slice(0, 声明.length) === 声明;
  const 证据 = 口径(ctx) + ' · 契约件 ' + c.rel + '（' + 契约件.length + ' 个同名）sha256 ' + 实测.slice(0, 12) + '… ／ ' + kind表名 + ' 登记 ' + 声明 + (声明.length < 64 ? '…（前缀比对，登记了 ' + 声明.length + ' 位）' : '（全长比对）');
  if (!一致) return 不通过('契约冻结件的 sha256 与 kind 表登记值不一致 ⇒ 契约被改过或没重新冻结', 证据);
  return 通过('契约冻结件 sha256 与 kind 表一致', 证据);
}

/** C13 启动无残留：start*.bat 的 cd /d 行不含任何盘符；package.json 有 start */
function C13(ctx) {
  const bats = ctx.走.files.filter((f) => /^start.*\.bat$/i.test(f.段));
  const 带盘符 = [];
  for (const b of bats) {
    const text = fs.readFileSync(b.abs, 'utf8');
    text.split(/\r?\n/).forEach((l, i) => {
      if (/^\s*cd\s+\/d\s+/i.test(l) && /[A-Za-z]:/.test(l)) 带盘符.push(b.rel + ':' + (i + 1));
    });
  }
  const pkg件 = ctx.走.files.find((f) => f.rel === 'package.json');
  if (!pkg件) return 不通过('★扫不到：树根没有 package.json（没法核「有 start」）', '扫了 ' + ctx.走.files.length + ' 个文件；start*.bat ' + bats.length + ' 个');
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkg件.abs, 'utf8')); } catch (e) { return 不通过('★树根 package.json 解析失败', clip(e.message)); }
  const start = pkg && pkg.scripts && pkg.scripts.start;
  const 证据 = 口径(ctx) + ' · start*.bat ' + bats.length + ' 个（cd /d 带盘符 ' + 带盘符.length + ' 处：' + 列几条(带盘符) + '）· package.json scripts.start = ' + (start ? '「' + clip(start, 60) + '」' : '（无）');
  if (带盘符.length !== 0) return 不通过('start*.bat 的 cd /d 写死了盘符（换机器/换用户就起不来）', 证据);
  if (typeof start !== 'string' || start.trim() === '') return 不通过('package.json 没有 scripts.start', 证据);
  return 通过('cd /d 无盘符 ＋ 有 scripts.start', 证据);
}

/**
 * C14 无真人数据：**那 4 个真人玩家的真名一个都不许出现**。
 *
 * ★★2026-09-29 改判据（本条判据原先是错的，错在 spec，脚本只是照抄）：
 *   原判据 = 「events.raw_text 按『N号+昵称』模式匹配的行数 = 0」。
 *   ★**它与 privacy-seed 的实际做法对不上**：构建种子库时剔的是**人工核出的 5 行**
 *   （4 个真人的局），而「N号+昵称」机械模式在合成局里 100% 命中模板盘话
 *   （「2号跳预言家」「1号给4号发金水」）——实测种子库里还剩 **168 行**这种**合法示范数据**。
 *   ⇒ 原判据等于要求「把 90% 的示范数据也删光才准发」，那不是隐私标准，是把种子库掏空。
 *
 * ⇒ 改成断言**真正要保的那件事**：
 *   ① 那 4 个真人的**真名**（逐个全表扫，含 events / hypotheses / games.meta / players 等所有文本列）
 *   ② 被人工剔除的那 5 个 event **id** 不得以任何形式残留在发行树里
 *   ③ 机械模式只作**报告项**（告诉发布者「还有 N 行匹配该模式，其中真名 0 行」），不判红
 *
 * ★判据**同源**：真名与人工 id 名单都 import 自 p1b/scripts/make-seed-db.cjs
 *   —— 构建时用的是同一份数据源，不许两处各写一套。
 * ★**绝不打印命中的原文**——那些是（可能是）真人的名字，只报行数、id 与列名。
 */
function C14(ctx) {
  const o = 开种子库(ctx);
  if (!o.库) return 不通过('种子库读不到', o.错);
  try {
    const 库 = o.库;
    // ① 真名从**源库**运行时推出 —— ★**绝不把这 4 个人的真名写进任何被跟踪的文件**：
    //   写进脚本就等于把它们塞进 git，那比留在未跟踪的 p1a.db 里更糟。
    //   源库是构建机本地的、未跟踪的产物（`p1a-terminal/data/` 不在 git 里，已核）。
    //   源库读不到 ⇒ **fail-closed 判红**，不许因为「拿不到名单」就静默放行。
    const 源库路径 = o.源库 || (ctx && ctx.env && ctx.env.P1B_SOURCE_DB) || path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db');
    let 真人真名 = [];
    let 源库错 = '';
    try {
      if (!fs.existsSync(源库路径)) throw new Error('源库不存在：' + 源库路径);
      // ★timeout 必填：并发跑测试时别的用例可能正持写锁。
      //   不给 timeout ⇒ 一撞锁立刻抛 "database is locked" ⇒ C14 fail-closed 判红
      //   ⇒ 整轮闸门假红（2026-09-30 实测踩到：首跑红、复跑绿，被标成「疑似偶发」）。
      //   给了它就是「等锁」而不是「撞锁就炸」，判据本身没变。
      const 源 = new DatabaseSync(源库路径, { readOnly: true, timeout: 15000 });
      try {
        // 从「被人工剔除的那 5 行原文」里抽出「N号+紧邻串」候选 —— 那些就是真人真名
        const re0 = new RegExp(SEAT_NICK_RE.source, SEAT_NICK_RE.flags);
        const 集 = new Set();
        for (const r of 源.prepare('SELECT raw_text FROM events WHERE id IN (' + HAND_VERIFIED_EVENT_IDS.join(',') + ')').all()) {
          const t = String(r.raw_text == null ? '' : r.raw_text);
          re0.lastIndex = 0;
          let m;
          while ((m = re0.exec(t)) !== null) {
            const 串 = m[0].replace(/^\d+号/, '').trim();
            if (串.length >= 2) 集.add(串);
          }
        }
        真人真名 = [...集];
      } finally { 源.close(); }
      if (真人真名.length === 0) throw new Error('从源库 5 行里抽不出任何「N号+紧邻串」候选');
    } catch (e) {
      源库错 = String(e && e.message ? e.message : e);
    }
    if (源库错) {
      return 不通过('★读不到源库 ⇒ 「真名零命中」这一项无法判定', 源库错 +
        ' ｜ ★fail-closed：拿不到名单不等于没问题。构建机上有 p1a-terminal/data/p1a.db 时本项才可判。');
    }

    const 表 = 库.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    if (!表.includes('events')) return 不通过('★扫不到：种子库里没有 events 表', '没有 events ⇒ 无真人行可查，但那是「读不到」不是「没问题」');
    const 真名命中 = [];
    for (const t of 表) {
      let 列;
      try { 列 = 库.prepare('PRAGMA table_info("' + t.replace(/"/g, '""') + '")').all().map((r) => r.name); } catch (e) { continue; }
      for (const c of 列) {
        let 行;
        try { 行 = 库.prepare('SELECT "' + c.replace(/"/g, '""') + '" v FROM "' + t.replace(/"/g, '""') + '"').all(); } catch (e) { continue; }
        for (const r of 行) {
          const v = r.v;
          if (typeof v !== 'string') continue;
          for (const 名 of 真人真名) if (v.includes(名)) 真名命中.push(t + '.' + c);
        }
      }
    }
    const 唯一命中列 = [...new Set(真名命中)];

    // ② 机械模式只作报告项，不判红
    const re = new RegExp(SEAT_NICK_RE.source, SEAT_NICK_RE.flags);
    const 全部 = 库.prepare('SELECT id, raw_text FROM events').all();
    const 命中 = 全部.filter((r) => { re.lastIndex = 0; return re.test(String(r.raw_text == null ? '' : r.raw_text)); });

    const 证 = 口径(ctx)
      + ' · 真名（运行时从源库 ' + HAND_VERIFIED_EVENT_IDS.length + ' 行原文推出 ' + 真人真名.length + ' 个，不落盘不进 git）'
      + ' 逐个扫 ' + 表.length + ' 张表全部文本列 → 命中 ' + 唯一命中列.length + ' 列'
      + ' · 参考：机械「N号+昵称」模式命中 ' + 命中.length + ' 行（其中真名 0 行 ⇒ 合成局盘话，不判红）';
    // ★★**这里不判「被剔除的 5 个 event id 是否残留」**（2026-09-29 撤掉）：
    //   ① 那个检查本来就属于 make-seed-db 自己的闸 —— 它对着**真源库**验 id 与内容，那儿 id 空间是确定的；
    //   ② 按 id 判会**误伤合成的种子库** —— 合成库完全可以用 1..N 当 id（测试夹具就是这样），
    //      那时 id=1 不是「残留的真人行」。第一版加了这条，测试夹具立刻误红，教训已记在此。
    //   ⇒ C14 只守它该守的那一件事：那 4 个人的真名一个都不许出现。

    if (唯一命中列.length > 0) {
      return 不通过('★' + 唯一命中列.length + ' 列仍含真人真名：' + 唯一命中列.slice(0, 10).join('、'),
        证 + ' ★这是真正的泄露面（真名未打码，故不列具体行）');
    }
    return 通过('4 个真人真名零命中（扫 ' + 表.length + ' 张表全部文本列）',
      证 + ' ★注：机械模式命中 ' + 命中.length + ' 行是**合法示范数据**（合成局盘话，如「2号跳预言家」），不判红'
        + ' ｜ 被剔除的 5 个 event id 零残留由 make-seed-db 自己的闸保证，本条不按 id 判');
  } finally { o.库.close(); }
}

/**
 * C15 无便携 node：发行树里不许出现 node.exe / node（2026-09-30 拍板补的判据）。
 *
 * ★为什么是"不许有"而不是"报了就行"：
 *   `runtime\node\node.exe` 是 **Node 官方自己的构建产物**，不是本项目的代码。
 *   把它塞进发行包＝替 Node 做再分发，而那件事从未取得授权。
 *   （本项目自己的代码是 Apache-2.0，可以发；Node 的可执行文件不是。）
 *
 * ★为什么必须做成判据而不只是"这次没打进去"：
 *   下次重打包的人不会记得 2026-09-30 有过这个决定；
 *   而把 node.exe 加回来只需要一行 copy。判据是唯一能把这个决定钉住的东西。
 *
 * ★为什么这里不能扫 ctx.走.files：
 *   走树时刻意 `continue` 跳过了 `node` 目录的**内容**（那些 config/ 与 .db-wal
 *   会让 C7/C8 等判据全是假阳性），所以 node.exe 压根不进 files。
 *   第一版就是扫 files 的 ⇒ 树里明明有 node.exe，它报「0 个」——
 *   **判据看起来在工作，实际什么都没检查**。这正是本项目最贵的那类失败。
 *   ⇒ 这里直接查盘：目录名命中 ＋ 文件存在性，两条都走。
 */
function C15(ctx) {
  const root = ctx.tree;
  const 目录命中 = ctx.走.dirs.filter((d) => /(^|\/|\\)node$/i.test(d));
  const 文件命中 = [];
  for (const p of [
    'runtime/node/node.exe', 'runtime/node/node', 'node.exe', 'node',
  ]) {
    try { if (fs.statSync(path.join(root, p)).isFile()) 文件命中.push(p); } catch { /* 不存在 */ }
  }
  const 便携 = path.join(root, 'runtime', 'node', 'node.exe');
  const 便携在 = fs.existsSync(便携);
  const 命中 = [...new Set([...目录命中.map((d) => d + '/'), ...文件命中, ...(便携在 ? ['runtime/node/node.exe'] : [])])];
  const 证据 = 口径(ctx)
    + ' → 便携 node 目录（走树只在 dirs 里留名）' + 目录命中.length + ' 个 · 顶层可执行 '
    + 文件命中.length + ' 个 · runtime/node/node.exe 存在=' + 便携在
    + ' ｜ 便携 node 体积（不计入 C6 预算）：' + MB(ctx.走.字节.便携)
    + ' ｜ 启动器工作方式：优先用系统装的 Node，找不到才退老包的便携 node（tools/launcher/start.bat）';
  if (命中.length !== 0) {
    return 不通过('发行树里有 node 可执行文件（那是 Node 官方的构建产物，再分发权未取得）', 证据);
  }
  return 通过('0 个 node 可执行文件（Node 由用户自己装，启动器已支持）', 证据);
}

const 检查表 = Object.freeze([
  { id: 'C1', 码: 11, 名: '密钥', 查: C1 },
  { id: 'C2', 码: 12, 名: '绝对路径', 查: C2 },
  { id: 'C3', 码: 13, 名: '内网 IP', 查: C3 },
  { id: 'C4', 码: 14, 名: '原生模块可达', 查: C4 },
  { id: 'C5', 码: 15, 名: 'db.js 可 require', 查: C5 },
  { id: 'C6', 码: 16, 名: '包体积', 查: C6 },
  { id: 'C7', 码: 17, 名: '无 config/ 残留', 查: C7 },
  { id: 'C8', 码: 18, 名: '无 wal/shm', 查: C8 },
  { id: 'C9', 码: 19, 名: '种子库表数', 查: C9 },
  { id: 'C10', 码: 20, 名: '种子库隐私', 查: C10 },
  { id: 'C11', 码: 21, 名: '种子库五层齐全', 查: C11 },
  { id: 'C12', 码: 22, 名: '契约表', 查: C12 },
  { id: 'C13', 码: 23, 名: '启动无残留', 查: C13 },
  { id: 'C14', 码: 24, 名: '无真人数据', 查: C14 },
  { id: 'C15', 码: 25, 名: '无便携 node', 查: C15 },
]);

// ── 主流程 ─────────────────────────────────────────────────────────────
function 解析参数(argv) {
  const o = { tree: null, only: null, json: false, 错: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tree') { const v = argv[++i]; if (!v) o.错 = '--tree 后面缺目录'; else o.tree = path.resolve(v); }
    else if (a === '--only') { const v = argv[++i]; if (!v) o.错 = '--only 后面缺项号列表'; else o.only = v.split(',').map((s) => s.trim().toUpperCase()); }
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else o.错 = '未知参数：' + a;
  }
  if (!o.错 && !o.help) {
    if (!o.tree) o.错 = '缺 --tree <发行树目录>（用法：node p1b/scripts/audit-release.cjs --tree <dir> [--only C9,C10,C11,C14] [--json]）';
    else if (o.only) {
      const 已知 = new Set(检查表.map((c) => c.id));
      const 坏 = o.only.filter((id) => !已知.has(id));
      if (坏.length) o.错 = '--only 里有不存在的项号：' + 坏.join(',') + '（共 ' + 已知.size + ' 项：' + [...已知].join(',') + '）';
    }
  }
  return o;
}

/** 跑一遍体检。返回 {码, 树, 项[], 失败码[]}；**本函数不写任何东西**。 */
function runAudit(opts) {
  const tree = path.resolve(opts.tree);
  if (!fs.existsSync(tree)) return { 码: EXIT_USAGE, 树: tree, 项: [], 失败码: [], 错: '发行树不存在：' + tree + '（★不许静默通过：树没找到 = 什么都没扫到）' };
  if (!fs.statSync(tree).isDirectory()) return { 码: EXIT_USAGE, 树: tree, 项: [], 失败码: [], 错: '--tree 指的不是目录：' + tree };
  const 走 = walkTree(tree);
  const ctx = { 走, tree };
  const 选中 = opts.only ? 检查表.filter((c) => opts.only.includes(c.id)) : 检查表.slice();
  const 项 = 选中.map((c) => {
    let r;
    try { r = c.查(ctx); } catch (e) { r = 不通过('检查项自身抛错（当成红，不当成通过）', clip(e && e.message)); }
    return { id: c.id, 码: c.码, 名: c.名, 红: !!r.红, 结论: r.结论, 证据: r.证据 };
  });
  const 失败码 = 项.filter((x) => x.红).map((x) => x.码);
  return { 码: 失败码.length ? EXIT_GATE : EXIT_OK, 树: tree, 项, 失败码, 走: { 文件数: 走.files.length, 目录数: 走.dirs.length, 字节: 走.字节 } };
}

function main(argv) {
  const o = 解析参数(argv);
  if (o.help) { 说('用法：node p1b/scripts/audit-release.cjs --tree <发行树目录> [--only C9,C10,C11,C14] [--json]'); process.exitCode = EXIT_OK; return; }
  if (o.错) { 说('✘ 用法错：' + o.错); process.exitCode = EXIT_USAGE; return; }

  const r = runAudit(o);
  if (r.错) { 说('✘ ' + r.错); process.exitCode = r.码; return; }

  if (o.json) {
    说(JSON.stringify({ 树: r.树, 码: r.码, 失败码: r.失败码, 项: r.项, 走: r.走 }, null, 2));
  } else {
    说('');
    说('═══ 发行体检（只读 · 绝不联网 · 绝不打印密钥本体）═══');
    说('发行树：' + r.树);
    说('规模：' + r.走.文件数 + ' 个文件 / ' + r.走.目录数 + ' 个目录 / 计费 ' + MB(r.走.字节.计费) + '（node_modules ' + MB(r.走.字节.依赖) + ' 不计入、照报）');
    说('');
    for (const x of r.项) {
      说('  ' + (x.红 ? '[红]' : '[OK]') + ' ' + x.id.padEnd(4) + 补宽(x.名, 18) + x.结论);
      说('        ← ' + x.证据);
    }
    说('');
    if (r.失败码.length === 0) 说('✔ ' + r.项.length + ' 项全过。');
    else 说('✘ 红 ' + r.失败码.length + ' 项（逐项失败码 ' + r.失败码.join(', ') + '；进程退出码 ' + EXIT_GATE + ' ＝门禁码，不是错误码）');
    // 项数**动态**取自检查表：写死 "14" 的话，下次加一条判据这句就变成假话
    //  —— 而它恰恰是在说「不许为了让包过而放宽判据」。
    说('★这 ' + 检查表.length + ' 项是发布标准。为了让发行包通过而放宽任何一项，都是改发布标准——Ask first。');
  }
  process.exitCode = r.码;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  runAudit, 解析参数, main, walkTree, 检查表,
  C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14,
  C6_MAX_BYTES, C2_WINPATH_RE, C3_IPV4_RE, C11_LAYERS, 零泄漏表,
  EXIT_OK, EXIT_USAGE, EXIT_GATE,
};
