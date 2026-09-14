#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/g2-contract-verify.cjs —— ② 契约表「源码派生」复现检查（2026-09-14）
 *
 * 把红队 #6a「禁止用被审数据的观测键交集反推契约」从**声明**变成**可复现检查**：
 *   冻结表 g2-contract-frozen-r4.json 声称 required/one_of 是**逐 kind 从 corpus-resolve.cjs 源码读出**的。
 *   本脚本从源码重新抽取每个 resolver 的 `r.<key>` 取数键，与冻结表**双向**对比：
 *     · missing_fn      冻结表有 kind，源码无对应函数/别名目标 —— 契约幽灵
 *     · frozen_not_read 冻结要求但源码未读 —— 契约多余（**可能是观测反推的痕迹**）
 *     · read_not_frozen 源码读取但冻结未列 —— 契约漏项
 *   只读，不改任何文件；--strict 时有任一 missing_fn/frozen_not_read 即 exit 1（供门禁用）。
 *
 * 抽取口径（与冻结表 meta.basis 对齐）：
 *   函数体内 `r.<key>` / `r['<key>']`；
 *   公共读取按**调用出现**补入：subst( → url_template/url；finish(|cmpOk( → cmp/threshold；cwlEval( → issue。
 *   别名（aliases: kind→helper）取 helper 函数体 ∪ 同名函数体（若两者都存在）。
 *
 * 用法：node p1b/scripts/g2-contract-verify.cjs [--strict] [--src <f>] [--frozen <f>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const STRICT = process.argv.indexOf('--strict') >= 0;
const SRC = arg('src', path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve.cjs'));
const FROZEN = arg('frozen', path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json'));

const srcText = fs.readFileSync(SRC, 'utf8');
const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
const contracts = frozen.contracts || {};
const aliases = frozen.aliases || {};

/** 抽取「首参为 r」的函数体（花括号配对；跳过字符串/注释）。 */
function extractBodies(text) {
  const out = {};
  const re = /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const params = m[2];
    if (!/^\s*r\s*(,|$)/.test(params)) continue;
    const bodyStart = re.lastIndex - 1;
    let depth = 0, i = bodyStart, inStr = null, inLine = false, inBlock = false;
    for (; i < text.length; i++) {
      const c = text[i], nx = text[i + 1];
      if (inLine) { if (c === '\n') inLine = false; continue; }
      if (inBlock) { if (c === '*' && nx === '/') { inBlock = false; i++; } continue; }
      if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
      if (c === '/' && nx === '/') { inLine = true; i++; continue; }
      if (c === '/' && nx === '*') { inBlock = true; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    out[name] = text.slice(bodyStart + 1, i > bodyStart ? i - 1 : text.length);
  }
  return out;
}

const bodies = extractBodies(srcText);

/** 函数体 + 递归跟 `this.<name>(r)` 委托（防"只读委派"造成假漏读）。 */
function bodyWithDelegation(name, seen) {
  seen = seen || {};
  if (!name || seen[name]) return '';
  seen[name] = 1;
  let body = bodies[name] || '';
  const re = /this\.([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(body)) !== null) body += '\n' + bodyWithDelegation(m[1], seen);
  return body;
}

/** 函数体读取的键：区分**必需读**与**可选读**（`r.<key> || 默认值` ⇒ 可缺省，契约只列必需键）。
 *  公共读取按调用出现补入（subst/finish/cmpOk/cwlEval），与冻结表 meta.basis 同口径，计为必需读。 */
function keysRead(body) {
  const read = new Set(); const optional = new Set();
  let m;
  const re1 = /\br\.([A-Za-z_$][\w$]*)/g;
  while ((m = re1.exec(body)) !== null) {
    const k = m[1];
    read.add(k);
    if (/^\s*\|\|/.test(body.slice(re1.lastIndex, re1.lastIndex + 8))) optional.add(k); // r.key || default
  }
  const re2 = /\br\[\s*'([^']+)'\s*\]/g;
  while ((m = re2.exec(body)) !== null) read.add(m[1]);
  if (/\bsubst\s*\(/.test(body)) { read.add('url_template'); read.add('url'); }
  if (/\bfinish\s*\(|\bcmpOk\s*\(/.test(body)) { read.add('cmp'); read.add('threshold'); }
  if (/\bcwlEval\s*\(/.test(body)) { read.add('issue'); }
  for (const k of ['url_template', 'url', 'cmp', 'threshold', 'issue']) optional.delete(k);
  return { read: read, optional: optional };
}

const report = [];
let nMissingFn = 0, nFrozenNotRead = 0, nReadNotFrozen = 0, nOptional = 0;
const kinds = Object.keys(contracts).sort();
for (const kind of kinds) {
  const target = aliases[kind] || kind;
  const body = bodyWithDelegation(target) + (target !== kind ? '\n' + bodyWithDelegation(kind) : '');
  if (!bodies[target] && !bodies[kind]) { nMissingFn++; report.push({ kind: kind, target: target, verdict: 'missing_fn' }); continue; }
  const kr = keysRead(body);
  const read = kr.read;
  const c = contracts[kind] || {};
  const reqAll = c.required || [];
  const oneOfGroups = c.one_of || [];
  const reqAny = reqAll.concat(oneOfGroups.reduce((a, g) => a.concat(g), []));
  // required：必须读；one_of：每组至少读到一个（未满足记 ONE_OF(...)）
  const frozenNotRead = reqAll.filter((k) => !read.has(k))
    .concat(oneOfGroups.filter((g) => !g.some((k) => read.has(k))).map((g) => 'ONE_OF(' + g.join('|') + ')'));
  // 契约漏项只看**必需读**（可选读 r.x||default 不进契约，属正常）
  const readNotFrozen = Array.from(read).filter((k) => reqAny.indexOf(k) === -1 && !kr.optional.has(k)).sort();
  const optionalNotFrozen = Array.from(kr.optional).filter((k) => reqAny.indexOf(k) === -1).sort();
  if (frozenNotRead.length) nFrozenNotRead++;
  if (readNotFrozen.length) nReadNotFrozen++;
  nOptional += optionalNotFrozen.length;
  report.push({ kind: kind, target: target, required: reqAll.length + oneOfGroups.length, required_keys: reqAny.length,
    read: read.size, frozen_not_read: frozenNotRead, read_not_frozen: readNotFrozen, optional_not_frozen: optionalNotFrozen });
}

const L = [];
L.push('② 契约表源码派生复现检查（' + new Date().toISOString() + '）');
L.push('源: ' + SRC + ' ｜ 冻结表: ' + FROZEN + '（contracts ' + kinds.length + ' / aliases ' + Object.keys(aliases).length + '）');
L.push('');
for (const r of report) {
  if (r.verdict === 'missing_fn') { L.push('[missing_fn] ' + r.kind + ' → 源码无函数/别名目标 ' + r.target); continue; }
  const bad = r.frozen_not_read.length || r.read_not_frozen.length;
  L.push('[' + (bad ? 'DIFF' : 'OK') + '] ' + r.kind + ' → ' + r.target
    + '（required ' + r.required + ' ｜ 读取 ' + r.read + '）'
    + (r.frozen_not_read.length ? ' ｜ **frozen_not_read=' + JSON.stringify(r.frozen_not_read) + '**' : '')
    + (r.read_not_frozen.length ? ' ｜ read_not_frozen=' + JSON.stringify(r.read_not_frozen) : '')
    + (r.optional_not_frozen.length ? ' ｜ 可选读(不入契约)=' + JSON.stringify(r.optional_not_frozen) : ''));
}
L.push('');
L.push('汇总: missing_fn=' + nMissingFn + ' ｜ frozen_not_read=' + nFrozenNotRead + ' ｜ read_not_frozen=' + nReadNotFrozen
  + ' ｜ 可选读(不入契约)=' + nOptional);
L.push('判读: frozen_not_read>0 ⇒ 冻结表要求了源码没读的键（须人工复核，**可能是观测反推痕迹**）；'
  + 'read_not_frozen ⇒ 契约漏项（披露/对账用）；两者都为 0 ⇒ “契约=源码派生”在抽取消歧范围内成立。'
  + '可选读＝源码里以 `r.<key> || 默认值` 出现者（如 note 文案用 region/geo），契约只列必需键，属正常。');
L.push('局限（如实）: 本检查是**正则级**抽取——动态键、间接读取（如 r 整体传给 helper）不在此覆盖内；'
  + '公共读取按调用出现补入（subst/finish/cmpOk/cwlEval），与冻结表 meta.basis 同口径。');
console.log(L.join('\n'));
if (STRICT && (nMissingFn || nFrozenNotRead)) { console.error('[g2-contract-verify] strict: 存在 missing_fn/frozen_not_read ⇒ exit 1'); process.exit(1); }
