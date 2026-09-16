#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/prereg-freeze.cjs —— PREREG 冻结哈希（通用）：口径显式、可复算（2026-09-16）
 *
 * 背景：D-A 教训（sha 口径必须显式写死，否则「按兄弟口径复算判不符」）。E1 的冻结口径＝
 *   「文件**除冻结登记块外**的全部原始字节」（sha256）。
 * 本工具把该口径固化为可执行程序：登记块 = 从 `startMarker` 行起、到其后首个 `--` 分隔行（含）为止的**字节区间**；
 *   哈希对象 = 其余全部原始字节（不做行尾归一、不 join——**字节级**）。
 * 用法：
 *   node p1b/scripts/prereg-freeze.cjs <file> [--start "## 冻结登记"] [--write]
 *   · 无 --write：只打印 sha256 与 MATCH 自检（复算 == 文件内记录值，若已写入）
 *   · --write  ：把 sha 写入文件中首个 `` `PENDING_HASH` `` 位（或首个 ``` `<64hex>` ``` 行）
 * 纪律：冻结后禁改正文（改动=版本递进）；本工具只写哈希位，不改正文。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const FILE = process.argv[2];
if (!FILE) { console.error('用法: node p1b/scripts/prereg-freeze.cjs <file> [--start "## 冻结登记"] [--write]'); process.exit(2); }
function argOf(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const START = argOf('start', '## 冻结登记');
const WRITE = process.argv.indexOf('--write') !== -1;
const P = path.resolve(FILE);
if (!fs.existsSync(P)) { console.error('文件不存在: ' + P); process.exit(2); }

const buf = fs.readFileSync(P);
const text = buf.toString('utf8');
const lines = text.split('\n');
const s = lines.findIndex((l) => l.indexOf(START) !== -1);
if (s < 0) { console.error('未找到登记块起始标记：' + START); process.exit(3); }
let e = -1;
for (let i = s + 1; i < lines.length; i++) { const t = lines[i].trim(); if (t === '--' || t === '---') { e = i; break; } }
if (e < 0) { console.error('未找到登记块结束行（"---"）'); process.exit(3); }

// 字节级切块：登记块 = 第 s 行到 **`---` 行之前一行**（`---` 本身**计入哈希**——E1 冻结件实测口径，变体 A 复现成功）
const beforeLen = Buffer.byteLength(lines.slice(0, s).join('\n') + (s > 0 ? '\n' : ''), 'utf8');
const blockLen = Buffer.byteLength(lines.slice(s, e).join('\n') + '\n', 'utf8');
const head = buf.subarray(0, beforeLen);
const tail = buf.subarray(beforeLen + blockLen);
const hashed = Buffer.concat([head, tail]);
const h = crypto.createHash('sha256').update(hashed).digest('hex');

const bodyText = hashed.toString('utf8');
const recorded = (/(?:sha256[^\n]*?|^|\s)`([0-9a-f]{64})`/m.exec(text) || [])[1] || null;
console.log('file      = ' + P);
console.log('blockLines= ' + (s + 1) + '..' + e + '（登记块，排除在哈希外；`---` 行计入）');
console.log('sha256    = ' + h);
console.log('recorded  = ' + (recorded || '(无)'));
console.log('MATCH     = ' + (recorded ? String(recorded === h) : 'n/a'));
console.log('口径      = 文件除登记块（第 ' + (s + 1) + '-' + e + ' 行）外全部原始字节，sha256，字节级（`---` 计入哈希）');

if (WRITE) {
  let out = text;
  if (/`PENDING_HASH`/.test(out)) out = out.replace('`PENDING_HASH`', '`' + h + '`');
  else if (/`[0-9a-f]{64}`/.test(out)) out = out.replace(/`[0-9a-f]{64}`/, '`' + h + '`');
  else { console.error('未找到哈希写入位（`PENDING_HASH` 或 `<64hex>`）'); process.exit(4); }
  fs.writeFileSync(P, out, 'utf8');
  console.log('写入完成（--write）：哈希位已更新');
}
