'use strict';
/**
 * p1b/scripts/report-murphy.cjs —— 批次 1.5 · Murphy 三分解报表（K F56，零 LLM，库只读）。
 *
 * 口径：Brier = REL − RES + UNC（Murphy 1973 分解，F5/F56）。
 *   离散 plugin 版：f_j 按 implied_prob 0.05 宽分桶（20 桶），桶内预测均值 f̄_j、
 *   实测频率 ō_j、权重 n_j/N：
 *     REL = Σ (n_j/N)(f̄_j − ō_j)²      （可靠性=校准误差）
 *     RES = Σ (n_j/N)(ō_j − ō)²        （分辨率=区分结局能力）
 *     UNC = ō(1−ō)                      （不确定度=结局固有熵，与预测器无关）
 *   恒等式自检：REL−RES+UNC 与直接 Brier 差 <1e-9（用桶均值 f̄_j 时精确）。
 *   ECE 对照行=Σ(n_j/N)|f̄_j−ō_j|（同桶宽；口径注记=F58：分桶 ECE 是真校准误差的下界）。
 * 分层：全量 + L6/L1 双层 + tautology=1 层单列（L1 30 条均 tautology=1，重言反向信息）。
 * 对象：3 路判词 + median 写回（assigned_prob）+ 0.5 占位。
 * 用法：node scripts/report-murphy.cjs
 */
const { db } = require('../src/deps');

const NB = 20, BW = 0.05; // 20 桶 × 0.05 宽

/** Murphy 分解+恒等式自检（rows: {p, y}） */
function murphy(rows) {
  const n = rows.length;
  const bs = []; for (let j = 0; j < NB; j++) bs.push({ n: 0, sf: 0, sy: 0 });
  for (const r of rows) {
    const j = Math.min(NB - 1, Math.max(0, Math.floor(r.p / BW)));
    bs[j].n++; bs[j].sf += r.p; bs[j].sy += r.y;
  }
  const obar = rows.reduce((a, r) => a + r.y, 0) / n;
  let rel = 0, res = 0, ece = 0, det = [];
  for (let j = 0; j < NB; j++) {
    const b = bs[j];
    if (!b.n) { det.push({ lo: j * BW, n: 0 }); continue; }
    const fb = b.sf / b.n, ob = b.sy / b.n, w = b.n / n;
    rel += w * Math.pow(fb - ob, 2);
    res += w * Math.pow(ob - obar, 2);
    ece += w * Math.abs(fb - ob);
    det.push({ lo: j * BW, n: b.n, fbar: fb, obar: ob });
  }
  const unc = obar * (1 - obar);
  const brierDirect = rows.reduce((a, r) => a + Math.pow(r.p - r.y, 2), 0) / n;
  // 离散化口径（诚实注记）：恒等式对「binned 预测 f̄_j」严格成立；直接 Brier − (REL−RES+UNC)
  // = 桶内预测方差 VarWithin = Σ_j (n_j/N)·var_j(p)（0.05 桶宽下的离散化损失，非计算错误）
  let varWithin = 0, covWithin = 0;
  for (let j = 0; j < NB; j++) {
    if (!bs[j].n) continue;
    const fb = bs[j].sf / bs[j].n, ob = bs[j].sy / bs[j].n;
    let v = 0, cv = 0;
    for (const r of rows) {
      const jj = Math.min(NB - 1, Math.max(0, Math.floor(r.p / BW)));
      if (jj === j) { v += Math.pow(r.p - fb, 2); cv += (r.p - fb) * (r.y - ob); }
    }
    varWithin += (bs[j].n / n) * (v / bs[j].n);
    covWithin += (bs[j].n / n) * (cv / bs[j].n);
  }
  const identity = rel - res + unc;
  return { n: n, obar: obar, rel: rel, res: res, unc: unc, ece: ece, brier: brierDirect, binned: identity, varWithin: varWithin, covWithin: covWithin, det: det };
}

