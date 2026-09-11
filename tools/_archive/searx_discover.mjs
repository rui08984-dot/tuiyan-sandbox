// SearXNG bilibili discovery: run queries, extract BV ids + titles + UP hints
// Usage: node tools\searx_discover.mjs <out.json> "query1" "query2" ...
import { writeFileSync } from 'node:fs';

const [outFile, ...queries] = process.argv.slice(2);
if (!outFile || queries.length === 0) {
  console.error('usage: node searx_discover.mjs <out.json> <query...>');
  process.exit(1);
}

const seen = new Map(); // bvid -> record
for (const q of queries) {
  const url = 'http://localhost:18080/search?q=' + encodeURIComponent(q) + '&format=json';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.error('Q_FAIL', q, r.status); continue; }
    const j = await r.json();
    let n = 0;
    for (const it of j.results || []) {
      const u = it.url || '';
      const m = u.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/);
      if (!m) continue;
      const bv = m[1];
      if (seen.has(bv)) { seen.get(bv).queries.push(q); continue; }
      seen.set(bv, {
        bv,
        title: (it.title || '').replace(/<[^>]+>/g, '').trim(),
        content: (it.content || '').replace(/<[^>]+>/g, '').slice(0, 200),
        engine: it.engine || '',
        published: it.published || '',
        queries: [q],
      });
      n++;
    }
    console.log('Q_OK', q, 'new_bv=' + n, 'total_results=' + (j.results || []).length);
  } catch (e) {
    console.error('Q_ERR', q, String(e).slice(0, 120));
  }
  await new Promise(res => setTimeout(res, 1500));
}
const arr = [...seen.values()];
writeFileSync(outFile, JSON.stringify(arr, null, 2), 'utf8');
console.log('DONE bv_unique=' + arr.length + ' -> ' + outFile);
