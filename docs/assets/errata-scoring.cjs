const r = (x) => Math.round(x * 10000) / 10000;
const base = [['市场',.15,1.0],['产品',.15,2.5],['技术',.15,5.0],['商业',.15,.5],
              ['团队',.10,5.0],['护城河',.15,2.0],['时机',.10,2.0],['融资吸引力',.05,1.5]];
const total = (arr) => r(arr.reduce((s,[,w,g]) => s + w*g, 0));

console.log('原报告写        : 2.50');
console.log('按其自身八项重算:', total(base), ' <- 勘误采信值');

const set = (k,v) => base.map(([n,w,g]) => [n,w,n===k?v:g]);
const b25 = set('商业', 0.25);
console.log('\n--- 修正后加权分对两项硬约束的敏感性 ---');
console.log('A 算术修正                        :', total(base));
console.log('B 商业 0.5->0.25 (回本不可复现+正确LTV/CAC<1):', total(b25));
const b25m15 = set('市场', 1.5);
console.log('C 再加 市场 1.0->1.5 (支柱②被117star部分推翻):', total(b25m15));
const m125 = set('市场', 1.25);
console.log('D 较保守：市场仅->1.25            :', total(set('商业',0.25).map(([n,w,g])=>[n,w,n==='市场'?1.25:g])));
const m125c = set('市场', 1.25);
console.log('E 只动市场 1.0->1.25              :', total(m125c));

console.log('\n--- 硬约束的贡献占比 ---');
console.log('市场+商业 = 0.15*1.0 + 0.15*0.5 =', r(0.15*1.0+0.15*0.5), '/ 总分', total(base),
            '=', r((0.15*1.0+0.15*0.5)/total(base)*100)+'%');
console.log('其余六项贡献 =', r(total(base)-0.225), '(技术 0.75 + 团队 0.50 + 护城河 0.30 + 时机 0.20 + 产品 0.375 + 融资 0.075)');

console.log('\n--- 结论稳健性：把最高分项全给 10 分也救不回来 ---');
const perfect = base.map(([n,w,g]) => [n,w,10]);
console.log('八项全给 10 分（不现实）         :', total(perfect));
const noMkt = base.map(([n,w,g]) => [n,w,n==='市场'?10:g]);
console.log('仅市场给 10 分、其余不动        :', total(noMkt));
console.log('E2 表内 LTV/CAC 8.3 已低于 VC 门槛；正确量纲下 0.16-0.43');
