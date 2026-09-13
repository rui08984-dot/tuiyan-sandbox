'use strict';
// _p4-metaculus-probe5：捕获 403 的完整响应头（限速/边缘信息取证）
const fs = require('fs');
const OUT = 'E:/music player/p1b/sim/out/metaculus-probe';
const UA = 'dsh-p4-probe/1.0 (research; +node)';
(async () => {
  const url = 'https://www.metaculus.com/api/posts/?limit=2';
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const hdrs = {};
  for (const [k, v] of r.headers) hdrs[k] = v;
  const body = await r.text();
  const rec = { url: url, status: r.status, statusText: r.statusText, headers: hdrs, body: body };
  console.log('status=' + r.status + ' ' + r.statusText);
  console.log('headers=' + JSON.stringify(hdrs));
  console.log('body=' + body);
  fs.writeFileSync(OUT + '/round5-403-headers.json', JSON.stringify(rec, null, 1), 'utf8');
})();