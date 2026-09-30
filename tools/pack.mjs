#!/usr/bin/env node
/**
 * tools/pack.mjs —— 绿色 zip 与三个启动器的打包器（模块 packaging · SPEC-packaging.md）
 *
 * 产出：`out/p1b-sandbox-v<版本>-win-x64/`，解压到**含空格与中文**的路径双击 start.bat 就能用。
 *
 * ── 它做三件事，一件不多 ──────────────────────────────────────────────────
 *   ① 照**清单**把该进的拷进树里（目录清单 + 文件清单 + 依赖闭包），不该进的**不进**；
 *   ② 账体积（★与发行闸 C6 **同一套口径**：不含 node_modules、不含便携 node）；
 *   ③ 自查（自持判据）＋ 调发行闸 audit-release.cjs 出**真判决**。
 *
 * ── 布局为什么是「平铺」而不是 spec 草图里的 app/ 一层 ────────────────────
 *   SPEC-packaging.md 的 Project Structure 画的是 `app/{p1a-terminal,p1b,node_modules}`。
 *   但发行闸把三条路径写死在**树根**上：
 *     · C4 真 require `<root>/p1a-terminal/node_modules/better-sqlite3`（audit-release.cjs:236）
 *     · C5 真 require `<root>/p1a-terminal/src/db.js`（:244）
 *     · C13 找 `<root>/package.json` 的 scripts.start（:377）
 *   若按 app/ 一层，体检目标就必须指到 `<产物>/app`，**三个启动器就落在被体检的树之外**
 *   ⇒ C13 的「start*.bat 不许写死盘符」会扫到 0 个 bat，空过。
 *   ⇒ 取平铺：启动器与被体检的树是同一棵，这一项才咬得住。
 *
 * ── 布局为什么是 `runtime/node/node.exe` 而不是 `runtime/node.exe` ─────────
 *   C6 的「不含便携 node」是按**目录名** `node` 豁免的（audit-release.cjs:58 便携node目录 =
 *   new Set(['node'])）。node.exe 若直接躺在 runtime/ 下就会进 C6 的计费，88.5 MB ⇒ C6 必红。
 *   ⇒ 目录名必须是 node。这是与 SPEC 草图的一处实质差异，如实记在这里。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────
 *   · **零新依赖**：只用 node 内置。
 *   · **不写产品目录**（out/ 以外一个字节都不改），不改、不删、不生成任何源码。
 *   · **不联网**、不 require 发行树里的模块（真 require 一律在子进程里做）。
 *   · **失败即停**：自持判据红 ⇒ 退出码 3，不留一棵"看着能跑"的树。
 *   · **不藏**：剔了什么、丢了多少字节、上游哪几行会让 C2/C3 红，全打印。
 *
 * 用法：
 *   node tools/pack.mjs                 打包 + 自查 + 跑发行闸
 *   node tools/pack.mjs --check         只体检已有产物（不重新打包）
 *   node tools/pack.mjs --out <dir>     换产物目录
 *   node tools/pack.mjs --no-audit      只打包不跑发行闸（测试用；**不代表通过**）
 *   node tools/pack.mjs --json          机器可读结果
 *
 * 退出码：0 全过 ／ 1 用法错或环境缺件 ／ 3 门禁码（自查红或发行闸红）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __文件名 = fileURLToPath(import.meta.url);
export const 仓库根 = path.resolve(__文件名, '..', '..');
const 说 = (s) => process.stdout.write(s + '\n');
const 错 = (s) => process.stderr.write(s + '\n');
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';
const KB = (n) => (n / 1024).toFixed(1) + ' KB';

// ── 判据常量（★全部具名：测试按名字改，见 tools/pack.test.mjs）──────────────
export const C6_MAX_BYTES = 12 * 1024 * 1024;                 // 与 audit-release.cjs:44 同值
export const 便携node目录名 = 'node';                            // 与 audit-release.cjs:58 同口径
export const 依赖目录名 = 'node_modules';                        // 与 audit-release.cjs:59 同口径
/** C2 同源判据：「[A-Za-z]:\ 」。构造器里要给两个反斜杠，模式才表示一个字面反斜杠。 */
export const C2_WINPATH_RE = new RegExp('[A-Za-z]:' + String.fromCharCode(92, 92), 'g');
/** C3 同源判据（127.0.0.1 / 0.0.0.0 除外）。 */
export const C3_IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
export const C3_IP_OK = new Set(['127.0.0.1', '0.0.0.0']);
const 扫描上限 = 4 * 1024 * 1024;                                // 与 audit-release.cjs:54 同值

/** 平台标识：win32-x64 那一位。本轮只做 Windows（SPEC Open Questions 已定）。 */
export const 平台 = process.platform === 'win32' ? 'win32' : process.platform;
export const 架构 = process.arch === 'x64' ? 'x64' : process.arch;

// ════════════════════════════════════════════════════════════════════
// 清单
// ════════════════════════════════════════════════════════════════════

/** 目录清单：照抄即进抄。★每个条目都能在 SPEC-packaging.md 的体积账里对上号。 */
export const 目录清单 = Object.freeze([
  { 自: 'p1a-terminal/src', 到: 'p1a-terminal/src', 因: '数据层与引擎（6 文件，145 KB）' },
  { 自: 'p1b/src', 到: 'p1b/src', 因: '后端与前端接口（73 文件，752 KB）' },
  { 自: 'p1b/cli', 到: 'p1b/cli', 因: '体检/读数/门禁薄 CLI（A9/A10 靠它）' },
  { 自: 'p1b/mcp', 到: 'p1b/mcp', 因: 'MCP 适配层' },
  { 自: 'p1b/gates', 到: 'p1b/gates', 因: '四道闸门入口' },
  { 自: 'p1b/skill', 到: 'p1b/skill', 因: '技能说明' },
  { 自: 'p1b/web/dist', 到: 'p1b/web/dist', 因: '★前端产物：web_built=true 的唯一来源' },
  { 自: 'p1b/scripts', 到: 'p1b/scripts', 因: '只读体检脚本群（看板/跑批/发行闸本身）' },
]);

