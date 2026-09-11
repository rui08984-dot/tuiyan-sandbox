// 探测8：暗流涌动页 wikitext 结构（权威映射表验证）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BG = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function api(params) {
  const url = BG + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://wiki.biligame.com/bloodontheclocktower/' } });
  console.log('status', res.status);
  return res.status === 200 ? await res.json() : null;
}
(async () => {
  const p = await api({ action: 'parse', page: '暗流涌动', prop: 'wikitext' });
  await sleep(800);
  if (!p || !p.parse) { console.log('parse fail'); return; }
  const wt = p.parse.wikitext || '';
  console.log('len:', wt.length);
  console.log('--- head 1800 ---');
  console.log(wt.slice(0, 1800));
  console.log('--- File refs ---');
  const re = /\[\[(?:File|文件|Image):([^\]|]+)/gi;
  let m, files = [];
  while ((m = re.exec(wt))) files.push(m[1]);
  console.log(files.join(' | ').slice(0, 1200));
  console.log('--- 首页 links（找三剧本页） ---');
  const h = await api({ action: 'parse', page: '首页', prop: 'links', pllimit: '200' });
  await sleep(800);
  const ls = ((h && h.parse && h.parse.links) || []).filter(l => l.ns === 0).map(l => l.title);
  console.log(ls.join(' | ').slice(0, 1200));
})();
