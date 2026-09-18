'use strict';
/**
 * p1b/scripts/anchor-gate.cjs —— Q0 拒收门（三问）**可执行判定**（2026-09-18 · 第 3 期票 A）
 *
 * 判据来源（**引用不新造**）：`docs/specs/万物分类清单-v2.md` **§第 0 步 拒收门**（v2 冻结 2026-09-12）
 *   · Q0-1 resolve 时点是否存在**可机检或第三方可复核**的真值锚？（否 → reason=no_anchor）
 *   · Q0-2 判据冻结（cutoff）是否**早于事件的决定性时点**？（否 → reason=leak）
 *   · Q0-3 **结果是否随实例变化**？恒定即拒收（→ reason=tautology）
 *
 * ★为何存在（本件的立项理由）：第 3 期两张票的**前置**都是「**过锚率 ≥80%**」——
 *   角色③情景分支生成器（子题过锚率）与 I1 日历即题源（生成题过锚率）；而该率在盘上**算不出来**：
 *     ① `intake_rejects` / `intake_questions` **均 0 行**（拒收门在生产从未留痕）
 *     ② 出题器把被丢候选 `continue` 掉了（只落「通过」的行）⇒ 拿现成候选池算出的永远是**构造性 100%**
 *   本件＝该前置的**测量通道**。**不改任何生产判据、零账本写、零网络**。
 *
 * ★操作化投影（**显式声明；判据本体一字未改**）：
 *   Q0-1「锚可达」＝ resolve.kind 在**现役 RESOLVERS** 中 ∧（该解析器**自建 URL** ∨ spec 提供 url/url_template）
 *                     ∨ 显式 certifiedSource 声明（L5 语义）。
 *        ★「kind 已注册但 spec 无 URL 且解析器需要 URL」判 **not_reachable** —— 承 2026-09-18 实测的
 *          **31 条空 URL 缺陷**：**注册 ≠ 可达**（该批题在网络上永远取不到数）。
 *        检测口径（**从现役代码派生，不另立清单**）：取 `RESOLVERS[kind].toString()`，命中
 *        `url_template || r.url` 或 `subst(r.url` ⇒ 该 kind **需要** spec 提供 URL。
 *   Q0-2 → forward：cutoff（落库时点）**早于**事件日；backfill：cutoff **严格早于**事件日（v2 注记要求＝前一日）。
 *        两条都**抽不出 cutoff ⇒ `unverifiable`**（单列，**禁静默当通过**：「我没观测到 ≠ 不存在」）。
 *   Q0-3 → 基率 ∈{0,1} ⇒ `tautology`（结果恒定）。
 *        ★项目出题器另用 **(0.15, 0.85) 红线**——那是**产题口阈**、不是拒收门判据 ⇒ 本件把它**单列为 `inBand`**，
 *          **并列披露、不混判据**（照「同一把尺不混用」纪律）。
 *
 * 用法（只读；零写库）：
 *   node p1b/scripts/anchor-gate.cjs --candidates <rows.json> [--out <json>] [--md <md>] [--label <名>]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RESOLVE_SRC = path.join(__dirname, 'corpus-resolve.cjs');

// ── 判据常量（判定用；投影声明见文件头）──
const PROD_BAND = { lo: 0.15, hi: 0.85 };   // 项目出题器红线（产题口阈；**非**拒收门判据）

// ── 现役解析器注册表：从 corpus-resolve.cjs 的 daemon 抽取锚点上方源码派生（单一真源，不另立清单）──
function loadResolvers(srcPath) {
  const src = fs.readFileSync(srcPath || RESOLVE_SRC, 'utf8');
  const i = src.indexOf('//RESOLVE-B2');           // 与 corpus-resolve-daemon.cjs 同一锚点
  if (i < 0) throw new Error('抽取锚点 //RESOLVE-B2 缺失（抽取失败须硬失败，禁降级）');
  const head = src.slice(0, i);
  const body = head + '\nmodule.exports = { RESOLVERS: RESOLVERS };';
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(mod, mod.exports, require, __dirname, null);
  const R = mod.exports.RESOLVERS;
  if (!R || typeof R !== 'object') throw new Error('抽取结果形状非法（RESOLVERS 缺失）');
  const kinds = Object.keys(R);
  // 「取数需要 URL」的判据：① 直读 spec 的 url/url_template ② 走 specUrl(r)（派生层）
  const needsUrl = new Set();
  for (const k of kinds) {
    const s = typeof R[k] === 'function' ? R[k].toString() : '';
    if (/url_template\s*\|\|\s*r\.url|subst\(\s*r\.url|subst\(\s*specUrl\(/.test(s)) needsUrl.add(k);
  }
  // 「有派生层」的 kind：spec 缺 URL 时也能取数（★修好 31 条空 URL 缺陷后新增的第三类）
  const derives = new Set();
  const di = head.indexOf('const URL_DERIVE');
  if (di >= 0) { for (const m of head.slice(di).matchAll(/^\s{2}([a-z_0-9]+):\s*\(r\)\s*=>/gm)) derives.add(m[1]); }
  return { kinds: new Set(kinds), needsUrl, derives, count: kinds.length };
}

// ── Q0-1 真值锚可达 ──
function q01(resolve, ctx) {
  const rz = resolve || {};
  if (rz.certifiedSource) return { verdict: 'pass', why: '显式 certifiedSource 声明' };
  const kind = rz.kind ? String(rz.kind) : null;
  if (!kind) return { verdict: 'no_anchor', why: '无 resolve.kind（无可机检锚）' };
  if (!ctx.R.kinds.has(kind)) return { verdict: 'no_anchor', why: 'kind 未在现役 RESOLVERS 注册：' + kind };
  const hasUrl = !!(rz.url || rz.url_template);
  if (hasUrl) return { verdict: 'pass', why: 'spec 自带 URL' };
  if (ctx.R.derives && ctx.R.derives.has(kind)) return { verdict: 'pass', why: '缺 URL 但解析器有**派生层**（specUrl 就地派生）' };
  if (ctx.R.needsUrl.has(kind)) {
    return { verdict: 'no_anchor', why: 'kind **已注册但锚不可达**（解析器需 URL 而 spec 未给、且无派生层）：' + kind };
  }
  return { verdict: 'pass', why: '注册＋解析器自建 URL' };
}

// ── 事件窗口起点（Q0-2 的参照点）──
// 口径：**anti-leak 用「事件窗口起点」**——cutoff 必须**严格早于**它（判词不得接触事件窗内任何信息）。
//   单日事件 ⇒ 起点＝该日 ⇒「cutoff＝前一日 23:59:59」即通过（与 v2 注记「cutoff 必须＝事件发生前一天」一致）。
//   月／期事件 ⇒ 起点＝该月/期首日（如 month='2026-10' ⇒ '2026-10-01'）。
// ★首版只认 `resolve.date` ⇒ 66 条「月/期」候选被判 `unverifiable`（**那是本仪器的覆盖缺口，非生成器缺陷**）
//   ⇒ 本版补齐：date／start／month／period／expectDate／expectMonth／eventDate／week_end+1
//     （字段清单照 `corpus-resolve-daemon.cjs` 的 `dueOf()`，同一真源族，不另立）。
/** MMWR（CDC 流行病学周）周首日。规则（标准定义）：周＝周日→周六；**含 ≥4 天新年的那一周**为第 1 周。
 *  自校验（写进测试）：202601→2026-01-04（因 2026-01-01 为周四，其所在 Sun–Sat 周只含 3 天新年 ⇒ 不是第 1 周）。 */
