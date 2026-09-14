'use strict';
const fs = require('fs');
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pick = (j) => ({
  gate: j.meta.gate, verdicts: j.meta.verdicts,
  q1: j.R4.q1_qualified.value, q1_rt: j.R4.q1_qualified.qualified_realtime, q1_bf: j.R4.q1_qualified.qualified_backfill,
  q1_excluded: j.counts.excluded,
  q2_rate: j.R4.q2_audit.rate, q2_n: j.R4.q2_audit.n, q2_ok: j.R4.q2_audit.ok,
  q3: j.R4.q3_horizon.buckets, q3_verdict: j.R4.q3_horizon.verdict, q3_longbf: j.R4.q3_horizon.long_must_be_realtime.long_backfill,
  q4: j.R4.q4_difficulty.value, q4_rt: j.R4.q4_difficulty.hardest_realtime, q4_bf: j.R4.q4_difficulty.hardest_backfill,
  q4_cov_b: j.R4.q4_difficulty.parse_coverage.pool_with_b, q4_cov_u: j.R4.q4_difficulty.parse_coverage.pool_unparsed,
  q4_pat: j.R4.q4_difficulty.b_patterns, q4_bylayer: j.R4.q4_difficulty.by_layer,
  rule7: j.R4.rule7_no_double_count,
});
const B = pick(rd('p1b/sim/out/g2-report-before-brn.json'));
const A = pick(rd('p1b/sim/out/g2-report-after-brn.json'));
console.log('BEFORE=' + JSON.stringify(B));
console.log('AFTER =' + JSON.stringify(A));
const delta = (k) => (A[k] - B[k]);
console.log('DELTA q1=' + delta('q1') + ' q4=' + delta('q4') + ' q4_rt=' + delta('q4_rt') + ' q4_bf=' + delta('q4_bf') + ' q4_cov_b=' + delta('q4_cov_b') + ' q4_cov_u=' + delta('q4_cov_u') + ' q2_rate=' + (A.q2_rate - B.q2_rate) + ' q3_short=' + (A.q3.short - B.q3.short) + ' q3_mid=' + (A.q3.mid - B.q3.mid) + ' q3_long=' + (A.q3.long - B.q3.long));
console.log('GATE ' + B.gate + ' -> ' + A.gate + ' | verdicts ' + JSON.stringify(B.verdicts) + ' -> ' + JSON.stringify(A.verdicts));
console.log('RULE7 ' + JSON.stringify(B.rule7.overlap_ids.length) + ' -> ' + JSON.stringify(A.rule7.overlap_ids.length));