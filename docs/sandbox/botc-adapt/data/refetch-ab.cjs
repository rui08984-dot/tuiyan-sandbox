// 能力文本重取：整节提取 + 粉丝页污染判定（出现剧本/分类特征）
const fs = require('fs'), path = require('path');
const dir = __dirname, pc = path.join(dir, 'ability-cache'), cache = path.join(dir, 'zh-cache');
const BG = 'https://wiki.biligame.com/bloodontheclocktower/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HDR = { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://wiki.biligame.com/bloodontheclocktower/' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params, tag) {
  const url = BG + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  let last = '';
  for (let a = 1; a <= 5; a++) {
    try { const res = await fetch(url, { headers: HDR });
      if (res.status === 200) return await res.json(); last = 'HTTP ' + res.status;
    } catch (e) { last = e.message; }
    console.log('  [' + tag + '] attempt ' + a + ': ' + last);
    await sleep(700 * a);
  }
  return null;
}
const alnum = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function clean(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractFull(wt) {
  const m = String(wt).match(/==\s*角色能力\s*==\n?([\s\S]*?)(?=\n==[^=]|$)/);
  if (!m) return null;
  const txt = clean(m[1]);
  return txt || null;
}
function fanMarkers(wt) {
  const appears = (String(wt).match(/出现剧本[：:]\s*([^\n]+)/) || [])[1] || null;
  const hasFanCats = /(分类:山海百绘|分类:《|分类:《灯火管制》|华灯|原创)/.test(String(wt));
  return { appears_in: appears ? clean(appears).slice(0, 40) : null, fan_like: hasFanCats };
}
(async () => {
  const roles = JSON.parse(fs.readFileSync(path.join(dir, 'roles-townsquare.json'), 'utf8'));
  const summaries = [];
  for (const role of roles) {
    const rec = JSON.parse(fs.readFileSync(path.join(cache, role.id + '.json'), 'utf8'));
    if (!rec.name_zh) { summaries.push(role.id + ': no page'); continue; }
    const p = await api({ action: 'parse', page: rec.name_zh, prop: 'wikitext' }, role.id);
    await sleep(650);
    if (!p || !p.parse) { console.log(role.id, 'parse fail'); continue; }
    const wt = p.parse.wikitext || '';
    const { appears_in, fan_like } = fanMarkers(wt);
    rec.ability_zh = extractFull(wt);
    rec.appears_in = appears_in; rec.fan_like = fan_like;
    fs.writeFileSync(path.join(cache, role.id + '.json'), JSON.stringify(rec, null, 1), 'utf8');
    const pf = path.join(pc, alnum(role.id) + '.json');
    fs.writeFileSync(pf, JSON.stringify({ id: role.id, page: rec.name_zh, len: wt.length, ability_zh: rec.ability_zh, appears_in, fan_like }, null, 1), 'utf8');
    summaries.push([role.id, rec.name_zh, fan_like ? 'FAN?' : 'official', appears_in ? '剧本=' + appears_in : '', rec.ability_zh ? rec.ability_zh.slice(0, 18) : 'NO_ABILITY'].join(' | '));
  }
  console.log('\n=== PAGE NATURE SUMMARY ===');
  summaries.forEach(s => console.log(s));
  const fans = summaries.filter(s => s.includes('FAN?')).length;
  console.log('\nfan_like count:', fans);
})();
