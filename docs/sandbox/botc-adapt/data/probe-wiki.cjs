// B站 Wiki API 结构探测
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0 (local research)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(label, url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const txt = await res.text();
    console.log('===', label, '| status', res.status, '| len', txt.length);
    return txt;
  } catch (e) {
    console.log('===', label, '| FETCH ERROR', e.message);
    return '';
  }
}
(async () => {
  // 1) 英文页名是否直连
  const t1 = await get('parse page=washerwoman', B + '?action=parse&page=washerwoman&prop=wikitext&format=json&formatversion=2');
  try { const j = JSON.parse(t1);
    if (j.parse) console.log('title:', j.parse.title, '\nwikitext[0:700]:', String(j.parse.wikitext).slice(0, 700));
    else console.log('no parse:', t1.slice(0, 250));
  } catch { console.log(t1.slice(0, 250)); }
  await sleep(600);
  // 2) 中文页名是否直连
  const t2 = await get('parse page=洗衣妇', B + '?action=parse&page=' + encodeURIComponent('洗衣妇') + '&prop=wikitext&format=json&formatversion=2');
  try { const j = JSON.parse(t2);
    if (j.parse) console.log('title:', j.parse.title, '\nwikitext[0:400]:', String(j.parse.wikitext).slice(0, 400));
    else console.log('no parse:', t2.slice(0, 250));
  } catch { console.log(t2.slice(0, 250)); }
  await sleep(600);
  // 3) 全站页面列表（看命名习惯）
  const t3 = await get('allpages', B + '?action=query&list=allpages&aplimit=500&format=json&formatversion=2');
  try { const j = JSON.parse(t3);
    const ps = (j.query && j.query.allpages) || [];
    console.log('allpages n=', ps.length, 'continue?', !!j.continue);
    console.log('titles:', ps.slice(0, 60).map(p => p.title).join(' | '));
  } catch { console.log(t3.slice(0, 250)); }
  await sleep(600);
  // 4) 分类:镇民 成员
  const t4 = await get('categorymembers 镇民', B + '?action=query&list=categorymembers&cmtitle=' + encodeURIComponent('Category:镇民') + '&cmlimit=50&format=json&formatversion=2');
  try { const j = JSON.parse(t4);
    const ms = (j.query && j.query.categorymembers) || [];
    console.log('cat 镇民 n=', ms.length);
    console.log(ms.slice(0, 40).map(p => p.title).join(' | '));
  } catch { console.log(t4.slice(0, 250)); }
})();
