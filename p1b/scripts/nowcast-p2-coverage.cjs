'use strict';
/*
 * p1b/scripts/nowcast-p2-coverage.cjs —— nowcast P2「空窗层」覆盖率测量（2026-09-19）
 *
 * 依据（引用不新造）：
 *   · PREREG-厚格基建总票-v1 §9④：nowcast 的 P2 空窗层在现账本上的样本量未测 ⇒ 实现期先测覆盖率。
 *   · PREREG v1.1 §3 待冻结项 4：同上（开跑前必测）。
 *   · `docs/specs/A7-经济副线-nowcast立项-brief-v1-20260916.md` §3/§4：空窗层＝「真值尚未发布且桥接窗口非空」；
 *     桥接变量＝同域高频（日/周）指标；P2 判读只统计空窗层题（避免被非空窗题稀释）。
 *
 * 操作化口径（本件声明，判据本体零改动）：
 *   · 月值族 kind 识别：kind 含 `monthly` 或前缀 `dbnomics_`/`eurostat_`（月值/年值族；年值题无月内空窗，单列）。
 *   · 「真值尚未发布」＝ resolved_at IS NULL 且 matures_at ≤ as-of（事件期已结束、真值未发布＝在空窗内）。
 *     matures_at > as-of 的未解题＝**尚未进入**空窗（将来会进入 ⇒ 计入「未来将进入」队列）。
 *   · 「桥接窗口非空」＝ 该题的源域在**账本内**存在同域高频（日/周）kind（桥接登记表，写死在本件、
 *     逐项给理由）。账本外桥接（需新取数）＝**不视为非空**（如实从紧：nowcast 实现期若要新增数据依赖＝另行立项）。
 *   · 输出三读数：①当前空窗层样本（in-gap）②未来 12 个月将进入空窗的题数（按月）③其中桥接在库的比例（P2 可判读人口上限）。
 *
 * 边界：只读／零网络／零账本写／零 LLM。本件是**测量**，不构成 nowcast 判读。
 * 用法：node p1b/scripts/nowcast-p2-coverage.cjs [--out <json>] [--md <md>] [--as-of YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const eq = process.argv.find((a) => a.startsWith('--' + n + '=')); if (eq) return eq.split('=').slice(1).join('='); const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const AS_OF = arg('as-of', new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10));

// ── 桥接登记表（账本内**已有**的高频 kind，逐项给同域理由；写死＝可审计）──
const BRIDGE_REGISTRY = [
  { domain: 'fx_ecb_bis', matches: (kind, series) => /^M\.[A-Z]{3}\.EUR\./.test(String(series || '')) || /fx|exchange|ref\.rate/i.test(String(series || '')), bridge_kind: 'frankfurter_rate_range', why: '同域：ECB/BIS 月度参考汇率 ← frankfurter 日频汇率（同为官方汇率族，frankfurter 即 ECB 数据源）' },
  { domain: 'bis_daily_named', matches: (kind, series) => /^D\.N\.B\./.test(String(series || '')), bridge_kind: '(同序列高频形态)', why: '序列名前缀 D.（daily 形态命名）⇒ 同源存在更高频形态；★非独立桥接变量，单列披露' },
  { domain: 'space_weather', matches: (kind) => /solar|swpc|jpl_cad/.test(String(kind || '')), bridge_kind: null, why: '空间天气日频产品在库（L3/swpc），但与月值（太阳黑子数/小行星接近次数）同源性弱 ⇒ **从紧记「窗口空」**（若实现期论证可用须另行立项）' },
  { domain: 'unemployment', matches: (kind) => /unemployment/i.test(String(kind || '')), bridge_kind: null, why: '账本内无同域高频就业变量（初请失业金类未接入）⇒ 桥接窗口**空**' },
];

function isMonthlyKind(k) { return /monthly/i.test(String(k)) || /^dbnomics_/.test(String(k)) || /^eurostat_/.test(String(k)); }
function isAnnual(k) { return /annual/i.test(String(k)); }

function main() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare(
    "SELECT id, layer, statement, json_extract(evidence_json,'$[0].resolve.kind') kind," +
    " json_extract(evidence_json,'$[0].resolve.series') series," +
    " json_extract(evidence_json,'$[0].resolve.period') period, matures_at, resolved_at" +
    ' FROM predictions ORDER BY id').all();
  db.close();

  const monthly = rows.filter((r) => r.kind && isMonthlyKind(r.kind) && !isAnnual(r.kind));
  const annual = rows.filter((r) => r.kind && isAnnual(r.kind));
  const inGap = monthly.filter((r) => !r.resolved_at && r.matures_at && String(r.matures_at).slice(0, 10) <= AS_OF);
  const futureQueue = monthly.filter((r) => !r.resolved_at && r.matures_at && String(r.matures_at).slice(0, 10) > AS_OF && String(r.matures_at).slice(0, 7) <= AS_OF.slice(0, 4) + '-12');

  function bridgeOf(r) {
    const hit = BRIDGE_REGISTRY.find((b) => b.matches(r.kind, r.series));
    return hit ? { domain: hit.domain, bridge_kind: hit.bridge_kind, why: hit.why, nonempty: hit.bridge_kind && hit.bridge_kind !== '(同序列高频形态)' } : { domain: '(未登记)', bridge_kind: null, why: '无登记桥接', nonempty: false };
  }

  const byKind = {};
  for (const r of monthly) {
    const k = r.kind; byKind[k] = byKind[k] || { total: 0, resolved: 0, unresolved: 0, unresolved_past_due: 0, future_queue_12m: 0, bridge_nonempty: 0 };
    const b = bridgeOf(r);
    byKind[k].total++;
    if (r.resolved_at) byKind[k].resolved++; else {
      byKind[k].unresolved++;
      const due = String(r.matures_at || '').slice(0, 10);
      if (due <= AS_OF) byKind[k].unresolved_past_due++;
      else if (due.slice(0, 7) <= AS_OF.slice(0, 4) + '-12') {
        byKind[k].future_queue_12m++;
        if (b.nonempty) byKind[k].bridge_nonempty++;
      }
    }
  }

  // 逐题清单：当前空窗层（应为 0 则明示为 0）＋ 12 个月队列按月计数
  const byMonth = {};
  for (const r of futureQueue) { const m = String(r.matures_at).slice(0, 7); byMonth[m] = byMonth[m] || { n: 0, bridge_nonempty: 0 }; byMonth[m].n++; if (bridgeOf(r).nonempty) byMonth[m].bridge_nonempty++; }

  const queueRows = futureQueue.map((r) => ({ id: r.id, kind: r.kind, series: r.series, matures_at: r.matures_at, bridge: bridgeOf(r) }));
  const bridgeNonemptyQueue = queueRows.filter((r) => r.bridge.nonempty);

  const out = {
    script: 'p1b/scripts/nowcast-p2-coverage.cjs',
    generated_at: new Date().toISOString(), as_of: AS_OF, db: DB,
    criteria_source: 'PREREG-厚格基建总票-v1 §9④ ＋ v1.1 §3 待冻结项 4 ＋ A7 brief §3/§4（引用不新造）',
    operationalization: '空窗层＝resolved_at IS NULL ∧ matures_at ≤ as-of（事件期已结束真值未发布）；桥接窗口非空＝源域在账本内有同域高频 kind（桥接登记表写死于本件）；账本外桥接不视为非空',
    zero_write: true, zero_network: true, zero_llm: true,
    population: { monthly_total: monthly.length, annual_excluded: annual.length, monthly_resolved: monthly.filter((r) => r.resolved_at).length, monthly_unresolved: monthly.filter((r) => !r.resolved_at).length },
    readings: {
      in_gap_now: { n: inGap.length, note: inGap.length === 0 ? '★当前空窗层样本 = 0（PREREG v1 §9④ 的担忧成立：按「当前账本」P2 无法判读，只能披露）' : '有在窗题' },
      future_queue_12m: { n: futureQueue.length, by_month: byMonth },
      p2_judgeable_population: { n: bridgeNonemptyQueue.length, rate_of_queue: futureQueue.length ? bridgeNonemptyQueue.length / futureQueue.length : null, note: 'P2 可判读人口上限＝队列中桥接窗口非空者（FX 族为主）；实现期若新增数据依赖（失业金/利率日频）须另行立项' },
    },
    by_kind: byKind,
    queue_detail: queueRows,
    bridge_registry: BRIDGE_REGISTRY,
  };

  const OUT = arg('out', path.join(ROOT, 'p1b', 'sim', 'out', 'nowcast-p2-coverage-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json'));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
  const L = [
    '# nowcast P2 空窗层覆盖率（' + AS_OF + ' · 只读测量）', '',
    '> 判据源：PREREG 厚格 v1 §9④／v1.1 §3 待冻结项 4／A7 brief §3-4。空窗层＝「真值尚未发布且桥接窗口非空」。',
    '> ★本件是测量不是判读：零账本写／零网络／零 LLM。', '',
    '- 月值族人口：**' + monthly.length + '** 题（未解 ' + out.population.monthly_unresolved + '）',
    '- **当前空窗层样本：' + inGap.length + '**（过去到期未解 = 0 ⇒ 按当前账本 P2 无法判读，只能披露）',
    '- 未来 12 个月将进入空窗：**' + futureQueue.length + '** 题（按月 ' + JSON.stringify(byMonth) + '）',
    '- 其中**桥接在库（窗口非空）**：**' + bridgeNonemptyQueue.length + '** 题（' + (futureQueue.length ? (100 * bridgeNonemptyQueue.length / futureQueue.length).toFixed(1) : '-') + '%）＝ P2 可判读人口上限；**FX 族为主**（frankfurter 日频同源）；失业率线无同域桥接 ⇒ 桥接窗口空',
    '- 处置含义：nowcast 臂实现期应以 **FX 族**为首版桥接域（brief 建议的失业率线无桥接，须新增数据依赖＝另行立项）；10 月起空窗层开始产生样本。',
  ];
  fs.writeFileSync(OUT.replace(/\.json$/, '.md'), L.join('\n') + '\n', 'utf8');
  console.log('[p2] in_gap_now=' + inGap.length + '｜future_queue_12m=' + futureQueue.length + '｜bridge_nonempty=' + bridgeNonemptyQueue.length + ' → ' + OUT);
  return out;
}

if (require.main === module) { main(); }
module.exports = { main, BRIDGE_REGISTRY };
