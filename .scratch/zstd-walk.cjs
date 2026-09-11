const fs = require("fs");
const zlib = require("zlib");
const raw = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl.zstd");
const chunks = [];
let pos = 0, frames = 0;
function u24le(b, p) { return b[p] | (b[p+1] << 8) | (b[p+2] << 16); }
while (pos + 4 <= raw.length) {
  // skippable frame?
  if (raw[pos] === 0x50 && raw[pos+1] === 0x2a && raw[pos+2] === 0x4d && raw[pos+3] === 0x18) {
    const sz = raw.readUInt32LE(pos + 4); pos += 8 + sz; continue;
  }
  if (!(raw[pos] === 0x28 && raw[pos+1] === 0xb5 && raw[pos+2] === 0x2f && raw[pos+3] === 0xfd)) {
    console.log("non-frame data at", pos, "stopping"); break;
  }
  const start = pos; pos += 4; // magic
  const fhd = raw[pos++]; pos += 4; // FHD + placeholder (frame header parsed coarsely below)
  // 重新精细解析帧头
  pos = start + 4;
  const fhd2 = raw[pos++];
  const singleSegment = (fhd2 >> 5) & 1;
  const fcsFlag = (fhd2 >> 6) & 3;
  const dictFlag = fhd2 & 3;
  const checksum = (fhd2 >> 2) & 1;
  if (!singleSegment) pos += 1; // window descriptor
  pos += [0,1,2,4][dictFlag];
  let fcsSize = singleSegment && fcsFlag === 0 ? 1 : [0,2,4,8][fcsFlag];
  pos += fcsSize;
  // 遍历块
  let last = 0, guard = 0;
  while (!last && guard++ < 10e6) {
    if (pos + 3 > raw.length) throw new Error("truncated block header at " + pos);
    const h = u24le(raw, pos); pos += 3;
    last = h & 1;
    const type = (h >> 1) & 3;
    const size = h >> 3;
    if (type === 0) pos += size;       // Raw
    else if (type === 1) pos += 1;     // RLE
    else if (type === 2) pos += size;  // Compressed
    else throw new Error("reserved block type");
  }
  if (checksum) pos += 4;
  const frame = raw.subarray(start, pos);
  const out = zlib.zstdDecompressSync(frame);
  chunks.push(out); frames++;
}
const full = Buffer.concat(chunks);
console.log("frames:", frames, "decompressed:", full.length, "bytes");
fs.writeFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl", full);
console.log("written: session.jsonl (uncompressed copy)");
