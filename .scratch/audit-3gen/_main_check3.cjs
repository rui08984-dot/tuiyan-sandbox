// _main_check3.cjs — 主日志定点：23:40-23:50 的 handoff 写入事件；23:55-00:05 的 39e58053/78e71e4a 动作
const fs = require("fs");
const zlib = require("zlib");
const src = "C:/Users/crx/.dsh/sessions/--E-music~0020player--/session-7573fb75-acce-4356-baf7-942b89246c73/session.jsonl.zstd";
const buf = fs.readFileSync(src);
const offs = [];
for (let i = 0; i <= buf.length - 4; i++) if (buf[i] === 0x28 && buf[i+1] === 0xb5 && buf[i+2] === 0x2f && buf[i+3] === 0xfd) offs.push(i);
let txt = "";
for (let k = 0; k < offs.length; k++) {
  const seg = buf.slice(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length);
  try { txt += zlib.zstdDecompressSync(seg).toString("utf8"); } catch (e) {}
}
const lines = txt.split(/\r?\n/).filter(Boolean);
const mask = (s) => String(s).replace(/sk_[A-Za-z0-9_-]{6,}/g, "sk_***MASKED***");
const loc = (t) => t ? new Date(t + 28800000).toISOString().replace("T", " ").slice(0, 19) : "?";
function scan(t0, t1, re, max) {
  const res = [];
  for (let i = 0; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
    const lt = loc(o.time);
    if (!(lt >= t0 && lt <= t1)) continue;
    const blob = mask(JSON.stringify(o.data ?? {}));
    if (!re.test(blob)) continue;
    const nm = o.data && o.data.name ? "/" + o.data.name : "";
    res.push(lt.slice(5, 19) + " " + o.type + nm + " :: " + blob.replace(/\\/g, "/").slice(0, 240));
    if (res.length >= max) break;
  }
  return res;
}
console.log("(A 段已在上一轮取得，本轮跳过)");
console.log("== B) 23:55-00:05 含 39e58053|78e71e4a|handoff 的 tool/user 事件 ==");
console.log(scan("2026-09-09 23:55", "2026-09-10 00:05", /39e58053|78e71e4a|handoff/, 20).join("\n"));
console.log("== C) 全文件搜 write 到 .scratch/handoff/ 的事件 ==");
const all = [];
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  const nm = (o.data && o.data.name) || "";
  if (nm !== "write" && nm !== "edit") continue;
  const blob = mask(JSON.stringify(o.data.arguments ?? {}));
  if (/handoff/.test(blob)) all.push(loc(o.time).slice(5, 19) + " " + nm + " -> " + blob.replace(/\\/g, "/").slice(0, 160));
}
console.log(all.slice(0, 20).join("\n") || "(none)");
