'use strict';
// R-A 计分 part2：TOST d=0.5（L6，配对 Brier 差，双侧单检验）+λ̂/γ̂+写回一致性+DB 快照 hash
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../../p1b/src/deps');
const { tCDF } = require('./_ra-stats.cjs');
const conn = db.getConnection();
const preds = conn.prepare("SELECT p.id, p.layer, p.outcome, p.assigned_prob, g.game_type FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.source='sim' AND p.layer IN ('L1','L6') AND p.outcome IN ('true','false') ORDER BY p.id").all();
const vs = conn.prepare('SELECT prediction_id, prompt_variant, implied_prob FROM verdicts').all();
const vmap = {};
for (const v of vs) { (vmap[v.prediction_id] = vmap[v.prediction_id] || {})[v.prompt_variant] = v.implied_prob; }
const routes = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const yv = (o) => (o === 'true' ? 1 : 0);
const L6 = preds.filter((p) => p.layer === 'L6');
const gt = {};
for (const p of preds) { const k = p.game_type + '|' + p.layer; gt[k] = (gt[k] || 0) + yv(p.outcome); }
const baseRate = (p) => { const k = p.game_type + '|' + p.layer; return (gt[k] - yv(p.outcome)) / (L6.length - 1); };
const out = [];
const log = (s) => { out.push(s); console.log(s); };
log('=== TOST 等价界 d=0.5（总体=L6：基率预测器仅该层有定义，L1 重言层不定义基率——口径选择记档） ===');
log('D_i = Brier(判词,i) − Brier(基率,i)；基率预测器=LOO 同型同层 true 占比（排除本条 outcome）');
for (const rt of routes) {
  const D = [];
  for (const p of L6) {
    const raw = vmap[p.id] ? vmap[p.id][rt] : undefined;
    if (raw === undefined || raw === null) continue;
    const pb = baseRate(p);
    D.push(Math.pow(raw - yv(p.outcome), 2) - Math.pow(pb - yv(p.outcome), 2));
  }
  const n = D.length, m = D.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(D.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
  const se = sd / Math.sqrt(n), df = n - 1, d = 0.5;
  const t1 = (m + d) / se, t2 = (m - d) / se;
  const p1 = 1 - tCDF(t1, df), p2 = tCDF(t2, df), pTOST = Math.max(p1, p2);
  const concl = pTOST < 0.05 ? '等价成立(α=0.05)' : (m > 0 && p2 < 0.05 ? '判词劣于基率(字面方向成立)' : (m < 0 && p1 < 0.05 ? '判词优于基率' : '不可判定（双向皆不显著）'));
  log(rt + ': n=' + n + ' meanD=' + m.toFixed(4) + ' sd=' + sd.toFixed(4) + ' | t1=' + t1.toFixed(3) + '(p=' + p1.toFixed(4) + ') t2=' + t2.toFixed(3) + '(p=' + p2.toFixed(4) + ') pTOST=' + pTOST.toFixed(4) + ' → ' + concl);
  log('  字面计分: 「判词不优于基率」' + (m >= 0 ? '方向成立(meanD>=0)' : '方向不成立') + '；「判词劣于基率」' + (m > 0 ? '方向成立' : '方向不成立'));
}
log('=== λ̂/γ̂（校准列，不得定版——PREREG §五） ===');
const common = preds.filter((p) => vmap[p.id] && routes.every((rt) => vmap[p.id][rt] !== undefined && vmap[p.id][rt] !== null));
const pearson = (xs, ys) => { const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0; };
let lamSum = 0, cnt = 0;
for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
  const xs = common.map((p) => vmap[p.id][routes[i]]), ys = common.map((p) => vmap[p.id][routes[j]]);
  const r = pearson(xs, ys); lamSum += r; cnt++;
  log('r(' + routes[i] + '~' + routes[j] + ')=' + r.toFixed(4) + ' (n=' + common.length + ')');
}
const lam = lamSum / cnt, gam = 3 / (1 + 2 * lam);
log('lambda=' + lam.toFixed(4) + ' → gamma=3/(1+2lambda)=' + gam.toFixed(4) + '（只记校准列）');
log('=== 写回一致性（assigned_prob=该路 implied_prob median） ===');
let mismatch = 0, nulled = 0;
for (const p of preds) {
  const ps = routes.map((rt) => (vmap[p.id] ? vmap[p.id][rt] : null)).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  let med = null;
  if (ps.length) med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
  if (med === null) nulled++;
  const diff = (med === null) !== (p.assigned_prob === null) || (med !== null && Math.abs(med - p.assigned_prob) > 1e-9);
  if (diff) { mismatch++; log('  MISMATCH pid=' + p.id + ' assigned=' + p.assigned_prob + ' median=' + med); }
}
log('mismatch=' + mismatch + ' nulled_preds=' + nulled);
const dbp = 'E:/music player/p1a-terminal/data/p1a.db';
let dbHash = 'n/a';
try { dbHash = crypto.createHash('sha256').update(fs.readFileSync(dbp)).digest('hex'); } catch (e) {}
log('DB 快照 sha256(p1a.db@计分时)=' + dbHash);
fs.writeFileSync(path.join(__dirname, 'ra-score-part2.json'), JSON.stringify({ lam, gam, mismatch, dbHash }, null, 1), 'utf8');
try { db.closeCurrent(); } catch (e) {}