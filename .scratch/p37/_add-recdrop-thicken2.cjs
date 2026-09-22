'use strict';
// 一次性：补 corpus-thicken.cjs 剩余 4 处 recipe 内丢弃点（<20 阈值 ×2 ＋ elexon 数据过滤 ×2）
const fs = require('fs');
const P = 'p1b/scripts/corpus-thicken.cjs';
let t = fs.readFileSync(P, 'utf8');
const before = t;

// ① <20 阈值（npm / github 两个 recipe 用的是 20 不是 30）
let n1 = 0;
t = t.replace(/if \((vals|all)\.length < 20\) continue;/g, (m, v) => {
  n1++; return 'if (' + v + '.length < 20) { recDrop(\'recipe\', \'insufficient_history\', {}); continue; }';
});

// ② elexon 数据过滤（非 WIND 燃料类型 / 无效时间戳）
let n2 = 0;
t = t.replace(/if \(String\(r\.fuelType\) !== "WIND"\) continue;/g, () => {
  n2++; return 'if (String(r.fuelType) !== "WIND") { recDrop(\'recipe\', \'not_wind_fuel\', {}); continue; }';
});
let n3 = 0;
t = t.replace(/if \(!k \|\| !isFinite\(v\)\) continue;/g, () => {
  n3++; return "if (!k || !isFinite(v)) { recDrop('recipe', 'invalid_sample', {}); continue; }";
});

fs.writeFileSync(P, t, 'utf8');
console.log('补充替换：insufficient_history(20)=' + n1 + ' not_wind_fuel=' + n2 + ' invalid_sample=' + n3);
console.log('文件变化:', before.length, '→', t.length, '字节');
