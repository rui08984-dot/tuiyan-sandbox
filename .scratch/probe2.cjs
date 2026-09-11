const fs = require("fs");
const zlib = require("zlib");
// 1) 先看上次解出的 250 字节是什么
const prev = fs.readFileSync("E:/music player/.scratch/botc-research-assistant-dump.txt", "utf8");
console.log("prev dump head:", JSON.stringify(prev.slice(0, 200)));
// 2) 多帧循环解
const raw = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl.zstd");
let out = [], pos = 0, frames = 0;
while (pos < raw.length) {
  try {
    const chunk = zlib.zstdDecompressSync(raw.subarray(pos));
    out.push(chunk);
    frames++;
    // 无法从 Sync 调用得知消耗长度——换策略：如果只有一帧有效，循环会死循环，这里靠异常跳出
    if (frames > 5000) { console.log("frame guard hit"); break; }
    break; // Sync API 无法推进 pos，先探一帧
  } catch (e) {
    console.log("frame", frames, "fail:", e.message.slice(0, 100));
    break;
  }
}
console.log("frames decoded:", frames, "last size:", out.length ? out[out.length-1].length : 0);
// 3) python zstandard 是否可用
