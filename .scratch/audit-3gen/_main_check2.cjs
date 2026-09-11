// _main_check2.cjs — 主会话日志定点搜：总交接写入事件 + 23:55 后对其他会话目录的动作
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
const out = [];
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  const blob = mask(JSON.stringify(o.data ?? {}));
  if (blob.includes("u603b\u4ea4\u63a5-20260909") || blob.includes("总交接-20260909")) {
    out.push(loc(o.time).slice(5, 19) + " " + o.type + (o.data && o.data.name ? "/" + o.data.name : "") + " :: " + blob.slice(0, 220));
  }
}
console.log("== 总交接-20260909 提及 (" + out.length + ") ==");
console.log(out.slice(0, 30).join("\n"));
const out2 = [];
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  const lt = loc(o.time);
  if (!(lt >= "2026-09-09 23:55" && lt <= "2026-09-10 00:05")) continue;
  const blob = mask(JSON.stringify(o.data ?? {}));
  if (/39e58053|78e71e4a|handoff/i.test(blob) && (o.type === "tool/call" || o.type === "tool/code-dispatch" || o.type === "user/message")) {
    out2.push(lt.slice(5, 19) + " " + o.type + (o.data && o.data.name ? "/" + o.data.name : "") + " :: " + blob.slice(0, 200));
  }
}
console.log("== 23:55 后 39e58053/78e71e4a/handoff 动作 (" + out2.length + ") ==");
console.log(out2.slice(0, 25).join("\n"));
