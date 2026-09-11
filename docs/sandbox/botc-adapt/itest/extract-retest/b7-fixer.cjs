'use strict';
const fs = require('fs');
const f = 'E:/music player/p1b/src/botc/extractPrompt.js';
let s = fs.readFileSync(f, 'utf8');
const OLD1 = String.fromCharCode(0x27A6) + 'BOTC:';   // 旧前缀头
const OLD2 = String.fromCharCode(0x27A5);             // 旧分隔符
const before = s;
s = s.split(OLD1 + "<predicate>" + OLD2 + "<object>").join('__BOTC[<predicate>]<object>');
s = s.split("'" + OLD1 + "'").join("'__BOTC['");
s = s.split(OLD2).join(']');
s = s.split(String.fromCharCode(0x27A6)).join('');   // 清掉注释里残余
fs.writeFileSync(f, s, 'utf8');
console.log('changed=' + (before !== s));
console.log('residual27A6=' + s.includes(String.fromCharCode(0x27A6)) + ' residual27A5=' + s.includes(String.fromCharCode(0x27A5)));
console.log('hasASCII=' + s.includes('__BOTC['));