function printRow(label, rows) {
  const m = murphy(rows);
  // 精确恒等式：Brier = REL − RES + UNC + VarWithin − 2·CovWithin
  //  （REL−RES+UNC 对 binned 预测 f̄_j 严格成立；直接 Brier 的额外差=桶内方差 −2×桶内协方差）
  const gap = m.brier - m.binned;
  const ok = Math.abs((m.varWithin - 2 * m.covWithin) - gap) < 1e-9 ? '分解✓' : '分解✗(' + Math.abs((m.varWithin - 2 * m.covWithin) - gap).toExponential(1) + ')';
  console.log('  ' + label.padEnd(24) + ' n=' + String(m.n).padStart(3)
    + '  Brier=' + m.brier.toFixed(4) + '  REL=' + m.rel.toFixed(4) + '  RES=' + m.res.toFixed(4)
    + '  UNC=' + m.unc.toFixed(4) + '  VarW=' + m.varWithin.toFixed(4) + '  CovW=' + m.covWithin.toFixed(4)
    + '  ECE20=' + m.ece.toFixed(4) + '  [Brier=REL−RES+UNC+VarW−2CovW ' + ok + ']');
  return m;
}

function main() {
  db.init();
  const conn = db.getConnection();
  const preds = conn.prepare("SELECT id, layer, tautology, assigned_prob, outcome FROM predictions"
    + " WHERE outcome IN ('true','false') AND layer IN ('L1','L6') AND assigned_prob IS NOT NULL").all();
  const vrows = conn.prepare("SELECT v.prediction_id, v.prompt_variant, v.implied_prob AS p, p.layer, p.tautology, p.outcome"
    + ' FROM verdicts v JOIN predictions p ON p.id = v.prediction_id'
    + " WHERE p.outcome IN ('true','false') AND v.implied_prob IS NOT NULL").all();
  const toY = (o) => (o === 'true' ? 1 : 0);
  const ROUTES = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
  // 每组 = {label, rows:[{p,y,layer,tautology}]}；分层过滤直接对行做
  const groups = ROUTES.map((rt) => ({
    label: rt,
    rows: vrows.filter((v) => v.prompt_variant === rt).map((v) => ({ p: v.p, y: toY(v.outcome), layer: v.layer, taut: v.tautology })),
  }));
  groups.push({ label: 'median写回', rows: preds.map((p) => ({ p: p.assigned_prob, y: toY(p.outcome), layer: p.layer, taut: p.tautology })) });
  groups.push({ label: '0.5占位', rows: preds.map((p) => ({ p: 0.5, y: toY(p.outcome), layer: p.layer, taut: p.tautology })) });
  const slices = [
    { label: '全量', f: () => true },
    { label: 'L6 层', f: (r) => r.layer === 'L6' },
    { label: 'L1 层', f: (r) => r.layer === 'L1' },
    { label: 'tautology=1 层（单列）', f: (r) => r.taut === 1 },
  ];
  console.log('=== Murphy 三分解报表（批次 1.5 · K F56 · 零 LLM · 库只读） ===');
  console.log('桶宽 0.05×20 桶；ECE20=分桶近似（F58 下界口径：ECE 低≠校准好）；恒等式 Brier=REL−RES+UNC 逐行自检');
  for (const s of slices) {
    console.log('-- ' + s.label + ' --');
    for (const g of groups) {
      const sub = g.rows.filter(s.f);
      if (sub.length) printRow(g.label, sub);
    }
  }
  console.log('注：L1/tautology 层 outcome 恒 false → UNC=0、RES=0、REL=Brier（重言式上判词反向信息的量化呈现，A5 口径）；探索性 n<200。');
  db.closeCurrent();
  return 0;
}
try { process.exit(main()); } catch (e) { console.error('[report-murphy] 失败: ' + ((e && e.stack) ? e.stack : e)); process.exit(1); }
