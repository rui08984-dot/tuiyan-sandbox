// 归一化构建 roles-zh.json：roles-townsquare.json + zh-cache/* → 数据层成品
// 用法: node build-roleszh.cjs
const fs = require('fs'), path = require('path');
const dir = __dirname;
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
const cacheDir = path.join(dir, 'zh-cache');
const UNIQUE_YES = '唯一（BOTC 常规剧本角色每局唯一）';
const UNIQUE_NO = '非唯一（旅行者：官方规则允许多名玩家持同一旅行者角色）';
const out = [], miss = [];
for (const r of roles) {
  const cf = path.join(cacheDir, r.id + '.json');
  let c = null;
  try { c = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch {}
  const mapped = !!(c && c.name_zh);
  if (!mapped) miss.push({ id: r.id, name_en: r.name, edition: r.edition, reason: (c && c.note) || 'wiki 缺页/未验证' });
  out.push({
    id: r.id,
    name_en: r.name,
    name_zh: mapped ? c.name_zh : null,
    team: r.team,
    editions: r.edition === '' ? [] : [r.edition],
    ability_en: r.ability,
    ability_zh: mapped ? (c.ability_zh || null) : null,
    first_night: r.firstNight,
    other_night: r.otherNight,
    reminders: r.reminders,
    unique_note: r.team === 'traveler' ? UNIQUE_NO : UNIQUE_YES,
  });
}
fs.writeFileSync(path.join(dir, 'roles-zh.json'), JSON.stringify(out, null, 2), 'utf8');
const official = out.filter(x => x.editions.length && x.team !== 'traveler');
const offOk = official.filter(x => x.name_zh).length;
const traveler = out.filter(x => x.team === 'traveler');
const travOk = traveler.filter(x => x.name_zh).length;
const exp = out.filter(x => !x.editions.length);
const expOk = exp.filter(x => x.name_zh).length;
const stat = {
  total: out.length, mapped: out.filter(x => x.name_zh).length,
  official_script: official.length, official_mapped: offOk,
  official_coverage_pct: +(100 * offOk / official.length).toFixed(1),
  travelers: traveler.length, travelers_mapped: travOk,
  experimental: exp.length, experimental_mapped: expOk,
  ability_zh: out.filter(x => x.ability_zh).length,
  missing: miss,
};
fs.writeFileSync(path.join(dir, 'build-stats.json'), JSON.stringify(stat, null, 1), 'utf8');
console.log(JSON.stringify({ ...stat, missing: undefined }, null, 1));
console.log('missing ids:', miss.map(m => m.id).join(','));
console.log('roles-zh.json written:', out.length, 'entries');
