// t3p discovery: SearXNG bilibili discovery for 4 target UPs, queries embedded (UTF-8 safe)
// Usage: node tools\searx_discover3.mjs <out.json>
import { writeFileSync } from 'node:fs';

const outFile = process.argv[2];
if (!outFile) { console.error('usage: node searx_discover3.mjs <out.json>'); process.exit(1); }

const UPS = ['阿茶诡话', '王生诡秘录', '爱讲故事的劳伦斯', '离离原上草'];
const queries = [
  '阿茶诡话 bilibili',
  '阿茶诡话 天涯神贴',
  '阿茶诡话 讲故事',
  '王生诡秘录 bilibili',
  '王生诡秘录 重庆通远门',
  '王生诡秘录 都市怪谈',
  '爱讲故事的劳伦斯 bilibili',
  '爱讲故事的劳伦斯 夜谈',
  '劳伦斯 宁波都市传说 bilibili',
  '离离原上草 bilibili UP',
  '离离原上草 讲故事 恐怖',
  'site:bilibili.com 离离原上草',
];

const seen = new Map();
for (const q of queries) {
  const url = 'http://localhost:18080/search?q=' + encodeURIComponent(q) + '&format=json';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) { console.log('Q_FAIL', q, r.status); continue; }
    const j = await r.json();
    let n = 0;
    for (const it of j.results || []) {
      const u = it.url || '';
      const m = u.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/);
      if (!m) continue;
      const bv = m[1];
      const title = (it.title || '').replace(/<[^>]+>/g, '').trim();
      const ctext = (it.content || '').replace(/<[^>]+>/g, '').trim();
      if (seen.has(bv)) { seen.get(bv).queries.push(q); continue; }
      seen.set(bv, { bv, title, content: ctext.slice(0, 160), published: it.published || '', queries: [q] });
      n++;
    }
    console.log('Q_OK', q, 'new_bv=' + n, 'results=' + (j.results || []).length);
  } catch (e) {
    console.log('Q_ERR', q, String(e).slice(0, 120));
  }
  await new Promise(res => setTimeout(res, 1500));
}

const arr = [...seen.values()];
for (const it of arr) {
  it.up_hint = UPS.find(up => (it.title + it.content).includes(up)) || '';
}
const matches = arr.filter(x => x.up_hint);
const rest = arr.filter(x => !x.up_hint);
writeFileSync(outFile, JSON.stringify({ matches, rest_count: rest.length, rest: rest.map(x => ({ bv: x.bv, title: x.title })) }, null, 2), 'utf8');
console.log('DONE unique_bv=' + arr.length, 'up_matches=' + matches.length, '-> ' + outFile);
