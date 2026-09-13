#!/usr/bin/env node
'use strict';
/* 给 prereg-a-run.cjs 加 --shard/--shards 分片参数（additive 小补丁） */
const fs = require('fs');
const P = 'E:/music player/p1b/scripts/prereg-a-run.cjs';
let s = fs.readFileSync(P, 'utf8');
if (s.includes("arg('shard'")) { console.log('ALREADY-PATCHED'); process.exit(0); }
const a1 = "const MAX_COST = Number(arg('max-cost', '25'));";
if (s.split(a1).length !== 2) { console.log('ABORT a1 hits=' + (s.split(a1).length - 1)); process.exit(1); }
s = s.replace(a1, a1 + "\nconst SHARD = Number(arg('shard', '0')) || 0;\nconst SHARDS = Number(arg('shards', '1')) || 1;");
const a2 = "  const results = [];";
if (s.split(a2).length !== 2) { console.log('ABORT a2 hits=' + (s.split(a2).length - 1)); process.exit(1); }
s = s.replace(a2, "  const sharded = SHARDS > 1 ? conditions.filter(function (x, i) { return i % SHARDS === SHARD; }) : conditions;\n" + a2);
const a3 = "for (const c of conditions) {";
if (s.split(a3).length !== 2) { console.log('ABORT a3 hits=' + (s.split(a3).length - 1)); process.exit(1); }
s = s.replace(a3, "for (const c of sharded) {");
fs.writeFileSync(P, s, 'utf8');
console.log('PATCHED-OK bytes=' + Buffer.byteLength(s));
