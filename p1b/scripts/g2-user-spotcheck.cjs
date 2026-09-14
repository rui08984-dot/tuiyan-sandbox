#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/g2-user-spotcheck.cjs —— ② 采信链第③件「端用户抽验 ≥10 题」的端用户操作通道
 * （2026-09-14 新增；依据 design §4.2.3 修订 R4.2 D-3③ 新规：端用户抽验 ≥10 题为 ② 采信的**必要条件**）
 *
 * 为什么存在：盘上 g2-audit-r4.json 已正确判 `pending_user`，但**没有任何 CLI 能把端用户的裁决写回去**
 *   —— 用户无法完成「≥10 题抽验」，② 采信结构上永远停在 pending_user。本脚本补这条通道。
 *
 * 用法（两步，端用户本人执行；代理不得代替）：
 *   ① 出表（只读）：node p1b/scripts/g2-user-spotcheck.cjs --emit [--n 10] [--out <md>]
 *        → 从 ② 校准样本（calibration items）分层随机抽 n 题，生成**人可读**的抽验表
 *          （题面 + 判据 + 机器/代理段结论），每题留「你的裁定」栏。
 *   ② 记账（写回）：node p1b/scripts/g2-user-spotcheck.cjs --record <填好的.tsv> [--out <audit.json>] [--dry-run]
 *        → 读用户填写的裁定，算与 ② 段一致率，写回 g2-audit-r4.json 的 human_calibration.user_spot_check
 *          与 user_spot_check_*，并据 design 规则重算 acceptance_status。
 *
 * 填写格式（TSV，制表符分隔；表头行以 # 开头，不改）：
 *   id<TAB>verdict<TAB>note
 *   verdict ∈ {PASS, REJECT}（=同意/不同意该题合格）；note 可空。
 *
 * 安全：① 只读 p1a.db；② 只写 audit JSON（不碰生产库、不碰 8787）；③ 端用户口径，「代理不得代填」。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

