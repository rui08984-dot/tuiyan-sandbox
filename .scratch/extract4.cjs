const fs = require("fs");
const lines = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl", "utf8").split("\n").filter(l => l.trim());
const want = [583, 819, 1484, 2014, 8218, 4170, 4646, 5301, 6992, 7667];
const out = [];
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type !== "tool/result" || !want.includes(o.seq)) continue;
  const c = (o.data && o.data.message && o.data.message.content) || [];
  const txt = c.filter(p => p && p.type === "tool_result" && typeof p.content === "string").map(p => p.content).join("\n")
    || c.map(p => JSON.stringify(p)).join("\n");
  out.push("===== RESULT seq=" + o.seq + " =====\n" + txt);
}
fs.writeFileSync("E:/music player/.scratch/botc-research-toolresults.txt", out.join("\n\n"), "utf8");
console.log("dumped", out.length, "results,", out.reduce((a, x) => a + x.length, 0), "chars");
