// 探测6：biligame 直查 士兵/告密者 + 灰机备源结构
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(base, params) {
  const url = base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  for (let a = 1; a <= 3; a++) {
    try { const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 botc-adapt-datafetch/1.0' } });
      if (res.status === 200) return await res.json();
      console.log('  HTTP', res.status, 'attempt', a); }
    catch (e) { console.log('  ERR', e.message, 'attempt', a); }
    await sleep(900);
  }
  return { error: { code: 'network' } };
}
(async () => {
  const BG = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
  for (const t of ['士兵', '告密者']) {
    const p = await api(BG, { action: 'parse', page: t, prop: 'wikitext' });
    await sleep(620);
    if (p.parse) {
      const wt = p.parse.wikitext || '';
      console.log('==', t, 'exists | title:', p.parse.title, '| len', wt.length, '| 角色能力:', /角色能力/.test(wt));
      console.log('   head:', wt.slice(0, 300).replace(/\n/g, ' ¶ '));
      console.log('   ability:', (wt.match(/'''([^']+)'''/) || [])[1] || '(none)');
    } else console.log('==', t, 'MISSING', JSON.stringify(p.error || {}).slice(0, 120));
  }
  const HJ = 'https://towerhb.huijiwiki.com/api.php';
  for (const t of ['Alchemist', 'Soldier']) {
    const p = await api(HJ, { action: 'parse', page: t, prop: 'wikitext' });
    await sleep(620);
    if (p.parse) {
      const wt = p.parse.wikitext || '';
      console.log('== HUIJI', t, 'exists | title:', p.parse.title, '| len', wt.length);
      console.log('   head:', wt.slice(0, 500).replace(/\n/g, ' ¶ '));
    } else console.log('== HUIJI', t, 'MISSING', JSON.stringify(p.error || {}).slice(0, 120));
  }
})();
