#!/usr/bin/env node
// GitHub repo 事实核验脚本（调研用）：node gh-lookup.cjs lookup slug1 slug2... | search "query"
// lookup -> GET /repos/{slug}: stars/language/license/desc/pushed_at
// search -> GET /search/repositories?q=...&sort=stars&per_page=6
const H = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-survey' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  const [, , mode, ...rest] = process.argv;
  try {
    if (mode === 'lookup') {
      for (const slug of rest) {
        const r = await fetch('https://api.github.com/repos/' + slug, { headers: H }).then(x => x.json());
        console.log(r.full_name ? [r.full_name, 'stars=' + r.stargazers_count, 'lang=' + r.language, 'lic=' + (r.license ? r.license.spdx_id : 'NONE'), 'pushed=' + (r.pushed_at || '').slice(0, 10), 'desc=' + (r.description || '').slice(0, 110)].join(' | ') : 'NOT_FOUND: ' + slug);
        await sleep(300);
      }
    } else if (mode === 'search') {
      const q = encodeURIComponent(rest.join(' '));
      const r = await fetch('https://api.github.com/search/repositories?q=' + q + '&sort=stars&per_page=6', { headers: H }).then(x => x.json());
      for (const it of (r.items || [])) console.log([it.full_name, 'stars=' + it.stargazers_count, 'lang=' + it.language, 'lic=' + (it.license ? it.license.spdx_id : 'NONE'), 'pushed=' + (it.pushed_at || '').slice(0, 10), 'desc=' + (it.description || '').slice(0, 110)].join(' | '));
      if (!r.items || !r.items.length) console.log('NO_RESULT q=' + decodeURIComponent(q));
    } else { console.log('usage: node gh-lookup.cjs lookup slug... | search "q"'); process.exit(1); }
  } catch (e) { console.log('ERR: ' + e.message); process.exit(1); }
}
main();
