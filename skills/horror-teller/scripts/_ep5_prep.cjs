// 用法: node _ep5_prep.cjs <in.md> <out_stripped.txt> <out_dequoted.txt>
// 1) 剥标题/标注/元信息行（同 strip_annotations 规则） 2) 再剥「」引号字符（ASR诚实口径）
const fs = require("fs");
const [,, inPath, outA, outB] = process.argv;
const raw = fs.readFileSync(inPath, "utf8");
const lines = raw.split(/\r?\n/);
let firstKept = false;
const out = [];
let prevBlank = true;
for (const line of lines) {
  const t = line.trim();
  if (!t) { if (!prevBlank && out.length) { out.push(""); prevBlank = true; } continue; }
  if (/^(#|>|\[|（|【|=|<!--)/.test(t)) continue;
  if (!firstKept && t.startsWith("「") && t.endsWith("」") && t.length < 40) { firstKept = true; continue; }
  firstKept = true;
  out.push(t);
  prevBlank = false;
}
const stripped = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
fs.writeFileSync(outA, stripped, "utf8");
const dequoted = stripped.replace(/[「」『』]/g, "");
fs.writeFileSync(outB, dequoted, "utf8");
console.log("STRIPPED " + outA + " chars=" + stripped.length);
console.log("DEQUOTED " + outB + " chars=" + dequoted.length);
