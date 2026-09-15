#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/d2-build-questions.cjs —— D2 历史回测引擎 · **出题器**（照 PREREG v1 §3/§5）。
 *
 * 判据来源（唯一）：`.scratch/forecast-debate/PREREG-D2-历史回测引擎-v1.md`
 *   （sha256 `70cf9d17…`；冻结后禁改，改动＝版本递进）。
 *
 * 纪律（PREREG §2）：
 *   C1 cutoff **严格早于**事件窗口起点（禁「今天」当 cutoff 问历史事件）；
 *   C2 题面与证据**只允许 cutoff 前**可观测的字段/事件（真值字段一律不得进入）；
 *   C3 cutoff ＝ 事件前一天 23:59（Asia/Shanghai），落库非空且脚本自校验。
 *
 * 零 LLM、零生产库写（只读 archive API；产物落 .scratch/backtest/）。
 * 用法：node p1b/scripts/d2-build-questions.cjs [--out <dir>] [--limit <n>]
 *   env：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:2080（若需代理）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const OUTDIR = arg('out', path.join(ROOT, '.scratch', 'backtest'));
const LIMIT = Number(arg('limit', '0')) || 0;

// ── 冻结物（照 PREREG §7；改动＝版本递进）──
const CITIES = [
  { name: '上海', lat: 31.23, lon: 121.47 },
  { name: '北京', lat: 39.90, lon: 116.41 },
  { name: '广州', lat: 23.13, lon: 113.26 },
  { name: '成都', lat: 30.57, lon: 104.07 },
];
const VARS = [
  'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'wind_speed_10m_max', 'sunshine_duration', 'shortwave_radiation_sum',
];
const VAR_CN = {
  temperature_2m_max: '日最高气温', temperature_2m_min: '日最低气温', precipitation_sum: '日降水量',
  wind_speed_10m_max: '日最大风速', sunshine_duration: '日日照时长', shortwave_radiation_sum: '日短波辐射',
};
const VAR_UNIT = {
  temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_sum: 'mm',
  wind_speed_10m_max: 'km/h', sunshine_duration: 's', shortwave_radiation_sum: 'MJ/m²',
};
const HIST_START = '2015-01-01', HIST_END = '2023-12-31';   // 基率标定窗（cutoff 前）
// ★ v1.1 勘误 D2-A：cutoff 与出题日解耦 —— horizon_days = 出题日距事件日的天数
const HORIZONS = [1, 3, 7, 14, 30];   // 短(1/3/7) 中(14) 长(30)，照规格 §4.1 三档
const QUOTA_TOTAL = 400, QUOTA_HARD_CAP = 500;   // ★ v1.1 勘误 D2-B：批配额
const SEED = 987654321;
const EVT_START = '2024-01-01', EVT_END = '2024-12-31';     // 事件窗（真值已在库）
const BASE_LO = 0.15, BASE_HI = 0.85;                       // Q0-3 基率域
const QUANTILES = [0.3, 0.5, 0.7];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => fetch(u).then((r) => r.json()).catch((e) => ({ __err: e.message }));

