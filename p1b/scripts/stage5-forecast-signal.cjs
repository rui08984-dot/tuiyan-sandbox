#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/stage5-forecast-signal.cjs —— 阶段 5 路线 (b)「前瞻数值信号」**冻结实验的可复现脚本**。
 *
 * 判据来源（唯一）：`.scratch/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.md`（sha256 见 v1.1 勘误件）
 *   ＋ 勘误/补充：`.scratch/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.1-补充与勘误.md`
 *
 * 为何有本脚本（缺陷 D-B 的修复）：首个「冻结后确认跑」用的是一份**未入库的 `.tmp/` 脚本**，
 *   其抓取错误路径为 `console.log('ERR'); continue;` —— **静默跳过整个分块**。
 *   该次运行恰逢上海 2024 分块 HTTP 失败 ⇒ 静默丢掉 24 道题（48 槽位），
 *   使配对从冻结口径 **93 对（186 槽）** 掉到 **72 对（144 槽）**，且我把它当达标读数记录（留痕 §44）。
 *   本脚本把该错误路径改为**硬失败**：任一分块重试耗尽 ⇒ 打印原因并 `exit 2`（不写任何结果）。
 *   依据：PREREG §6「previous-runs API 不可用 ⇒ 暂停并如实披露（不换 API）」＋「工程故障重跑 ≤2 次」。
 *
 * 纪律：**零账本写、零 LLM**（铁律④ no-op）；只读生产库 + 只读外部 API。
 * 用法：node p1b/scripts/stage5-forecast-signal.cjs [--out <dir>] [--tag <名>]
 *   env：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:2080（本机 fetch 默认不走系统代理）
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const OUTDIR = arg('out', path.join(ROOT, 'p1b/sim/out'));
const TAG = arg('tag', '20260915');
const DB = path.join(ROOT, 'p1a-terminal/data/p1a.db');

