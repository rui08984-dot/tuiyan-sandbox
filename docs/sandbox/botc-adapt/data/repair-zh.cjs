// 权威重映射：五张剧本/分类页 gallery File:{En}.png|link={CN} → id↔中文名 → 重拉能力
const fs = require('fs'), path = require('path');
const dir = __dirname, cache = path.join(dir, 'zh-cache'), pc = path.join(dir, 'ability-cache');
fs.mkdirSync(pc, { recursive: true });
const BG = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HDR = { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://wiki.biligame.com/bloodontheclocktower/' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params, tag) {
  const url = BG + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  let last = '';
  for (let a = 1; a <= 5; a++) {
    try { const res = await fetch(url, { headers: HDR });
      if (res.status === 200) return await res.json();
      last = 'HTTP ' + res.status;
    } catch (e) { last = e.message; }
    console.log('  [' + tag + '] attempt ' + a + ': ' + last);
    await sleep(700 * a);
  }
  return null;
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
  const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
  const byAl = new Map(roles.map(r => [alnum(r.id), r.id]));
  // 1) 五页 gallery → 权威映射
  const galleries = {};
  for (const pg of ['暗流涌动', '黯月初升', '梦殒春宵', '旅行者', '实验性角色']) {
    const p = await api({ action: 'parse', page: pg, prop: 'wikitext' }, pg);
    await sleep(650);
    galleries[pg] = p && p.parse ? (p.parse.wikitext || '') : '';
    console.log('gallery page', pg, 'len', galleries[pg].length);
  }
  const map = new Map(); // alnum(id) -> {cn, page, script}
  for (const [pg, wt] of Object.entries(galleries)) {
    const re = /(?:File|文件):([^|\]]+?\.png)\|link=([^|\]]+)\|\[\[([^\]]+)\]\]/gi;
    let m;
    while ((m = re.exec(wt))) {
      const al = alnum(m[1].replace(/\.png$/i, ''));
      if (byAl.has(al) && !map.has(al)) map.set(al, { cn: m[3].trim(), page: m[3].trim(), script: pg });
    }
    // 宽松变体：无 [[ ]] 仅有 link=
    const re2 = /(?:File|文件):([^|\]]+?\.png)\|link=([^|\]]+)\|/gi;
    while ((m = re2.exec(wt))) {
      const al = alnum(m[1].replace(/\.png$/i, ''));
      if (byAl.has(al) && !map.has(al)) map.set(al, { cn: m[2].trim(), page: m[2].trim(), script: pg });
    }
  }
  console.log('authoritative mapped:', map.size, '/ 130');
  // 2) 逐角色拉能力（按权威 CN 页名，页级缓存可续跑）
  const results = {};
  for (const role of roles) {
    const al = alnum(role.id);
    const a = map.get(al);
    if (!a) { results[role.id] = null; continue; }
    const pf = path.join(pc, al + '.json');
    if (fs.existsSync(pf)) { results[role.id] = JSON.parse(fs.readFileSync(pf, 'utf8')); continue; }
    const p = await api({ action: 'parse', page: a.page, prop: 'wikitext' }, role.id);
    await sleep(650);
    const wt = p && p.parse ? (p.parse.wikitext || '') : '';
    const rec = { id: role.id, name_en: role.name, name_zh: a.cn, page: a.page, script: a.script,
      ability_zh: extractAbility(wt), page_found: !!(p && p.parse), has_section: /角色能力/.test(wt) };
    fs.writeFileSync(pf, JSON.stringify(rec, null, 1), 'utf8');
    results[role.id] = rec;
  }
  // 3) 回写 zh-cache
  for (const role of roles) {
    const rec = results[role.id];
    const cf = path.join(cache, role.id + '.json');
    const old = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
    const out = { ...old, id: role.id, name_en: role.name };
    if (rec && rec.name_zh) Object.assign(out, rec, { file_verified: false, retry_route: 'script-gallery:' + rec.script });
    fs.writeFileSync(cf, JSON.stringify(out, null, 1), 'utf8');
  }
  const mappedN = Object.values(results).filter(Boolean).length;
  const noAb = Object.entries(results).filter(([, r]) => r && !r.ability_zh).map(([k]) => k);
  const unfound = Object.values(results).filter(r => r && !r.page_found).map(r => r.id);
  console.log('DONE mapped:', mappedN, '/ 130 | ability missing:', noAb.join(',') || '(none)');
  console.log('page_not_found:', unfound.join(',') || '(none)');
  const unGal = roles.filter(r => !results[r.id]).map(r => r.id + '(' + r.name + ')');
  console.log('no gallery entry:', unGal.join(', ') || '(none)');
})();
