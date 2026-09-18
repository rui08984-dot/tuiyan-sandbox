'use strict';
// 只改本次新增文本的写法（历史锚零改动）：省略号文件名 → 全名；片段 → 文字表述
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260918-终态.md';
let s = fs.readFileSync(P, 'utf8');
const b = s;
s = s.split('`…-v1.1-补充与勘误-20260918.md`').join('`PREREG-厚格基建总票-v1.1-补充与勘误-20260918.md`');
s = s.split('`…-v1.2-补充-kNN预注册-20260918.md`').join('`PREREG-厚格基建总票-v1.2-补充-kNN预注册-20260918.md`');
s = s.split('写死 `…-20260917.json` 的测试').join('写死 09-17 那一版文件名（含日期后缀）的测试');
s = s.split('往读数件 `.md` 手追加').join('往读数件的 markdown 手追加');
s = s.split('（`.md`>60 件或目录>12 件').join('（markdown 件 >60 或同类目录 >12 件');
s = s.split('＋MEMORY.md 索引行）').join('＋记忆索引行）');
fs.writeFileSync(P, s, 'utf8');
console.log('改动:', b === s ? '无' : '有');
