'use strict';
// _p4-metaculus-probe4：取 Static OpenAPI 规范（文档壳给出的 /static/openapi.*.yml）
const fs = require('fs');
const OUT = 'E:/music player/p1b/sim/out/metaculus-probe';
const UA = 'dsh-p4-probe/1.0 (research; +node)';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function get(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ac.signal, redirect: 'follow' }); return { s: r.status, ct: r.headers.get('content-type') || '', txt: await r.text() }; }
  catch (e) { return { s: 'ERR', ct: '', txt: String(e.message) }; }
  finally { clearTimeout(t); }
}
(async () => {
  const cands = ['https://www.metaculus.com/static/openapi.6835eb50da0b.yml', 'https://www.metaculus.com/api/static/openapi.6835eb50da0b.yml'];
  const summary = [];
  for (const u of cands) {
    const r = await get(u);
    const rec = { url: u, status: r.s, ct: r.ct, len: r.txt.length, head: r.txt.slice(0, 160).replace(/\s+/g, ' ') };
    summary.push(rec); console.log(JSON.stringify(rec));
    if (r.s === 200 && r.txt.length > 500) {
      fs.writeFileSync(OUT + '/metaculus-openapi.yml', r.txt, 'utf8');
      const paths = (r.txt.match(/^\s{2}\/[^\s:]+:/gm) || []).map((x) => x.trim().replace(':', ''));
      console.log('PATHS(' + paths.length + ')=' + JSON.stringify(paths.slice(0, 60)));
      console.log('has questions: ' + r.txt.indexOf('questions') + ' | has posts: ' + r.txt.indexOf('posts') + ' | has token: ' + /securitySchemes|bearer|Token/i.test(r.txt));
    }
    await sleep(1500);
  }
  fs.writeFileSync(OUT + '/round4-openapi-summary.json', JSON.stringify(summary, null, 1), 'utf8');
})();