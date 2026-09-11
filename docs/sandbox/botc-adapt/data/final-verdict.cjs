// sailor 裁决材料 + 6 条 EN 原文对照
const fs = require('fs'), path = require('path');
const dir = __dirname;
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
const byId = Object.fromEntries(roles.map(x => [x.id, x]));
for (const id of ['sailor', 'soldier', 'minstrel', 'alchemist', 'fool', 'snitch']) {
  console.log('EN[' + id + ']:', byId[id].ability);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'zh-cache', id + '.json'), 'utf8'));
  console.log('CN[' + id + ']:', (rec.ability_zh || 'NULL'));
  console.log('');
}
