'use strict';
const fs = require('fs');
const p = 'E:/music player/p1b/src/db/predictionsStore.js';
let s = fs.readFileSync(p, 'utf8');
const bad = "  '  matures_at TEXT',\r\n  // #1";
const good = "  '  matures_at TEXT,',\r\n  // #1";
const c = s.split(bad).length - 1;
if (c !== 1) { console.log('BAD count=' + c); process.exit(1); }
s = s.replace(bad, good);
fs.writeFileSync(p, s);
console.log('PATCHED ddl comma');