// 探测4：剧本页（暗流涌动/灾祸滋生/煽动叛乱）的角色链接清单
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0 (local research)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params) {
  const url = B + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  try { const res = await fetch(url, { headers: { 'User-Agent': UA } }); return { status: res.status, data: res.status === 200 ? await res.json() : null }; }
  catch (e) { return { status: -1, data: null }; }
}
(async () => {
  for (const t of ['暗流涌动', '灾祸滋生', '煽动叛乱', '旅行者']) {
    const p = await api({ action: 'parse', page: t, prop: 'links', pllimit: '200' });
    await sleep(620);
    console.log('===', t, 'status', p.status);
    const links = (p.data && p.data.parse && p.data.parse.links || []).filter(l => l.ns === 0).map(l => l.title);
    if (links.length) console.log('ns0 links(' + links.length + '):', links.join(' | ').slice(0, 1500));
    else console.log('(no links / missing)');
  }
})();
