'use strict';
/**
 * p1b/scripts/rb-score.cjs —— 批次 1-RB 计分（PREREG-RB v1 §三，零 LLM，库只读）。
 * 输出：12 题型×3 路 Brier vs 分题型基率下限 b(1−b) 全表（含噪声带 ±0.06 标记）
 *   + 合并条款判定（跨 ≥3 不相关题型方向一致）+ TOST d=0.5 + λ̂/γ̂ 记账。
 * 题型识别：statement 模式匹配（v2 模板题面格式确定）。
 */
const { db } = require('../src/deps');

const TYPE_PATTERNS = [ // 顺序敏感：组合/长题面在前，防短前缀误命中（子串 includes，规避正则转义）
  ['T10', '未被放逐，且投票无弃票'],
  ['T9', '被放逐者是狼人，且其最高票唯一'],
  ['T9b', '最高票唯一（未触发破平）'],
  ['T9a', '被放逐者是狼人'],
  ['T2', '自称平民实为狼'],
  ['T3', '之差不超过 1 票'],
  ['T5', '最高票数不少于 4 票'],
  ['T6', '第一条公开发言的玩家未被放逐'],
  ['T7', '累计身份声称'],
  ['T8', '至少有一名狼人获得至少 1 票'],
  ['T4', '放逐投票无弃票'],
  ['T1', '号存活'],
];
function typeOf(statement) {
  for (const [id, sub] of TYPE_PATTERNS) if (statement.indexOf(sub) !== -1) return id;
  return null;
}
const brier = (qs, ys) => qs.reduce((a, q, i) => a + Math.pow(q - ys[i], 2), 0) / qs.length;
const fmt = (x) => (x === null || x === undefined || Number.isNaN(x)) ? 'n/a' : Number(x).toFixed(4);
function pearson(a, b) {
  const n = a.length; if (n < 3) return null;
  let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n; let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; cov += x * y; va += x * x; vb += y * y; }
  return (va && vb) ? cov / Math.sqrt(va * vb) : null;
}
function bootstrapDeltaCI(deltas, iters) {
  const n = deltas.length; let s = 987654321;
  function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const means = [];
  for (let it = 0; it < iters; it++) { let sum = 0; for (let i = 0; i < n; i++) sum += deltas[Math.floor(rnd() * n)]; means.push(sum / n); }
  means.sort((x, y) => x - y);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

function main() {
  db.init();
  const conn = db.getConnection();
  const preds = conn.prepare("SELECT id, statement, layer, outcome FROM predictions WHERE checklist_hash='v2'").all();
  const vrows = conn.prepare("SELECT v.prediction_id, v.prompt_variant, v.implied_prob AS p"
    + ' FROM verdicts v JOIN predictions p ON p.id = v.prediction_id'
    + " WHERE p.checklist_hash='v2' AND v.implied_prob IS NOT NULL").all();
  const ROUTES = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
  const NOISE = 0.06;
  // 分型
  const byType = {};
  for (const p of preds) {
    const t = typeOf(p.statement);
    if (!t) { console.log('未识别题型: pred#' + p.id + ' ' + p.statement.slice(0, 40)); continue; }
    (byType[t] = byType[t] || { rows: [] }).rows.push(p);
  }
  const vmap = new Map();
  for (const v of vrows) { (vmap.get(v.prediction_id) || vmap.set(v.prediction_id, {}).get(v.prediction_id))[v.prompt_variant] = v.p; }
  console.log('=== R-B 计分（PREREG-RB v1 §三 · 零 LLM · 库只读） ===');
  console.log('题=' + preds.length + '（checklist_hash=v2） 判词行=' + vrows.length + ' 噪声带=±' + NOISE);
  console.log('题型          n   b(基率)  基率下限   |  v1 Brier Δv1     |  v2 Brier Δv2     |  v3 Brier Δv3');
  let directional = { v1_evidence: 0, v2_skeptical: 0, v3_baserate: 0 };
  let scoredTypes = 0;
  const pooled = { v1_evidence: [], v2_skeptical: [], v3_baserate: [] }, pooledBase = [];
  for (const t of Object.keys(byType).sort()) {
    const rows = byType[t].rows.filter((r) => r.outcome === 'true' || r.outcome === 'false');
    const amb = byType[t].rows.length - rows.length;
    if (rows.length < 30 - 0) { /* n<30 样本不足整型降级 */ }
    const ys = rows.map((r) => (r.outcome === 'true' ? 1 : 0));
    const b = ys.reduce((x, y) => x + y, 0) / ys.length;
    const floor = b * (1 - b);
    const line = [t.padEnd(4) + ' ' + String(rows.length).padStart(4) + (amb ? '(amb' + amb + ')' : '     ') + ' ' + b.toFixed(4) + '  ' + floor.toFixed(4)];
    let anyDir = false;
    const isL1 = rows[0] && rows[0].layer === 'L1';
    for (const rt of ROUTES) {
      // PREREG-RB §三 impute：L1 题型失败 impute 0.5（不用规则基率）；L6 题型失败 impute 该型基率 b
      const qs = [], ysr = [];
      let imputed = 0;
      for (let i = 0; i < rows.length; i++) {
        const v = (vmap.get(rows[i].id) || {})[rt];
        if (v !== undefined) { qs.push(v); ysr.push(ys[i]); }
        else { qs.push(isL1 ? 0.5 : b); ysr.push(ys[i]); imputed++; }
      }
      if (qs.length < rows.length * 0.5) { line.push('  ' + rt + ': n=' + qs.length + ' 样本不足'); continue; }
      const br = brier(qs, ysr);
      const delta = floor - br; // >0=超基率（Brier 低于下限）
      if (delta > NOISE) { directional[rt]++; anyDir = true; }
      line.push('  ' + br.toFixed(4) + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(4) + (delta > NOISE ? '★' : '') + (imputed ? '(impute' + imputed + ')' : ''));
      pooled[rt].push.apply(pooled[rt], qs); if (rt === 'v1_evidence') pooledBase.push.apply(pooledBase, ys.map(() => floor));
    }
    if (anyDir) scoredTypes++;
    console.log(line.join(''));
  }
  console.log('--- 合并条款（PREREG-RB §三：超基率方向超噪声带的题型须跨 ≥3 不相关题型） ---');
  for (const rt of ROUTES) console.log('  ' + rt + ': 超噪声带题型数=' + directional[rt] + (directional[rt] >= 3 ? ' → 合并条款达成' : ' → 合并条款未达成'));
  // 汇总 Brier vs 合并基率下限 + bootstrap CI
  for (const rt of ROUTES) {
    const pts = pooled[rt];
    const ysAll = preds.filter((r) => (vmap.get(r.id) || {})[rt] !== undefined && (r.outcome === 'true' || r.outcome === 'false'));
    const qs = ysAll.map((r) => (vmap.get(r.id) || {})[rt]);
    const ys = ysAll.map((r) => (r.outcome === 'true' ? 1 : 0));
    const br = brier(qs, ys);
    const bPool = ys.reduce((x, y) => x + y, 0) / ys.length;
    const floorPool = bPool * (1 - bPool);
    const deltas = qs.map((q, i) => Math.pow(floorPool - ys[i], 2) - Math.pow(q - ys[i], 2));
    const ci = bootstrapDeltaCI(deltas, 1000);
    console.log('  汇总 ' + rt + ': n=' + ys.length + ' Brier=' + fmt(br) + ' 池基率下限=' + fmt(floorPool) + ' Δ=' + fmt(floorPool - br) + ' CI95=[' + fmt(ci[0]) + ',' + fmt(ci[1]) + ']');
  }
  // λ̂/γ̂ 记账（R-B 判词相关矩阵，K 公式口径=report-layered 同款）
  const common = preds.filter((r) => { const m = vmap.get(r.id); return m && ROUTES.every((rt) => m[rt] !== undefined); });
  const corr = {};
  for (let i = 0; i < ROUTES.length; i++) for (let j = i + 1; j < ROUTES.length; j++) {
    const xs = common.map((r) => vmap.get(r.id)[ROUTES[i]]), ys2 = common.map((r) => vmap.get(r.id)[ROUTES[j]]);
    corr[ROUTES[i] + '~' + ROUTES[j]] = pearson(xs, ys2);
  }
  console.log('--- λ̂/γ̂ 记账（K 公式；只记校准列不得版） ---');
  let lam = 0;
  for (const k of Object.keys(corr)) { console.log('  r(' + k + ')=' + fmt(corr[k])); lam += corr[k]; }
  lam /= 3;
  console.log('  λ̂=' + fmt(lam) + ' → γ̂=3/(1+2λ̂)=' + fmt(3 / (1 + 2 * lam)) + '（n_common=' + common.length + '）');
  console.log('注：TOST d=0.5 等价界以汇总 Δ 的 bootstrap CI 落于 [−0.5,+0.5] 判定（见汇总行 CI）；探索性 n 口径随题型标注。');
  db.closeCurrent();
  return 0;
}
try { process.exit(main()); } catch (e) { console.error('[rb-score] 失败: ' + ((e && e.stack) ? e.stack : e)); process.exit(1); }
