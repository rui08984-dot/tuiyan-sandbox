'use strict';
// _p4-metaculus-probe2：只读复核 403 是否普遍 + 是否有免 key 替代通道（串行 + 退避）
const fs = require('fs');
const OUT = 'E:/music player/p1b/sim/out/metaculus-probe';
const UA = 'dsh-p4-probe/1.0 (research; +node)';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const EPS = [
  ['api2-question-detail', 'https://www.metaculus.com/api2/questions/1/', UA],
  ['api-post-detail', 'https://www.metaculus.com/api/posts/1/', UA],
  ['api-root', 'https://www.metaculus.com/api/', UA],
  ['api2-with-browser-ua', 'https://www.metaculus.com/api2/questions/?limit=2', BROWSER],
  ['public-questions-page', 'https://www.metaculus.com/questions/', BROWSER]
];
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
(async () => {
  const summary = [];
  for (const [name, url, ua] of EPS) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
    let rec = { name: name, url: url, ua: ua === BROWSER ? 'browser' : 'probe' };
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json, text/html, */*' }, signal: ac.signal, redirect: 'follow' });
      const txt = await r.text();
      rec.status = r.status; rec.ct = r.headers.get('content-type') || ''; rec.len = txt.length;
      rec.head = txt.slice(0, 180).replace(/\s+/g, ' ');
      fs.writeFileSync(OUT + '/' + name + '.raw.txt', 'URL: ' + url + '\nUA: ' + rec.ua + '\nHTTP ' + r.status + '\nCT: ' + rec.ct + '\n\n' + txt.slice(0, 4000), 'utf8');
    } catch (e) { rec.status = 'ERR'; rec.head = String(e.message).slice(0, 120); }
    finally { clearTimeout(t); }
    summary.push(rec);
    console.log(JSON.stringify(rec));
    await sleep(1500);
  }
  fs.writeFileSync(OUT + '/round2-summary.json', JSON.stringify(summary, null, 1), 'utf8');
})();