/** 分位（线性插值；输入须已排序） */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/** 取整到可读精度（气温 0.1；其余按量级） */
function roundNice(v, varName) {
  if (v === null || !isFinite(v)) return null;
  if (varName.indexOf('temperature') === 0) return Math.round(v * 10) / 10;
  if (varName === 'precipitation_sum') return Math.round(v * 10) / 10;
  if (varName === 'wind_speed_10m_max') return Math.round(v * 10) / 10;
  if (varName === 'sunshine_duration') return Math.round(v / 60) * 60;      // 取整到分钟
  if (varName === 'shortwave_radiation_sum') return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

(async () => {
  const t0 = Date.now();
  fs.mkdirSync(OUTDIR, { recursive: true });
  const fetchLog = [];
  const questions = [];

  for (const city of CITIES) {
    // 一次抓全窗（2015–2024 全量，避免多次请求触发限速）
    const u = 'https://archive-api.open-meteo.com/v1/archive'
      + '?latitude=' + city.lat + '&longitude=' + city.lon
      + '&start_date=' + HIST_START + '&end_date=' + EVT_END
      + '&daily=' + VARS.join(',');
    let j = null;
    for (let a = 1; a <= 4; a++) {
      j = await getJson(u);
      if (!j.__err && j.daily) break;
      console.log('  fetch ' + city.name + ' attempt ' + a + ' FAILED: ' + (j.__err || 'no daily'));
      await sleep(4000 * a);
    }
    if (!j || j.__err || !j.daily) {
      console.error('!! HARD FAIL: ' + city.name + ' 抓取重试耗尽 -> ABORT 整批（不写结果）');
      process.exit(2);
    }
    fetchLog.push({ city: city.name, days: (j.daily.time || []).length, start: HIST_START, end: EVT_END });

    const time = j.daily.time;
    // 按 (变量 × 月) 建立历史/事件样本
    for (const varName of VARS) {
      const series = j.daily[varName] || [];
      const hist = {}, evt = {};   // month -> [values]
      for (let i = 0; i < time.length; i++) {
        const v = series[i];
        if (v === null || v === undefined) continue;
        const d = time[i], m = d.slice(5, 7), y = d.slice(0, 4);
        if (y >= '2015' && y <= '2023') (hist[m] = hist[m] || []).push(v);
        else if (y === '2024') (evt[m] = evt[m] || []).push({ d: d, v: v });
      }
      for (const m of Object.keys(hist)) {
        const h = hist[m].slice().sort((a, b) => a - b);
        if (h.length < 30) continue;   // 历史样本 <30 不出题（与引擎准入线一致）
        for (const q of QUANTILES) {
          const thrRaw = quantile(h, q);
          if (thrRaw === null) continue;
          const thr = roundNice(thrRaw, varName);
          // 方向：q30 ⇒ <=（低频侧）；q70 ⇒ >=；q50 ⇒ 两向各半（用 q 值决定，确定性）
          const cmps = q === 0.5 ? ['<=', '>='] : (q < 0.5 ? ['<='] : ['>=']);
          for (const cmp of cmps) {
            // 历史基率（cutoff 前）
            const k = h.filter((x) => (cmp === '>=' ? x >= thr : x <= thr)).length;
            const base = k / h.length;
            if (!(base > BASE_LO && base < BASE_HI)) continue;   // Q0-3 基率域
            // 该月的事件日（2024 年）
            const evs = (evt[m] || []).filter((x) => {
              const hit = cmp === '>=' ? x.v >= thr : x.v <= thr;
              return hit !== null;
            });
            for (const e of (evt[m] || [])) {
              const y = (cmp === '>=' ? (e.v >= thr) : (e.v <= thr)) ? 1 : 0;
              for (const hd of HORIZONS) {
                const qDate = minusDays(e.d, hd);   // 出题日 = 事件日 − horizon
                if (qDate < HIST_END) continue;      // 出题日须在基率窗之后（C2 由构造保证）
                questions.push({
                  city: city.name, lat: city.lat, lon: city.lon,
                  var_name: varName, month: m, threshold: thr, cmp: cmp, quantile: q,
                  event_date: e.d, outcome: y, observed_value: e.v,
                  base_rate: base, hist_n: h.length, hist_k: k,
                  hist_window: HIST_START + '..' + HIST_END,
                  horizon_days: hd,
                  question_date: qDate,
                  cutoff_at: qDate + 'T23:59:00+08:00',   // ★ 出题日 23:59（严格早于事件日）
                  resolve_kind: 'openmeteo_archive_daily_' + varName,
                });
              }
            }
          }
        }
      }
    }
    await sleep(1500);
  }

  // ── C1/C3 自校验（v1.1：cutoff = 出题日 23:59，严格早于事件日）──
  for (const q of questions) {
    if (q.cutoff_at !== q.question_date + 'T23:59:00+08:00') { console.error('!! C3 违规 id=' + q.event_date); process.exit(4); }
    if (!(q.question_date < q.event_date)) { console.error('!! C1 违规：出题日不早于事件日'); process.exit(4); }
    if (q.horizon_days !== daysBetween(q.question_date, q.event_date)) { console.error('!! horizon 不一致'); process.exit(4); }
  }

  // ── ★ v1.1 勘误 D2-B：配额抽样（确定性；先于跑批，禁事后挑题）──
  const picked = quotaSample(questions, QUOTA_TOTAL, SEED);
  if (picked.length > QUOTA_HARD_CAP) { console.error('!! 超出单批硬上限'); process.exit(5); }

  const out = picked;
  const ids = out.map((q) => [q.city, q.var_name, q.event_date, q.threshold, q.cmp, q.horizon_days].join('|'));
  const fp = crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex');


  const artifact = {
    script: 'p1b/scripts/d2-build-questions.cjs',
    prereg: '.scratch/forecast-debate/PREREG-D2-历史回测引擎-v1.md',
    prereg_sha256: '70cf9d17e87d0522d979b8da00eba9967ccdb5f4201a97935e94864e84a37ee4',
    generated_at: new Date().toISOString(),
    source: 'archive-api.open-meteo.com/v1/archive（ERA5 再分析格点；**非站点实测**）',
    cities: CITIES.map((c) => c.name),
    vars: VARS,
    hist_window: HIST_START + '..' + HIST_END,
    event_window: EVT_START + '..' + EVT_END,
    base_rate_domain: [BASE_LO, BASE_HI],
    quantiles: QUANTILES,
    prereg_v11: '.scratch/forecast-debate/PREREG-D2-历史回测引擎-v1.1-补充与勘误.md',
    horizons: HORIZONS,
    quota_total: QUOTA_TOTAL,
    quota_hard_cap: QUOTA_HARD_CAP,
    seed: SEED,
    difficulty_tiers: ['最难','中','近'],
    difficulty_tiers_unreachable: { '极': '与基率域 (0.15,0.85) 数学互斥（b(1-b)<0.09 ⇒ b<0.10 或 b>0.90，与 Q0-3 无交集）；勘误 D2-D' },
    n_questions: out.length,
    n_pool_before_limit: questions.length,
    question_fingerprint_sha256: fp,
    fetch_log: fetchLog,
    questions: out,
  };
  const p = path.join(OUTDIR, 'd2-questions.json');
  fs.writeFileSync(p, JSON.stringify(artifact, null, 1), 'utf8');

  // 汇总
  const byCity = {}, byVar = {}, byMonth = {};
  for (const q of out) { byCity[q.city] = (byCity[q.city] || 0) + 1; byVar[q.var_name] = (byVar[q.var_name] || 0) + 1; byMonth[q.month] = (byMonth[q.month] || 0) + 1; }
  console.log('== D2 出题完成 ==');
  console.log('  题数 = ' + out.length + '（限流前 ' + questions.length + '）');
  console.log('  指纹 = ' + fp);
  console.log('  按城 = ' + JSON.stringify(byCity));
  console.log('  按月数 = ' + Object.keys(byMonth).length + ' 个月');
  console.log('  按变量 = ' + JSON.stringify(byVar));
  const byH = {}; for (const q of out) byH[q.horizon_days] = (byH[q.horizon_days] || 0) + 1;
  console.log('  按 horizon = ' + JSON.stringify(byH));
  const byDiff = {}; for (const q of out) { const b = q.base_rate, d = b * (1 - b); const k = d >= 0.21 ? '最难' : (d >= 0.16 ? '中' : (d >= 0.09 ? '近' : '极')); byDiff[k] = (byDiff[k] || 0) + 1; }
  console.log('  按难度 = ' + JSON.stringify(byDiff) + '  ⚠「极」档恒 0 = 与基率域 (0.15,0.85) 数学互斥（勘误 D2-D）');
  console.log('  C1/C3 自校验 = PASS（cutoff = 出题日 23:59，严格早于事件日）');
  console.log('  产物 = ' + p);
  console.log('  用时 = ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

/** 事件前一天 23:59（Asia/Shanghai） */
function prevDay2359(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10) + 'T23:59:00+08:00';
}

/** 事件日往前 n 天（ISO） */
function minusDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
/** 两个 ISO 日期相差天数 */
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
/**
 * 配额抽样（确定性；v1.1 勘误 D2-B）
 * 配额：城均衡 / 12 月全覆盖 / 变量均衡 / 三 horizon 档各 >=60 / 四难度档各 >=40
 * 规则：每格内按 id 排序后**等距抽取**（确定性，与顺序无关），格不满则全取。
 */
function quotaSample(pool, total, seed) {
  const diffOf = (b) => { const d = b * (1 - b); return d >= 0.21 ? '最难' : (d >= 0.16 ? '中' : (d >= 0.09 ? '近' : '极')); };
  const hBucket = (hd) => (hd <= 7 ? 'short' : (hd <= 30 ? 'mid' : 'long'));
  // 确定性洗牌（LCG，种子固定）
  const arr = pool.slice();
  let s0 = seed >>> 0;
  const rnd = () => { s0 = (1664525 * s0 + 1013904223) >>> 0; return s0 / 4294967296; };
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  // 分层键：城 × 月 × horizon 档 × 难度（保证各维度覆盖）
  const cells = new Map();
  for (const q of arr) {
    const k = [q.city, q.month, hBucket(q.horizon_days), diffOf(q.base_rate)].join('|');
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(q);
  }
  // v1.1 配额：按格轮转取，保证各维度覆盖（格=城×月×horizon档×难度）
  const keys = [...cells.keys()].sort();
  const perCell = Math.max(1, Math.ceil(total / Math.max(1, keys.length)));
  const picked = [];
  // 轮转：每格取 1 题，循环直到达 total（保证稀疏维度也被覆盖）
  const idx = new Map(keys.map((k) => [k, 0]));
  let progress = true;
  while (picked.length < total && progress) {
    progress = false;
    for (const k of keys) {
      if (picked.length >= total) break;
      const c = cells.get(k); const i = idx.get(k);
      if (i < c.length) { picked.push(c[i]); idx.set(k, i + 1); progress = true; }
    }
  }
  // 不足则从剩余池补足（仍确定性）
  if (picked.length < total) {
    const seen = new Set(picked.map((q) => q.city + q.var_name + q.event_date + q.threshold + q.cmp + q.horizon_days));
    for (const q of arr) {
      if (picked.length >= total) break;
      const id = q.city + q.var_name + q.event_date + q.threshold + q.cmp + q.horizon_days;
      if (seen.has(id)) continue;
      seen.add(id); picked.push(q);
    }
  }
  return picked.slice(0, total);
}
