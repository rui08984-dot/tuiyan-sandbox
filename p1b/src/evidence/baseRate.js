'use strict';
/**
 * p1b/src/evidence/baseRate.js —— 基率读数的**单一真源**（任务 6 · 批次 3 / B1-1）。
 *
 * 为什么存在：基率读数原先散在三处，靠纪律保持句式一致（本项目明令「报表难度分档 b 与 L2 引擎 p
 * 不出两套口径」），且全靠正则从自由文本解析：
 *   ① `src/engines/l2_baseline.js`  parseCount / parseBaseRateNote（L2·L3 引擎）
 *   ② `scripts/g2-report.cjs`       parseNoteN  / parseBaseRate     （G2 门 ④ 与 #13 披露）
 *   ③ `src/engines/l5_sources.js`   parseCertifiedFromNote          （L5 认证源交叉核对）
 * 本模块把**原语与读序**收敛为一份；三处调用点改为委托 ⇒ 单一实现、零读数变化（由金样回放锁定：
 * `p1b/test/fixtures/base-rate-golden.json` 冻结重构前逐字输出，`base-rate-module.test.cjs` 逐条回放）。
 *
 * ★ 读序差异是**有意保留**的（不是重复代码）：
 *   · L2 读序（parseBaseRateL2）：分数 k/n → 「占 X%」→ 「基率=v」，p 取 6 位小数（r6）
 *   · G2 读序（parseBaseRateG2）：「占 X%」→ 「基率=v」→ 任意「X%」兜底，**不取整**
 *   · L5 读序（parseCertifiedValue）：「组合数理论值 X」→「基率=X」→ 任意「X%」（三态：认证值／历史频率），
 *     p 取 9 位小数（r9）
 *   合并读序会改变部分行的读数（例：含「8/16」的认证注记，L2 走分数、G2 走 X% 兜底）⇒ 属**判据改动**。
 *   故此处只合并实现、不合并读序；新读路径（readBaseRate/结构化字段）另行定义，且只作用于**新行**。
 *
 * 结构化字段（写端随行落库；additive）：`evidence[i].baseRate = { p, n, k, kind, window, basis, cmp, threshold }`
 *   · p  基率（0..1，必填）        · n 样本量（可 null＝未知；宁缺不编）
 *   · k  命中数（可 null）         · kind 'empirical'（历史频率）| 'certified'（认证值/组合数理论值）
 *   · window {from,to}（可 null＝生成批未记录） · basis 口径一句话（可 null） · cmp/threshold 判据方向与阈值（可 null）
 *   读端**优先结构化**（readBaseRate）、文本解析退为兜底；**旧行不动**（无结构化字段 ⇒ 走文本，读数逐字不变）。
 *   物化（把老行文本反写成结构化）**不做**：三读者读序不同，物化必须保 pattern 才不翻转，收益低风险高；
 *   留作 F4/D2 账本批的可选项（见收据「批次 3 账本面」节）。
 *
 * 纪律：纯函数（零 db／零网络／零 LLM）；未知一律 null，**禁编**；非法结构化字段 ⇒ 不采信、退文本兜底。
 */

const ROUND_L2 = 6;   // l2_baseline 读数保留位
const ROUND_L5 = 9;   // l5_sources 读数保留位
const KINDS = ['empirical', 'certified'];
const r6 = (x) => Number(Number(x).toFixed(ROUND_L2));
const r9 = (x) => Number(Number(x).toFixed(ROUND_L5));

/** k/n 分数（如「共 149/331」「=6/33」）——最可靠：同时给出 k 与 n。 */
function parseFraction(note) {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(note);
  if (!m) return null;
  const k = parseInt(m[1], 10), n = parseInt(m[2], 10);
  if (!(n > 0) || k > n) return null;
  return { k: k, n: n };
}

/** 「占 X%」——写作生成批的主句式（share 百分数）。 */
function parsePercentShare(note) {
  const m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (!m) return null;
  const p = parseFloat(m[1]) / 100;
  return isFinite(p) ? { p: p } : null;
}

/** 任意「X%」兜底（G2 读序的最后一档；仅表百分数出现）。 */
function parseAnyPercent(note) {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (!m) return null;
  const p = parseFloat(m[1]) / 100;
  return isFinite(p) ? { p: p } : null;
}

