'use strict';
/*
 * PREREG-命题A-3.0消融 · §5 双窗参数件（跑批参数显式落盘；**禁止两窗合并**）
 * 依据：.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md §5（sha256 5d6907d1…）
 *       ＋ .scratch/forecast-debate/acr-二期报告-20260912.md（漂移由喂给 LLM 的事件窗决定）。
 * 实现口径与 p1b/scripts/acr-run-llm.cjs L46-55 **逐字节同规则**：
 *   cutoff ＝ 排除 dusk 相事件（投票/计票/终局），保留 night+day 公开记录（防结算泄漏，主判据窗）；
 *   full   ＝ 全量事件（含计票与终局，≈生产天结算 see-all，伴生窗）。
 * 用法：
 *   const W = require('./prereg-a-windows');
 *   W.cutoffView(events, claims); W.fullView(events, claims); W.assertSingleWindow('cutoff');
 */
const WINDOW_IDS = ['cutoff', 'full'];
const CUTOFF_NOTE = '截至投票前：不含计票与终局结算';
const FULL_NOTE = '全量公开记录（含计票与终局结算）';
const DUSK_PHASE = 'dusk';

/** 截止窗：排除 dusk（投票/计票/终局），claims 随其 event_id 一并排除。 */
function cutoffView(events, claims) {
  const es = Array.isArray(events) ? events : [];
  const keep = new Set(es.filter((e) => e.phase !== DUSK_PHASE).map((e) => e.id));
  return { window: 'cutoff', events: es.filter((e) => keep.has(e.id)),
    claims: (Array.isArray(claims) ? claims : []).filter((c) => keep.has(c.event_id)), _note: CUTOFF_NOTE };
}
/** 全量窗（伴生读数；A 类注入仅在此窗可见）。 */
function fullView(events, claims) {
  return { window: 'full', events: Array.isArray(events) ? events : [], claims: Array.isArray(claims) ? claims : [], _note: FULL_NOTE };
}
/** 禁止两窗合并/混算：任何读数必须携带唯一 window id，否则抛错。 */
function assertSingleWindow(win) {
  if (WINDOW_IDS.indexOf(win) === -1) throw new Error('[prereg-a] 非法窗 id：' + win + '（仅 ' + WINDOW_IDS.join('|') + '；禁止合并/混算）');
  return win;
}
/** 自检：cutoff ≤ full，且被排除事件全为 dusk。 */
function windowCounts(events) {
  const es = Array.isArray(events) ? events : [];
  const c = cutoffView(es, []).events.length;
  return { cutoff: c, full: es.length, dusk_excluded: es.length - c };
}
module.exports = { WINDOW_IDS, CUTOFF_NOTE, FULL_NOTE, DUSK_PHASE, cutoffView, fullView, assertSingleWindow, windowCounts,
  SOURCE: 'p1b/scripts/acr-run-llm.cjs L46-55', PREREG: '.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md §5',
  PREREG_SHA256: '5d6907d1910acab842b92a172714d44b13cadf474f33d45008ea67f0a6098845' };
