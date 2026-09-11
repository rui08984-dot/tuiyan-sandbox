// 复查可疑条目与全量 appears_in
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache');
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
console.log('=== minstrel / alchemist / soldier / fool / snitch ===');
for (const id of ['minstrel', 'alchemist', 'soldier', 'fool', 'snitch']) {
  const rec = JSON.parse(fs.readFileSync(path.join(cache, id + '.json'), 'utf8'));
  console.log(id, '| zh:', rec.name_zh, '| appears_in:', JSON.stringify(rec.appears_in), '| fan_like:', rec.fan_like);
  console.log('   ability:', (rec.ability_zh || 'NULL').slice(0, 90));
}
console.log('\n=== all pages with appears_in ===');
for (const role of roles) {
  const rec = JSON.parse(fs.readFileSync(path.join(cache, role.id + '.json'), 'utf8'));
  if (rec.appears_in) console.log(role.id, '->', rec.name_zh, ':', rec.appears_in);
}
console.log('\n=== full ability for the 4 SNV demons + pukka/shabaloth/po ===');
for (const id of ['fanggu', 'vigormortis', 'nodashii', 'vortox', 'pukka', 'shabaloth', 'po']) {
  const rec = JSON.parse(fs.readFileSync(path.join(cache, id + '.json'), 'utf8'));
  console.log(id, ':', (rec.ability_zh || 'NULL').slice(0, 150));
}
