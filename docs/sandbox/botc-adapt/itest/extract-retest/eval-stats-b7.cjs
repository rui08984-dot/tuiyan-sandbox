'use strict';
/* eval-stats-b7.cjs — B7 修复后复测统计（机械计算，对照 B5 全量基线行）
 * 用法: node eval-stats-b7.cjs
 * 输入: raw-b7/all-results-b7-l3.json（本次，L3 出卡形态）+ raw/all-results.json（B5 对照）+ samples.json
 * 输出: stats-b7.json（复测前后对照表全部数字来源）
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const after = JSON.parse(fs.readFileSync(path.join(HERE, 'raw-b7', 'all-results-b7-l3.json'), 'utf8'));
const beforeAll = JSON.parse(fs.readFileSync(path.join(HERE, 'raw', 'all-results.json'), 'utf8'));
const samplesJson = JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8'));
// p1b 真实分流代码（B7 护栏版）
const roles = require(path.join(ROOT0(), 'p1b', 'src', 'botc', 'roles.js'));
const claimsMod = require(path.join(ROOT0(), 'p1b', 'src', 'botc', 'claims.js'));
const extractPrompt = require(path.join(ROOT0(), 'p1b', 'src', 'botc', 'extractPrompt.js'));
function ROOT0() { return path.join(__dirname, '..', '..', '..', '..', '..'); }
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
function analyze(r) {
  const claims = (r.out && (r.out.l3_claims || r.out.claims)) || []; // 优先 L3 出卡形态（与生产一致）
  const cls = claims.map(c => classifyClaim(c, r.edition));
  let split = { main: [], botc: [], warnings: [] }, throws = false, splitErr = null;
  try {
    split = claimsMod.splitBotcClaims(r.edition, claims.map(c => ({
      seat: c.subject_seat, subject_seat: c.subject_seat, predicate: c.predicate, object: c.object })));
  } catch (e) { throws = true; splitErr = String((e && e.message) || e).slice(0, 120); }
  const counts = { botc: 0, main_role_ok: 0, main_role_fail: 0, main_generic: 0, main_misaligned: 0 };
  cls.forEach(x => counts[x]++);
  const landed = throws ? 0 : split.main.length + split.botc.length;
  const aligned = throws ? 0 : counts.botc + counts.main_role_ok + counts.main_generic;
  const isStatus = /醉酒|醉了|中毒|被投毒|毒了/.test(r.text);
  const isAlign = /恶魔|爪牙/.test(r.text);
  const gotStatus = claims.filter(c => BOTC4.includes(c.predicate) && c.predicate.startsWith('status_')).length;
  return { id: r.id, edition: r.edition, cat: r.cat, ms: r.ms, structural_ok: !r.error, error: r.error,
    attempts_internal: (r.out && r.out.meta && r.out.meta.attempts) || null,
    warnings: ((r.out && r.out.warnings) || []).length,
    n_claims: claims.length, classes: counts, split_throws: throws, splitErr,
    landed_claims: landed, aligned_claims: aligned,
    is_status_sample: isStatus, is_align_sample: isAlign,
    got_status_claims: gotStatus,
    claims_detail: claims.map((c, i) => ({ i, subject_seat: c.subject_seat, predicate: c.predicate, object: c.object, class: cls[i] })) };
}
const rowsB7 = after.results.map(analyze);
// B5 对照行（同一样本子集）
const IDS = rowsB7.map(r => r.id);
const rowsB5 = beforeAll.results.filter(r => IDS.includes(r.id)).map(analyze);
function agg(rows) {
  const ok = rows.filter(r => r.structural_ok);
  const claims = ok.reduce((s, r) => s + r.n_claims, 0);
  const landed = ok.reduce((s, r) => s + r.landed_claims, 0);
  const aligned = ok.reduce((s, r) => s + r.aligned_claims, 0);
  const counts = { botc: 0, main_role_ok: 0, main_role_fail: 0, main_generic: 0, main_misaligned: 0 };
  ok.forEach(r => { for (const k of Object.keys(counts)) counts[k] += r.classes[k]; });
  const ms = ok.map(r => r.ms).sort((a, b) => a - b);
  return { samples: rows.length, structural_ok: ok.length,
    total_claims: claims, landed_claims: landed, aligned_claims: aligned,
    entry_rate: claims ? landed / claims : null, aligned_rate: claims ? aligned / claims : null,
    claim_classes: counts, throw_samples: ok.filter(r => r.split_throws).map(r => r.id),
    status_samples: rows.filter(r => r.is_status_sample),
    status_captured: rows.filter(r => r.is_status_sample && r.n_claims > 0).map(r => r.id),
    status_captured_as_status: rows.filter(r => r.is_status_sample && r.got_status_claims > 0).map(r => r.id),
    align_samples: rows.filter(r => r.is_align_sample),
    align_captured_as_botc: rows.filter(r => r.is_align_sample && r.classes.botc > 0).map(r => r.id),
    misaligned_claims: counts.main_misaligned,
    median_ms: ms.length ? ms[Math.floor(ms.length / 2)] : null };
}
const A = agg(rowsB7), B = agg(rowsB5);
const perSample = IDS.map(id => ({ id, edition: (samplesJson.samples.find(s => s.id === id)).edition,
  cat: (samplesJson.samples.find(s => s.id === id)).cat,
  before: rowsB5.find(r => r.id === id), after: rowsB7.find(r => r.id === id) }));
const stats = { generated_at: new Date().toISOString(), endpoint: after.endpoint,
  subset: IDS, before: B, after: A, per_sample: perSample,
  notes: { claimsGuardrail: 'B7 后 splitBotcClaims 词修复+降级，不再 400 拒整批', carrier: 'L2 载体 + L3 还原出卡' } };
fs.writeFileSync(path.join(HERE, 'stats-b7.json'), JSON.stringify(stats, null, 2));
console.log('BEFORE: claims=' + B.total_claims + ' entry=' + (B.entry_rate * 100).toFixed(1) + '% aligned=' + (B.aligned_rate * 100).toFixed(1) + '% status_captured=' + B.status_captured.length + '/' + B.status_samples.length + ' as_status=' + B.status_captured_as_status.length + ' align_as_botc=' + B.align_captured_as_botc.length + '/' + B.align_samples.length + ' throws=' + JSON.stringify(B.throw_samples) + ' misaligned=' + B.misaligned_claims);
console.log('AFTER : claims=' + A.total_claims + ' entry=' + (A.entry_rate * 100).toFixed(1) + '% aligned=' + (A.aligned_rate * 100).toFixed(1) + '% status_captured=' + A.status_captured.length + '/' + A.status_samples.length + ' as_status=' + A.status_captured_as_status.length + ' align_as_botc=' + A.align_captured_as_botc.length + '/' + A.align_samples.length + ' throws=' + JSON.stringify(A.throw_samples) + ' misaligned=' + A.misaligned_claims);
for (const p of perSample) {
  console.log(p.id + ' [' + p.cat + '] claims ' + p.before.n_claims + '->' + p.after.n_claims
    + ' aligned ' + p.before.aligned_claims + '->' + p.after.aligned_claims
    + ' throws ' + p.before.split_throws + '->' + p.after.split_throws
    + ' classes ' + JSON.stringify(p.after.classes));
}