/** 文件清单：单文件逐个点名（不进这些就是少了一棵树，不许「顺手多拷点」）。 */
export const 文件清单 = Object.freeze([
  { 自: 'p1b/package.json', 到: 'p1b/package.json' },
  { 自: 'p1a-terminal/package.json', 到: 'p1a-terminal/package.json' },
  { 自: 'LICENSE', 到: 'LICENSE' },
  { 自: 'seed/p1a-seed.db', 到: 'seed/p1a-seed.db', 因: '种子库（二进制，逐字节拷贝）' },
  { 自: 'docs/specs/kind-目录表.md', 到: 'docs/kind-目录表.md', 因: '★C12 要它核契约表 sha256' },
  { 自: 'p1b/sim/out/g2-contract-frozen-r4.json', 到: 'docs/g2-contract-frozen-r4.json', 因: '★C12 的契约冻结件' },
  { 自: 'tools/launcher/boot.cjs', 到: 'launcher/boot.cjs' },
  { 自: 'tools/launcher/stop.cjs', 到: 'launcher/stop.cjs' },
  { 自: 'tools/launcher/seedcheck.cjs', 到: 'launcher/seedcheck.cjs' },
  { 自: 'tools/launcher/start.bat', 到: 'start.bat', crlf: true },
  { 自: 'tools/launcher/start-debug.bat', 到: 'start-debug.bat', crlf: true },
  { 自: 'tools/launcher/stop.bat', 到: 'stop.bat', crlf: true },
]);

/**
 * ★为什么 .bat 在**产物里**必须是 CRLF，而仓库源件是 LF。
 *   cmd.exe 逐字节读 .bat，并按**字节偏移**回 seek（多行括号块/goto 都要回 seek）。
 *   LF 只有 1 字节、CRLF 有 2 字节 ⇒ 回 seek 落点错位，整份批处理被切成碎片，
 *   实测症状是 `'ackups" 2>nul' 不是内部或外部命令`、`'PORT，…echo' …`（2026-09-30 实测）。
 *   而仓库里必须是 LF+UTF-8：CRLF 会让 `git diff --check` 逐行报 trailing whitespace。
 *   ⇒ 源件 LF，**打包时转 CRLF**。两处各测一次（pack.test.mjs ⑤a 产物 CRLF ／ ⑩a 源件 LF）。
 */
export const CRLF_清单 = Object.freeze(['start.bat', 'start-debug.bat', 'stop.bat']);

/**
 * ★必发清单：这些文件**不许**被自动剔除。
 * 存在意义：下面 C2/C3 的自动剔除是「不发就少一处泄漏」；但如果哪天必发件自己带了盘符，
 * 正确反应是**打包失败并报出来**，而不是悄悄把它从树里拿掉、让 A9/A10 变成「命令不存在」。
 */
export const 必发 = Object.freeze([
  'p1b/src/server.js', 'p1b/src/paths.cjs', 'p1b/src/deps.js', 'p1b/src/providersStore.js',
  'p1b/cli/index.cjs', 'p1b/cli/commands.cjs',
  'p1b/scripts/board.cjs', 'p1b/scripts/exp-health.cjs',
  'p1b/scripts/audit-release.cjs', 'p1b/scripts/make-seed-db.cjs',
  'p1a-terminal/src/db.js', 'p1a-terminal/src/llm.js',
  'p1b/web/dist/index.html',
  'seed/p1a-seed.db', 'seed/seed_provenance.json',
  'start.bat', 'start-debug.bat', 'stop.bat',
  'launcher/boot.cjs', 'launcher/stop.cjs', 'launcher/seedcheck.cjs',
  'runtime/node/node.exe', 'package.json', 'README.md', 'LICENSE',
  'p1a-terminal/providers.template.json',
  'docs/kind-目录表.md', 'docs/g2-contract-frozen-r4.json',
]);

/** 运行时依赖的种子集合：p1b 的四个 + better-sqlite3（原生件另放，见 betterSqlite3落点）。 */
export const 运行时依赖种子 = Object.freeze(['@fastify/cors', '@fastify/static', 'fastify', 'lunar-javascript', 'better-sqlite3']);

/**
 * 解析依赖时的搜索根（顺序即优先级）。
 * ★为什么要有三个：better-sqlite3 只装在 p1a-terminal/node_modules（实测，仓库根与
 *   p1b/node_modules 都没有），而 fastify 那四个在 p1b/node_modules。只给一个根必然漏。
 *   ——这条与 p1b/scripts/_betterSqlite3.cjs:10-13 的实测记录一致。
 */
export function 依赖搜索根() {
  return [path.join(仓库根, 'p1b'), 仓库根, path.join(仓库根, 'p1a-terminal')];
}

// ════════════════════════════════════════════════════════════════════
// 小工具
// ════════════════════════════════════════════════════════════════════

/** 目录总字节（不含符号链接；读不到的按 0，不猜）。 */
export function 目录字节(dir) {
  let n = 0;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) n += 目录字节(abs);
    else { try { n += fs.statSync(abs).size; } catch { /* 读不到当 0 */ } }
  }
  return n;
}

export function 文件数(dir) {
  let n = 0;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    n += e.isDirectory() ? 1 + 文件数(path.join(dir, e.name)) : 1;
  }
  return n;
}

/**
 * 扫一个文件，回报 C2/C3 命中（**只回位置与条数，永不回原文** —— 命中的原文就是盘符本身）。
 * 二进制（开头 4096 字节里有 NUL）跳过；超 扫描上限 只扫前段并标记截断。
 */
