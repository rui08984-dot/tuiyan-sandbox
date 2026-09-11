// 缓存映射质量统计
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'zh-cache');
const recs = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const mapped = recs.filter(r => r.name_zh);
const verified = mapped.filter(r => r.file_verified);
const unverified = mapped.filter(r => !r.file_verified);
console.log('total:', recs.length, '| mapped:', mapped.length, '| file_verified:', verified.length, '| unverified:', unverified.length);
console.log('\nUNVERIFIED (need review):');
for (const r of unverified) console.log(' -', r.id, '|', r.name_en, '->', r.name_zh, '| route:', r.retry_route || 'search', '| ability:', r.ability_zh ? r.ability_zh.slice(0, 36) : 'NONE');
const noAbility = mapped.filter(r => !r.ability_zh);
console.log('\nmapped but ability_zh missing:', noAbility.map(r => r.id).join(',') || '(none)');
// 官方剧本角色（edition 非空且非旅行者）缺失清单
const roles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles-townsquare.json'), 'utf8'));
const byId = Object.fromEntries(roles.map(r => [r.id, r]));
const missOfficial = roles.filter(r => r.edition !== '' && r.team !== 'traveler' && !(recs.find(x => x.id === r.id && x.name_zh)));
console.log('\nmissing official-script roles:', missOfficial.map(r => r.id + '(' + r.edition + ')').join(', ') || '(none)');
const missAll = roles.filter(r => !(recs.find(x => x.id === r.id && x.name_zh)));
console.log('missing all:', missAll.map(r => r.id + '(' + r.edition + ',' + r.team + ')').join(', '));
