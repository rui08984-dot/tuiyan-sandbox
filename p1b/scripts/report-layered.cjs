'use strict';
// 微步 3 报表：分层 ECE（下界口径）+逐路 Brier vs 0.5 占位+相关矩阵→λ̂→γ̂。探索性（90<200 只记不评）。
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const brier = (rows, key) => rows.reduce((a, r) => a + Math.pow(r[key] - (r.outcome === 'true' ? 1 : 0), 2), 0) / rows.length;
const ece10 = (rows) => {
  const bs = []; for (let i = 0; i < 10; i++) bs.push({ lo: i / 10, hi: (i + 1) / 10, n: 0, sp: 0, st: 0 });
  for (const r of rows) { const b = bs[Math.min(9, Math.floor(r.p * 10))]; b.n++; b.sp += r.p; b.st += r.outcome === 'true' ? 1 : 0; }
  let e = 0; const det = bs.map((b) => { const mp = b.n ? b.sp / b.n : null; const tr = b.n ? b.st / b.n : null; if (b.n) e += (b.n / rows.length) * Math.abs(tr - mp); return { lo: b.lo, hi: b.hi, n: b.n, mean_p: mp, true_rate: tr }; });
  return { ece: e, det: det };
};
const pearson = (xs, ys) => {
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
};

const rows = conn.prepare("SELECT p.id, p.layer, p.assigned_prob, p.outcome FROM predictions p WHERE p.layer IN ('L1','L6') AND p.outcome IN ('true','false') AND p.assigned_prob IS NOT NULL").all();
const verdicts = conn.prepare('SELECT prediction_id, prompt_variant, implied_prob FROM verdicts WHERE implied_prob IS NOT NULL').all();
const vmap = {};
for (const v of verdicts) { (vmap[v.prediction_id] = vmap[v.prediction_id] || {})[v.prompt_variant] = v.implied_prob; }

const L6 = rows.filter((r) => r.layer === 'L6').map((r) => ({ p: r.assigned_prob, outcome: r.outcome }));
const L1 = rows.filter((r) => r.layer === 'L1' && r.outcome !== null);
const allRows = rows.map((r) => ({ p: r.assigned_prob, outcome: r.outcome }));
const routes = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const routeRows = {};
for (const rt of routes) routeRows[rt] = rows.filter((r) => vmap[r.id] && vmap[r.id][rt] !== undefined).map((r) => ({ p: vmap[r.id][rt], outcome: r.outcome }));

console.log('=== 分层校准报表（探索性：90<200 只记不评） ===');
console.log('样本: L6=' + L6.length + ' L1=' + L1.length + ' 全部=' + allRows.length);
const e6 = ece10(L6); console.log('L6 ECE(10桶,下界口径)=' + e6.ece.toFixed(4));
for (const d of e6.det) if (d.n) console.log('  桶[' + d.lo + '-' + d.hi + ') n=' + d.n + ' mean_p=' + (d.mean_p === null ? '-' : d.mean_p.toFixed(3)) + ' true_rate=' + (d.true_rate === null ? '-' : d.true_rate.toFixed(3)));
const b50 = brier(allRows.map((r) => ({ p: 0.5, outcome: r.outcome })), 'p');
console.log('Brier 对比（全部 90 点）: 0.5占位=' + b50.toFixed(4));
for (const rt of routes) console.log('  ' + rt + ' Brier=' + brier(routeRows[rt], 'p').toFixed(4) + ' (n=' + routeRows[rt].length + ')');
console.log('  median写回 assigned_prob Brier=' + brier(allRows, 'p').toFixed(4));
console.log('L1 重言式单列: n=' + L1.length + '（outcome 恒 false，Brier 恒 = mean(p^2)，语义=占位校准无信息，见 PROGRESS）');

console.log('=== 3 路相关矩阵 → λ̂ → γ̂ ===');
const common = rows.filter((r) => vmap[r.id] && routes.every((rt) => vmap[r.id][rt] !== undefined));
const corr = {};
for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
  const xs = common.map((r) => vmap[r.id][routes[i]]); const ys = common.map((r) => vmap[r.id][routes[j]]);
  corr[routes[i] + '~' + routes[j]] = pearson(xs, ys);
}
for (const k of Object.keys(corr)) console.log('  r(' + k + ')=' + corr[k].toFixed(4));
const lam = (corr[routes[0] + '~' + routes[1]] + corr[routes[0] + '~' + routes[2]] + corr[routes[1] + '~' + routes[2]]) / 3;
const gam = 3 / (1 + 2 * lam);
console.log('λ̂(三对相关均值)=' + lam.toFixed(4) + ' → γ̂=3/(1+2λ̂)=' + gam.toFixed(4));
db.closeCurrent();