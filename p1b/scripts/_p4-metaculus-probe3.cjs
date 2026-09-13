'use strict';
// _p4-metaculus-probe3：解析 /api/ 文档壳，枚举可能的公开 schema / 免鉴权端点
const fs = require('fs');
const OUT = 'E:/music player/p1b/sim/out/metaculus-probe';
const UA = 'dsh-p4-probe/1.0 (research; +node)';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function get(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ac.signal, redirect: 'follow' }); return { s: r.status, ct: r.headers.get('content-type') || '', txt: await r.text() }; }
  catch (e) { return { s: 'ERR', ct: '', txt: String(e.message) }; }
  finally { clearTimeout(t); }
}
(async () => {
  const root = await get('https://www.metaculus.com/api/');
  const links = (root.txt.match(/(?:href|src|url)\s*[:=]\s*["']([^"']+)["']/g) || []).slice(0, 20);
  console.log('root links=' + JSON.stringify(links));
  const cands = ['https://www.metaculus.com/api/schema/', 'https://www.metaculus.com/api/schema.json', 'https://www.metaculus.com/api/openapi.json', 'https://www.metaculus.com/api/docs/', 'https://www.metaculus.com/api/schema/?format=openapi'];
  const summary = [];
  for (const u of cands) {
    const r = await get(u);
    const rec = { url: u, status: r.s, ct: r.ct, len: r.txt.length, head: r.txt.slice(0, 140).replace(/\s+/g, ' ') };
    summary.push(rec); console.log(JSON.stringify(rec));
    fs.writeFileSync(OUT + '/schema-' + u.split('/').slice(-2).join('-').replace(/[?=]/g, '_') + '.raw.txt', 'URL: ' + u + '\nHTTP ' + r.s + '\n\n' + r.txt.slice(0, 3000), 'utf8');
    await sleep(1200);
  }
  fs.writeFileSync(OUT + '/round3-schema-summary.json', JSON.stringify(summary, null, 1), 'utf8');
})();