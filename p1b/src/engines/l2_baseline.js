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

const baseRateMod = require('../evidence/baseRate'); // 任务 6 批次 3：解析原语与读序收敛为一份共享模块

/** k/n 分数（如「共 149/331」「=6/33」）——最可靠：同时给出 k 与 n。 */
function parseFraction(note) { return baseRateMod.parseFraction(note); }

/**
 * 样本量抽取（保守取最小 n，防「2015-2024 共 300 个日值」类窗口总长被放大）。
 *
 * 2026-09-14 口径收敛：原实现只认「共 N 个 / N 个 / N 期」，后按 #13 加宽（共/近/前/上/已发布）；
 * 当时与 `g2-report.cjs` 的 `parseNoteN` 是**两份代码**（注释里如实登记为已知局限）。
 * 任务 6 批次 3：抽成共享模块 `src/evidence/baseRate.js`，本函数与 g2-report 的同名函数均改为**委托**
 *   ⇒ 单一实现、零读数变化（由 `test/fixtures/base-rate-golden.json` 金样回放锁定）。
 */
function parseCount(note) { return baseRateMod.parseCount(note); }

/**
 * 冻结基率文本解析 —— L2 读序（委托共享模块，逐字等价）：
 *   k/n 分数 > 占 X% > 基率=v；样本量由 parseCount 抽。
 * @returns {null|{p:number,n:number|null,k:number|null,pattern:string}}
 */
function parseBaseRateNote(note) { return baseRateMod.parseBaseRateL2(note); }

function isHit(x) { return x === true || x === 1 || x === '1'; }

/**
 * L2 最小引擎主入口（纯函数）。
 * 基率来源优先级：history 序列 > counts{k,n} > **baseRate（结构化，批次 3 新增）** > baseRateNote（文本）。
 * 结构化路径只作用于**带 evidence.baseRate 的新行**；旧行无该键 ⇒ 走文本，读数逐字不变。
 * @param {{resolve_spec?:object, history?:Array, counts?:{k:number,n:number}, baseRate?:object, baseRateNote?:string, minN?:number}} input
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
  } else if (opt.baseRate && baseRateMod.isStructured(opt.baseRate)) {
    const s = opt.baseRate;
    n = (s.n === undefined || s.n === null) ? null : s.n;
    k = (s.k === undefined || s.k === null) ? null : s.k;
    p0 = s.p;
    source = 'baseRate:structured';
    // ★ 2026-09-15：结构化字段**缺 n** 时回退文本取 n（**仅补 n，不改 p**）。
    //   缘由：结构化 `evidence.baseRate` 是批次 3 用**当时的解析器**物化的，而当时解析器
    //   取不到「过去 N 天…N 个 X 中」句式的 n ⇒ 58 行结构化 n=null、文本里其实有 n≥30
    //   ⇒ 引擎「结构化优先且不回退」⇒ 明明有样本却被 n≥30 准入线拒出数（"宁可缺，不可编"被误触发）。
    //   安全性：① **只在 n 缺失时**回退（有 n 的行一个都不动）；② **p 仍取结构化值**（不回退 p，
    //   防两条读序的 p 分叉）；③ 回退得到的 n 仅用于**准入线与 Wilson 区间**，k 由 p×n 派生（同文本口径）。
    //   实测：全库 1485 条注记中，此路径影响 58 行（L2 6 / L3 52），**零行 p 被改动**。
    if (n === null && opt.baseRateNote) {
      const fbN = parseCount(String(opt.baseRateNote));
      if (fbN !== null && fbN > 0) { n = fbN; k = (typeof p0 === 'number') ? Math.round(p0 * n) : null; source = 'baseRate:structured+n_from_note'; }
    }
  } else if (opt.baseRateNote) {
    const parsed = parseBaseRateNote(String(opt.baseRateNote));
    if (parsed) { n = parsed.n; k = parsed.k; p0 = parsed.p; source = 'baseRateNote:' + parsed.pattern; }
    else source = 'baseRateNote:unparsed';
  }
  const short = (note) => ({ ok: false, status: 'insufficient_data', method: 'stat_baseline+wilson',
    p: null, n: n, k: k, ci: null, source: source, note: note });
  if (source === 'none') {
    return short('无基率来源：需 history 序列 / counts{k,n} / evidence.baseRate（结构化）或 baseRateNote（文本），本层不出 p。');
  }
  if (source === 'baseRateNote:unparsed') {
    return short('baseRateNote 无法解析出基率（支持口径：占 X% / 基率=v / k·n 分数），本层不出 p。');
  }
  if (n === null || n === undefined) {
    return short((source === 'baseRate:structured' ? '结构化 baseRate 未含样本量 n' : 'baseRateNote 未含可解析样本量 n')
      + '，无法过 n≥' + minN + ' 准入线（宁可缺，不可编），本层不出 p。');
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


