// B站 Wiki 探测 2：英文名重定向 / 搜索 / 官方角色总表
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0 (local research)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(label, url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const txt = await res.text();
    console.log('===', label, '| status', res.status, '| len', txt.length);
    return txt;
  } catch (e) { console.log('===', label, '| ERROR', e.message); return ''; }
}
(async () => {
  // 1) 英文名 + redirects
  const t1 = await get('redirects Washerwoman|Undertaker', B + '?action=query&titles=' + encodeURIComponent('Washerwoman|Undertaker|Pit-Hag') + '&redirects=1&format=json&formatversion=2');
  console.log(t1.slice(0, 600));
  await sleep(600);
  // 2) 搜索 Washerwoman
  const t2 = await get('search Washerwoman', B + '?action=query&list=search&srsearch=' + encodeURIComponent('Washerwoman') + '&srlimit=5&format=json&formatversion=2');
  try { const j = JSON.parse(t2);
    const ss = (j.query && j.query.search) || [];
    console.log('search hits:', ss.map(s => s.title).join(' | '));
  } catch { console.log(t2.slice(0, 300)); }
  await sleep(600);
  // 3) 猜总表页
  for (const guess of ['角色一览', '角色列表', '首页']) {
    const t = await get('parse ' + guess, B + '?action=parse&page=' + encodeURIComponent(guess) + '&prop=wikitext&format=json&formatversion=2');
    try { const j = JSON.parse(t);
      if (j.parse) console.log('title:', j.parse.title, '| wikitext[0:500]:', String(j.parse.wikitext).slice(0, 500).replace(/\n/g, ' ¶ '));
      else console.log('missing:', guess);
    } catch { console.log('bad json for', guess); }
    await sleep(600);
  }
  // 4) 分类树：Category:角色 的子分类
  const t4 = await get('allcategories 角色', B + '?action=query&list=allcategories&acprefix=' + encodeURIComponent('角色') + '&aclimit=50&format=json&formatversion=2');
  try { const j = JSON.parse(t4);
    const cs = (j.query && j.query.allcategories) || [];
    console.log('categories prefix 角色:', cs.map(c => c['*'] + '(' + (c.pages ?? c.count ?? '?') + ')').join(' | '));
  } catch { console.log(t4.slice(0, 300)); }
})();
