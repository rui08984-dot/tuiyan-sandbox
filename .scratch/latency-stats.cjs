'use strict';
// latency-stats.cjs — P1a LIVE 抽取实测延迟统计复算
// 数据源: docs/sandbox/p1a/extract-live-data.json（只读，不做任何修改）
// 用法: node .scratch/latency-stats.cjs
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'sandbox', 'p1a', 'extract-live-data.json'), 'utf8'));
const rows = data.results;
const ms = rows.map(function (r) { return r.ms; }).sort(function (a, b) { return a - b; });
const n = ms.length;
const sum = ms.reduce(function (a, b) { return a + b; }, 0);
const median = n % 2 ? ms[(n - 1) / 2] : (ms[n / 2 - 1] + ms[n / 2]) / 2;
const idx = 0.9 * (n - 1);
const lo = Math.floor(idx), hi = Math.ceil(idx);
const p90Linear = ms[lo] + (idx - lo) * (ms[hi] - ms[lo]);
const p90Nearest = ms[Math.ceil(0.9 * n) - 1];
console.log('startedAt = ' + data.startedAt);
console.log('endpoint = ' + data.endpoint.baseUrl + '  model = ' + data.endpoint.model);
console.log('n = ' + n);
console.log('sorted(ms) = ' + ms.map(function (v) { return v.toFixed(3); }).join(', '));
console.log('min = ' + ms[0].toFixed(3) + '  max = ' + ms[n - 1].toFixed(3));
console.log('median = ' + median.toFixed(3));
console.log('P90_linear = ' + p90Linear.toFixed(3));
console.log('P90_nearest_rank = ' + p90Nearest.toFixed(3));
console.log('mean = ' + (sum / n).toFixed(3) + '  total = ' + sum.toFixed(3));
console.log('--- per-case integrity ---');
for (const r of rows) {
  console.log(r.id + ' error=' + JSON.stringify(r.error) + ' warnings=' + r.out.warnings.length
    + ' attempts=' + r.out.meta.attempts + ' mode=' + r.out.meta.mode
    + ' claims=' + r.out.claims.length + ' action=' + (r.out.action ? r.out.action.action : 'null')
    + ' ms=' + r.ms);
}
