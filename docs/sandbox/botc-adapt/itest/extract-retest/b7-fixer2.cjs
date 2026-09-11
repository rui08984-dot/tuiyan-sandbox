'use strict';
const fs = require('fs');
const f = 'E:/music player/p1b/src/botc/extractPrompt.js';
let s = fs.readFileSync(f, 'utf8');
// 1) 报告所有 0x2700-0x27FF 区字符出现位置
const risky = [];
[...s].forEach((ch, i) => { const cp = ch.codePointAt(0); if (cp >= 0x2700 && cp <= 0x27FF) risky.push(cp.toString(16) + '@' + i); });
console.log('risky count=' + risky.length + ' [' + [...new Set(risky.map(r=>r.split('@')[0]))].join(',') + ']');
// 2) 全量替换 0x2700-0x27FF → ASCII（常量、字面量、注释一并治理，绝后患）
s = s.replace(/[\u2700-\u27FF]/g, (ch) => {
  if (ch.codePointAt(0) === 0x27E6) return '__BOTC[';
  if (ch.codePointAt(0) === 0x27E5 || ch.codePointAt(0) === 0x27E7) return ']';
  return '?';
});
// 3) 修正被步骤2弄重复的前缀（注释里的 ⟦<predicate>⟧<object> → __BOTC[<predicate>]<object>）
s = s.split('__BOTC[<predicate>]<object>').join('__BOTC[<predicate>]<object>');
s = s.split('__BOTC[__BOTC[').join('__BOTC[');
// 4) 载体构造行核对：object: BOTC_CARRIER_PREFIX + c.predicate + ']' + obj
const reCarrier = /object: BOTC_CARRIER_PREFIX \+ c\.predicate \+ '[^']*' \+ obj,/
;
if (!reCarrier.test(s)) console.log('WARN: carrier line not matched');
// 5) mapBack 分隔符行核对：indexOf(']')
if (!/indexOf\('\)'\)/.test(s)) console.log('WARN: sep indexOf not matched');
fs.writeFileSync(f, s, 'utf8');
const after = [...s].filter(ch => ch.codePointAt(0) >= 0x2700 && ch.codePointAt(0) <= 0x27FF).length;
console.log('after risky=' + after + ' hasASCIIconst=' + s.includes("BOTC_CARRIER_PREFIX = '__BOTC['") );