// 池谓词 / 指纹锚 / 基率解析 / 软概率映射：**单一真源**（勘误件 §2.3 修复；由池锁定测试守护）
const P = require(path.join(ROOT, 'p1b/src/evidence/stage5Pool'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (u) => new Promise((res) => {
  fetch(u).then((r) => r.json()).then((j) => res(j)).catch((e) => res({ __err: e.message }));
});

// ── 池（资格谓词照 PREREG §3；谓词本体在 stage5Pool.js，非内联） ──
const db = new DatabaseSync(DB, { readOnly: true });
const pool = db.prepare(P.POOL_SQL()).all();
db.close();

const poolIds = pool.map((r) => r.id);
const poolFp = P.fingerprint(poolIds);
console.log('pool = ' + pool.length + ' | ids = ' + poolIds.length + ' | fp = ' + poolFp);
if (pool.length !== P.POOL_N_AT_FREEZE || poolFp !== P.POOL_FINGERPRINT_SHA256) {
  console.error('!! 池指纹/规模与冻结物不符 -> ABORT（冻结件禁止静默漂移）');
  console.error('   got fp=' + poolFp + ' n=' + pool.length);
  console.error('   want fp=' + P.POOL_FINGERPRINT_SHA256 + ' n=' + P.POOL_N_AT_FREEZE);
  process.exit(3);
}

const cities = new Map();
for (const r of pool) { const k = r.lat + ',' + r.lon; if (!cities.has(k)) cities.set(k, []); cities.get(k).push(r); }

const parseBase = P.parseBaseRate;

(async () => {
  const fcCache = new Map();
  const fetchLog = [];
  let httpFail = 0;

  for (const [key, rows] of cities) {
    const [lat, lon] = key.split(',').map(Number);
    const yearRanges = {};
    for (const r of rows.map((x) => x.rdate).sort()) {
      const y = r.slice(0, 4);
      if (!yearRanges[y]) yearRanges[y] = { st: r, en: r, n: 0 };
      yearRanges[y].st = r < yearRanges[y].st ? r : yearRanges[y].st;
      yearRanges[y].en = r > yearRanges[y].en ? r : yearRanges[y].en;
      yearRanges[y].n++;
    }
    const allHourly = { time: [] };
    for (const [y, range] of Object.entries(yearRanges)) {
      const u = 'https://previous-runs-api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon
        + '&hourly=temperature_2m_previous_day1,temperature_2m_previous_day3'
        + '&start_date=' + range.st + '&end_date=' + range.en;
      let j = null;
      for (let a = 1; a <= 4; a++) {
        j = await H(u);
        if (!j.__err && j.hourly) break;
        httpFail++;
        console.log('  chunk ' + key + ' ' + y + ' attempt ' + a + ' FAILED: ' + (j.__err || j.reason || 'no hourly'));
        await sleep(4000 * a);
      }
      if (!j || j.__err || !j.hourly) {
        // ★★ 硬失败：绝不静默丢城（这正是缺陷 D-B 的根因）
        console.error('!! HARD FAIL: ' + key + ' ' + y + ' (' + range.n + ' questions) 重试耗尽 -> ABORT 整批（不写结果）');
        process.exit(2);
      }
      fetchLog.push({ city: key, year: y, start: range.st, end: range.en, n_questions: range.n, hours: (j.hourly.time || []).length });
      allHourly.time = allHourly.time.concat(j.hourly.time || []);
      for (const k of ['temperature_2m_previous_day1', 'temperature_2m_previous_day3']) {
        if (!allHourly[k]) allHourly[k] = [];
        allHourly[k] = allHourly[k].concat(j.hourly[k] || []);
      }
      await sleep(1500);
    }
    const dailyMax = {};
    for (const L of [1, 3]) {
      const k = 'temperature_2m_previous_day' + L;
      dailyMax[L] = {};
      for (let i = 0; i < allHourly.time.length; i++) {
        const d = allHourly.time[i].slice(0, 10);
        const v = allHourly[k][i];
        if (v !== null && v !== undefined) { if (!dailyMax[L][d]) dailyMax[L][d] = v; else if (v > dailyMax[L][d]) dailyMax[L][d] = v; }
      }
    }
    fcCache.set(key, dailyMax);
  }

  // ── 配对（映射公式照 PREREG §4 写死：p = clamp(0.02, 0.98, 0.5 + (fmax − thr)/6)） ──
  const rows = [];
  let nobase = 0, nofc = 0, noval = 0;
  const coverage = {};
  for (const [key, prs] of cities) {
    const dm = fcCache.get(key);
    coverage[key] = { questions: prs.length, slots: prs.length * 2, paired: 0, noval: 0, nobase: 0, nofc: 0 };
    for (const r of prs) {
      const pb = parseBase(r);
      if (pb === null) { nobase++; coverage[key].nobase++; continue; }
      if (!dm) { nofc++; coverage[key].nofc++; continue; }
      const y = r.outcome === 'true' ? 1 : 0;
      const th = Number(r.thr);
      const isGt = (r.cmp || '>') === '>';
      for (const L of [1, 3]) {
        const fmax = dm[L][r.rdate];
        if (fmax === undefined || fmax === null) { noval++; coverage[key].noval++; continue; }
        const p = P.softProb(fmax, th, isGt);
        rows.push({ id: r.id, lead: L, pb, p, y, thr: th, fmax, real: r.matures_at.slice(0, 10) });
        coverage[key].paired++;
      }
    }
  }

  const noValQuestions = pool.filter((r) => !rows.some((x) => x.id === r.id)).map((r) => r.id);
  const nPaired = new Set(rows.map((r) => r.id)).size;
  console.log('paired = ' + nPaired + ' questions × 2 leads | nofc=' + nofc + ' nobase=' + nobase + ' noval=' + noval);

  // ── 统计（PREREG §5：配对 bootstrap B=1000, seed=987654321） ──
  function stat(sub, label) {
    if (!sub.length) return '  ' + label + ': n=0';
    const m = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const bb = m(sub.map((r) => Math.pow(r.pb - r.y, 2)));
    const bs = m(sub.map((r) => Math.pow(r.p - r.y, 2)));
    const diffs = sub.map((r) => Math.pow(r.pb - r.y, 2) - Math.pow(r.p - r.y, 2));
    let s = 987654321 >>> 0;
    const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    const ms = [];
    for (let b = 0; b < 1000; b++) { let a = 0; for (let i = 0; i < diffs.length; i++) a += diffs[Math.floor(rnd() * diffs.length)]; ms.push(a / diffs.length); }
    ms.sort((a, b) => a - b);
    const d = bb - bs;
    const pass = d >= 0.02 && ms[25] > 0;
    return '  ' + label + ': n=' + sub.length + ' base=' + bb.toFixed(4) + ' signal=' + bs.toFixed(4)
      + ' Δ=' + d.toFixed(4) + ' CI=[' + ms[25].toFixed(4) + ',' + ms[975].toFixed(4) + ']' + (pass ? ' PASS' : ' FAIL');
  }

  const lead1 = rows.filter((r) => r.lead === 1);
  const lead3 = rows.filter((r) => r.lead === 3);
  const dAll = (() => { const m = (a) => a.reduce((s, x) => s + x, 0) / a.length; return m(rows.map((r) => Math.pow(r.pb - r.y, 2) - Math.pow(r.p - r.y, 2))); })();
  const d1 = (() => { const m = (a) => a.reduce((s, x) => s + x, 0) / a.length; return m(lead1.map((r) => Math.pow(r.pb - r.y, 2) - Math.pow(r.p - r.y, 2))); })();
  const d3 = (() => { const m = (a) => a.reduce((s, x) => s + x, 0) / a.length; return m(lead3.map((r) => Math.pow(r.pb - r.y, 2) - Math.pow(r.p - r.y, 2))); })();

  const out = [];
  out.push('== 阶段 5 路线 (b) · previous-runs 存档预报 vs 历史基率（冻结实验 · 硬失败语义）==');
  out.push('  池指纹=' + poolFp + ' pool=' + pool.length + ' paired=' + nPaired + ' (' + rows.length + ' 槽位) no_val题=' + noValQuestions.length);
  out.push(stat(rows, 'ALL'));
  out.push(stat(lead1, 'lead=1d'));
  out.push(stat(lead3, 'lead=3d'));
  for (const [key, prs] of cities) out.push(stat(rows.filter((r) => prs.some((p) => p.id === r.id)), 'city ' + key));
  out.push('  判据：① Δ≥0.02 ∧ CI下界>0 ' + (dAll >= 0.02 ? 'PASS' : 'FAIL')
    + ' ② n≥30 ' + (nPaired * 2 >= 30 ? 'PASS' : 'FAIL')
    + ' ③ 4城方向一致 ' + (['31.23,121.47', '39.9,116.41', '23.13,113.26', '30.57,104.07'].every((c) => (() => {
      const sub = rows.filter((r) => (cities.get(c) || []).some((p) => p.id === r.id));
      const m = (a) => a.reduce((s, x) => s + x, 0) / a.length;
      return sub.length && m(sub.map((r) => Math.pow(r.pb - r.y, 2) - Math.pow(r.p - r.y, 2))) > 0;
    })()) ? 'PASS' : 'FAIL')
    + ' ④ lead 单调 ' + (d1 > d3 ? 'PASS' : 'FAIL'));
  out.push('  覆盖：' + Object.entries(coverage).map(([k, v]) => k + ' q=' + v.questions + ' slots=' + v.slots + ' paired=' + v.paired + ' noval=' + v.noval).join(' | '));

  fs.mkdirSync(OUTDIR, { recursive: true });
  const base = path.join(OUTDIR, 'stage5-forecast-signal-' + TAG);
  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/stage5-forecast-signal.cjs',
    prereg: '.scratch/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.md',
    errata: '.scratch/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.1-补充与勘误.md',
    generated_at: new Date().toISOString(),
    pool_fingerprint_sha256: poolFp,
    n_pool: pool.length,
    n_pool_ids: poolIds.length,
    n_paired: nPaired,
    n_slots: rows.length,
    no_val_question_ids: noValQuestions.sort((a, b) => a - b),
    skipped: { no_fc: nofc, no_base: nobase, no_val: noval },
    coverage,
    fetch_log: fetchLog,
    criteria: {
      delta_all: dAll, delta_lead1: d1, delta_lead3: d3,
      delta_ge_0_02_and_ci_lo_gt_0: dAll >= 0.02,
      n_paired_ge_30: nPaired * 2 >= 30, lead_monotonic: d1 > d3,
    },
    results: rows,
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.out', out.join('\n') + '\n', 'utf8');
  console.log(out.join('\n'));
})();
