
Object.assign(B3, {
  async npm_downloads_window(r) {
    const want = Math.round((Date.parse(r.end + 'T00:00:00Z') - Date.parse(r.start + 'T00:00:00Z')) / 86400000) + 1;
    if (r.end < today()) {
      const u = (r.url_template || 'https://api.npmjs.org/downloads/range/{start}:{end}/{package}').replace('{start}', r.start).replace('{end}', r.end).replace('{package}', r.package);
      const j = await fetchRetry(() => cachedGet(u), 2, 'npm');
      const dl = j && j.downloads;
      if (!Array.isArray(dl)) return { pending: 'npm ' + r.package + ' 无下载数据（' + JSON.stringify(j).slice(0, 120) + '）' };
      const win = dl.filter((d) => d.day >= r.start && d.day <= r.end);
      if (win.length < want) return { pending: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 窗口未满（' + win.length + '/' + want + ' 天）' };
      const sum = win.reduce((a, b) => a + Number(b.downloads || 0), 0);
      const ok = cmpOk(sum, r.cmp, r.threshold);
      if (ok === null) return { pending: 'npm cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
      return { outcome: ok ? 'true' : 'false', note: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 下载量=' + sum + '（阈值 ' + r.cmp + r.threshold + '，' + want + ' 日满窗，机检）' };
    }
    // 窗口含未来日：npm range 接口对 end>今天 直接 400（实测 error: end date > start date），
    // 只有窗口结束后才可解析，故此处按 pending 跳过，不写库。
    return { pending: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 窗口含未来日（接口对未结束窗口返回 400）' };
  },
  async dbnomics_bis_monthly_mean(r) {
    const u = r.url_template || ('https://api.db.nomics.world/v22/series/BIS/WS_EER/' + r.series + '?observations=1');
    const j = await fetchRetry(() => cachedGet(u), 2, 'dbnomics');
    const doc = j && j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: 'DBnomics ' + r.series + ' 序列不存在' };
    const per = doc.period || [], val = doc.value || [];
    const vals = [];
    for (let i = 0; i < per.length; i++) { if (String(per[i]).slice(0, 7) !== r.month) continue; const v = Number(val[i]); if (isFinite(v)) vals.push(v); }
    if (!vals.length) return { pending: 'DBnomics BIS ' + r.series + ' ' + r.month + ' 月值未发布（最新 ' + String(per.slice(-1)[0] || '').slice(0, 10) + '）' };
    const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
    const ok = cmpOk(mean, r.cmp, r.threshold);
    if (ok === null) return { pending: 'BIS cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'DBnomics BIS ' + r.series + ' ' + r.month + ' 月均值=' + mean + '（阈值 ' + r.cmp + r.threshold + '，n=' + vals.length + ' 日值，非数字观测已剔除，机检）' };
  },
});