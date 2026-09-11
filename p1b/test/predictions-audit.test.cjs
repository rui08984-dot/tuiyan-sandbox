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

// ── p15 批次1-M1：tautology 重言标记列（additive 迁移，评审攻击 6 裁定）──────

test('tautology（p15）：新行默认 0；updateTautology 置 1/清 0 读回；非法值与不存在 id', () => {
  const { updateTautology } = require('../src/db/predictionsStore');
  const row = insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '重言标记用例行' });
  assert.equal(row.tautology, 0, 'DEFAULT 0：新行默认 0');
  assert.equal(updateTautology(row.id, 1).tautology, 1, '显式置 1 读回');
  assert.equal(updateTautology(row.id, 0).tautology, 0, '清 0 读回');
  assert.throws(() => updateTautology(row.id, 2), /tautology 必须是 0 或 1/);
  assert.throws(() => updateTautology(row.id, null), /tautology 必须是 0 或 1/);
  assert.equal(updateTautology(999999, 1), null, '不存在 id → null');
});

test('tautology（p15）：旧库 additive 迁移——缺列表 ensure 后补列，旧行 tautology=0', () => {
  const conn = db.getConnection();
  conn.exec('DROP TABLE predictions'); // 模拟迁移前旧库（本用例为文件末尾，drop 不影响其他用例）
  conn.exec([
    'CREATE TABLE predictions (',
    '  id INTEGER PRIMARY KEY,',
    '  game_id INTEGER NOT NULL REFERENCES games(id),',
    '  day INTEGER,',
    "  source_type TEXT NOT NULL CHECK(source_type IN ('验证点','预测卡')),",
    '  statement TEXT NOT NULL,',
    '  assigned_prob REAL CHECK(assigned_prob IS NULL OR (assigned_prob >= 0 AND assigned_prob <= 1)),',
    '  evidence_json TEXT,',
    "  created_at TEXT DEFAULT (datetime('now')),",
    '  resolved_at TEXT,',
    "  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('true','false','ambiguous')),",
    '  resolve_note TEXT,',
    "  layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6')),",
    "  secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')),",
    '  engine TEXT,',
    '  baseline_brier REAL CHECK(baseline_brier IS NULL OR (baseline_brier >= 0 AND baseline_brier <= 1)),',
    '  public_exposure INTEGER CHECK(public_exposure IS NULL OR public_exposure IN (0,1)),',
    '  checklist_hash TEXT,',
    "  gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked'))",
    ');',
  ].join('\n'));
  conn.prepare("INSERT INTO predictions (game_id, source_type, statement) VALUES (1, '预测卡', '迁移前旧行（无 tautology 列）')").run();
  ensurePredictionsTable(conn); // 幂等 ensure 触发 additive 迁移：PRAGMA 检缺 → ALTER ADD tautology
  const cols = conn.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
  assert.ok(cols.indexOf('tautology') !== -1, 'tautology 列已补');
  const oldRow = conn.prepare('SELECT * FROM predictions WHERE statement = ?').get('迁移前旧行（无 tautology 列）');
  assert.equal(oldRow.tautology, 0, '旧行 DEFAULT 0');
  const again = insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '迁移后新行' });
  assert.equal(again.tautology, 0, '迁移后写入链路可用');
});