const fs = require("fs");
const lines = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl", "utf8").split("\n").filter(l => l.trim());
const results = [];
const reads = [];
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === "tool/result") {
    const d = o.data || {};
    const txt = typeof d === "string" ? d : JSON.stringify(d);
    results.push({ seq: o.seq, len: txt.length, head: txt.slice(0, 150).replace(/\n/g, " ") });
  }
  if (o.type === "tool/call") {
    const d = o.data || {};
    const s = JSON.stringify(d);
    const m = s.match(/(docs[\\\/][^"\\]+\.(?:md|txt))/);
    if (m) reads.push({ seq: o.seq, path: m[1] });
  }
}
console.log("=== tool/results ===");
results.forEach(r => console.log("seq=" + r.seq + " len=" + r.len + " | " + r.head.slice(0, 120)));
console.log("\n=== 被读的本地文档路径 ===");
reads.forEach(r => console.log("seq=" + r.seq, r.path));
