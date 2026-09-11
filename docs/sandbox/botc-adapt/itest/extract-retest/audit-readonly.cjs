'use strict';
const fs = require('fs');
const path = require('path');
const CUTOFF = new Date('2026-09-09T01:30:00');
function walk(root, out) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else { const m = fs.statSync(p).mtime; if (m > CUTOFF) out.push(p + ' @ ' + m.toISOString()); }
  }
}
const out = [];
walk('E:/music player/p1a-terminal/src', out);
walk('E:/music player/p1a-terminal/config', out);
walk('E:/music player/p1b/web/src', out);
console.log(out.length ? out.join('\n') : 'CLEAN: 禁改目录在本会话期间零写入');