/** 「基率=v」/「基率=组合数理论值 v」——认证值或显式基率声明（v>1 按百分数理解）。 */
function parseBaseRateEq(note) {
  const m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(note);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!isFinite(v)) return null;
  return { p: v > 1 ? v / 100 : v };
}

/** 「组合数理论值 X」——L5 认证值声明的首选句式。 */
function parseCertifiedValue(note) {
  const m = /组合数理论值\s*([0-9]*\.?[0-9]+)/.exec(note);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!isFinite(v)) return null;
  return { p: v > 1 ? v / 100 : v };
}

/**
 * 样本量抽取（与语料 note 实际写法对齐；三种句式，**保守取最小 n**，防「2015-2024 共 300 个日值」
 * 这类窗口总长被当样本量放大）。原实现两份（l2_baseline.parseCount 与 g2-report.parseNoteN），
 * 2026-09-14 由本模块收敛为一份。
 * @param {string} note
 * @returns {number|null}
 */
function parseCount(note) {
  if (!note || typeof note !== 'string') return null;
  const ns = [];
  const res = [
    /(?:共|近|前|上)\s*(\d+)\s*(?:个|天|月|期|条)/g,
    /(\d+)\s*(?:个|天|月|期)[^0-9%]{0,12}?(?:的|中|值)/g,
    /(?:已发布|已开奖|已结算)\s*(\d+)\s*(?:个|天|月|期|条)/g,
  ];
  for (const re of res) { let m; while ((m = re.exec(note)) !== null) { const v = parseInt(m[1], 10); if (isFinite(v) && v > 0 && v < 100000) ns.push(v); } }
  return ns.length ? Math.min.apply(null, ns) : null;
}
/** g2-report 旧名（同一实现；保名字为零翻转）。 */
const parseNoteN = parseCount;

/**
 * L2 读序（l2_baseline.parseBaseRateNote 逐字等价）：分数 → 占 X% → 基率=；p 取 r6。
 * pattern 取值（与旧实现同名）：fraction｜pct_share_n｜pct_share_non｜base_rate_eq。
 * @returns {null|{p:number,n:number|null,k:number|null,pattern:string}}
 */
function parseBaseRateL2(note) {
  if (!note || typeof note !== 'string') return null;
  const frac = parseFraction(note);
  if (frac) return { p: r6(frac.k / frac.n), n: frac.n, k: frac.k, pattern: 'fraction' };
  const sh = parsePercentShare(note) || parseAnyPercent(note);   // 旧实现：「占 X%」；无「占」时任意「X%」兜底（同一分支，模式名同为 pct_share_*）
  if (sh) {
    const n = parseCount(note);
    return { p: r6(sh.p), n: n, k: n === null ? null : Math.round(sh.p * n), pattern: n === null ? 'pct_share_non' : 'pct_share_n' };
  }
  const eq = parseBaseRateEq(note);
  if (eq) {
    const n = parseCount(note);
    return { p: r6(eq.p), n: n, k: n === null ? null : Math.round(eq.p * n), pattern: 'base_rate_eq' };
  }
  return null;
}

/**
 * G2 读序（g2-report.parseBaseRate 逐字等价）：占 X% → 基率= → 任意 X% 兜底；**不取整**。
 * pattern 取值（与旧实现同名）：pct_share｜base_rate_eq｜pct_fallback。
 * @returns {null|{b:number,pattern:string}}
 */
function parseBaseRateG2(note) {
  if (!note) return null;
  const sh = parsePercentShare(note);
  if (sh) return { b: sh.p, pattern: 'pct_share' };
  const eq = parseBaseRateEq(note);
  if (eq) return { b: eq.p, pattern: 'base_rate_eq' };
  const any = parseAnyPercent(note);
  if (any) return { b: any.p, pattern: 'pct_fallback' };
  return null;
}

/**
 * L5 三态解析（l5_sources.parseCertifiedFromNote 逐字等价）：组合数理论值 → 基率= → 任意 X%；p 取 r9。
 * kind：certified_text＝认证值声明（可与注册表比对）｜empirical_pct＝历史频率（不同属预期，非矛盾）。
 * @returns {null|{p:number,kind:'certified_text'|'empirical_pct'}}
 */
