'use strict';
/* check-samples.cjs — 校验 samples.json：解析/计数/类别覆盖/期望角色∈剧本 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..', '..', '..'); // extract-retest→itest→botc-adapt→sandbox→docs→根
const s = JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8'));
const roles = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'sandbox', 'botc-adapt', 'data', 'roles-zh.json'), 'utf8'));
const out = [];
out.push('total samples: ' + s.samples.length);
const byEd = {};
for (const x of s.samples) (byEd[x.edition] = byEd[x.edition] || []).push(x.id);
for (const ed of Object.keys(byEd)) out.push(ed + ': ' + byEd[ed].length + ' -> ' + byEd[ed].join(','));
const cats = {};
for (const x of s.samples) (cats[x.cat] = cats[x.cat] || []).push(x.id);
for (const c of Object.keys(cats)) out.push('cat ' + c + ': ' + cats[c].length);
// per-edition category coverage
for (const ed of ['tb','bmr','snv']) {
  const set = new Set(s.samples.filter(x=>x.edition===ed).map(x=>x.cat));
  out.push(ed + ' cats(' + set.size + '): ' + [...set].join('/'));
}
// expected role membership in edition (name_zh or name_en exact)
function inEd(name, ed) {
  const r = roles.find(r => r.name_zh === name || r.name_en === name || r.id === name);
  return r ? (Array.isArray(r.editions) && r.editions.includes(ed) ? 'OK' : 'CROSS-EDITION(' + r.editions.join('/') + ')') : 'NOT-A-ROLE';
}
let issues = 0;
for (const x of s.samples) {
  for (const c of (x.expected.claims || [])) {
    const v = inEd(c.object, x.edition);
    if (v !== 'OK' && c.map_expect === 'main_role') { out.push('!! ' + x.id + ' object「' + c.object + '」: ' + v); issues++; }
    else if (v !== 'OK') out.push('   (note) ' + x.id + ' object「' + c.object + '」: ' + v);
  }
}
out.push('main_role membership issues: ' + issues);
// speakerSeat sanity
for (const x of s.samples) {
  if (x.speakerSeat !== null && !s.players.some(p=>p.seat===x.speakerSeat)) out.push('!! speakerSeat invalid ' + x.id);
  if (x.expected && x.expected.claims.some && x.expected.claims.some(c=>typeof c.subject_seat==='number' && !s.players.some(p=>p.seat===c.subject_seat))) out.push('!! subject_seat out of roster ' + x.id);
}
fs.writeFileSync(path.join(HERE, 'check-samples.out.txt'), out.join('\n'));
console.log('written check-samples.out.txt');