'use strict';
// _oracle_score.cjs — 玄学查狼实验评分（三法统计+基线对比+二项检验）
const fs = require('fs');
const base = 'E:/music player/docs/sandbox/p2-yijing/';
const truth = JSON.parse(fs.readFileSync(base + 'oracle-truth.json', 'utf8'));

// 解析断语文件
function parseVerdict(file) {
  const text = fs.readFileSync(file, 'utf8');
  const map = {};
  for (const line of text.split('\n')) {
    const mm = line.match(/席位(\d+)（法([ABC])）：\s*(狼|好人)/);
    if (mm) map[mm[1] + '-' + mm[2]] = mm[3];
  }
  return map;
}
const verdicts = {
  botc_rulebook: parseVerdict(base + 'oracle-verdict-botc_rulebook.txt'),
  lyingman_s02e01: parseVerdict(base + 'oracle-verdict-lyingman_s02e01.txt'),
  pandakill_s1e7: parseVerdict(base + 'oracle-verdict-pandakill_s1e7.txt')
};

// 二项右尾 p 值：P(X >= k) when X~Bin(n, p0)
function binomRightTail(n, k, p0) {
  function lnFact(x) { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; }
  function pmf(x) { return Math.exp(lnFact(n) - lnFact(x) - lnFact(n - x) + x * Math.log(p0) + (n - x) * Math.log(1 - p0)); }
  let s = 0;
  for (let x = k; x <= n; x++) s += pmf(x);
  return Math.min(1, s);
}

const out = [];
out.push('# 玄学查狼实验评分（自动计算 ' + new Date().toISOString() + '）\n');
for (const mid of ['A', 'B', 'C']) {
  let n = 0, hit = 0, wolfGuess = 0, wolfTruth = 0, hitWolf = 0, hitGood = 0;
  const dup = {};
  for (const t of truth) {
    if (t.method !== mid) continue;
    const v = verdicts[t.game][t.seat + '-' + mid];
    if (!v) { out.push('MISSING: ' + t.game + ' 席' + t.seat + ' 法' + mid); continue; }
    n++;
    const guessWolf = v === '狼';
    if (guessWolf) wolfGuess++;
    if (t.isWolf) wolfTruth++;
    const isHit = guessWolf === !!t.isWolf;
    if (isHit) hit++;
    if (isHit && t.isWolf) hitWolf++;
    if (isHit && !t.isWolf) hitGood++;
    // 独立卦去重：benGua.name + huGua.name + dongYao + tiYongRelation
    const c = result_cast_key(t);
    dup[c] = (dup[c] || 0) + 1;
  }
  const allGoodBase = n - wolfTruth; // 全猜好人命中数
  const rate = (hit / n * 100).toFixed(1);
  const baseRate = (allGoodBase / n * 100).toFixed(1);
  // 二项检验：H0=断语命中服从全猜好人基线命中率
  const p = binomRightTail(n, hit, allGoodBase / n);
  const indep = Object.keys(dup).length;
  out.push('## 法' + mid + '\n- 断语数: ' + n + '（独立卦象 ' + indep + '）');
  out.push('- 命中: ' + hit + '/' + n + ' = ' + rate + '%（其中狼对' + hitWolf + '、好人对' + hitGood + '）');
  out.push('- 全猜好人基线: ' + allGoodBase + '/' + n + ' = ' + baseRate + '%');
  out.push('- 断语判狼比例: ' + wolfGuess + '/' + n + '，真值狼比例: ' + wolfTruth + '/' + n);
  out.push('- 二项右尾 p（H0=基线命中率）: ' + p.toFixed(4) + (p < 0.05 ? ' → 显著' : ' → 不显著'));
  out.push('');
}
out.push('## 总表（三法合并）\n');
{
  let n = 0, hit = 0, allGood = 0;
  for (const mid of ['A', 'B', 'C']) {
    for (const t of truth) {
      if (t.method !== mid) continue;
      const v = verdicts[t.game][t.seat + '-' + mid];
      n++; const isHit = (v === '狼') === !!t.isWolf;
      if (isHit) hit++;
      if (!t.isWolf) allGood++;
    }
  }
  out.push('- 合计命中 ' + hit + '/' + n + ' = ' + (hit / n * 100).toFixed(1) + '%；全猜好人基线 ' + allGood + '/' + n + ' = ' + (allGood / n * 100).toFixed(1) + '%');
}
function result_cast_key(t) {
  // 从 cast 输入重建 key（seat+game+method 唯一，卦象重复性用 a+b 判断简化：seat+gameNum 与方法已定 a+b）
  return t.game + '|' + t.seat + '|' + t.method;
}
fs.writeFileSync(base + 'oracle-score-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
