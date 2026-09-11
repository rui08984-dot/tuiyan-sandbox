const fs = require('fs');
const t = fs.readFileSync('docs/sandbox/refs/rulebook-text.txt', 'utf8');
const start = t.indexOf('Example of Play');
// 找示例之后下一个章节标题（下一个独立的 "The Stakes" 或规则章节名），保守取 24000 字符
const chunk = t.slice(start, start + 24000);
fs.writeFileSync('docs/sandbox/refs/example-of-play.txt', chunk);
console.log('Example of Play 起始位置:', start, '| 已截取', chunk.length, '字符');
// 打印所有疑似段落标记行
const lines = chunk.split('\n');
lines.forEach((l, i) => { if (/^(First Night|First Day|Night Order|Second Night|Second Day|The game|Good wins|Evil wins|Execution|Nomination)/i.test(l.trim())) console.log(i + ': ' + l.trim().slice(0,80)); });
