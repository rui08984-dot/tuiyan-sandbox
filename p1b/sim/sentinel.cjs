'use strict';
/**
 * p1b/sim/sentinel.cjs —— 分布哨兵 v0（设计§2/§3：卡方粗检）
 * 口径（v0 粗检，如实标注）：real=家底 2 局狼人杀 replay 的 E-行文本长度（BOTC 局不入基线）；
 * sim=指定 replay（单文件 --sim 或目录 --simdir 下全部 *.replay.md）的 E-行文本长度。
 * 声称密度=行内命中声称关键词的 E-行占比（近似代理，非结构化 claims）。
 * 卡方：real 四分位四桶 → 期望频率 × sim n；df=3，chi2>7.81 → WARN（p<0.05）。
 * 用法：node sentinel.cjs --sim <file> [--out <path>] ｜ node sentinel.cjs --simdir <dir> --out <path>
 */
const fs = require('fs');
const path = require('path');
const NL = String.fromCharCode(10);
const REAL = ['replay-werewolf-lyingman-s02e01.md', 'replay-werewolf-pandakill-s1e7.md'].map(f => path.join(__dirname, '..', '..', 'docs', 'sandbox', 'p0-replay', f));
const CLAIM_RE = /(\u5ba3\u79f0|\u81ea\u79f0|\u62a5\u51fa|\u67e5\u6740|\u91d1\u6c34|\u8df3\u9884\u8a00\u5bb6|\u8df3\u5973\u5deb|\u72fc\u4eba|\u597d\u4eba)/;
function eLines(f) { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => /^- E-\d+:/.test(l)).map(l => l.replace(/^- E-\d+: */, '')); }
function metrics(files) { const all = files.flatMap(eLines); return { lens: all.map(t => t.length), n: all.length, claimRate: all.filter(t => CLAIM_RE.test(t)).length / Math.max(1, all.length) }; }
function runSentinel(simFiles, outPath) {
  const real = metrics(REAL), sim = metrics(simFiles);
  const sorted = real.lens.slice().sort((a, b) => a - b);
  const q = [0.25, 0.5, 0.75].map(p => sorted[Math.floor(p * sorted.length)]);
  const binOf = v => v <= q[0] ? 0 : v <= q[1] ? 1 : v <= q[2] ? 2 : 3;
  const realBins = [0, 0, 0, 0], simBins = [0, 0, 0, 0];
  real.lens.forEach(v => realBins[binOf(v)]++); sim.lens.forEach(v => simBins[binOf(v)]++);
  let chi2 = 0; const exp = realBins.map(c => c / real.n * sim.n);
  exp.forEach((e, i) => { chi2 += Math.pow(simBins[i] - e, 2) / Math.max(e, 0.5); });
  const warn = chi2 > 7.81;
  const lines = [
    '分布哨兵 v0 粗检报告（口径：E-行文本长度四桶卡方+声称关键词行占比；real 基线=2 局狼人杀家底 replay）',
    'sim 文件数=' + simFiles.length,
    'real: n=' + real.n + ' 桶=' + JSON.stringify(realBins) + ' 声称行占比=' + (real.claimRate * 100).toFixed(1) + '%（四分位切点 ' + q.join('/') + '）',
    'sim : n=' + sim.n + ' 桶=' + JSON.stringify(simBins) + ' 声称行占比=' + (sim.claimRate * 100).toFixed(1) + '%',
    '卡方 chi2=' + chi2.toFixed(2) + '（df=3, 临界 7.81@p0.05）→ ' + (warn ? 'WARN：sim 分布显著偏离真人家底，需复核（模拟语料标注生效）' : 'PASS：粗检未见显著偏离（不代表同分布，仅未检出）'),
    '诚实边界：本哨兵为 v0 粗检——real 侧「声称密度」是关键词代理非结构化 claims；长度分布不等于语义分布；PASS 不构成同分布结论。',
  ];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join(NL) + NL, 'utf8');
  return lines;
}
if (require.main === module) {
  const args = {}; for (let i = 2; i < process.argv.length; i++) { if (process.argv[i] === '--sim') args.sim = process.argv[++i]; if (process.argv[i] === '--simdir') args.simdir = process.argv[++i]; if (process.argv[i] === '--out') args.out = process.argv[++i]; }
  const files = args.simdir ? fs.readdirSync(args.simdir).filter(f => f.endsWith('.replay.md')).sort().map(f => path.join(args.simdir, f)) : [args.sim];
  const lines = runSentinel(files, args.out || path.join(__dirname, 'out', 'm0-sentinel.txt'));
  console.log(lines.join(NL));
}
module.exports = { runSentinel };
