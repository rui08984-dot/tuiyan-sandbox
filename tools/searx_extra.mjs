// t3p extra discovery: gap-filling queries
import { writeFileSync } from 'node:fs';
const outFile = process.argv[2];
const UPS = ['阿茶诡话', '离离原上草'];
const queries = [
  '阿茶诡话 中旅大厦 命案',
  '阿茶诡话 租房 下',
  '阿茶诡话 恐怖经历 UP主',
  'bilibili 阿茶诡话 合集',
  '离离原上草 灵异',
  '离离原上草 怪谈 UP',
  '离离原上草 鬼故事 讲述',
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
      const m = (it.url || '').match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/);
      if (!m) continue;
      const bv = m[1];
      const title = (it.title || '').replace(/<[^>]+>/g, '').trim();
      const ctext = (it.content || '').replace(/<[^>]+>/g, '').trim();
      if (seen.has(bv)) { seen.get(bv).queries.push(q); continue; }
      seen.set(bv, { bv, title, content: ctext.slice(0, 160), queries: [q] });
      n++;
    }
    console.log('Q_OK', q, 'new_bv=' + n, 'results=' + (j.results || []).length);
  } catch (e) { console.log('Q_ERR', q, String(e).slice(0, 120)); }
  await new Promise(res => setTimeout(res, 1500));
}
const arr = [...seen.values()];
for (const it of arr) it.up_hint = UPS.find(up => (it.title + it.content).includes(up)) || '';
writeFileSync(outFile, JSON.stringify(arr, null, 2), 'utf8');
console.log('DONE bv=' + arr.length + ' matches=' + arr.filter(x => x.up_hint).length + ' -> ' + outFile);
