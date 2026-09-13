
async function main() {
  if (args.indexOf('--report-due') !== -1) { db.init(); return await reportDue(); }
  log('=== corpus-resolve-daemon start | mode=' + (LOOP ? 'loop' : 'once') + ' interval=' + INTERVAL_MIN + 'min due-only=' + DUE_ONLY + ' confirm=' + CONFIRM + (CONFIRM ? '' : '（DRY-RUN，不写库）'));
  const lm = loadBase();
  if (!BASE) log('WARN 未能内联复用 corpus-resolve 的 RESOLVERS（' + lm + '）：仅 daemon 内置的 b3 系列 kind 可解，其余记 unsupported');
  else log('复用 corpus-resolve RESOLVERS 成功：' + lm);
  db.init();
  await refreshCals();
  let n = 0;
  for (;;) {
    n++;
    const ctx = await roundRun();
    await execRound(ctx);
    const R = ctx.R; R.netCalls = roundApiHits;
    log('round#' + n + ' 用时 ' + ((Date.now() - ctx.t0) / 1000).toFixed(1) + 's | 未解总数=' + R.total + ' 到期选中=' + R.due + ' 唯一真值请求=' + R.groups + '（台账重复合并 ' + R.deduped + '） | resolved=' + R.resolved + ' pending=' + R.pending + '（含预筛 ' + R.prescreened + '） fail=' + R.fail + ' refused=' + R.refused + '／同结论并发=' + R.refusedRace + ' 口径护栏=' + R.guarded + ' unsupported=' + R.unsupported + ' 未到期跳过=' + R.notdue + ' 无法定到期=' + R.undatable + ' wouldWrite=' + R.wouldWrite + ' 实打网=' + R.netCalls);
    if (Object.keys(R.unsupportedKinds).length) log('  unsupported 明细 ' + JSON.stringify(R.unsupportedKinds));
    if (Object.keys(R.failKinds).length) log('  取数失败明细 ' + JSON.stringify(R.failKinds));
    if (!LOOP) break;
    log('sleep ' + INTERVAL_MIN + ' 分钟 ...');
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60000));
  }
}
main().catch((e) => { log('FATAL ' + ((e && e.stack) ? e.stack : (e && e.message))); process.exit(1); });
