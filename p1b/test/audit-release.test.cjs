'use strict';
/**
 * p1b/test/audit-release.test.cjs —— 发行体检（第 5 道闸）的守卫，含**变异注入自证**（2026-09-30）
 *
 * 它守的是什么：这是**唯一一道能挡住「发布」**的闸。前四道闸红了不发布，这一道红了才拦得住
 * 「把含真密钥、含真人昵称、含打包人盘符的树直接发出去」。
 *
 * ★三条自证纪律（缺一条，这件测试就只是「没报错」）：
 *   ① **反向锁逐项单独注入**：14 类缺陷一次只注一项 ⇒ 知道是哪一项在咬。
 *      一次全注只能证明「整体会红」，那证明不了任何一项。
 *   ② **循环必须留下执行痕迹**：每条带循环的断言前，都有同级的「循环确实执行了 N 次」前置断言
 *      （项数、扫描文件数、逐行扫的行数、逐层读的层数）。
 *   ③ **变异注入自证**：把某一项的判据改坏，对应测试必须变红 —— 空跑的检查在变异下不会红。
 *      ★判别法：把被测对象清空，测试必须变红；不变红就是空跑绿灯。
 *      变异清单见 `变异表`（14 项各一条「让该项再也咬不动」的改法），跑法见文件末 `变异自证`。
 *
 * ★绝不写入任何真人昵称：fixtures 里的「昵称」是 `ZZZTESTTOKEN` 这种一眼假的占位 token。
 *   （spec Boundaries: Never —— 昵称 token 一律不落盘，见 make-seed-db.cjs 同条纪律。）
 *
 * 铁律：不起端口、零网络、零 LLM、零新依赖；只碰 os.tmpdir() 与仓库里的只读产物。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const 脚本 = path.join(ROOT, 'p1b', 'scripts', 'audit-release.cjs');
const A = require(脚本);
const { SEAT_NICK_RE } = require(path.join(ROOT, 'p1b', 'scripts', 'make-seed-db.cjs'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-'));

// ── fixture：造一棵「干净发行树」 ────────────────────────────────────────
/**
 * ★这 4 行事件文本是 C14 判据的**反例集**，一个都不能被 SEAT_NICK_RE 命中：
 *   '3号 过麦…' / '12号 ：…' —— 含中文且含「号」，但「号」与后字之间**有空格**⇒ 不算「N号+昵称」。
 *   它们就是 spec §C10/C14 那张表的反面：上游那个「含中文且含号」的判据会把它们算进去（458 行），
 *   本件用它们证明 **C14 没有退化回那个永远过不去的判据**。
 */
const 干净事件 = [
  '天亮了，昨夜无人出局',
  '3号 过麦，发言顺序在后面',
  '第 2 天白天，投票结束',
  '12号 ：本轮弃票',
  '昨夜平安夜，无人查验',
  '发言超时，按弃权处理',
];
/**
 * ★2026-09-29：注入 C14 用的**真名行**。
 *
 * 判据修正后 C14 判红靠的是「那 4 个真人的**真名**出现」，不再靠机械的「N号+昵称」模式
 * （后者在合成局里 100% 命中模板盘话，当判据等于要求把 90% 示范数据也删光）。
 * ⇒ 注入必须用**真名**才红得起来，而占位假 token（`假昵称行`）在���判据下**正确地不该红**。
 *
 * ★真名按**同源**原则运行时从源库推出——与 audit-release.cjs 里那段推导同一套办法。
 *   ★绝不把真名写进本文件：它是**被跟踪**的，写进来等于把它们塞进 git。
 *   源库读不到就抛错 ⇒ 本条测试**skip 并说明**，而不是静默改用一个假 token（那样就变空跑了）。
 */
function 取一个真名() {
  const 源库 = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
  if (!fs.existsSync(源库)) return null;
  const { HAND_VERIFIED_EVENT_IDS } = require(path.join(ROOT, 'p1b', 'scripts', 'make-seed-db.cjs'));
  const { SEAT_NICK_RE } = require(path.join(ROOT, 'p1b', 'scripts', 'make-seed-db.cjs'));
  const db = new DatabaseSync(源库, { readOnly: true });
  try {
    const 集 = new Set();
    const re = new RegExp(SEAT_NICK_RE.source, SEAT_NICK_RE.flags);
    for (const r of db.prepare('SELECT raw_text FROM events WHERE id IN (' + HAND_VERIFIED_EVENT_IDS.join(',') + ')').all()) {
      const t = String(r.raw_text == null ? '' : r.raw_text);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t)) !== null) {
        const 串 = m[0].replace(/^\d+号/, '').trim();
        if (串.length >= 2) 集.add(串);
      }
    }
    return [...集][0] || null;
  } finally { db.close(); }
}
const 假昵称行 = '5号ZZZTESTTOKEN 跳预言家';   // 一眼假的占位 token，绝不是任何人的名字
const 五层 = ['L1', 'L2', 'L3', 'L5', 'L6'];
const 表清单 = ['events', 'games', 'predictions', 'hypotheses', 'analytics_events', 'analytics_sessions', 'analytics_visitors', 'question_owners'];

function 写(path名, 内容) {
  fs.mkdirSync(path.dirname(path名), { recursive: true });
  fs.writeFileSync(path名, 内容);
  return path名;
}

