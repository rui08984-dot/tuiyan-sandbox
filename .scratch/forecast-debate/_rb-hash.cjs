'use strict';
// PREREG-RB 冻结 hash 计算（node 原字节口径；排除 `> sha256` 行；p16 教训=禁 pwsh 中转）
const fs = require('fs');
const crypto = require('crypto');
const P = require('path').join(__dirname, 'PREREG-RB-v1-待确认.md');
const lines = fs.readFileSync(P, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('> sha256'));
console.log(crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex'));
