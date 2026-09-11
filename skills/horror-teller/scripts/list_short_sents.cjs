// 用法: node list_short_sents.cjs <file> [maxLen=8]
// 列出 ≤maxLen 字的句子及上下文，供 M3 短句合并回稿用
const fs = require("fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
const maxLen = parseInt(process.argv[3] || "8", 10);
const paras = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
let n = 0;
for (const p of paras) {
  const sents = p.split(/[。！？!?]+/).map(s => s.trim()).filter(Boolean);
  sents.forEach((s, i) => {
    const len = s.replace(/[，、；：：「」『』""（）()——…]/g, "").length;
    if (len <= maxLen) {
      n++;
      const prev = (sents[i - 1] || "").slice(-18);
      console.log(n + "| [" + len + "] …" + prev + " ◆ " + s + " | " + (sents[i + 1] || "").slice(0, 18) + "…");
    }
  });
}
console.log("TOTAL short sentences: " + n);