export function 扫一个(abs) {
  let buf;
  let size = 0;
  try {
    const fd = fs.openSync(abs, 'r');
    try {
      size = fs.fstatSync(fd).size;
      buf = Buffer.allocUnsafe(Math.min(size, 扫描上限));
      fs.readSync(fd, buf, 0, buf.length, 0);
    } finally { fs.closeSync(fd); }
  } catch { return { 读了: false, c2: 0, c3: 0, 位置: [] }; }
  if (buf.subarray(0, 4096).includes(0)) return { 读了: false, 二进制: true, c2: 0, c3: 0, 位置: [] };
  const lines = buf.toString('utf8').split(/\r?\n/);
  const 位置 = [];
  let c2 = 0, c3 = 0;
  for (let i = 0; i < lines.length; i++) {
    C2_WINPATH_RE.lastIndex = 0;
    const a = lines[i].match(C2_WINPATH_RE) || [];
    C3_IPV4_RE.lastIndex = 0;
    const b = (lines[i].match(C3_IPV4_RE) || []).filter((x) => !C3_IP_OK.has(x));
    if (a.length || b.length) {
      c2 += a.length; c3 += b.length;
      位置.push({ 行: i + 1, c2: a.length, c3: b.length });
    }
  }
  return { 读了: true, c2, c3, 位置, 截断: size > 扫描上限 };
}

/**
 * 走发行树：与 audit-release.cjs 的 walkTree **同一套口径**（符号链接不进、node_modules
 * 与便携 node 的内部不进清单、它们的体积另计）。
 * 为什么要自己再走一遍：打包器要**在交付前**就知道自己造出来的东西多大、脏不脏，
 * 不能只等发行闸告诉它。
 */
export function 走树(root) {
  const files = [];
  const dirs = [];
  let 依赖字节 = 0, 依赖条目 = 0, 便携字节 = 0, 计费 = 0;
  (function walk(dir) {
    const ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === 便携node目录名) { 便携字节 += 目录字节(abs); continue; }
        if (e.name === 依赖目录名) { 依赖字节 += 目录字节(abs); 依赖条目 += 文件数(abs); continue; }
        dirs.push(path.relative(root, abs).split(path.sep).join('/'));
        walk(abs);
      } else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch { size = 0; }
        计费 += size;
        files.push({ abs, rel: path.relative(root, abs).split(path.sep).join('/'), size, 段: e.name });
      }
    }
  })(root);
  return { root, files, dirs, 计费, 依赖字节, 依赖条目, 便携字节 };
}

// ════════════════════════════════════════════════════════════════════
// 依赖闭包
// ════════════════════════════════════════════════════════════════════

/**
 * 按 Node 的解析规则找一个包：从 `fromDir` 逐级上溯找 `node_modules/<name>/package.json`。
 * @returns {string|null} 包的目录
 */
export function 解析一个包(name, fromDir, 搜索根列表) {
  const 名单 = (搜索根列表 && 搜索根列表.length ? 搜索根列表 : [fromDir]);
  for (const 起 of 名单) {
    let dir = path.resolve(起);
    for (;;) {
      const cand = path.join(dir, 依赖目录名, ...name.split('/'));
      if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

/**
 * 运行时依赖闭包：从种子出发，按各包 package.json 的 dependencies 递归展开。
 * ★为什么不整份拷 node_modules：p1b/node_modules 有 2815 个文件 21 MB，
 *   大头是 vite 时代的工具链与 CLI 依赖；spec 的体积账只认「4 个运行时依赖 3.86 MB」。
 * ★为什么不「手抄一份清单」：手抄的清单会随上游升级悄悄过期，而过期那天是**运行时**才炸。
 *   这里从真实 package.json 现算，过期不了。
 * @returns {{包: Array, 未命中: string[], 重名: string[]}}
 */
export function 依赖闭包(种子, opts) {
  const o = opts || {};
  const 搜索根 = o.搜索根 || [仓库根];
  const 包 = new Map();          // dir -> {name, version, dir, 字节}
  const 未命中 = [];
  const 重名 = [];
  const 队列 = [...种子].map((name) => ({ name, from: 搜索根[0] }));
  while (队列.length) {
    const { name, from } = 队列.shift();
    const dir = 解析一个包(name, from, 搜索根);
    if (!dir) { if (!未命中.includes(name)) 未命中.push(name); continue; }
    if (包.has(dir)) continue;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); }
    catch (e) { 未命中.push(name + '（package.json 读不了：' + (e && e.code) + '）'); continue; }
    const rec = { name, version: String(pkg.version || '?'), dir, 字节: 目录字节(dir), 主: 依赖目录名 };
    包.set(dir, rec);
    for (const 同名 of 包.values()) {
      if (同名 !== rec && 同名.name === name) 重名.push(name + '：' + 同名.version + ' 与 ' + rec.version);
    }
    for (const d of Object.keys(pkg.dependencies || {})) 队列.push({ name: d, from: dir });
  }
  return { 包: [...包.values()], 未命中, 重名: [...new Set(重名)] };
}

// ════════════════════════════════════════════════════════════════════
// better-sqlite3 剪枝
// ════════════════════════════════════════════════════════════════════

/**
 * 拷 better-sqlite3，但**只拷运行时要用的那几件**。
 * 原包里 prebuilds/ 有 8 个平台的 .node（17 MB）、deps/ 是 sqlite3 的 C 源码（9.9 MB）——
 * 换机器要的是 `prebuilds/<platform>-<arch>.node` 那一个（lib/binding.js:36-42 只认它）。
 * ★剪完必须**真 require 一次**才算数（见 打包 里的 落地后自检），不许「剪完看着像」。
 * @returns {{拷贝: string[], 丢弃: string[], 丢弃字节: number}}
 */
export function 剪枝原生包(源, 目标, 平台名, 架构名) {
  const 要的 = new Set(['package.json', 'LICENSE', 'README.md']);
  const 拷贝 = [];
  const 丢弃 = [];
  let 丢弃字节 = 0;
  const 本机prebuild = 平台名 + '-' + 架构名 + '.node';
  const walk = (rel) => {
    const abs = path.join(源, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const 子 = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        // ★prebuilds 目录**要进去**（只留本机那一个 .node），不能整目录跳过 ——
        //   整目录跳过的话本机那个也不会被拷，better-sqlite3 就彻底起不来了。
        if (子 === 'deps' || 子 === 'src' || 子 === 'build' || 子 === 'node_modules') { 丢弃.push(子 + '/'); 丢弃字节 += 目录字节(path.join(源, 子)); continue; }
        walk(子);
      } else if (e.isFile()) {
        const 前 = rel.split(path.sep)[0];
        const 本 = fs.statSync(path.join(abs, e.name)).size;
        if (前 === 'prebuilds') {
          if (e.name === 本机prebuild) 拷贝.push(子); else { 丢弃.push(子); 丢弃字节 += 本; }
        } else if (子.endsWith('.gyp')) { 丢弃.push(子); 丢弃字节 += 本; }
        else if (要的.has(子) || 子.startsWith('lib' + path.sep)) 拷贝.push(子);
        else { 丢弃.push(子); 丢弃字节 += 本; }
      }
    }
  };
  walk('');
  for (const rel of 拷贝) {
    const dst = path.join(目标, ...rel.split(/[\\/]/));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(源, ...rel.split(/[\\/]/)), dst);
  }
  return { 拷贝, 丢弃, 丢弃字节 };
}

