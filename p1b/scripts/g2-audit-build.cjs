#!/usr/bin/env node
'use strict';
/*
 * ② 抽检清单 v2 构造器（批次 3 #6）——只读 p1a.db，零写库
 * 依据：design §4.2.1 细则 D + §4.2.3 修订 R4.2；专家会统一清单 #6(a)-(e)
 * 用法：
 *   node p1b/scripts/g2-audit-build.cjs --emit-review <tsv>          # 导留出集复核表（人工/代理语义段用）
 *   node p1b/scripts/g2-audit-build.cjs --holdout-sem <tsv> --out <json> [--text <txt>]
 * 契约表：p1b/sim/out/g2-contract-frozen-r4.json（按 resolver 源码人工冻结；禁观测交集）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT = arg('out', null);
const TEXT_OUT = arg('text', null);
const EMIT_REVIEW = arg('emit-review', null);
const HOLD_SEM = arg('holdout-sem', null);
const AUDIT_V1 = arg('prev', path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4.json'));
const CONTRACT = arg('contract', path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json'));
const CALIB_N_SEED = 987654321;
const HOLDOUT_N = 35;
const HOLDOUT_SEED = 987654322;
const USER_SPOT_REQUIRED = 10;

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true }); // 只读：禁写库
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
  pool.push({ id: r.id, layer: r.layer, bucket: bucket, backfill: bf, rd: r.rd, rj: rj, b: parseB(r.brn), slug: r.slug, statement: r.statement });
}
const slugCount = {}; for (const p of pool) if (p.slug) slugCount[p.slug] = (slugCount[p.slug] || 0) + 1;
const contractDoc = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
function contractOf(kind) { if (!kind) return null; if (contractDoc.contracts[kind]) return contractDoc.contracts[kind]; const al = contractDoc.aliases[kind]; if (al && contractDoc.contracts[al]) return contractDoc.contracts[al]; return null; }
function wilson(k, n, z) { z = z || 1.96; if (!n) return { k: k, n: n, rate: null, lb: null, ub: null }; const p = k / n; const d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return { k: k, n: n, rate: p, lb: Math.max(0, c - h), ub: Math.min(1, c + h) }; }

// ── 机器段：按冻结契约（禁观测交集）──
const TARGET_KEYS = ['url', 'url_template', 'field', 'threshold', 'threshold_c', 'issue', 'ball', 'series', 'series_code', 'symbol', 'station', 'site', 'article', 'country', 'type', 'pair', 'fuel', 'week', 'month', 'period', 'year', 'start', 'week_start', 'lat', 'repo', 'package', 'provider', 'base', 'quote', 'epiweek', 'region', 'field_name'];
function machineCheck(p) {
  const rj = p.rj || {};
  const has = (k) => rj[k] !== undefined && rj[k] !== null && rj[k] !== '';
  const kind = rj.kind || null;
  const c = contractOf(kind);
  const registered = !!c;
  const missing = c ? c.required.filter((k) => !has(k)) : [];
  const oneOfFail = c ? (c.one_of || []).filter((g) => !g.some(has)) : [];
  const targetAny = TARGET_KEYS.some(has);
  const contractOk = c ? (missing.length === 0 && oneOfFail.length === 0) : (has('kind') && has('cmp') && targetAny);
  return { kind: kind, registered: registered, src: c ? c.src : null, required: c ? c.required : null, one_of: c ? c.one_of : null,
    missing: missing, one_of_fail: oneOfFail, contract_ok: contractOk,
    basis: c ? 'frozen-contract（按 resolver 源码取数需求）' : 'generic（未注册 kind）',
    slug_unique: !p.slug || slugCount[p.slug] === 1, resolve_present: !!p.rj, coverage_gap_4: p.b === null,
    pass: !!p.rj && contractOk && (!p.slug || slugCount[p.slug] === 1) };
}

// ── 抽样：分层随机；②候选池=同一程序的产出（双轨统一）；seed/配额/命中率全披露 ──
function draw(base, target, seed, excludeIds) {
  const ex = new Set(excludeIds || []);
  const strata = {};
  for (const p of base) { if (ex.has(p.id)) continue; const k = p.layer + '|' + p.bucket; (strata[k] = strata[k] || []).push(p); }
  const alloc = {}; let sum = 0;
  for (const k of Object.keys(strata)) { const q = 0.10 * strata[k].length; const n = Math.max(1, Math.floor(q)); alloc[k] = { target: n, quota: Math.round(q * 1000) / 1000, rem: q - Math.floor(q) }; sum += n; }
  for (const k of Object.keys(strata)) if (k.endsWith('|long')) { const need = Math.max(1, Math.ceil(0.10 * strata[k].length)); if (alloc[k].target < need) { sum += need - alloc[k].target; alloc[k].target = need; } }
  const order = Object.keys(alloc).sort((a, b) => alloc[b].rem - alloc[a].rem || a.localeCompare(b));
  let i = 0;
  while (sum < target) { const k = order[i % order.length]; if (alloc[k].target < strata[k].length) { alloc[k].target++; sum++; } i++; if (i > 800) break; }
  while (sum > target) { const k = order.slice().reverse().find((x) => alloc[x].target > 1); if (!k) break; alloc[k].target--; sum--; }
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const hits = {}; const out = [];
  for (const k of Object.keys(strata).sort()) {
    const arr = strata[k].slice().sort((a, b) => a.id - b.id);
    for (let j = arr.length - 1; j > 0; j--) { const t = Math.floor(rnd() * (j + 1)); const tmp = arr[j]; arr[j] = arr[t]; arr[t] = tmp; }
    const take = arr.slice(0, alloc[k].target); hits[k] = take.length; for (const p of take) out.push(p);
  }
  out.sort((a, b) => a.id - b.id);
  const achieved = Object.keys(hits).reduce((a, k) => a + hits[k], 0);
  return { items: out, alloc: alloc, hits: hits, achieved: achieved, target: target, seed: seed, hit_rate: target ? achieved / target : null,
    procedure: '分层随机 layer×horizon；LCG(' + seed + ')；层内 id 升序 Fisher-Yates；每层 min 1；long 桶保底 ceil(10%)' };
}

const prevAudit = JSON.parse(fs.readFileSync(AUDIT_V1, 'utf8'));
const calibIds = (prevAudit.items || []).map((x) => x.id);
const calibSet = pool.filter((p) => calibIds.indexOf(p.id) >= 0).sort((a, b) => a.id - b.id);
const holdout = draw(pool, HOLDOUT_N, HOLDOUT_SEED, calibIds);
for (const p of calibSet) p.m = machineCheck(p);
for (const p of holdout.items) p.m = machineCheck(p);
if (EMIT_REVIEW) {
  const lines = holdout.items.map((p) => [p.id, p.layer, p.bucket, p.rj && p.rj.kind, p.m.registered ? 'REG' : 'UNREG', (p.m.missing || []).join('+'), (p.m.one_of_fail || []).map((g) => g.join('|')).join('+'), p.m.pass ? 'M-PASS' : 'M-REJECT', (p.statement || '').replace(/\s+/g, ' ').slice(0, 150), JSON.stringify(p.rj).slice(0, 150)].join('\t'));
  fs.writeFileSync(path.resolve(EMIT_REVIEW), 'id\tlayer\tbucket\tkind\treg\tmissing\toneof_fail\tmachine\tstatement\tresolve\n' + lines.join('\n') + '\n', 'utf8');
  console.log('emit-review -> ' + path.resolve(EMIT_REVIEW) + ' n=' + holdout.items.length + ' machine_pass=' + holdout.items.filter((p) => p.m.pass).length + ' seed=' + HOLDOUT_SEED);
  console.log('holdout_strata=' + JSON.stringify(Object.keys(holdout.alloc).sort().map((k) => [k, holdout.alloc[k].target, holdout.hits[k]])));
  db.close(); process.exit(0);
}

// ── 语义段：校准样本复用 v1 的代理语义；留出集读 holdout-semantic.tsv ──
function loadSem(file) { const m = {}; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { if (!line.trim() || line.startsWith('#')) continue; const p = line.split('|'); if (p.length !== 3) continue; m[Number(p[0])] = { pass: p[1] === 'PASS', reason: p[2] }; } return m; }
if (!HOLD_SEM) { console.error('缺 --holdout-sem <tsv>'); process.exit(2); }
const holdSem = loadSem(path.resolve(HOLD_SEM));
const calibSem = {}; for (const it of (prevAudit.items || [])) calibSem[it.id] = it.semantic || { pass: !!it.pass, reason: it.reason || '' };
function buildItems(set, semMap, segment) {
  return set.map((p) => {
    const s = semMap[p.id]; if (!s) throw new Error('semantic missing id ' + p.id + ' segment ' + segment);
    const pass = p.m.pass && s.pass;
    return { id: p.id, segment: segment, layer: p.layer, horizon: p.bucket, kind: p.rj && p.rj.kind, event_date: p.rd, base_rate: p.b,
      machine: p.m, semantic: s, coverage_gap_4: p.m.coverage_gap_4, pass: pass, verdict: pass ? 'PASS' : 'REJECT',
      reason: '机器段 ' + (p.m.pass ? ('PASS(契约' + (p.m.src || '') + ')') : ('REJECT[' + (p.m.missing || []).join(',') + ']')) + '；语义段 ' + (s.pass ? 'PASS' : 'REJECT') + '：' + s.reason };
  });
}
const calibItems2 = buildItems(calibSet, calibSem, 'calibration');
const holdItems = buildItems(holdout.items, holdSem, 'holdout');
const calibOk = calibItems2.filter((i) => i.pass).length;
const calibRate = calibItems2.length ? calibOk / calibItems2.length : null;
const holdAgree = holdItems.filter((i) => i.machine.pass === i.semantic.pass).length;
const holdWilson = wilson(holdAgree, holdItems.length);
const hc = Object.assign({ n: null, agreed: null, rate: null, reviewer: null }, prevAudit.human_calibration || {});
hc.user_spot_check = Number(hc.user_spot_check || 0);
hc.user_spot_check_required = USER_SPOT_REQUIRED;
const hcWilson = wilson(Number(hc.agreed || 0), Number(hc.n || 0));
const rule = 'design §4.2.3 修订 R4.2（D-3③ 新规）：采信需 ①机器+代理两段；②全过 n>=35 或 Wilson 95% 下界 >=0.90；③端用户抽验 >=10 题为必要条件。';
let acceptance = 'fail';
if (!(calibRate !== null && calibRate >= 0.70)) acceptance = 'fail';
else if (hc.user_spot_check < USER_SPOT_REQUIRED) acceptance = 'pending_user';
else if ((Number(hc.n) >= 35 && Number(hc.agreed) === Number(hc.n)) || (hcWilson.lb !== null && hcWilson.lb >= 0.90)) acceptance = 'accepted';
else acceptance = 'pending_recheck';
hc.acceptance_status = acceptance;
hc.acceptance_rule = rule;
hc.wilson95 = hcWilson;
hc.accepted = (acceptance === 'accepted');
hc.accepted_superseded = { field: 'accepted', former_value: prevAudit.human_calibration ? prevAudit.human_calibration.accepted : null,
  note: '批次1 曾按旧 D-3③（n=14 且 rate>=0.90）记 accepted=true；批次3 按 §4.2.3 R4.2 新规重判（全过 n>=35 或 Wilson 95% 下界 >=0.90 + 端用户抽验 >=10）' };
const crypto = require('crypto');
const contractSha = crypto.createHash('sha256').update(fs.readFileSync(CONTRACT)).digest('hex');

const contractMeta = { file: path.relative(ROOT, CONTRACT).split(path.sep).join('/'), frozen: true, basis: contractDoc.meta.basis, forbidden: contractDoc.meta.forbidden, source: contractDoc.meta.source, contracts: Object.keys(contractDoc.contracts).length, aliases: Object.keys(contractDoc.aliases).length, sha256: contractSha };
const allItems = calibItems2.concat(holdItems);
const meta = {
  version: 'v2', regime: 'R4', detail: '§4.2.1 细则 D + §4.2.3 修订 R4.2（批次 3 #6）',
  spec: 'docs/specs/2026-09-11-万物可预测性审计器-design.md §4.2.1/§4.2.3',
  contract: contractMeta,
  sampling: {
    calibration: { n: calibItems2.length, seed: CALIB_N_SEED, strata: (prevAudit.meta && prevAudit.meta.sampling) ? prevAudit.meta.sampling.strata : null, ids: calibIds },
    holdout: { n: holdItems.length, seed: HOLDOUT_SEED, procedure: holdout.procedure, alloc: holdout.alloc, hits: holdout.hits, target: holdout.target, achieved: holdout.achieved, hit_rate: holdout.hit_rate, disjoint_from_calibration: true, disjoint_from_n: calibIds.length, ids: holdItems.map((i) => i.id) },
    unified: '候选池＝抽样程序本身的产出（不再单列 every-10th 候选池）；seed/分层配额/命中率如上披露（#6e）' },
  review_composition: { machine: allItems.length, agent_semantic: allItems.length, human_calibration: Number(hc.n || 0), user_spot_check: hc.user_spot_check, end_user: 0 },
  honesty: '非全人工复核：机器段（按 resolver 源码冻结契约）' + allItems.length + ' 题 + 代理语义段同数 + 队长校准 ' + Number(hc.n || 0) + ' 题 + 端用户抽验 ' + hc.user_spot_check + ' 题。代理复核≠独立人类审计；端用户抽验未做 ⇒ 采信状态 ' + acceptance + '。',
  human_calibration_required: { min_n_user_spot: USER_SPOT_REQUIRED, agree_threshold: 0.90, rule: rule },
  holdout_note: '留出集用于检验按校准样本修正后的机器段规则在新样本上的稳定性；它是机器段 vs 代理语义段一致性，不构成人类独立核验。',
  coverage_gap_4: { count: allItems.filter((i) => i.coverage_gap_4).length, ids: allItems.filter((i) => i.coverage_gap_4).map((i) => i.id), note: '缺 baseRateNote ⇒ ④ 覆盖缺口，不影响 ②' },
  generated_at: new Date().toISOString()
};
const report = { meta: meta, human_calibration: hc,
  calibration: { n: calibItems2.length, pass: calibOk, reject: calibItems2.length - calibOk, rate: calibRate, threshold: 0.70, pass_gate: calibRate !== null && calibRate >= 0.70, items: calibItems2 },
  holdout: { n: holdItems.length, machine_vs_agent_agreement: { agree: holdAgree, n: holdItems.length, rate: holdItems.length ? holdAgree / holdItems.length : null, wilson95: holdWilson }, items: holdItems },
  summary: { n: calibItems2.length, pass: calibOk, reject: calibItems2.length - calibOk, rate: calibRate, threshold: 0.70, pass_gate: calibRate !== null && calibRate >= 0.70, acceptance_status: acceptance },
  items: calibItems2 };
const T = [];
T.push('② 抽检清单 v2（批次 3 #6；机器段按 resolver 源码冻结契约）');
T.push('契约表: ' + contractMeta.file + ' sha256=' + contractSha.slice(0, 12) + ' contracts=' + contractMeta.contracts + ' aliases=' + contractMeta.aliases);
T.push('校准样本: n=' + calibItems2.length + ' PASS ' + calibOk + ' (' + ((calibRate || 0) * 100).toFixed(1) + '%) seed=' + CALIB_N_SEED);
T.push('留出集: n=' + holdItems.length + ' 与校准样本不重叠(excluded=' + calibIds.length + ') seed=' + HOLDOUT_SEED + ' 命中率=' + ((holdout.hit_rate || 0) * 100).toFixed(1) + '%');
T.push('留出集机器段 vs 代理语义段: ' + holdAgree + '/' + holdItems.length + ' = ' + ((holdItems.length ? holdAgree / holdItems.length : 0) * 100).toFixed(1) + '% Wilson95=[' + holdWilson.lb.toFixed(3) + ',' + holdWilson.ub.toFixed(3) + ']');
T.push('人类校准: n=' + hc.n + ' agreed=' + hc.agreed + ' reviewer=' + hc.reviewer + ' | 端用户抽验=' + hc.user_spot_check + '/' + USER_SPOT_REQUIRED);
T.push('采信状态: ' + acceptance + '  规则: ' + rule);
if (acceptance === 'pending_user') T.push('待端用户抽验 >=10 题（当前阻塞项；代理不能代替端用户）');
T.push('④覆盖缺口: ' + meta.coverage_gap_4.count + ' 题 ids=' + meta.coverage_gap_4.ids.join(','));
const text = T.join(String.fromCharCode(10));
console.log(text);
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(path.resolve(OUT), JSON.stringify(report, null, 1), 'utf8'); console.log('[audit-v2] JSON -> ' + path.resolve(OUT)); }
if (TEXT_OUT) { fs.writeFileSync(path.resolve(TEXT_OUT), text + String.fromCharCode(10), 'utf8'); console.log('[audit-v2] TEXT -> ' + path.resolve(TEXT_OUT)); }
db.close(); process.exit(0);



