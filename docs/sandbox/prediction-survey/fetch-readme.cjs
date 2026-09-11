#!/usr/bin/env node
// 抓取 GitHub 仓库 README 并按关键词过滤：node fetch-readme.cjs slug [keyword] [maxlines]
const H = { 'User-Agent': 'dsh-survey' };
async function main() {
  const [, , slug, kw, maxl] = process.argv;
  const cap = parseInt(maxl || '28', 10);
  const strip = (l) => l.replace(/[#*>|]/g, '').trim().slice(0, 130);
  try {
    const r = await fetch('https://api.github.com/repos/' + slug + '/readme', { headers: H });
    if (!r.ok) { console.log('README_FAIL ' + slug + ' http=' + r.status); return; }
    const j = await r.json();
    const txt = Buffer.from(j.content, 'base64').toString('utf8');
    let lines = txt.split('\n').filter(l => l.trim());
    if (kw) lines = lines.filter(l => l.toLowerCase().includes(kw.toLowerCase()));
    console.log('=== ' + slug + ' (' + (kw ? 'kw=' + kw : 'head') + ') ===');
    console.log(lines.slice(0, cap).map(strip).join('\n'));
  } catch (e) { console.log('ERR ' + slug + ': ' + e.message); }
}
main();
