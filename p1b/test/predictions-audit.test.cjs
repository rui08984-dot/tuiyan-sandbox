'use strict';
/**
 * p1b/test/predictions-audit.test.cjs —— 万物审计器 MVP-A 测试（Q 棒 2026-09-11）。
 * 覆盖：additive 迁移（旧库缺列→ensure 补齐）、INSERT 带/不带审计字段、非法枚举拒收、
 * CHECK 兜底、updateAuditFields 补录/null 清空/空对象幂等/不存在 id、l0Gate 不受影响。
 * 铁律：DB=:memory:；零网络；不起真端口。
 */
const test = require('node:test');
const assert = require('node:assert');

const { db } = require('../src/deps');
const { ensurePredictionsTable, insertPrediction, getPrediction, updateAuditFields,
  l0Gate, LAYERS, GATES } = require('../src/db/predictionsStore');

test.before(() => {
  db.init(':memory:');
  const conn = db.getConnection();
  conn.exec("CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, game_type TEXT NOT NULL, player_count INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
  conn.exec("INSERT INTO games (id, name, game_type, player_count) VALUES (1, '审计测试局', 'werewolf_sim_11p_tuicheng', 11)");
  ensurePredictionsTable(conn);
});

test.after(() => { try { db.closeCurrent(); } catch (e) { /* ignore */ } });

test('七审计列已存在（新库直建即含）', () => {
  const cols = db.getConnection().prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
  for (const c of ['layer', 'secondary_layer', 'engine', 'baseline_brier', 'public_exposure', 'checklist_hash', 'gate']) {
    assert.ok(cols.indexOf(c) !== -1, '缺列 ' + c);
  }
});

test('INSERT 带审计字段 → 读回一致', () => {
  const row = insertPrediction({
    gameId: 1, sourceType: '预测卡', statement: '3号会被投票出局', prob: 0.35,
    layer: 'L6', engine: 'structural', publicExposure: 0, checklistHash: 'v1', gate: 'descriptive',
  });
  assert.equal(row.layer, 'L6');
  assert.equal(row.secondary_layer, null);
  assert.equal(row.engine, 'structural');
  assert.equal(row.baseline_brier, null);
  assert.equal(row.public_exposure, 0);
  assert.equal(row.checklist_hash, 'v1');
  assert.equal(row.gate, 'descriptive');
  assert.equal(row.assigned_prob, 0.35);
});

test('INSERT 不带审计字段 → 七列全 NULL（向后兼容）', () => {
  const row = insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '无审计字段行' });
  for (const k of ['layer', 'secondary_layer', 'engine', 'baseline_brier', 'public_exposure', 'checklist_hash', 'gate']) {
    assert.equal(row[k], null, k + ' 应为 null');
  }
});

test('非法枚举 → insertPrediction 抛错', () => {
  assert.throws(() => insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', layer: 'L9' }), /layer 必须是/);
  assert.throws(() => insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', gate: 'yolo' }), /gate 必须是/);
  assert.throws(() => insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', publicExposure: 2 }), /publicExposure/);
  assert.throws(() => insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', baselineBrier: 1.5 }), /baselineBrier/);
});

test('CHECK 兜底：绕过 store 直插非法 layer 被 SQLite 拒绝', () => {
  const conn = db.getConnection();
  assert.throws(() => conn.prepare("INSERT INTO predictions (game_id, source_type, statement, layer) VALUES (1, '预测卡', '直插', 'L7')").run());
});

test('updateAuditFields：补录 + 显式 null 清空 + 空对象幂等 + 不存在 id', () => {
  const row = insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '补录目标行', prob: 0.5 });
  const u1 = updateAuditFields(row.id, { layer: 'L2', engine: 'stat_baseline', checklistHash: 'v1', gate: 'descriptive' });
  assert.equal(u1.layer, 'L2');
  assert.equal(u1.engine, 'stat_baseline');
  const u2 = updateAuditFields(row.id, { layer: null });
  assert.equal(u2.layer, null);
  assert.equal(u2.engine, 'stat_baseline', '未传字段不得被清空');
  const u3 = updateAuditFields(row.id, {});
  assert.equal(u3.id, row.id);
  assert.equal(u3.engine, 'stat_baseline');
  assert.equal(updateAuditFields(999999, { layer: 'L2' }), null);
  assert.throws(() => updateAuditFields(row.id, { layer: 'X1' }), /layer 必须是/);
});

test('l0Gate 不受审计字段影响（计数含新行，门禁语义不变）', () => {
  const g = l0Gate();
  assert.ok(g.records >= 2, 'records 应含本文件插入的行');
  assert.equal(typeof g.review_unlocked, 'boolean');
  assert.match(g.gate, /只记不评/);
});

test('枚举常量导出（供路由层复用）', () => {
  assert.deepEqual(LAYERS, ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  assert.deepEqual(GATES, ['descriptive', 'scored', 'blocked']);
});