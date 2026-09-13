
Object.assign(B3, {
  async github_weekly_commits(r) {
    const u = r.url || ('https://api.github.com/repos/' + r.repo + '/stats/commit_activity');
    const j = await fetchRetry(() => cachedGet(u, { 'User-Agent': 'corpus-resolve-daemon', Accept: 'application/vnd.github+json' }), 2, 'github');
    const arr = Array.isArray(j) ? j : null;
    if (!arr || !arr.length) return { pending: 'GitHub ' + r.repo + ' commit_activity 空（API 统计缓存未就绪）' };
    const want = Math.floor(Date.parse(r.week_start + 'T00:00:00Z') / 1000);
    const it = arr.filter((w) => Number(w.week) === want)[0];
    if (!it) {
      const mx = Math.max.apply(null, arr.map((w) => Number(w.week) || 0));
      if (mx < want) return { pending: 'GitHub ' + r.repo + ' 周 ' + r.week_start + ' 统计未就绪（最新周 ' + dateOf(new Date(mx * 1000).toISOString()) + '）' };
      return { pending: 'GitHub ' + r.repo + ' 周 ' + r.week_start + ' 不在 commit_activity 窗口' };
    }
    const ok = cmpOk(it.total, r.cmp, r.threshold);
    if (ok === null) return { pending: 'github cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'GitHub ' + r.repo + ' 周 ' + r.week_start + '~' + r.week_end + ' 提交数=' + it.total + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async frankfurter_rate(r) {
    const u = (r.url_template || 'https://api.frankfurter.app/{date}?from={base}&to={quote}').replace('{date}', r.date).replace('{base}', r.base).replace('{quote}', r.quote);
    const j = await fetchRetry(() => cachedGet(u), 2, 'frankfurter');
    const rate = j && j.rates ? j.rates[r.quote] : null;
    if (rate === null || rate === undefined) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + r.date + ' 无参考汇率（非 ECB 发布日/该日未到）' };
    const ok = cmpOk(rate, r.cmp, r.threshold);
    if (ok === null) return { pending: 'frankfurter cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Frankfurter ECB ' + r.base + '/' + r.quote + ' ' + dateOf(j.date) + '=' + rate + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async frankfurter_rate_range(r) {
    const u = (r.url_template || 'https://api.frankfurter.app/{date}..{date_plus7}?from={base}&to={quote}').replace('{date}', r.date).replace('{date_plus7}', r.date_plus7).replace('{base}', r.base).replace('{quote}', r.quote);
    const j = await fetchRetry(() => cachedGet(u), 2, 'frankfurter');
    const keys = Object.keys((j && j.rates) || {}).filter((d) => d >= r.date && d <= r.date_plus7).sort();
    if (!keys.length) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + r.date + '~' + r.date_plus7 + ' 暂无发布日' };
    const d0 = keys[0], rate = j.rates[d0][r.quote];
    if (rate === null || rate === undefined) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + d0 + ' 无 ' + r.quote };
    const ok = cmpOk(rate, r.cmp, r.threshold);
    if (ok === null) return { pending: 'frankfurter cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Frankfurter ECB ' + r.base + '/' + r.quote + ' 当周首个发布日 ' + d0 + '=' + rate + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
});