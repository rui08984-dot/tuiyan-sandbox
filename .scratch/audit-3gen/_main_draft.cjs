// _main_draft.cjs — 主会话 turn-1 的 assistant 文本增量流拼接，搜总交接草稿
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
let stream = "", tFirst = "", tLast = "";
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  if (o.type !== "assistant/chunk") continue;
  const ch = o.data && o.data.chunk;
  if (!ch || ch.type !== "text") continue;
  const lt = o.time ? new Date(o.time + 28800000).toISOString().replace("T", " ") : "";
  if (lt < "2026-09-09 23:35" || lt > "2026-09-09 23:59") continue;
  if (!tFirst) tFirst = lt;
  tLast = lt;
  stream += ch.text || (ch.chunk && ch.chunk.text) || "";
}
console.log("streamWindow " + tFirst + " ~ " + tLast + " chars=" + stream.length);
const idx = stream.indexOf("总交接");
console.log("indexOf(总交接)=" + idx);
if (idx >= 0) console.log("CONTEXT: " + stream.slice(Math.max(0, idx - 200), idx + 300).replace(/\s+/g, " "));
const idx2 = stream.indexOf("写给 DSH 新会话");
console.log("indexOf(写给DSH新会话)=" + idx2);
if (idx2 >= 0) console.log("CONTEXT2: " + stream.slice(Math.max(0, idx2 - 150), idx2 + 250).replace(/\s+/g, " "));
// 也拼 assistant/message 的完整 text（非流式块）
let msgs = [];
for (let i = 0; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  if (o.type !== "assistant/message") continue;
  const m = o.data && o.data.message; if (!m) continue;
  const lt = o.time ? new Date(o.time + 28800000).toISOString().replace("T", " ") : "";
  if (lt < "2026-09-09 23:44" || lt > "2026-09-09 23:59") continue;
  const t = (m.content || []).filter(x => x.type === "text").map(x => x.text).join(" ");
  if (t) msgs.push(lt + " (" + t.length + "ch) :: " + t.replace(/\s+/g, " ").slice(0, 300));
}
console.log("== assistant 纯文本消息 23:44-23:59 ==");
console.log(msgs.join("\n") || "(none)");
