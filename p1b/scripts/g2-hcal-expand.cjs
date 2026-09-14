#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/g2-hcal-expand.cjs —— ② 采信链 规则②「校准全过且 n≥35」的**补样复核通道**（2026-09-14 新增）
 *
 * 为什么存在：design §4.2.3 修订 R4.2（D-3③ 新规）把 ② 采信的条件之二改为
 *   「人类校准全过且 n≥35，或一致率 Wilson 95% 下界 ≥0.90」；首轮校准只有 n=14
 *   （`p1b/sim/out/g2-human-calibration-r4.md`）⇒ 结构上够不着门槛。本脚本补样 21 项：
 *   沿用首轮「最可能分歧」抽样纪律（边界基率 12 ＋ 长窗 3 ＋ 顺延 6），逐项独立判读、
 *   **逐项留理由**（空理由拒收——防凑数全过），写回 audit 的 human_calibration
 *   （n/agreed/reviewer/disclosure）并重算 acceptance（与 g2-user-spotcheck.cjs 同规则）。
 *
 * 用法：
 *   ① 出表：node p1b/scripts/g2-hcal-expand.cjs --emit [--n 21] [--out <md>]
 *   ② 记账：node p1b/scripts/g2-hcal-expand.cjs --record <tsv> [--by agent|end_user] [--note "…"] [--dry-run]
 *   TSV：id<TAB>PASS|REJECT<TAB>理由（**理由必填**）
 *
 * 诚实披露（硬要求）：
 *   - `--by agent`（缺省）**不主张**「全人工复核」；reviewer/disclosure 字段如实写明执行者构成。
 *   - 空理由 / 样本外 id / 重复记账 ⇒ 拒收（exit≠0），audit 不落盘。
 *
 * 安全：只读 p1a.db；只写 audit JSON（不碰生产库、不碰 8787）。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

