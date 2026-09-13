'use strict';
/**
 * p1b/src/engines/l2_baseline.js —— L2 系综层最小统计引擎（阶段 4 起步，2026-09-13）。
 *
 * 依据：docs/specs/2026-09-11-万物可预测性审计器-design.md §1.7（L2 判据：稳定总体 / ≥30 条历史 /
 *   单事件不可决定性 / 外部基率锚）＋ §2（L2 引擎=统计基率+Wilson 区间）＋ §5.3（L2 最小统计件）＋
 *   §6.1#3（引擎全建冲动：只建 L2/L5 最小件）。
 *
 * 契约（纯函数：零 db、零 LLM、零网络）：
 *   入参 l2Baseline({ resolve_spec?, history?, counts?{k,n}, baseRateNote?, minN? })
 *     · history      指定历史序列（0/1 或 boolean 数组）→ n=长度、k=命中数（最可靠来源）
 *     · counts       显式 {k,n}
 *     · baseRateNote 冻结基率文本（与 G2 R4 parseBaseRate 同序同模式；样本量亦尝试解析）
 *   出参（合格）{ok:true,status:'ok',p,n,k,ci:[lo,hi],method:'stat_baseline+wilson',source,note}
 *   出参（不足）{ok:false,status:'insufficient_data',p:null,n,k,ci:null,method,source,note}
 *
 * 纪律：
 *   ① **只用 Wilson score 区间，禁用 Wald**（k=0/1 时 Wald 退化为零宽；Wilson 非退化）；z=1.96(95%)。
 *   ② **n<30 一律「数据不足」**：不出 p、不出区间（K F13 准入线；照 predictionsStore.calibration 口径）。
 *      n 无法确定（baseRateNote 无样本量）同样按不足处置——宁可缺，不可编。
 *   ③ 基率解析与 scripts/g2-report.cjs parseBaseRate 同序同模式（占 X% → 基率= → % 兜底），
 *      保证「报表难度分档 b」与「L2 引擎 p」不出两套口径。
 */
const MIN_N = 30;      // K F13 准入线（design §1.7 第 2 条）
const Z_95 = 1.96;     // 95% 置信
const ROUND = 6;       // 读数保留 6 位小数

function r6(x) { return Number(x.toFixed(ROUND)); }

/** Wilson score 区间。@returns {{p:number,lo:number,hi:number}}（6 位小数；n<=0 全 null） */
function wilson(k, n, z) {
  const zz = z === undefined ? Z_95 : z;
  if (!n || n <= 0) return { p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (zz * zz) / n;
  const center = (p + (zz * zz) / (2 * n)) / d;
  const half = (zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / d;
  return { p: r6(p), lo: r6(Math.max(0, center - half)), hi: r6(Math.min(1, center + half)) };
}

/** k/n 分数（如「共 149/331」「=6/33」）——最可靠：同时给出 k 与 n。 */
function parseFraction(note) {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(note);
  if (!m) return null;
  const k = parseInt(m[1], 10), n = parseInt(m[2], 10);
  if (!(n > 0) || k > n) return null;
  return { k: k, n: n };
}

/** 样本量抽取（与语料 note 写法对齐）：共 N 个 → N 个 → N 期。 */
function parseCount(note) {
  let m = /共\s*(\d+)\s*个/.exec(note); if (m) return parseInt(m[1], 10);
  m = /(\d+)\s*个/.exec(note);            if (m) return parseInt(m[1], 10);
  m = /(\d+)\s*期/.exec(note);            if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * 冻结基率文本解析（口径与 g2-report.cjs parseBaseRate 同源）：
 *   k/n 分数 > 占 X% > 基率=v > 任意 X% 兜底；样本量由 parseCount 抽。
 * @returns {null|{p:number,n:number|null,k:number|null,pattern:string}}
 */
function parseBaseRateNote(note) {
  if (!note || typeof note !== 'string') return null;
  const frac = parseFraction(note);
  if (frac) return { p: r6(frac.k / frac.n), n: frac.n, k: frac.k, pattern: 'fraction' };
  let m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (!m) m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) {
    const p = parseFloat(m[1]) / 100, n = parseCount(note);
    return { p: r6(p), n: n, k: n === null ? null : Math.round(p * n), pattern: n === null ? 'pct_share_non' : 'pct_share_n' };
  }
  m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(note);
  if (m) {
    const v = parseFloat(m[1]), p = v > 1 ? v / 100 : v, n = parseCount(note);
    return { p: r6(p), n: n, k: n === null ? null : Math.round(p * n), pattern: 'base_rate_eq' };
  }
  return null;
}

function isHit(x) { return x === true || x === 1 || x === '1'; }

/**
 * L2 最小引擎主入口（纯函数）。
 * @param {{resolve_spec?:object, history?:Array, counts?:{k:number,n:number}, baseRateNote?:string, minN?:number}} input
 * @returns {{ok:boolean,status:string,method:string,p:number|null,n:number|null,k:number|null,ci:Array|null,source:string,note:string}}
 */
function l2Baseline(input) {
  const opt = input || {};
  const minN = opt.minN === undefined ? MIN_N : opt.minN;
  let n = null, k = null, p0 = null, source = 'none';
  if (Array.isArray(opt.history)) {
    n = opt.history.length;
    k = opt.history.filter(isHit).length;
    p0 = n > 0 ? k / n : null;
    source = 'history_series';
  } else if (opt.counts && typeof opt.counts === 'object'
    && Number.isFinite(Number(opt.counts.n)) && Number.isFinite(Number(opt.counts.k))) {
    n = Number(opt.counts.n); k = Number(opt.counts.k); p0 = n > 0 ? k / n : null; source = 'counts';
  } else if (opt.baseRateNote) {
    const parsed = parseBaseRateNote(String(opt.baseRateNote));
    if (parsed) { n = parsed.n; k = parsed.k; p0 = parsed.p; source = 'baseRateNote:' + parsed.pattern; }
    else source = 'baseRateNote:unparsed';
  }
  const short = (note) => ({ ok: false, status: 'insufficient_data', method: 'stat_baseline+wilson',
    p: null, n: n, k: k, ci: null, source: source, note: note });
  if (source === 'none') {
    return short('无基率来源：需 history 序列 / counts{k,n} / evidence.baseRateNote 三者之一，本层不出 p。');
  }
  if (source === 'baseRateNote:unparsed') {
    return short('baseRateNote 无法解析出基率（支持口径：占 X% / 基率=v / k·n 分数），本层不出 p。');
  }
  if (n === null || n === undefined) {
    return short('baseRateNote 未含可解析样本量 n，无法过 n≥' + minN + ' 准入线（宁可缺，不可编），本层不出 p。');
  }
  if (!(n > 0)) return short('样本量非法：n=' + n + '，本层不出 p。');
  if (n < minN) {
    return short('数据不足：n=' + n + ' < ' + minN + '（K F13 准入线），本层不出 p 与区间。');
  }
  const kk = (k === null || k === undefined) ? (p0 === null ? null : Math.round(p0 * n)) : k;
  if (kk === null) return short('缺命中数 k 且无可用基率，无法构造区间。');
  const w = wilson(kk, n);
  return { ok: true, status: 'ok', method: 'stat_baseline+wilson', p: w.p, n: n, k: kk, ci: [w.lo, w.hi],
    source: source, note: '统计基率+Wilson(95%)：k=' + kk + '/n=' + n + ' → p=' + w.p + '，CI=[' + w.lo + ',' + w.hi + ']（n≥' + minN + ' 准入线通过）。' };
}

module.exports = { l2Baseline, wilson, parseBaseRateNote, MIN_N, Z_95 };


