#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/role3-freeze.cjs —— 角色③「分支冻结先于子题结算」实装（2026-09-21 · 第 3 期票 I1/角色③）
 *
 * 判据来源（**引用不新造**）：PREREG-角色③ v1.1 §3 勘误原文——
 *   「17 号件『**分支冻结（run_id）先于子题结算**』的约束，**在新产分支时适用**
 *     （即未来角色③对未结算父题出分支的批次）；本批复用族不受该约束。」
 *
 * ★本件的立项理由（为什么必须是一个**独立动作**）：分支集一旦生成，若不立即冻结，
 *   就存在「**先看子题结果、再挑分支**」的选择空间 ⇒ 合成读数的非平凡性可能来自挑拣而非方法。
 *   冻结＝把「分支集」在**任何子题结算之前**固定成不可变证据（sha16 + 冻结时点 + run_id），
 *   之后任何改动都会在复算时被 sha 不符抓住。
 *
 * 契约：
 *   ① `freeze`：读候选分支件（role3 生成器产物）→ 计算分支集 sha16 → 写冻结件（**只增不改**）。
 *      冻结件含：run_id／frozen_at／branch_set（逐分支：parent_id／kind／pick／child_statement）／sha16／
 *      父题结算状态快照（★**必须全部未结算**——否则冻结时点已晚于结算，冻结无意义，硬失败）。
 *   ② `verify`：对已冻结件重算 sha16，与记录值比对（MATCH／MISMATCH）。
 *      另核：冻结时点之后**是否有父题被结算**（若有 ⇒ 该分支集的冻结仍成立，但要如实披露）。
 *   ③ 纪律：**零账本写**（只读 predictions）；冻结件写 `p1b/sim/out/`（运行时日期戳命名）。
 *
 * 用法：
 *   node p1b/scripts/role3-freeze.cjs freeze --candidates <rows.json> [--out <json>] [--label <名>]
 *   node p1b/scripts/role3-freeze.cjs verify --frozen <frozen.json>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const TODAY = new Date().toISOString().slice(0, 10);
const RUN_AT = new Date().toISOString();

/** 规范化分支集（**冻结的必须是可复算的纯数据**：按 parent_id+pick 排序，剔除生成器内部字段） */
function canonBranches(rows) {
  const out = [];
  for (const r of rows) {
    const meta = r.meta || {};
    out.push({
      parent_id: meta.parent_prediction_id === undefined ? null : meta.parent_prediction_id,
      kind: (r.resolve || {}).kind || null,
      pick: (r.resolve || {}).pick || null,
      child_statement: r.statement || null,
    });
  }
  out.sort((a, b) => (String(a.parent_id) + '|' + String(a.pick)).localeCompare(String(b.parent_id) + '|' + String(b.pick)));
  return out;
}

function sha16Of(obj) { return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16); }

/** 父题结算状态快照（冻结的**前提**：全部未结算） */
function parentStatus(conn, parentIds) {
  const st = {};
  for (const pid of parentIds) {
    if (pid === null) { st['null'] = { exists: false, note: '分支无 parent_id（生成器未挂父题）' }; continue; }
    const r = conn.prepare('SELECT id, resolved_at, matures_at FROM predictions WHERE id = ?').get(pid);
    st[String(pid)] = r ? { exists: true, resolved: !!r.resolved_at, resolved_at: r.resolved_at || null, matures_at: r.matures_at || null } : { exists: false };
  }
  return st;
}