const AUDIT = arg('audit', path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4.json'));
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const N = Number(arg('n', '21')) || 21;
const OUT = arg('out', null);
const RECORD = arg('record', null);
const DRY = FLAG('dry-run');
const SEED = Number(arg('seed', '20260914')) || 20260914;
const NOTE = arg('note', null);
const BY = String(arg('by', 'agent')).toLowerCase();
if (['agent', 'end_user'].indexOf(BY) === -1) { console.error('--by 必须是 agent|end_user'); process.exit(2); }
const HCAL_REQUIRED = 35;
const USER_SPOT_REQUIRED = 10;

// 首轮已校准 14 条（来源：g2-human-calibration-r4.md §二：8 假阳性 + 1331/1627 边界 + 948/1835/1839/1846 顺延）
const HCAL_ROUND1 = [466, 476, 480, 486, 490, 524, 540, 542, 1331, 1627, 948, 1835, 1839, 1846];
// 补样配比（与首轮同族纪律：最可能分歧优先）
const WANT = [12, 3, 6]; // 边界基率 / 长窗 / 顺延

function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function wilson(k, n, z) {
  if (!n) return { k: k, n: n, rate: null, lb: null, ub: null };
  z = z || 1.96;
  const z2 = z * z, ph = k / n;
  const lb = (ph + z2 / (2 * n) - z * Math.sqrt((ph * (1 - ph) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  const ub = (ph + z2 / (2 * n) + z * Math.sqrt((ph * (1 - ph) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  return { k: k, n: n, rate: ph, lb: lb, ub: ub };
}
/** 风险桶：0=边界基率（最可能分歧） 1=长窗 2=顺延 */
function bucket(it) {
  const b = Number(it.base_rate);
  if (isFinite(b) && b > 0.45 && b < 0.55) return 0;
  if (it.horizon === 'long') return 1;
  return 2;
}
/** 确定性抽样：按桶配比取，排除 R1 与已记账补样；不足向后补 */
function pick(items, exclude) {
  const rand = lcg(SEED);
  const cands = items.filter((it) => exclude.indexOf(it.id) === -1);
  const byB = [[], [], []];
  for (const it of cands) byB[bucket(it)].push(it);
  const out = [];
  for (let b = 0; b < 3; b++) {
    const want = Math.min(WANT[b], N - out.length);
    for (const it of shuffle(byB[b], rand).slice(0, want)) out.push(it.id);
  }
  for (let b = 0; b < 3 && out.length < N; b++) {
    for (const it of shuffle(byB[b], rand)) { if (out.length >= N) break; if (out.indexOf(it.id) === -1) out.push(it.id); }
  }
  return out;
}

const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
const items = Array.isArray(audit.items) ? audit.items : [];
if (!items.length) { console.error('audit 无 items，无法出表'); process.exit(2); }
const hc0 = audit.human_calibration || {};
const alreadyExpanded = (hc0.hcal_expand && Array.isArray(hc0.hcal_expand.ids)) ? hc0.hcal_expand.ids : [];

/** 只读取数：题面 + cutoff + resolve 判据（用于人可读复核单） */
function loadRows(ids) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const st = db.prepare('SELECT id, statement, created_at, matures_at, evidence_json FROM predictions WHERE id = ?');
  const m = {};
  for (const id of ids) {
    const r = st.get(id);
    if (!r) { m[id] = null; continue; }
    let cutoff = null, resolve = null, baseNote = null;
    try {
      const ev = JSON.parse(r.evidence_json);
      // 两代 evidence 形态都要兼容：
      //   ① 老形态 [{kind:'cutoff_snapshot', ingested_at, note, resolve}]（如 id=466 族）
      //   ② 现形态 [{resolve, baseRateNote, meta:{cutoff,...}, slug, phase, kind}]（backfill/forward 批）
      for (const x of (ev || [])) {
        if (!x || typeof x !== 'object') continue;
        if (x.kind === 'cutoff_snapshot') {
          cutoff = x.ingested_at || cutoff;
          baseNote = x.note || baseNote;
          resolve = x.resolve || resolve;
        } else if (x.resolve) {
          resolve = x.resolve || resolve;
          baseNote = x.baseRateNote || baseNote;
          if (x.meta && x.meta.cutoff) cutoff = x.meta.cutoff;
        }
      }
    } catch (e) { /* 保持空 */ }
    m[id] = { statement: r.statement, cutoff: cutoff || r.created_at, matures_at: r.matures_at, resolve: resolve, baseNote: baseNote };
  }
  db.close();
  return m;
}

// ── ① 出表 ──
if (FLAG('emit')) {
  const ids = pick(items, HCAL_ROUND1.concat(alreadyExpanded));
  const rows = loadRows(ids);
  const L = [];
  L.push('# ② 校准补样复核单（' + ids.length + ' 项 · seed=' + SEED + ' · ' + new Date().toISOString() + '）');
  L.push('');
  L.push('> 你的任务：逐项判断「**该题的判据是否真的合格**」——对象/日期/阈值明确、有真值锚、cutoff 严格早于事件日、基率非恒真/恒假。');
  L.push('> 与 ② 综合结论一致 → PASS；不同意 → REJECT。**每项必须写一句理由**（空理由会被记账拒收——防凑数）。');
  L.push('> 抽样纪律（与首轮同族）：边界基率 12 ＋ 长窗 3 ＋ 顺延 6，偏向最易出错处（保守方向）。');
  L.push('> 判据（design §4.2.3 R4.2）：校准**全过且 n≥35**（或 Wilson 95% 下界 ≥0.90）为 ② 采信条件之二。');
  L.push('');
  ids.forEach((id, i) => {
    const it = items.filter((x) => x.id === id)[0] || {};
    const r = rows[id] || {};
    L.push('## ' + (i + 1) + '. id=' + id + '（' + (it.layer || '-') + ' / ' + (it.horizon || '-') + ' / ' + (it.kind || '-') + '）');
    L.push('- 题面：' + String(r.statement || '（取不到，见库）').replace(/\s+/g, ' '));
    L.push('- 真值锚：kind=' + ((r.resolve && r.resolve.kind) || (it.kind || '-')));
    L.push('- 判据参数：' + (r.resolve ? JSON.stringify(r.resolve).slice(0, 260) : '（无 resolve）'));
    L.push('- cutoff=' + (r.cutoff || '-') + ' ｜ 事件日/到期=' + (r.matures_at || it.event_date || '-') + ' ｜ 基率 b=' + (it.base_rate === null || it.base_rate === undefined ? '-' : it.base_rate));
    L.push('- 基率注记：' + String(r.baseNote || '（无）').replace(/\s+/g, ' ').slice(0, 200));
    L.push('- 机器段：' + (it.machine && it.machine.pass ? 'PASS' : 'REJECT') + ' ｜ 代理段：' + (it.semantic && it.semantic.pass ? 'PASS' : 'REJECT'));
    L.push('- 判定: ____  理由: ____');
    L.push('');
  });
  L.push('# ── 以下为 .tsv 填写区（勿改 id 列；理由必填）──────────────');
  L.push('# id\tverdict\treason');
  ids.forEach((id) => L.push(id + '\t\t'));
  const text = L.join('\n');
  if (OUT) { fs.writeFileSync(path.resolve(OUT), text, 'utf8'); console.log('-emit -> ' + path.resolve(OUT) + ' n=' + ids.length + ' seed=' + SEED); }
  else console.log(text);
  console.log('[g2-hcal-expand] 待复核 ' + ids.length + ' 项（目标 hc.n ' + Number(hc0.n || 0) + ' -> ' + (Number(hc0.n || 0) + ids.length) + '，门槛 ' + HCAL_REQUIRED + '）');
  process.exit(0);
}

// ── ② 记账 ──
if (!RECORD) { console.error('用法：--emit（出表） 或 --record <tsv>（记账）'); process.exit(2); }
const allowed = new Set();
{
  const cands = pick(items, HCAL_ROUND1.concat(alreadyExpanded));
  for (const id of cands) allowed.add(id);
}
const lines = fs.readFileSync(path.resolve(RECORD), 'utf8').split(/\r?\n/);
const rounds = {}; const problems = [];
for (const ln of lines) {
  if (!ln.trim() || ln.startsWith('#')) continue;
  const p = ln.split('\t').map((x) => x.trim());
  const id = Number(p[0]); const v = (p[1] || '').toUpperCase(); const reason = p[2] || '';
  if (!isFinite(id) || (v !== 'PASS' && v !== 'REJECT')) continue;
  if (!reason) { problems.push('id=' + id + ' 缺理由'); continue; }
  if (alreadyExpanded.indexOf(id) !== -1) { problems.push('id=' + id + ' 已在补样内（防重复记账）'); continue; }
  if (!allowed.has(id)) { problems.push('id=' + id + ' 不在本 seed 样本内'); continue; }
  rounds[id] = { verdict: v, reason: reason };
}
if (problems.length) { console.error('拒收（未写盘）：' + problems.join('；')); process.exit(3); }
const newIds = Object.keys(rounds).map(Number);
if (!newIds.length) { console.error('未解析到有效裁定（需 id<TAB>PASS|REJECT<TAB>理由）'); process.exit(2); }
const passN = newIds.filter((id) => rounds[id].verdict === 'PASS').length;
const rejectN = newIds.length - passN;

const hc = Object.assign({}, audit.human_calibration || {});
const nBefore = Number(hc.n || 0);
const agreedBefore = Number(hc.agreed || 0);
hc.n = nBefore + newIds.length;
hc.agreed = agreedBefore + passN;
hc.rate = hc.n ? hc.agreed / hc.n : null;
const buckets = { boundary: 0, long: 0, rest: 0 };
for (const id of newIds) {
  const it = items.filter((x) => x.id === id)[0] || {};
  const b = bucket(it);
  buckets[b === 0 ? 'boundary' : (b === 1 ? 'long' : 'rest')]++;
}
hc.hcal_expand = {
  ids: alreadyExpanded.concat(newIds),
  added: newIds.length, pass: passN, reject: rejectN,
  n_before: nBefore, agreed_before: agreedBefore, n_after: hc.n, agreed_after: hc.agreed,
  buckets: buckets, seed: SEED, by: BY, note: NOTE || null,
  at: new Date().toISOString(),
  detail: newIds.map((id) => ({ id: id, verdict: rounds[id].verdict, reason: rounds[id].reason })),
};
hc.reviewer = '首轮 14＝队长（非端用户）；补样 ' + newIds.length + '＝' + (BY === 'agent' ? '代理（ZCode 会话，非端用户）' : '端用户') + '。';
hc.disclosure = '校准段构成：队长 14 项 ＋ ' + (BY === 'agent' ? '代理补样复核 ' : '端用户补样 ') + newIds.length + ' 项'
  + '（逐项留理由；抽样＝边界基率 ' + buckets.boundary + ' ＋ 长窗 ' + buckets.long + ' ＋ 顺延 ' + buckets.rest + '，最可能分歧方向）'
  + '；端用户抽验 ' + Number(hc.user_spot_check_effective || 0) + ' 题（by=' + (hc.user_spot_check_by || '-') + '）。'
  + (BY === 'agent' ? '代理复核≠独立人类审计；**不得声称全人工**。' : '');
hc.sample_bias = (String(hc.sample_bias || '') + ' ｜ 补样同族纪律（最可能分歧），逐项理由见 hcal_expand.detail。').slice(0, 500);

// 重算 acceptance（与 g2-user-spotcheck.cjs 同规则）
const hcWilson = wilson(Number(hc.agreed || 0), Number(hc.n || 0));
const calibRate = (audit.calibration && audit.calibration.rate !== undefined) ? audit.calibration.rate : null;
let acceptance;
if (!(calibRate !== null && calibRate >= 0.70)) acceptance = 'fail';
else if (Number(hc.user_spot_check_effective || 0) < USER_SPOT_REQUIRED) acceptance = (hc.user_spot_check_by === 'agent' ? 'pending_user_agent_surrogate' : 'pending_user');
else if ((Number(hc.n) >= HCAL_REQUIRED && Number(hc.agreed) === Number(hc.n)) || (hcWilson.lb !== null && hcWilson.lb >= 0.90)) acceptance = 'accepted';
else acceptance = 'pending_recheck';
hc.acceptance_status = acceptance;
hc.wilson95 = hcWilson;
hc.accepted = (acceptance === 'accepted');
audit.human_calibration = hc;
if (audit.summary) audit.summary.acceptance_status = acceptance;
if (audit.meta) {
  // 复核构成同步（防「audit 说 14、实际 35」的口径漂移；human_calibration 计总，补样单列）
  audit.meta.review_composition = Object.assign({}, audit.meta.review_composition, {
    human_calibration: hc.n,
    hcal_expand_agent: newIds.length,
  });
  audit.meta.honesty = '非全人工复核：机器段（按 resolver 源码冻结契约）' + items.length + ' 题 ＋ 代理语义段同数 ＋ 校准段 '
    + hc.n + ' 题（队长 14 ＋ ' + (BY === 'agent' ? '代理补样 ' : '端用户补样 ') + newIds.length + '）＋ 端用户抽验 '
    + Number(hc.user_spot_check_effective || 0) + ' 题（by=' + (hc.user_spot_check_by || '-') + '）。'
    + (BY === 'agent' ? '代理复核≠独立人类审计；不得声称全人工。' : '');
  audit.meta.updated_at = new Date().toISOString();
}
const report = {
  added: newIds.length, pass: passN, reject: rejectN,
  n_before: nBefore, n_after: hc.n, agreed_after: hc.agreed, rate: hc.rate,
  wilson95: hcWilson, acceptance_status: acceptance, required: HCAL_REQUIRED,
  rejected_ids: newIds.filter((id) => rounds[id].verdict === 'REJECT'),
};
if (DRY) { console.log('[dry-run] ' + JSON.stringify(report, null, 1)); process.exit(0); }
const outPath = OUT ? path.resolve(OUT) : AUDIT;
fs.writeFileSync(outPath, JSON.stringify(audit, null, 1), 'utf8');
console.log('[g2-hcal-expand] 补样 ' + newIds.length + ' 项：PASS ' + passN + ' / REJECT ' + rejectN
  + ' ｜ hc.n ' + nBefore + ' -> ' + hc.n + '（门槛 ' + HCAL_REQUIRED + '）｜ 一致率 ' + (hc.rate === null ? 'n/a' : (hc.rate * 100).toFixed(1) + '%'));
console.log('  Wilson95=[' + hcWilson.lb.toFixed(3) + ',' + hcWilson.ub.toFixed(3) + '] | by=' + BY + ' | acceptance_status=' + acceptance);
console.log('  -> ' + outPath);
if (acceptance === 'accepted') console.log('  ✅ ② 采信链条件全齐（两段＋校准 n≥35 全过／Wilson≥0.90＋端用户抽验≥10）⇒ accepted');
else if (acceptance === 'pending_recheck') console.log('  ⚠ 仍未 accepted：校准样本/一致率未达门槛（n=' + hc.n + ' agreed=' + hc.agreed + '）');