const AUDIT = arg('audit', path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4.json'));
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const N = Number(arg('n', '10')) || 10;
const OUT = arg('out', null);
const RECORD = arg('record', null);
const DRY = FLAG('dry-run');
const SEED = Number(arg('seed', '20260914')) || 20260914; // 端用户抽验 seed（与校准/留出集不同，独立可复现）
const USER_SPOT_REQUIRED = 10;
// ── 核验者 provenance（2026-09-14 新增）──────────────────────────────────────
// 为什么必须显式：② 采信链第③件的**全部意义**是「独立人类核验」（防 ①机器段/②代理语义段自审）。
// 若代理代填却记为 satisf 端用户，就等于**伪造了独立性**——比不填更糟。
// 故：--by user（默认）才算满足必要条件；--by agent（代理预核）**允许写回供追踪，但
//     acceptance 恒不因它进入 accepted**（user_spot_check_effective=0），并在各报告恒挂降级披露。
const BY = String(arg('by', 'user')).toLowerCase();
const BY_IS_USER = BY === 'user';
if (['user', 'agent'].indexOf(BY) === -1) { console.error('--by 必须是 user|agent'); process.exit(2); }

/** 与 g2-audit-build.cjs 同序同口径的 Wilson 下界（复算一致率下界） */
function wilson(k, n, z) {
  if (!n) return { k: k, n: n, rate: null, lb: null, ub: null };
  z = z || 1.96;
  const z2 = z * z, ph = k / n;
  const lb = (ph + z2 / (2 * n) - z * Math.sqrt((ph * (1 - ph) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  const ub = (ph + z2 / (2 * n) + z * Math.sqrt((ph * (1 - ph) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  return { k: k, n: n, rate: ph, lb: lb, ub: ub };
}
/** 确定性 LCG（与项目既有抽样同族；seed 固定 ⇒ 可复现） */
function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
const items = Array.isArray(audit.items) ? audit.items : [];
if (!items.length) { console.error('audit 无 items，无法出表'); process.exit(2); }

// 题面取数（只读；用于生成人可读表）
function loadStatements(ids) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const m = {};
  const st = db.prepare('SELECT id, statement, layer, matures_at FROM predictions WHERE id = ?');
  for (const id of ids) { const r = st.get(id); if (r) m[id] = r; }
  db.close();
  return m;
}

// ── ① 出表 ──
if (FLAG('emit')) {
  const rand = lcg(SEED);
  const picked = shuffle(items, rand).slice(0, Math.min(N, items.length));
  const stmts = loadStatements(picked.map((i) => i.id));
  const L = [];
  L.push('# ② 端用户抽验表（' + picked.length + ' 题 · seed=' + SEED + ' · ' + new Date().toISOString() + '）');
  L.push('');
  L.push('> 你的任务：逐题判断「**这个题是否真的合格**」（判据是否明确、有真值锚、cutoff 合规）。');
  L.push('> 与机器/代理段结论一致就填 PASS，不同意就填 REJECT。**这一步代理不能代替**——② 采信链的独立性正靠它。');
  L.push('> 填法：把每题下面的 `裁定:` 改成 PASS 或 REJECT（可加备注），另存为 .tsv 后跑 --record。');
  L.push('> 判据（design §4.2.3 R4.2 D-3③）：端用户抽验 ≥10 题是 ② 采信的**必要条件**；未做则状态恒 `pending_user`。');
  L.push('');
  picked.forEach((it, i) => {
    const s = stmts[it.id] || {};
    L.push('## ' + (i + 1) + '. 题 id=' + it.id + '（' + it.layer + ' / ' + it.horizon + ' / ' + (it.kind || '-') + '）');
    L.push('- 题面：' + String(s.statement || '（取不到，见库）').replace(/\s+/g, ' '));
    L.push('- 事件日：' + (it.event_date || '-') + ' ｜ 外生基率 b=' + (it.base_rate === null || it.base_rate === undefined ? '-' : it.base_rate));
    L.push('- 机器段：' + (it.machine && it.machine.pass ? 'PASS' : 'REJECT') + '（' + ((it.machine && it.machine.basis) || '-') + '）');
    L.push('- 代理段：' + (it.semantic && it.semantic.pass ? 'PASS' : 'REJECT') + '：' + ((it.semantic && it.semantic.reason) || '-'));
    L.push('- 综合结论：' + (it.pass ? 'PASS' : 'REJECT'));
    L.push('- 裁定: ____');
    L.push('');
  });
  L.push('# ── 以下为 .tsv 填写区（勿改 id 列）──────────────────');
  L.push('# id\tverdict\tnote');
  picked.forEach((it) => L.push(it.id + '\t\t'));
  const text = L.join('\n');
  if (OUT) { fs.writeFileSync(path.resolve(OUT), text, 'utf8'); console.log('-emit -> ' + path.resolve(OUT) + ' n=' + picked.length + ' seed=' + SEED); }
  else console.log(text);
  console.log('[g2-user-spotcheck] 待端用户抽验 ' + picked.length + ' 题（>= ' + USER_SPOT_REQUIRED + ' 才有资格采信）');
  process.exit(0);
}

// ── ② 记账 ──
if (!RECORD) { console.error('用法：--emit（出表） 或 --record <tsv>（记账）'); process.exit(2); }
const lines = fs.readFileSync(path.resolve(RECORD), 'utf8').split(/\r?\n/);
const byId = {}; let nValid = 0;
for (const ln of lines) {
  if (!ln.trim() || ln.startsWith('#')) continue;
  const p = ln.split('\t').map((x) => x.trim());
  const id = Number(p[0]); const v = (p[1] || '').toUpperCase();
  if (!isFinite(id) || (v !== 'PASS' && v !== 'REJECT')) continue;
  byId[id] = { verdict: v, note: p[2] || '' }; nValid++;
}
if (!nValid) { console.error('未解析到有效裁定（需 id<TAB>PASS|REJECT[<TAB>note]）'); process.exit(2); }

// 一致率＝用户裁定 与 ② 综合结论（machine∧semantic）一致数
let agreed = 0, considered = 0; const detail = [];
for (const it of items) {
  const u = byId[it.id]; if (!u) continue;
  considered++;
  const mine = it.pass ? 'PASS' : 'REJECT';
  const ok = u.verdict === mine;
  if (ok) agreed++;
  detail.push({ id: it.id, user: u.verdict, segment: mine, agree: ok, note: u.note });
}
const rate = considered ? agreed / considered : null;
const hcW = wilson(agreed, considered);

const hc = audit.human_calibration || {};
hc.user_spot_check = considered;
hc.user_spot_check_required = USER_SPOT_REQUIRED;
hc.user_spot_check_agreed = agreed;
hc.user_spot_check_rate = rate;
hc.user_spot_check_wilson95 = hcW;
hc.user_spot_check_seed = SEED;
hc.user_spot_check_detail = detail;
hc.user_spot_check_at = new Date().toISOString();
// provenance：谁是核验者。只有 user 才算满足必要条件（防代理自审冒充独立性）
hc.user_spot_check_by = BY;
hc.user_spot_check_effective = BY_IS_USER ? considered : 0; // 参与「必要条件是否满足」判定的**有效**题数
hc.user_spot_check_note = BY_IS_USER
  ? '端用户本人填写（代理不得代填）；一致率＝用户裁定 vs ② 综合结论（机器∧语义）。'
  : '**代理预核，非端用户独立核验**（用户已授权代填并同意此披露）；一致率≠独立性证据，acceptance 不因本项进入 accepted。';

// 重算 acceptance（照 g2-audit-build.cjs 同规则；但用**有效**端用户题数）
const hcWilson = wilson(Number(hc.agreed || 0), Number(hc.n || 0));
let acceptance;
const calibRate = (audit.calibration && audit.calibration.rate !== undefined) ? audit.calibration.rate : null;
if (!(calibRate !== null && calibRate >= 0.70)) acceptance = 'fail';
else if (Number(hc.user_spot_check_effective || 0) < USER_SPOT_REQUIRED) acceptance = BY_IS_USER ? 'pending_user' : 'pending_user_agent_surrogate';
else if ((Number(hc.n) >= 35 && Number(hc.agreed) === Number(hc.n)) || (hcWilson.lb !== null && hcWilson.lb >= 0.90)) acceptance = 'accepted';
else acceptance = 'pending_recheck';
hc.acceptance_status = acceptance;
hc.wilson95 = hcWilson;
hc.accepted = (acceptance === 'accepted');
audit.human_calibration = hc;
if (audit.summary) audit.summary.acceptance_status = acceptance;
if (audit.meta) {
  audit.meta.review_composition = Object.assign({}, audit.meta.review_composition, {
    // end_user = **真端用户**核验数（agent 预核不计入，否则构成"独立性"口径污染）
    user_spot_check: considered, end_user: BY_IS_USER ? considered : 0,
    agent_surrogate_spot_check: BY_IS_USER ? 0 : considered,
  });
  audit.meta.updated_at = new Date().toISOString();
}

const report = { considered: considered, agreed: agreed, rate: rate, wilson95: hcW,
  acceptance_status: acceptance, required: USER_SPOT_REQUIRED, detail: detail };
if (DRY) { console.log('[dry-run] ' + JSON.stringify(report, null, 1)); process.exit(0); }
const outPath = OUT ? path.resolve(OUT) : AUDIT;
fs.writeFileSync(outPath, JSON.stringify(audit, null, 1), 'utf8');
console.log('[g2-user-spotcheck] ' + (BY_IS_USER ? '端用户' : '代理预核（非端用户）') + '抽验 ' + considered + '/' + USER_SPOT_REQUIRED + ' 题；与 ② 一致 ' + agreed + '/' + considered + ' = ' + (rate === null ? 'n/a' : (rate * 100).toFixed(1) + '%'));
console.log('  Wilson95=[' + hcW.lb.toFixed(3) + ',' + hcW.ub.toFixed(3) + '] | by=' + BY + ' | 有效题数=' + hc.user_spot_check_effective + ' | acceptance_status=' + acceptance);
console.log('  -> ' + outPath);
if (acceptance === 'pending_user') console.log('  仍 pending_user：题数不足 ' + USER_SPOT_REQUIRED + '（补足后端用户抽验方为必要条件）');
else if (acceptance === 'pending_user_agent_surrogate') console.log('  ⚠ 代理预核**不满足**端用户独立核验的必要条件 ⇒ 状态恒待端用户（已如实标注，不得当成 accepted）');
else if (acceptance === 'accepted') console.log('  ✅ ② 采信链三件齐备（机器段＋代理段＋端用户抽验）⇒ accepted');

