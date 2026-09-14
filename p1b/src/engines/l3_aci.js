'use strict';
/**
 * p1b/src/engines/l3_aci.js —— L3 短窗混沌层最小引擎（stat_baseline + ACI 在线校准）（2026-09-14）
 *
 * 依据：design §1.6（L3 引擎姿态＝**基率+短窗校准**；K 8.4 两件套）＋
 *   `.scratch/forecast-debate/G-合并.md` §8.4（**F24 ACI 外环** γ=0.005 × **F18 滚动窗/0.99^衰减内环**，F33 归一化平稳）。
 *
 * 契约（纯函数：零 db / 零 LLM / 零网络）：
 *   入参 l3Aci({ baseRateNote? | counts?{k,n} | history?, feedback?:[{p,y}], alphaStar?, gamma?, decay?, alphaMin?, alphaMax? })
 *   出参（合格）{ok:true, status:'ok', method:'stat_baseline+aci', p, n, k, ci, aci:{...}, source, note}
 *        （不足）{ok:false, status:'insufficient_data'|…同上，p:null，aci 仍如实返回}
 *
 * 纪律：
 *   ① 点估计 p **恒为基率**（与 l2_baseline 同源解析/同 Wilson 口径）——**本层不产任何"优于基率"宣称**；
 *      ACI 只调**预测集**与**覆盖率披露**，不调 p。
 *   ② 无反馈序列 ⇒ α_final=α_star、coverage=null（如实"未适应"，不装已校准）。
 *   ③ 反馈序列按**时间序**逐条 err_t 反馈；内环覆盖率用 0.99^decay 的 EWMA（只用 0/1 误差指示，天然平稳）。
 */
const { l2Baseline, wilson } = require('./l2_baseline');

const DEFAULTS = { alphaStar: 0.05, gamma: 0.005, decay: 0.99, alphaMin: 0.001, alphaMax: 0.5 };

function r6(x) { return Number(x.toFixed(6)); }
function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/** 二分类预测集（conformal 式）：置信不足 ⇒ 集合含两类（[0,1]），置信足 ⇒ 单元素。 */
function predictionSet(p, alpha) {
  if (p >= 1 - alpha) return [1];
  if (p <= alpha) return [0];
  return [0, 1];
}

/**
 * ACI 外环（F24）：α_{t+1} = clip(α_t + γ(α* − err_t))，err_t = 1{y_t ∉ 预测集(α_t)}。
 * 内环（F18）：误差指示上的 0.99^decay EWMA 覆盖率。
 * @param {Array<{p:number,y:0|1|boolean}>} feedback 时间序
 */
function aciReplay(feedback, opt) {
  const o = Object.assign({}, DEFAULTS, opt || {});
  let alpha = o.alphaStar;
  const errs = [];
  for (const it of (feedback || [])) {
    if (!it) continue;
    const y = (it.y === 1 || it.y === true) ? 1 : ((it.y === 0 || it.y === false) ? 0 : null);
    const p = Number(it.p);
    if (y === null || !isFinite(p)) continue;
    const set = predictionSet(clip(p, 0, 1), alpha);
    const err = set.indexOf(y) === -1 ? 1 : 0;
    errs.push(err);
    alpha = clip(alpha + o.gamma * (o.alphaStar - err), o.alphaMin, o.alphaMax);
  }
  const n = errs.length;
  const hits = errs.filter((e) => e === 0).length;
  let ew = null;
  if (n) {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { const w = Math.pow(o.decay, n - 1 - i); num += w * (1 - errs[i]); den += w; }
    ew = num / den;
  }
  return {
    alpha_start: o.alphaStar, alpha_final: r6(alpha), alpha_star: o.alphaStar, gamma: o.gamma,
    decay: o.decay, alpha_min: o.alphaMin, alpha_max: o.alphaMax,
    coverage: n ? { n: n, hits: hits, rate: r6(hits / n) } : null,
    ewma_coverage: ew === null ? null : r6(ew),
  };
}

/**
 * L3 最小引擎主入口（纯函数）。
 * @param {{baseRateNote?:string, counts?:{k:number,n:number}, history?:Array, feedback?:Array, alphaStar?:number, gamma?:number, decay?:number, minN?:number}} input
 */
function l3Aci(input) {
  const opt = input || {};
  const base = l2Baseline({ counts: opt.counts, history: opt.history, baseRateNote: opt.baseRateNote, minN: opt.minN });
  const aci = aciReplay(Array.isArray(opt.feedback) ? opt.feedback : [], opt);
  if (!base.ok) {
    return {
      ok: false, status: base.status, method: 'stat_baseline+aci', p: null, n: base.n, k: base.k, ci: null,
      aci: aci, source: base.source,
      note: 'L3/ACI：点估计与准入线同 L2 口径 ⇒ ' + base.status + '（' + base.note + '）；ACI 统计仍如实返回。',
    };
  }
  const w = wilson(base.k, base.n);
  return {
    ok: true, status: 'ok', method: 'stat_baseline+aci', p: base.p, n: base.n, k: base.k, ci: [w.lo, w.hi],
    aci: Object.assign({}, aci, { prediction_set: predictionSet(base.p, aci.alpha_final) }),
    source: base.source,
    note: 'L3 短窗混沌：p=基率（Wilson 95% CI 同 L2 口径，n=' + base.n + '）；ACI 外环 α*=' + aci.alpha_star
      + '／γ=' + aci.gamma + '／内环 0.99^衰减；反馈回放 ' + (aci.coverage ? aci.coverage.n : 0) + ' 条 ⇒ α_final=' + aci.alpha_final
      + (aci.coverage ? '（实测覆盖 ' + aci.coverage.rate + '，名义 ' + (1 - aci.alpha_star) + '；EWMA ' + aci.ewma_coverage + '）'
        : '（无反馈序列 ⇒ 未适应）')
      + '。本层不产「优于基率」宣称。',
  };
}

module.exports = { l3Aci, aciReplay, predictionSet, DEFAULTS };
