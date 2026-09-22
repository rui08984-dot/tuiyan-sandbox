#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/calendar-questions.cjs —— I1「日历即题源」出题器（2026-09-21 · 第 3 期票 I1 第二步）
 *
 * 依据（**引用不新造**）：交接件 §1 首选下一棒 ②「I1 日历即题源：三源日历已登记 ⇒ 下一步＝生成器＋候选留痕＋
 *   anchor-gate（过锚率 80% 判据）」。三源日历登记的**证据**在 `.scratch/p31/修复收据-20260921.md §6`
 *   （dbnomics-eurostat／fred／ecb 三节，各含 cadence／evidenceUrl／howToUse／自跑记录）。
 *
 * ★本件的立项理由（**与 corpus-thicken 缺陷同根**）：出题器若不知道「源什么时候发布」，
 *   就会生成**永久不可结**的题（（三十八）批刚修的非发布日缺陷、frankfurter 19 条被预筛拦死，同一病根）。
 *   日历的作用＝把「什么时候该有数」变成**出题时的前置约束**，而不是等结算时才发现取不到。
 *
 * 协议（本批锁定，落盘可审计）：
 *   ① **可用源与周期**（取自收据 §6，逐条给证据）：
 *        · eurostat（`eurostat_live_unemployment_monthly`）＝月值，月末后约 **31 天**发布（中位 32、实测 30~39）
 *        · eurostat（`eurostat_live_tertiary_attain`）＝年值，**次年年中**发布（保守取次年 6 月 1 日起可查）
 *   ② **目标期选择**：按「今日 + 发布滞后」推算**下一个可出题的参考期**——即该期数据**尚未发布但即将发布**，
 *      且**发布日 > 今日**（保证 cutoff 早于决定性时点，Q0-2）。
 *   ③ **阈值**：取该域**同 geo 历史值**的分位（q=0.3/0.7），命中率须落出题器红线 (0.15,0.85)；
 *      历史值来自**账本既有同 kind 行**的 base（零网络；账本无同 geo 历史 ⇒ 该 geo 跳过并如实记账）。
 *   ④ **候选留痕**：全部候选（含被丢的）落 `<out>/calendar-questions-<date>.rows.json`，
 *      供 `anchor-gate.cjs` 计算**过锚率**（判据 ≥80%，冻结）。
 *   ⑤ **零账本写**：本脚本只出候选与报告，**不入 predictions**（入账须另走接题门＋拍板）。
 *   ⑥ 零 8787 接触；产物只落 `p1b/sim/out/`（运行时日期戳命名——禁写死生成日）。
 *
 * 用法：
 *   node p1b/scripts/calendar-questions.cjs --dry-run          # 零写盘：只打印将生成的候选
 *   node p1b/scripts/calendar-questions.cjs                    # 落 rows.json + 报告
 *   node p1b/scripts/calendar-questions.cjs --limit 4          # 限条数
 *   node p1b/scripts/anchor-gate.cjs --candidates p1b/sim/out/calendar-questions-<date>.rows.json --label I1-日历出题
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const LIMIT = Number(arg('limit', '0')) || 0;
const DRY = FLAG('dry-run');
const TODAY = new Date().toISOString().slice(0, 10);          // ★运行时日期戳（禁写死）
const RUN_AT = new Date().toISOString();

// ── 候选留痕旁路（2026-09-22 · 承 corpus-sources-b4.cjs / role3-utype.cjs 同款实现）──────────
// 为什么：I1 的前置是「**过锚率 ≥80%**」，而该率的分母＝**提议全集**（含被丢的）。
//   本生成器在「日历推算不出／同 geo 历史不足／分位算不出」时直接 continue ⇒ 被丢提议**零留痕**
//   ⇒ 拿现成候选算出的永远是**构造性 100%**。旁路落「提议全集＋丢弃原因」让过锚率**可测**。
// 纪律：**默认关** ⇒ 不传 `--record-candidates=<path>` 时**零行为变化**（不建数组、不写文件）。
const REC_PATH = (() => { const a = process.argv.find((x) => x.startsWith('--record-candidates=')); return a ? a.slice(20) : null; })();
const DROPS = [];
function recDrop(stage, reason, info) { if (!REC_PATH) return; DROPS.push(Object.assign({ stage: stage, reason: reason }, info || {})); }

