'use strict';
/**
 * p1b/scripts/ablation.cjs —— 多路判词消融（第十棒 W2，离线统计件，零 LLM）。
 *
 * 口径（G-合并 §2 六臂 C 臂 / C 方案 3 预注册判据 / F 算法陷阱清单）：
 *   主判据（预注册冻结）：n≥200 已 resolve（true/false）点，3 路中位聚合 vs 最佳单路
 *   ΔBrier≥0.02 且 bootstrap 95%CI 不含 0；判词间一致率>80% 判伪独立；
 *   任一科学路赢不过 E 玄学安慰剂臂 → 多样性增益=伪增益，砍回单路（E 臂本棒未建，输出预留位）。
 *   选样：predictions.created_at 升序前 N 点，禁事后选样（F 防泄漏 #2）。
 *   n<200 → 一切数字=探索性（明示探索性，F 防多重比较 #3 允许）。
 *
 * 用法：
 *   node scripts/ablation.cjs --smoke                      # :memory: 合成数据烟测（确定性伪随机，零网络零依赖）
 *   node scripts/ablation.cjs [--db <path>] [--limit 200]  # 对真实库已 resolve 点跑（私有表 additive 建表，安全幂等）
 *
 * 退出码：跑通=0；异常非 0（烟测不过=管线坏）。
 */
const { db } = require('../src/deps');
const predictions = require('../src/db/predictionsStore');
const vstore = require('../src/db/verdictsStore');

const ROUTES = vstore.PROMPT_VARIANTS.slice(); // 固定序：v1_evidence/v2_skeptical/v3_baserate
const ROUTE_TEMP = { v1_evidence: 0.2, v2_skeptical: 0.7, v3_baserate: 1.0 };

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** Brier = mean((p-o)^2)，o∈{0,1}；Murphy 分解（分辨率分量）不进本脚本，W3 仪表盘节再议（YAGNI） */
function brierScore(probs, outs) {
  if (!probs.length) return null;
  let sum = 0;
  for (let i = 0; i < probs.length; i++) sum += Math.pow(probs[i] - outs[i], 2);
  return sum / probs.length;
}
function pearson(a, b) {
  const n = a.length;
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, dbb = b[i] - mb;
    cov += da * dbb; va += da * da; vb += dbb * dbb;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}
/** 点级 ΔBrier=(best−agg) 的 bootstrap 95%CI（LCG 确定性伪随机，可复现） */
function bootstrapDeltaCI(deltas, iters) {
  const n = deltas.length;
  let s = 987654321;
  function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const means = [];
  for (let it = 0; it < iters; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += deltas[Math.floor(rnd() * n)];
    means.push(sum / n);
  }
  means.sort(function (a, b) { return a - b; });
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}
function fmt(x) { return (x === null || x === undefined) ? 'n/a' : Number(x).toFixed(4); }

