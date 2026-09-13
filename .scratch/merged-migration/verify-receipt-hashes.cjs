'use strict';
/** 反编造自检：把收据 §1/§15 表格里记录的「路径 | sha256」逐行回读磁盘核对。零写。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT = path.join(ROOT, 'p1b', 'sim', 'out', 'merged-migration-receipt-20260913.md');
const txt = fs.readFileSync(RECEIPT, 'utf8');
const rows = [];
// 同一行里先出现反引号路径、再出现反引号 64 位 sha（兼容 §1「阶段|路径|字节|sha|」与 §15「路径|字节|sha|」两种列序）
const re = /^\|[^\n]*?`([^`]*\.[A-Za-z0-9.]+)`[^\n]*?`([0-9a-f]{64})`[^\n]*\|\s*$/gm;
let m;
while ((m = re.exec(txt)) !== null) rows.push({ p: m[1], sha: m[2] });
const results = rows.map((r) => {
  const abs = path.isAbsolute(r.p) ? r.p : path.join(ROOT, r.p.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) return { path: r.p, ok: false, why: 'missing' };
  const h = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  return { path: r.p, ok: h === r.sha, recorded: r.sha.slice(0, 12), actual: h.slice(0, 12) };
});
console.log('核对了 ' + results.length + ' 行收据哈希');
for (const x of results) console.log((x.ok ? 'OK  ' : 'BAD ') + x.path + (x.ok ? '' : '  recorded=' + x.recorded + ' actual=' + x.actual + (x.why ? ' (' + x.why + ')' : '')));
const bad = results.filter((x) => !x.ok);
console.log('RECEIPT_HASHES=' + (bad.length === 0 && results.length >= 10 ? 'PASS' : 'FAIL'));
if (bad.length || results.length < 10) process.exit(1);
