const fs = require("fs");
const path = require("path");
const base = "E:/music player/.scratch/session-39e58053/subagents";
const id = "d63143a1-9666-452f-978c-494d8ac0a5d1";
const lines = fs.readFileSync(path.join(base, id, "session.jsonl"), "utf8").split("\n").filter(l => l.trim());
// 1) end-seed 的 data 形状
const seed = JSON.parse(lines[2]);
console.log("end-seed data keys:", Object.keys(seed.data || {}));
const s = JSON.stringify(seed.data || {});
console.log("end-seed data head:", s.slice(0, 400));
// 2) 全文件扫描：哪些行含 role":"user 或 type user
let found = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.includes('"user"')) continue;
  try {
    const o = JSON.parse(l);
    const role = (o.message && o.message.role) || o.role || null;
    if (role === "user" || o.type === "user") found.push({ i, type: o.type, role, keys: Object.keys(o).join(","), head: l.slice(0, 150) });
  } catch {}
}
console.log("\nuser-role lines:", found.length);
found.slice(0, 5).forEach(f => console.log("  #" + f.i, f.type, f.role, "|", f.keys, "|", f.head));
