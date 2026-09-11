'use strict';
/**
 * p1b/scripts/ts-rebacktest.cjs —— 批次 1.5 · TS/Platt 离线回测（零 LLM，库只读）。
 *
 * 口径（队长规划 §1.3 / K 笔记 F33+F42+F43 / 评审边界）：
 *   每路判词 p → logit z → 1-D 温度 T（NLL 最小化，三分搜索）→ q=σ(z/T)；
 *   Platt 对照 = 2 参数逻辑回归 σ(a·z+b)（手写 Newton-IRLS，无依赖）；
 *   主报告口径 = leave-one-out 交叉验证（每点用其余点拟合，防自评过拟合）；
 *   isotonic 不做（200 条规模已裁，K ⑥b+AIA 表E 劣证）。
 *
 * ⚠ F33 分数归一化警告：三路分数尺度不同（温度 v1 0.2/v2 0.7/v3 1.0），本回测
 *   逐路独立拟合即是对「各路波动尺度不同」的最小归一化处置；跨路比较 Brier 时
 *   须记得分数非同尺度（归一化未做，结论只限路内前后对照）。
 * ⚠ 评审边界（写死）：本回测结论只做重跑预期管理，一律不得写进 PREREG 判据；
 *   n≈86-89/路 → 一切数字=探索性（F 防多重比较 #3）。
 *
 * 用法：node scripts/ts-rebacktest.cjs
 */
const { db } = require('../src/deps');

const clampP = (p) => Math.max(0.001, Math.min(0.999, p));
const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const brier = (qs, ys) => qs.reduce((a, q, i) => a + Math.pow(q - ys[i], 2), 0) / qs.length;
const fmt = (x) => (x === null || x === undefined || Number.isNaN(x)) ? 'n/a' : Number(x).toFixed(4);

/** NLL(T)：q_i=σ(z_i/T) 的 mean NLL（F42：T 按验证集 NLL 优化，1 参数） */
function nllT(zs, ys, T) {
  let s = 0;
  for (let i = 0; i < zs.length; i++) { const q = sig(zs[i] / T); s -= ys[i] * Math.log(q) + (1 - ys[i]) * Math.log(1 - q); }
  return s / zs.length;
}
/** 1-D 最优 T（log 函数值单峰假设下三分搜索，50 轮 → 区间宽 ~1e-8） */
function fitT(zs, ys) {
  let lo = 0.05, hi = 20;
  for (let it = 0; it < 60; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (nllT(zs, ys, m1) < nllT(zs, ys, m2)) hi = m2; else lo = m1;
  }
  return (lo + hi) / 2;
}
/** Platt 2 参数（a·z+b）Newton-IRLS：w += (XᵀWX + εI)⁻¹ Xᵀ(y−p)，30 行内手写 */
function fitPlatt(zs, ys) {
  let a = 1, b = 0;
  const n = zs.length;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 1e-6, hbb = 1e-6, hab = 0;
    for (let i = 0; i < n; i++) {
      const q = sig(a * zs[i] + b), r = ys[i] - q, w = Math.max(q * (1 - q), 1e-9);
      ga += r * zs[i]; gb += r; haa += w * zs[i] * zs[i]; hbb += w; hab += w * zs[i];
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    // 步长截断（可分/近常数 y 时 Newton 会发散——v3 层实测 a→678064，clamp 保稳定）
    const da = Math.max(-2, Math.min(2, (hbb * ga - hab * gb) / det));
    const dbb = Math.max(-2, Math.min(2, (haa * gb - hab * ga) / det));
    a += da; b += dbb;
    if (Math.abs(da) + Math.abs(dbb) < 1e-10) break;
  }
  return { a: a, b: b };
}
const plattQ = (pl, z) => sig(pl.a * z + pl.b);

