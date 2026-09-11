const fs = require("fs");
const lines = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl", "utf8").split("\n").filter(l => l.trim());
console.log("lines:", lines.length);
const texts = [];
for (const line of lines) {
  let o; try { o = JSON.parse(line); } catch { continue; }
  const m = o.message || o;
  const role = m.role || (o.type === "assistant" ? "assistant" : null);
  if (role !== "assistant") continue;
  const c = m.content;
  let t = null;
  if (typeof c === "string" && c.trim()) t = c;
  else if (Array.isArray(c)) t = c.filter(p => p && p.type === "text" && typeof p.text === "string").map(p => p.text).join("\n");
  if (t && t.trim()) texts.push(t);
}
console.log("assistant blocks:", texts.length, "chars:", texts.reduce((a, x) => a + x.length, 0));
fs.writeFileSync("E:/music player/.scratch/botc-research-assistant-dump.txt", texts.map((t, i) => "===== BLOCK " + i + " =====\n" + t).join("\n\n"), "utf8");
// 打印最后 8 块（越靠后结论越完整）
texts.slice(-8).forEach((t, i) => console.log("\n===== TAIL-" + (8 - i) + " (" + t.length + ") =====\n" + t.slice(0, 1500)));