/** 选样+分析+报告。选样=created_at 升序前 limit 已 resolve 点（F 防泄漏 #2）。 */
function runAnalysis(limit, sourceLabel) {
  const conn = db.getConnection();
  const points = conn.prepare("SELECT id, assigned_prob, outcome FROM predictions"
    + " WHERE outcome IN ('true','false') ORDER BY created_at ASC, id ASC LIMIT ?").all(limit);
  console.log('==== p10 ablation · 多路判词消融报告 ====');
  console.log('数据源: ' + sourceLabel);
  console.log('选样: created_at 升序前 ' + limit + ' 已 resolve（true/false）点，禁事后选样（F 防泄漏 #2）');
  if (!points.length) {
    console.log('无已 resolve 点——L0 只记不评阶段，管线待数据。');
    return;
  }
  const pidArgs = points.map(function (p) { return p.id; });
  const vstmt = conn.prepare('SELECT prediction_id, prompt_variant, implied_prob FROM verdicts'
    + ' WHERE prediction_id IN (' + pidArgs.map(function () { return '?'; }).join(',') + ')');
  const vrows = vstmt.all.apply(vstmt, pidArgs); // thisArg=statement 自身（better-sqlite3 原生绑定）
  const byPid = new Map();
  for (const v of vrows) {
    if (v.implied_prob === null || v.implied_prob === undefined) continue; // 抽取失败行如实剔除
    if (!byPid.has(v.prediction_id)) byPid.set(v.prediction_id, {});
    byPid.get(v.prediction_id)[v.prompt_variant] = v.implied_prob;
  }
  const routeProbs = {};
  for (const r of ROUTES) routeProbs[r] = [];
  const aggProbs = [], outs = [], humanProbs = [];
  let dropped = 0;
  for (const p of points) {
    const m = byPid.get(p.id);
    let complete = m !== undefined;
    if (complete) {
      for (const r of ROUTES) if (typeof m[r] !== 'number') complete = false;
    }
    if (!complete) { dropped++; continue; } // 缺任一路的点剔除（计数报告，不静默）
    outs.push(p.outcome === 'true' ? 1 : 0);
    humanProbs.push(p.assigned_prob);
    for (const r of ROUTES) routeProbs[r].push(m[r]);
    aggProbs.push(median(ROUTES.map(function (r) { return m[r]; })));
  }
  const n = outs.length;
  console.log('resolve 点=' + points.length + '，有效点（3 路 implied_prob 齐全）n=' + n + '，缺路剔除=' + dropped);
  console.log('样本声明: ' + (n >= 200
    ? 'n≥200（预注册判据样本量已到）'
    : 'n<200 → 一切数字=探索性（明示探索性，F 防多重比较 #3）；预注册主判据需 n≥200'));
  if (n === 0) { console.log('无完整点，分析终止。'); return; }

  const briers = ROUTES.map(function (r) { return brierScore(routeProbs[r], outs); });
  for (let i = 0; i < ROUTES.length; i++) {
    console.log('  ' + ROUTES[i] + ' (T=' + ROUTE_TEMP[ROUTES[i]] + '): Brier=' + fmt(briers[i]));
  }
  const aggBrier = brierScore(aggProbs, outs);
  console.log('  中位聚合(3 路): Brier=' + fmt(aggBrier));
  console.log('  人工 assigned_prob 参照: Brier=' + fmt(brierScore(humanProbs, outs)) + '（落注侧对照，非判词路）');

  let bestIdx = 0;
  for (let i = 1; i < briers.length; i++) if (briers[i] < briers[bestIdx]) bestIdx = i;
  const bestRoute = ROUTES[bestIdx];
  const bestProbs = routeProbs[bestRoute];
  const delta = briers[bestIdx] - aggBrier;
  const deltas = [];
  for (let i = 0; i < n; i++) {
    deltas.push(Math.pow(bestProbs[i] - outs[i], 2) - Math.pow(aggProbs[i] - outs[i], 2));
  }
  const ci = bootstrapDeltaCI(deltas, 1000);
  const ciContainsZero = ci[0] <= 0 && ci[1] >= 0;
  console.log('ΔBrier（最佳单路 ' + bestRoute + ' − 中位聚合）= ' + (delta >= 0 ? '+' : '') + fmt(delta));
  console.log('  bootstrap95%CI=[' + fmt(ci[0]) + ', ' + fmt(ci[1]) + ']（iters=1000；含 0=' + (ciContainsZero ? '是' : '否') + '）');
  let verdictLine;
  if (n < 200) verdictLine = '主判据未到样本量（n≥200 才许下结论；当前仅装置烟测/探索性观察）';
  else if (delta >= 0.02 && !ciContainsZero) verdictLine = '主判据达成：聚合显著优于最佳单路（ΔBrier≥0.02 且 CI 不含 0）';
  else if (delta < 0.01) verdictLine = '触发砍件条款：ΔBrier<0.01 → 多样性幻觉，砍回 1 路省 3× 成本（C 方案 3 可证伪成本结论，非失败）';
  else verdictLine = '主判据未达成（ΔBrier<0.02 或 CI 含 0）——继续积累观察';
  console.log('  判据: ' + verdictLine);

  let agree = 0, total = 0;
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < ROUTES.length; a++) {
      for (let b = a + 1; b < ROUTES.length; b++) {
        total++;
        const sa = routeProbs[ROUTES[a]][i] >= 0.5, sb = routeProbs[ROUTES[b]][i] >= 0.5;
        if (sa === sb) agree++;
      }
    }
  }
  const agreeRate = total ? agree / total : null;
  console.log('一致率(对 0.5 方向, 3 路两两): ' + (agreeRate === null ? 'n/a' : (agreeRate * 100).toFixed(1) + '%')
    + (agreeRate !== null && agreeRate > 0.8 ? '  ← >80% 判伪独立（回声风险，G-合并 §2）' : ''));
  console.log('判词相关矩阵（Pearson）:');
  for (let a = 0; a < ROUTES.length; a++) {
    for (let b = a + 1; b < ROUTES.length; b++) {
      console.log('  ' + ROUTES[a] + ' × ' + ROUTES[b] + ': ' + fmt(pearson(routeProbs[ROUTES[a]], routeProbs[ROUTES[b]])));
    }
  }
  console.log('E 玄学安慰剂臂: 未建（W2 范围外，G-合并 §2 预留；建后任一科学路输 E 臂即砍回单路）');
  console.log('（本报告=离线统计件零 LLM；对外展示一切数字只配「参考」，禁「预测」字样）');
}