function mmwrWeekStart(epiweek) {
  const s = String(epiweek);
  if (!/^\d{6}$/.test(s)) return null;
  const y = Number(s.slice(0, 4)), w = Number(s.slice(4, 6));
  if (!(w >= 1 && w <= 53)) return null;
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const sunOfJan1 = new Date(jan1.getTime() - jan1.getUTCDay() * 86400000);   // 含 1/1 的 Sun–Sat 周之首日（周日）
  const daysInNewYear = 7 - jan1.getUTCDay();                                  // 该周落在新年的天数
  const week1 = daysInNewYear >= 4 ? sunOfJan1 : new Date(sunOfJan1.getTime() + 7 * 86400000);
  return new Date(week1.getTime() + (w - 1) * 7 * 86400000).toISOString().slice(0, 10);
}

function eventWindowStart(cand) {
  const rz = cand.resolve || {};
  const meta = cand.meta || {};
  const day = (s) => (s ? String(s).slice(0, 10) : null);
  if (rz.date) return day(rz.date);
  if (meta.date) return day(meta.date);
  if (rz.start) return day(rz.start);            // 窗口题（如 npm start..end）⇒ 用窗口起点
  if (rz.epiweek) return mmwrWeekStart(rz.epiweek);
  if (meta.epiweek) return mmwrWeekStart(meta.epiweek);
  if (rz.month) return String(rz.month).slice(0, 7) + '-01';
  if (rz.period) return String(rz.period).slice(0, 7) + '-01';
  if (rz.year) return String(rz.year).slice(0, 4) + '-01-01';               // 年事件（如 Eurostat 年人口）
  if (meta.eventDate) return day(meta.eventDate);
  if (meta.expectDate) return day(meta.expectDate);
  if (meta.expectMonth) return String(meta.expectMonth).slice(0, 7) + '-01';
  if (rz.week_end) return day(rz.week_end);
  if (rz.week) return day(rz.week);
  return null;
}

