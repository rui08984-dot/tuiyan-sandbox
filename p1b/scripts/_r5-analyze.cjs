'use strict';
// _r5-analyze：解析 resolve 收据文件，输出分布
const fs = require('fs');
const f = process.argv[2];
const t = fs.readFileSync(f, 'utf8').split('\n');
const c = { dry_resolve_true: 0, dry_resolve_false: 0, pending: 0, fetch_fail: 0, skip_unregistered: 0, skip_no_resolve: 0, resolved_true: 0, resolved_false: 0, refused: 0 };
const pend = {}, fail = {}, unreg = {};
for (const ln of t) {
  let m;
  if ((m = /^\[dry\] would resolve id=\d+ -> (true|false)/.exec(ln))) c['dry_resolve_' + m[1]]++;
  else if ((m = /^resolved id=\d+ -> (true|false)/.exec(ln))) c['resolved_' + m[1]]++;
  else if ((m = /^pending id=\d+ (\S+)/.exec(ln))) { c.pending++; pend[m[1]] = (pend[m[1]] || 0) + 1; }
  else if ((m = /^fetch-fail id=\d+ (\S+)/.exec(ln))) { c.fetch_fail++; fail[m[1]] = (fail[m[1]] || 0) + 1; }
  else if ((m = /^skip id=\d+ （kind 未注册，需实现：(\S+)）/.exec(ln))) { c.skip_unregistered++; unreg[m[1]] = (unreg[m[1]] || 0) + 1; }
  else if (/^skip id=\d+ （无 resolve 参数/.test(ln)) c.skip_no_resolve++;
  else if (/^resolve-refused id=/.test(ln)) c.refused++;
}
console.log('counts=' + JSON.stringify(c, null, 1));
console.log('pending_by_kind=' + JSON.stringify(pend, null, 1));
console.log('fetchfail_by_kind=' + JSON.stringify(fail, null, 1));
console.log('unregistered_by_kind=' + JSON.stringify(unreg, null, 1));
console.log('--- tail ---');
console.log(t.filter((x) => /^summary:|^by-kind:|^unregistered-kinds:/.test(x)).join('\n'));
