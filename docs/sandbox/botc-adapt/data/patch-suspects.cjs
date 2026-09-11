// 粉丝污染能力置空并注记（页面被粉丝同名角色占用，官方能力语义不符）
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache');
const patch = {
  soldier: '灯火管制', minstrel: '魔法祭典', alchemist: '魔法祭典', fool: '歌剧魅影', snitch: '灯火管制',
};
for (const [id, script] of Object.entries(patch)) {
  const f = path.join(cache, id + '.json');
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.ability_zh = null;
  rec.note_contaminated = 'wiki 页 "' + rec.name_zh + '" 被《' + script + '》粉丝同名角色占用，页内能力与官方能力(EN)语义不符，置空防污染';
  fs.writeFileSync(f, JSON.stringify(rec, null, 1), 'utf8');
  console.log('patched', id);
}
console.log('done');
