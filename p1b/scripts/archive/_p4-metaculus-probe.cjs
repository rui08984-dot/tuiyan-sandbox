'use strict';
// _p4-metaculus-probe：只读探测 Metaculus 公共 API 形状（串行 + 退避，礼貌限速）
const UA = 'dsh-p4-probe/1.0 (research; +node)';
const ENDPOINTS = [
  'https://www.metaculus.com/api/posts/?limit=2',
  'https://www.metaculus.com/api2/questions/?limit=2',
  'https://www.metaculus.com/api/posts/'
];
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
(async () => {
  for (const url of ENDPOINTS) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
      const txt = await r.text();
      console.log(url + ' -> HTTP ' + r.status + ' ct=' + (r.headers.get('content-type') || '') + ' len=' + txt.length);
      console.log('  head=' + txt.slice(0, 260).replace(/\s+/g, ' '));
    } catch (e) { console.log(url + ' -> ERR ' + e.message); }
    finally { clearTimeout(t); }
    await sleep(1200);
  }
})();