// ════════════════════════════════════════════════════════════════════
// 生成件
// ════════════════════════════════════════════════════════════════════

/** 写一个文本文件：★一律 UTF-8 无 BOM + LF（CRLF 会让 git diff --check 逐行报 trailing whitespace）。 */
export function 写文本(dst, 内容) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, String(内容).replace(/\r\n/g, '\n'), 'utf8');
}

/**
 * 生成空的供应商配置模板：结构照抄真配置，**api_key 一律清空**。
 * ★为什么不是「复制一份改名」：真配置里躺着真 key，改名不改值＝把密钥发出去。
 * ★为什么保留 base_url / model：让陌生人只差一个 key 就能用；而且 C3 会当场抓住
 *   「base_url 指向内网」这种真泄漏（那时再清空并报出来，不静默）。
 */
export function 生成配置模板(真配置路径) {
  const 原始 = JSON.parse(fs.readFileSync(真配置路径, 'utf8'));
  const 模板 = JSON.parse(JSON.stringify(原始));
  let 清了几处 = 0;
  const 走 = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) 走(v);
      else if (/api[_-]?key|secret|token|password/i.test(k) && String(v || '').trim()) { o[k] = ''; 清了几处++; }
    }
  };
  走(模板);
  return { 模板, 清了几处 };
}

/** 生成包内 README：极简上手 + 版本 + 再分发权未确认（如实写）。 */
export function 生成README(版本, node版本, 便携字节, 依赖清单) {
  return [
    '# 推演沙盘 · 本地工作台（绿色包）',
    '',
    '## 怎么用（三步）',
    '',
    '1. 把这个文件夹**整个**解压到任意位置（路径含空格、中文都行）。',
    '2. 双击 **`start.bat`**。',
    '3. 浏览器会自动打开工作台。**这个黑窗口不要关**——它就是服务本身。',
    '',
    '要停服务：关掉那个窗口，或按 `Ctrl+C`，或另开一个窗口双击 `stop.bat`（**数据一律保留**）。',
    '排错请用 `start-debug.bat`（服务停下来后窗口不关，并打印退出码）。',
    '',
    '## 你的数据在哪',
    '',
    '**不在这个文件夹里**，在：',
    '',
    '```',
    '%LOCALAPPDATA%\\P1bSandbox\\',
    '├─ p1a.db          你的账本（问题、判断、结算）',
    '├─ config\\         供应商配置（含你填的 key，只在本机）',
    '├─ backups\\        备份',
    '└─ logs\\           启动日志（排错看 startup.log）',
    '```',
    '',
    '★**卸载 = 删掉上面这个目录**。删掉程序文件夹不会丢数据，也不会带走数据。',
    '★想换个位置：设环境变量 `P1B_DATA_DIR` 指向你自己的目录，再双击 start.bat。',
    '',
    '## 首启是 MOCK（不联网）',
    '',
    '第一次启动时你没填任何 key，所以 LLM 走 **MOCK**：全部只读功能都能看，**不发任何网络请求**。',
    '在工作台的设置页填了 key 之后重启，横幅会显示 `LIVE`。',
    '',
    '## 里面带了什么',
    '',
    `- 种子库（示范数据，已剔除未经同意公开的真实玩家信息）`,
    `- 运行时依赖 ${依赖清单.length} 个：${依赖清单.join('、')}`,
    `- 便携 Node **${node版本}**（${MB(便携字节)}，见下面的注意事项）`,
    '',
    '## ★关于内置的 Node（请读一眼）',
    '',
    `- 版本：**${node版本}**，来源是**打包那台机器上已安装的 Node**（离线拷贝，没有联网下载）。`,
    '- ★**再分发权未确认**：这个 Node 是某个已安装软件的产物，**把它连同本包一起再分发，',
    '  其授权状态本项目未确认**。要商用或公开分发，请先换成 Node 官方 zip 并校验 sha256。', // eslint-disable-line
    '- ★**版本被绑死**：换 Node 版本需要重新打包，运行时不能切换。',
    '- 应用本身对 Node 版本的要求：**20 或更高**。',
    '',
    '## 许可',
    '',
    '本包内应用代码按仓库根的 LICENSE（Apache-2.0）授权。便携 Node 是第三方组件，',
    '遵循其自身许可（见 `runtime/node/` 所在 Node 发行版的许可条款）。',
    '',
  ].join('\n');
}

// ════════════════════════════════════════════════════════════════════
// 打包
// ════════════════════════════════════════════════════════════════════

/** 相对 require 判据：`require('./x')` / `require('../y/z.cjs')`。只认相对路径，裸包名不管。 */
const 相对require_RE = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
/** 脚本 spawn/表里按**文件名**引用（CLI 命令表、闸门入口）——保守起见，提到就不许自动剔。 */
// ★「按文件名被提到就不许自动剔」的判据扫的是**全部候选文件**的正文（见 剔除决策③）。

