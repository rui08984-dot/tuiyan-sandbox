'use strict';
// 修收据 §9 里被 shell 吃掉的两处反引号内容（坑表纪律：禁 bash 写含反引号的文本）
const fs = require('fs');
const P = '.scratch/p31/修复收据-20260921.md';
let t = fs.readFileSync(P, 'utf8');
const fixes = [
  ['resolver 找  的发布日得空', 'resolver 找 `>= date` 的发布日得空'],
  ['项目的既有语义是**顺延**（取  的最早发布日）', '项目的既有语义是**顺延**（取 `>= date` 的最早发布日）'],
];
let n = 0;
for (const [bad, good] of fixes) {
  if (t.indexOf(bad) >= 0) { t = t.replace(bad, good); n++; }
  else console.log('未找到（可能已正确）:', JSON.stringify(bad));
}
fs.writeFileSync(P, t, 'utf8');
console.log('修正处数:', n);
// 复核：文件里不该再有「找  的」这种双空格
const badLeft = (t.match(/找\s{2,}的/g) || []).length;
console.log('残留双空格模式:', badLeft);
