'use strict';
/**
 * p1b/test/l5-sources.test.cjs —— L5 认证源读侧结构化（2026-09-14 新增；同日升级为「kind+变体」规则表）
 *
 * 锁五点：
 *   ① 规则表数值＝组合数精确值（6/33、8/16、2/12、1−C(m−1,5)/C(35,5)），不是历史拟合；
 *   ② **变体判别**：同 kind 的 dlt_draw_result 按 resolve 字段分流（back_ball→1/6；front_max_ge→0.634186）；
 *   ③ 与 baseRateNote 的交叉核对三态如实（认证值一致 / 认证值矛盾 / 历史频率），矛盾不静默；
 *   ④ 产物形状**可直接喂 l5_certified**（官方分布：对齐、和为 1、target 命中 ⇒ 引擎 ok）；
 *   ⑤ 宁缺毋滥：未注册 kind / 缺 resolve / 退化参数（p 越带）⇒ 明确拒绝。
 *
 * 零网络、零 db、纯函数。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { L5_CERTIFIED_RULES, matchRule, certifiedSourceForRow, parseCertifiedFromNote, comb } =
  require(path.join(__dirname, '..', 'src', 'engines', 'l5_sources'));
const { l5Certified } = require(path.join(__dirname, '..', 'src', 'engines', 'l5_certified'));

const R_CWL_RED = { kind: 'cwl_ssq_red_contains', ball: '07' };
const R_CWL_BLUE = { kind: 'cwl_ssq_blue_odd' };
const R_DLT_BACK = { kind: 'dlt_draw_result', issue: '26105', back_ball: '01' };
const R_DLT_FMAX = { kind: 'dlt_draw_result', issue: '26105', front_max_ge: 30 };

test('规则表：四族认证值＝组合数精确值（含大乐透两变体）', () => {
  assert.equal(comb(35, 5), 324632, '组合数 C(35,5)=324632');
  assert.equal(comb(29, 5), 118755, '组合数 C(29,5)=118755');
  const p = (r) => { const m = matchRule(r); assert.equal(m.ok, true, JSON.stringify(r) + ' 应有规则'); return m.rule.pOf(r); };
  assert.ok(Math.abs(p(R_CWL_RED) - 6 / 33) < 1e-12, '红球含球＝6/33');
  assert.ok(Math.abs(p(R_CWL_BLUE) - 8 / 16) < 1e-12, '蓝球奇数＝8/16');
  assert.ok(Math.abs(p(R_DLT_BACK) - 2 / 12) < 1e-12, '后区含 01＝2/12=1/6');
  assert.ok(Math.abs(p(R_DLT_FMAX) - 0.634186) < 5e-7, '前区最大号≥30＝1−C(29,5)/C(35,5)≈0.634186');
  for (const rule of L5_CERTIFIED_RULES) {
    assert.ok(rule.basis, rule.id + ' 必须有 basis（组合数依据）');
  }
});

test('变体判别：同 kind（dlt_draw_result）按 resolve 字段分流，先到先匹配', () => {
  const back = certifiedSourceForRow({ resolve: R_DLT_BACK, baseRateNote: '前瞻·L5 认证随机：基率=0.166667（后区含 01：…=11/66…）' });
  assert.equal(back.ok, true);
  assert.ok(Math.abs(back.meta.p - 1 / 6) < 1e-8, 'p=1/6（r9 舍入内）');
  assert.equal(back.meta.note_consistent, true, '文本 0.166667 ≈ 1/6');
  assert.ok(/后区含 01/.test(back.source.name), 'name 带出变体标签');

  const fmax = certifiedSourceForRow({ resolve: R_DLT_FMAX, baseRateNote: '前瞻·L5 认证随机：基率=0.634186（前区最大号>=30：1-C(29,5)/C(35,5)…）' });
  assert.equal(fmax.ok, true);
  assert.ok(Math.abs(fmax.meta.p - 0.6341858) < 5e-7, '前区最大号变体 p≈0.634186');
  assert.equal(fmax.meta.note_consistent, true, '文本 0.634186 ≈ 计算值（6 位四舍五入）');
  assert.ok(/前区最大号 ≥ 30/.test(fmax.source.name), 'name 带出变体标签');
});

test('文本三态：认证值一致 / 认证值矛盾（不静默）/ 历史频率（不参与）+ 无文本', () => {
  const consistent = certifiedSourceForRow({ resolve: R_CWL_RED, baseRateNote: '前瞻·L5 认证随机：基率=组合数理论值 0.1818（=6/33，非历史拟合）' });
  assert.equal(consistent.meta.note_kind, 'certified_text');
  assert.equal(consistent.meta.note_consistent, true, '文本 0.1818 ≈ 6/33');

  const contradict = certifiedSourceForRow({ resolve: R_CWL_RED, baseRateNote: '基率=组合数理论值 0.2000（=X）' });
  assert.equal(contradict.meta.note_kind, 'certified_text');
  assert.equal(contradict.meta.note_consistent, false, '认证值声明 0.2 ≠ 6/33 ⇒ 如实标矛盾（不静默）');

  const empirical = certifiedSourceForRow({ resolve: R_CWL_RED, baseRateNote: '历史回填·双色球 red 含 07：cutoff 前 25 期中命中 16.0%（样本不足 n=25）' });
  assert.equal(empirical.ok, true, '历史频率批仍可用（以组合数为准）');
  assert.equal(empirical.meta.note_kind, 'empirical_pct');
  assert.equal(empirical.meta.note_p, 0.16);
  assert.equal(empirical.meta.note_consistent, null, '历史频率不参与一致性判定');

  const noNote = certifiedSourceForRow({ resolve: R_DLT_BACK });
  assert.equal(noNote.meta.note_kind, 'absent');
  assert.equal(noNote.meta.note_consistent, null);
});

test('产物形状直接喂 l5_certified：ok=true 且 p=组合数（官方分布合法）', () => {
  for (const r of [R_CWL_RED, R_CWL_BLUE, R_DLT_BACK, R_DLT_FMAX]) {
    const built = certifiedSourceForRow({ resolve: r });
    assert.equal(built.ok, true);
    const out = l5Certified({ certifiedSource: built.source });
    assert.equal(out.ok, true, JSON.stringify(r) + ' 引擎应接受该源');
    assert.equal(out.status, 'ok');
    assert.ok(Math.abs(out.p - built.meta.p) < 1e-9, '引擎 p=注册值');
    assert.equal(out.assertion_guard.hits.length, 0, '自产文案零断言命中');
    assert.equal(built.source.outcomes.length, built.source.probs.length, 'outcomes/probs 对齐');
    const sum = built.source.probs.reduce((s, x) => s + x, 0);
    assert.ok(Math.abs(sum - 1) <= 1e-6, 'probs 和为 1');
  }
});

test('宁缺毋滥：未注册 kind / 缺 resolve / 退化参数 ⇒ 明确拒绝', () => {
  const un = certifiedSourceForRow({ resolve: { kind: 'openmeteo_daily_max' }, baseRateNote: '基率=0.3' });
  assert.deepEqual({ ok: un.ok, reason: un.reason }, { ok: false, reason: 'kind_unregistered' });
  const none = certifiedSourceForRow({ resolve: null });
  assert.deepEqual({ ok: none.ok, reason: none.reason }, { ok: false, reason: 'no_resolve_kind' });
  // 前区最大号 ≥5 会退化为恒真（1−0=1）⇒ 规则不匹配 ⇒ 拒收（Q0-3 防线）
  const degen = certifiedSourceForRow({ resolve: { kind: 'dlt_draw_result', front_max_ge: 5 } });
  assert.equal(degen.ok, false, '退化参数不得产出认证源');
  assert.deepEqual(parseCertifiedFromNote('历史回填·命中 16.0%'), { p: 0.16, kind: 'empirical_pct' }, 'X% 兜底 ⇒ 历史频率');
  assert.equal(parseCertifiedFromNote('历史回填·无数字注记'), null, '无任何数字 ⇒ null');
});
