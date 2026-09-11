// B站官方中文 Wiki 抓取：130 角色译名+中文能力（限速≥600ms/请求，缓存可续跑）
// 用法: node fetch-zh.cjs  产物: zh-cache/{id}.json
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache');
fs.mkdirSync(cache, { recursive: true });
const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0 (local research snapshot)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params) {
  const url = B + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status !== 200) { if (attempt === 3) return { status: res.status, data: null }; await sleep(800); continue; }
      return { status: 200, data: await res.json() };
    } catch (e) { if (attempt === 3) return { status: -1, data: null, err: e.message }; await sleep(800); }
  }
}
const alnum = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function pickTitle(hits) {
  const bad = ['合集', '合辑', '规则', '《', '·', '【', '"', '"'];
  return hits.map(h => h.title).filter(t => /[\u4e00-\u9fa5]/.test(t) && !bad.some(b => t.includes(b))).sort((a, b) => a.length - b.length);
}
function extractAbility(wt) {
  const m = String(wt).match(/==\s*角色能力\s*==\n?([\s\S]*?)(?=\n==[^=]|$)/);
  if (!m) return null;
  const b = m[1].match(/'''([^']+)'''/);
  const txt = (b ? b[1] : m[1].split('\n').find(l => l.trim()))
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2').replace(/'''?/g, '').trim();
  return txt || null;
}
(async () => {
  let done = 0, ok = 0, miss = [];
  for (const r of roles) {
    const cf = path.join(cache, r.id + '.json');
    if (fs.existsSync(cf)) { const c = JSON.parse(fs.readFileSync(cf, 'utf8')); if (c.name_zh) ok++; done++; continue; }
    const s = await api({ action: 'query', list: 'search', srsearch: r.name, srlimit: '6' });
    await sleep(620);
    const hits = (s.data && s.data.query && s.data.query.search) || [];
    const titles = pickTitle(hits);
    let rec = { id: r.id, name_en: r.name, search_status: s.status, hit_titles: titles.slice(0, 3), name_zh: null, ability_zh: null, page: null, file_verified: false };
    for (const t of titles.slice(0, 3)) {
      const p = await api({ action: 'parse', page: t, prop: 'wikitext' });
      await sleep(620);
      if (p.status !== 200 || !p.data || !p.data.parse) { rec.page_status = p.status; continue; }
      const wt = p.data.parse.wikitext || '';
      if (alnum(wt).includes(alnum(r.id) + 'png')) rec.file_verified = true;
      rec.name_zh = p.data.parse.title; rec.page = t; rec.ability_zh = extractAbility(wt);
      break;
    }
    if (!rec.name_zh && titles.length) { rec.name_zh = null; rec.note = '候选页均未通过 File:{id}.png 验证或解析失败'; }
    if (rec.name_zh) { ok++; fs.writeFileSync(cf, JSON.stringify(rec, null, 1), 'utf8'); }
    else { miss.push(r.id + '(' + r.name + ') hits=[' + titles.join(',') + ']'); fs.writeFileSync(cf, JSON.stringify(rec, null, 1), 'utf8'); }
    done++;
    if (done % 20 === 0) console.log('progress', done + '/' + roles.length, 'ok=' + ok);
  }
  console.log('DONE total=' + done, 'mapped=' + ok, 'missing=' + (roles.length - ok));
  miss.forEach(m => console.log('MISS', m));
})();
