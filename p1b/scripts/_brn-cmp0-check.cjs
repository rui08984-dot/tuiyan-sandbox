'use strict';
const fs = require('fs');
const src = fs.readFileSync('E:/music player/p1b/scripts/corpus-sources-b4.cjs', 'utf8');
const a = src.indexOf('const inBand = (x)');
const b = src.indexOf('// ── 出题证据表');
if (a < 0 || b < 0 || b < a) throw new Error('extract markers not found');
const ci = src.lastIndexOf('function cmp0(');           // 取真实定义（注释里也有旧写法，须从尾部找）
const cLine = src.slice(ci, src.indexOf('\n', ci));
console.log('extracted cmp0 def: ' + cLine);
const body = "const RUN_AT='T'; const LO=0.15, HI=0.85;\n" + src.slice(a, b) + "\n" + cLine + "\nreturn { emitSeries: emitSeries, cmp0: cmp0 };";
const mod = new Function(body)();
console.log('cmp0(">=")=' + mod.cmp0('>=') + ' cmp0("<=")=' + mod.cmp0('<='));
function run(ge) {
  const series = [];
  for (let i = 0; i < 200; i++) series.push({ k: '2024-' + String(i).padStart(3, '0'), v: i });
  const seen = [];
  const cfg = {
    series: series, gameType: 't', layer: 'L3', engine: 'e', ge: ge, minBase: 60,
    bkKeys: ['2024-150'], fwKeys: ['2024-199'], cut: () => 'CUT',
    stmt: (p, k, th, cmp) => p + cmp,
    note: (ph, n, th, hit, q, s, cmp) => { seen.push(cmp); return ph + '|n=' + n + '|dir=' + (mod.cmp0(cmp) ? '>=' : '<='); },
    resolve: () => ({}), meta: () => ({}), slug: (k) => k,
  };
  const out = [];
  mod.emitSeries(cfg, out);
  return { ge: ge, notes: out.map((r) => r.baseRateNote), passedCmp: seen };
}
const f = run(false), t = run(true);
console.log('ge=false -> ' + JSON.stringify(f));
console.log('ge=true  -> ' + JSON.stringify(t));
const okF = f.notes.length === 2 && f.notes.every((x) => x.indexOf('dir=<=') >= 0) && f.passedCmp.every((c) => c === '<=');
const okT = t.notes.length === 2 && t.notes.every((x) => x.indexOf('dir=>=') >= 0) && t.passedCmp.every((c) => c === '>=');
console.log('ASSERT ge=false 全 <= : ' + okF + ' | ge=true 全 >= : ' + okT);
console.log('RESULT ' + (okF && okT ? 'PASS' : 'FAIL'));
process.exit(okF && okT ? 0 : 1);