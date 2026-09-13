
// ── b3 系列真值锚（复用 corpus-backfill 写入的 resolve 参数；此处只读实现，不复用其脚本）──
const B3 = {
  async openmeteo_air_pm10_daily_mean(r) {
    const u = (r.url_template || '').replace('{date}', r.date).replace('{date}', r.date);
    const j = await getJson(u);
    const h = (j.hourly && j.hourly.pm10) || [];
    const vals = h.filter((x) => x !== null && x !== undefined);
    if (vals.length < 18) return { pending: 'Open-Meteo air ' + r.date + ' PM10 小时值不足（' + vals.length + '/' + h.length + '）' };
    const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    const ok = cmpOk(mean, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'Open-Meteo air ' + r.date + ' PM10 日均=' + mean + '（阈值 ' + r.cmp + r.threshold + '，n=' + vals.length + '，机检）' };
  },
  async binance_daily_close(r) {
    let u = r.url_template;
    if (!u) u = 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}';
    u = u.replace('{symbol}', r.symbol).replace('{start_ms}', r.start_ms).replace('{end_ms}', r.end_ms);
    const j = await getJson(u);
    const k = Array.isArray(j) ? j[0] : null;
    if (!k) return { pending: 'Binance ' + r.date + ' 无 K 线（UTC 日尚未收盘）' };
    const close = Number(k[4]);
    const ok = cmpOk(close, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'Binance ' + r.symbol + ' ' + r.date + ' close=' + close + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async wikimedia_pageviews(r) {
    const u = (r.url_template || 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/{article}/daily/{date}00/{date}00').replace('{article}', r.article).replace('{date}', r.date).replace('{date}', r.date);
    const j = await getJson(u);
    const it = (j.items || [])[0];
    if (!it) return { pending: 'Wikimedia ' + r.article + ' ' + r.date + ' 无页面浏览量记录' };
    const ok = cmpOk(it.views, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'Wikimedia ' + r.article + ' ' + r.date + ' views=' + it.views + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async github_weekly_commits(r) {
    const u = r.url || ('https://api.github.com/repos/' + r.repo + '/stats/commit_activity');
    const j = await getJson(u, { 'User-Agent': 'corpus-resolve-daemon', Accept: 'application/vnd.github+json' });
    const arr = Array.isArray(j) ? j : null;
    if (!arr || !arr.length) return { pending: 'GitHub ' + r.repo + ' commit_activity 空（API 统计缓存未就绪）' };
    const want = Math.floor(new Date(r.week_start + 'T00:00:00Z').getTime() / 1000);
    const it = arr.filter((w) => Number(w.week) === want)[0];
    if (!it) { const mx = Math.max.apply(null, arr.map((w) => Number(w.week) || 0)); if (mx < want) return { pending: 'GitHub ' + r.repo + ' 周 ' + r.week_start + ' 统计未就绪（最新周 ' + dateOf(new Date(mx * 1000).toISOString()) + '）' }; return { pending: 'GitHub ' + r.repo + ' 周 ' + r.week_start + ' 不在 commit_activity 窗口' }; }
    const ok = cmpOk(it.total, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'GitHub ' + r.repo + ' 周 ' + r.week_start + '~' + r.week_end + ' 提交数=' + it.total + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async frankfurter_rate(r) {
    const u = (r.url_template || 'https://api.frankfurter.app/{date}?from={base}&to={quote}').replace('{date}', r.date).replace('{base}', r.base).replace('{quote}', r.quote);
    const j = await getJson(u);
    const rate = j && j.rates ? j.rates[r.quote] : null;
    if (rate === null || rate === undefined) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + r.date + ' 无参考汇率（非 ECB 发布日）' };
    const ok = cmpOk(rate, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'Frankfurter ECB ' + r.base + '/' + r.quote + ' ' + j.date + '=' + rate + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async npm_downloads_window(r) {
    const u = (r.url_template || 'https://api.npmjs.org/downloads/range/{start}:{end}/{package}').replace('{start}', r.start).replace('{end}', r.end).replace('{package}', r.package);
    const j = await getJson(u);
    const dl = j && j.downloads;
    if (!Array.isArray(dl)) return { pending: 'npm ' + r.package + ' 无下载数据' };
    const want = Math.round((new Date(r.end + 'T00:00:00Z').getTime() - new Date(r.start + 'T00:00:00Z').getTime()) / 86400000) + 1;
    if (dl.length < want) return { pending: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 窗口未满（' + dl.length + '/' + want + ' 天）' };
    const sum = dl.filter((d) => d.day >= r.start && d.day <= r.end).reduce((a, b) => a + Number(b.downloads || 0), 0);
    const ok = cmpOk(sum, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 下载量=' + sum + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async dbnomics_bis_monthly_mean(r) {
    const u = r.url_template || ('https://api.db.nomics.world/v22/series/BIS/WS_EER/' + r.series + '?observations=1');
    const j = await getJson(u);
    const doc = j && j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: 'DBnomics ' + r.series + ' 序列不存在' };
    const vals = (doc.period || []).map((p, i) => (String(p).slice(0, 7) === r.month ? doc.value[i] : null)).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return { pending: 'DBnomics BIS ' + r.series + ' ' + r.month + ' 月值未发布（最新 ' + (doc.period || []).slice(-1)[0] + '）' };
    const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
    const ok = cmpOk(mean, r.cmp, r.threshold);
    return { outcome: ok ? 'true' : 'false', note: 'DBnomics BIS ' + r.series + ' ' + r.month + ' 月均值=' + mean + '（阈值 ' + r.cmp + r.threshold + '，n=' + vals.length + '，机检）' };
  },
};
