'use strict';
/* eval-stats.cjs — B5 双层评估统计（零手算：全部数字由本脚本从 raw 实测输出机械计算）
 * 抽取层：结构成功/延迟(中位/P90 线性插值+最近秩)/逐条判定聚合（判定来自 judgments.json 人工语义层）
 * 映射层：逐 claim 机械分类（require p1b 真实 splitBotcClaims + roles.js）——
 *   botc          = BOTC 专属谓词(落 botc_claims)
 *   main_role_ok  = claims_role/is_role 且 resolveRole+roleInEdition 通过（落主表）
 *   main_role_fail= claims_role/is_role 但角色不可解析或越剧本（confirm 时 400，整批不入账）
 *   main_generic  = said/voted/did_action/is_good（主表通用透传）
 *   main_misaligned = is_wolf（透传主表但 BOTC 无狼阵营，语义错位）
 * 输出: stats.json（报告全部数字来源）
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..', '..', '..');
const all = JSON.parse(fs.readFileSync(path.join(HERE, 'raw', 'all-results.json'), 'utf8'));
const samplesJson = JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8'));
const judgments = JSON.parse(fs.readFileSync(path.join(HERE, 'judgments.json'), 'utf8'));
const jd = Object.fromEntries(judgments.judgments.map(j => [j.id, j]));

// —— p1b 真实分流代码（只读复用，零改动）——
const roles = require(path.join(ROOT, 'p1b', 'src', 'botc', 'roles.js'));
let claimsMod = null, claimsMode = 'mirror';
try {
  claimsMod = require(path.join(ROOT, 'p1b', 'src', 'botc', 'claims.js'));
  claimsMode = 'real-splitBotcClaims';
} catch (e) { claimsMode = 'mirror(' + e.message.slice(0, 80) + ')'; }
const BOTC4 = ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned'];
const ROLE2 = ['claims_role', 'is_role'];

function classifyClaim(c, script) {
  if (BOTC4.includes(c.predicate)) return 'botc';
  if (ROLE2.includes(c.predicate)) {
    const r = roles.resolveRole(c.object);
    if (r && roles.roleInEdition(r, script)) return 'main_role_ok';
    return 'main_role_fail';
  }
  if (c.predicate === 'is_wolf') return 'main_misaligned';
  return 'main_generic';
}
function splitThrows(script, claims) {
  if (claimsMode !== 'real-splitBotcClaims') {
    return claims.some(c => classifyClaim(c, script) === 'main_role_fail');
  }
  try {
    claimsMod.splitBotcClaims(script, claims.map(c => ({
      seat: c.subject_seat, subject_seat: c.subject_seat,
      predicate: c.predicate, object: c.object
    })));
    return false;
  } catch (e) { return true; }
}

// —— 延迟统计 ——
function latencyStats(msArr) {
  const a = msArr.slice().sort((x, y) => x - y);
  const n = a.length;
  const lin = (q) => { const p = (n - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo] + (a[hi] - a[lo]) * (p - lo); };
  const nr = (q) => a[Math.min(n - 1, Math.ceil(q * n) - 1)];
  return { n, min: a[0], max: a[n - 1], median: n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2,
    p90_linear: lin(0.9), p90_nearest: nr(0.9), mean: a.reduce((s, x) => s + x, 0) / n, total: a.reduce((s, x) => s + x, 0) };
}

const CLASS_KEYS = ['botc', 'main_role_ok', 'main_role_fail', 'main_generic', 'main_misaligned'];
const rows = [];
for (const r of all.results) {
  const claims = (r.out && r.out.claims) || [];
  const cls = claims.map(c => classifyClaim(c, r.edition));
  const throws = r.error ? null : splitThrows(r.edition, claims);
  const counts = {}; CLASS_KEYS.forEach(k => counts[k] = cls.filter(x => x === k).length);
  const landed = throws ? 0 : claims.length;
  const aligned = throws ? 0 : counts.botc + counts.main_role_ok + counts.main_generic;
  const j = jd[r.id] || {};
  rows.push({
    id: r.id, edition: r.edition, cat: r.cat, ms: r.ms,
    structural_ok: !r.error, error: r.error,
    attempts_internal: (r.out && r.out.meta && r.out.meta.attempts) || null,
    attempts_external: r.attempts_external || 0,
    warnings: ((r.out && r.out.warnings) || []).length,
    event_type: (r.out && r.out.event && r.out.event.type) || null,
    n_claims: claims.length, classes: counts, split_throws: throws,
    landed_claims: landed, aligned_claims: aligned,
    claims_detail: claims.map((c, i) => ({ i, subject_seat: c.subject_seat, predicate: c.predicate, object: c.object, class: cls[i] })),
    verdict: j.verdict || null, verdict_reason: j.reason || null,
    exp_min_claims: ((samplesJson.samples.find(s => s.id === r.id) || {}).expected.claims || []).filter(c => c.predicate_ideal !== 'said' || c.object !== '含糊表态').length
  });
}
const agg = (list) => {
  const ok = list.filter(r => r.structural_ok);
  const claims = ok.reduce((s, r) => s + r.n_claims, 0);
  const landed = ok.reduce((s, r) => s + r.landed_claims, 0);
  const aligned = ok.reduce((s, r) => s + r.aligned_claims, 0);
  const cCounts = {}; CLASS_KEYS.forEach(k => cCounts[k] = ok.reduce((s, r) => s + r.classes[k], 0));
  const verdicts = { correct: list.filter(r => r.verdict === 'correct').length,
    suspect: list.filter(r => r.verdict === 'suspect').length,
    wrong: list.filter(r => r.verdict === 'wrong').length };
  return {
    samples: list.length, structural_ok: ok.length,
    latency: latencyStats(ok.map(r => r.ms)),
    total_claims: claims, landed_claims: landed, aligned_claims: aligned,
    claim_entry_rate: claims ? landed / claims : null,
    claim_aligned_rate: claims ? aligned / claims : null,
    claim_classes: cCounts,
    split_throw_samples: ok.filter(r => r.split_throws).map(r => r.id),
    verdicts, strict_error_rate: list.length ? verdicts.wrong / list.length : null,
    suspect_incl_error_rate: list.length ? (verdicts.wrong + verdicts.suspect) / list.length : null,
    clean_rate: list.length ? verdicts.correct / list.length : null
  };
};
const byEd = {};
for (const ed of ['tb', 'bmr', 'snv']) byEd[ed] = agg(rows.filter(r => r.edition === ed));
const stats = {
  generated_at: new Date().toISOString(),
  endpoint: all.endpoint, mapping_impl: claimsMode,
  n_samples: rows.length,
  overall: agg(rows),
  by_edition: byEd,
  rows,
  flagged: rows.filter(r => r.verdict !== 'correct').map(r => ({ id: r.id, verdict: r.verdict, reason: r.verdict_reason, claims: r.claims_detail }))
};
fs.writeFileSync(path.join(HERE, 'stats.json'), JSON.stringify(stats, null, 2));
const o = stats.overall;
console.log('mapping_impl=' + claimsMode);
console.log('samples=' + o.samples + ' structural_ok=' + o.structural_ok);
console.log('latency ms: median=' + o.latency.median.toFixed(1) + ' p90_lin=' + o.latency.p90_linear.toFixed(1) + ' p90_nr=' + o.latency.p90_nearest.toFixed(1));
for (const ed of ['tb', 'bmr', 'snv']) {
  const e = byEd[ed];
  console.log(ed + ': ok=' + e.structural_ok + '/' + e.samples + ' claims=' + e.total_claims + ' entry=' + (e.claim_entry_rate * 100).toFixed(1) + '% aligned=' + (e.claim_aligned_rate * 100).toFixed(1) + '% median=' + e.latency.median.toFixed(0) + 'ms strict_err=' + (e.strict_error_rate * 100).toFixed(1) + '%');
}
console.log('classes=' + JSON.stringify(o.claim_classes) + ' throw_samples=' + JSON.stringify(o.split_throw_samples));
console.log('verdicts=' + JSON.stringify(o.verdicts));