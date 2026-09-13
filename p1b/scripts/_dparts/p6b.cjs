
async function execRound(ctx) {
  const { R, groups } = ctx;
  const conn = db.getConnection();
  const SLOW = { wikimedia_pageviews: 1, openmeteo_air_pm10_daily_mean: 1, frankfurter_rate: 1, frankfurter_rate_range: 1, github_weekly_commits: 1, binance_daily_close: 1, dlt_draw_result: 1, cwl_ssq_red_contains: 1, cwl_ssq_blue_odd: 1, cwl_ssq_blue_odd_forward: 1 };
  const fast = [], slow = [];
  for (const [, g] of groups) { if (g.pre) continue; (SLOW[g.r.kind] ? slow : fast).push(g); }
  const doOne = async (g) => { try { g.out = await evalRow(g.r); } catch (e) { g.out = { error: e.message }; } };
  await pool(fast, 6, doOne);
  await pool(slow, 1, async (g) => { await doOne(g); await SLEEP(1500); });
  // 二遍补打：只重试「取数失败」的组（网络偶发），成功/待到期不再打
  const retry = [...groups.values()].filter((g) => !g.pre && g.out && g.out.error && /HTTP (429|5\d\d)|fetch failed|abort/i.test(String(g.out.error)));
  if (retry.length) {
    log('二遍补打 ' + retry.length + ' 组（首遍网络失败，缓 8s 后重试一次）');
    await SLEEP(8000);
    await pool(retry, 2, doOne);
  }
  for (const [, g] of groups) {
    const out = g.out;
    if (g.pre) { R.pending += g.ids.length; R.prescreened += g.ids.length; log('  pending(预筛) kind=' + g.r.kind + ' x' + g.ids.length + ' due=' + g.due + ' — ' + g.pre); continue; }
    if (!out) { R.fail += g.ids.length; log('  no-result kind=' + g.r.kind + ' x' + g.ids.length); continue; }
    if (out.unsupported) { R.unsupported += g.ids.length; const q = 'unsupported:' + g.r.kind; R.unsupportedKinds[q] = (R.unsupportedKinds[q] || 0) + g.ids.length; log('  unsupported kind=' + g.r.kind + ' x' + g.ids.length + ' — ' + out.unsupported); continue; }
    if (out.error) { R.fail += g.ids.length; const q = 'fetch-fail:' + g.r.kind + ':' + out.error; R.failKinds[q] = (R.failKinds[q] || 0) + g.ids.length; log('  fetch-fail kind=' + g.r.kind + ' x' + g.ids.length + ' — ' + out.error + '（跳过不写）'); continue; }
    if (out.pending) { R.pending += g.ids.length; log('  pending kind=' + g.r.kind + ' x' + g.ids.length + ' due=' + g.due + ' — ' + out.pending); continue; }
    if (out.outcome !== 'true' && out.outcome !== 'false') { R.fail += g.ids.length; log('  bad-outcome kind=' + g.r.kind + ' x' + g.ids.length + ' raw=' + JSON.stringify(out).slice(0, 160)); continue; }
    if (!CONFIRM) { R.wouldWrite += g.ids.length; log('  [dry] would resolve kind=' + g.r.kind + ' x' + g.ids.length + ' due=' + g.due + ' -> ' + out.outcome + ' | ' + out.note); continue; }
    for (const id of g.ids) {
      const res = resolvePrediction(id, out.outcome, out.note);
      if (res.ok) { R.resolved++; log('  resolved id=' + id + ' kind=' + g.r.kind + ' -> ' + out.outcome + ' | ' + out.note); continue; }
      const now = conn.prepare('SELECT outcome, resolve_note FROM predictions WHERE id = ?').get(id) || {};
      if (now.outcome === out.outcome) { R.refusedRace++; log('  refused(concurrent) id=' + id + ' ' + res.reason + '｜库中已=' + now.outcome + '，与本轮结论一致'); }
      else { R.refusedPre++; R.refused++; log('  refused(ledger-immutable) id=' + id + ' ' + res.reason + '｜库中=' + now.outcome + '（' + String(now.resolve_note || '').slice(0, 60) + '），本轮算出=' + out.outcome + ' → 不改，仅记差异'); }
    }
  }
}
