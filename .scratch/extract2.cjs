const fs = require("fs");
const lines = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl", "utf8").split("\n").filter(l => l.trim());
const msgs = [];
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type !== "assistant/message") continue;
  const d = o.data || o.message || o;
  const c = d.content || (d.message && d.message.content);
  let t = null;
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) t = c.filter(p => p && p.type === "text" && typeof p.text === "string").map(p => p.text).join("\n");
  if (t && t.trim()) msgs.push({ seq: o.seq, t });
}
console.log("assistant/message blocks:", msgs.length);
fs.writeFileSync("E:/music player/.scratch/botc-research-assistant-dump.txt", msgs.map((m, i) => "===== MSG " + i + " (seq=" + m.seq + ") =====\n" + m.t).join("\n\n"), "utf8");
const total = msgs.reduce((a, m) => a + m.t.length, 0);
console.log("total chars:", total);
msgs.forEach((m, i) => console.log("MSG " + i + " seq=" + m.seq + " len=" + m.t.length + " head: " + m.t.slice(0, 100).replace(/\n/g, " ")));
