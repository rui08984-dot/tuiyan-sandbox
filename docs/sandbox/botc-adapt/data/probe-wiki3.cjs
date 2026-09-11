// B站 Wiki 探测 3：官方页所属分类 + 搜索质量
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
  const t1 = await get('categories of 洗衣妇', B + '?action=query&titles=' + encodeURIComponent('洗衣妇') + '&prop=categories&cllimit=50&clshow=!hidden&format=json&formatversion=2');
  try { const j = JSON.parse(t1);
    const pg = j.query && j.query.pages && j.query.pages[0];
    console.log('page:', pg && pg.title, 'categories:', JSON.stringify((pg && pg.categories || []).map(c => c.title)));
  } catch { console.log(t1.slice(0, 300)); }
  await sleep(600);
  const t1b = await get('categories incl hidden', B + '?action=query&titles=' + encodeURIComponent('洗衣妇') + '&prop=categories&cllimit=100&format=json&formatversion=2');
  try { const j = JSON.parse(t1b);
    const pg = j.query && j.query.pages && j.query.pages[0];
    console.log('ALL categories:', JSON.stringify((pg && pg.categories || []).map(c => c.title)));
  } catch { console.log(t1b.slice(0, 300)); }
  await sleep(600);
  // 搜索质量抽查：非常规英文名
  for (const q of ['Vortox', 'Fang Gu', 'Lycanthrope']) {
    const t = await get('search ' + q, B + '?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&srlimit=6&format=json&formatversion=2');
    try { const j = JSON.parse(t);
      const ss = (j.query && j.query.search) || [];
      console.log('search', q, '->', ss.map(s => s.title).join(' | '));
    } catch { console.log('bad'); }
    await sleep(600);
  }
  // 猜测：暗流涌动 分类
  for (const c of ['暗流涌动', '官方角色']) {
    const t = await get('catmembers ' + c, B + '?action=query&list=categorymembers&cmtitle=' + encodeURIComponent('Category:' + c) + '&cmlimit=40&format=json&formatversion=2');
    try { const j = JSON.parse(t);
      const ms = (j.query && j.query.categorymembers) || [];
      console.log('cat', c, 'n=', ms.length, '->', ms.slice(0, 20).map(p => p.title).join(' | '));
    } catch { console.log('bad'); }
    await sleep(600);
  }
})();
