
// ── 参数安全门（护栏）：resolve 参数与 resolver 口径不符的题一律跳过不写 ──
// 起因（实测）：corpus-resolve 的 cwl_ssq_red_contains 在 resolve.ball=null 时会把 null 当成
// 『红球不含该号』直接判 false 落库（openmeteo 的 cmp 字段同样被硬编码忽略）。宁可 pending 也不写脏账。
function paramGuard(r) {
  const k = String(r.kind || '');
  const num = (x) => x !== undefined && x !== null && x !== '' && isFinite(Number(x));
  const ok = (allowed) => !r.cmp || allowed.indexOf(r.cmp) !== -1;
  const thr = (f) => (num(r[f]) ? null : f + ' 缺失/非法=' + JSON.stringify(r[f]));
  if (k === 'cwl_ssq_red_contains') return (typeof r.ball === 'string' && /^\d{2}$/.test(r.ball)) ? null : 'cwl_ssq_red_contains 缺合法 ball（实测=' + JSON.stringify(r.ball) + '）';
  if (k === 'cwl_ssq_blue_odd' || k === 'cwl_ssq_blue_odd_forward') return r.ball ? 'cwl_ssq_blue_odd 带多余 ball=' + r.ball : null;
  if (k === 'dbnomics_series_value') { const a = thr('threshold'); if (a) return a; return ok(['<']) ? null : 'cmp=' + r.cmp + ' 与提取器硬编码 < 不符'; }
  if (k === 'openmeteo_daily_max') { const a = thr('threshold_c'); if (a) return a; return ok(['>']) ? null : 'cmp=' + r.cmp + ' 与提取器硬编码 > 不符'; }
  if (k === 'openmeteo_forecast_daily_max') { const a = thr('threshold_c'); if (a) return a; return ok(['>']) ? null : 'cmp=' + r.cmp + ' 与提取器硬编码 > 不符'; }
  if (k === 'dlt_draw_result') {
    const b = r.back_ball !== undefined && r.back_ball !== null, f = r.front_max_ge !== undefined && r.front_max_ge !== null;
    return b === f ? 'dlt_draw_result 需恰好一个 back_ball/front_max_ge（实测 back=' + JSON.stringify(r.back_ball) + ' front=' + JSON.stringify(r.front_max_ge) + '）' : null;
  }
  if (k === 'frankfurter_rate' || k === 'frankfurter_rate_range') { const a = thr('threshold'); if (a) return a; if (!r.base || !r.quote) return 'base/quote 缺失'; return ok(['>=', '<=', '>', '<']) ? null : 'cmp 非法=' + r.cmp; }
  if (B3[k]) { const a = thr('threshold'); if (a) return a; return ok(['>=', '<=', '>', '<']) ? null : 'cmp 非法=' + r.cmp; }
  return null;
}
