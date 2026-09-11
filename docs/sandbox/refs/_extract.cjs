const fs = require('fs');
const html = fs.readFileSync('docs/sandbox/refs/rulebook.html', 'utf8');
let text = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t\r]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n');
fs.writeFileSync('docs/sandbox/refs/rulebook-text.txt', text);
const kws = ['Example Game', 'example game', 'Sample Game', '示例对局', '第一夜', 'The First Day', 'first night'];
for (const k of kws) {
  const n = text.split(k).length - 1;
  console.log(k + ' : ' + n + ' 次');
}
// 找 "Example Game" 章节位置并打印上下文开头
const m = text.search(/[Ee]xample [Gg]ame/);
console.log('首个 Example Game 位置:', m);
if (m >= 0) console.log('--- 上下文预览 ---\n' + text.slice(m, m + 1200));
