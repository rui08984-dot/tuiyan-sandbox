'use strict';
// 口径B 微步4：三件文档落盘（锚点唯一守卫；pre-sha 收据；LF 保持；追加不删改原条款）
const fs = require('fs');
const crypto = require('crypto');
const LF = String.fromCharCode(10);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const D = 'E:/music player/docs/specs/2026-09-11-万物可预测性审计器-design.md';
const C = 'E:/music player/docs/specs/变更留痕索引-20260912.md';
const R = 'E:/music player/docs/specs/README-总索引.md';
const P = 'E:/music player/docs/sandbox/p1b/itest/p19-PROGRESS.md';
const F = (n) => 'E:/music player/p1b/scripts/_bd-frag-' + n + '.md';
const frag = (n) => fs.readFileSync(F(n), 'utf8');
function splice(file, anchor, insertText, label) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点非唯一或缺失(' + n + '): ' + label);
  if (src.includes(insertText.slice(0, 60))) throw new Error('已存在（幂等跳过）: ' + label);
  fs.writeFileSync(file, src.replace(anchor, insertText + anchor), 'utf8');
  console.log('SPLICED ' + label + ' pre_sha=' + sha(file).slice(0, 12) + ' -> new_len');
}
function appendTail(file, text, label) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(text.slice(0, 60))) throw new Error('已存在（幂等跳过）: ' + label);
  if (!src.endsWith(LF)) text = LF + text;
  fs.writeFileSync(file, src + text, 'utf8');
  console.log('APPENDED ' + label);
}
console.log('PRE design=' + sha(D).slice(0, 12) + ' changelog=' + sha(C).slice(0, 12) + ' readme=' + sha(R).slice(0, 12) + ' p19=' + sha(P).slice(0, 12));
splice(D, '## §5 与②类校准线的关系（旁路试点，账本共用）', frag('design1') + frag('design2'), 'design-4.2.4');
appendTail(C, LF + frag('s16'), 'changelog-s16');
splice(R, '## 5 · 铁律速查（违反=弃棒）', frag('readme'), 'readme-4.5');
appendTail(P, LF + frag('p19'), 'p19-anchor');
console.log('POST design=' + sha(D).slice(0, 12) + ' changelog=' + sha(C).slice(0, 12) + ' readme=' + sha(R).slice(0, 12) + ' p19=' + sha(P).slice(0, 12));
for (const f of [D, C, R, P]) {
  const b = fs.readFileSync(f);
  let crlf = 0;
  for (let i = 0; i < b.length - 1; i++) if (b[i] === 13 && b[i + 1] === 10) crlf++;
  console.log('LF_CHECK ' + f.split('/').pop() + ' crlf=' + crlf + ' size=' + b.length);
}
