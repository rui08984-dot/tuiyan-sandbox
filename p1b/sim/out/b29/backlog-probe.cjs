// 针对积压 14 条做定点探测：直接调解析器逻辑，看每条到底卡在哪
const path = require('path');
const ROOT = 'E:/music player';
const D = require(path.join(ROOT, 'p1a-terminal/node_modules/better-sqlite3'));
const db = new D(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readonly: true });

const ids = [1761, 1765, 1769, 1785, 1787, 1789, 1791, 1793, 453, 454, 731, 732, 817, 829];
const FETCH_MS = 25000;
async function getJson(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const res = await fetch(url, { signal: ac.signal }); if (!res.ok) throw new Error('HTTP ' + res.status); return await res.json(); } finally { clearTimeout(t); }
}
const subst = (tpl, r) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => r[k] === undefined ? '' : r[k]);

(async () => {
  const out = [];
  for (const id of ids) {
    const row = db.prepare("SELECT p.id, p.matures_at, json_extract(e.value,'$.resolve') rj FROM predictions p, json_each(p.evidence_json) e WHERE p.id=? AND json_extract(e.value,'$.resolve.kind') IS NOT NULL LIMIT 1").get(id);
    if (!row) { out.push('id=' + id + ' 无 resolve'); continue; }
    const r = JSON.parse(row.rj);
    let verdict = '';
    try {
      if (r.kind === 'energycharts_daily_mean') {
        const url = subst(r.url_template || r.url, r);
        const j = await getJson(url);
        const ts = j.unix_seconds || [];
        const tp = (j.production_types || []).filter((x) => x.name === r.type)[0];
        if (!tp) { verdict = 'PENDING: 无类型 ' + r.type + '（API 返回类型数=' + (j.production_types || []).length + '）'; }
        else {
          let sum = 0, n = 0;
          ts.forEach((sec, i) => { if (new Date(sec * 1000).toISOString().slice(0, 10) !== r.date) return; const v = tp.data[i]; if (v === null || v === undefined || !isFinite(v)) return; sum += Number(v); n++; });
          verdict = 'API 该日点数 n=' + n + (n < 80 ? ' ⇒ PENDING(<80)' : ' ⇒ 可结 mean=' + (sum / n).toFixed(4)) + ' | ts范围=' + (ts.length ? new Date(ts[0] * 1000).toISOString().slice(0, 10) + '~' + new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : '(空)');
        }
      } else if (r.kind === 'cwl_ssq_red_contains' || r.kind === 'cwl_ssq_blue_odd') {
        const j = await getJson('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30');
        const hit = (j.result || []).find((d) => d.code === r.issue);
        const codes = (j.result || []).map((d) => d.code).slice(0, 5);
        verdict = hit ? ('可结：red=' + hit.red + ' blue=' + hit.blue) : ('PENDING: 未开奖（API 最新 5 期=' + codes.join(',') + '）');
      } else verdict = '未知 kind';
    } catch (e) { verdict = 'ERROR: ' + (e && e.message); }
    out.push('id=' + String(id).padEnd(5) + ' matures=' + row.matures_at + ' kind=' + r.kind.padEnd(26) + ' -> ' + verdict);
    console.log(out[out.length - 1]);
  }
  require('fs').writeFileSync(path.join(ROOT, '.tmp/backlog-probe.txt'), out.join('\n'), 'utf8');
  db.close();
})();
