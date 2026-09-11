// 缺页补抓：File 命名空间反查 + backlinks + opensearch 兜底（仅对 zh-cache 中无 name_zh 的条目）
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
    } catch (e) { if (a === 3) return { status: -1, data: null, err: e.message }; await sleep(800); }
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
const isCleanTitle = t => /[\u4e00-\u9fa5]/.test(t) && !['合集', '合辑', '规则', '《', '·', '【'].some(b => t.includes(b));
(async () => {
  const files = fs.readdirSync(cache).filter(f => f.endsWith('.json'));
  const missing = [];
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));
    if (rec.name_zh) continue;
    missing.push(rec.id);
    const id = rec.id;
    console.log('RETRY', id, '(' + rec.name_en + ')');
    let page = null, route = null;
    // 路线A: File 命名空间搜索 -> backlinks
    const fsr = await api({ action: 'query', list: 'search', srsearch: id + '.png', srnamespace: '6', srlimit: '5' });
    await sleep(620);
    const fileHits = ((fsr.data && fsr.data.query && fsr.data.query.search) || []).map(h => h.title);
    console.log('  file hits:', JSON.stringify(fileHits));
    for (const ft of fileHits) {
      const bl = await api({ action: 'query', list: 'backlinks', bltitle: ft, blnamespace: '0', bllimit: '10' });
      await sleep(620);
      const links = ((bl.data && bl.data.query && bl.data.query.backlinks) || []).map(x => x.title).filter(isCleanTitle);
      if (links.length) { page = links[0]; route = 'file-backlinks:' + ft; break; }
    }
    // 路线B: allimages 前缀 -> backlinks
    if (!page) {
      const ai = await api({ action: 'query', list: 'allimages', aiprefix: id, ailimit: '10' });
      await sleep(620);
      const imgs = ((ai.data && ai.data.query && ai.data.query.allimages) || []).map(x => 'File:' + x.name);
      console.log('  allimages:', JSON.stringify(imgs));
      for (const ft of imgs) {
        const bl = await api({ action: 'query', list: 'backlinks', bltitle: ft, blnamespace: '0', bllimit: '10' });
        await sleep(620);
        const links = ((bl.data && bl.data.query && bl.data.query.backlinks) || []).map(x => x.title).filter(isCleanTitle);
        if (links.length) { page = links[0]; route = 'allimages-backlinks:' + ft; break; }
      }
    }
    // 路线C: opensearch 标题建议
    if (!page) {
      const os = await api({ action: 'opensearch', search: rec.name_en, limit: '5' });
      await sleep(620);
      const osTitles = ((os.data && os.data[1]) || []).filter(isCleanTitle);
      console.log('  opensearch:', JSON.stringify(osTitles));
      if (osTitles.length) { page = osTitles[0]; route = 'opensearch'; }
    }
    if (!page) { console.log('  => STILL MISSING'); continue; }
    const p = await api({ action: 'parse', page, prop: 'wikitext' });
    await sleep(620);
    if (p.status !== 200 || !p.data || !p.data.parse) { console.log('  => parse fail', p.status); continue; }
    const wt = p.data.parse.wikitext || '';
    rec.name_zh = p.data.parse.title; rec.page = page; rec.ability_zh = extractAbility(wt);
    rec.file_verified = alnum(wt).includes(alnum(id) + 'png');
    rec.retry_route = route;
    fs.writeFileSync(path.join(cache, f), JSON.stringify(rec, null, 1), 'utf8');
    console.log('  => MAPPED', rec.name_zh, '| verified:', rec.file_verified, '| route:', route);
  }
  console.log('RETRY DONE, retried:', missing.length ? missing.join(',') : '(none)');
})();