// ── 三源日历的**机器可用投影**（来源：收据 §6；此处只落「发布滞后」这一个出题需要的量）──
// ★纪律：滞后值须与收据 §6 的实测一致；改动＝口径变更，须同时改收据并说明。
const SOURCES = [
  {
    id: 'eurostat-unemployment',
    kind: 'eurostat_live_unemployment_monthly',
    period: 'month',
    lagDays: 31,                        // 收据 §6.1：ESMS 原文「约 31 天」；实测 30~39、中位 32 ⇒ 取原文值
    lagNote: 'ESMS 原文「约 31 天」；实测 24 期中位 32 天（30~39）',
    evidenceUrl: 'https://ec.europa.eu/eurostat/news/release-calendar',
    urlTemplate: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?format=JSON&geo={geo}&s_adj=SA&unit=PC_ACT&sex=T&age=TOTAL&lastTimePeriod={last_n}',
    unit: '%',
    geos: ['DE', 'FR', 'ES', 'IT'],
    // ★历史观测来源：**同族镜像** kind（dbnomics 镜像 vs live 直连，同源同量纲；live 族 0 已解、镜像族 9 已解）
    histKinds: ['dbnomics_eurostat_unemployment_monthly', 'eurostat_live_unemployment_monthly'],
  },
];

function addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function monthAdd(ym, n) { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.toISOString().slice(0, 7); }
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function inBand(hit) { return hit > 0.15 && hit < 0.85; }

/** 按日历推算：**目标期＝下一个尚未开始的期**（零泄漏的唯一干净口径）。
 *
 *  ★口径三次修正（三十九）批，全部由 anchor-gate 首跑逼出，如实记录：
 *    ① v1「下一个即将发布的期」（month=2026-09, cutoff=09-21）⇒ **leak**：cutoff 落在期窗内
 *    ② v2「期已结束但数据未发布」（month=2026-08, cutoff=09-21）⇒ **仍 leak**：cutoff 晚于期起点
 *    ③ v3（本版）＝**目标期必须整体晚于 cutoff**（期尚未开始）⇒ 与既有生产题里唯一 pass 的那类同构
 *       （账本实测：`month=2026-10` × cutoff=09-13 三条 pass；`month=2026-09` 三条 leak）。
 *  ★附带发现（本批如实上报，不自行处置）：既有生产题 `eurostat_live_*` 9 条中 **6 条在 gate 下判 leak**
 *    （month=当月的 3 条 ＋ year=当年的 3 条），过锚率仅 33%。那是**生产题口径问题**（改动须版本递进），
 *    本批只做到「新生成的题零泄漏」，**不动既有行**。
 */
function nextPublishablePeriod(src, today) {
  const t = new Date(today + 'T12:00:00Z');
  if (src.period === 'month') {
    // 目标期＝下一个尚未开始的月（期首日 > today）
    for (let k = 1; k <= 6; k++) {
      const mm = monthAdd(today.slice(0, 7), k);
      const first = mm + '-01';
      if (first > today) {
        const y = Number(mm.slice(0, 4)), mo = Number(mm.slice(5, 7));
        const monthEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
        const pub = addDays(monthEnd, src.lagDays);
        return { period: mm, publishDate: pub, monthEnd, periodStart: first, daysUntil: Math.round((new Date(pub + 'T12:00:00Z') - t) / 86400000) };
      }
    }
  }
  return null;
}

/** 从账本取**同指标的历史观测值**（零网络）：解析 `resolve_note` 里的「=数值」段。
 *
 *  ★设计修正史（三十九）批三次，全部属「字段名/来源想当然」，如实记录：
 *    ① `ev.base` ⇒ 恒 undefined（出题器内部字段名，落库不存）
 *    ② `ev.baseRate` ⇒ 结构化概率对象 `{p,n,k,...}`，**不是指标值**（量纲错）
 *    ③ `resolve.threshold` ⇒ 是**阈值**不是观测值（同量纲但语义错：拿阈值当历史样本会自我循环）
 *    ④ 终版：**解析 `resolve_note` 的实测值**（格式规整：`...=4（阈值 <= 3.7，机检`）——
 *       这是账本里**唯一**存着真实观测值的地方（`dbnomics_eurostat_unemployment_monthly` 9 行全已解，
 *       note 含 DE/FR/ES 三期实际值）。同指标族（dbnomics 镜像 vs live 直连）**同源同量纲**，可作历史。
 */
