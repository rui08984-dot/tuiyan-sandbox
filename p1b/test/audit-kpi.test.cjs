'use strict';
/**
 * p1b/test/audit-kpi.test.cjs —— 审计页 KPI 只读端点（GET /api/audit/g2-kpi）测试。
 * 覆盖：200 形状、合格池/最难档 R4 口径、门域外计数、Brier CI（n<30 留空）、只读零写。
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-auditkpi-' + process.pid + '.json');
let app = null;
const J = (r) => r.json();
test.before(async () => { app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders }); });
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

test('GET /api/audit/g2-kpi：空库 200 + 形状齐全（kpi / layer_brier_ci / layer_gate）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/audit/g2-kpi' });
  assert.equal(r.statusCode, 200);
  const b = J(r);
  assert.equal(b.ok, true);
  assert.ok(Array.isArray(b.layer_brier_ci), 'layer_brier_ci 数组');
  assert.ok(Array.isArray(b.layer_gate), 'layer_gate 数组');
  for (const k of ['qualified_pool', 'hardest', 'out_of_domain', 'out_of_regime', 'unlayered', 'regime_rows', 'tautology_rows']) {
    assert.ok(k in b.kpi, 'kpi.' + k + ' 在');
  }
  assert.ok(!/预测/.test(b.note), 'UI 文案禁「预测」字样');
});

test('R4 口径：合格题入池、最难档 b(1−b)≥0.21、域外行入 out_of_domain', async () => {
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'KPI 测试局', type: 'werewolf', player_count: 6 } });
  const gid = J(g).game.id;
  const conn = db.getConnection();
  const ev = JSON.stringify([{ resolve: { date: '2026-12-01' }, baseRateNote: '基率=0.5' }]);
  conn.prepare("INSERT INTO predictions (game_id, source_type, statement, evidence_json, checklist_hash, g2_regime, layer, created_at, matures_at) VALUES (?,?,?,?,'v2','R4','L2','2026-01-01 00:00:00','2026-12-01')")
    .run(gid, '预测卡', 'KPI 合格题', ev);
  conn.prepare('INSERT INTO predictions (game_id, source_type, statement, layer) VALUES (?,?,?,NULL)').run(gid, '预测卡', 'KPI 域外行');
  const b = J(await app.inject({ method: 'GET', url: '/api/audit/g2-kpi' }));
  assert.ok(b.kpi.qualified_pool >= 1, '合格池 ≥1（cutoff 合规 + 非重言）');
  assert.ok(b.kpi.hardest >= 1, '最难档 ≥1（b=0.5 → b(1−b)=0.25）');
  assert.ok(b.kpi.out_of_domain >= 1, '域外 ≥1');
  assert.ok(b.kpi.unlayered >= 1, '未分层 ≥1');
  assert.ok(b.kpi.regime_rows >= 1, 'R4 行域 ≥1');
  assert.ok(b.layer_gate.some((x) => x.layer === 'L2'), 'layer_gate 含 L2');
});

test('只读零写 + Brier CI 样本不足留空（n<30 → ci null）', async () => {
  const conn = db.getConnection();
  const before = conn.prepare('SELECT COUNT(*) n FROM predictions').get().n;
  const b = J(await app.inject({ method: 'GET', url: '/api/audit/g2-kpi' }));
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM predictions').get().n, before, '端点零写');
  for (const r of b.layer_brier_ci) {
    if (r.n < 30) { assert.equal(r.ci_lo, null, 'n<30 不给 CI'); assert.equal(r.ci_hi, null); }
  }
});
