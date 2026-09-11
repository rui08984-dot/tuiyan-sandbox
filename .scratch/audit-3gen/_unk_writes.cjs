// _unk_writes.cjs — 提取两个未知会话的 write/edit 目标、todo 快照、末条 assistant
const fs = require("fs");
const zlib = require("zlib");
const BASE = "C:/Users/crx/.dsh/sessions/--E-music~0020player--/";
const jobs = [
  ["ba79c0ee", BASE + "ba79c0ee-c19f-4317-8561-6f69bd48d519/session.jsonl.zstd"],
  ["763e9a32", BASE + "763e9a32-2afc-4935-8bac-b32314f4a117/session.jsonl.zstd"],
];
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const mask = (s) => String(s).replace(/sk_[A-Za-z0-9_-]{6,}/g, "sk_***MASKED***");
const loc = (t) => t ? new Date(t + 28800000).toISOString().replace("T", " ").slice(0, 19) : "?";
const out = ["createdAt ba79c0ee=" + loc(1788969169664) + "  763e9a32=" + loc(1788969304698)];
for (const [tag, src] of jobs) {
  const buf = fs.readFileSync(src);
  const offs = [];
  for (let i = 0; i <= buf.length - 4; i++) if (buf[i] === 0x28 && buf[i+1] === 0xb5 && buf[i+2] === 0x2f && buf[i+3] === 0xfd) offs.push(i);
  let txt = "";
  for (let k = 0; k < offs.length; k++) {
    const seg = buf.slice(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length);
    try { txt += zlib.zstdDecompressSync(seg).toString("utf8"); } catch (e) {}
  }
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const writes = [], todos = [];
  let lastAsst = "";
  for (let i = 0; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
    const name = o.data && o.data.name;
    const argStr = o.data ? JSON.stringify(o.data.arguments ?? o.data.message ?? "") : "";
    if (name === "write" || name === "edit") {
      const m = /"file_path"\s*:\s*"([^"]+)"/.exec(argStr);
      writes.push("L" + (i+1) + " @" + loc(o.time).slice(5,16) + " " + name + " -> " + (m ? mask(m[1]) : "(no-path) " + mask(argStr.slice(0,120))));
    }
    if (name === "run_code") {
      const re = /file_path\s*:\s*"([^"]+)"/g; let mm; const code = String(o.data.arguments || "");
      while ((mm = re.exec(code))) writes.push("L" + (i+1) + " @" + loc(o.time).slice(5,16) + " run_code -> " + mask(mm[1]));
    }
    if (o.type === "todo/write" && o.data && o.data.todos) todos.push("L" + (i+1) + " @" + loc(o.time).slice(5,16) + " :: " + o.data.todos.map(t => String(t.content).slice(0,60) + "(" + t.status + ")").join(" | "));
    if (o.type === "assistant/message" && o.data && o.data.message) {
      const c = o.data.message.content || [];
      const t = Array.isArray(c) ? c.filter(x => x.type === "text").map(x => x.text).join(" ") : "";
      if (t) lastAsst = "L" + (i+1) + " @" + loc(o.time).slice(5,16) + " :: " + mask(t.replace(/\s+/g, " ").slice(0, 500));
    }
  }
  out.push("===== " + tag + " =====");
  out.push("-- write/edit 目标(" + writes.length + ") --"); out.push(...writes.slice(0, 40));
  out.push("-- todo 快照 --"); out.push(...todos.slice(0, 6));
  out.push("-- 末条 assistant --"); out.push(lastAsst);
}
fs.writeFileSync("E:/music player/.scratch/audit-3gen/_unk_writes.txt", out.join("\n"));
console.log(out.join("\n"));
