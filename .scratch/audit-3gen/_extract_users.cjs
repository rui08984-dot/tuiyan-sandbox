// 审计脚本A：三代真人用户消息提取（带行号/时间）
const fs = require("fs");
const GENS = [
  ["gen1-78e71e4a", "E:/music player/.scratch/session-78e71e4a/session.jsonl"],
  ["gen2-39e58053", "E:/music player/.scratch/session-39e58053/session.jsonl"],
  ["gen3-1eec2bbb", "E:/music player/_session_extract/session-1eec2bbb/session.jsonl"],
];
const OUTDIR = "E:/music player/.scratch/audit-3gen";
const clip = (s, n) => { s = (s||"").replace(/\s+/g," ").trim(); return s.length>n ? s.slice(0,n)+"…(截)" : s; };
const INJ = /^(<goal_round>|<system-reminder>|<skill_content>|<available_skills>|MNEMON\b|<runtime-memory|<runtime_context|Vision Router|background job|Background job|⚡|\[job|\[genui-action\]|AgentTeams message|task update|<task-notification|job_output|\[status:|Job |<workflow|<command-)/i;
const SUBSTR = ["AgentTeams message from", "task update:", "background job", "Vision Router", "<system-reminder>", "<goal_round>", "MNEMON RUNTIME", "<skill_content>", "job finish", "[genui-action]", "AgentTeams message"];
for (const [tag, src] of GENS) {
  const lines = fs.readFileSync(src, "utf8").split(/\r?\n/).filter(Boolean);
  const outL = [];
  let kept = 0, dropped = 0;
  const dropBy = {};
  for (let i = 0; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
    if (o.type !== "user/message") continue;
    let d = o.data || o;
    let c = d.content;
    let t = "";
    if (typeof c === "string") t = c;
    else if (Array.isArray(c)) t = c.map(b => (typeof b === "string" ? b : (b && b.text) || "")).filter(Boolean).join("\n");
    else if (c && typeof c === "object") t = c.text || c.content || "";
    const raw = t.trim();
    if (!raw) { dropped++; dropBy["(empty)"]=(dropBy["(empty)"]||0)+1; continue; }
    const flat = raw.replace(/\s+/g, " ");
    let inj = INJ.test(raw), why = "prefix";
    if (!inj) { for (const s of SUBSTR) { if (flat.includes(s)) { inj = true; why = s; break; } } }
    if (inj) { dropped++; dropBy[why]=(dropBy[why]||0)+1; continue; }
    kept++;
    const ts = o.time ? new Date(o.time + 28800000).toISOString().replace("T"," ").slice(5,16) : "?";
    outL.push("L" + (i+1) + " @" + ts + " :: " + clip(raw, 600));
  }
  const stat = "KEPT=" + kept + " DROPPED=" + dropped + " dropBy=" + JSON.stringify(dropBy);
  fs.writeFileSync(OUTDIR + "/_users_" + tag + ".txt", "### " + tag + " " + stat + "\n" + outL.join("\n"), "utf8");
  console.log(tag, stat);
}
