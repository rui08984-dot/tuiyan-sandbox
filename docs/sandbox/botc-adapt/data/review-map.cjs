// 全表复核输出
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache');
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
const rows = [];
for (const r of roles) {
  const rec = JSON.parse(fs.readFileSync(path.join(cache, r.id + '.json'), 'utf8'));
  rows.push([r.edition || 'exp', r.team.slice(0, 4), r.id, r.name, rec.name_zh || 'NULL', (rec.ability_zh || 'NULL').slice(0, 28)]);
}
// 重复 ability 检测
const ab = {};
for (const r of roles) {
  const rec = JSON.parse(fs.readFileSync(path.join(cache, r.id + '.json'), 'utf8'));
  if (rec.ability_zh) ab[rec.ability_zh] = (ab[rec.ability_zh] || new Set()).add(r.id);
}
console.log('DUPLICATE ability_zh groups:');
for (const [a, ids] of Object.entries(ab)) if (ids.size > 1) console.log(' x' + ids.size, [...ids].join(','), '|', a.slice(0, 30));
console.log('\nFULL TABLE:');
for (const row of rows) console.log(row.join(' | '));
