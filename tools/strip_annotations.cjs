// 用法: node strip_annotations.cjs <in.md> <out.txt>
// 剥离标题/元信息/制作标注，输出纯正文（段落间空行），供朱雀贴检
const fs = require("fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
const lines = raw.split(/\r?\n/);
let firstKept = false;
const out = [];
let prevBlank = true;
for (const line of lines) {
  const t = line.trim();
  if (!t) { if (!prevBlank && out.length) { out.push(""); prevBlank = true; } continue; }
  if (/^(#|>|\[|（|【|=)/.test(t)) continue; // 标题/说明块/标注/元信息
  // 首个非空行若是短标题「...」则跳过
  if (!firstKept && t.startsWith("「") && t.endsWith("」") && t.length < 40) { firstKept = true; continue; }
  firstKept = true;
  out.push(t);
  prevBlank = false;
}
const txt = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
fs.writeFileSync(process.argv[3], txt, "utf8");
console.log("STRIPPED " + process.argv[3] + " chars=" + txt.length);
