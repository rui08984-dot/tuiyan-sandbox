'use strict';
// PREREG hash 工具：规则=除行 3 与本 hash 行外全文按 \n 连接、无尾换行
const fs = require('fs'), crypto = require('crypto');
const p = 'E:/music player/.scratch/forecast-debate/PREREG-判词重跑-v1.md';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const hIdx = lines.findIndex((l) => l.indexOf('PENDING_HASH') !== -1 || /^`[0-9a-f]{64}`$/.test(l));
const body = lines.filter((l, i) => i !== 2 && i !== hIdx).join('\n');
const h = crypto.createHash('sha256').update(body).digest('hex');
if (process.argv[2] === '--write') {
  lines[hIdx] = '`' + h + '`';
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
}
// 冻结正文校验（除行 3 外全部原 52 行）
console.log('hash=' + h);
console.log('hashLineIdx(0-based)=' + hIdx + ' lineNo=' + (hIdx + 1));
console.log('frozenBodyCheck=' + (crypto.createHash('sha256').update(lines.slice(0, 52).filter((l, i) => i !== 2).join('\n')).digest('hex')));
