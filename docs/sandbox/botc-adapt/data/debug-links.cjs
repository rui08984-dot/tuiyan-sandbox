// debug：剧本页 links 调用真实返回
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params) {
  const url = B + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  console.log('URL:', url.slice(0, 160));
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const data = res.status === 200 ? await res.json() : null;
  return { status: res.status, data };
}
(async () => {
  const lk = await api({ action: 'parse', page: '暗流涌动', prop: 'links', pllimit: '250' });
  await sleep(620);
  console.log('status:', lk.status);
  if (lk.data && lk.data.error) console.log('API ERROR:', JSON.stringify(lk.data.error));
  if (lk.data && lk.data.parse) {
    const links = lk.data.parse.links || [];
    console.log('links total:', links.length, '| ns0:', links.filter(l => l.ns === 0).length);
    console.log('has 士兵:', links.some(l => l.title === '士兵'), '| sample:', links.slice(0, 5).map(l => l.ns + ':' + l.title).join(' | '));
  }
  const ap1 = await api({ action: 'query', list: 'allpages', aplimit: '500', apfrom: '' });
  await sleep(620);
  console.log('allpages status:', ap1.status, '| error:', ap1.data && ap1.data.error ? JSON.stringify(ap1.data.error) : 'none');
  if (ap1.data && ap1.data.query) {
    const ps = ap1.data.query.allpages || [];
    console.log('allpages first page n=', ps.length, '| continue:', JSON.stringify(ap1.data.continue || null));
  }
})();
