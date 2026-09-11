// 补扫 v3：imagelinks（fileusage）反查 + 5 次退避重试 + 状态透明
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache');
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0 (local research snapshot)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params, tag) {
  const url = B + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  let last = '';
  for (let a = 1; a <= 5; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 200) return await res.json();
      last = 'HTTP ' + res.status;
    } catch (e) { last = e.message; }
    console.log('  [' + tag + '] attempt ' + a + ' failed: ' + last);
    await sleep(900 * a);
  }
  return { error: { code: 'network', info: last } };
}
const alnum = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function extractAbility(wt) {
  const m = String(wt).match(/==\s*角色能力\s*==\n?([\s\S]*?)(?=\n==[^=]|$)/);
  if (!m) return null;
  const b = m[1].match(/'''([^']+)'''/);
  const txt = (b ? b[1] : m[1].split('\n').find(l => l.trim()))
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2').replace(/'''?/g, '').trim();
  return txt || null;
}
(async () => {
  const files = fs.readdirSync(cache).filter(f => f.endsWith('.json'));
  const missing = [];
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));
    if (!rec.name_zh) missing.push({ rec, file: f });
  }
  console.log('missing:', missing.map(x => x.rec.id).join(','));
  for (const { rec, file } of missing) {
    const id = rec.id;
    // 文件名大小写：用之前 allimages 的真实文件名（首字母大写）
    const fname = id.charAt(0).toUpperCase() + id.slice(1) + '.png';
    console.log('--- imagelinks route for', id, '(', rec.name_en, ') File:' + fname);
    const il = await api({ action: 'query', list: 'imagelinks', iltitle: 'File:' + fname, illimit: '20', ilnamespace: '0' }, id);
    await sleep(620);
    const pages = ((il.query && il.query.imagelinks && il.query.imagelinks[0] && il.query.imagelinks[0].pages) || []).map(p => p.title)
      .filter(t => /[\u4e00-\u9fa5]/.test(t) && !['合集', '合辑', '规则', '《', '·', '【'].some(b => t.includes(b)));
    console.log('  using pages:', JSON.stringify(pages));
    if (!pages.length) { console.log('  => no file usage; missing'); continue; }
    pages.sort((a, b) => a.length - b.length);
    let done = false;
    for (const pg of pages) {
      const p = await api({ action: 'parse', page: pg, prop: 'wikitext' }, id);
      await sleep(620);
      if (!p.parse || !p.parse.wikitext) continue;
      const wt = p.parse.wikitext;
      if (!/角色能力/.test(wt)) { console.log('  page', pg, 'no 角色能力 section, skip'); continue; }
      rec.name_zh = p.parse.title; rec.page = pg; rec.ability_zh = extractAbility(wt);
      rec.file_verified = alnum(wt).includes(alnum(id) + 'png');
      rec.retry_route = 'imagelinks:' + fname;
      fs.writeFileSync(path.join(cache, file), JSON.stringify(rec, null, 1), 'utf8');
      console.log('  => MAPPED', id, '->', rec.name_zh, '| ability:', rec.ability_zh ? 'yes' : 'no', '| verified:', rec.file_verified);
      done = true; break;
    }
    if (!done) console.log('  => pages parsed but none accepted');
  }
  const still = [];
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));
    if (!rec.name_zh) still.push(rec.id + '(' + rec.name_en + ')');
  }
  console.log('FINAL MISSING:', still.length ? still.join(', ') : '(none)');
})();
