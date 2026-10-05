'use strict';
/**
 * p1b/test/role3.test.cjs —— 角色③「分支概率合成器＋重放」测试（2026-09-20（二十九）批）
 *
 * 覆盖：
 *   ① 合成纯函数：conjunction 正例/边界、partition、noisy-OR、6C 全方差
 *   ② ★缺读数守卫（金样抓到的实现 bug：Number(null)===0 ⇒ 静默当 0）——null/undefined/空串/布尔 全须拒
 *   ③ 判据原语复用：brier/murphyRel/bootCI 与共享实现（e2-combo-precheck）逐位一致（禁写第二份）
 *   ④ 金样 identity：退化输入 ⇒ Δ≡0、σ̂_d=0、CI=[0,0]（「无差异时不出假差异」）
 *   ⑤ ★冻结件回归锁：v1 与 v1.1 逐件复算 MATCH=true（防正文被改）
 *   ⑥ ★开跑令闸：无 --arms ⇒ exit 3（零写盘）
 *   ⑦ ★接线锁：replay 的 verdicts SQL 必须选出 run_id（实验批排除规则的前提）
 *   ⑧ 判读面定义与 PREREG 一致：D 型不进判读（无 oddsapi_h2h 引用）；N 型两族 SQL 写死
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const C = require(path.join(ROOT, 'p1b', 'scripts', 'role3-combiner.cjs'));
const R = require(path.join(ROOT, 'p1b', 'scripts', 'role3-replay.cjs'));
const SHARED = require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));

test('① 合成纯函数：conjunction/partition/noisy-OR/6C', () => {
  assert.ok(Math.abs(C.combineConjunction({ pa: 0.5, pb: 0.5 }).p - 0.25) < 1e-12);
  assert.ok(Math.abs(C.combinePartition({ branches: [{ p_b: 0.6, p_e_given_b: 1 }, { p_b: 0.4, p_e_given_b: 0 }] }).p - 0.6) < 1e-12);
  assert.ok(Math.abs(C.combineNoisyOr({ branches: [{ p_e_given_b: 0.5 }, { p_e_given_b: 0.5 }] }).p - 0.75) < 1e-12);
  const vd = C.varianceDecomp({ branches: [{ p_b: 0.5, p_e_given_b: 0.2 }, { p_b: 0.5, p_e_given_b: 0.8 }] });
  assert.ok(Math.abs(vd.structural - 0.09) < 1e-9, '结构分量 Var[E(E|B)]＝0.09');
  assert.equal(vd.within, null, '分支内方差现数据面不可观测 ⇒ null（不以 0 冒充）');
});

test('② ★缺读数守卫：null/undefined/空串/布尔 一律拒（金样抓到的 Number(null)===0 bug）', () => {
  for (const bad of [null, undefined, '', true, false, NaN, -0.1, 1.1, 'abc']) {
    const r = C.combineConjunction({ pa: bad, pb: 0.5 });
    assert.equal(r.ok, false, '缺/非法读数须 ok:false（实收 ' + JSON.stringify(bad) + ' ⇒ ' + JSON.stringify(r) + '）');
    assert.equal(r.p, null, '不得出数');
  }
  assert.equal(C.combineConjunction({ pa: 0, pb: 0.5 }).ok, true, '0 是合法读数（须放行）');
  assert.equal(C.combineConjunction({ pa: 1, pb: 0.5 }).ok, true, '1 是合法读数（须放行）');
});

test('③ 判据原语复用共享实现：brier / murphyRel / bootCI 与 e2-combo-precheck 逐位一致', () => {
  assert.equal(C.brier(0.7, 1), SHARED.brier(0.7, 1));
  assert.equal(C.brier(0.7, 0), SHARED.brier(0.7, 0));
  const ps = [0.1, 0.4, 0.6, 0.9], ys = [0, 0, 1, 1];
  assert.equal(C.murphyRel(ps, ys), SHARED.murphyRes(ps, ys).rel, 'REL 分量同口径');
  const d = [0.1, -0.2, 0.05, -0.03, 0.2];
  const mine = C.bootCI(d, 500, 42);
  const theirs = SHARED.bootCI(d.map((x) => ({ d: x })), (sub) => sub.reduce((s, x) => s + x.d, 0) / sub.length, 500, 42);
  assert.equal(mine.lb, theirs.lo); assert.equal(mine.ub, theirs.hi);
  assert.equal(mine.mean, d.reduce((a, b) => a + b, 0) / d.length, 'mean＝配对差均值（共享件不返回 mean，本件补）');
});

test('④ 金样 identity：退化输入（P(A)=直接、P(B)=1）⇒ Δ≡0、σ̂_d=0、CI=[0,0]', () => {
  const st = R.selftest();
  assert.equal(st.identity, true);
  assert.deepEqual(st.identity_d, [0, 0, 0, 0, 0]);
  assert.equal(st.identity_sd, 0);
  assert.deepEqual([st.identity_ci.lb, st.identity_ci.ub], [0, 0]);
  assert.equal(st.missing_false, true);
  assert.equal(st.missing_undefined_false, true);
  assert.equal(st.noisy_or_0_75, true);
  assert.equal(st.variance_structural_0_09, true);
  assert.equal(st.variance_within_null, true);
  assert.equal(st.all_pass, true);
});

test('⑤ ★冻结件回归锁：v1 与 v1.1 逐件复算 MATCH=true', () => {
  const { freezeSha } = require(path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'));
  const files = [
    'docs/assets/forecast-debate/PREREG-角色③情景分支合成器-v1-20260920.md',
    'docs/assets/forecast-debate/PREREG-角色③情景分支合成器-v1.1-勘误-20260920.md',
  ];
  for (const f of files) {
    const r = freezeSha(path.join(ROOT, f));
    assert.equal(r.match, true, f + ' 复算 MATCH 须为 true（sha=' + r.sha256.slice(0, 12) + '…）');
  }
});

test('⑥ ★开跑令闸：无 --arms ⇒ exit 3', () => {
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'p1b', 'scripts', 'role3-replay.cjs')], { encoding: 'utf8' });
  } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  assert.equal(code, 3, '无 --arms 须 exit 3（实收 ' + code + '）');
  assert.ok(out.indexOf('不开跑') >= 0, '须打印闸检说明');
});

test('⑦ ★接线锁：replay 的 verdicts SQL 必须选出 run_id', () => {
  const src = fs.readFileSync(path.join(ROOT, 'p1b', 'scripts', 'role3-replay.cjs'), 'utf8');
  const m = src.match(/SELECT[^'"]*FROM verdicts[^'"]*/g) || [];
  assert.ok(m.length >= 1, '未找到 verdicts 取数语句（接线锁失效？）');
  for (const sql of m) assert.ok(sql.indexOf('run_id') >= 0, '漏选 run_id（实验批排除规则将无从生效）：' + sql);
});

test('⑧ 判读面与 PREREG 一致：N 型两族写死；D 型（oddsapi_h2h）不得进判读', () => {
  assert.deepEqual(R.FAMILIES.map((f) => f.id), ['T9', 'T10']);
  assert.deepEqual(R.FAMILIES[0].children, ['T9a', 'T9b']);
  assert.deepEqual(R.FAMILIES[1].children, ['T6', 'T4']);
  const src = fs.readFileSync(path.join(ROOT, 'p1b', 'scripts', 'role3-replay.cjs'), 'utf8');
  assert.ok(src.indexOf('oddsapi_h2h') < 0, '★D 型（1X2 互斥划分）不进判读（构造性恒等）——源码不得出现 oddsapi_h2h 取数');
  assert.equal(R.RUN_ID, 'ca1b5cdbddfc', '判词批 run_id 须为 PREREG §3 冻结值');
  assert.equal(R.NONINF_MARGIN, 0.005, 'C1 边际须为 0.005（照厚格同线）');
});