function parseCertifiedFromNote(note) {
  if (!note || typeof note !== 'string') return null;
  const cv = parseCertifiedValue(note);
  if (cv) return { p: r9(cv.p), kind: 'certified_text' };
  const eq = parseBaseRateEq(note);
  if (eq) return { p: r9(eq.p), kind: 'certified_text' };
  const any = parseAnyPercent(note);
  if (any) return { p: r9(any.p), kind: 'empirical_pct' };
  return null;
}

// ── 结构化字段：读写 ────────────────────────────────────────────────────────

/** 结构化字段校验（非法一律 false ⇒ 调用方退文本兜底，绝不采信半截数据）。 */
function isStructured(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (!isFinite(x.p) || x.p < 0 || x.p > 1) return false;
  if (x.n !== undefined && x.n !== null && !(Number.isInteger(x.n) && x.n > 0)) return false;
  if (x.k !== undefined && x.k !== null && !(Number.isInteger(x.k) && x.k >= 0)) return false;
  if (x.k !== undefined && x.k !== null && x.n !== undefined && x.n !== null && x.k > x.n) return false;
  if (x.kind !== undefined && KINDS.indexOf(x.kind) === -1) return false;
  if (x.window !== undefined && x.window !== null) {
    if (typeof x.window !== 'object' || Array.isArray(x.window)) return false;
    if (x.window.from !== undefined && x.window.from !== null && typeof x.window.from !== 'string') return false;
    if (x.window.to !== undefined && x.window.to !== null && typeof x.window.to !== 'string') return false;
  }
  return true;
}

/**
 * 写端构造（随行落库）。**宁缺不编**：未知项不传 ⇒ 存 null；非法值抛错（写端当场暴露，不进账本）。
 * @param {{p:number,n?:number|null,k?:number|null,kind?:string,window?:object|null,basis?:string|null,cmp?:string|null,threshold?:number|null}} o
 */
function buildBaseRate(o) {
  const s = {
    p: o && o.p,
    n: o && o.n !== undefined ? o.n : null,
    k: o && o.k !== undefined ? o.k : null,
    kind: (o && o.kind) || 'empirical',
    window: (o && o.window) || null,
    basis: (o && o.basis) || null,
    cmp: (o && o.cmp) || null,
    threshold: (o && o.threshold !== undefined) ? o.threshold : null,
    schema: 'evidence.baseRate.v1',
  };
  if (!isStructured(s)) throw new Error('buildBaseRate: 非法结构化基率 ' + JSON.stringify(s));
  return s;
}

/** 通用读序（新路径用）：分数 → 占 X% → 基率= → 任意 X%（＝L2 序 + G2 兜底的超集）；p 取 r6。 */
function readTextSuper(note) {
  if (!note || typeof note !== 'string') return null;
  const frac = parseFraction(note);
  if (frac) return { p: r6(frac.k / frac.n), n: frac.n, k: frac.k, pattern: 'fraction' };
  const sh = parsePercentShare(note);
  if (sh) { const n = parseCount(note); return { p: r6(sh.p), n: n, k: n === null ? null : Math.round(sh.p * n), pattern: 'pct_share' }; }
  const eq = parseBaseRateEq(note);
  if (eq) { const n = parseCount(note); return { p: r6(eq.p), n: n, k: n === null ? null : Math.round(eq.p * n), pattern: 'base_rate_eq' }; }
  const any = parseAnyPercent(note);
  if (any) return { p: r6(any.p), n: null, k: null, pattern: 'pct_fallback' };
  return null;
}

/**
 * 读端主入口：**结构化优先、文本兜底**。
 * @param {{baseRate?:object, baseRateNote?:string}} entry evidence 数组元素（或同形对象）
 * @returns {null|{via:'structured'|'text', p:number, n:number|null, k:number|null, kind:string,
 *                 window:object|null, basis:string|null, cmp:string|null, threshold:number|null, pattern:string}}
 */
