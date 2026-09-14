'use strict';
/*
 * scripts-index.cjs —— `p1b/scripts/` 目录索引生成器（任务 6 · 批次 3 / 命名整理）
 *
 * 目的：使用者不用逐个打开脚本就知道「有哪些脚本、干什么、会不会写库、测试在哪」。
 *   · 主表：在役脚本按前缀分组（corpus- 取数出题 / g2- 门禁报表 / stage4- 分层真跑 /
 *     prereg-a- 命题A 跑批 / board·exp-health·kind-table 等使用者友好面 / 其余工具）
 *   · 每行：脚本名 ｜ 一句话（从文件头注释抽取）｜ 写库标记（源码含 `--confirm` ⇒ 默认 dry-run）
 *   · 归档区：`archive/` 下的历史一次性探针/修补件（命名的「归档」半边；零活引用，git mv 保历史）
 *   · 只读；输出 `p1b/scripts/README.md`。
 *
 * 用法：node p1b/scripts/scripts-index.cjs [--out p1b/scripts/README.md]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = __dirname;
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const OUT = arg('out', path.join(DIR, 'README.md'));

/** 从文件头注释抽一句话（跳空行与注释标记；取首个 ≥8 字的实义行）。 */
function headline(file) {
  let t;
  try { t = fs.readFileSync(path.join(DIR, file), 'utf8'); } catch (e) { return '（不可读）'; }
  const lines = t.split(/\r?\n/).slice(0, 24);
  for (const raw of lines) {
    let s = raw.trim().replace(/^\/\*+\s*/, '').replace(/^\*\s?/, '').replace(/^\/\/\s?/, '').replace(/\*\/\s*$/, '').trim();
    if (!s || s.length < 8) continue;
    if (/^['"]use strict['"]/.test(s)) continue;
    if (s === 'shebang' || s.charAt(0) === '#') continue;
    s = s.replace(/^(?:[\w.\-]+\/)*[\w.\-]+\.(?:cjs|js|md)\s*[—–-]{1,2}\s*/, '');
    return s.length > 120 ? s.slice(0, 118) + '…' : s;
  }
  return '（无头注）';
}
function rowOf(dirRel, file) {
  const full = dirRel ? path.join(DIR, dirRel, file) : path.join(DIR, file);
  let t = ''; try { t = fs.readFileSync(full, 'utf8'); } catch (e) { /* ignore */ }
  // 写库判定只在**代码行**里找 --confirm（剔除注释行，免得「说明文字里提到 --confirm」被误判）
  const codeOnly = t.split(/\r?\n/).filter((l) => {
    const x = l.trim();
    return x && x.charAt(0) !== '*' && x.slice(0, 2) !== '//' && x.slice(0, 2) !== '/*';
  }).join('\n');
  const writes = /process\.argv[^\n]*--confirm/.test(codeOnly) ? '**可写库**（`--confirm` 才写；默认 dry-run）'
    : (/process\.argv[^\n]*--db|\bposArg\b/.test(codeOnly) ? '只读（含 `--db` 参数）' : '只读');
  const head = headline(path.join(dirRel || '', file));
  return '| `' + (dirRel ? dirRel + '/' : '') + file + '` | ' + head + ' | ' + writes + ' |';
}
const GROUPS = [
  ['使用者友好面（先看这几个）', (f) => /^(board|exp-health|kind-table|scripts-index)\.cjs$/.test(f)],
  ['取数出题 corpus-*', (f) => /^corpus-/.test(f)],
  ['门禁与报表 g2-*', (f) => /^g2-/.test(f)],
  ['分层真跑与计分 stage4-* / judge / rb- / rc-', (f) => /^(stage4-|judge-|rb-|rc-)/.test(f)],
  ['命题 A 跑批 prereg-a-*', (f) => /^prereg-a-/.test(f)],
  ['其余工具', () => true],
];
const files = fs.readdirSync(DIR).filter((f) => fs.statSync(path.join(DIR, f)).isFile() && /\.(cjs|json|md)$/.test(f) && f !== 'README.md');
const used = new Set();
const md = [];
md.push('# p1b/scripts 目录索引（脚本都在干什么）');
md.push('');
md.push('> **自动生成，勿手改**——`node p1b/scripts/scripts-index.cjs`（任务 6 批次 3 / 命名整理）。');
md.push('> 生成时点：' + new Date().toISOString() + '｜在役脚本 ' + files.length + ' 个｜归档件见文末。');
md.push('> 命名约定：`corpus-*` 取数出题｜`g2-*` 门禁报表｜`stage4-*` 分层真跑｜`prereg-a-*` 命题 A｜'
  + '**默认 dry-run、写库须 `--confirm`**（项目纪律）。');
md.push('');
for (const g of GROUPS) {
  const list = files.filter((f) => !used.has(f) && g[1](f)).sort();
  if (!list.length) continue;
  list.forEach((f) => used.add(f));
  md.push('## ' + g[0] + '（' + list.length + '）');
  md.push('');
  md.push('| 脚本 | 一句话 | 写库 |');
  md.push('|---|---|---|');
  for (const f of list) md.push(rowOf('', f));
  md.push('');
}
const archDir = path.join(DIR, 'archive');
let arch = [];
if (fs.existsSync(archDir)) arch = fs.readdirSync(archDir).filter((f) => fs.statSync(path.join(archDir, f)).isFile() && f !== 'README.md').sort();
md.push('## 归档区 `archive/`（' + arch.length + ' 件）');
md.push('');
md.push('历史一次性探针/修补件（对应各阶段已完成任务；**零活引用**，`git mv` 保历史）。'
  + '它们**不是**运行依赖；查某件来历：`git log --follow -- p1b/scripts/archive/<name>`。');
md.push('');
const byPfx = {};
arch.forEach((f) => { const k = f.split('-')[0]; (byPfx[k] = byPfx[k] || []).push(f); });
for (const k of Object.keys(byPfx).sort()) md.push('- `' + k + '`：' + byPfx[k].map((f) => '`' + f + '`').join('、'));
md.push('');
md.push('（索引完 · 生成器 `p1b/scripts/scripts-index.cjs` · 与 `docs/specs/kind-目录表.md`、`docs/specs/参数表-人话版-v1.md` 同属使用者友好面）');
fs.writeFileSync(OUT, md.join('\n') + '\n', 'utf8');
console.log('[scripts-index] 在役=' + files.length + ' 归档=' + arch.length + ' -> ' + path.relative(ROOT, OUT));
