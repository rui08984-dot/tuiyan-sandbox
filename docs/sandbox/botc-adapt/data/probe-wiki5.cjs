// 探测5：找 灾祸滋生/煽动叛乱 的真实页名
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params) {
  const url = B + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return { status: res.status, data: res.status === 200 ? await res.json() : null };
}
(async () => {
  for (const q of ['灾祸滋生', '煽动叛乱', 'Bad Moon Rising', 'Sects and Violets']) {
    const s = await api({ action: 'query', list: 'search', srsearch: q, srlimit: '6' });
    await sleep(620);
    const hits = ((s.data && s.data.query && s.data.query.search) || []).map(h => h.title);
    console.log('search', q, '->', JSON.stringify(hits));
  }
})();