// ── Q0-2 cutoff 无泄漏 ──
function q02(cand, ctx) {
  const meta = cand.meta || {};
  const rz = cand.resolve || {};
  const cutoff = meta.cutoff || rz.cutoff || null;
  const winStart = eventWindowStart(cand);
  if (!cutoff) {
    // forward 题的 cutoff＝落库时点，常不落 meta ⇒ 从题面抽（出题器口径：cutoff=落库时点 YYYY-MM-DDThh:mm:ss+08:00）
    const m = /cutoff\s*=\s*(?:落库时点\s*)?(\d{4}-\d{2}-\d{2})T/.exec(String(cand.statement || ''));
    if (m) {
      const cDay = m[1];
      if (!winStart) return { verdict: 'unverifiable', why: '抽到 cutoff 但事件窗口起点推不出' };
      return cDay < winStart
        ? { verdict: 'pass', why: '题面 cutoff ' + cDay + ' < 窗口起点 ' + winStart }
        : { verdict: 'leak', why: '题面 cutoff ' + cDay + ' 未早于窗口起点 ' + winStart };
    }
    return { verdict: 'unverifiable', why: 'cutoff 抽不出（meta.cutoff／resolve.cutoff／题面均无）' };
  }
  if (!winStart) return { verdict: 'unverifiable', why: 'cutoff 在但事件窗口起点推不出' };
  const cDay = String(cutoff).slice(0, 10);
  const phase = String(meta.phase || rz.phase || '');
  if (cDay < winStart) return { verdict: 'pass', why: phase + ' cutoff ' + cDay + ' < 窗口起点 ' + winStart };
  return { verdict: 'leak', why: phase + ' cutoff ' + cDay + ' **未早于**窗口起点 ' + winStart };
}

// ── Q0-3 结果随实例变化（非重言）──
function q03(prob) {
  const p = Number(prob);
  if (!isFinite(p)) return { verdict: 'missing', why: '基率缺失（无法判是否恒定）' };
  if (p === 0 || p === 1) return { verdict: 'tautology', why: '基率=' + p + ' ⇒ 结果恒定' };
  return { verdict: 'pass', why: '基率=' + p.toFixed(4) };
}

/** 三问合一。pass ⇔ 三问全 pass（unverifiable 不算 pass，单列）。 */
function gate(cand, ctx) {
  const r1 = q01(cand.resolve, ctx), r2 = q02(cand, ctx), r3 = q03(cand.prob);
  const reasons = [];
  if (r1.verdict !== 'pass') reasons.push(r1.verdict === 'no_anchor' ? 'no_anchor' : r1.verdict);
  if (r2.verdict !== 'pass') reasons.push(r2.verdict === 'leak' ? 'leak' : 'leak_unverified');
  if (r3.verdict !== 'pass') reasons.push(r3.verdict === 'tautology' ? 'tautology' : 'baserate_missing');
  const p = Number(cand.prob);
  return {
    pass: reasons.length === 0,
    reasons: reasons,
    q01: r1, q02: r2, q03: r3,
    inBand: isFinite(p) ? (p > PROD_BAND.lo && p < PROD_BAND.hi) : null,   // 出题器红线（并列披露，不混判据）
  };
}