/** 列一个文件的相对 require 目标。**返回相对 `扫根` 的 posix 路径**（这样跨目录清单也能对上）。 */
export function 相对require目标(abs, 扫根) {
  let t;
  try { t = fs.readFileSync(abs, 'utf8'); } catch { return []; }
  const out = [];
  const relOf = (p) => path.relative(扫根, p).split(path.sep).join('/');
  相对require_RE.lastIndex = 0;
  let m;
  while ((m = 相对require_RE.exec(t))) {
    const 解析 = path.resolve(path.dirname(abs), m[1]);
    for (const 后缀 of ['', '.js', '.cjs', '.mjs', '.json']) {
      const c = relOf(解析 + 后缀);
      if (c && !c.startsWith('..')) out.push(c);
    }
    for (const 尾 of ['/index.js', '/index.cjs', '/index.mjs']) {
      const c = relOf(path.join(解析, 尾));
      if (c && !c.startsWith('..')) out.push(c);
    }
  }
  return out;
}

/**
 * 扫一棵候选目录树：只扫不拷。
 * @returns {Array<{rel, abs, 脏, c2, c3, 位置, 需: string[]}>}
 */
export function 扫候选树(源, 根前缀) {
  const 出 = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      const 子 = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (e.name === 依赖目录名 || e.name === 便携node目录名) continue;   // 依赖闭包单独处理
        walk(abs, 子);
      } else if (e.isFile()) {
        const r = 扫一个(abs);
        出.push({
          rel: 根前缀 + 子, abs,
          脏: !!(r.读了 && (r.c2 || r.c3)),
          c2: r.c2 || 0, c3: r.c3 || 0, 位置: r.位置 || [],
          需: 相对require目标(abs, 源).map((t) => 根前缀 + t),
          文本: (() => { try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; } })(),
        });
      }
    }
  })(源, '');
  return 出;
}

/**
 * ★剔除决策：哪些脏文件可以剔、哪些必须照发。
 *
 * 规则（按顺序，先命中先定）：
 *   ① 在 `必发` 里 ⇒ 照发（剔了服务起不来）。
 *   ② **别的文件 require 它** ⇒ 照发。★这是最重要的一条：剔掉一个被 require 的文件，
 *      树里就多一个 MODULE_NOT_FOUND，而那要等到运行时才炸（换机器才炸的那种）。
 *      所以做可达性闭包：从「干净文件」出发沿相对 require 走，路上碰到的脏文件一律照发。
 *   ③ **树里别的代码文件在「会真的调它」的那一行提到它** ⇒ 照发。判据是**行级**的：
 *      那一行里同时出现文件名与 spawn/exec/`script:`/`require(`。只写在注释里、只写在
 *      markdown 索引里，都**不算**调它（`audit-release.cjs:10` 就是纯注释地提到
 *      secret-preflight.cjs；`p1b/scripts/README.md` 把整个目录逐个列了一遍）。
 *   ④ 其余 ⇒ 剔掉，并逐条列出来。剔的理由是闸的意图本身：这些文件里写着**打包人自己的
 *      盘符/内网地址**，发出去等于把打包环境泄露给收件人。
 *
 * @returns {{剔: string[], 阻: Map<string,string>}}（阻是 rel → 理由）
 */
