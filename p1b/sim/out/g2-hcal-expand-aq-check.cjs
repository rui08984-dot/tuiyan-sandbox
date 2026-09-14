// 核验 1633/1535 的基率方向：真方向是 <= 还是 >=（cmp0 措辞 bug 判定）
// 窗口与生成器一致：TODAY=2026-09-13，addDays(TODAY,-400) ~ addDays(TODAY,-1)，timezone=GMT
const CITIES = [
  { id: 1633, n: '墨西哥城', lat: 19.43, lon: -99.13, v: 'pm2_5', th: 28.93, claimed: 0.603 },
  { id: 1535, n: '伦敦', lat: 51.51, lon: -0.13, v: 'pm10', th: 11.88, claimed: 0.603 },
];
const FETCH_MS = 30000;
async function getJson(u) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); }
}
(async () => {
  for (const c of CITIES) {
    const u = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + c.lat + '&longitude=' + c.lon
      + '&hourly=' + c.v + '&timezone=GMT&start_date=2025-08-09&end_date=2026-09-12';
    const j = await getJson(u);
    const t = (j.hourly && j.hourly.time) || [];
    const arr = (j.hourly && j.hourly[c.v]) || [];
    const acc = {};
    t.forEach((ts, i) => { const d = ts.slice(0, 10), x = arr[i]; if (x === null || x === undefined || !isFinite(x)) return; (acc[d] = acc[d] || []).push(x); });
    const means = Object.keys(acc).sort().map((d) => acc[d].reduce((p, q) => p + q, 0) / acc[d].length);
    const le = means.filter((x) => x <= c.th).length / means.length;
    const ge = means.filter((x) => x >= c.th).length / means.length;
    console.log('id=' + c.id + ' ' + c.n + ' ' + c.v + ' th=' + c.th
      + ' | n=' + means.length + ' | P(<=)=' + le.toFixed(4) + ' | P(>=)=' + ge.toFixed(4)
      + ' | 题面方向=<= | 注记声称/记录值=' + c.claimed + ' -> ' + (Math.abs(le - c.claimed) < 0.01 ? 'P(<=) 吻合（注记方向=措辞 bug，b 正确）' : (Math.abs(ge - c.claimed) < 0.01 ? 'P(>=) 吻合（实测方向与题面相反！b 方向错）' : '两者都不吻合，需人工复查')));
  }
})();