function readBaseRate(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (isStructured(entry.baseRate)) {
    const s = entry.baseRate;
    return {
      via: 'structured', p: s.p, n: s.n === undefined ? null : s.n, k: s.k === undefined ? null : s.k,
      kind: s.kind || 'empirical', window: s.window || null, basis: s.basis || null,
      cmp: s.cmp || null, threshold: s.threshold === undefined ? null : s.threshold, pattern: 'structured',
    };
  }
  const t = readTextSuper(entry.baseRateNote);
  if (!t) return null;
  const certifiedHint = /组合数理论值|认证随机/.test(String(entry.baseRateNote));
  return {
    via: 'text', p: t.p, n: t.n, k: t.k, kind: certifiedHint ? 'certified' : 'empirical',
    window: null, basis: entry.baseRateNote || null, cmp: null, threshold: null, pattern: t.pattern,
  };
}

/**
 * 由注记**确定性物化**结构化字段（写端随行落库用）。
 * 口径：默认与 L2 读序一致（⇒ 结构化读数与其注记的文本读数**逐字相同**，零翻转由构造保证）；
 *   kind='certified' 时走认证读序（p=r9，n/k 置 null——认证值没有样本量，不编）。
 * @param {string} note 生成批自己生成的 baseRateNote
 * @param {{kind?:string,window?:object|null,basis?:string|null,cmp?:string|null,threshold?:number|null}} [extra]
 * @returns {null|object} 不可解析 ⇒ null（该行不落结构化，读端走文本兜底）
 */
function baseRateFromNote(note, extra) {
  if (!note || typeof note !== 'string') return null;
  const o = extra || {};
  const kind = o.kind || (/组合数理论值|认证随机/.test(note) ? 'certified' : 'empirical');
  let vals = null;
  if (kind === 'certified') {
    const cv = parseCertifiedFromNote(note);
    if (cv) {
      // n/k 与**同一注记的 L2 读序**一致（如「=6/33」⇒ n=33,k=6）⇒ 结构化与文本两路引擎读数逐字相同（零翻转）。
      // 语义提示：认证行的 n 是注记里的组合数分母，**不是样本量**；L5 消费方只用 p/kind（见 l5_sources）。
      const t = parseBaseRateL2(note);
      vals = { p: cv.p, n: t ? t.n : null, k: t ? t.k : null };
    }
  }
  if (!vals) {
    const t = parseBaseRateL2(note);
    if (!t) return null;
    vals = { p: t.p, n: t.n, k: t.k };
  }
  return buildBaseRate({
    p: vals.p, n: vals.n, k: vals.k, kind: kind,
    window: o.window || null, basis: o.basis || null, cmp: o.cmp || null,
    threshold: o.threshold === undefined ? null : o.threshold,
  });
}

/**
 * 证据元素随行落库：有注记且尚无结构化 ⇒ 物化后加键（返回新对象，不改入参）；
 * 已有结构化 / 无注记 / 注记不可解析 ⇒ 原样返回（读端一律有文本兜底）。
 */
function attachBaseRate(entry, extra) {
  if (!entry || typeof entry !== 'object') return entry;
  if (isStructured(entry.baseRate)) return entry;
  const br = baseRateFromNote(entry.baseRateNote, extra);
  if (!br) return entry;
  return Object.assign({}, entry, { baseRate: br });
}

/** 人话一句（参数表/披露用；不参与任何判定）。 */
function describeBaseRate(br) {
  if (!br) return '（无基率读数）';
  const pct = (Number(br.p) * 100).toFixed(1) + '%';
  const src = br.via === 'structured' ? '结构化字段' : '文本解析(' + br.pattern + ')';
  const nn = br.n === null || br.n === undefined ? '样本量未记录' : 'n=' + br.n;
  const kk = br.k === null || br.k === undefined ? '' : ' k=' + br.k;
  const kind = br.kind === 'certified' ? '认证值/组合数理论值' : '历史频率';
  return pct + '（' + kind + '，' + nn + kk + '，来源=' + src + '）';
}

module.exports = {
  // 原语
  parseFraction, parsePercentShare, parseAnyPercent, parseBaseRateEq, parseCertifiedValue, parseCount, parseNoteN,
  // 三条既有读序（零翻转委托面）
  parseBaseRateL2, parseBaseRateG2, parseCertifiedFromNote,
  // 结构化字段
  isStructured, buildBaseRate, readBaseRate, readTextSuper, describeBaseRate,
  baseRateFromNote, attachBaseRate,
  ROUND_L2, ROUND_L5, KINDS,
};
