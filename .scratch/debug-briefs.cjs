const fs = require("fs");
const path = require("path");
const base = "E:/music player/.scratch/session-39e58053/subagents";
const ids = ["d63143a1-9666-452f-978c-494d8ac0a5d1", "b955b742-9c26-4a95-a888-9604af7d82fb", "61c98a7b-b11c-49b7-91fd-838a98df75cd"];
for (const id of ids) {
  const dir = path.join(base, id);
  console.log("== " + id.slice(0, 8) + " dir exists:", fs.existsSync(dir));
  if (!fs.existsSync(dir)) continue;
  console.log("   files:", fs.readdirSync(dir).join(", "));
  const sj = path.join(dir, "session.jsonl");
  if (fs.existsSync(sj)) {
    const lines = fs.readFileSync(sj, "utf8").split("\n").filter(l => l.trim());
    console.log("   lines:", lines.length);
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      try { const o = JSON.parse(lines[i]); console.log("   line" + i + " type=" + o.type + " role=" + (o.message && o.message.role) + "/" + o.role + " keys=" + Object.keys(o).join(",")); }
      catch (e) { console.log("   line" + i + " parse fail: " + lines[i].slice(0, 120)); }
    }
  }
}