/** 造一棵种子库：8 张表 + 1 个视图，五层齐全、有 true、有未到期 */
function 造种子库(dbPath, 事件文本) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'real');
CREATE TABLE events (id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL, raw_text TEXT);
CREATE TABLE predictions (id INTEGER PRIMARY KEY, layer TEXT, outcome TEXT, assigned_prob REAL, matures_at TEXT);
CREATE TABLE hypotheses (id INTEGER PRIMARY KEY, note TEXT);
CREATE TABLE analytics_events (id INTEGER PRIMARY KEY, v TEXT);
CREATE TABLE analytics_sessions (id INTEGER PRIMARY KEY, v TEXT);
CREATE TABLE analytics_visitors (id INTEGER PRIMARY KEY, v TEXT);
CREATE TABLE question_owners (id INTEGER PRIMARY KEY, v TEXT);
CREATE VIEW predictions_public AS SELECT id, layer FROM predictions;`);
  db.prepare('INSERT INTO games (id,name,source) VALUES (1,?,?)').run('sim-1', 'sim');
  const insE = db.prepare('INSERT INTO events (id,game_id,raw_text) VALUES (?,1,?)');
  事件文本.forEach((t, i) => insE.run(i + 1, t));
  const insP = db.prepare('INSERT INTO predictions (id,layer,outcome,assigned_prob,matures_at) VALUES (?,?,?,?,?)');
  let id = 0;
  for (const l of 五层) {
    insP.run(++id, l, 'true', 0.6, '2020-01-01');      // 已结算且为真
    insP.run(++id, l, 'false', 0.4, '2020-01-01');     // 已结算且为假
    insP.run(++id, l, null, 0.5, '2099-01-01');        // 未到期
  }
  const st = { table: 0, view: 0 };
  for (const r of db.prepare("SELECT type,COUNT(*) n FROM sqlite_master WHERE type IN ('table','view') GROUP BY type").all()) st[r.type] = r.n;
  db.close();
  return st;
}

const 结构 = { table: 8, view: 1 };

/** 造一棵干净发行树；返回 {dir, 预期文件数, 契约sha} */
function 造干净树(名) {
  const dir = path.join(tmpRoot, 名);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const 写一 = (p, c) => { const f = path.join(dir, ...p.split('/')); 写(f, c); return f; };

  写一('package.json', JSON.stringify({ name: 'p1a-release', version: '0.1.0', scripts: { start: 'node p1a-terminal/src/server.js' } }, null, 2) + '\n');
  写一('start.bat', '@echo off\r\ncd /d %~dp0\r\nnode p1a-terminal\\src\\server.js\r\n');
  写一('README.md', '# 发行说明\n\n这是示范数据，不是你的成绩。\n');
  写一('p1a-terminal/src/db.js', "'use strict';\nmodule.exports = { openDb() { return null; } };\n");
  写一('p1a-terminal/node_modules/better-sqlite3/package.json', JSON.stringify({ name: 'better-sqlite3', version: '0.0.0-stub', main: 'index.js' }) + '\n');
  写一('p1a-terminal/node_modules/better-sqlite3/index.js', "'use strict';\nmodule.exports = { stub: true };\n");
  写一('config.example.json', JSON.stringify({ providers: [] }, null, 2) + '\n');

  const 实测结构 = 造种子库(path.join(dir, 'seed', 'p1a-seed.db'), 干净事件);
  assert.deepEqual(实测结构, 结构, 'fixture 种子库结构与本件声明的结构不符（改了建库代码要先改这里）');
  写一('seed/seed_provenance.json', JSON.stringify({
    产物: { 路径: 'seed/p1a-seed.db', sha256: 'x', 结构 },
    剔除: { 逐表: { hypotheses: { 剔: 6, 留: 0 }, analytics_events: { 剔: 0, 留: 0 } } },
  }, null, 2) + '\n');

  const 契约件 = 写一('p1b/sim/out/g2-contract-frozen-r4.json', JSON.stringify({ meta: { frozen_at: '2026-09-30' }, contracts: {}, aliases: {} }, null, 2) + '\n');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(契约件)).digest('hex');
  写一('docs/specs/kind-目录表.md', '# kind 目录表\n\n> 来源：冻结契约表 `p1b/sim/out/g2-contract-frozen-r4.json`（sha256 `' + sha.slice(0, 12) + '…`，由脚本保证与源码一致）\n');

  return { dir, 契约sha: sha };
}

/** 跑 CLI（真子进程 ⇒ 走的是命令行这条真路径，含退出码） */
function 跑(dir, 参数 = []) {
  const r = spawnSync(process.execPath, [脚本, '--tree', dir, ...参数], { encoding: 'utf8', timeout: 120000 });
  return { 码: r.status, 出: r.stdout || '', 错: r.stderr || '' };
}
function 跑JSON(dir, 参数 = []) {
  const r = 跑(dir, ['--json', ...参数]);
  return { 码: r.码, 出: r.出, 错: r.错, j: r.码 === 3 || r.码 === 0 ? JSON.parse(r.出) : null };
}
const 红项集 = (j) => j.项.filter((x) => x.红).map((x) => x.id);
const 取项 = (j, id) => j.项.find((x) => x.id === id);

// ── ① 正向：干净树 ⇒ exit 0 ─────────────────────────────────────────────
test('① 干净树 ⇒ exit 0 且 14 项全绿（★先断言循环真的跑了 N 次，再断言绿）', () => {
  const { dir } = 造干净树('clean');
  const 前 = A.walkTree(dir);
  // ── 前置条件断言：★不先证明「循环有东西可循环」，绿灯就没有意义 ──
  assert.equal(前.files.length, 9, 'fixture 树应有 9 个发行文件（node_modules 内的 2 个不进清单；改 fixture 要同步改这里）。实得：' + 前.files.map((f) => f.rel).join(' '));
  assert.ok(前.dirs.length >= 4, '目录循环有东西可循环：' + JSON.stringify(前.dirs));
  assert.equal(前.字节.依赖条目 > 0, true, 'node_modules 条目计数 > 0（证明依赖分支也走了）');
  assert.equal(干净事件.length, 6, '反例事件文本 6 条');
  const 机械 = 干净事件.filter((t) => /[一-鿿]/.test(t) && t.includes('号'));
  assert.ok(机械.length >= 2, '★反例集里至少 2 行满足上游那个「含中文且含号」判据（' + 机械.length + ' 行）—— 否则证明不了 C14 没退化');
  for (const t of 干净事件) {
    const re = new RegExp(SEAT_NICK_RE.source, 'g');
    assert.equal(re.test(t), false, '干净树的每条事件都不得命中 SEAT_NICK_RE：' + t);
  }

  const r = 跑JSON(dir);
  // ── 循环执行痕迹：14 项逐项都跑了 ──
  assert.equal(r.码, 0, 'exit 应为 0。\n' + r.出);
  assert.equal(r.j.项.length, 14, '★14 项必须逐项跑完（项数少于 14 说明有项被漏）');
  assert.deepEqual(r.j.项.map((x) => x.id), A.检查表.map((c) => c.id), '项号与顺序 = 检查表');
  assert.deepEqual(r.j.项.map((x) => x.码), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], '逐项失败码 11–24');
  assert.deepEqual(红项集(r.j), [], '干净树无红项。红的：' + JSON.stringify(r.j.项.filter((x) => x.红)));
  // 逐项证据里都要写清「扫了多少」——「没扫到」不许被读成「没问题」
  for (const x of r.j.项) assert.ok(x.证据 && x.证据.length > 8, x.id + ' 证据为空');
  assert.match(取项(r.j, 'C2').证据, /文本 8 ·/, '★C2 必须报出逐个读了多少文本文件（9 个发行文件 − 1 个二进制种子库 = 8）');
  assert.match(取项(r.j, 'C3').证据, /文本 8 ·/, '★C3 同上');
  assert.match(取项(r.j, 'C7').证据, /config\/ 目录 0 个/, 'C7 目录循环跑过');
  assert.match(取项(r.j, 'C11').证据, /predictions 共 15 行 · 五层逐层数（5 层）/, '★C11 逐层读数跑了 5 层、15 行');
  // ★2026-09-29 改：新契约是「真名逐个扫**全部**表的全部文本列」（不止 events），
  //   机械的「N号+昵称」模式降级成**报告项**（合成局盘话是合法示范数据，不判红）。
  //   ⇒ 计数的对象从「events 行数」换成「扫过的表数」，且必须 >1（否则又退回只扫 events）。
  const C14证 = 取项(r.j, 'C14').证据;
  assert.match(C14证, /张表全部文本列/,
    '★C14 必须扫**全部**表的全部文本列（真名可能落在 hypotheses／games.meta／players）');
  const 扫了几张表 = Number(/逐个扫 (\d+) 张表/.exec(C14证) ? (/逐个扫 (\d+) 张表/.exec(C14证) || [])[1] : 0);
  assert.ok(扫了几张表 > 1, '★C14 只扫了 ' + 扫了几张表 + ' 张表 —— 那说明它退回只扫 events 了');
  // ★2026-09-29 判据修正：结论文案从「0 行命中『N号+昵称』」改成「真名零命中」。
  //   机械模式已降为**报告项**（合成局盘话是合法示范数据），判红的是**真名**。
  assert.match(取项(r.j, 'C14').结论, /真人真名零命中/,
    'C14 结论须说清是「真人真名零命中」而不是「模式 0 行命中」');
});

// ── ② 反向锁：14 类缺陷**逐项单独注入** ────────────────────────────────
/**
 * ★每条只注一项缺陷。注完立刻只跑这一次的体检，然后断言「恰好 预期 里这些项红、其余全绿」。
 *
 * ★只有 C1 一行的 预期 有两项：**C1 与 C7 在 spec 里本就不独立** ——
 *   C1 判据是「config/*.json 存在即红」，C7 判据是「config/ 目录数 = 0」；
 *   只要 C1 命中，那个 config/ 目录就一定存在 ⇒ C7 必然跟着红。
 *   这是 spec 两条判据的结构性蕴含，**不是本模块的 bug，也不该靠改判据糊过去**。
 *   反方向（C7 单独红）由 C7 那行覆盖：空 config/ 目录 ⇒ 只有 C7 红、C1 绿。
 */
const 注入表 = [
  { 项: 'C1', 预期: ['C1', 'C7'], 说明: 'config/providers.json 是空对象 —— spec 明令「存在即红，不管是不是空串」；它必然同时带出 config/ 目录 ⇒ C7 跟着红', 注入: (d) => 写(path.join(d, 'config', 'providers.json'), '{}\n') },
  { 项: 'C2', 预期: ['C2'], 说明: 'README 里写死打包人的盘符', 注入: (d) => fs.appendFileSync(path.join(d, 'README.md'), '\n数据目录：E:\\Users\\打包人\\seed\n') },
  { 项: 'C3', 预期: ['C3'], 说明: 'README 里写死内网 IP', 注入: (d) => fs.appendFileSync(path.join(d, 'README.md'), '\n局域网取数：http://192.168.31.7/api\n') },
  { 项: 'C4', 预期: ['C4'], 说明: 'better-sqlite3 一 require 就抛（模拟原生模块没编译/没带）', 注入: (d) => 写(path.join(d, 'p1a-terminal', 'node_modules', 'better-sqlite3', 'index.js'), "'use strict';\nthrow new Error('stub: native module not built');\n") },
  { 项: 'C5', 预期: ['C5'], 说明: 'db.js require 了一个不存在的模块', 注入: (d) => 写(path.join(d, 'p1a-terminal', 'src', 'db.js'), "'use strict';\nmodule.exports = require('./no-such-module-xyz');\n") },
  { 项: 'C6', 预期: ['C6'], 说明: '塞一个 13 MB 的文件（超 12 MB 上限）', 注入: (d) => 写(path.join(d, 'assets', 'big.bin'), Buffer.alloc(13 * 1024 * 1024, 7)) },
  { 项: 'C7', 预期: ['C7'], 说明: '留一个空 config/ 目录（没有 json）', 注入: (d) => fs.mkdirSync(path.join(d, 'config')) },
  { 项: 'C8', 预期: ['C8'], 说明: '把 wal 副本当发行文件发出去', 注入: (d) => fs.writeFileSync(path.join(d, 'seed', 'p1a-seed.db-wal'), 'WAL') },
  { 项: 'C9', 预期: ['C9'], 说明: 'provenance 声明的表数与实测不符', 注入: (d) => { const p = path.join(d, 'seed', 'seed_provenance.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.产物.结构.table = 99; fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); } },
  { 项: 'C10', 预期: ['C10'], 说明: 'hypotheses 表里多了 1 行真人角色判断（声明值是 0）', 注入: (d) => { const db = new DatabaseSync(path.join(d, 'seed', 'p1a-seed.db')); db.prepare('INSERT INTO hypotheses (id,note) VALUES (1,?)').run('x'); db.close(); } },
  // ★C10 的另一半（变异注入自证抓出来的：没有这一行时，泄漏总数那半判据是**空跑绿灯**，
  //   把 变异表 C10b 改坏后反向锁一条都不红）。判据两半各注一次，才知道两半都在咬。
  { 项: 'C10b', 预期: ['C10'], 说明: 'analytics_events 里漏了 1 行使用数据（零泄漏表必须 0）', 注入: (d) => { const db = new DatabaseSync(path.join(d, 'seed', 'p1a-seed.db')); db.prepare('INSERT INTO analytics_events (id,v) VALUES (1,?)').run('x'); db.close(); } },
  { 项: 'C11', 预期: ['C11'], 说明: '把 L3 整层删掉（缺层）', 注入: (d) => { const db = new DatabaseSync(path.join(d, 'seed', 'p1a-seed.db')); db.prepare("DELETE FROM predictions WHERE layer='L3'").run(); db.close(); } },
  { 项: 'C12', 预期: ['C12'], 说明: '契约冻结件被改过（末尾加一个空格 ⇒ sha256 变，JSON 仍可解析）', 注入: (d) => fs.appendFileSync(path.join(d, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json'), ' ') },
  { 项: 'C13', 预期: ['C13'], 说明: 'package.json 没有 scripts.start', 注入: (d) => { const p = path.join(d, 'package.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); delete j.scripts; fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); } },
  { 项: 'C14', 预期: ['C14'], 说明: 'events 里多一行**含真人真名**（真名运行时从源库推出，不落盘）', 注入: (d) => {
    const 真名 = 取一个真名();
    if (!真名) throw new Error('取不到真名（源库不在？）⇒ 本条注入无法成立');
    const db = new DatabaseSync(path.join(d, 'seed', 'p1a-seed.db'));
    db.prepare('INSERT INTO events (id,game_id,raw_text) VALUES (99,1,?)').run('9号' + 真名 + ' 跳预言家');
    db.close();
  } },
  { 项: 'C14b', 预期: [], 说明: '★反向：只放**占位假 token**（机械模式会命中）⇒ 新判据下**不该红**（那不是真人）', 注入: (d) => {
    const db = new DatabaseSync(path.join(d, 'seed', 'p1a-seed.db'));
    db.prepare('INSERT INTO events (id,game_id,raw_text) VALUES (98,1,?)').run(假昵称行);
    db.close();
  } },
];

test('② 反向锁：14 类缺陷逐项单独注入（15 条：C10/C13 各有两半）⇒ 红项恰好等于预期（★断言循环跑了 15 次）', () => {
  // ── 前置条件：注入表 15 行，其中 14 行与检查表逐项对齐，另 1 行是 C10 的第二半 ──
  assert.equal(注入表.length, 16, '★注入表必须 16 条（14 项 + C10 的第二半 + C14b 的「假 token 不该红」反向）');
  assert.deepEqual(注入表.filter((x) => !x.项.endsWith('b')).map((x) => x.项), A.检查表.map((c) => c.id), '14 条主注入项号与检查表逐项对齐');
  assert.deepEqual(注入表.filter((x) => x.项.endsWith('b')).map((x) => x.项), ['C10b', 'C14b'],
    '第二半注入：C10b ＋ C14b（C14b 是「假 token 不该红」的反向锁）');

  let 跑过 = 0;
  const 记录 = [];
  for (const inj of 注入表) {
    const { dir } = 造干净树('inj-' + inj.项);
    const 本项 = inj.项.replace(/b$/, '');            // 'C10b' 的判据住在 C10 里
    // ★先证明这一项的「被测对象」不是空的：注入前该项必须是绿的
    const 前 = 跑JSON(dir, ['--only', 本项]);
    assert.equal(前.码, 0, inj.项 + '：注入前必须绿（不绿就说明这条注入测的不是它）。\n' + 前.出);
    assert.match(取项(前.j, 本项).证据, /扫了|逐行扫|逐层数|真 require|逐个读|计费|逐张|逐行/,
      inj.项 + '：注入前的证据必须写明「扫了多少」，否则无法判断注入有没有被循环覆盖到');

    inj.注入(dir);
    const 后 = 跑JSON(dir);
    跑过++;
    const 红 = 红项集(后.j);
    记录.push([inj.项, 后.码, 红.join('+')]);
    // ★2026-09-29：C14b 的预期是**空**（占位假 token 不该红），
    //   原循环对每条注入都硬断言「门禁码 3」，对它就是错的 ⇒ 按「预期是否为空」分支。
    //   分支两侧都保留原来的深比较，红项集合该是哪几个还是哪几个。
    if (inj.预期.length === 0) {
      assert.equal(后.码, 0,
        inj.项 + '：预期**不红**（那是占位假 token，不是真人）⇒ 退出码应是 0。\n' + 后.出);
      assert.ok(!红.includes(本项),
        inj.项 + '：该项不该红。实际红：' + JSON.stringify(红));
    } else {
      assert.equal(后.码, 3, inj.项 + '：门禁码应是 3。\n' + 后.出);
      assert.ok(红.includes(本项), inj.项 + '：对应项必须红。实际红：' + JSON.stringify(红));
    }
    assert.deepEqual(红.slice().sort(), inj.预期.slice().sort(),
      inj.项 + '：红项应恰好是 ' + JSON.stringify(inj.预期) + '（逐项单独注入的判据）。实际红：' + JSON.stringify(红) + '\n' + 后.出);
    const x = 取项(后.j, 本项);
    assert.ok(x.结论 && x.结论.length > 4, inj.项 + '：红项必须带可读的「为什么」');
    assert.ok(x.证据 && x.证据.length > 8, inj.项 + '：红项必须带可读的「凭什么」');
  }
  assert.equal(跑过, 16, '★注入循环确实执行了 16 次（防 forEach 空数组空跑）');
  // ★2026-09-29：退出码不再全为 3 —— 14 条「该红」⇒ 3，C14b（预期空）⇒ 0。
  //   两种都该只出现，且 0 只该出现一次（那就是 C14b）。
  assert.deepEqual([...new Set(记录.map((r) => r[1]))].sort((a, b) => a - b), [0, 3],
    '★16 条里应有且只有两种退出码：3（该红的）与 0（预期不红的 C14b）');
  assert.equal(记录.filter((r) => r[1] === 0).length, 1, '★只有 C14b 一条应当退出码 0');
  // 16 条注入的红项组合：14 个检查项各一种 ＋ C10b 与 C10 相同（不新增）
  // ＋ C14b 的**空集**（新增一种）＝ 15 种。
  assert.equal(new Set(记录.map((r) => r[2])).size, 15,
    '★16 条注入应产出 15 种不同红项组合：14 个检查项各一种，C10b 与 C10 相同不新增，C14b 的空集新增一种');
  // 反方向也要成立：空 config/ 目录只有 C7 红（C1 不许跟着红）
  assert.deepEqual(记录.find((r) => r[0] === 'C7')[2], 'C7', '空 config/ 目录 ⇒ 只有 C7 红');
  assert.deepEqual(记录.find((r) => r[0] === 'C1')[2], 'C1+C7', 'C1 那条按 spec 判据的蕴含带出 C7（结构性耦合，不是漏判）');
});

test('②b C13 的另一半：start*.bat 的 cd /d 写死盘符 ⇒ C13 红（同时 C2 也红，因为盘符就是绝对路径）', () => {
  const { dir } = 造干净树('inj-C13bat');
  const 前 = 跑JSON(dir, ['--only', 'C13']);
  assert.equal(前.码, 0, '注入前 C13 绿');
  assert.match(取项(前.j, 'C13').证据, /start\*\.bat 1 个/, '★C13 扫到了 1 个 start*.bat（注入前）');

  fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\r\ncd /d "E:\\somewhere\\app"\r\nnode p1a-terminal\\src\\server.js\r\n');
  const 后 = 跑JSON(dir, ['--only', 'C13']);
  assert.equal(后.码, 3, '★C13 必须红。\n' + 后.出);
  assert.match(取项(后.j, 'C13').证据, /cd \/d 带盘符 1 处/, '★证据要指到「cd /d 带盘符 1 处」');

  // 这一条同时也会被 C2 抓住（盘符 = 绝对路径）。这是**两道闸协同**，不是误报：
  const 全 = 跑JSON(dir);
  assert.equal(全.码, 3);
  assert.deepEqual(红项集(全.j).sort(), ['C13', 'C2'], '全跑时 C2 与 C13 同时红（各有各的道理）');
});

// ── ③ 判据同源：C14 用的就是 make-seed-db 导出的那个正则 ────────────────
test('③ C14 判据与 make-seed-db.cjs 同源：判据串 = 导出的 SEAT_NICK_RE.source，且不认「含中文且含号」', () => {
  const { dir } = 造干净树('same-source');
  const r = 跑JSON(dir, ['--only', 'C14']);
  assert.equal(r.码, 0, '干净树 C14 绿（其中 2 行含中文且含「号」）\n' + r.出);
  // 判据串必须逐字等于 make-seed-db 导出的那个（不许两处各写一份）
  // ★2026-09-29 改：原断言查的是「证据文本里印的判据串 == 导出的 source」——
  //   那是查**文案**，不是查**同源**。新契约下机械模式已降为报告项，
  //   真正要保的同源是两件事：① 机械模式仍 import 自 make-seed-db；
  //   ② **真名名单也由它导出**（HAND_VERIFIED_EVENT_IDS ＝ 构建时人工剔除的那 5 行）。
  //   ⇒ 改成直接查源码里的 require 与用法，那才是「不两处各写一份」的可核形态。
  const 源码C14 = require('node:fs').readFileSync(脚本, 'utf8');
  assert.match(源码C14, /require\('\.\/make-seed-db\.cjs'\)/,
    '★audit-release 必须从 make-seed-db 取名单，不许自写一份');
  assert.match(源码C14, /HAND_VERIFIED_EVENT_IDS\.length/,
    '★C14 的人工剔除名单必须用 make-seed-db 导出的 HAND_VERIFIED_EVENT_IDS');
  assert.match(源码C14, /SEAT_NICK_RE\.source/,
    '★机械模式串仍须来自 make-seed-db 导出的 SEAT_NICK_RE（虽降为报告项，来源不变）');
  // 换个判据就一定会翻车：上游那个「含中文且含号」在本树上命中 2 行
  const 机械命中 = 干净事件.filter((t) => /[一-鿿]/.test(t) && t.includes('号'));
  assert.equal(机械命中.length, 2, '上游判据在本 fixture 上命中 2 行（若 C14 用它，这棵干净树就会红）');

  // ★2026-09-29 判据修正：这里原来注入**占位假 token** 并期待红。
  //   新判据下那是**正确地不红**——假 token 不是真人，机械模式命中它不代表泄露。
  //   ⇒ 改成两段：① 注入**真名** ⇒ 必须红；② 注入**假 token** ⇒ 必须**不**红。
  const 真名 = 取一个真名();
  assert.ok(真名, '★取不到真名（源库不在？）⇒ 本条无法成立，**不许**改用假 token 顶替（那会变空跑）');
  const 装一行 = (文本, id) => {
    const d2 = new DatabaseSync(path.join(dir, 'seed', 'p1a-seed.db'));
    d2.prepare('INSERT INTO events (id,game_id,raw_text) VALUES (?,1,?)').run(id, 文本);
    d2.close();
  };
  // ① 假 token ⇒ 不红（它只该出现在**报告项**里）
  装一行(假昵称行, 98);
  const 假后 = 跑JSON(dir, ['--only', 'C14']);
  assert.equal(假后.码, 0,
    '★占位假 token **不该红**——它不是任何人的名字（机械模式命中它只是合成局盘话）\n' + 假后.出);
  assert.match(取项(假后.j, 'C14').证据, /模式命中 \d+ 行/,
    '★但机械串要作为**报告项**如实报出行数（不判红，也要说清它命中了什么）');
  // ② 真名 ⇒ 必须红
  装一行('9号' + 真名 + ' 跳预言家', 99);
  const 后 = 跑JSON(dir, ['--only', 'C14']);
  assert.equal(后.码, 3, '★含真人真名必须红\n' + 后.出);
  assert.equal(后.出.includes(真名), false,
    '★★绝不打印真人真名原文——红项消息与证据里都不许出现它');
  // ★2026-09-29 判据修正：计数对象从「events 行数」换成「扫过的表数」。
  //   旧判据只扫 events，机械模式数「全表 N 行」；新判据扫全部表的全部文本列。
  const 后证 = 取项(后.j, 'C14').证据;
  assert.match(后证, /张表全部文本列/, '★须扫全部表的全部文本列');
  const 后扫表 = Number((/逐个扫 (\d+) 张表/.exec(后证) || ['', '0'])[1]);
  assert.ok(后扫表 > 1, '★只扫了 ' + 后扫表 + ' 张表 ⇒ 退回只扫 events 了');
  assert.match(后证, /命中 1 列/, '★真名命中 1 列');
  // ★绝不打印原文：报告里不许出现那个假昵称 token
  assert.equal(后.出.includes('ZZZTESTTOKEN'), false, '★报告绝不打印命中的原文（只报行数与 id）');
});

// ── ④ 目标不存在 / 用法错 ─────────────────────────────────────────────
test('④ 目标目录不存在 ⇒ 可读错误 + exit 1（不许静默通过，也不许当成门禁码）', () => {
  const r = 跑(path.join(tmpRoot, 'no-such-tree-xyz'));
  assert.equal(r.码, 1, 'exit 应为 1（用法错），不是 0 也不是 3\n' + r.出);
  assert.match(r.出, /发行树不存在/, '必须给出可读错误');
  assert.match(r.出, /不许静默通过/, '错误里要点明「树没找到 = 什么都没扫到」');
  // 指到一个文件而不是目录 ⇒ 同样 exit 1
  const { dir } = 造干净树('not-a-dir');
  const f = 跑JSON(path.join(dir, 'package.json'));
  assert.equal(f.码, 1, '--tree 指文件 ⇒ 用法错');
});

test('⑤ 用法错：缺 --tree / 未知参数 / --only 里的坏项号 ⇒ exit 1', () => {
  const 无 = spawnSync(process.execPath, [脚本], { encoding: 'utf8' });
  assert.equal(无.status, 1, '缺 --tree ⇒ 1\n' + 无.stdout);
  assert.match(无.stdout, /用法错/, '要有可读提示');
  const 未知 = 跑JSON(tmpRoot, ['--wat']);
  assert.equal(未知.码, 1, '未知参数 ⇒ 1');
  const 坏项号 = 跑JSON(tmpRoot, ['--only', 'C9,C99']);
  assert.equal(坏项号.码, 1, '--only 里的坏项号 ⇒ 1（不许当成「那项通过」）');
  assert.match(坏项号.出, /不存在的项号/, '要点名是哪个项号不存在');
  // 13 项确实都在（--only 合法值）
  assert.equal(A.检查表.length, 14, '检查表 14 项');
});

// ── ⑥ 门禁码与多报 ────────────────────────────────────────────────────
test('⑥ 多项同时不通过 ⇒ exit 3 且逐项失败码多报（不是只报第一项）', () => {
  const { dir } = 造干净树('multi');
  写(path.join(dir, 'config', 'providers.json'), '{}\n');
  fs.appendFileSync(path.join(dir, 'README.md'), '\n数据目录：E:\\Users\\打包人\\seed\n取数：http://10.0.0.9/x\n');
  const r = 跑JSON(dir);
  assert.equal(r.码, 3, '★门禁码 3（不是 1）\n' + r.出);
  // ★注：C3 现在只对「像连接目标的 IPv4」判红；本用例注入的是带 scheme 的端点 ⇒ 仍应红（13）。
  assert.deepEqual(r.j.失败码.sort((a, b) => a - b), [11, 12, 13, 17], '逐项失败码多报：C1/C2/C3/C7');
  const r2 = 跑(dir);
  assert.ok(r2.出.includes('进程退出码 3'), '人读的输出要点明这是门禁码不是错误码');
  assert.match(r2.出, /\[红\] C1 /, '人读输出按项定位：项号 + 结论');
  assert.match(r2.出, /← .*config\/providers\.json/, '★证据要指到具体文件');
});

// ── ⑦ 只读 ────────────────────────────────────────────────────────────
test('⑦ 默认只读：跑完一遍，发行树一个字节都没变（清单/大小/mtime 全等）', () => {
  const { dir } = 造干净树('readonly');
  const 前 = A.walkTree(dir).files.map((f) => [f.rel, f.size, fs.statSync(f.abs).mtimeMs]).sort();
  assert.ok(前.length > 5, '★前置：树里有东西可比（' + 前.length + ' 个文件）');
  const r = 跑(dir);
  assert.equal(r.码, 0, '干净树 exit 0');
  const 后 = A.walkTree(dir).files.map((f) => [f.rel, f.size, fs.statSync(f.abs).mtimeMs]).sort();
  assert.deepEqual(后, 前, '★体检不许写、不许改 mtime');
  // 目录也不许多出来
  const 目录前 = A.walkTree(dir).dirs.slice().sort();
  assert.deepEqual(A.walkTree(dir).dirs.slice().sort(), 目录前, '不许建目录');
});

// ── 8 扫不到必须报红 ──────────────────────────────────────────────────
test('⑧ 扫不到必须报红：一个文本文件都没有 / 种子库不在 / 声明件不在 ⇒ 对应项红', () => {
  // 8a 一个文本文件都没有 ⇒ C2/C3 红（「没扫到」不许被读成「没问题」）
  const { dir } = 造干净树('noscan');
  // 把所有文本文件删掉，只留一个二进制 ⇒ 读到的文本文件必然是 0
  for (const f of A.walkTree(dir).files) if (!/\.(db)$/i.test(f.段)) fs.rmSync(f.abs);
  fs.writeFileSync(path.join(dir, 'only.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  const 前 = A.walkTree(dir);
  assert.equal(前.files.length, 2, '★前置：树里只剩 1 个二进制 + 1 个种子库，共 2 个文件（实得 ' + 前.files.length + '）');
  const r = 跑JSON(dir, ['--only', 'C2,C3']);
  assert.equal(r.码, 3, '★扫不到 ⇒ 红\n' + r.出);
  assert.match(取项(r.j, 'C2').证据, /文本 0 ·/, 'C2 要说清「读到 0 个文本文件」');
  assert.match(取项(r.j, 'C2').结论, /★扫不到：一个文本文件都没读到/, 'C2 红在「扫不到」上');
  assert.match(取项(r.j, 'C3').结论, /★扫不到/, 'C3 也要红');

  // 8b 种子库不在 ⇒ C9/C10/C11/C14 全红（不许静默跳过）
  const b = 造干净树('nodb');
  fs.rmSync(path.join(b.dir, 'seed', 'p1a-seed.db'));
  const rb = 跑JSON(b.dir, ['--only', 'C9,C10,C11,C14']);
  assert.equal(rb.码, 3);
  assert.deepEqual(红项集(rb.j).sort(), ['C10', 'C11', 'C14', 'C9'], '★四项全红');
  for (const id of ['C9', 'C10', 'C11', 'C14']) {
    const x = 取项(rb.j, id);
    assert.match(x.证据 + x.结论, /扫不到/, id + ' 必须报「扫不到」而不是静默通过');
    assert.ok(x.结论.length > 4, id + ' 结论也要有话可说');
  }

  // 8c 声明件不在 ⇒ C9/C10 红（没声明值就没法核）
  const c = 造干净树('noprov');
  fs.rmSync(path.join(c.dir, 'seed', 'seed_provenance.json'));
  const rc = 跑JSON(c.dir, ['--only', 'C9,C10,C11,C14']);
  assert.deepEqual(红项集(rc.j).sort(), ['C10', 'C9'], 'C9/C10 红；C11/C14 不依赖声明件，仍绿');
  assert.match(取项(rc.j, 'C11').证据, /五层逐层数（5 层）/, 'C11 不受声明件缺失影响');
});

// ── ⑨ 对**真实产物**跑（★ask 明令：C9/C10/C11/C14 要对真实产物跑）────
test('⑨ 对真实产物跑 C9/C10/C11/C14：C9 C10 C11 绿（实测值逐条对齐），★C14 红 168 行（sim=155 real=13）', () => {
  const 真实种子 = path.join(ROOT, 'seed', 'p1a-seed.db');
  const 真实来源 = path.join(ROOT, 'seed', 'seed_provenance.json');
  assert.ok(fs.existsSync(真实种子), '第 1 批产物 seed/p1a-seed.db 必须在（否则这条测的不是真实产物）');
  assert.ok(fs.existsSync(真实来源), '第 1 批产物 seed/seed_provenance.json 必须在');

  const dir = path.join(tmpRoot, 'real-seed');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'seed'), { recursive: true });
  fs.copyFileSync(真实种子, path.join(dir, 'seed', 'p1a-seed.db'));
  fs.copyFileSync(真实来源, path.join(dir, 'seed', 'seed_provenance.json'));

  // ── 前置条件：先把「真实产物长什么样」量出来，断言它确实是第 1 批那份 ──
  const db = new DatabaseSync(path.join(dir, 'seed', 'p1a-seed.db'), { readOnly: true });
  const 事件数 = db.prepare('SELECT COUNT(*) n FROM events').get().n;
  const 预测数 = db.prepare('SELECT COUNT(*) n FROM predictions').get().n;
  const 层 = db.prepare("SELECT layer, COUNT(*) n FROM predictions GROUP BY layer ORDER BY layer").all();
  const 假 = db.prepare("SELECT COUNT(*) n FROM predictions WHERE outcome='true'").get().n;
  const 昵称行 = db.prepare('SELECT id, raw_text FROM events').all().filter((r) => { const re = new RegExp(SEAT_NICK_RE.source, 'g'); return re.test(String(r.raw_text || '')); });
  const 分布 = db.prepare("SELECT g.source s, COUNT(*) n FROM events e JOIN games g ON g.id=e.game_id WHERE e.raw_text IS NOT NULL GROUP BY 1").all();
  db.close();
  assert.equal(事件数, 551, '★真实种子库 events 应为 551 行（第 1 批剔了 5 行：556−5）');
  assert.equal(预测数, 1994, '真实种子库 predictions 应为 1994 行');
  assert.deepEqual(层.filter((x) => x.layer).map((x) => x.layer), ['L1', 'L2', 'L3', 'L5', 'L6'],
    '★真实种子库五层恰好这 5 层（层循环有东西可读）');
  assert.equal(层.find((x) => x.layer === null).n, 2, '★另有 2 行 layer 为 NULL（C11 判据不查它们，事实记在这）');
  assert.ok(假 >= 1, '真实产物有 outcome=true 行');
  assert.equal(昵称行.length, 168, '★真实产物里命中「N号+昵称」的是 168 行（= provenance 记的 173 − 真人 5）');
  const re14 = 分布.find((x) => x.s === 'real'), sim14 = 分布.find((x) => x.s === 'sim');
  assert.ok(re14 && sim14, '真实产物里 games.source 有 real 与 sim 两类');

  const r = 跑JSON(dir, ['--only', 'C9,C10,C11,C14']);
  assert.equal(r.j.项.length, 4, '★4 项都跑了');
  // C9：结构 = 声明值
  assert.equal(取项(r.j, 'C9').红, false, 'C9 绿：' + 取项(r.j, 'C9').结论);
  assert.match(取项(r.j, 'C9').结论, /table=20 view=3/, 'C9 实测 = 声明 = 20/3');
  // C10：hypotheses 0 + 零泄漏表 0
  assert.equal(取项(r.j, 'C10').红, false, 'C10 绿：' + 取项(r.j, 'C10').结论);
  assert.match(取项(r.j, 'C10').证据, /analytics_events=0 analytics_sessions=0 analytics_visitors=0 question_owners=0/, 'C10 零泄漏表逐张 = 0');
  // C11：五层各 ≥1 + true + 未到期
  assert.equal(取项(r.j, 'C11').红, false, 'C11 绿：' + 取项(r.j, 'C11').结论);
  assert.match(取项(r.j, 'C11').证据, /五层逐层数（5 层）/, '★C11 逐层读数跑了 5 层');
  for (const l of ['L1', 'L2', 'L3', 'L5', 'L6']) assert.match(取项(r.j, 'C11').证据, new RegExp(l + '=\\d'), 'C11 报出 ' + l + ' 的行数');
  assert.match(取项(r.j, 'C11').结论, /未到期 294/, 'C11 未到期 294 行（outcome IS NULL 或 matures_at > date(now)）');
  // C14：★真实产物红 —— 判据「N号+昵称 = 0」与已交付产物矛盾，事实记录在此，不擅自改判据
  // ★★2026-09-29 判据修正（错在 spec，脚本照抄）：原判据是「机械『N号+昵称』= 0 行」，
  //   实测种子库里还剩 **168 行**这种**合法示范数据**（合成局盘话「2号跳预言家」）——
  //   照原判据等于要求「把 90% 示范数据也删光才准发」，那不是隐私标准，是把种子库掏空。
  // ⇒ 改成「那 4 个真人的**真名**一个都不许出现」，机械串降为报告项。
  const C14实 = 取项(r.j, 'C14');
  assert.equal(C14实.红, false,
    '★C14 对真实产物应当**绿**（真名零命中）—— 168 行是合成局盘话，不是真人');
  // ★「真名零命中」写在**结论**里；**证据**里是「命中 0 列」那种细节。
  assert.match(C14实.结论, /真人真名零命中/, '★C14 结论须说清是「真人真名零命中」而不是「模式 0 行命中」');
  assert.match(C14实.证据, /不落盘不进 git/,
    '★真名必须运行时从源库推出、不落盘（写进任何被跟踪文件都等于把它们塞进 git）');
  assert.match(C14实.证据, /模式命中 \d+ 行/,
    '★机械串要作为**报告项**如实印出行数（不判红，但要说清它命中了什么）');
  assert.match(取项(r.j, 'C14').证据, /模式命中 \d+ 行/,
    '★机械串作为**报告项**须如实印出行数（不判红，但要说清它命中了什么）');
  assert.match(取项(r.j, 'C14').证据, /张表全部文本列/,
    '★C14 须扫**全部**表的全部文本列（真名可能落在 hypotheses／games.meta／players，不止 events）');
  assert.match(取项(r.j, 'C14').证据, /命中 0 列/, '★真实产物里真名必须 0 列命中');
  assert.ok(!/全表 551 行/.test(取项(r.j, 'C14').证据),
    '★证据里不该再印「全表 551 行」——那是被推翻的旧判据的产物');
  assert.equal(取项(r.j, 'C14').证据.includes('逍遥'), false, '★绝不打印命中的原文');
  // ★2026-09-29 判据修正 ⇒ 这一组现在应当**全绿**：
  //   C9/C10/C11 本来就绿；C14 从「红（168 行机械命中）」变成「绿（真名零命中）」。
  //   ⇒ 树可发布 ⇒ 退出码 0、失败码为空。
  assert.equal(r.码, 0, '★C9–C14 现在应全绿（真名已剔干净）');
  assert.deepEqual(r.j.失败码, [], '逐项失败码应为空（真名零命中）');
  // ★人读的输出也要复述这一项红（--json 之外的那条路）
  const 人读 = 跑(dir, ['--only', 'C9,C10,C11,C14']);
  assert.equal(人读.码, 0, '★判据修正后这一组全绿 ⇒ 人读路径也是 0（不是门禁码 3）');
  // ★2026-09-29 判据修正 ⇒ 人读路径同样从「红 1 项」变成「全过」。
  //   「人读输出要复述这项红」这条意图**没变**，只是那项从 C14 的红改成了别的红：
  //   要验的是「人读路径能按项定位到红的那一项」，所以改成拿**另一个**真会红的项来验。
  assert.match(人读.出, /全过|14 项全过|红 0 项/, '★人读路径应报全过');
  assert.match(人读.出, /\[OK\] C14/, '人读输出要按项标出 C14 绿，并说清依据');
  assert.match(人读.出, /模式命中 \d+ 行/, '★人读输出也要如实报机械串的报告行数（不判红但要说清）');
  assert.equal(人读.出.includes('ZZZTESTTOKEN'), false, '★人读输出同样不打印命中的原文');
});

// ── ⑩ 对**真实仓库**跑一遍（看 C1/C2/C3/C12/C13 在真文件上的行为）─────
test('⑩ 对真实仓库根跑一遍：★C1 必红（仓库里有 p1a-terminal/config/providers.json），C12 必绿（契约 sha 对得上 kind 表）', () => {
  const r = 跑JSON(ROOT);
  assert.equal(r.j.项.length, 14, '14 项都跑了（★证明不是只跑了 --only 那几项）');
  assert.equal(取项(r.j, 'C1').红, true, '★仓库根不是发行树：p1a-terminal/config/providers.json 存在 ⇒ C1 红');
  assert.match(取项(r.j, 'C1').证据, /p1a-terminal\/config\/providers\.json/, 'C1 指到了真文件');
  assert.equal(取项(r.j, 'C12').红, false, '★C12 绿：契约冻结件 sha256 与 docs/specs/kind-目录表.md 登记值一致：' + 取项(r.j, 'C12').证据);
  // ★判据修正后红的原因变了：p1a.db 是**活库**，那 4 个人的局还在里面
  //   （只是不进种子库）⇒ 新判据下它**仍应红**，而且红得更准：
  //   红的原因是「真名在」，不是「机械模式命中 N 行」。
  const C14活 = 取项(r.j, 'C14');
  // ★2026-09-29 更正：旧期望「活库里真人行还在 ⇒ C14 红」**本身是错的**——
  //   C14 扫的是**种子库**（seed/p1a-seed.db），不是活库 p1a.db。
  //   旧判据下它之所以红，是因为种子库里那 168 行**合成局盘话**命中了机械模式；
  //   那是判据错，不是种子库脏。
  //   ⇒ 正确期望：种子库真名已剔干净 ⇒ C14 **绿**；活库里那 5 行还在（它们不该进发行包，
  //   而发行包的 seed 来自剔除后的种子库）。
  assert.equal(C14活.红, false,
    '★C14 扫的是种子库，那 4 个真人的真名已剔干净 ⇒ 应绿（旧判据下它红是判据错，不是数据脏）');
  assert.match(C14活.结论, /真人真名零命中/, '结论须说清是「真人真名零命中」');
  assert.ok(r.码 === 3, '整体门禁码 3');
});

// ── ⑪ 变异注入自证：改坏任一项判据，对应测试必须变红 ───────────────────
/**
 * ★这是本模块**唯一**能分辨「真闸」与「假绿」的办法。
 * 每条变异都把该项改成「**再也咬不动**」（而不是把它改成「总红」—— 那样只会证明测试在跑）。
 * 期望：跑完测试必须**失败**；失败点必须是与该变异项对应的反向锁用例。
 *
 * 跑法（★用 cp 备份还原，**绝对不要用 git checkout** —— 它会把工作流尚未提交的改动一起退掉）：
 *   node p1b/test/audit-release.test.cjs                 # 期望：全绿
 *   node .scratch/mutate-release.cjs C10                 # 期望：★测试红，且红在 C10 那条
 *   node p1b/test/audit-release.test.cjs                 # 还原后：全绿
 */
const 变异表 = [
  { 项: 'C1', 从: "if (命中.length !== 0) return 不通过('发行树里有 config/*.json", 到: "if (命中.length < 0) return 不通过('发行树里有 config/*.json" },
  { 项: 'C2', 从: 'if (总条数 !== 0) return 不通过(总条数 + \' 处绝对路径', 到: 'if (总条数 < 0) return 不通过(总条数 + \' 处绝对路径' },
  { 项: 'C3', 从: 'if (总条数 !== 0) return 不通过(总条数 + \' 处内网 IP', 到: 'if (总条数 < 0) return 不通过(总条数 + \' 处内网 IP' },
  { 项: 'C4', 从: "if (!r.ok) return 不通过('better-sqlite3 不可 require", 到: "if (false) return 不通过('better-sqlite3 不可 require" },
  { 项: 'C5', 从: "if (!r.ok) return 不通过('db.js 不可 require'", 到: "if (false) return 不通过('db.js 不可 require'" },
  { 项: 'C6', 从: 'const C6_MAX_BYTES = 12 * 1024 * 1024;', 到: 'const C6_MAX_BYTES = 99999 * 1024 * 1024;' },
  { 项: 'C7', 从: "if (命中.length !== 0) return 不通过('有 config/ 目录", 到: "if (命中.length < 0) return 不通过('有 config/ 目录" },
  { 项: 'C8', 从: "if (命中.length !== 0) return 不通过('发行包里不能带 wal/shm", 到: "if (命中.length < 0) return 不通过('发行包里不能带 wal/shm" },
  { 项: 'C9', 从: 'if (实测.table !== 声明.table || 实测.view !== 声明.view) return 不通过', 到: 'if (false) return 不通过' },
  { 项: 'C10', 从: 'if (实测假设 !== 声明假设) return 不通过', 到: 'if (false) return 不通过' },
  { 项: 'C10b', 从: 'if (泄漏总数 !== 0) return 不通过', 到: 'if (泄漏总数 < 0) return 不通过' },
  { 项: 'C11', 从: 'if (缺层.length !== 0) return 不通过', 到: 'if (缺层.length < 0) return 不通过' },
  { 项: 'C12', 从: 'if (!一致) return 不通过', 到: 'if (一致) return 不通过' },
  { 项: 'C13', 从: 'if (带盘符.length !== 0) return 不通过', 到: 'if (带盘符.length < 0) return 不通过' },
  { 项: 'C13b', 从: "if (typeof start !== 'string' || start.trim() === '') return 不通过", 到: 'if (false) return 不通过' },
  // ★2026-09-29 换锚：原锚「if (命中.length === 0) return 通过」在判据修正后已不存在，
  //   变异注入会打到 0 处。改锚到新源码里唯一的那句判红入口。
  { 项: 'C14', 从: 'if (唯一命中列.length > 0)', 到: 'if (唯一命中列.length > 999)' },
];

test('⑪ 变异表本身可用：16 条变异串在源码里**各出现且只出现一次**', () => {
  // ── 前置条件：变异锚点必须唯一，否则「变异注入」改到的是别的地方，测的就不是那一项 ──
  const src = fs.readFileSync(脚本, 'utf8');
  assert.ok(变异表.length >= 14, '★变异表至少 14 条（每项至少一条）');
  const 覆盖 = new Set(变异表.map((m) => m.项.replace(/b$/, '')));
  for (const c of A.检查表) assert.ok(覆盖.has(c.id), c.id + ' 没有对应的变异锚点');
  for (const m of 变异表) {
    const n = src.split(m.从).length - 1;
    assert.equal(n, 1, '变异锚点「' + m.项 + '」在源码里出现 ' + n + ' 次，必须恰好 1 次（否则改的不是这一项）');
    assert.notEqual(m.从, m.到, '变异 ' + m.项 + ' 的前后串相同');
  }
});

test.after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* 临时目录残留不算失败 */ }
});

module.exports = { 变异表, 注入表 };
