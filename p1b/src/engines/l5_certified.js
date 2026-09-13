'use strict';
/**
 * p1b/src/engines/l5_certified.js —— L5 不可约层最小引擎（阶段 4 起步，2026-09-13）。
 *
 * 依据：design §1.3（L5 三问：认证随机源 / 无信息优势路径 / 无统计偏倚；引擎姿态=只给系综）＋
 *   §2（L5 引擎=认证源公布分布；禁一切压制认证源的「模型优势」类宣称）＋ §5.3（L5 最小统计件）。
 *
 * 契约（纯函数：零 db、零 LLM、零网络）：
 *   入参 l5Certified({ certifiedSource, resolve_spec? })
 *     certifiedSource = { id, name?, kind:'uniform',  n|outcomes[], target? }
 *                     | { id, name?, kind:'official', outcomes[], probs[], target? }
 *   出参（合格）{ok:true,status:'ok',method:'certified_dist',source,distribution,p,n,ci:null,note,assertion_guard}
 *   出参（无源）{ok:false,status:'unsupported',reason:'no_source',p:null,n:null,ci:null,note,assertion_guard}
 *
 * 纪律：本层**只**输出认证源的公布分布（均匀或官方公布）；无认证源声明 → unsupported（宁缺毋滥）；
 *   自产文案经 assertion_guard 扫描；黑名单模式见 FORBIDDEN_ASSERTIONS（design §1.3 铁律）。
 */
const UNIFORM_KINDS = ['uniform', 'equally_likely', 'equiprobable'];
// 以下为「黑名单模式」：用于检出断言，不是断言本身（自产文案命中即视为护栏自身出 bug）。
const FORBIDDEN_ASSERTIONS = [
  /更准/, /更好/, /更聪明/, /更强/, /更胜/, /优于/, /胜过/, /打败/, /跑赢/, /做得更好/,
  /outperform/i, /better than/i, /beat the/i,
];

/** 断言扫描（口径护栏）：返回命中列表；L5 自产文案必须为 []。 */
function scanForbiddenAssertions(text) {
  const s = String(text === undefined || text === null ? '' : text);
  const hits = [];
  for (const re of FORBIDDEN_ASSERTIONS) { const m = re.exec(s); if (m) hits.push({ pattern: String(re), match: m[0] }); }
  return hits;
}

const L5_NOTE = 'L5 不可约层：只给认证源的公布分布（均匀或官方公布）；本层无 LLM 角色、不做任何信息优势宣称。'
  + '若历史表现显著低于该分布的 Brier 下限，按 design §1.3 记异常信号（提示泄漏），不记本事。';

/** 认证源声明归一：uniform → 等概率向量；official → 校验形状/范围/归一。 */
function normalizeSource(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { ok: false, reason: 'no_source' };
  const id = src.id === undefined || src.id === null ? '' : String(src.id).trim();
  if (!id) return { ok: false, reason: 'no_source_id' };
  const kind = src.kind === undefined || src.kind === null ? '' : String(src.kind).trim().toLowerCase();
  const name = src.name === undefined || src.name === null ? id : String(src.name);
  if (UNIFORM_KINDS.indexOf(kind) !== -1) {
    let outcomes;
    if (Array.isArray(src.outcomes) && src.outcomes.length) {
      outcomes = src.outcomes.map(String);
    } else {
      const n = Number(src.n);
      if (!Number.isInteger(n) || n < 2) return { ok: false, reason: 'uniform_n_invalid' };
      outcomes = []; for (let i = 1; i <= n; i++) outcomes.push('outcome_' + i);
    }
    const probs = outcomes.map(() => Number((1 / outcomes.length).toFixed(9)));
    return { ok: true, source: { id: id, name: name, kind: 'uniform' }, outcomes: outcomes, probs: probs };
  }
  if (kind === 'official' || kind === 'published') {
    if (!Array.isArray(src.outcomes) || !Array.isArray(src.probs)
      || !src.outcomes.length || src.outcomes.length !== src.probs.length) {
      return { ok: false, reason: 'official_shape_invalid' };
    }
    const outcomes = src.outcomes.map(String);
    const probs = src.probs.map(Number);
    for (const v of probs) if (!Number.isFinite(v) || v < 0 || v > 1) return { ok: false, reason: 'official_prob_out_of_range' };
    const sum = probs.reduce((s, x) => s + x, 0);
    if (Math.abs(sum - 1) > 1e-6) return { ok: false, reason: 'official_prob_sum_not_one' };
    return { ok: true, source: { id: id, name: name, kind: 'official' }, outcomes: outcomes, probs: probs };
  }
  return { ok: false, reason: 'kind_unknown' };
}

/**
 * L5 最小引擎主入口（纯函数）。
 * @param {{certifiedSource?:object, certified_source?:object, resolve_spec?:object}} input
 * @returns {{ok:boolean,status:string,method:string,p:number|null,n:number|null,ci:null,note:string,assertion_guard:object}}
 */
function l5Certified(input) {
  const opt = input || {};
  const src = opt.certifiedSource || opt.certified_source
    || (opt.resolve_spec && opt.resolve_spec.certified_source) || null;
  const mkUnsupported = (reason, note) => {
    const out = { ok: false, status: 'unsupported', method: 'certified_dist', reason: reason,
      p: null, n: null, ci: null, source: null, distribution: null, note: note,
      assertion_guard: { checked: true, hits: [] } };
    out.assertion_guard.hits = scanForbiddenAssertions(JSON.stringify(out));
    return out;
  };
  if (!src) {
    return mkUnsupported('no_source',
      '未声明认证源（evidence.certifiedSource）：L5 只给认证源的公布分布，缺声明不出任何分布或概率。');
  }
  const norm = normalizeSource(src);
  if (!norm.ok) {
    return mkUnsupported(norm.reason,
      '认证源声明不完整/非法（reason=' + norm.reason + '）：L5 宁缺毋滥，退回 unsupported，不出分布。');
  }
  let p = null;
  if (src.target !== undefined && src.target !== null) {
    const idx = norm.outcomes.indexOf(String(src.target));
    if (idx >= 0) p = Number(norm.probs[idx].toFixed(9));
  }
  const out = { ok: true, status: 'ok', method: 'certified_dist', reason: null, source: norm.source,
    distribution: { outcomes: norm.outcomes, probs: norm.probs }, p: p, n: norm.outcomes.length, ci: null,
    note: L5_NOTE, assertion_guard: { checked: true, hits: [] } };
  out.assertion_guard.hits = scanForbiddenAssertions(JSON.stringify(out));
  return out;
}

module.exports = { l5Certified, scanForbiddenAssertions, normalizeSource, FORBIDDEN_ASSERTIONS, L5_NOTE };

