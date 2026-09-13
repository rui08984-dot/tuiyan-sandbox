'use strict';
/**
 * p1b/test/f4-surfaces.test.cjs —— 合并迁移（F4 第一阶段 + D-8.1 入账）单元护栏。
 * 覆盖：角色表（契约级）/ truth_vault 形状 / predictions_public 不泄露真值 /
 *       truth_vault 与 predictions 真值列对账一致 / layer=unknown 可写入。
 * 铁律：DB=:memory:；零网络；不起真端口；零碰生产库。
 */
const test = require('node:test');
const assert = require('node:assert');

const { db } = require('../src/deps');
const { ensurePredictionsTable, insertPrediction, resolvePrediction } = require('../src/db/predictionsStore');
const { ensureF4Surfaces, PROCESS_ROLE_SEEDS } = require('../src/db/intakeStore');

test.before(() => {
  db.init(':memory:');
  const conn = db.getConnection();
  conn.exec("CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, game_type TEXT NOT NULL, player_count INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
  conn.exec("INSERT INTO games (id, name, game_type, player_count) VALUES (1, 'F4 测试局', 'werewolf', 6)");
  ensurePredictionsTable(conn);
  ensureF4Surfaces(conn);
});

test.after(() => { try { db.closeCurrent(); } catch (e) { /* ignore */ } });

/** 真值对账（与 scripts/merged-migration.cjs reconcileTruthVault 同口径）。 */
function reconcile(conn) {
  return {
    total: conn.prepare('SELECT COUNT(*) n FROM predictions').get().n,
    vault: conn.prepare('SELECT COUNT(*) n FROM truth_vault').get().n,
    missing: conn.prepare('SELECT COUNT(*) n FROM predictions p LEFT JOIN truth_vault t ON t.prediction_id=p.id WHERE t.prediction_id IS NULL').get().n,
    orphan: conn.prepare('SELECT COUNT(*) n FROM truth_vault t LEFT JOIN predictions p ON p.id=t.prediction_id WHERE p.id IS NULL').get().n,
    diff: conn.prepare("SELECT COUNT(*) n FROM predictions p JOIN truth_vault t ON t.prediction_id=p.id"
      + " WHERE IFNULL(t.outcome,'∅')<>IFNULL(p.outcome,'∅') OR IFNULL(t.resolved_at,'∅')<>IFNULL(p.resolved_at,'∅')"
      + " OR IFNULL(t.resolve_note,'∅')<>IFNULL(p.resolve_note,'∅')").get().n,
  };
}

test('角色表（G-D2-0 ①）：四个角色齐备且 enforcement 全为 contract（无内核级角色）', () => {
  const conn = db.getConnection();
  const roles = conn.prepare('SELECT role,enforcement FROM process_roles ORDER BY role').all();
  assert.deepEqual(roles.map((r) => r.role), ['backtest', 'participant', 'resolver', 'scorer']);
  assert.ok(roles.every((r) => r.enforcement === 'contract'), 'SQLite 单库无内核级角色：一律 contract');
  const kernel = conn.prepare("SELECT COUNT(*) n FROM process_roles WHERE enforcement='kernel'").get().n;
  assert.equal(kernel, 0, '不得把契约级隔离标成内核级');
  const bt = conn.prepare("SELECT forbidden FROM process_roles WHERE role='backtest'").get();
  assert.ok(JSON.parse(bt.forbidden).indexOf('truth_vault') !== -1, '回测角色须显式禁真值表');
  assert.ok(PROCESS_ROLE_SEEDS.length === 4);
});

test('truth_vault 表形状 = 任务书六列，prediction_id 为主键', () => {
  const conn = db.getConnection();
  const cols = conn.prepare('PRAGMA table_info(truth_vault)').all();
  assert.deepEqual(cols.map((c) => c.name), ['prediction_id', 'outcome', 'resolved_at', 'resolve_note', 'created_at', 'source']);
  assert.equal(cols[0].pk, 1);
});

test('predictions_public（G-D2-0 ②）：列集不含真值列，且不透传 evidence_json / truth_preview', () => {
  const conn = db.getConnection();
  const cols = conn.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
  for (const bad of ['outcome', 'resolved_at', 'resolve_note', 'evidence_json']) {
    assert.equal(cols.indexOf(bad), -1, '题面视图不得含真值列: ' + bad);
  }
  for (const need of ['statement', 'layer', 'gate', 'engine', 'cutoff_at', 'resolve_spec']) {
    assert.ok(cols.indexOf(need) !== -1, '题面视图缺列: ' + need);
  }
  const ev = JSON.stringify([{ resolve: { kind: 'x', date: '2026-01-01' }, cutoff: '2026-01-01T00:00:00+08:00',
    truth_preview: { outcome: 'true', secret: '真值预览' }, meta: { cutoff: '2025-12-31T00:00:00+08:00' } }]);
  conn.prepare("INSERT INTO predictions (game_id, source_type, statement, evidence_json) VALUES (1,'预测卡','F4 视图泄漏探针（题面）', ?)").run(ev);
  const row = conn.prepare("SELECT * FROM predictions_public WHERE statement='F4 视图泄漏探针（题面）'").get();
  assert.ok(row, '视图能读到该题面');
  assert.equal(row.truth_preview, undefined, '不得出现 truth_preview 列');
  assert.equal(String(row.cutoff_at), '2026-01-01T00:00:00+08:00', 'cutoff 取 evidence_json[0].cutoff');
  assert.ok(String(row.resolve_spec).indexOf('"kind":"x"') !== -1, '判据 resolve 可读');
  assert.equal(JSON.stringify(row).indexOf('truth_preview'), -1, '视图输出全文不得含 truth_preview 字样');
  assert.equal(JSON.stringify(row).indexOf('真值预览'), -1, '视图输出不得含真值预览内容');
});

test('D-8.1 入账：layer=unknown 可写入 predictions；非法层 L7 与 secondary=unknown 仍被拒', () => {
  const conn = db.getConnection();
  const row = insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'D-8.1 unknown 入账用例', layer: 'unknown' });
  assert.equal(row.layer, 'unknown', 'unknown 必须可入账（phase2 放开 layer CHECK）');
  const back = conn.prepare('SELECT layer FROM predictions WHERE id=?').get(row.id);
  assert.equal(back.layer, 'unknown', '库内读回一致');
  assert.throws(() => insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', secondaryLayer: 'unknown' }), /secondaryLayer 枚举错/,
    'secondary=unknown 仍拒（unknown 作 secondary 无信息量，用 NULL 表达）');
  assert.throws(() => conn.prepare("INSERT INTO predictions (game_id, source_type, statement, layer) VALUES (1,'预测卡','直插','L7')").run(),
    /CHECK constraint failed/, 'L7 仍须被 CHECK 拒（放开只针对 unknown）');
  assert.throws(() => conn.prepare("INSERT INTO predictions (game_id, source_type, statement, secondary_layer) VALUES (1,'预测卡','直插 sec','unknown')").run(),
    /CHECK constraint failed/, 'secondary_layer 的 CHECK 未放开');
});

test('truth_vault 对账一致：全量镜像后 missing=0 / orphan=0 / 真值列 diff=0', () => {
  const conn = db.getConnection();
  insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'F4 对账用例 A' });
  const b = insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'F4 对账用例 B' });
  assert.equal(resolvePrediction(b.id, 'false', '对账用例结算').ok, true);
  conn.prepare('INSERT INTO truth_vault (prediction_id,outcome,resolved_at,resolve_note,source)'
    + " SELECT id,outcome,resolved_at,resolve_note,'predictions' FROM predictions"
    + ' WHERE id NOT IN (SELECT prediction_id FROM truth_vault)').run();
  const r = reconcile(conn);
  assert.equal(r.vault, r.total, 'vault 行数 = predictions 行数');
  assert.equal(r.missing, 0, '无未镜像行');
  assert.equal(r.orphan, 0, '无孤儿真值行');
  assert.equal(r.diff, 0, 'outcome/resolved_at/resolve_note 逐行相等');
  const mirrored = conn.prepare('SELECT outcome,resolved_at FROM truth_vault WHERE prediction_id=?').get(b.id);
  assert.equal(mirrored.outcome, 'false');
  assert.ok(mirrored.resolved_at, 'resolved_at 一并镜像');
});

