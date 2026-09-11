// 审计脚本C2：114 子代理终态全扫 v2（修正 assistant text 提取）
const fs = require("fs");
const path = require("path");
const GENS = [
  ["gen1", "E:/music player/.scratch/session-78e71e4a/session.jsonl", "E:/music player/.scratch/session-78e71e4a/subagents"],
  ["gen2", "E:/music player/.scratch/session-39e58053/session.jsonl", "E:/music player/.scratch/session-39e58053/subagents"],
  ["gen3", "E:/music player/_session_extract/session-1eec2bbb/session.jsonl", "E:/music player/_session_extract/session-1eec2bbb/subagents"],
];
const OUTDIR = "E:/music player/.scratch/audit-3gen";
function textOf(d) {
  if (!d) return "";
  let blocks = null;
  if (d.message && Array.isArray(d.message.content)) blocks = d.message.content;
  else if (Array.isArray(d.content)) blocks = d.content;
  if (blocks) return blocks.map(b => (b && b.type === "text" && typeof b.text === "string") ? b.text : "").filter(Boolean).join("\n");
  let c = d.content;
  if (typeof c === "string") return c;
  if (c && typeof c === "object") return c.text || "";
  if (d.message && typeof d.message.content === "string") return d.message.content;
  return "";
}
const clip = (s, n) => { s = (s||"").replace(/\s+/g," ").trim(); return s.length>n ? s.slice(0,n)+"…" : s; };
const all = [];
for (const [gen, mainFile, subDir] of GENS) {
  const notices = {};
  const mainLines = fs.readFileSync(mainFile, "utf8").split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < mainLines.length; i++) {
    let o; try { o = JSON.parse(mainLines[i]); } catch (e) { continue; }
    if (o.type !== "user/message") continue;
    const t = textOf(o.data || o);
    const m = t.match(/^Background subagent ([0-9a-f-]{36}) (reported|finished|failed|interrupted)/);
    if (m) notices[m[1]] = { status: m[2], line: i+1 };
  }
  const dirs = fs.readdirSync(subDir).filter(n => fs.statSync(path.join(subDir, n, "session.jsonl")).isFile());
  for (const d of dirs) {
    const lines = fs.readFileSync(path.join(subDir, d, "session.jsonl"), "utf8").split(/\r?\n/).filter(Boolean);
    let firstTask = "", lastAsst = "", t0 = 0, t1 = 0, lastType = "", nToolErr = 0;
    for (let i = 0; i < lines.length; i++) {
      let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
      if (o.time) { if (!t0) t0 = o.time; t1 = o.time; }
      lastType = o.type;
      if (o.type === "user/message" && !firstTask) {
        const t = textOf(o.data || o);
        if (t && !/^<goal_round>|^<system-reminder>|^<skill_content|^Current runtime|\[MNEMON\]|MNEMON RUNTIME|^The approval policy/.test(t.trim())) firstTask = clip(t, 160);
      }
      if (o.type === "assistant/message") { const t = textOf(o.data || o); if (t.trim()) lastAsst = clip(t, 230); }
    }
    const nt = notices[d];
    all.push({ gen, id: d, lines: lines.length, t1: t1 ? new Date(t1+28800000).toISOString().replace("T"," ").slice(5,16) : "?", status: nt ? nt.status : "(no-notice)", nline: nt ? nt.line : 0, firstTask, lastAsst, lastType });
  }
  console.log(gen, "subdirs=" + dirs.length);
}
const outL = [];
for (const r of all) {
  outL.push(r.gen + " | " + r.id + " | lines=" + r.lines + " | end=" + r.t1 + " | main=" + r.status + "(L" + r.nline + ")");
  outL.push("   TASK: " + r.firstTask);
  outL.push("   LAST: " + r.lastAsst);
}
fs.writeFileSync(OUTDIR + "/_subagents_full.txt", outL.join("\n"), "utf8");
const failed = all.filter(r => r.status === "failed");
const nonote = all.filter(r => r.status === "(no-notice)");
fs.writeFileSync(OUTDIR + "/_failed_list.txt", failed.map(r => r.gen + " " + r.id + " mainL" + r.nline + "\n  TASK: " + r.firstTask + "\n  LAST: " + r.lastAsst).join("\n---\n"), "utf8");
fs.writeFileSync(OUTDIR + "/_nonote_list.txt", nonote.map(r => r.gen + " " + r.id + " lines=" + r.lines + " end=" + r.t1 + "\n  TASK: " + r.firstTask + "\n  LAST: " + r.lastAsst).join("\n---\n"), "utf8");
console.log("TOTAL=" + all.length, "failed=" + failed.length, "no-notice=" + nonote.length);
