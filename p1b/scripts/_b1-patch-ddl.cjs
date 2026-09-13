'use strict';
const fs = require('fs');
const p = 'E:/music player/p1b/src/db/predictionsStore.js';
let s = fs.readFileSync(p, 'utf8');
const anchor = "  '  matures_at TEXT'";
const idx = s.indexOf(anchor);
if (idx < 0) { console.log('ANCHOR NOT FOUND'); process.exit(1); }
console.log('found@' + idx + ' :: ' + JSON.stringify(s.slice(idx - 6, idx + 78)));
if (s.indexOf("'  metric_version TEXT,'") >= 0) { console.log('already patched'); process.exit(0); }
const rep = "  '  matures_at TEXT',\n  // #1（批次1）：D2 回测题落库必写两列（D2 §8.2）；非空即被 G2 排除出 ① 池\n  '  metric_version TEXT,',\n  '  backtest_batch TEXT'";
const after = s.slice(idx + anchor.length, idx + anchor.length + 2);
const nl = after === '\r\n' ? '\r\n' : '\n';
s = s.slice(0, idx) + rep.split('\n').join(nl) + s.slice(idx + anchor.length);
fs.writeFileSync(p, s);
console.log('PATCHED nl=' + JSON.stringify(nl));