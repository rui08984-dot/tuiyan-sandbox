// _main_check.cjs — 主会话 7573fb75 日志：09-09 23:30~24:00 窗口的写入者与活动定性
const fs = require("fs");
const zlib = require("zlib");
const ROOT = "C:/Users/crx/.dsh/sessions/--E-music~0020player--/";
const dir = fs.readdirSync(ROOT).find(d => d.includes("7573fb75"));
console.log("DIR=" + dir);
const src = ROOT + dir + "/session.jsonl.zstd";
if (!fs.existsSync(src)) { console.log("NO session.jsonl.zstd"); process.exit(0); }
const buf = fs.readFileSync(src);
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const offs = [];
for (let i = 0; i <= buf.length - 4; i++) if (buf[i] === 0x28 && buf[i+1] === 0xb5 && buf[i+2] === 0x2f && buf[i+3] === 0xfd) offs.push(i);
let txt = "", bad = 0;
for (let k = 0; k < offs.length; k++) {
  const seg = buf.slice(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length);
  try { txt += zlib.zstdDecompressSync(seg).toString("utf8"); } catch (e) { bad++; }
}
console.log("frames=" + offs.length + " bad=" + bad + " bytes=" + txt.length);
const lines = txt.split(/\r?\n/).filter(Boolean);
const mask = (s) => String(s).replace(/sk_[A-Za-z0-9_-]{6,}/g, "sk_***MASKED***");
const loc = (t) => t ? new Date(t + 28800000).toISOString().replace("T", " ").slice(0, 19) : "?";
const hits = [];
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  const lt = loc(o.time);
  if (!(lt >= "2026-09-09 23:30" && lt <= "2026-09-10 00:00")) continue;
  const name = o.data && o.data.name;
  const blob = mask(JSON.stringify(o.data ?? {}).slice(0, 2000));
  if (name === "write" || name === "edit" || (name === "run_code" && /file_path/.test(blob))) {
    hits.push(lt.slice(5, 19) + " " + o.type + "/" + name + " :: " + blob.slice(0, 260));
  } else if (o.type === "user/message") {
    const c = o.data && o.data.content;
    const t = typeof c === "string" ? c : Array.isArray(c) ? c.map(x => (x && x.text) || "").join(" ") : "";
    if (t) hits.push(lt.slice(5, 19) + " USER :: " + mask(t.replace(/\s+/g, " ").slice(0, 200)));
  } else if (/总交接|78e71e4a|39e58053/.test(blob)) {
    hits.push(lt.slice(5, 19) + " " + o.type + (name ? "/" + name : "") + " :: " + blob.slice(0, 200));
  }
}
console.log("WINDOW HITS=" + hits.length);
console.log(hits.slice(0, 60).join("\n"));
