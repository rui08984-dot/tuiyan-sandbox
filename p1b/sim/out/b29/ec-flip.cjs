// 关键核查：24 条已 resolve 的 energycharts 行，若改用「本地日全窗口」口径，结论会不会翻转？
// 翻转 = 账本里已写入错误真值（不可逆污染）
const path = require('path');
const ROOT = 'E:/music player';
const D = require(path.join(ROOT, 'p1a-terminal/node_modules/better-sqlite3'));
const db = new D(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readonly: true });
const FETCH_MS = 25000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(u) {
  for (let k = 0; k < 3; k++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
    try { const r = await fetch(u, { signal: ac.signal }); if (r.status === 429) { await sleep(3000); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  throw new Error('rate-limited/retry-exhausted');
}

(async () => {
  const rows = db.prepare("SELECT p.id, p.outcome, p.matures_at, json_extract(e.value,'$.resolve') rj "
    + "FROM predictions p, json_each(p.evidence_json) e "
    + "WHERE json_extract(e.value,'$.resolve.kind')='energycharts_daily_mean' AND p.outcome IS NOT NULL ORDER BY p.id").all();
  const out = []; let same = 0, flipped = 0, errs = 0;
  const cache = new Map();
  for (const row of rows) {
    const r = JSON.parse(row.rj);
    const key = r.country + '|' + r.date;
    let j;
    try {
      if (!cache.has(key)) { j = await getJson('https://api.energy-charts.info/public_power?country=' + r.country + '&start=' + r.date + '&end=' + r.date); cache.set(key, j); await sleep(1200); }
      else j = cache.get(key);
    } catch (e) { errs++; out.push('id=' + row.id + ' ERR ' + e.message); continue; }
    const ts = j.unix_seconds || [];
    const tp = (j.production_types || []).filter((x) => x.name === r.type)[0];
    if (!tp) { errs++; out.push('id=' + row.id + ' no-type'); continue; }
    // 全窗口（本地日）均值
    let s = 0, n = 0;
    ts.forEach((sec, i) => { const v = tp.data[i]; if (v === null || v === undefined || !isFinite(v)) return; s += Number(v); n++; });
    const fullMean = s / n;
    const fullOutcome = (r.cmp === '<=' ? (fullMean <= r.threshold) : (r.cmp === '<' ? (fullMean < r.threshold) : (fullMean >= r.threshold))) ? 'true' : 'false';
    const hit = fullOutcome === row.outcome;
    if (hit) same++; else { flipped++; out.push('*** FLIP id=' + row.id + ' ' + r.country + '/' + r.type + ' stored=' + row.outcome + ' -> full=' + fullOutcome + ' (mean=' + fullMean.toFixed(2) + ' th=' + r.threshold + ' cmp=' + r.cmp + ')'); }
  }
  console.log(out.join('\n'));
  console.log('---');
  console.log('已 resolve energycharts 行=' + rows.length + ' | 不翻转=' + same + ' | **翻转=' + flipped + '** | 取数失败=' + errs);
  require('fs').writeFileSync(path.join(ROOT, '.tmp/ec-flip.txt'), out.join('\n') + '\n---\n' + 'total=' + rows.length + ' same=' + same + ' flipped=' + flipped + ' errs=' + errs, 'utf8');
  db.close();
})();
