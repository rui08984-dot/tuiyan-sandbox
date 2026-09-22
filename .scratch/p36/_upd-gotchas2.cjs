'use strict';
// 一次性：坑总表「写文件三纪律·反引号」条目升级（2026-09-21 一日内踩 3 次）
const fs = require('fs');
const P = 'C:/Users/crx/.zcode/cli/memories/projects/music-player-7d1623ec4df6adfd/memory/sandbox-env-gotchas.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
// 找到「写文件三纪律」相关条目
const m = /- \*\*[^\n]*写文件三纪律[^\n]*\n/.exec(t);
if (!m) { console.log('★未找到「写文件三纪律」条目；改找其他锚'); process.exit(1); }
const old = m[0];
const add = old.trimEnd() + '\n  - **★2026-09-21 一日内踩 3 次（升级为硬纪律）**：①地图 §72 写入（11 个 commit hash ＋ 3 处文件名被吞空）②坑总表更新（' + BQ + 'curl -x http://127.0.0.1:<port>' + BQ + ' 整段被当命令替换）③**commit message 本身**（' + BQ + '>' + BQ + ' 被吞）。三次都发生在 ' + BQ + 'node -e \"…\"' + BQ + ' 或 ' + BQ + 'git commit -m \"…\"' + BQ + ' 的**内联字符串**里。**硬纪律：凡文本含反引号，一律走文件**（Write 工具写 .md/.cjs，或 ' + BQ + 'git commit -F <file>' + BQ + '），**禁走 bash 内联**。事后自查法＝' + BQ + 'git log -1 --format=%B' + BQ + ' 逐行核（本次靠它抓到两处吞空）。\n';
t = t.replace(old, add);
fs.writeFileSync(P, t, 'utf8');
console.log('已升级「反引号」条纪律');
