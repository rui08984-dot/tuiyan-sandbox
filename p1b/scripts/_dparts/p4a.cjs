
// ── b3 系列真值锚（1/3）：PM10 / Binance / Wikimedia（真值口径对照 corpus-backfill resolve.field）──
const B3 = {
  async openmeteo_air_pm10_daily_mean(r) {
    const u = (r.url_template || '').replace('{date}', r.date).replace('{date}', r.date);
    const j = await fetchRetry(() => cachedGet(u), 3, 'air');
    const t = (j.hourly && j.hourly.time) || [], h = (j.hourly && j.hourly.pm10) || [];
    const vals = [];
    for (let i = 0; i < t.length; i++) { if (String(t[i]).slice(0, 10) !== r.date) continue; const v = Number(h[i]); if (isFinite(v)) vals.push(v); }
    if (vals.length < 12) return { pending: 'Open-Meteo air ' + r.date + ' PM10 小时值不足（' + vals.length + '）' };
    const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    const ok = cmpOk(mean, r.cmp, r.threshold);
    if (ok === null) return { pending: 'PM10 cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Open-Meteo air ' + r.date + ' PM10 日均=' + mean + ' μg/m³（阈值 ' + r.cmp + r.threshold + '，n=' + vals.length + ' 小时，机检）' };
  },
  async binance_daily_close(r) {
    let u = r.url_template || 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}';
    u = u.replace('{symbol}', r.symbol).replace('{start_ms}', r.start_ms).replace('{end_ms}', r.end_ms);
    const j = await fetchRetry(() => cachedGet(u), 3, 'binance');
    const k = Array.isArray(j) ? j[0] : null;
    if (!k) return { pending: 'Binance ' + r.date + ' 无 K 线（UTC 日尚未收盘）' };
    const close = Number(k[4]), day = dateOf(new Date(Number(k[0])).toISOString());
    if (day !== r.date) return { pending: 'Binance ' + r.symbol + ' 首根 K 线为 ' + day + '，非 ' + r.date + '（该 UTC 日未收盘）' };
    const ok = cmpOk(close, r.cmp, r.threshold);
    if (ok === null) return { pending: 'binance cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Binance ' + r.symbol + ' ' + r.date + ' close=' + close + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async wikimedia_pageviews(r) {
    // 实测：Wikimedia 只认紧凑 YYYYMMDD，写 ISO 会 400；且该站有 UA 反爬（连续快打会 429）
    const dc = String(r.date).replace(/-/g, '');
    const u = (r.url_template || '').replace('{date}00', dc + '00').replace('{date}', dc);
    const j = await fetchRetry(() => cachedGet(u), 3, 'wikimedia');
    const it = (j.items || []).filter((x) => String(x.timestamp).slice(0, 8) === dc)[0];
    if (!it) return { pending: 'Wikimedia ' + r.article + ' ' + r.date + ' 无页面浏览量记录（该日数据未发布）' };
    const ok = cmpOk(it.views, r.cmp, r.threshold);
    if (ok === null) return { pending: 'wikimedia cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Wikimedia ' + r.article + ' ' + r.date + ' views=' + it.views + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
};
