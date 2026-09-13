'use strict';
// 一次性抽检构造器（只读 p1a.db）——按 design §4.2.1 细则 B/D 抽样 + 可机检段
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'), { readOnly: true });
const all = (s) => db.prepare(s).all();
const isBF = (s) => String(s || '').indexOf('【backfill】') >= 0;
function parseB(n) { if (!n) return null; let m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(n); if (m) return parseFloat(m[1]) / 100; m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(n); if (m) { const v = parseFloat(m[1]); return v > 1 ? v / 100 : v; } m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(n); if (m) return parseFloat(m[1]) / 100; return null; }
function minusOneDay(ds) { const t = new Date(String(ds) + 'T00:00:00Z').getTime(); return isNaN(t) ? null : new Date(t - 86400000).toISOString().slice(0, 10); }
const rows = all("SELECT p.id, p.layer, p.created_at, p.matures_at, p.statement, p.tautology, "
  + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) rj, "
  + "(SELECT json_extract(e.value,'$.resolve.date') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.date') IS NOT NULL LIMIT 1) rd, "
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) brn, "
  + "(SELECT json_extract(e.value,'$.slug') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.slug') IS NOT NULL LIMIT 1) slug "
  + "FROM predictions p WHERE p.g2_regime='R4'");
const pool = [];
for (const r of rows) {
  const bf = isBF(r.statement);
  const hasMat = r.matures_at !== null && r.matures_at !== undefined && String(r.matures_at) !== '';
  if (!r.rd) continue;
  let cutoff;
  if (bf) { if (!hasMat) continue; cutoff = minusOneDay(r.matures_at); } else cutoff = String(r.created_at).slice(0, 19);
  if (!(String(cutoff) < String(r.rd))) continue;
  if (Number(r.tautology) === 1) continue;
  let rj = null; try { rj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rj = null; }
  const h = hasMat ? (new Date(String(r.matures_at) + 'T00:00:00Z') - new Date(String(r.created_at).replace(' ', 'T') + 'Z')) / 86400000 : null;
  const bucket = h === null ? 'unknown' : (h < 0 ? 'past' : (h <= 7 ? 'short' : (h <= 30 ? 'mid' : 'long')));
  pool.push({ id: r.id, layer: r.layer, bucket: bucket, backfill: bf, cutoff: cutoff, rd: r.rd, rj: rj, b: parseB(r.brn), slug: r.slug, statement: r.statement });
}
const slugCount = {}; for (const p of pool) if (p.slug) slugCount[p.slug] = (slugCount[p.slug] || 0) + 1;
// --- 分层比例分配（最大余数法，各层 min 1；long 桶每层 >=ceil(0.1N)） ---
const stratumKey = (p) => p.layer + '|' + p.bucket;
const strata = {};
for (const p of pool) { const k = stratumKey(p); (strata[k] = strata[k] || []).push(p); }
const TARGET = Math.round(pool.length * 0.10);
const alloc = {};
let sum = 0;
for (const k of Object.keys(strata)) { const q = 0.1 * strata[k].length; let n = Math.max(1, Math.floor(q)); alloc[k] = { n: n, q: q, rem: q - Math.floor(q) }; sum += n; }
// long 桶保底 ceil
for (const k of Object.keys(strata)) if (k.endsWith('|long')) { const need = Math.max(1, Math.ceil(0.1 * strata[k].length)); if (alloc[k].n < need) { sum += need - alloc[k].n; alloc[k].n = need; } }
const order = Object.keys(alloc).sort((a, b) => alloc[b].rem - alloc[a].rem || a.localeCompare(b));
let i = 0;
while (sum < TARGET) { const k = order[i % order.length]; if (alloc[k].n < strata[k].length) { alloc[k].n++; sum++; } i++; if (i > 500) break; }
while (sum > TARGET) { const k = order.slice().reverse().find((x) => alloc[x].n > 1); if (!k) break; alloc[k].n--; sum--; }
// --- 抽样（LCG 987654321，稳定 id 序 + Fisher-Yates） ---
let seed = 987654321;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
const sample = [];
for (const k of Object.keys(strata).sort()) {
  const arr = strata[k].slice().sort((a, b) => a.id - b.id);
  for (let j = arr.length - 1; j > 0; j--) { const t = Math.floor(rnd() * (j + 1)); const tmp = arr[j]; arr[j] = arr[t]; arr[t] = tmp; }
  for (const p of arr.slice(0, alloc[k].n)) sample.push(p);
}
sample.sort((a, b) => a.id - b.id);
// --- 契约表：已注册 kind（从 corpus-resolve.cjs 源码抽取）+ 逐 kind required keys（全 R4 行观测键交集）---
const resolveSrc = fs.readFileSync(path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve.cjs'), 'utf8');
const registered = new Set();
const addName = (n) => { if (n && n[0] !== '_') registered.add(n); };
for (const line of resolveSrc.split(/\r?\n/)) {
  let mm = /^\s*async\s+([a-z0-9_]+)\s*\(r\)\s*\{/.exec(line); if (mm) addName(mm[1]);
  mm = /^\s*([a-z0-9_]+)\s*\(r\)\s*\{/.exec(line); if (mm) addName(mm[1]);
  mm = /^\s*([a-z0-9_]+)\s*:\s*async\s/.exec(line); if (mm) addName(mm[1]);
  mm = /^\s*([a-z0-9_]+)\s*:\s*function\s*\(/.exec(line); if (mm) addName(mm[1]);
  mm = /^\s*([a-z0-9_]+)\s*:\s*RESOLVERS\./.exec(line); if (mm) addName(mm[1]);
}
const reqTable = {};
for (const r of rows) {
  let k = null, j = null;
  try { const rj0 = r.rj ? JSON.parse(r.rj) : null; if (rj0) { k = rj0.kind; j = rj0; } } catch (e) {}
  if (!k) continue;
  const ks = Object.keys(j);
  const t = reqTable[k] = reqTable[k] || { n: 0, keys: null };
  t.n++; t.keys = t.keys === null ? new Set(ks) : new Set([...t.keys].filter((x) => ks.includes(x)));
}
for (const k of Object.keys(reqTable)) reqTable[k] = { n: reqTable[k].n, required: [...reqTable[k].keys].sort() };

// --- 可机检段（按已注册 kind 的契约；未注册 kind 退回通用判据并标注）---
const TARGET_KEYS = ['url', 'url_template', 'field', 'threshold', 'threshold_c', 'issue', 'series', 'symbol', 'station', 'article', 'country', 'type', 'pair', 'fuel', 'site', 'base', 'lat', 'quote'];
for (const p of sample) {
  const rj = p.rj || {};
  const has = (kk) => rj[kk] !== undefined && rj[kk] !== null && rj[kk] !== '';
  const targetFields = TARGET_KEYS.filter(has);
  const kindName = rj.kind || null;
  const isRegistered = kindName ? registered.has(kindName) : false;
  const req = kindName && reqTable[kindName] ? reqTable[kindName].required : null;
  const missing = req ? req.filter((kk) => !has(kk)) : [];
  const contractOk = req ? missing.length === 0 : (targetFields.length > 0 && has('kind') && has('cmp'));
  p.m = {
    resolve_present: !!p.rj, kind_ok: has('kind'), date: has('date'), cmp: has('cmp'),
    url: has('url') || has('url_template'), field: has('field'), threshold: has('threshold') || has('threshold_c'),
    target_fields: targetFields,
    strict_four: (has('url') || has('url_template')) && has('field') && (has('threshold') || has('threshold_c')) && has('cmp'),
    base_rate: p.b, base_in_band: p.b !== null && p.b > 0.15 && p.b < 0.85,
    coverage_gap_4: p.b === null,
    slug_present: !!p.slug, slug_unique: !p.slug || slugCount[p.slug] === 1,
    cutoff_ok: true, tautology_ok: true,
    registered_kind: isRegistered, unregistered_kind: !!kindName && !isRegistered,
    required_keys: req, missing_required: missing, contract_ok: contractOk,
    contract_basis: req ? 'required-keys（全 R4 行观测键交集）' : 'generic（无逐 kind 表）'
  };
  p.m.pass = p.m.resolve_present && p.m.kind_ok && p.m.cmp && p.m.slug_unique && p.m.contract_ok;
}
const lines = sample.map((p) => [p.id, p.layer, p.bucket, p.rj && p.rj.kind, p.m.date ? p.rd : '', p.b === null ? '' : p.b.toFixed(4), p.m.pass ? 'M-PASS' : 'M-REJECT', p.m.strict_four ? 'S4' : '-', (p.m.registered_kind ? 'REG' : 'UNREG'), (p.m.required_keys || []).join(','), (p.m.missing_required || []).join(','), (p.statement || '').replace(/\s+/g, ' ').slice(0, 150), JSON.stringify(p.rj).slice(0, 130)].join('\t'));
fs.writeFileSync(path.join(__dirname, 'audit-review.tsv'), 'id\tlayer\tbucket\tkind\tdate\tb\tmachine\tstrict4\tkind_status\trequired_keys\tmissing\tstatement\tresolve\n' + lines.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(__dirname, 'audit-machine.json'), JSON.stringify({ pool_n: pool.length, target: TARGET, alloc: alloc, sample_ids: sample.map((p) => p.id), registered_kinds: [...registered].sort(), required_keys_table: reqTable, machine: sample.map((p) => ({ id: p.id, layer: p.layer, bucket: p.bucket, ...p.m, kind: p.rj && p.rj.kind })) }, null, 1), 'utf8');
console.log('pool_n=' + pool.length + ' target=' + TARGET + ' sample_n=' + sample.length);
console.log('alloc=' + JSON.stringify(Object.keys(alloc).sort().map((k) => [k, alloc[k].n])));
console.log('machine_pass=' + sample.filter((p) => p.m.pass).length + ' machine_reject=' + sample.filter((p) => !p.m.pass).length + ' strict4=' + sample.filter((p) => p.m.strict_four).length + ' unregistered=' + sample.filter((p) => p.m.unregistered_kind).length);
console.log('long_in_sample=' + sample.filter((p) => p.bucket === 'long').length + ' ' + JSON.stringify(sample.filter((p) => p.bucket === 'long').map((p) => p.id)));
console.log('coverage_gap_4=' + sample.filter((p) => p.m.coverage_gap_4).length + ' ids=' + JSON.stringify(sample.filter((p) => p.m.coverage_gap_4).map((p) => p.id)));
console.log('registered_kinds=' + registered.size + ' | req_table_kinds=' + Object.keys(reqTable).length);
const rej = sample.filter((p) => !p.m.pass);
console.log('reject_reasons=' + JSON.stringify(rej.map((p) => ({ id: p.id, kind: p.rj && p.rj.kind, missing: p.m.missing_required, reg: p.m.registered_kind }))));
db.close();