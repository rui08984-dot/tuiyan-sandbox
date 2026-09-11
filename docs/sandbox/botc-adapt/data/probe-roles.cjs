// 结构探测：roles-townsquare.json + script-schema.json
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(dir, 'script-schema.json'), 'utf8'));

console.log('=== roles.json ===');
console.log('root type:', Array.isArray(roles) ? 'array' : typeof roles);
if (!Array.isArray(roles)) { console.log('root keys:', Object.keys(roles)); process.exit(0); }
console.log('total roles:', roles.length);
const fields = {};
for (const r of roles) for (const k of Object.keys(r)) fields[k] = (fields[k] || 0) + 1;
console.log('field coverage:', JSON.stringify(fields, null, 0));
const byTeam = {}, byEdition = {};
for (const r of roles) {
  byTeam[r.team] = (byTeam[r.team] || 0) + 1;
  const e = r.edition === undefined ? '<missing>' : String(r.edition);
  byEdition[e] = (byEdition[e] || 0) + 1;
}
console.log('by team:', JSON.stringify(byTeam));
console.log('by edition:', JSON.stringify(byEdition));
const badId = roles.filter(r => !/^[a-z0-9]+$/.test(r.id || ''));
console.log('bad id count:', badId.length, badId.slice(0, 5).map(r => r.id));
const missing = roles.filter(r => !r.id || !r.name || !r.team || !r.ability);
console.log('missing id/name/team/ability:', missing.length, missing.map(r => r.id || r.name));
console.log('sample washerwoman:', JSON.stringify(roles.find(r => r.id === 'washerwoman')));
console.log('sample imp:', JSON.stringify(roles.find(r => r.id === 'imp')));

console.log('=== script-schema.json ===');
console.log('top keys:', Object.keys(schema));
if (schema.oneOf) console.log('oneOf branches:', schema.oneOf.length);
const defs = schema.definitions || schema['$defs'] || {};
console.log('definitions:', Object.keys(defs).join(','));
const roleDef = defs.role || (schema.oneOf || []).find(b => b.properties && b.properties.team);
if (roleDef) {
  console.log('role required:', JSON.stringify(roleDef.required));
  console.log('role props:', Object.keys(roleDef.properties || {}).join(','));
  if (roleDef.properties && roleDef.properties.id) console.log('id schema:', JSON.stringify(roleDef.properties.id));
  if (roleDef.properties && roleDef.properties.team) console.log('team enum:', JSON.stringify(roleDef.properties.team.enum));
}
const metaDef = defs.meta || (schema.oneOf || []).find(b => b.properties && b.properties.name && b.properties.author);
if (metaDef) console.log('meta props:', Object.keys(metaDef.properties || {}).join(','));
