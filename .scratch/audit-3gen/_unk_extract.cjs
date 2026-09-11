// _unk_extract.cjs v3 — 扫描 zstd 魔数逐帧解压会话日志
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
(async () => {
  const out = [];
  for (const [tag, src] of jobs) {
    const buf = fs.readFileSync(src);
    const offs = [];
    for (let i = 0; i <= buf.length - 4; i++) if (buf[i] === 0x28 && buf[i+1] === 0xb5 && buf[i+2] === 0x2f && buf[i+3] === 0xfd) offs.push(i);
    let txt = "", okF = 0, badF = 0;
    for (let k = 0; k < offs.length; k++) {
      const seg = buf.slice(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length);
      try { txt += zlib.zstdDecompressSync(seg).toString("utf8"); okF++; }
      catch (e) { badF++; out.push("  [frame " + k + " @" + offs[k] + " FAIL " + e.message + "]"); }
    }
    fs.writeFileSync("E:/music player/.scratch/audit-3gen/_unk_" + tag + ".jsonl", txt);
    const lines = txt.split(/\r?\n/).filter(Boolean);
    let firstT = 0, lastT = 0;
    const users = [], writes = [], tools_ = {};
    for (let i = 0; i < lines.length; i++) {
      let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
      if (o.time) { if (!firstT) firstT = o.time; lastT = o.time; }
      if (o.type === "session") out.push("HEADER: " + mask(lines[i]).slice(0, 320));
      if (o.type === "user/message") {
        const c = o.data && o.data.content;
        const t = typeof c === "string" ? c : Array.isArray(c) ? c.map(x => (x && x.text) || "").join(" ") : "";
        if (t && !t.startsWith("<system-reminder") && !t.startsWith("Current runtime") && !t.startsWith("[MNEMON]") && !t.startsWith("MNEMON") && !t.startsWith("<goal") && !t.startsWith("===")) {
          users.push("L" + (i + 1) + " @" + loc(o.time).slice(5, 16) + " :: " + mask(t.replace(/\s+/g, " ").slice(0, 260)));
        }
      }
      const name = o.data && o.data.name;
      if (name) tools_[name] = (tools_[name] || 0) + 1;
      if (name && /^(write|edit)/.test(name)) {
        const m = /"file_path"\s*:\s*"([^"]+)"/.exec(String(o.data.arguments || ""));
        if (m) writes.push("L" + (i + 1) + " @" + loc(o.time).slice(5, 16) + " " + name + " -> " + mask(m[1]));
      }
      if (name === "run_code") {
        const re = /file_path\s*:\s*"([^"]+)"/g; let mm; const code = String(o.data.arguments || "");
        while ((mm = re.exec(code))) writes.push("L" + (i + 1) + " @" + loc(o.time).slice(5, 16) + " run_code -> " + mask(mm[1]));
      }
    }
    out.push("===== " + tag + " ===== zstdFrames=" + offs.length + " ok=" + okF + " bad=" + badF + " jsonlLines=" + lines.length + " 时间窗 " + loc(firstT) + " ~ " + loc(lastT));
    out.push("工具直方图: " + JSON.stringify(tools_));
    out.push("-- 用户消息(" + users.length + ") --"); out.push(...users.slice(0, 40));
    out.push("-- 写入目标(" + writes.length + ") --"); out.push(...writes.slice(0, 80));
  }
  fs.writeFileSync("E:/music player/.scratch/audit-3gen/_unk_analysis.txt", out.join("\n"));
  console.log(out.join("\n"));
})().catch(e => { console.error("FAIL " + e.message); process.exit(1); });
