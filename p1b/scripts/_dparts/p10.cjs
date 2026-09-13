
// ── 数据可得性预筛（省 API 调用 + 避免拿 400/404 白打网）──
// 只对「物理上此刻不可能有真值」的情形提前判 pending，判据全部写在注释里，可随源行为调整。
function preScreen(r) {
  const k = String(r.kind || ''), t = today();
  const d10 = (x) => dateOf(x);
  if (k === 'openmeteo_daily_max' || k === 'openmeteo_forecast_daily_max') {
    if (d10(r.date) > addDays(t, 15)) return '事件日 ' + r.date + ' 超出 Open-Meteo 15 日预报窗口（archive 未入库）';
  }
  if (k === 'binance_daily_close') { if (d10(r.date) >= t) return 'UTC 日 ' + r.date + ' 尚未收盘'; }
  if (k === 'wikimedia_pageviews') { if (d10(r.date) >= t) return 'Wikimedia ' + r.date + ' 数据 T+1 才发布'; }
  if (k === 'github_weekly_commits') { if (d10(r.week_end) >= t) return 'GitHub 周 ' + r.week_start + '~' + r.week_end + ' 尚未结束（stats 亦需 T+1）'; }
  if (k === 'frankfurter_rate') { if (d10(r.date) > t) return 'ECB 参考汇率发布日 ' + r.date + ' 未到'; }
  if (k === 'frankfurter_rate_range') { if (d10(r.date_plus7) > t) return 'ECB 发布窗口 ' + r.date + '~' + r.date_plus7 + ' 尚未走完（接口对未来区间 404）'; }
  if (k === 'openmeteo_air_pm10_daily_mean') { if (d10(r.date) >= t) return '空气质量 ' + r.date + ' 小时序列未出齐（需 T+1）'; }
  if (k === 'dbnomics_bis_monthly_mean') { if (String(r.month) >= t.slice(0, 7)) return 'BIS ' + r.month + ' 月值未发布（BIS 滞后约 1 个月，实测最新 2025-07）'; }
  if (k === 'npm_downloads_window') { if (d10(r.end) >= t) return 'npm ' + r.package + ' 窗口 ' + r.start + '~' + r.end + ' 未走完（接口对未来区间 400）'; }
  return null;
}
