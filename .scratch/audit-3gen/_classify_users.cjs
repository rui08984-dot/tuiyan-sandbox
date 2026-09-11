// 审计脚本B：全量 user/message 分类输出（含全部注入类型标签），供人工校准
const fs = require("fs");
const GENS = [
  ["gen1", "E:/music player/.scratch/session-78e71e4a/session.jsonl"],
  ["gen2", "E:/music player/.scratch/session-39e58053/session.jsonl"],
  ["gen3", "E:/music player/_session_extract/session-1eec2bbb/session.jsonl"],
];
const OUTDIR = "E:/music player/.scratch/audit-3gen";
function textOf(d) {
  let c = d && d.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(b => (typeof b === "string" ? b : (b && b.text) || "")).filter(Boolean).join("\n");
  if (c && typeof c === "object") return c.text || c.content || "";
  return "";
}
const RULES = [
  ["goal_round", /^<goal_round>/],
  ["sys-reminder", /^<system-reminder>|^<system_warning>/],
  ["skill_content", /^<skill_content>|^<available_skills>/],
  ["mnemon", /\[MNEMON\]|^MNEMON RUNTIME|^<runtime-memory|<runtime_context|^Current runtime context/],
  ["bg-subagent", /^Background (subagent|agent)\b|^Background subagent/],
  ["bg-job", /^background job|^Job finished|job finish|\[job/i],
  ["approval", /^The approval policy changed/],
  ["genui", /\[genui-action\]/],
  ["agentteams", /^AgentTeams message|AgentTeams message from|task update:|^\[AgentTeams/],
  ["vision", /^Vision Router|^<vision/],
  ["auto-continue", /^(交接文档：|继续并查看之前操作|上一步工具|\(上一步工具)/],
  ["task-notice", /^<task-notification>|^Escalation|^Task notification/i],
  ["workflow", /^<workflow|^Workflow notice/i],
];
for (const [tag, src] of GENS) {
  const lines = fs.readFileSync(src, "utf8").split(/\r?\n/).filter(Boolean);
  const outL = [];
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
    if (o.type !== "user/message") continue;
    total++;
    const raw = textOf(o.data || o).trim();
    if (!raw) { outL.push("L" + (i+1) + " [EMPTY]"); continue; }
    const flat = raw.replace(/\s+/g, " ");
    let injTag = "";
    for (const [name, re] of RULES) { if (re.test(flat) || flat.includes(name === "agentteams" ? "AgentTeams message" : "\u0000")) { injTag = name; break; } }
    if (!injTag) { for (const s of ["AgentTeams message", "task update:", "background job", "Vision Router", "<system-reminder>", "MNEMON", "skill_content", "genui-action", "Background subagent"]) { if (flat.includes(s)) { injTag = "substr:" + s; break; } } }
    const ts = o.time ? new Date(o.time + 28800000).toISOString().replace("T"," ").slice(5,16) : "?";
    const head = flat.slice(0, 150);
    outL.push("L" + (i+1) + " @" + ts + " [" + (injTag || "HUMAN?") + "] :: " + head);
  }
  fs.writeFileSync(OUTDIR + "/_class_" + tag + ".txt", "### " + tag + " total user/message=" + total + "\n" + outL.join("\n"), "utf8");
  const kept = outL.filter(l => l.includes("[HUMAN?]")).length;
  console.log(tag, "total=" + total, "human?=" + kept);
}