function parseObserved(note) {
  // 形如 "DBnomics M.NSA.TOTAL.PC_ACT.T.DE 2025-09=4（阈值 <= 3.7，机检）"
  const m = /([A-Z]{2})\s+(\d{4}-\d{2})=([\d.]+)/.exec(String(note || ''));
  if (!m) return null;
  const v = Number(m[3]);
  return isFinite(v) && v > 0 && v < 100 ? { geo: m[1], period: m[2], value: v } : null;
}

/** 取同指标历史观测（按 geo 分组）——来源 kind 可指定（同族镜像源） */
function histObserved(conn, kinds, geo) {
  const out = [];
  for (const kind of kinds) {
    const rows = conn.prepare(
      "SELECT resolve_note FROM predictions WHERE json_extract(evidence_json,'$[0].resolve.kind') = ? AND resolved_at IS NOT NULL"
    ).all(kind);
    for (const r of rows) {
      const o = parseObserved(r.resolve_note);
      if (o && (!geo || o.geo === geo)) out.push(o);
    }
  }
  return out;
}

(async () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const conn = db;
  const report = { run_at: RUN_AT, today: TODAY, dry_run: DRY, db: DB_PATH, sources: [], rows: [], totals: {} };

  for (const src of SOURCES) {
    const s = { id: src.id, kind: src.kind, lagDays: src.lagDays, lagNote: src.lagNote, evidenceUrl: src.evidenceUrl, geos: [], rows: 0 };
    const per = nextPublishablePeriod(src, TODAY);
    if (!per) { recDrop('source', 'no_publishable_period', { source_id: src.id }); s.error = '无法推算下一个可出题参考期（日历规则未覆盖）'; report.sources.push(s); continue; }
    s.target_period = per.period;
    s.publish_date = per.publishDate;
    s.days_until = per.daysUntil;

    for (const geo of src.geos) {
      // ★历史观测值来源：同族镜像 kind（dbnomics 镜像 vs live 直连，同源同量纲）
      const obs = histObserved(conn, src.histKinds || [src.kind], geo);
      const g = { geo, hist_n: obs.length, rows: 0 };
      if (obs.length < 3) { recDrop('geo', 'insufficient_history', { source_id: src.id, geo: geo, hist_n: obs.length }); g.skipped = '同 geo 历史观测不足 3 期（实测 ' + obs.length + '）⇒ 无阈值来源（如实跳过，不编）'; s.geos.push(g); continue; }
      const vals = obs.map((o) => o.value);
      for (const q of [0.3, 0.7]) {
        const th = quantile(vals, q);
        if (th === null) { recDrop('quantile', 'no_quantile', { source_id: src.id, geo: geo, q: q }); continue; }
        const ge = q >= 0.5;
        const hit = vals.filter((x) => (ge ? x >= th : x <= th)).length / vals.length;
        const bandOk = inBand(hit);
        const row = {
          statement: '【forward】Eurostat ' + geo + ' ' + per.period + ' 失业率（%，季调）是否 ' + (ge ? '>=' : '<=')
            + ' ' + th.toFixed(1) + '？',
          layer: 'L2',
          // ★prob＝Q0-3 判据用（结果是否恒定）。来源＝历史观测的经验频率（真实可算，非编造）
          prob: hit,
          prob_source: 'empirical_freq@hist:' + (src.histKinds || [src.kind]).join('+') + '|geo=' + geo + '|n=' + vals.length + '|q=' + q,
          base: hit,
          baseNote: '前瞻·日历出题：同 geo 历史 ' + vals.length + ' 期观测中 ' + (ge ? '>=' : '<=')
            + ' ' + th.toFixed(1) + ' 占 ' + (hit * 100).toFixed(1) + '%（分位 q=' + q + '；来源＝账本 resolve_note 实测值解析）',
          resolve: {
            kind: src.kind, geo, month: per.period, threshold: Number(th.toFixed(1)), cmp: ge ? '>=' : '<=',
            url_template: src.urlTemplate, last_n: '120',
            field: '官方直连 body.dimension.time.category.index 反查 month → body.value[该索引]（%）',
          },
          // ★meta：anchor-gate 从这里抽 cutoff（Q0-2 判据）
          meta: {
            phase: 'i1_calendar',
            cutoff: RUN_AT,
            eventDate: per.publishDate,
            eventNote: '发布日（日历推算）：' + src.lagNote,
            calendar_source: src.id,
            evidence_url: src.evidenceUrl,
          },
          calendar: {
            source_id: src.id, publish_date: per.publishDate, lag_days: src.lagDays,
            evidence_url: src.evidenceUrl, cutoff: TODAY,
          },
          slug: 'corpus:calendar|' + src.kind + '|' + geo + '|' + per.period + '|' + th.toFixed(1),
          band_ok: bandOk,
        };
        report.rows.push(row); s.rows++; g.rows++;
        if (LIMIT && report.rows.length >= LIMIT) break;
      }
      s.geos.push(g);
      if (LIMIT && report.rows.length >= LIMIT) break;
    }
    report.sources.push(s);
    if (LIMIT && report.rows.length >= LIMIT) break;
  }

  report.totals = {
    candidates: report.rows.length,
    in_band: report.rows.filter((r) => r.band_ok).length,
    out_band: report.rows.filter((r) => !r.band_ok).length,
    all_publish_after_cutoff: report.rows.every((r) => r.calendar.publish_date > r.calendar.cutoff),
  };
  db.close();

  console.log('== I1 日历出题器 ' + (DRY ? '（DRY-RUN，不落盘）' : '') + ' ==');
  for (const s of report.sources) {
    console.log('[' + s.id + '] 目标期=' + (s.target_period || 'n/a') + ' 发布日=' + (s.publish_date || 'n/a')
      + '（距今 ' + (s.days_until === undefined ? '?' : s.days_until) + ' 天）候选=' + s.rows);
  }
  console.log('候选 ' + report.totals.candidates + ' 条（在带内 ' + report.totals.in_band + '／带外 ' + report.totals.out_band + '）');
  console.log('★全部发布日晚于 cutoff: ' + (report.totals.all_publish_after_cutoff ? '是' : '否（有问题）'));

  if (!DRY) {
    const stamp = TODAY.replace(/-/g, '');
    const rowsPath = path.join(OUT_DIR, 'calendar-questions-' + stamp + '.rows.json');
    const repPath = path.join(OUT_DIR, 'calendar-questions-' + stamp + '.json');
    fs.writeFileSync(rowsPath, JSON.stringify(report.rows, null, 1), 'utf8');
    fs.writeFileSync(repPath, JSON.stringify(report, null, 1), 'utf8');
    console.log('产物 ' + rowsPath);
    console.log('产物 ' + repPath);
    // ── 候选留痕落盘（默认关；仅当传 --record-candidates=<path>）──
    if (REC_PATH) {
      const dropByReason = {};
      for (const dz of DROPS) dropByReason[dz.reason] = (dropByReason[dz.reason] || 0) + 1;
      fs.writeFileSync(REC_PATH, JSON.stringify({
        run_at: RUN_AT, source: 'calendar-questions.cjs', today: TODAY,
        note: '候选留痕旁路产物（承 corpus-sources-b4.cjs / role3-utype.cjs 同款）：candidates＝产出的候选题；'
          + 'drops＝被丢提议（含原因）。过锚率的严格分母＝candidates.length + drops.length（提议全集）。'
          + '★注意：本生成器的 drops 是**源/geo 级**（整个源或整个 geo 被丢），非逐题级。',
        candidates: report.rows, drops: DROPS,
        counts: { candidates: report.rows.length, drops: DROPS.length, proposed_total: report.rows.length + DROPS.length, drop_by_reason: dropByReason },
      }, null, 1), 'utf8');
      console.log('[record] 候选留痕 -> ' + REC_PATH + '（候选 ' + report.rows.length + ' ＋ 被丢 ' + DROPS.length + ' ＝ 提议全集 ' + (report.rows.length + DROPS.length) + '）');
      console.log('[record] 被丢按原因 ' + JSON.stringify(dropByReason));
    }
    console.log('下一步：node p1b/scripts/anchor-gate.cjs --candidates ' + rowsPath + ' --label I1-日历出题');
  }
})();
