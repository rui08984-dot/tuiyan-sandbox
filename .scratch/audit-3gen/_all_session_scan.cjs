// _all_session_scan.cjs — 全项目键会话日志搜 总交接-20260909 写入事件
const fs = require("fs");
const zlib = require("zlib");
const ROOT = "C:/Users/crx/.dsh/sessions/--E-music~0020player--/";
const mask = (s) => String(s).replace(/sk_[A-Za-z0-9_-]{6,}/g, "sk_***MASKED***");
const loc = (t) => t ? new Date(t + 28800000).toISOString().replace("T", " ").slice(0, 19) : "?";
for (const d of fs.readdirSync(ROOT)) {
  const src = ROOT + d + "/session.jsonl.zstd";
  if (!fs.existsSync(src)) continue;
  const buf = fs.readFileSync(src);
  const offs = [];
  for (let i = 0; i <= buf.length - 4; i++) if (buf[i] === 0x28 && buf[i+1] === 0xb5 && buf[i+2] === 0x2f && buf[i+3] === 0xfd) offs.push(i);
  let txt = "";
  for (let k = 0; k < offs.length; k++) {
    const seg = buf.slice(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length);
    try { txt += zlib.zstdDecompressSync(seg).toString("utf8"); } catch (e) {}
  }
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("u603b\u4ea4\u63a5-20260909") && !lines[i].includes("总交接-20260909")) continue;
    let o; try { o = JSON.parse(lines[i]); } catch (e) { hits.push(loc(null) + " RAW :: " + mask(lines[i]).slice(0, 150)); continue; }
    const nm = o.data && o.data.name ? "/" + o.data.name : "";
    hits.push(loc(o.time).slice(5, 19) + " " + o.type + nm + " :: " + mask(JSON.stringify(o.data ?? {})).replace(/\\/g, "/").slice(0, 180));
  }
  if (hits.length) {
    console.log("##### " + d + " hits=" + hits.length);
    console.log(hits.slice(0, 8).join("\n"));
  }
}
console.log("SCAN DONE");
