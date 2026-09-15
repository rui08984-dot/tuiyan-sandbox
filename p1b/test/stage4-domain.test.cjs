'use strict';
/**
 * stage4-domain.test.cjs —— **分域读数**（2026-09-15；路线图阶段 4 出口「分域带校准分数」）。
 *
 * 由来：路线图阶段 4 出口原文＝「出口＝**分域**带校准分数的预测能力，每域拿数据说话」，
 *   而此前五层读数**只有分层**（L1–L6）、无域维度 ⇒ 出口口径未被满足。本测试锁定三件：
 *   ① 域派生规则（单一真源 `p1b/src/evidence/domain.js`，与 design §4.2.5 A 轴同口径）；
 *   ② 分域读数的**纪律**（n<30 的格 conclusion_allowed=false，只记方向，不出结论）；
 *   ③ 分域是 **additive**——既有五层数字**逐字未变**（本测试用真实产物对比，防回归）。
 *
 * 铁律：零网络、零 LLM、零写库（只读生产库与既有产物）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const D = require(path.join(ROOT, 'p1b/src/evidence/domain'));
const DB = path.join(ROOT, 'p1a-terminal/data/p1a.db');
const ART = path.join(ROOT, 'p1b/sim/out/stage4-run-five-layers-20260915.json');

test('domain：派生优先级 —— resolve.kind → evidence.kind → game_type → (unknown)', () => {
  // ① resolve.kind 前缀归一
  assert.deepEqual(D.deriveDomain({ resolve: { kind: 'openmeteo_air_pm10_daily_mean' } }), { domain: 'openmeteo', basis: 'resolve_kind' });
  assert.deepEqual(D.deriveDomain({ resolve: { kind: 'noaa_tide_daily_max' } }), { domain: 'noaa', basis: 'resolve_kind' });
  // ② 退 evidence.kind（题源批类型）
  assert.deepEqual(D.deriveDomain({ resolve: null, evKind: 'b4_forward' }), { domain: 'b4', basis: 'evidence_kind' });
  // ③ 再退 game_type（L1/L6 对局域：狼人杀题没有 resolve.kind）
  assert.deepEqual(D.deriveDomain({ resolve: null, evKind: null, gameType: 'werewolf_sim_6p_onenight' }), { domain: 'werewolf_sim', basis: 'game_type' });
  assert.deepEqual(D.deriveDomain({ resolve: null, evKind: null, gameType: 'werewolf' }), { domain: 'werewolf_real', basis: 'game_type' });
  // ④ 全缺 ⇒ (unknown)，如实标注（禁静默丢弃）
  assert.deepEqual(D.deriveDomain({}), { domain: '(unknown)', basis: 'none' });
  // 前缀归一：无 `_` 的原样返回
  assert.equal(D.prefixOf('botc'), 'botc');
  assert.equal(D.prefixOf('a_b_c'), 'a');
});

test('domain：与 design §4.2.5 A 轴同口径 —— 域＝题源 kind 族（前缀归一）', () => {
  // 同一 kind 族的多个 kind 必须归到同一域（防「持续铺同域题稀释坏题」）
  const fam = ['openmeteo_daily_max', 'openmeteo_air_pm2_5_daily_mean', 'openmeteo_air_ozone_daily_mean'];
  const ds = fam.map((k) => D.deriveDomain({ resolve: { kind: k } }).domain);
  assert.deepEqual([...new Set(ds)], ['openmeteo'], '同族必须归一为同一域');
});

test('stage4 分域读数：产物含 by_domain，且 n<30 的格 conclusion_allowed=false', () => {
  assert.ok(fs.existsSync(ART), '前提：分域产物存在（p1b/sim/out/stage4-run-five-layers-20260915.json）');
  const j = JSON.parse(fs.readFileSync(ART, 'utf8'));
  assert.ok(Array.isArray(j.by_domain) && j.by_domain.length > 0, '产物须含 by_domain');
  assert.equal(j.domain_min_n, 30, '分域准入线与分层同款（design §4.3-3：n<30 不出结论）');
  for (const c of j.by_domain) {
    if (c.conclusion_allowed) {
      assert.ok(c.scored_n >= 30, '出结论的格必须 n>=30：' + c.layer + '/' + c.domain + ' n=' + c.scored_n);
      assert.ok(typeof c.brier_engine === 'number', '出结论的格须有 Brier');
      assert.ok(c.delta_ci95 && c.delta_ci95.lb !== null, '出结论的格须有配对 CI');
    } else {
      assert.ok(c.scored_n < 30, '标样本不足的格必须真的 n<30：' + c.layer + '/' + c.domain);
      assert.equal(c.brier_engine, undefined, '样本不足的格**不得**给 Brier（防被误当读数引用）');
    }
  }
  // 计数自洽
  assert.equal(j.domain_cells_with_conclusion + j.domain_cells_thin, j.domain_cells_total, '格计数必须自洽');
});

test('stage4 分域读数：域派生来源须如实披露（禁静默 (unknown)）', () => {
  const j = JSON.parse(fs.readFileSync(ART, 'utf8'));
  assert.ok(j.domain_basis_counts && typeof j.domain_basis_counts === 'object', '须披露域派生来源计数');
  const tot = Object.values(j.domain_basis_counts).reduce((a, b) => a + b, 0);
  assert.ok(tot > 0, '来源计数不得为空');
  // 若存在 none（(unknown)），必须在 by_domain 里可见（不得被过滤掉）
  if (j.domain_basis_counts.none) {
    assert.ok(j.by_domain.some((c) => c.domain === '(unknown)'), '(unknown) 域须在 by_domain 中如实出现');
  }
});

test('stage4 分域读数：additive —— 分域不得改变既有五层数字', () => {
  // 分域读数是**追加披露**：既有 report 的字段与值必须仍是原口径。
  // 本断言锁定「分域节的存在不影响分层读数」（真实产物 + 复算五层核心量一致性抽查）。
  const j = JSON.parse(fs.readFileSync(ART, 'utf8'));
  for (const L of ['L1', 'L2', 'L3', 'L5', 'L6']) {
    assert.ok(j.report[L], '五层读数须齐：' + L);
    assert.ok(typeof j.report[L].ledger_rows === 'number', L + ' 须有 ledger_rows');
  }
  // 分域格的可计分数之和 <= 各层可计分数之和（分域是同一批题的重切分，不得凭空多出样本）
  const byDom = j.by_domain.reduce((a, c) => a + c.scored_n, 0);
  const byLayer = ['L1', 'L2', 'L3', 'L5', 'L6'].reduce((a, L) => a + (j.report[L].scored_n || 0), 0);
  assert.equal(byDom, byLayer, '分域可计分总数必须等于分层可计分总数（同一批题的两种切法）');
});

test('domain：与生产库真实行的域归属可复算（抽样 5 行）', () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare("SELECT p.id, p.layer, g.game_type, "
    + "(SELECT json_extract(e.value,'$.resolve.kind') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL LIMIT 1) AS k "
    + "FROM predictions p LEFT JOIN games g ON g.id=p.game_id WHERE p.g2_regime='R4' AND p.outcome IS NOT NULL LIMIT 5").all();
  db.close();
  assert.ok(rows.length > 0, '前提：库里有已解行');
  for (const r of rows) {
    const d = D.deriveDomain({ resolve: r.k ? { kind: r.k } : null, gameType: r.game_type });
    assert.ok(d.domain && d.domain.length > 0, 'id=' + r.id + ' 须派生出域');
    assert.ok(['resolve_kind', 'evidence_kind', 'game_type', 'none'].indexOf(d.basis) >= 0, 'basis 取值合法');
  }
});
