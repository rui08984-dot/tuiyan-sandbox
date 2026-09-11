const fs = require("fs");
const lines = fs.readFileSync("E:/music player/.scratch/session-39e58053/session.jsonl", "utf8").split("\n").filter(l => l.trim());
function promptAt(i) {
  const o = JSON.parse(lines[i]);
  return (o.arguments && o.arguments.prompt) || (o.data && o.data.arguments && o.data.arguments.prompt) || null;
}
const targets = [
  [16108, "P1b-1 后端 API 层"],
  [16110, "P1b-2 前端框架+供应商设置页"],
  [15790, "LIVE 抽取实测"],
];
let out = "# 崩溃旧会话（session-39e58053）三路子代理原始任务书原文\n\n> 提取自主日志 session.jsonl 的 code-dispatch 派单记录（行号见各节），2026-09-08 现任队长提取，供校准重派与审计。\n";
const texts = {};
for (const [idx, label] of targets) {
  const t = promptAt(idx);
  texts[label] = t || "[null]";
  out += "\n\n---\n\n## " + label + "（主日志行 #" + (idx + 1) + "）\n\n" + (t || "[NOT FOUND]") + "\n";
}
fs.writeFileSync("E:/music player/.scratch/session-39e58053/原始任务书-三路.md", out, "utf8");
console.log("written:", out.length, "chars");
console.log("\n########## P1b-1 后端原文 ##########\n" + texts["P1b-1 后端 API 层"]);
console.log("\n########## LIVE 原文 ##########\n" + texts["LIVE 抽取实测"]);
