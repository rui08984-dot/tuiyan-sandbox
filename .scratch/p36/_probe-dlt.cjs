'use strict';
// 临时验证：用 daemon 的抽取方式跑 dlt resolver（只读、零写库）
const fs = require('fs');
const path = require('path');
const ROOT = 'E:/music player';
const SRC = path.join(ROOT, 'p1b/scripts/corpus-resolve.cjs');
const src = fs.readFileSync(SRC, 'utf8');
const i = src.indexOf('//RESOLVE-B2');
if (i < 0) { console.error('锚点缺失'); process.exit(2); }
const body = src.slice(0, i) + '\nmodule.exports = { RESOLVERS: RESOLVERS };';
const mod = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(
  mod, mod.exports, require, path.dirname(SRC), null
);
const R = mod.exports.RESOLVERS;
console.log('抽取成功，kind 数:', Object.keys(R).length);
(async () => {
  const r = await R.dlt_draw_result({ issue: '26108' });
  console.log('dlt 26108 实测:', JSON.stringify(r).slice(0, 220));
  const r2 = await R.dlt_draw_result({ issue: '99999' });
  console.log('dlt 99999（不存在期）:', JSON.stringify(r2).slice(0, 120));
})();
