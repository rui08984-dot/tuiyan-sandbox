// 审计脚本E：末次时间戳+档案计数+角色数
const fs = require("fs");
const files = {
  gen1: "E:/music player/.scratch/session-78e71e4a/session.jsonl",
  gen2: "E:/music player/.scratch/session-39e58053/session.jsonl",
  gen3: "E:/music player/_session_extract/session-1eec2bbb/session.jsonl",
};
for (const [k, f] of Object.entries(files)) {
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean);
  let lastT = 0;
  for (const l of lines) { try { const o = JSON.parse(l); if (o.time && o.time > lastT) lastT = o.time; } catch (e) {} }
  console.log(k, "lines=" + lines.length, "last=" + new Date(lastT + 28800000).toISOString().replace("T", " ").slice(0, 16));
}
const yj = fs.readdirSync("E:/music player/docs/sandbox/p2-yijing");
console.log("p2-yijing files=" + yj.length + " :: " + yj.join(", "));
const bc = fs.readdirSync("E:/music player/p1b/src/botc");
console.log("p1b/src/botc files=" + bc.length + " :: " + bc.join(", "));
const roles = JSON.parse(fs.readFileSync("E:/music player/docs/sandbox/botc-adapt/data/roles-zh.json", "utf8"));
const arr = Array.isArray(roles) ? roles : (roles.roles || Object.keys(roles));
console.log("roles-zh.json entries=" + (Array.isArray(arr) ? arr.length : Object.keys(roles).length));
