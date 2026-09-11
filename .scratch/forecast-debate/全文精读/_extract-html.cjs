// arXiv HTML -> text 提取（保留公式 alttext 为 $...$）
// 用法: node _extract-html.cjs <input.html> <output.txt>
const fs = require("fs");
const [,, inp, outp] = process.argv;
let h = fs.readFileSync(inp, "utf8");
// 公式：alttext 优先
h = h.replace(/<math\b[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/g, (m, alt) => " $" + alt + "$ ");
// 标题加标记
h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (m, lv, inner) => "\n\n" + "#".repeat(+lv) + " " + inner.replace(/<[^>]+>/g,"").trim() + "\n");
// 表格单元格/行分隔
h = h.replace(/<\/(td|th)>/g, " | ").replace(/<\/tr>/g, "\n");
// 段落/列表/图题换行
h = h.replace(/<\/(p|li|figcaption|div|section)>/g, "\n");
// 去残余标签
h = h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
h = h.replace(/<[^>]+>/g, "");
// 实体
h = h.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'").replace(/&#x[0-9A-Fa-f]+;/g," ");
// 压缩空行
h = h.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
fs.writeFileSync(outp, h, "utf8");
console.log("OUT:", outp, fs.statSync(outp).size, "bytes,", h.split("\n").length, "lines");
