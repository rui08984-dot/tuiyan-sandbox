'use strict';
// R-A 逐判据字面计分（PREREG-判词重跑-v1 §三/§四/§五；判据唯一来源，禁语义重释）
const fs = require('fs');
const path = require('path');
const { db } = require('../../p1b/src/deps');
const { tCDF } = require('./_ra-stats.cjs');
const conn = db.getConnection();
const preds = conn.prepare("SELECT p.id, p.layer, p.outcome, p.assigned_prob, g.game_type FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.source='sim' AND p.layer IN ('L1','L6') AND p.outcome IN ('true','false') ORDER BY p.id").all();
const vs = conn.prepare('SELECT prediction_id, prompt_variant, implied_prob FROM verdicts ORDER BY id').all();
const vmap = {};
for (const v of vs) { (vmap[v.prediction_id] = vmap[v.prediction_id] || {})[v.prompt_variant] = v.implied_prob; }
const routes = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const y = (o) => (o === 'true' ? 1 : 0);
const L6 = preds.filter((p) => p.layer === 'L6');
const L1 = preds.filter((p) => p.layer === 'L1');
const groupTrue = {}; // (game_type,layer) 内 true 总数（LOO 基率预测器用）
for (const p of preds) { const k = p.game_type + '|' + p.layer; groupTrue[k] = (groupTrue[k] || 0) + y(p.outcome); }
// LOO 基率预测器：排除本条（outcome 不进基率）——loadBaseline 同口径
const baseRate = (p) => { const k = p.game_type + '|' + p.layer; const n = (p.layer === 'L6' ? L6.length : L1.length) - 1; const t = groupTrue[k] - y(p.outcome); return t / n; };
const out = [];
const log = (s) => { out.push(s); console.log(s); };
log('R-A SCORE rows: preds=' + preds.length + ' L6=' + L6.length + ' L1=' + L1.length + ' verdicts=' + vs.length);
// impute（PREREG §四，跑前规则逐字应用）：路失败行 dataset型→0.5，crowd型→该型基率
let impCount = 0;
const imputed = [];
function brierRoute(rt, pop, useImpute) {
  let s = 0, n = 0, imp = 0;
  for (const p of pop) {
    const raw = vmap[p.id] ? vmap[p.id][rt] : undefined;
    let prob = raw, tag = '';
    if (raw === undefined || raw === null) {
      if (!useImpute) continue;
      const k = p.game_type + '|' + p.layer;
      const crowdOK = (p.layer === 'L6' ? L6.length : L1.length) >= 10;
      prob = crowdOK ? baseRate(p) : 0.5;
      imp++; impCount++;
      tag = crowdOK ? '(基率impute=' + prob.toFixed(3) + ')' : '(0.5impute)';
      if (pop === preds) imputed.push({ pid: p.id, rt, prob, crowd: crowdOK });
    }
    s += Math.pow(prob - y(p.outcome), 2); n++;
    if (tag) log('  IMPUTE pid=' + p.id + ' ' + rt + tag);
  }
  return { b: n ? s / n : NaN, n, imp };
}
log('=== 逐路单路 Brier（全量90点含impute=PREREG 判据口径 | 无impute=观察口径） ===');
const res = {};
for (const rt of routes) {
  const wi = brierRoute(rt, preds, true), wo = brierRoute(rt, preds, false);
  const wi6 = brierRoute(rt, L6, true), wo6 = brierRoute(rt, L6, false);
  const wi1 = brierRoute(rt, L1, true), wo1 = brierRoute(rt, L1, false);
  res[rt] = { wi, wo, wi6, wo6, wi1, wo1 };
  log(rt + ': 全量=' + wi.b.toFixed(4) + '(n=' + wi.n + ',imp=' + wi.imp + ') [raw=' + wo.b.toFixed(4) + ' n=' + wo.n + ']  L6=' + wi6.b.toFixed(4) + '(n=' + wi6.n + ') [raw=' + wo6.b.toFixed(4) + ']  L1=' + wi1.b.toFixed(4) + '(n=' + wi1.n + ') [raw=' + wo1.b.toFixed(4) + ']');
}
log('impute 总行数=' + impCount);
log('=== 判据字面计分 ===');
const v1full = res.v1_evidence.wi.b;
log('R-A1 读数门: v1 全量 Brier=' + v1full.toFixed(4) + ' ≤0.05 → ' + (v1full <= 0.05 ? '达成' : '未达成') + '；>0.10 → ' + (v1full > 0.10 ? '触发工程排查（查 evidence_json+prompt 组装，禁改判据）' : '未触发'));
const v1L1 = res.v1_evidence.wi1.b;
log('R-A2 L1 acquiescence 双向: v1@L1 Brier=' + v1L1.toFixed(4) + ' vs 锚 0.5970 → ' + (v1L1 >= 0.597 ? '不向 0 收敛（acquiescence 独立于信息真空成立）' : '向 0 收敛（偏差可被证据矫正）') + '；Δ=' + (v1L1 - 0.597).toFixed(4));
const v2full = res.v2_skeptical.wi.b;
log('R-A3 v2 对照: v2 全量 Brier=' + v2full.toFixed(4) + '（旧 0.3285，预期复刻 ~0.33；Δ=' + (v2full - 0.3285).toFixed(4) + '）；v2<0.25 → ' + (v2full < 0.25 ? '触发泄漏排查' : '未触发'));
const d36 = res.v3_baserate.wo6.b - res.v2_skeptical.wo6.b;
log('v3@L6 ΔBrier(v3-v2, 观察口径)=' + d36.toFixed(4) + ' → |Δ|≤0.06 噪声条款内=' + (Math.abs(d36) <= 0.06 ? '是（仅方向性信号：' + (d36 < 0 ? 'v3 优' : 'v2 优') + '）' : '否（超出 ±0.06）'));
fs.writeFileSync(path.join(__dirname, 'ra-score-part1.json'), JSON.stringify({ res, imputed, impCount }, null, 1), 'utf8');
try { db.closeCurrent(); } catch (e) {}