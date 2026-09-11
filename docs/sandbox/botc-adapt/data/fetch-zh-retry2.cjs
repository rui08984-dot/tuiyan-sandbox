// 最终补扫：剧本页链接全清单 × File 锚点（search 不可靠，改确定性路线）
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache');
const B = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 botc-adapt-datafetch/1.0 (local research snapshot)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params) {
  const url = B + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  for (let a = 1; a <= 3; a++) {
    try { const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status !== 200) { if (a === 3) return { status: res.status, data: null }; await sleep(800); continue; }
      return { status: 200, data: await res.json() };
    } catch (e) { if (a === 3) return { status: -1, data: null }; await sleep(800); }
  }
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
function filesIn(wt) {
  const out = [];
  const re = /\[\[(?:File|文件|Image):([^\]|]+)/gi; let m;
  while ((m = re.exec(String(wt)))) out.push(m[1]);
  return out;
}
(async () => {
  const recs = {};
  for (const f of fs.readdirSync(cache).filter(f => f.endsWith('.json'))) {
    const rec = JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));
    recs[rec.id] = { rec, file: f };
  }
  const missing = Object.values(recs).filter(x => !x.rec.name_zh).map(x => x.rec.id);
  const mappedPages = new Set(Object.values(recs).filter(x => x.rec.name_zh).map(x => x.rec.page));
  console.log('missing before sweep:', missing.join(','));

  // 1) 剧本页 links（TB=暗流涌动 已知；BMR/SNV 用 allpages 找页名）
  const scriptPages = ['暗流涌动', '旅行者'];
  let apfrom = '';
  for (let i = 0; i < 15; i++) {
    const ap = await api({ action: 'query', list: 'allpages', aplimit: '500', apfrom });
    if (!ap.data || !ap.data.query) break;
    for (const p of ap.data.query.allpages || []) {
      if (/灾祸滋生/.test(p.title) || /煽动叛乱/.test(p.title)) scriptPages.push(p.title);
    }
    const cont = ap.data.continue && ap.data.continue.apfrom;
    if (!cont) break; apfrom = cont; await sleep(620);
  }
  console.log('script pages found:', [...new Set(scriptPages)].join(' | '));
  const candidates = new Set();
  for (const sp of [...new Set(scriptPages)]) {
    const lk = await api({ action: 'parse', page: sp, prop: 'links', pllimit: '250' });
    await sleep(620);
    for (const l of ((lk.data && lk.data.parse && lk.data.parse.links) || [])) {
      if (l.ns === 0 && l.title !== sp && !mappedPages.has(l.title)) candidates.add(l.title);
    }
  }
  console.log('candidate pages:', candidates.size);

  // 2) 逐候选页解析，按 File 锚点匹配缺失 id（要求含「角色能力」段）
  const missingAl = new Map(missing.map(id => [alnum(id), id]));
  for (const cp of candidates) {
    if (missingAl.size === 0) break;
    const p = await api({ action: 'parse', page: cp, prop: 'wikitext' });
    await sleep(620);
    if (!p.data || !p.data.parse) continue;
    const wt = p.data.parse.wikitext || '';
    if (!/角色能力/.test(wt)) continue;
    const hitIds = new Set();
    for (const fn of filesIn(wt)) {
      const base = alnum(fn.replace(/\.png$/i, '').split(/[\s_-]/)[0]);
      if (missingAl.has(base)) hitIds.add(missingAl.get(base));
    }
    if (!hitIds.size) continue;
    const ability = extractAbility(wt);
    for (const id of hitIds) {
      const x = recs[id];
      x.rec.name_zh = cp; x.rec.page = cp; x.rec.ability_zh = ability;
      x.rec.file_verified = alnum(wt).includes(alnum(id) + 'png');
      x.rec.retry_route = 'script-page-sweep';
      fs.writeFileSync(path.join(cache, x.file), JSON.stringify(x.rec, null, 1), 'utf8');
      missingAl.delete(alnum(id));
      console.log('MAPPED', id, '->', cp, '| verified:', x.rec.file_verified);
    }
  }
  const still = Object.values(recs).filter(x => !x.rec.name_zh).map(x => x.rec.id + '(' + x.rec.name_en + ')');
  console.log('STILL MISSING:', still.length ? still.join(', ') : '(none)');
})();
