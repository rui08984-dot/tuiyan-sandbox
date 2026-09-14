'use strict';
// 口径B 微步2 第二段：① 池判定升级 + horizon 发布日口径 + Q1/meta/文本披露（在 patch1 之后运行）
const fs = require('fs');
const F = 'E:/music player/p1b/scripts/g2-report.cjs';
let src = fs.readFileSync(F, 'utf8');
const reps = [];
function rep(anchor, replacement, label) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点非唯一或缺失(' + n + '): ' + label);
  src = src.replace(anchor, replacement);
  reps.push(label);
}
const LF = String.fromCharCode(10);
// ── P3a: no_resolve_date 分支升级（derive → 入池；失败 → failed 计数；无规则 → 原样排除）──
rep("  if (!r.rd) { bump(counts.excluded, 'no_resolve_date'); continue; }",
"  let rdEff = r.rd, ddInfo = null;" + LF
+ "  if (!rdEff) {" + LF
+ "    const dd = tryDerive(r);" + LF
+ "    if (dd.ok) { rdEff = dd.date; ddInfo = dd; countsDD.derived_rows++; bump(countsDD.derived_by_kind, dd.kind); }" + LF
+ "    else if (dd.reason === 'no_rule' || dd.reason === 'no_kind' || dd.reason === 'resolve_json_parse') { bump(counts.excluded, 'no_resolve_date'); continue; }" + LF
+ "    else {" + LF
+ "      bump(counts.excluded, 'no_resolve_date');" + LF
+ "      countsDD.failed_rows++; bump(countsDD.failed_by_kind, dd.kind || 'unknown');" + LF
+ "      if (countsDD.failed_ids_sample.length < 10) countsDD.failed_ids_sample.push(r.id);" + LF
+ "      continue;" + LF
+ "    }" + LF
+ "  }", 'P3a');
// ── P3b: cutoff 比对用 rdEff ＋ derived 行 horizon 改发布日口径 ──
rep("  if (cutoff === null || !(String(cutoff) < String(r.rd))) { bump(counts.excluded, 'cutoff_not_before_event'); continue; }",
"  if (cutoff === null || !(String(cutoff) < String(rdEff))) { bump(counts.excluded, 'cutoff_not_before_event'); continue; }" + LF
+ "  if (ddInfo && r.created_at) { // 口径 B：derived 行 horizon 按发布日口径（effective_date - created_at）" + LF
+ "    const t1 = new Date(rdEff + 'T00:00:00Z').getTime();" + LF
+ "    const t0 = new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime();" + LF
+ "    if (!isNaN(t1) && !isNaN(t0)) hDays = (t1 - t0) / 86400000;" + LF
+ "  }", 'P3b');
// ── P3c: pool 行记录 effective_date / rd_derived ──
rep("    backfill: bf, cutoff: cutoff, cutoff_mode: cutoffMode,",
"    backfill: bf, cutoff: cutoff, cutoff_mode: cutoffMode, effective_date: rdEff, rd_derived: ddInfo ? ddInfo.kind : null,", 'P3c');
// ── P4: Q1 挂 date_derivation 披露 ──
rep("Q1.verdict = Q1.pass ? 'PASS' : 'FAIL';",
"Q1.verdict = Q1.pass ? 'PASS' : 'FAIL';" + LF
+ "Q1.date_derivation = { version: DD_VERSION, enabled: countsDD.enabled, contract_sha256: countsDD.sha256, rules: countsDD.rules," + LF
+ "  derived_rows: countsDD.derived_rows, derived_by_kind: countsDD.derived_by_kind," + LF
+ "  failed_rows: countsDD.failed_rows, failed_by_kind: countsDD.failed_by_kind, failed_ids_sample: countsDD.failed_ids_sample," + LF
+ "  note: '口径 B（2026-09-14）：无 resolve.date 但 date_derivations[kind] 可换算的题以 effective_date（发布日口径）入池；cutoff 判定不变（细则 B）；derived 行 horizon 按发布日口径；换算失败行计入 failed_*（不静默丢）' };", 'P4');
// ── P5: 文本报告披露（① 节内）──
rep("L.push('    ' + Q1.note);",
"L.push('    ' + Q1.note);" + LF
+ "if (countsDD.enabled) {" + LF
+ "  L.push('    [口径B·date_derivation v' + DD_VERSION + '] 契约表 sha256=' + String(countsDD.sha256 || '').slice(0, 12) + ' | 规则 ' + countsDD.rules + ' kind');" + LF
+ "  L.push('    换算入池 ' + countsDD.derived_rows + ' 行 | 按 kind: ' + Object.keys(countsDD.derived_by_kind).map((k) => k + ' ' + countsDD.derived_by_kind[k]).join(' / '));" + LF
+ "  L.push('    换算失败 ' + countsDD.failed_rows + ' 行' + (countsDD.failed_rows ? '（' + Object.keys(countsDD.failed_by_kind).map((k) => k + ' ' + countsDD.failed_by_kind[k]).join(' / ') + '）样本id: ' + countsDD.failed_ids_sample.join(',') : ''));" + LF
+ "}", 'P5');
// ── P6: meta 增 version + 契约表 sha 引用 ──
rep("    include_intake: INCLUDE_INTAKE, intake_scope: 'intake_questions 未入账（非 G2 口径，不参与达标）' },",
"    date_derivation_version: DD_VERSION, contract_sha256: countsDD.sha256," + LF
+ "    include_intake: INCLUDE_INTAKE, intake_scope: 'intake_questions 未入账（非 G2 口径，不参与达标）' },", 'P6');
fs.writeFileSync(F, src, 'utf8');
console.log('PATCHED_PART2 ok: ' + reps.join(','));
