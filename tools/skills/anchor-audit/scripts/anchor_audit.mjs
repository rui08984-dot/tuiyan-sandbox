#!/usr/bin/env node
// anchor_audit.mjs — 锚点审计：抽查锚/交接文档引用的路径、commit、收据是否真实存在
// 用法: node anchor_audit.mjs <锚.md> <项目根> [--json]
// 退出码: 0=全绿; 1=有红(MISSING/COMMIT-MISSING)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [anchorPath, rootArg, ...flags] = process.argv.slice(2);
if (!anchorPath || !rootArg) {
  console.error('用法: node anchor_audit.mjs <锚.md> <项目根> [--json]');
  process.exit(2);
}
const ROOT = path.resolve(rootArg);
const AS_JSON = flags.includes('--json');

const text = fs.readFileSync(anchorPath, 'utf8');
const lines = text.split(/\r?\n/);

// ── 提取引用 ──
const EXTS = ['jsonl','json','tsx','mjs','cjs','html','txt','log','out','sql','md','ts','js','py','sh','db','ps1','css'];
const extRe = new RegExp('\\.(' + EXTS.join('|') + ')$', 'i');
const refs = new Map(); // raw -> {line, kind}

lines.forEach((ln, i) => {
  const lnClean = ln.replace(/~~[^~]*~~/g, ''); // 剔除删除线（已废止引用）
  // 1) 反引号包裹（优先级最高）
  for (const m of lnClean.matchAll(/`([^`]+)`/g)) {
    const v = m[1].trim();
    const isCommit = /^[0-9a-f]{7,40}$/.test(v);
    const isPath = extRe.test(v) && (v.includes('/') || v.includes('\\') || v.length > 6) && !/^\\.?[a-z0-9]+$/i.test(v);
    if (isCommit || isPath) refs.set(v, { line: i + 1, kind: isCommit ? 'commit' : 'path' });
  }
  // 2) 裸路径（宽规则：只要带已知扩展名且非纯扩展名，就抽）
  for (const m of lnClean.matchAll(/([A-Za-z0-9_][A-Za-z0-9_./\\-]*\.(?:jsonl|json|tsx|mjs|cjs|html|txt|log|out|sql|md|ts|js|py|sh|db|ps1|css))/g)) {
    const v = m[1].trim();
    if (/^\.?[a-z0-9]{1,5}$/i.test(v)) continue;      // 纯扩展名 → 跳过
    if (/^https?:/i.test(v)) continue;                  // URL → 跳过
    refs.set(v, { line: i + 1, kind: 'path' });
  }
});

// ── 判定 ──
const norm = (p) => p.replace(/^[.][/\\]/, '').replace(/\\/g, '/');
const results = [];
for (const [raw, meta] of refs) {
  if (meta.kind === 'commit') {
    let ok = false;
    try { execFileSync('git', ['cat-file', '-e', raw + '^{commit}'], { cwd: ROOT, stdio: 'ignore' }); ok = true; } catch (e) { ok = false; }
    results.push({ raw, ...meta, verdict: ok ? 'COMMIT-OK' : 'COMMIT-MISSING' });
    continue;
  }
  const rel = norm(raw);
  const direct = path.join(ROOT, rel);
  if (fs.existsSync(direct)) { results.push({ raw, ...meta, verdict: 'OK', hit: rel }); continue; }
  // 兜底：按文件名全库搜（限深度，跳噪音）
  const base = path.basename(rel);
  const found = [];
  const walk = (d, dep) => {
    if (dep > 6 || found.length > 3) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (found.length > 3) return;
      if (/^(node_modules|\.git|dist|cache|\.venv)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, dep + 1);
      else if (e.name === base) found.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  };
  walk(ROOT, 0);
  if (found.length === 1) results.push({ raw, ...meta, verdict: 'OK', hit: found[0], via: 'basename' });
  else if (found.length > 1) results.push({ raw, ...meta, verdict: 'SKIP', note: '同名多处: ' + found.join(', ') });
  else results.push({ raw, ...meta, verdict: 'MISSING' });
}

// ── 输出 ──
const cnt = results.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
const red = (cnt.MISSING || 0) + (cnt['COMMIT-MISSING'] || 0);
if (AS_JSON) {
  console.log(JSON.stringify({ anchor: anchorPath, root: ROOT, total: results.length, counts: cnt, red, results }, null, 2));
} else {
  for (const r of results) {
    const tag = '[' + r.verdict + ']';
    const extra = r.hit && r.via ? '  (via ' + r.hit + ')' : r.note ? '  (' + r.note + ')' : '';
    console.log(tag.padEnd(16) + ' L' + String(r.line).padEnd(5) + ' ' + r.raw + extra);
  }
  console.log('----');
  console.log('总计 ' + results.length + ' 条引用 | OK ' + (cnt.OK || 0) + ' | MISSING ' + (cnt.MISSING || 0) + ' | SKIP ' + (cnt.SKIP || 0) + ' | COMMIT-OK ' + (cnt['COMMIT-OK'] || 0) + ' | COMMIT-MISSING ' + (cnt['COMMIT-MISSING'] || 0));
  if (red) console.log('红项 ' + red + ' 个 → 先处置再开工');
}
process.exit(red ? 1 : 0);