/** --smoke：:memory: 合成数据烟测（FK ON → 先 createGame 造真局挂 synthetic 行，队长口径路径 A） */
function runSmoke() {
  db.init(':memory:');
  predictions.ensurePredictionsTable(db.getConnection()); // p1b 私有表先建再插行
  vstore.ensureVerdictsTable(db.getConnection());
  const game = db.createGame('烟测局', 'werewolf', 6);
  let s = 424242;
  function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const N = 40;
  for (let i = 0; i < N; i++) {
    const truth = rnd() < 0.5;
    const flip = rnd() < 0.2; // v1 带 20% 过自信翻车 → 演示中位聚合稳健性
    const p1 = flip ? (truth ? 0.05 : 0.95) : (truth ? 0.62 + rnd() * 0.3 : 0.38 - rnd() * 0.3);
    const p2 = truth ? 0.52 + rnd() * 0.2 : 0.48 - rnd() * 0.2;
    const p3 = clamp01(0.5 + (rnd() - 0.5) * 0.6);
    const pred = predictions.insertPrediction({
      gameId: game.id, day: 1, sourceType: '预测卡',
      statement: '烟测点 #' + (i + 1) + '：合成判定标准', prob: 0.5, g2Regime: 'R4', maturesAt: null, evidence: [],
    });
    const rr = predictions.resolvePrediction(pred.id, truth ? 'true' : 'false', '烟测合成真值注入');
    if (!rr.ok) throw new Error('烟测 resolve 失败 #' + pred.id);
    const probs = { v1_evidence: clamp01(p1), v2_skeptical: clamp01(p2), v3_baserate: clamp01(p3) };
    for (const r of ROUTES) {
      vstore.saveVerdict({
        predictionId: pred.id, promptVariant: r, temperature: ROUTE_TEMP[r],
        verdictText: '[SMOKE ' + r + '] 合成判词文本（思路非答案，仅供管线烟测）\nP=' + probs[r].toFixed(2),
        impliedProb: probs[r],
      });
    }
  }
  runAnalysis(N, ':memory: 合成数据（smoke，seed=424242，' + N + ' 点全 resolve）');
}

function main() {
  const args = process.argv.slice(2);
  if (args.indexOf('--smoke') !== -1) { runSmoke(); return 0; }
  let dbPath = null, limit = 200;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db') dbPath = args[i + 1];
    if (args[i] === '--limit') limit = parseInt(args[i + 1], 10) || 200;
  }
  db.init(dbPath || db.DEFAULT_DB_PATH);
  predictions.ensurePredictionsTable(db.getConnection());
  vstore.ensureVerdictsTable(db.getConnection());
  runAnalysis(limit, '真实库 ' + (dbPath || db.DEFAULT_DB_PATH));
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error('[ablation] 失败: ' + ((e && e.stack) ? e.stack : e));
  process.exit(1);
}
