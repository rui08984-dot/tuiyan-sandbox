'use strict';
/**
 * p1b/test/l6-experiment-exclusion.test.cjs —— L6「实验命名空间排除」规则测试（2026-09-17 第十九批）
 *
 * 背景（实测事故形状）：`verdicts` 支持多批并存（唯一索引含 run_id），而 `l6Structural` 按「每变体取 id 最大」
 *   选行 ⇒ **实验批的新行会静默成为生产输入**（实测：晋升 9 臂批会让 37/38 道锚题 L6 读数改变）。
 * 本规则＝登记表 `EXPERIMENT_RUN_PREFIXES`（前缀命中即排除）；调用方**必须**选出 run_id。
 *
 * 覆盖：① 实验行被排除（读数回到非实验行）② 无 run_id 的行照常计入（向后兼容）③ 排除计数如实返回
 * ④ 前缀匹配严格（中段出现不算）⑤ **接线锁**：三处调用点的 SQL 必须选出 run_id（防「规则写了但没生效」）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { l6Structural, EXPERIMENT_RUN_PREFIXES, isExperimentRun } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l6_structural.js'));

test('① 实验行被排除：读数回到非实验行（不取实验批的 id 最大行）', () => {
  const verdicts = [
    { id: 10, prompt_variant: 'v1_evidence', implied_prob: 0.2, run_id: null },
    { id: 11, prompt_variant: 'v2_skeptical', implied_prob: 0.4, run_id: null },
    { id: 12, prompt_variant: 'v3_baserate', implied_prob: 0.6, run_id: 'preregA-run1-A-cutoff' },
    // 实验批（id 更大 ⇒ 若无规则会被选中）
    { id: 99, prompt_variant: 'v1_evidence', implied_prob: 0.9, run_id: 'decouple9-main-v1-evidence-T02' },
    { id: 100, prompt_variant: 'v2_skeptical', implied_prob: 0.9, run_id: 'decouple9-main-v2-skeptical-T07' },
    { id: 101, prompt_variant: 'v3_baserate', implied_prob: 0.9, run_id: 'decouple9-main-v3-baserate-T1' },
  ];
  const o = l6Structural({ verdicts: verdicts });
  assert.equal(o.ok, true);
  assert.deepEqual(o.variants, { v1_evidence: 0.2, v2_skeptical: 0.4, v3_baserate: 0.6 }, '★须取非实验行');
  assert.ok(Math.abs(o.p - 0.4) < 1e-9, 'p＝(0.2+0.4+0.6)/3＝0.4（实测 ' + o.p + '）');
  assert.equal(o.excluded_experiment_rows, 3, '排除计数须如实');
  assert.equal(o.verdict_rows, 3, '计入行数＝非实验行');
  assert.ok(o.note.indexOf('已排除实验批 3 行') > 0, 'note 须披露排除');
});

test('② 向后兼容：行里没有 run_id 字段 ⇒ 照常计入（不误排除）', () => {
  const verdicts = [
    { id: 1, prompt_variant: 'v1_evidence', implied_prob: 0.3 },
    { id: 2, prompt_variant: 'v2_skeptical', implied_prob: 0.5 },
  ];
  const o = l6Structural({ verdicts: verdicts });
  assert.equal(o.ok, true);
  assert.equal(o.n_variants, 2);
  assert.equal(o.excluded_experiment_rows, 0, '无 run_id ⇒ 不排除');
});

test('③ 前缀匹配严格：中段/后缀出现登记前缀**不算**实验', () => {
  assert.equal(isExperimentRun('decouple9-x'), true);
  assert.equal(isExperimentRun('decouple9-'), true);
  assert.equal(isExperimentRun('x-decouple9-'), false, '中段出现不算');
  assert.equal(isExperimentRun('preregA-decouple9'), false, '后缀出现不算');
  assert.equal(isExperimentRun(null), false);
  assert.equal(isExperimentRun(undefined), false);
  assert.deepEqual(EXPERIMENT_RUN_PREFIXES, ['decouple9-'], '登记表当前内容（新增＝版本递进）');
});

test('④ 全实验行 ⇒ 不出数（no_verdicts，不编）', () => {
  const verdicts = [
    { id: 99, prompt_variant: 'v1_evidence', implied_prob: 0.9, run_id: 'decouple9-a' },
    { id: 100, prompt_variant: 'v2_skeptical', implied_prob: 0.9, run_id: 'decouple9-b' },
  ];
  const o = l6Structural({ verdicts: verdicts });
  assert.equal(o.ok, false);
  assert.equal(o.status, 'no_verdicts');
  assert.equal(o.excluded_experiment_rows, 2);
});

test('⑤ ★接线锁：三处生产调用点的 verdicts SQL 必须选出 run_id', () => {
  const sites = ['p1b/scripts/stage4-run.cjs', 'p1b/scripts/u8-columns.cjs', 'p1b/scripts/e2-combo-precheck.cjs'];
  const bad = [];
  for (const f of sites) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = src.match(/SELECT[^']*FROM verdicts WHERE prediction_id = \?/g) || [];
    assert.ok(m.length >= 1, f + '：未找到 verdicts 取数语句（接线锁失效？）');
    for (const sql of m) if (sql.indexOf('run_id') < 0) bad.push(f + ' → ' + sql);
  }
  assert.deepEqual(bad, [], '以下调用点漏选 run_id（实验批排除规则将无从生效）：\n' + bad.join('\n'));
});
