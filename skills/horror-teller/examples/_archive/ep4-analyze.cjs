// 用法: node ep4-analyze.cjs <in.md> <out.txt>
// 复刻 strip_annotations + structure_metrics 的句子口径，列出全部句子（序号/净长/文本）
// 净长 = 去除 [，、；：：「」『』""（）()——…] 后的长度；句子按 [。！？!?] 切分
const fs = require("fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
const lines = raw.split(/\r?\n/);
let firstKept = false;
const paras = [];
for (const line of lines) {
  const t = line.trim();
  if (!t) continue;
  if (/^(#|>|\[|（|【|=)/.test(t)) continue;
  if (!firstKept && t.startsWith("「") && t.endsWith("」") && t.length < 40) { firstKept = true; continue; }
  firstKept = true;
  paras.push(t);
}
const allText = paras.join("");
const sents = allText.split(/[。！？!?]+/).map(s => s.trim()).filter(s => s.length > 0);
const clean = (s) => s.replace(/[，、；：：「」『』""（）()——…]/g, "");
const out = [];
sents.forEach((s, i) => {
  const L = clean(s).length;
  const flag = L <= 8 ? " <<SHORT" : (L >= 30 ? " LONG" : "");
  out.push(String(i + 1).padStart(3) + " L=" + String(L).padStart(2) + flag + " | " + s);
});
const shorts = sents.filter(s => clean(s).length <= 8).length;
const longs = sents.filter(s => clean(s).length >= 30).length;
out.push("---- 句数=" + sents.length + " 短句(<=8)=" + shorts + " 长句(>=30)=" + longs + " 均长=" + (sents.reduce((a, s) => a + clean(s).length, 0) / sents.length).toFixed(1));
fs.writeFileSync(process.argv[3], out.join("\n"), "utf8");
console.log("OK " + process.argv[3]);