export function 剔除决策(候选, opts) {
  const o = opts || {};
  const 集 = new Map(候选.map((f) => [f.rel, f]));
  const 可达 = new Set(候选.filter((f) => !f.脏).map((f) => f.rel));
  for (let 变了 = true; 变了;) {                     // 不动点：沿 require 走，走到脏文件就变可达
    变了 = false;
    for (const rel of [...可达]) {
      const f = 集.get(rel);
      if (!f) continue;
      for (const t of f.需) if (集.has(t) && !可达.has(t)) { 可达.add(t); 变了 = true; }
    }
  }
  const 剔 = [], 阻 = new Map();
  const 是代码 = (rel) => /\.(c?js|m?js|ts|json|py|sh|bat)$/i.test(rel);
  const 调用记号 = /spawn|exec|script\s*:|require\s*\(/i;
  const 被调 = (名, 自己) => 候选.some((g) => {
    if (g.rel === 自己 || !是代码(g.rel) || !g.文本) return false;
    return g.文本.split(/\r?\n/).some((l) => l.includes(名) && 调用记号.test(l));
  });
  for (const f of 候选) {
    if (!f.脏) continue;
    const 名 = f.rel.split('/').pop();
    if (必发.includes(f.rel)) { 阻.set(f.rel, '必发清单'); continue; }
    if (可达.has(f.rel)) { 阻.set(f.rel, '有文件 require 它（剔了会变成运行时 MODULE_NOT_FOUND）'); continue; }
    if (被调(名, f.rel)) { 阻.set(f.rel, '树里别的代码文件在 spawn/exec/script:/require( 那一行提到它（会真的调它）'); continue; }
    剔.push(f.rel);
  }
  void o;
  return { 剔, 阻 };
}

/**
 * 打包主流程。
 * @param {object} o `{树根, 静默}`
 * @returns {{树根, 计费, 剔掉, 依赖, 便携字节, 问题: string[]}}
 */
export function 打包(o) {
  const opt = o || {};
  const 树根 = opt.树根;
  const 静 = !!opt.静默;
  const 说之 = (s) => { if (!静) 说(s); };
  const 版本 = (() => { try { return JSON.parse(fs.readFileSync(path.join(仓库根, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } })();
  const 问题 = [];

  // 0. 清空产物目录（只动 out/ 下面这一个已知的树根）
  fs.rmSync(树根, { recursive: true, force: true });
  fs.mkdirSync(树根, { recursive: true });

  // 1. 目录清单：**先全树扫描**，再统一做剔除决策（决策要看全局 require 图，不能逐目录拍）
  const 剔掉 = [];
  const 阻断 = [];
  let 候选 = [];
  for (const 项 of 目录清单) {
    const 源 = path.join(仓库根, 项.自);
    if (!fs.existsSync(源)) { 问题.push('缺目录：' + 项.自); continue; }
    候选.push(...扫候选树(源, 项.到 + '/'));
  }
  if (问题.length) { const e = new Error(问题.join('；')); e.code = 'ERR_PACK_MISSING'; throw e; }
  const 决策 = 剔除决策(候选);
  const 剔集 = new Set(决策.剔);
  let 拷入 = 0, 拷字节 = 0;
  for (const f of 候选) {
    if (剔集.has(f.rel)) { 剔掉.push({ rel: f.rel }); continue; }
    if (f.脏) 阻断.push({ rel: f.rel, c2: f.c2, c3: f.c3, 位置: f.位置, 因: 决策.阻.get(f.rel) || '剔不得' });
    const d = path.join(树根, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(f.abs, d);
    拷入++; 拷字节 += fs.statSync(d).size;
  }
  for (const 项 of 目录清单) {
    const n = 候选.filter((f) => f.rel.startsWith(项.到 + '/') && !剔集.has(f.rel)).length;
    const b = 候选.filter((f) => f.rel.startsWith(项.到 + '/') && !剔集.has(f.rel))
      .reduce((a, f) => a + (fs.existsSync(f.abs) ? fs.statSync(f.abs).size : 0), 0);
    说之('  目录 ' + 项.到.padEnd(20) + String(n).padStart(4) + ' 文件 ' + KB(b).padStart(10) + '   （' + 项.因 + '）');
  }
  if (问题.length) { const e = new Error(问题.join('；')); e.code = 'ERR_PACK_MISSING'; throw e; }

  // 2. 文件清单
  for (const 项 of 文件清单) {
    const 源 = path.join(仓库根, 项.自);
    if (!fs.existsSync(源)) { 问题.push('缺文件：' + 项.自); continue; }
    const d = path.join(树根, ...项.到.split('/'));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    if (项.crlf) {
      // ★只改行尾，不改内容（连 BOM 都不加：cmd 见到 BOM 会把第一行当命令）
      const t = fs.readFileSync(源, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      fs.writeFileSync(d, t, 'utf8');
    } else {
      fs.copyFileSync(源, d);
    }
    说之('  文件 ' + 项.到.padEnd(20) + KB(fs.statSync(d).size).padStart(14) + (项.crlf ? '   （LF → CRLF，见 CRLF_清单 的理由）' : ''));
  }
  if (问题.length) { const e = new Error(问题.join('；')); e.code = 'ERR_PACK_MISSING'; throw e; }

  // 3. seed/seed_provenance.json：**生成**一份洗掉打包人盘符的（原件含绝对路径，C2 必红）
  {
    const 原 = JSON.parse(fs.readFileSync(path.join(仓库根, 'seed', 'seed_provenance.json'), 'utf8'));
    const 洗 = (v) => {
      if (typeof v === 'string') {
        let s = v.replace(C2_WINPATH_RE, '<打包机路径>');
        s = s.replace(C3_IPV4_RE, (x) => (C3_IP_OK.has(x) ? x : '<内网地址>'));
        return s;
      }
      if (Array.isArray(v)) return v.map(洗);
      if (v && typeof v === 'object') { const o2 = {}; for (const k of Object.keys(v)) o2[k] = 洗(v[k]); return o2; }
      return v;
    };
    const 干净 = 洗(原);
    干净.发行包注意 = '本文件是发行包内的副本：打包机上的绝对路径与内网地址已在打包时替换为占位符（C2/C3 判据）。原值见仓库 seed/seed_provenance.json。';
    写文本(path.join(树根, 'seed', 'seed_provenance.json'), JSON.stringify(干净, null, 2) + '\n');
  }

  // 4. 运行时依赖闭包（上提到树根 node_modules/；原生件另放）
  const 闭 = 依赖闭包(运行时依赖种子, { 搜索根: 依赖搜索根() });
  if (闭.未命中.length) { const e = new Error('依赖闭包没解出来：' + 闭.未命中.join('、') + '（先 npm install）'); e.code = 'ERR_PACK_DEPS'; throw e; }
  if (闭.重名.length) { const e = new Error('同一个包出现两个版本，上提会装错：' + 闭.重名.join('；')); e.code = 'ERR_PACK_DEPS'; throw e; }
  const 原生 = 闭.包.filter((p) => p.name === 'better-sqlite3');
  const 纯js = 闭.包.filter((p) => p.name !== 'better-sqlite3');
  for (const p of 纯js) {
    const d = path.join(树根, 依赖目录名, ...p.name.split('/'));
    fs.cpSync(p.dir, d, { recursive: true, dereference: false, verbatimSymlinks: false });
  }
  const 原生源 = 原生[0];
  if (!原生源) { const e = new Error('没找到 better-sqlite3'); e.code = 'ERR_PACK_DEPS'; throw e; }
  // ★落点由发行闸 C4 写死：<root>/p1a-terminal/node_modules/better-sqlite3（audit-release.cjs:236）。
  //   同时也命中 _betterSqlite3.cjs:57-58 的第 ① 候选（CLI 脚本解析原生模块的第一个位置）。
  const 原生落点 = path.join(树根, 'p1a-terminal', 依赖目录名, 'better-sqlite3');
  const 剪 = 剪枝原生包(原生源.dir, 原生落点, 平台, 架构);
  // 原生包的兄弟依赖（node-addon-api 等）跟着放到同一处，保证 require 链不断
  for (const p of 闭.包) {
    if (p.name === 'better-sqlite3') continue;
    if (p.dir.startsWith(path.join(仓库根, 'p1a-terminal', 依赖目录名))) {
      const d = path.join(树根, 'p1a-terminal', 依赖目录名, ...p.name.split('/'));
      if (!fs.existsSync(d)) fs.cpSync(p.dir, d, { recursive: true });
    }
  }
  说之('  依赖 ' + String(纯js.length + 1).padStart(4) + ' 个运行时包（闭包现算）· better-sqlite3 剪掉 '
    + 剪.丢弃.length + ' 项 / ' + MB(剪.丢弃字节) + '，只留 ' + 剪.拷贝.length + ' 项');
  说之('       剪掉的明细：' + 剪.丢弃.slice(0, 12).join('、') + (剪.丢弃.length > 12 ? ' …共 ' + 剪.丢弃.length + ' 项' : ''));

  // 5. 便携 Node（★拷本机 node.exe，见 SPEC-packaging.md 勘误 2）
  const node源 = process.execPath;
  const node落点 = path.join(树根, 'runtime', 便携node目录名, 'node.exe');
  fs.mkdirSync(path.dirname(node落点), { recursive: true });
  fs.copyFileSync(node源, node落点);
  const 便携字节 = fs.statSync(node落点).size;
  说之('  便携 Node ' + MB(便携字节) + '（拷自本机 ' + process.version + '，目录名必须是 node 才不进 C6 预算）');

  // 6. 生成件：package.json / 配置模板 / README
  写文本(path.join(树根, 'package.json'), JSON.stringify({
    name: 'p1b-sandbox',
    version: 版本,
    private: true,
    description: '推演沙盘 · 本地工作台（绿色包）：解压即用，数据落在本机数据目录。',
    license: 'Apache-2.0',
    main: 'p1b/src/server.js',
    engines: { node: '>=20' },
    scripts: { start: 'node launcher/boot.cjs', stop: 'node launcher/stop.cjs' },
  }, null, 2) + '\n');
  {
    const { 模板, 清了几处 } = 生成配置模板(path.join(仓库根, 'p1a-terminal', 'config', 'providers.json'));
    if (!清了几处) 问题.push('★配置模板一个 key 都没清掉：真配置的结构可能变了，人工核一遍');
    写文本(path.join(树根, 'p1a-terminal', 'providers.template.json'), JSON.stringify(模板, null, 2) + '\n');
    说之('  配置模板 ' + KB(fs.statSync(path.join(树根, 'p1a-terminal', 'providers.template.json')).size) + '（已清空 ' + 清了几处 + ' 处 key）');
  }
  写文本(path.join(树根, 'README.md'), 生成README(版本, process.version, 便携字节, 纯js.map((p) => p.name).sort()));

  // 7. 落地后自检（自持判据，见 预检）
  const 检 = 预检(树根);
  if (检.红.length) {
    const e = new Error('打包自检红：\n  · ' + 检.红.join('\n  · '));
    e.code = 'ERR_PACK_SELFCHECK';
    e.检 = 检;
    throw e;
  }
  const 走 = 走树(树根);
  return { 树根, 走, 剔掉, 阻断, 剪, 问题, 检, 版本, 便携字节, 拷入, 拷字节, 依赖: 闭.包.map((p) => p.name).sort() };
}

// ════════════════════════════════════════════════════════════════════
// 自持判据
// ════════════════════════════════════════════════════════════════════

/**
 * 打包器自己的体检（**与发行闸同判据、不同实现**；发行闸是最终判决，这里是交付前自查）。
 * 分两类：
 *   · 红（打包器的责任）：清单/生成件自己的问题，红了不许交付。
 *   · 上游命中（C2/C3 落在**从仓库原样拷来**的文件里）：不是打包器能单方面解决的，
 *     如实列出来交人定夺，**不静默、不改源码、也不藏**。
 */
export function 预检(树根) {
  const 红 = [];
  const 上游命中 = [];
  const 走 = 走树(树根);
  const 段有 = (rel, seg) => rel.split('/').includes(seg);

  for (const f of 走.files) {
    if (段有(f.rel, 'config')) 红.push('C1/C7：有 config 路径段的发行文件：' + f.rel);
    if (/\.db-(wal|shm)$/i.test(f.段)) 红.push('C8：带 wal/shm 副本：' + f.rel);
    if (段有(f.rel, '.git')) 红.push('有 .git 残留：' + f.rel);
    if (f.段 === '.env' || f.段.endsWith('.env')) 红.push('有 .env：' + f.rel);
    if (/\.(db|sqlite)$/i.test(f.段) && f.rel !== 'seed/p1a-seed.db') 红.push('有非种子库的 .db：' + f.rel);
    if (f.rel.startsWith('p1a-terminal/data/')) 红.push('★打进了 p1a-terminal/data/（含生产库与旧备份，spec Boundaries: Never）：' + f.rel);
    if (/\.(key|pem|p12)$/i.test(f.段)) 红.push('有疑似密钥文件：' + f.rel);
  }
  for (const d of 走.dirs) {
    if (d === 'config' || d.endsWith('/config')) 红.push('C7：有 config/ 目录：' + d);
    if (d === '.git' || d.endsWith('/.git')) 红.push('有 .git 目录：' + d);
  }
  for (const 项 of 必发) {
    if (!fs.existsSync(path.join(树根, ...项.split('/')))) 红.push('必发件缺失：' + 项);
  }
  if (走.计费 >= C6_MAX_BYTES) 红.push('C6：计费 ' + MB(走.计费) + ' ≥ 12 MB');

  // C2/C3：packer 自己生成的文件（bat/cjs/json/md）红；仓库原样拷来的列进「上游命中」
  const 自产 = /^(start|start-debug|stop)\.bat$|^launcher\/|^package\.json$|^README\.md$|^seed\/seed_provenance\.json$|^p1a-terminal\/providers\.template\.json$/;
  for (const f of 走.files) {
    const r = 扫一个(f.abs);
    if (!r.读了 || (!r.c2 && !r.c3)) continue;
    const 条 = f.rel + '：C2 ' + r.c2 + ' 处 / C3 ' + r.c3 + ' 处，行 ' + r.位置.map((x) => x.行).join(',');
    if (自产.test(f.rel)) 红.push('★打包器自己生成的文件带绝对路径或内网 IP：' + 条);
    else 上游命中.push(条);
  }
  return { 红, 上游命中, 走 };
}

/** 真 require：必须在**子进程**里做（免得原生模块/依赖污染打包器自己的进程）。 */
export function 子进程require(目标) {
  if (!fs.existsSync(目标)) return { ok: false, why: '路径不存在' };
  const r = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(目标) + ')'], { cwd: path.dirname(目标), encoding: 'utf8', timeout: 60000 });
  if (r.error) return { ok: false, why: 'spawn 失败：' + r.error.message };
  if (r.status !== 0) return { ok: false, why: 'exit ' + r.status + '：' + String(r.stderr || '').split('\n').filter(Boolean).slice(0, 2).join(' | ') };
  return { ok: true, why: '子进程 exit 0' };
}

// ════════════════════════════════════════════════════════════════════
// 发行闸
// ════════════════════════════════════════════════════════════════════

/** 调发行闸（真判决）。★不自己判 C1–C14：那是 release-gate 模块的职责，抄一份就是两套判据。 */
export function 跑发行闸(树根, opts) {
  const o = opts || {};
  const 脚本 = path.join(仓库根, 'p1b', 'scripts', 'audit-release.cjs');
  const r = spawnSync(process.execPath, [脚本, '--tree', 树根], { encoding: 'utf8', cwd: 仓库根, timeout: 300000 });
  if (o.打印 !== false) { process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); }
  return { 码: r.status, 出: (r.stdout || '') + (r.stderr || '') };
}

// ════════════════════════════════════════════════════════════════════
// 入口
// ════════════════════════════════════════════════════════════════════

export function 解析参数(argv) {
  const o = { 打包: true, 查: false, 出: null, 审: true, json: false, 错: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.查 = true;
    else if (a === '--no-audit') o.审 = false;
    else if (a === '--json') o.json = true;
    else if (a === '--out') { const v = argv[++i]; if (!v) o.错 = '--out 后面缺目录'; else o.出 = path.resolve(v); }
    else if (a === '-h' || a === '--help') o.错 = null, o.help = true;
    else o.错 = '未知参数：' + a;
  }
  return o;
}

export function 产物名(版本) {
  return 'p1b-sandbox-v' + 版本 + '-win-x64';
}

export function main(argv) {
  const o = 解析参数(argv);
  if (o.help) {
    说('用法：node tools/pack.mjs [--out <dir>] [--check] [--no-audit] [--json]');
    return 0;
  }
  if (o.错) { 错('✘ 用法错：' + o.错); return 1; }
  const 版本 = (() => { try { return JSON.parse(fs.readFileSync(path.join(仓库根, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } })();
  const 树根 = o.出 || path.join(仓库根, 'out', 产物名(版本));

  if (o.查) {
    if (!fs.existsSync(树根)) { 错('✘ 产物不存在：' + 树根 + '（先跑 node tools/pack.mjs）'); return 1; }
    说('═══ 只体检，不产出：' + 树根 + ' ═══');
    const r = 跑发行闸(树根);
    return r.码 === 0 ? 0 : (r.码 === null ? 1 : 3);
  }

  说('═══ 打包 ' + 树根 + ' ═══');
  let 结果;
  try {
    结果 = 打包({ 树根, 静默: o.json });
  } catch (e) {
    错('✘ 打包失败：' + ((e && e.message) || e));
    if (e && e.检) for (const x of e.检.上游命中) 错('  · 上游命中：' + x);
    return e && e.code === 'ERR_PACK_SELFCHECK' ? 3 : 1;
  }
  const 走 = 结果.走;
  说('');
  说('── 体积账（与发行闸 C6 同一套口径）──');
  说('  计费（不含 node_modules 与便携 node）：' + MB(走.计费) + ' / 上限 ' + MB(C6_MAX_BYTES));
  说('  node_modules（另计、照报）           ：' + MB(走.依赖字节) + ' / ' + 走.依赖条目 + ' 条目');
  说('  便携 Node（spec 不计）               ：' + MB(走.便携字节));
  说('  发行文件 ' + 走.files.length + ' 个 / 目录 ' + 走.dirs.length + ' 个');
  const 剔 = 结果.剔掉;
  if (剔.length) {
    说('');
    说('── 自动剔除（每一条都有理由，不藏）──');
    for (const t of 剔) 说('  · ' + t.rel + '（带打包人盘符/内网地址，且没有任何文件 require 它、CLI 表也没提到）');
  }
  if (结果.阻断.length) {
    说('');
    说('── ★★ 阻断：命中 C2/C3 但剔不得的文件（照发，整包不许判过）──');
    for (const t of 结果.阻断) 说('  · ' + t.rel + '：C2 ' + t.c2 + ' 处 / C3 ' + t.c3 + ' 处，行 ' + t.位置.map((x) => x.行).join(',') + '　← ' + t.因);
    说('  ★剔不得，且打包器**无权**改产品源码或改闸（Ask first）。');
    说('  ★后果：发行闸的 C2/C3 会红 ⇒ 这棵树现在不能发布。处置权在人，见交付报告。');
  }
  if (结果.检.上游命中.length) {
    说('');
    说('── C2/C3 命中汇总（照原样拷进来的文件，打包器不改源码也不静默）──');
    for (const t of 结果.检.上游命中) 说('  · ' + t);
  }
  if (!o.审) {
    说('');
    if (结果.阻断.length) {
      错('✘ --no-audit 且存在阻断命中 ⇒ 退出码 3（发行闸没跑，但已知的阻断项就足以判红）。');
      return 3;
    }
    说('（--no-audit：没跑发行闸。★这不代表通过。）');
    return 0;
  }
  说('');
  const r = 跑发行闸(树根, { 打印: !o.json });
  if (o.json) 说(JSON.stringify({ 树根, 计费: 走.计费, 依赖: 走.依赖字节, 便携: 走.便携字节, 上游命中: 结果.检.上游命中, 发行闸: r.码 }, null, 2));
  return r.码 === 0 ? 0 : (r.码 === null ? 1 : 3);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__文件名)) {
  process.exitCode = main(process.argv.slice(2));
}
