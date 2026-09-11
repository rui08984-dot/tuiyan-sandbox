const fs = require("fs");
const b = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl.zstd");
console.log("size:", b.length);
console.log("head hex:", b.subarray(0, 16).toString("hex"));
console.log("head ascii:", JSON.stringify(b.subarray(0, 24).toString("latin1")));
// zstd magic = 28b52ffd
console.log("is zstd magic:", b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd);
// 也可能是 gzip 1f8b / deflate 无头
console.log("is gzip:", b[0] === 0x1f && b[1] === 0x8b);
