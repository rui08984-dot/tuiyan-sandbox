'use strict';
/**
 * backfill-base-rate.test.cjs —— 老行 evidence.baseRate 物化回填（零翻转安全集）。
 * 场景（临时库，构造四类 evidence）：
 *   id=1 安全行（注记「占 48.7%」，三读序一致）      → 应物化
 *   id=2 L2 真翻转行（「组合数理论值 0.1818（6/33 与 8/16…）」L2 取 6/33=0.1818 vs 结构化 0.1818? 见下）→ 不物化（L2 不一致）
 *   id=3 G2 浮点差行（「占 48.7%」无，用一个能造出 0.487 描述差的口径）
 *   id=4 已有结构化行                                  → 跳过（already structured）
 *   id=5 无注记行                                      → 跳过（nothing）
 * 断言：① dry-run 零写入（库文件逐字节不变）；② --confirm 后仅 id=1 物化；
 *   ③ pureAdd：删掉新 baseRate 键后与写前逐字节等值；④ 写后由 readBaseRate 读出的读数与写前文本读数逐位一致。
 * 铁律：零网络；不碰生产库。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'backfill-base-rate.cjs');
const br = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'baseRate'));
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));

function tmp(n) { return path.join(os.tmpdir(), 'p1b-brbf-' + process.pid + '-' + Date.now() + '-' + n); }
const run = (args) => execFileSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' });

// 真实注记（自生产库 verbatim 摘录；口径说明见 .tmp/fixture-notes.json 选举记录）：
// SAFE＝三读序逐位一致（L2 pct_share_n / G2 pct_share / L5 empirical_pct，p 均 0.01）
const NOTE_SAFE = '气候基率：上海 2015-2024 共 300 个 9 月日，max>35°C 占 1.0%（Open-Meteo archive 实抓，严格大于口径）';
// UNSAFE（G2 浮点差）：L2 取 r6=0.487，G2 不取整=0.48700000000000004 ⇒ 物化会改 G2 读数
const NOTE_G2_UNSAFE = '历史回填·上海 03月：2015-2023 同月共 279 个历史日值（pre-cutoff 窗，同批阈值=同月中位数），max>15°C 占 48.7%（Open-Meteo archive 实抓，严格大于口径）';
// UNSAFE（L2 真翻转）：L2 分数序取 6/33=0.181818，而认证读序取「组合数理论值」=0.5
const NOTE_L2_FLIP = '前瞻·L5 认证随机：基率=组合数理论值 0.5000（6/33 与 8/16，非历史拟合）';

function makeDb(dbPath) {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, evidence_json TEXT)');
  const ins = db.prepare('INSERT INTO predictions (id, evidence_json) VALUES (?,?)');
  ins.run(1, JSON.stringify([{ baseRateNote: NOTE_SAFE }]));
  ins.run(2, JSON.stringify([{ baseRateNote: NOTE_G2_UNSAFE }]));
  ins.run(3, JSON.stringify([{ baseRateNote: NOTE_L2_FLIP }]));
  // id=4：人为标注一个「已结构化」行（应被跳过）
  ins.run(4, JSON.stringify([{ baseRateNote: NOTE_SAFE, baseRate: br.buildBaseRate({ p: 0.01, n: 300, k: 3 }) }]));
  // id=5：无注记
  ins.run(5, JSON.stringify([{ note: 'no base rate here' }]));
  db.close();
}

test('backfill-base-rate：dry-run 零写入 → --confirm 只物化安全集 + pureAdd + 读数零翻转', () => {
  const dbPath = tmp('t.db');
  makeDb(dbPath);
  const before = fs.readFileSync(dbPath);

  // ① dry-run
  const out1 = run(['--db', dbPath]);
  assert.match(out1, /DRY-RUN/, '默认 dry-run');
  assert.ok(Buffer.compare(fs.readFileSync(dbPath), before) === 0, 'dry-run 后库文件逐字节不变');

  // 记录写前读数
  const pre = new Database(dbPath, { readonly: true, fileMustExist: true });
  const preRows = pre.prepare('SELECT id, evidence_json FROM predictions ORDER BY id').all();
  const preRead = {};
  for (const r of preRows) preRead[r.id] = br.readBaseRate(JSON.parse(r.evidence_json)[0]);
  pre.close();

  // ② confirm（--snapshot 指向临时路径：测试不得污染仓库 .run-out/backup/）
  const snapPath = tmp('snap.db');
  const out2 = run(['--db', dbPath, '--confirm', '--snapshot', snapPath]);
  assert.match(out2, /written rows = 1/, '只物化 1 行（id=1）');
  assert.match(out2, /rows to backfill\s+= 1/);
  // 回滚剧本：写前快照可读且为写前态（id=1 无 baseRate 键）
  const snap = new Database(snapPath, { readonly: true, fileMustExist: true });
  assert.equal(snap.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', '快照可读且完好');
  const snapEv1 = JSON.parse(snap.prepare('SELECT evidence_json e FROM predictions WHERE id=1').get().e);
  assert.ok(!snapEv1[0].baseRate, '快照保留写前态（无 baseRate 键）');
  snap.close();

  const post = new Database(dbPath, { readonly: true, fileMustExist: true });
  const postRows = post.prepare('SELECT id, evidence_json FROM predictions ORDER BY id').all();
  const byId = new Map(postRows.map((r) => [r.id, JSON.parse(r.evidence_json)]));

  // ③ 仅 id=1 获得 baseRate 键
  assert.ok(br.isStructured(byId.get(1)[0].baseRate), 'id=1 已物化');
  assert.ok(!byId.get(2)[0].baseRate, 'id=2（G2 浮点差）未物化');
  assert.ok(!byId.get(3)[0].baseRate, 'id=3（L2 真翻转）未物化');
  assert.ok(br.isStructured(byId.get(4)[0].baseRate), 'id=4 本就有结构化（未动）');
  assert.ok(!byId.get(5)[0].baseRate, 'id=5 无注记（未动）');

  // ④ pureAdd：删掉新键后与写前逐字节等值（仅对 id=1）
  const beforeRow1 = preRows.find((r) => r.id === 1).evidence_json;
  const stripped1 = byId.get(1).map((el) => { const c = Object.assign({}, el); delete c.baseRate; return c; });
  assert.equal(JSON.stringify(stripped1), beforeRow1, 'id=1 pureAdd（删键后逐字节等值）');

  // ⑤ 读数零翻转：id=1 的 readBaseRate 前后逐位一致（p/n/k）
  const postRead1 = br.readBaseRate(byId.get(1)[0]);
  assert.equal(postRead1.via, 'structured');
  assert.equal(postRead1.p, preRead[1].p, 'p 零翻转');
  assert.equal(postRead1.n, preRead[1].n, 'n 零翻转');
  assert.equal(postRead1.k, preRead[1].k, 'k 零翻转');
  // id=2 读法不变（仍走文本）
  assert.equal(br.readBaseRate(byId.get(2)[0]).via, 'text', 'id=2 仍走文本兜底');

  assert.equal(post.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  post.close();
});
