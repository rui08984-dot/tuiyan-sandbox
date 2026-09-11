'use strict';
// _build_slices.cjs — 组装盲测切片（头部屏蔽：只取公开事件流正文，不带档案标题/对局名/完整度声明）
const fs = require('fs');
const base = 'E:/music player/docs/sandbox/p0-replay/';

const jobs = [
  // [游戏id, 公开档案, 起始标记, 结束标记, 切片输出名]
  ['lyingman-s02e01', 'replay-werewolf-lyingman-s02e01.md', '## 夜 1', '## 来源与可信度', ['slice-day1', 'slice-day2', 'slice-day3']],
  ['pandakill-s1e7', 'replay-werewolf-pandakill-s1e7.md', '## 夜 1', '## 来源与可信度', ['slice-day1', 'slice-day2']],
];

for (const [id, pub, startMark, endMark, slices] of jobs) {
  const text = fs.readFileSync(base + pub, 'utf8');
  const lines = text.split('\n');
  const s = lines.findIndex(l => l.startsWith(startMark));
  const e = lines.findIndex(l => l.startsWith(endMark));
  if (s < 0 || e < 0 || e <= s) { console.log('FAIL 定位: ' + id + ' s=' + s + ' e=' + e); continue; }
  const body = lines.slice(s, e); // 公开事件流正文（不含来源/缺口节）
  const dir = base + 'runs/' + id + '/';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 累计式切片：day1=到「夜2」前，day2=到「夜3/昼2后」……按每局节奏
  const cutMarks = id === 'lyingman-s02e01'
    ? ['## 夜 2', '## 夜 3', null]   // day1 截到夜2前, day2 截到夜3前, day3 全量
    : ['## 夜 2', null];            // day1 截到夜2前, day2 全量
  slices.forEach((name, i) => {
    const cut = cutMarks[i];
    const part = cut ? lines.slice(s, lines.findIndex(l => l.startsWith(cut))) : body;
    const content = part.join('\n').trimEnd() + '\n';
    fs.writeFileSync(dir + name + '.md', content, 'utf8');
    console.log('OK | ' + id + '/' + name + '.md | ' + part.length + ' 行 | ' + Buffer.byteLength(content) + ' B');
  });
}
console.log('SLICES DONE');