/** 点级 ΔBrier bootstrap 95%CI（LCG 确定性伪随机，口径=ablation.cjs bootstrapDeltaCI 同款可复现） */
function bootstrapDeltaCI(deltas, iters) {
  const n = deltas.length;
  let s = 987654321;
  function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const means = [];
  for (let it = 0; it < iters; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += deltas[Math.floor(rnd() * n)];
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

/** 单路回测：全量拟合（in-sample 对照）+ LOO（主报告口径）+ acquiescence 可校回比例 */
function backtestRoute(name, rows) {
  const zs = rows.map((r) => logit(clampP(r.p)));
  const ys = rows.map((r) => (r.outcome === 'true' ? 1 : 0));
  const n = rows.length;
  const raw = brier(rows.map((r) => clampP(r.p)), ys);
  // 全量拟合（in-sample，仅对照）
  const T = fitT(zs, ys);
  const pl = fitPlatt(zs, ys);
  const inTs = brier(zs.map((z) => sig(z / T)), ys);
  const inPl = brier(zs.map((z) => plattQ(pl, z)), ys);
  // LOO（主口径）：每点用其余点拟合
  const qTs = [], qPl = [];
  for (let i = 0; i < n; i++) {
    const zi = zs.slice(0, i).concat(zs.slice(i + 1)), yi = ys.slice(0, i).concat(ys.slice(i + 1));
    qTs.push(sig(zs[i] / fitT(zi, yi)));
    qPl.push(plattQ(fitPlatt(zi, yi), zs[i]));
  }
  const looTs = brier(qTs, ys), looPl = brier(qPl, ys);
  // acquiescence 可校回比例 = (Brier_orig − Brier_LOO) / (Brier_orig − Brier_最优常数)
  const pStar = ys.reduce((x, y) => x + y, 0) / n;
  const bConst = pStar * (1 - pStar);
  const gap = raw - bConst;
  const recTs = gap > 0 ? (raw - looTs) / gap : null;
  const recPl = gap > 0 ? (raw - looPl) / gap : null;
  // 点级 delta bootstrap CI（原始 − TS_LOO；负值=TS 更差）
  const deltas = rows.map((r, i) => Math.pow(clampP(r.p) - ys[i], 2) - Math.pow(qTs[i] - ys[i], 2));
  const ci = bootstrapDeltaCI(deltas, 1000);
  console.log('--- ' + name + ' (n=' + n + ') ---');
  console.log('  原始 Brier=' + fmt(raw) + '；最优常数 p*=' + fmt(pStar) + ' Brier=' + fmt(bConst));
  console.log('  TS: T̂=' + fmt(T) + '，in-sample=' + fmt(inTs) + '，LOO=' + fmt(looTs) + '；ΔBrier(原始−LOO)=' + fmt(raw - looTs) + ' CI95=[' + fmt(ci[0]) + ',' + fmt(ci[1]) + ']');
  console.log('  Platt: a=' + fmt(pl.a) + ' b=' + fmt(pl.b) + '，in-sample=' + fmt(inPl) + '，LOO=' + fmt(looPl) + '；ΔBrier(原始−LOO)=' + fmt(raw - looPl));
  console.log('  acquiescence 可校回比例（(raw−loo)/(raw−常数)）：TS=' + fmt(recTs) + ' / Platt=' + fmt(recPl) + '（口径：相对最优常数参照的可回收份额，探索性估算）');
  return { n: n, raw: raw, looTs: looTs, looPl: looPl, T: T };
}

function main() {
  db.init();
  const conn = db.getConnection();
  const rows = conn.prepare("SELECT p.id, p.layer, p.statement, p.assigned_prob, p.outcome, v.prompt_variant, v.implied_prob AS p"
    + ' FROM predictions p JOIN verdicts v ON v.prediction_id = p.id'
    + " WHERE p.outcome IN ('true','false') AND p.layer IN ('L1','L6') AND v.implied_prob IS NOT NULL").all();
  const routes = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
  console.log('=== TS/Platt 离线回测（批次 1.5 · 零 LLM · 库只读） ===');
  console.log('⚠ F33 警告：三路分数非同尺度（温度 0.2/0.7/1.0），本回测逐路独立拟合；跨路比较仅限方向性参考');
  console.log('⚠ 评审边界：本回测结论只做重跑预期管理，一律不得写进 PREREG 判据；n<200=探索性（F 防多重比较 #3）');
  console.log('口径：LOO=每点用其余点拟合（防自评过拟合）；in-sample 仅对照；bootstrap iters=1000（LCG 确定性）');
  const out = {};
  for (const rt of routes) out[rt] = backtestRoute(rt, rows.filter((r) => r.prompt_variant === rt));
  // L1 重言层单列（outcome 恒 false → TS 将把 T 压向 0 把 q 推向 0=真值方向，属重言拟合非信息）
  const l1 = rows.filter((r) => r.layer === 'L1');
  if (l1.length) {
    console.log('--- L1 重言层单列（outcome 恒 false，拟合=重言收缩非信息，只做预期管理） ---');
    for (const rt of routes) {
      const sub = l1.filter((r) => r.prompt_variant === rt);
      if (sub.length >= 5) backtestRoute(rt + '@L1', sub);
    }
  }
  console.log('（结论只做重跑预期管理；PREREG 判据=PREREG-判词重跑-v1.md 冻结文本，与本报告数字无关）');
  db.closeCurrent();
  return 0;
}
try { process.exit(main()); } catch (e) { console.error('[ts-rebacktest] 失败: ' + ((e && e.stack) ? e.stack : e)); process.exit(1); }
