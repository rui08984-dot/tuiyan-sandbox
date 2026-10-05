'use strict';
/**
 * p1b/scripts/voi-a.cjs —— PREREG-VoI-a 弱口径离线验证（S2续集-Gemini增量设计.md §③）。
 *
 * 铁律：零 LLM 调用；库只读（PRAGMA query_only=ON 兜底，全程 SELECT/PRAGMA）；结论=弱口径
 * 探索性（v2=信息真空域，开口规则在此域=「LLM 何时比基率差得少」）；禁改 PREREG 冻结件；
 * 结算证据（v1 判词读数）不进门控——防读数泄漏（R-A/R-B 拆分同源纪律）。
 *
 * 门控（预注册式写死，禁事后调）：
 *   open(x) = C(x) ∧ (D(x) ≤ τ_D) ∧ (p_base(x) ∈ [0.3, 0.7])
 *   C(x)：|p_v2(x) − 0.5| ≥ 0.1 记非退化（代理口径——设计稿 §③ F22 双 p 值法在 n=90
 *         小样本 conformal 全集判定失真，队长任务书改代理口径，如实标注）
 *   D(x)：三路判词方差 var([p_v1,p_v2,p_v3])，总体方差 ddof=0；任一路缺失 → D=不可算 →
 *         一律 close（预注册写死：信息不足不开口，VoI 语义保守侧；本库 v3 缺 pid56/80）
 *   p_base(x)：分题型 LOO true 占比（win/votes/peace 三型按 statement 精确匹配映射，排除
 *         自身）；非三模板 statement → 报错终止（映射写死不猜测）
 *   τ_D 校准规则：候选=「C∧基率两条件通过」点集的每个观测 D 值 + +INF（D 全放行）；
 *         取 open 率 ∈ [20%,40%] 中距 30% 最近者（并列取更小 τ_D=更保守）；无候选落窗 →
 *         失败长相②路径如实报告（重校准一次=取最接近窗者，再退化→砍 VoI 门）。
 *
 * 主判据（设计稿 §③）：开口子集 ΔBrier=(Brier_v2−Brier_base) < 全量 ΔBrier（方向性）。
 * 噪声条款：|ΔBrier_open − ΔBrier_all| ≥ 0.06 → 超噪声带（差异可作方向性结论）；<0.06 →
 * 条款内（仅弱信号不作确证）——±0.06 为 n=60 噪声条款先例口径（PREREG §三 v3 条）。
 * 分层出示：全量 / L6 / L1 三口径分列，禁跨层混合宣称（PREREG §一）。
 * 失败长相：①开口子集 ΔBrier ≥ 全量 → J5 开口规则本域证伪；②τ_D 塌窗；③需新 LLM 调用即砍
 * （本脚本纯离线统计，③天然满足）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../src/deps');

const RAW_OUT = path.join(__dirname, '..', '..', '.run-out', 'forecast-debate', 'voi-a-raw-20260912.json');
const DB_PATH = path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db');

const TYPE_MAP = {
  '本局狼人阵营胜利': 'win',
  '本局放逐投票最高票数 >= 3 票': 'votes',
  '本局首夜平安（无人死亡）': 'peace',
};

function brierScore(probs, outs) {
  let sum = 0;
  for (let i = 0; i < probs.length; i++) sum += Math.pow(probs[i] - outs[i], 2);
  return sum / probs.length;
}
function variance3(arr) { // 总体方差 ddof=0，3 点
  const m = (arr[0] + arr[1] + arr[2]) / 3;
  return (Math.pow(arr[0] - m, 2) + Math.pow(arr[1] - m, 2) + Math.pow(arr[2] - m, 2)) / 3;
}

function main() {
  const conn = db.getConnection();
  conn.pragma('query_only = ON'); // 只读兜底：任何写语句即抛错

  // ── 数据抽取（单 SQL，LEFT JOIN 三路）──
  const rows = conn.prepare(
    "SELECT p.id, p.statement, p.outcome, p.layer, p.tautology,"
    + " v1.implied_prob AS p_v1, v2.implied_prob AS p_v2, v3.implied_prob AS p_v3"
    + " FROM predictions p"
    + " LEFT JOIN verdicts v1 ON v1.prediction_id = p.id AND v1.prompt_variant = 'v1_evidence'"
    + " LEFT JOIN verdicts v2 ON v2.prediction_id = p.id AND v2.prompt_variant = 'v2_skeptical'"
    + " LEFT JOIN verdicts v3 ON v3.prediction_id = p.id AND v3.prompt_variant = 'v3_baserate'"
    + " ORDER BY p.id"
  ).all();
  if (rows.length !== 90) throw new Error('predictions 行数=' + rows.length + ' 预期 90，中止');

  // ── 分型与真值（写死映射，非模板 statement 即终止）──
  const pts = rows.map((r) => {
    const type = TYPE_MAP[r.statement];
    if (!type) throw new Error('statement 不在预注册三模板内 pid=' + r.id + ': ' + r.statement);
    if (r.outcome !== 'true' && r.outcome !== 'false') throw new Error('outcome 异常 pid=' + r.id + ': ' + r.outcome);
    return {
      id: r.id, type: type, layer: r.layer, tautology: r.tautology,
      y: r.outcome === 'true' ? 1 : 0,
      p_v2: r.p_v2, p_v1: r.p_v1, p_v3: r.p_v3,
    };
  });
  const v2Null = pts.filter((p) => p.p_v2 === null || p.p_v2 === undefined);
  if (v2Null.length) throw new Error('v2 implied_prob 存在 NULL ' + v2Null.length + ' 条，中止（数据完整性）');

  // ── 分型 LOO 基率（排除自身）──
  const typeStats = {};
  for (const t of ['win', 'votes', 'peace']) {
    const sub = pts.filter((p) => p.type === t);
    typeStats[t] = { n: sub.length, trueN: sub.filter((p) => p.y === 1).length };
  }
  for (const p of pts) {
    const st = typeStats[p.type];
    p.base = (st.trueN - p.y) / (st.n - 1); // LOO：排除自身
  }

  // ── 门控三条件 ──
  for (const p of pts) {
    p.C = Math.abs(p.p_v2 - 0.5) >= 0.1; // 代理口径
    const trio = [p.p_v1, p.p_v2, p.p_v3];
    p.D = (p.p_v1 === null || p.p_v3 === null) ? null : variance3(trio);
    p.basePass = p.base >= 0.3 && p.base <= 0.7;
  }
  const twoPass = pts.filter((p) => p.C && p.basePass); // D 校准候选点集
  const dMissing = pts.filter((p) => p.D === null);

  // ── τ_D 校准（规则写死见头注释）──
  const cands = twoPass.map((p) => p.D).concat([Infinity]);
  const scored = cands.map((tau) => {
    const open = pts.filter((p) => p.C && p.basePass && p.D !== null && p.D <= tau);
    return { tau: tau, openN: open.length, rate: open.length / pts.length };
  });
  const inWindow = scored.filter((s) => s.rate >= 0.20 && s.rate <= 0.40);
  inWindow.sort((a, b) => Math.abs(a.rate - 0.30) - Math.abs(b.rate - 0.30) || a.tau - b.tau);
  let tauPick, calibStatus;
  if (inWindow.length) {
    tauPick = inWindow[0];
    calibStatus = '落窗[20%,40%]';
  } else {
    scored.sort((a, b) => b.rate - a.rate || a.tau - b.tau); // 失败长相②：取最接近窗者如实报告
    tauPick = scored[0];
    calibStatus = '塌窗（无候选落 20-40%）→ 失败长相②路径';
  }

  // ── open 判定与 ΔBrier ──
  const openSet = new Set(pts.filter((p) => p.C && p.basePass && p.D !== null && p.D <= tauPick.tau).map((p) => p.id));
  for (const p of pts) p.open = openSet.has(p.id);
  for (const p of pts) {
    p.b_v2 = Math.pow(p.p_v2 - p.y, 2);
    p.b_base = Math.pow(p.base - p.y, 2);
    p.delta = p.b_v2 - p.b_base;
  }

  function scope(name, sub) {
    if (!sub.length) return { name: name, n: 0 };
    const openSub = sub.filter((p) => p.open);
    const dAll = brierScore(sub.map((p) => p.p_v2), sub.map((p) => p.y)) - brierScore(sub.map((p) => p.base), sub.map((p) => p.y));
    const out = {
      name: name, n: sub.length, openN: openSub.length, openRate: openSub.length / sub.length,
      brier_v2: brierScore(sub.map((p) => p.p_v2), sub.map((p) => p.y)),
      brier_base: brierScore(sub.map((p) => p.base), sub.map((p) => p.y)),
      delta_all: dAll,
      delta_open: openSub.length ? brierScore(openSub.map((p) => p.p_v2), openSub.map((p) => p.y)) - brierScore(openSub.map((p) => p.base), openSub.map((p) => p.y)) : null,
    };
    return out;
  }
  const scopes = [
    scope('全量', pts),
    scope('L6', pts.filter((p) => p.layer === 'L6')),
    scope('L1', pts.filter((p) => p.layer === 'L1')),
  ];

  // ── 主判据（全量口径）与噪声条款 ──
  const all = scopes[0];
  const verdictOpenVsAll = (all.delta_open !== null && all.delta_open < all.delta_all) ? '达成（开口子集 ΔBrier < 全量）' : '未达成（开口子集 ΔBrier ≥ 全量 → 失败长相①：J5 开口规则本域证伪）';
  const noiseBand = (all.delta_open !== null && Math.abs(all.delta_open - all.delta_all) >= 0.06) ? '超噪声带（≥0.06，可作方向性结论）' : '条款内（<0.06，仅弱信号不作确证）';

  // ── 伴生读数：开口子集点级 ΔBrier bootstrap 95%CI（LCG 987654321 先例；不进判据）──
  const openPts = pts.filter((p) => p.open);
  const deltasOpen = openPts.map((p) => p.delta);
  let s = 987654321;
  function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const boots = [];
  for (let it = 0; it < 2000; it++) {
    let sum = 0;
    for (let i = 0; i < deltasOpen.length; i++) sum += deltasOpen[Math.floor(rnd() * deltasOpen.length)];
    boots.push(sum / deltasOpen.length);
  }
  boots.sort((a, b) => a - b);
  const ci = { lo: boots[Math.floor(0.025 * 2000)], hi: boots[Math.ceil(0.975 * 2000) - 1] };

  // ── DB 快照 hash（PREREG §二.2 同口径：文件字节 sha256）──
  const dbHash = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex');

  // ── 汇总输出 ──
  const raw = {
    prereg: 'PREREG-VoI-a（弱口径）S2续集-Gemini增量设计.md §③',
    run_at: new Date().toISOString(),
    db_sha256: dbHash,
    data: { predictions: 90, verdicts_v2: 90, verdicts_v1: 90, verdicts_v3: 88, d_missing_pids: dMissing.map((p) => p.id) },
    type_stats: typeStats,
    base_note: '分型 LOO true 占比（排除自身）；peace 型全 false → base=0 恒不过基率窗；votes 型 base>0.7 恒不过；win 型 self-true 21 条 base=0.6897 过窗',
    calibration: { rule: '候选=D 观测值+INF；open 率∈[20%,40%] 距 30% 最近；并列取更小 τ_D', status: calibStatus, tau_D: tauPick.tau, openN: tauPick.openN, openRate: tauPick.rate },
    c_proxy_note: 'F22 双 p 值法 n=90 失真，用 |p_v2-0.5|>=0.1 代理（队长任务书口径，如实标注）',
    scopes: scopes,
    verdict: { main: verdictOpenVsAll, noise: noiseBand, bootstrap_ci_open_delta: ci, bootstrap_note: 'LCG 987654321 ×2000，伴生读数不进判据' },
    compliance: { llm_calls: 0, db_write: false, query_only: true, frozen_files_touched: false },
  };
  fs.writeFileSync(RAW_OUT, JSON.stringify(raw, null, 2), 'utf8');

  console.log('=== PREREG-VoI-a 弱口径离线验证（零 LLM / 库只读） ===');
  console.log('DB sha256:', dbHash);
  console.log('数据: 90 点 | v2=90 v1=90 v3=88（D 缺失 close: pid ' + dMissing.map((p) => p.id).join(',') + '）');
  console.log('分型: ' + JSON.stringify(typeStats));
  console.log('τ_D 校准: ' + calibStatus + ' | τ_D=' + (tauPick.tau === Infinity ? '+INF' : tauPick.tau.toFixed(6)) + ' | open=' + tauPick.openN + '/90 (' + (tauPick.rate * 100).toFixed(1) + '%)');
  console.log('C 代理通过: ' + pts.filter((p) => p.C).length + '/90 | 基率窗通过: ' + pts.filter((p) => p.basePass).length + '/90 | D 可算: ' + pts.filter((p) => p.D !== null).length + '/90');
  console.log('');
  for (const sc of scopes) {
    if (sc.n === 0) { console.log('[' + sc.name + '] n=0'); continue; }
    console.log('[' + sc.name + '] n=' + sc.n + ' open=' + sc.openN + ' (' + (sc.openRate * 100).toFixed(1) + '%)'
      + ' | Brier_v2=' + sc.brier_v2.toFixed(4) + ' Brier_base=' + sc.brier_base.toFixed(4)
      + ' | ΔBrier_all=' + (sc.delta_all >= 0 ? '+' : '') + sc.delta_all.toFixed(4)
      + ' | ΔBrier_open=' + (sc.delta_open === null ? 'n/a' : (sc.delta_open >= 0 ? '+' : '') + sc.delta_open.toFixed(4)));
  }
  console.log('');
  console.log('主判据（全量）: ' + verdictOpenVsAll);
  console.log('噪声条款: ' + noiseBand + ' | |Δopen−Δall|=' + Math.abs(all.delta_open - all.delta_all).toFixed(4));
  console.log('bootstrap 95%CI(开口子集点级ΔBrier 均值): [' + ci.lo.toFixed(4) + ', ' + ci.hi.toFixed(4) + ']（伴生读数不进判据）');
  console.log('合规: LLM 调用=0 | 库写入=0(query_only) | PREREG 冻结件零触碰');
  console.log('raw JSON -> ' + RAW_OUT);
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
}

main();
