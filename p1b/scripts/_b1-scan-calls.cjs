'use strict';
// _b1-scan-calls：抽取 p1b 下所有 insertPrediction({...}) / updateAuditFields(id,{...}) 的顶层键，防 F16 真白名单误伤
const fs = require('fs'), path = require('path');
const roots = ['E:/music player/p1b/scripts', 'E:/music player/p1b/src', 'E:/music player/p1b/test'];
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(cjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
function balanced(s, i) { // i 指向 '{'
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}
function keysOf(obj) {
  const inner = obj.slice(1, -1);
  const keys = []; let depth = 0, buf = '';
  for (const ch of inner) {
    if ('{[('.indexOf(ch) !== -1) depth++;
    else if ('}])'.indexOf(ch) !== -1) depth--;
    if (ch === ',' && depth === 0) { keys.push(buf); buf = ''; } else buf += ch;
  }
  keys.push(buf);
  return keys.map((k) => (k.split(':')[0] || '').trim()).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}
const allKeys = new Set(); const per = [];
for (const f of roots.reduce((a, r) => walk(r, a), [])) {
  const s = fs.readFileSync(f, 'utf8');
  for (const fn of ['insertPrediction', 'updateAuditFields']) {
    let idx = -1;
    while ((idx = s.indexOf(fn + '(', idx + 1)) !== -1) {
      if (idx > 0 && /[\w$]/.test(s[idx - 1])) continue;      // 跳过 require 解构/定义
      const brace = s.indexOf('{', idx);
      if (brace < 0 || brace - idx > 80) continue;
      const obj = balanced(s, brace);
      if (!obj) continue;
      const ks = keysOf(obj);
      if (!ks.length) continue;
      ks.forEach((k) => allKeys.add(k));
      per.push({ file: f.replace('E:/music player/', ''), fn: fn, keys: ks });
    }
  }
}
console.log('DISTINCT KEYS (' + allKeys.size + '): ' + JSON.stringify([...allKeys].sort()));
console.log('CALL SITES: ' + per.length);
for (const p of per) console.log('  ' + p.file + ' :: ' + p.fn + ' -> ' + p.keys.join(','));
