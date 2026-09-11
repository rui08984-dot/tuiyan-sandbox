const fs = require("fs");
const lines = fs.readFileSync("E:/music player/.scratch/session-39e58053/session.jsonl", "utf8").split("\n").filter(l => l.trim());
console.log("main lines:", lines.length);
const hits = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.includes('"prompt"')) continue;
  if (!(l.includes('subagent') || l.includes('Subagent'))) continue;
  try {
    const o = JSON.parse(l);
    const s = JSON.stringify(o);
    const pd = (o.arguments && o.arguments.prompt) || (o.data && o.data.arguments && o.data.arguments.prompt) || (o.input && o.input.prompt) || null;
    if (pd) hits.push({ i, seq: o.seq, time: o.time, type: o.type, len: pd.length, head: pd.slice(0, 120) });
  } catch {}
}
console.log("dispatch records with prompt:", hits.length);
hits.forEach(h => console.log("#" + h.i, "seq=" + h.seq, h.type, "len=" + h.len, "|", h.head.replace(/\n/g, " ")));
