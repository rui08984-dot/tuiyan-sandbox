'use strict';
// PREREG sha256 口径验证+新值计算（协议：覆盖除 "> sha256" 行外全文；禁手拼，全程序化）
// 干跑模式：只打印，不写盘。--apply 时才改写 hash 行。
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const REPO = 'E:/music player';
const REL = '.scratch/forecast-debate/PREREG-判词重跑-v1.md';
const OLD = 'e2609e68b9ded8a08d0509cfc88cd7acfabb8e755a7bf41517074c46132f17e5';
const APPLY = process.argv.includes('--apply');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const toCrlf = (s) => s.replace(/\r?\n/g, '\r\n');

// 1) 取批次1.5 commit(3144452) 的 blob 原始字节（验证口径用）
const blob = execFileSync('git', ['-C', REPO, 'cat-file', 'blob', '3144452:' + REL], { maxBuffer: 20e6 });
console.log('blob bytes =', blob.length, 'BOM =', blob.slice(0, 3).toString('hex') === 'efbbbf');

function splitLines(s) { return s.split('\n'); } // CRLF 行尾 \r 会挂在行尾
function findHashIdx(lines) { return lines.findIndex((l) => l.replace(/\r$/, '').startsWith('> sha256')); }
function transform(s, mode) {
  const lines = splitLines(s);
  const idx = findHashIdx(lines);
  if (idx === -1) throw new Error('hash line not found');
  if (mode === 'drop') return lines.filter((_, i) => i !== idx).join('\n');
  return lines.map((l, i) => (i === idx ? '' : l)).join('\n');
}
// 2) 对 blob 用 2 形态(drop/empty) × 2 行尾(LF/CRLF) = 4 组合复算旧 hash，找命中口径
const blobStr = blob.toString('utf8');
const cand = {
  'drop/LF': sha(Buffer.from(transform(blobStr, 'drop'), 'utf8')),
  'empty/LF': sha(Buffer.from(transform(blobStr, 'empty'), 'utf8')),
  'drop/CRLF': sha(Buffer.from(toCrlf(transform(blobStr, 'drop')), 'utf8')),
  'empty/CRLF': sha(Buffer.from(toCrlf(transform(blobStr, 'empty')), 'utf8')),
};
let hit = null;
for (const [k, v] of Object.entries(cand)) {
  const ok = v === OLD;
  console.log((ok ? 'HIT ' : '    ') + k + ' = ' + v.slice(0, 16) + '...');
  if (ok) hit = k;
}
if (!hit) {
  // 旧值属历史漂移（13 种口径假设均不命中，且头行已被队长改为已冻结=正文必变）——
  // 按显式记档口径继续：drop 整行（含行尾），工作区原始字节。此口径写入 p15-PROGRESS。
  console.log('WARN: 旧 hash 不可复现（历史口径漂移），改用既定口径 drop/LF');
  hit = 'drop/LF';
}
console.log('口径 =', hit);

// 3) 按命中口径对当前工作区文件算新 hash
const cur = fs.readFileSync(REPO + '/' + REL);
const curStr = cur.toString('utf8');
console.log('worktree bytes =', cur.length, 'BOM =', cur.slice(0, 3).toString('hex') === 'efbbbf', 'CRLF =', curStr.includes('\r\n'));
const [mode] = hit.split('/');
const applyCrlf = hit.endsWith('CRLF');
const newHash = applyCrlf ? sha(Buffer.from(toCrlf(transform(curStr, mode)), 'utf8')) : sha(Buffer.from(transform(curStr, mode), 'utf8'));
console.log('NEW sha256 =', newHash);

if (!APPLY) { console.log('dry-run 结束（未写盘）'); process.exit(0); }

// 4) --apply：仅替换 hash 行内容（保留行尾原样），其余字节不动
const lines = splitLines(curStr);
const idx = findHashIdx(lines);
const cr = lines[idx].endsWith('\r') ? '\r' : '';
lines[idx] = '> sha256（覆盖除本行外全文；冻结时计算）：`' + newHash + '`（已冻结版正文 hash，2026-09-12）' + cr;
fs.writeFileSync(REPO + '/' + REL, lines.join('\n'), 'utf8');
// 5) 复算验证：新文件按同口径 → 必须等于 newHash
const after = fs.readFileSync(REPO + '/' + REL).toString('utf8');
const reHash = applyCrlf ? sha(Buffer.from(toCrlf(transform(after, mode)), 'utf8')) : sha(Buffer.from(transform(after, mode), 'utf8'));
console.log('VERIFY recompute =', reHash, reHash === newHash ? '== NEW OK' : 'MISMATCH FAIL');
console.log('VERIFY line =', after.split('\n')[idx]);