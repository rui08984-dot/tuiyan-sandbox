'use strict';
const fs = require('fs');
const dir = 'E:/music player/.scratch/forecast-debate/';
const cache = JSON.parse(fs.readFileSync(dir + 'acr2-cache.json', 'utf8'));
const keys = Object.keys(cache);
const out = [];
let totalUsages = 0;
const byKey = {};
for (const k of keys) {
  const n = (cache[k].usages || []).length;
  totalUsages += n;
  out.push(k + '  readings=' + (cache[k].readings || []).length + ' usages=' + n + ' at=' + cache[k].at);
}
fs.writeFileSync(dir + '_acr2-cachekeys.txt', 'keys=' + keys.length + ' totalUsages=' + totalUsages + '\n' + out.join('\n'), 'utf8');
console.log('keys=' + keys.length + ' totalUsages=' + totalUsages);