/** 汇总过锚率。分母＝候选全集（**不是**已入账集）。 */
function summarize(rows, ctx) {
  const n = rows.length;
  const cnt = { pass: 0, no_anchor: 0, leak: 0, leak_unverified: 0, tautology: 0, baserate_missing: 0 };
  const byReason = {};
  let inBand = 0, byPhase = {};
  for (const c of rows) {
    const g = gate(c, ctx);
    if (g.pass) cnt.pass++; else for (const r of g.reasons) cnt[r] = (cnt[r] || 0) + 1;
    for (const r of g.reasons) byReason[r] = (byReason[r] || 0) + 1;
    if (g.inBand) inBand++;
    const ph = String((c.meta || {}).phase || '(none)');
    byPhase[ph] = byPhase[ph] || { n: 0, pass: 0 };
    byPhase[ph].n++;
    if (g.pass) byPhase[ph].pass++;
  }
  return {
    candidates: n,
    pass: cnt.pass,
    anchor_rate: n ? cnt.pass / n : null,
    by_reason: cnt,
    by_phase: Object.fromEntries(Object.keys(byPhase).sort().map((k) => [k, Object.assign(byPhase[k], { anchor_rate: byPhase[k].pass / byPhase[k].n })])),
    in_band: inBand, in_band_rate: n ? inBand / n : null,
    resolvers_registered: ctx.R.count,
  };
}

function arg(n, d) { const a = process.argv.filter((x) => x.indexOf('--' + n + '=') === 0)[0]; if (a) return a.slice(n.length + 3); const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }

function main() {
  const inPath = arg('candidates', null);
  if (!inPath) { console.error('[anchor-gate] 用法：node anchor-gate.cjs --candidates <rows.json> [--out <json>] [--md <md>] [--label <名>]'); process.exit(2); }
  const ctx = { R: loadResolvers() };
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.rows || raw.items || raw.candidates || []);
  if (!rows.length) { console.error('[anchor-gate] 候选 0 条 ⇒ exit 3（防「空集」被读成「通过」）'); process.exit(3); }
  const label = arg('label', path.basename(inPath));
  const s = summarize(rows, ctx);
  // ★候选留痕件（出题器 `--record-candidates` 产物）：drops＝被丢提议 ⇒ 给出**严格分母**。
  //   严格口径＝提议全集（candidates ＋ drops）：被丢的提议**没有 spec ⇒ 锚不可达**，计入未过。
  const drops = Array.isArray(raw.drops) ? raw.drops : null;
  const strict = drops ? {
    drops_total: drops.length,
    drops_by_reason: drops.reduce((a, d) => { a[d.reason] = (a[d.reason] || 0) + 1; return a; }, {}),
    proposed_total: rows.length + drops.length,
    anchor_rate_strict: (rows.length + drops.length) ? s.pass / (rows.length + drops.length) : null,
  } : null;
  const out = {
    script: 'p1b/scripts/anchor-gate.cjs',
    label: label,
    source_file: inPath,
    generated_at: new Date().toISOString(),
    criteria_source: 'docs/specs/万物分类清单-v2.md §第 0 步 拒收门三问（v2 冻结 2026-09-12）',
    projection_note: 'Q0-1 投影＝kind 注册 ∧ 锚可达（注册≠可达；有派生层者视为可达）；Q0-2 抽不出 cutoff ⇒ unverifiable（单列）；Q0-3 只判恒定，出题器红线 (0.15,0.85) 单列 inBand',
    zero_write: true, zero_network: true,
    ...s,
    ...(strict || {}),
  };
  const perReason = s.by_reason;
  console.log('=== Q0 拒收门 · 过锚率（' + label + '）===');
  console.log('  候选（含 spec 的提议）=' + s.candidates + '｜**通过=' + s.pass + '**｜过锚率（候选口径）=' + (s.anchor_rate * 100).toFixed(2) + '%');
  if (strict) {
    console.log('  ★提议全集（＋被丢 ' + strict.drops_total + '：' + JSON.stringify(strict.drops_by_reason) + '）=' + strict.proposed_total
      + '｜**过锚率（严格口径／提议全集）=' + (strict.anchor_rate_strict * 100).toFixed(2) + '%**');
  } else {
    console.log('  （未提供 drops ⇒ **只能给候选口径**；严格口径需出题器 `--record-candidates` 产物）');
  }
  console.log('  未过按原因：no_anchor=' + (perReason.no_anchor || 0) + '｜leak=' + (perReason.leak || 0) + '｜leak_unverified=' + (perReason.leak_unverified || 0) + '｜tautology=' + (perReason.tautology || 0) + '｜baserate_missing=' + (perReason.baserate_missing || 0));
  console.log('  按 phase：' + Object.keys(s.by_phase).map((k) => k + ' n=' + s.by_phase[k].n + ' 过锚率=' + (s.by_phase[k].anchor_rate * 100).toFixed(1) + '%').join(' ｜ '));
  console.log('  （并列披露·非判据）出题器红线 (0.15,0.85) 命中率=' + (s.in_band_rate * 100).toFixed(2) + '%｜现役解析器注册 ' + s.resolvers_registered + ' 种');
  if (arg('out', null)) { fs.writeFileSync(arg('out'), JSON.stringify(out, null, 2), 'utf8'); console.log('  json -> ' + arg('out')); }
  if (arg('md', null)) {
    const L = [];
    L.push('# Q0 拒收门 · 过锚率读数（' + label + '）');
    L.push('');
    L.push('> 判据来源：`docs/specs/万物分类清单-v2.md` §第 0 步（v2 冻结 2026-09-12）｜生成器 `p1b/scripts/anchor-gate.cjs`｜**零写库／零网络**。');
    L.push('> ★分母＝**候选全集**（非已入账集）；投影声明见脚本头注（Q0-1 投影＝注册 ∧ **锚可达**；cutoff 抽不出 ⇒ `unverifiable` 单列；出题器红线单列 `inBand`）。');
    L.push('');
    L.push('| 项 | 值 |');
    L.push('|---|---|');
    L.push('| 候选（全集） | **' + s.candidates + '** |');
    L.push('| **通过（过锚）** | **' + s.pass + '** |');
    L.push('| **过锚率** | **' + (s.anchor_rate * 100).toFixed(2) + '%** |');
    L.push('| 未过：no_anchor／leak／leak_unverified／tautology／baserate_missing | ' + (perReason.no_anchor || 0) + '／' + (perReason.leak || 0) + '／' + (perReason.leak_unverified || 0) + '／' + (perReason.tautology || 0) + '／' + (perReason.baserate_missing || 0) + ' |');
    L.push('| 并列披露（**非判据**）出题器红线 (0.15,0.85) 命中率 | ' + (s.in_band_rate * 100).toFixed(2) + '% |');
    L.push('');
    L.push('| phase | 候选 | 通过 | 过锚率 |');
    L.push('|---|---|---|---|');
    for (const k of Object.keys(s.by_phase)) L.push('| ' + k + ' | ' + s.by_phase[k].n + ' | ' + s.by_phase[k].pass + ' | ' + (s.by_phase[k].anchor_rate * 100).toFixed(1) + '% |');
    L.push('');
    // ★口径纪律（**由生成器自带** ⇒ 重跑不丢；2026-09-18 首次手追加时被重跑覆盖过 ⇒ 收进生成器）
    L.push('## ★读数解读（必读：这个数**不是**过锚率）');
    L.push('');
    L.push('**本件测的是「已入账候选的 Q0 符合率（conformance）」，不是「生成器的过锚率（pass rate）」。** 分母不同：');
    L.push('');
    L.push('| 口径 | 分母 | 本件可否给 |');
    L.push('|---|---|---|');
    L.push('| **符合率**（本件） | **已入账**候选 | ✅ |');
    L.push('| **过锚率**（角色③／I1 两张票的前置要的） | **生成器产出的候选全集**（含被丢的） | ❌ **给不了**——被丢候选零留痕 |');
    L.push('');
    L.push('**为何给不了**：出题器在 Q0-2／Q0-3 不过时直接 `continue`，**被丢候选不落盘**；p1b 私有表 `intake_rejects`／`intake_questions` **均 0 行**（拒收门在生产从未留痕）。');
    L.push('⇒ 拿现成候选池算「过锚率」在数学上恒等于「符合率」，且**结构上偏高**（被拒的已不在池里）。');
    L.push('⇒ **要让「过锚率 ≥80%」这张前置真正可测，必须给测出题器加旁路**，落「候选全集＋Q0 判定」（第 3 期票 A 步骤 2，**未做**）。');
    L.push('');
    L.push('**投影声明**（判据本体未改）：Q0-1＝kind 注册 ∧ **锚可达**（注册≠可达；有派生层者视为可达）；Q0-2 参照点＝**事件窗口起点**，抽不出 cutoff ⇒ `unverifiable` **单列、不计通过**；Q0-3 只判恒定，出题器红线 (0.15,0.85) **单列 `inBand`、不混判据**。');
    L.push('');
    L.push('（读数件完 · 生成器 `p1b/scripts/anchor-gate.cjs` · 候选源 `' + inPath + '`）');
    fs.writeFileSync(arg('md'), L.join('\n') + '\n', 'utf8'); console.log('  md   -> ' + arg('md'));
  }
}

if (require.main === module) main();   // require 本件零副作用（照 scripts-require-safety 不变量）
module.exports = { loadResolvers, q01, q02, q03, gate, summarize, PROD_BAND };
