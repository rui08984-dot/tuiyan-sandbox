// 诊断：biligame 567 是全局还是调用特征
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BG = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function api(params, tag) {
  const url = BG + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://wiki.biligame.com/bloodontheclocktower/' } });
  console.log(tag, '->', res.status);
  if (res.status === 200) { const j = await res.json(); return j; }
  return null;
}
(async () => {
  const a = await api({ action: 'parse', page: '洗衣妇', prop: 'wikitext' }, 'parse 洗衣妇(known-good)');
  await sleep(2500);
  const b = await api({ action: 'parse', page: '士兵', prop: 'wikitext' }, 'parse 士兵');
  await sleep(2500);
  const c = await api({ action: 'query', prop: 'revisions', titles: '士兵', rvprop: 'content', rvslots: 'main' }, 'revisions 士兵');
  await sleep(2500);
  const d = await api({ action: 'parse', page: '洗衣妇', prop: 'wikitext' }, 'parse 洗衣妇 again');
  if (c && c.query && c.query.pages && c.query.pages[0] && c.query.pages[0].revisions) {
    const wt = c.query.pages[0].revisions[0].slots.main.content || '';
    console.log('REVISIONS 士兵 OK | len', wt.length, '| 角色能力:', /角色能力/.test(wt));
    console.log('head:', wt.slice(0, 260).replace(/\n/g, ' ¶ '));
  }
})();
