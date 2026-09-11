// 抽样输出：5 角色原文
const fs = require('fs'), path = require('path');
const dir = __dirname;
const zh = JSON.parse(fs.readFileSync(path.join(dir, 'roles-zh.json'), 'utf8'));
const want = ['washerwoman', 'sailor', 'vortox', 'lilmonsta', 'soldier'];
for (const id of want) {
  const rec = zh.find(x => x.id === id);
  console.log('### ' + id);
  console.log(JSON.stringify(rec, null, 1));
}
