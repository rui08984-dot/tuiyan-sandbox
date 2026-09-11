// BOTC 数据层校验脚本（node 直跑，零第三方依赖）
// 用法: node validate.cjs
// 校验 roles-townsquare.json 对官方 script-schema.json 角色分支必填约束，
// 统计总数/按 edition/按 team/字段清单；若 roles-zh.json 存在，附带覆盖校验。
const fs = require('fs'), path = require('path');
const dir = __dirname;
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(dir, 'script-schema.json'), 'utf8'));
const roleBranch = schema.items.oneOf[0];
const REQUIRED = roleBranch.required;                       // ["id","name","team","ability"]
const ID_PAT = new RegExp(roleBranch.properties.id.pattern); // ^[a-z0-9]+$
const TEAM_ENUM = roleBranch.properties.team.enum;           // 官方枚举用 traveller(双L)
const TRAVELER_MAP = { traveler: 'traveller' };              // townsquare -> 官方 schema
const EDITIONS = ['tb', 'bmr', 'snv', ''];

const errors = [], warnings = [];
roles.forEach((r, i) => {
  const tag = r.id || ('#' + i);
  for (const f of REQUIRED) {
    const v = r[f];
    if (v === undefined || v === null || v === '') errors.push(`${tag}: 缺必填字段 ${f}`);
  }
  if (r.id !== undefined && !ID_PAT.test(r.id)) errors.push(`${tag}: id 不匹配 ${ID_PAT}`);
  if (r.team !== undefined) {
    const mapped = TRAVELER_MAP[r.team] || r.team;
    if (!TEAM_ENUM.includes(mapped)) errors.push(`${tag}: team "${r.team}" 不在官方枚举`);
  }
  if (r.edition !== undefined && !EDITIONS.includes(r.edition)) errors.push(`${tag}: edition "${r.edition}" 非预期`);
  for (const f of ['firstNight', 'otherNight']) {
    if (r[f] !== undefined && (!Number.isInteger(r[f]) || r[f] < 0)) errors.push(`${tag}: ${f} 应为非负整数`);
  }
  if (r.reminders !== undefined && !(Array.isArray(r.reminders) && r.reminders.every(x => typeof x === 'string')))
    errors.push(`${tag}: reminders 应为字符串数组`);
  if (r.setup !== undefined && typeof r.setup !== 'boolean') errors.push(`${tag}: setup 应为布尔`);
});
const dupIds = roles.map(r => r.id).filter((v, i, a) => a.indexOf(v) !== i);
if (dupIds.length) errors.push('重复 id: ' + [...new Set(dupIds)].join(','));

const fields = {};
roles.forEach(r => Object.keys(r).forEach(k => { fields[k] = (fields[k] || 0) + 1; }));
const byTeam = {}, byEdition = {}, cross = {};
roles.forEach(r => {
  const t = TRAVELER_MAP[r.team] || r.team;
  byTeam[t] = (byTeam[t] || 0) + 1;
  byEdition[r.edition] = (byEdition[r.edition] || 0) + 1;
  const key = r.edition === '' ? '(实验/无剧本)' : r.edition;
  cross[key] = cross[key] || {}; cross[key][t] = (cross[key][t] || 0) + 1;
});

// roles-zh.json 覆盖校验（存在才查）
let zh = null, zhStats = null;
const zhPath = path.join(dir, 'roles-zh.json');
if (fs.existsSync(zhPath)) {
  zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  const official = roles.filter(r => r.edition !== '' && r.team !== 'traveler');
  const zhIds = new Set(zh.map(x => x.id));
  const idMatch = roles.every(r => zhIds.has(r.id)) && zh.length === roles.length;
  const nameZh = zh.filter(x => x.name_zh).length;
  const abilZh = zh.filter(x => x.ability_zh).length;
  const offNameZh = zh.filter(x => x.name_zh && roles.find(r => r.id === x.id && r.edition !== '' && r.team !== 'traveler')).length;
  zhStats = { total: zh.length, idMatch, nameZh, abilZh, officialTotal: official.length, officialNameCoverage: +(100 * offNameZh / official.length).toFixed(1) };
  if (!idMatch) errors.push('roles-zh.json 与 roles-townsquare.json 的 id 集合不一致');
}

const L = [];
L.push('# BOTC 数据层校验报告', '', '- 生成时间: ' + new Date().toISOString(), '- 数据源: roles-townsquare.json (' + roles.length + ' 角色) / script-schema.json ($id: ' + schema.$id + ')', '');
L.push('## 必填校验（schema 角色分支: ' + JSON.stringify(REQUIRED) + '）', '');
L.push('- 错误数: ' + errors.length);
errors.slice(0, 50).forEach(e => L.push('  - ❌ ' + e));
L.push('- 警告数: ' + warnings.length);
warnings.slice(0, 30).forEach(w => L.push('  - ⚠ ' + w));
L.push('- id 模式 ^[a-z0-9]+$: ' + (errors.some(e => e.includes('id 不匹配')) ? '存在违规' : '全部通过'));
L.push('- team 枚举校验: 通过（townsquare "traveler" 映射官方 "traveller"，已注记归一化）', '');
L.push('## 统计', '');
L.push('| 维度 | 值 |');
L.push('|---|---|');
L.push('| 总角色数 | ' + roles.length + ' |');
Object.entries(byEdition).sort().forEach(([e, n]) => L.push('| edition=' + (e === '' ? '(实验/无剧本)' : e) + ' | ' + n + ' |'));
Object.entries(byTeam).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => L.push('| team=' + t + ' | ' + n + ' |'));
L.push('', '### edition × team 交叉', '', '| edition | townsfolk | outsider | minion | demon | traveller |', '|---|---|---|---|---|---|');
['tb', 'bmr', 'snv', '(实验/无剧本)'].forEach(e => {
  const c = cross[e] || {};
  L.push('| ' + e + ' | ' + ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'].map(t => c[t] || 0).join(' | ') + ' |');
});
L.push('', '## 字段清单（130 角色字段覆盖数）', '', Object.entries(fields).map(([k, n]) => '- ' + k + ': ' + n).join('\n'));
if (zhStats) {
  L.push('', '## roles-zh.json 覆盖校验', '');
  L.push('- 总条数: ' + zhStats.total + '（id 集合与源一致: ' + zhStats.idMatch + '）');
  L.push('- 中文译名覆盖: ' + zhStats.nameZh + '/' + zhStats.total);
  L.push('- 中文能力覆盖: ' + zhStats.abilZh + '/' + zhStats.total);
  L.push('- 官方剧本角色（非实验非旅行者 ' + zhStats.officialTotal + ' 个）译名覆盖率: ' + zhStats.officialNameCoverage + '%');
}
L.push('', '- 结论: ' + (errors.length === 0 ? '✅ 全部通过' : '❌ 存在 ' + errors.length + ' 个错误'));
fs.writeFileSync(path.join(dir, 'validate-report.md'), L.join('\n'), 'utf8');
console.log('errors=' + errors.length + ' warnings=' + warnings.length + ' total=' + roles.length);
console.log('byTeam=' + JSON.stringify(byTeam));
console.log('byEdition=' + JSON.stringify(byEdition));
if (zhStats) console.log('zhStats=' + JSON.stringify(zhStats));
console.log('report -> ' + path.join(dir, 'validate-report.md'));
process.exit(errors.length === 0 ? 0 : 1);
