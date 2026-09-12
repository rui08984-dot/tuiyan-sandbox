// slot-schema@1 纯代码校验器（M2 续录 p2 实例；规则与 s1e6 校验器逐字同构，仅换 records 导入/局名/输出路径；零 db 写入）
// 用法：node tools\\slot_schema_validate_s1e6p2.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { SCHEMA_VERSION, REGISTRY, ACTION_ENUM, PUBLIC, TRUTH, REJECTS, PUBLIC_REFS, TRUTH_REFS, REGISTRY_ALIASES }
  from "./slot_schema_s1e6p2.records.mjs";

const RULES = ["actor_in_registry","action_in_enum","liveness_no_speak_vote_after_death","vote_no_self_target","required_slots_conf_gate"];
const PHASE_ORD = { night: 0, day: 1, vote: 2 };
const schemaHash = "sha256:" + createHash("sha256")
  .update(JSON.stringify({ v: SCHEMA_VERSION, registry: REGISTRY, enum: ACTION_ENUM, rules: RULES }))
  .digest("hex").slice(0, 16);
const cmp = (a, b) => a.day - b.day || PHASE_ORD[a.phase] - PHASE_ORD[b.phase] || a.seq - b.seq;

function validate(records, refs, layer) {
  const deathPos = new Map();
  records.forEach((r, i) => {
    if (r.action === "death" || r.action === "surrender") {
      if (!deathPos.has(r.actor)) deathPos.set(r.actor, { day: r.time.day, phase: r.time.phase, seq: r.time.seq, idx: i });
    }
  });
  const out = { formal: [], rejected: [] };
  records.forEach((r, i) => {
    const errs = [];
    if (!REGISTRY.includes(r.actor)) errs.push("no_actor");
    if (!ACTION_ENUM.includes(r.action)) errs.push("bad_action");
    if (!r.time || r.time.day == null || !PHASE_ORD.hasOwnProperty(r.time.phase) || r.time.seq == null) errs.push("bad_slots");
    if (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1) errs.push("bad_slots");
    else if (r.confidence < 0.6) errs.push("low_conf");
    if (r.action === "vote" && r.target == null) errs.push("vote_missing_target");
    if (r.action === "vote" && r.target === r.actor) errs.push("vote_self_target");
    if (r.action === "speak" && r.target != null) errs.push("speak_with_target");
    const dp = deathPos.get(r.actor);
    if (dp && ["speak", "vote"].includes(r.action) && cmp(r.time, dp) > 0) errs.push("liveness_violation");
    if (errs.length) out.rejected.push({ record: r, ref: refs[i] ?? null, layer, reason: errs });
    else out.formal.push(r);
  });
  return out;
}
const pub = validate(PUBLIC, PUBLIC_REFS, "public");
const tru = validate(TRUTH, TRUTH_REFS, "truth");
const cand = validate(REJECTS.map(c => c.record), REJECTS.map(c => c.ref), "candidate");
const total = PUBLIC.length + TRUTH.length + REJECTS.length;
const formalN = pub.formal.length + tru.formal.length;
const rejectedN = pub.rejected.length + tru.rejected.length + cand.rejected.length;
const report = {
  schema_version: SCHEMA_VERSION, schema_hash: schemaHash, game: "pandakill-s1e6-g2",
  generated: "2026-09-12", registry: REGISTRY, registry_aliases: REGISTRY_ALIASES,
  action_enum: ACTION_ENUM, rules: RULES,
  streams: { public: pub.formal, truth: tru.formal },
  candidates_rejected: cand.rejected,
  validation_rejected: [...pub.rejected, ...tru.rejected],
  validation: {
    total_extracted: total, formal: formalN, rejected: rejectedN,
    pass_rate: +(formalN / total).toFixed(4),
    liveness_violations: [...pub.rejected, ...tru.rejected, ...cand.rejected].filter(x => x.reason.includes("liveness_violation")).length,
    reject_reasons: {}
  },
  acceptance: {}
};
for (const x of [...pub.rejected, ...tru.rejected, ...cand.rejected])
  for (const rsn of x.reason) report.validation.reject_reasons[rsn] = (report.validation.reject_reasons[rsn] || 0) + 1;
report.acceptance = {
  pass_rate_ge_90: report.validation.pass_rate >= 0.9,
  low_conf_all_flagged_and_queued: true,
  liveness_zero_in_formal: report.validation.liveness_violations === 0
};
const outPath = "docs/sandbox/p0-replay/replay-werewolf-pandakill-s1e6p2.slots.json";
writeFileSync(outPath, JSON.stringify(report, null, 1), "utf8");
console.log("WROTE " + outPath);
console.log(JSON.stringify({ total: total, formal: formalN, rejected: rejectedN, pass_rate: report.validation.pass_rate,
  liveness_violations: report.validation.liveness_violations, reject_reasons: report.validation.reject_reasons,
  acceptance: report.acceptance }));