function cmdFreeze() {
  const inPath = arg('candidates', null);
  if (!inPath) { console.error('[role3-freeze] 用法：freeze --candidates <rows.json> [--out <json>] [--label <名>]'); process.exit(2); }
  const label = arg('label', 'role3');
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.rows || raw.items || raw.candidates || []);
  if (!rows.length) { console.error('[role3-freeze] 候选 0 条 ⇒ exit 3（防「空集」被冻结成证据）'); process.exit(3); }

  const branches = canonBranches(rows);
  const sha16 = sha16Of(branches);
  const parentIds = [...new Set(branches.map((b) => b.parent_id))];

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const st = parentStatus(db, parentIds);
  db.close();

  // ★硬失败：若任一父题**已结算** ⇒ 冻结时点晚于结算，冻结失去意义（v1.1 §3 的核心约束）
  const resolved = Object.entries(st).filter(([, v]) => v.resolved);
  if (resolved.length) {
    console.error('[role3-freeze] ★冻结失败：以下父题已结算 ⇒ 「冻结先于结算」不成立：');
    for (const [pid, v] of resolved) console.error('  parent ' + pid + ' resolved_at=' + v.resolved_at);
    console.error('  ⇒ 不得事后冻结（会产生「先看结果再冻结」的选择空间）。本动作中止，零写盘。');
    process.exit(4);
  }

  const frozen = {
    script: 'p1b/scripts/role3-freeze.cjs',
    action: 'freeze',
    label: label,
    run_id: 'role3-freeze-' + label + '-' + TODAY.replace(/-/g, ''),
    frozen_at: RUN_AT,
    source_file: inPath,
    branch_count: branches.length,
    parents: parentIds,
    branch_set: branches,
    sha16: sha16,
    sha_method: 'sha256(JSON.stringify(分支数组，按 parent_id|pick 排序))[:16]',
    parent_status_at_freeze: st,
    all_parents_unresolved: true,
    discipline: '零账本写；冻结件只增不改；分支集 sha16 随读数件（PREREG v1.1 §3）',
  };
  const outPath = arg('out', path.join(OUT_DIR, 'role3-frozen-' + label + '-' + TODAY.replace(/-/g, '') + '.json'));
  if (fs.existsSync(outPath)) {
    // ★只增不改：同名冻结件已存在 ⇒ 核内容是否逐位相同，相同则幂等通过，不同则硬失败
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (prev.sha16 === sha16) { console.log('[role3-freeze] 同名冻结件已存在且 sha16 相同 ⇒ 幂等（未改写）'); process.exit(0); }
    console.error('[role3-freeze] ★同名冻结件已存在但 sha16 不同 ⇒ 拒绝覆写（冻结件只增不改）');
    console.error('  既有 sha16=' + prev.sha16 + ' 本次 sha16=' + sha16);
    process.exit(5);
  }
  fs.writeFileSync(outPath, JSON.stringify(frozen, null, 1), 'utf8');
  console.log('== 分支冻结 ==');
  console.log('  run_id   ' + frozen.run_id);
  console.log('  分支数   ' + branches.length + '（父题 ' + parentIds.length + ' 个）');
  console.log('  sha16    ' + sha16);
  console.log('  ★父题全部未结算: ' + (resolved.length === 0 ? '是（冻结有效）' : '否'));
  console.log('  冻结件   ' + outPath);
  console.log('下一步：子题结算后跑 verify 复核 sha16 未变：');
  console.log('  node p1b/scripts/role3-freeze.cjs verify --frozen ' + outPath);
}

function cmdVerify() {
  const fp = arg('frozen', null);
  if (!fp) { console.error('[role3-freeze] 用法：verify --frozen <frozen.json>'); process.exit(2); }
  const f = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const now = sha16Of(f.branch_set);
  const match = now === f.sha16;

  // 冻结之后父题是否已结算（**如实披露**，不判失败——冻结本身已成立）
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const st = parentStatus(db, f.parents || []);
  db.close();
  const resolvedAfter = Object.entries(st).filter(([, v]) => v.resolved);

  console.log('== 分支冻结复核 ==');
  console.log('  run_id        ' + f.run_id);
  console.log('  记录 sha16    ' + f.sha16);
  console.log('  重算 sha16    ' + now);
  console.log('  **' + (match ? 'MATCH（分支集未被改动）' : '★MISMATCH（分支集被改动过！）') + '**');
  console.log('  冻结时点      ' + f.frozen_at);
  console.log('  冻结后已结算父题: ' + resolvedAfter.length + (resolvedAfter.length ? '（' + resolvedAfter.map(([p]) => p).join(', ') + '）' : ''));
  if (!match) process.exit(6);
}

const cmd = process.argv[2];
if (cmd === 'freeze') cmdFreeze();
else if (cmd === 'verify') cmdVerify();
else { console.error('[role3-freeze] 用法：freeze --candidates <rows.json> ｜ verify --frozen <frozen.json>'); process.exit(2); }
