'use strict';
const UA = 'corpus-n1-recon/1.0 (research; +node)';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function getJsonRetry(url, headers, tries) {
  const n = tries || 4; let last = null;
  for (let a = 0; a < n; a++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try { const r = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json, */*' }, headers || {}) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { last = e; if (a < n - 1) await sleep(1500 * (a + 1)); }
    finally { clearTimeout(t); }
  }
  throw last;
}
async function getText(url) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
(async () => {
  const CUT = '2026-09-12';
  const minus = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') - k * 86400000).toISOString().slice(0, 10);
  try {
    for (const s of ['01646500', '09380000']) {
      const u = 'https://waterservices.usgs.gov/nwis/dv/?format=json&sites=' + s + '&parameterCd=00060&startDT=' + minus(CUT, 400) + '&endDT=' + minus(CUT, 1);
      const j = await getJsonRetry(u);
      const ts = j.value.timeSeries[0]; const vals = ts.values[0].value.map((x) => Number(x.value)).filter((x) => isFinite(x));
      console.log('USGS ' + s + ' n=' + vals.length + ' [' + ts.sourceInfo.siteName + '] last=' + vals[vals.length - 1]);
    }
  } catch (e) { console.log('USGS FAIL ' + e.message); }
  try {
    const t = await getText('https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv');
    const rows = t.split('\n').filter((x) => x && x.charAt(0) !== '#').map((x) => x.split(',')).filter((c) => c.length >= 5 && c[3] !== '' && c[4] !== '');
    const pre = rows.filter((c) => c[0] + '-' + ('0' + c[1]).slice(-2) + '-' + ('0' + c[2]).slice(-2) < CUT);
    console.log('GML CO2 rows=' + rows.length + ' pre=' + pre.length + ' last=' + JSON.stringify(pre[pre.length - 1]));
  } catch (e) { console.log('GML FAIL ' + e.message); }
  try {
    const u = 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00094728&startDate=' + minus(CUT, 373) + '&endDate=' + minus(CUT, 1) + '&dataTypes=TMAX&format=json&units=standard';
    const j = await getJsonRetry(u);
    console.log('GHCN rows=' + j.length + ' first=' + JSON.stringify(j[0]));
  } catch (e) { console.log('GHCN FAIL ' + e.message); }
})();