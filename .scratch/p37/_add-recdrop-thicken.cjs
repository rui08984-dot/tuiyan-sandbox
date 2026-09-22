'use strict';
// 一次性：给 corpus-thicken.cjs 的 recipe 内部丢弃点加 recDrop（★info 不含 recipe 上下文变量——build 是匿名函数无 domain 变量）
const fs = require('fs');
const P = 'p1b/scripts/corpus-thicken.cjs';
let t = fs.readFileSync(P, 'utf8');
const before = t;

// ① 网络失败（5 处：jget / jgetProxied 两种）
let n1 = 0;
t = t.replace(/(let j; try \{ j = await jget(?:Proxied)?\([^\n]*?\); \} catch \(e\) \{ )continue; \}/g, (m, p1) => {
  n1++; return p1 + "recDrop('recipe', 'fetch_fail', {}); continue; }";
});

// ② 历史不足（vals / closes）
let n2 = 0;
t = t.replace(/if \((vals|closes)\.length < 30\) continue;/g, (m, v) => {
  n2++; return 'if (' + v + '.length < 30) { recDrop(\'recipe\', \'insufficient_history\', {}); continue; }';
});

// ③ 分位算不出
let n3 = 0;
t = t.replace(/if \(th === null\) continue;/g, (m) => {
  n3++; return "if (th === null) { recDrop('recipe', 'no_quantile', {}); continue; }";
});

// ④ 不在基率带
let n4 = 0;
t = t.replace(/if \(!inBand\(hit\)\) continue;/g, (m) => {
  n4++; return "if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }";
});

fs.writeFileSync(P, t, 'utf8');
console.log('替换统计：fetch_fail=' + n1 + ' insufficient_history=' + n2 + ' no_quantile=' + n3 + ' out_of_band=' + n4);
console.log('文件变化:', before.length, '→', t.length, '字节');
