'use strict';
/*
 * splice-section10.cjs — 把生成的 §10 区块**原位替换**进地图文件（A 类刷新）
 * 用法：node .scratch/p25/splice-section10.cjs <map.md> <new-section.md>
 * 纪律（照 §23 先例）：
 *   ① 只替换 `## §10 ` 起、到下一个 `## §` 前的那一段，其余字节**零改动**
 *   ② 自校验：替换前后**节编号集合必须一致**（防「折掉/吞掉」别的节）
 *   ③ 写前备份到 .scratch/p25/（可回滚）
 */
const fs = require('fs');
const crypto = require('crypto');

const [MAP, SEC] = process.argv.slice(2);
if (!MAP || !SEC) { console.error('用法：node splice-section10.cjs <map.md> <new-section.md>'); process.exit(2); }

const orig = fs.readFileSync(MAP, 'utf8');
const lines = orig.split('\n');
const secLines = fs.readFileSync(SEC, 'utf8').replace(/\n$/, '').split('\n');

// 定位 §10 区块
const start = lines.findIndex((l) => /^## §10 /.test(l));
if (start < 0) { console.error('[splice] 未找到 `## §10 ` 行 ⇒ exit 3'); process.exit(3); }
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) { if (/^## §/.test(lines[i])) { end = i; break; } }
console.log('[splice] §10 区块：L' + (start + 1) + '–L' + end + '（' + (end - start) + ' 行）⇒ 新块 ' + secLines.length + ' 行');

const before = lines.slice(0, start);
const after = lines.slice(end);
const out = before.concat(secLines).concat(after);
const outText = out.join('\n');

// 自校验：节编号集合前后一致
const secSet = (t) => { const s = new Set(); for (const m of t.matchAll(/^## (§[0-9]+)/gm)) s.add(m[1]); return s; };
const s0 = secSet(orig), s1 = secSet(outText);
const lost = [...s0].filter((x) => !s1.has(x));
const gained = [...s1].filter((x) => !s0.has(x));
console.log('[splice] 节编号：前 ' + s0.size + ' 个｜后 ' + s1.size + ' 个｜丢 ' + JSON.stringify(lost) + '｜新 ' + JSON.stringify(gained));
if (lost.length) { console.error('[splice] 有节丢失 ⇒ exit 4（禁降级硬上）'); process.exit(4); }
// 硬门：产物不得含 NUL
if (/\u0000/.test(outText)) { console.error('[splice] 产物含 NUL ⇒ exit 5'); process.exit(5); }

// 写前备份
const bak = '.scratch/p26/map-before-splice.md';
fs.writeFileSync(bak, orig, 'utf8');
console.log('[splice] 备份 -> ' + bak + '（sha256 ' + crypto.createHash('sha256').update(orig).digest('hex').slice(0, 16) + '…）');
fs.writeFileSync(MAP, outText, 'utf8');
console.log('[splice] 已写 ' + MAP + '（' + outText.split('\n').length + ' 行；原 ' + lines.length + ' 行）');
