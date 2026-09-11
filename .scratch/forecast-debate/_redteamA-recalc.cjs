'use strict';
// 红队A 复算：Brier/ECE/λ̂/γ̂ 从库内原始数据独立重算（对照 p12-PROGRESS 声称数字）
const { db } = require("E:/music player/p1b/src/deps");
db.init("E:/music player/p1a-terminal/data/p1a.db");
const conn = db.getConnection();
// 全量 90 条：assigned_prob=median(三路) 已写回
const preds = conn.prepare("SELECT id, game_id, layer, assigned_prob, outcome FROM predictions WHERE layer IN ('L1','L6') ORDER BY id").all();
const o2n = (o) => o === 'true' ? 1 : 0;
// Brier(assigned_prob/median 写回)
let bs = preds.map(p => { const f = p.assigned_prob, o = o2n(p.outcome); return (f - o) * (f - o); });
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log("median_written Brier(90)=", mean(bs).toFixed(4));
// 占位 0.5 基线 Brier
console.log("placeholder 0.5 Brier(90)=", mean(preds.map(p => 0.25)).toFixed(4));
// 每路 Brier（verdicts implied_prob 直接算，跨路 join）
for (const variant of ["v1_evidence", "v2_skeptical", "v3_baserate"]) {
  const rows = conn.prepare("SELECT v.implied_prob f, p.outcome o FROM verdicts v JOIN predictions p ON p.id=v.prediction_id WHERE v.prompt_variant=? AND p.outcome IN ('true','false')").all(variant);
  const b = mean(rows.map(r => { const x = r.f - o2n(r.o); return x * x; }));
  console.log(variant, "Brier(n=" + rows.length + ")=", b.toFixed(4));
}
// 分层：L6 ECE 10 桶（p12 声称 0.2114 下界口径）
const l6 = conn.prepare("SELECT assigned_prob f, outcome o FROM predictions WHERE layer='L6' AND outcome IN ('true','false')").all();
const K = 10; const buckets = Array.from({ length: K }, () => ({ n: 0, sumF: 0, sumO: 0 }));
for (const r of l6) { const f = r.f; let bi = Math.min(K - 1, Math.floor(f * K)); if (f >= 1) bi = K - 1; buckets[bi].n++; buckets[bi].sumF += f; buckets[bi].sumO += o2n(r.o); }
let ece = 0;
buckets.forEach((b, i) => { if (b.n) { const conf = b.sumF / b.n, acc = b.sumO / b.n; ece += (b.n / l6.length) * Math.abs(acc - conf); console.log("  L6 bucket[" + (i / 10).toFixed(1) + "-" + ((i + 1) / 10).toFixed(1) + ") n=" + b.n + " conf=" + conf.toFixed(3) + " acc=" + acc.toFixed(3)); } });
console.log("L6 ECE(10桶,n=" + l6.length + ")=", ece.toFixed(4), "(声称 0.2114)");
// L1 Brier（重言式恒 false）
const l1f = conn.prepare("SELECT assigned_prob f FROM predictions WHERE layer='L1'").all();
console.log("L1 Brier=mean(p^2)(n=" + l1f.length + ")=", mean(l1f.map(r => r.f * r.f)).toFixed(4));
// λ̂/γ̂：三路相关矩阵（Pearson，按 pid 对齐只取三路齐全的 pid）
const aligned = conn.prepare("SELECT p.id, v1.implied_prob a, v2.implied_prob b, v3.implied_prob c FROM predictions p JOIN verdicts v1 ON v1.prediction_id=p.id AND v1.prompt_variant='v1_evidence' JOIN verdicts v2 ON v2.prediction_id=p.id AND v2.prompt_variant='v2_skeptical' JOIN verdicts v3 ON v3.prediction_id=p.id AND v3.prompt_variant='v3_baserate'").all();
function pearson(xs, ys) { const n = xs.length; const mx = mean(xs), my = mean(ys); let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return num / Math.sqrt(dx * dy); }
const A = aligned.map(r => r.a), B = aligned.map(r => r.b), C = aligned.map(r => r.c);
const rAB = pearson(A, B), rAC = pearson(A, C), rBC = pearson(B, C);
const lam = (rAB + rAC + rBC) / 3;
console.log("aligned n=", aligned.length, "| r(v1,v2)=", rAB.toFixed(4), "r(v1,v3)=", rAC.toFixed(4), "r(v2,v3)=", rBC.toFixed(4));
console.log("λ̂=", lam.toFixed(4), "(声称 0.1744) | γ̂=3/(1+2λ̂)=", (3 / (1 + 2 * lam)).toFixed(4), "(声称 2.2243)");
db.closeCurrent();
