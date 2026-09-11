// 审计脚本F：gen3 死亡时刻后事件
const fs = require("fs");
const lines = fs.readFileSync("E:/music player/_session_extract/session-1eec2bbb/session.jsonl", "utf8").split(/\r?\n/).filter(Boolean);
const out = [];
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  if (!o.time) continue;
  const loc = new Date(o.time + 28800000).toISOString().replace("T", " ").slice(5, 16);
  if (loc >= "09-09 17:17") out.push("L" + (i+1) + " " + loc + " " + o.type + " :: " + String(JSON.stringify(o.data)).replace(/\s+/g, " ").slice(0, 130));
}
console.log("count after 17:17 = " + out.length);
console.log(out.slice(0, 40).join("\n"));
