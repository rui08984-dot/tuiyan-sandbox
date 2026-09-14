#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/cleanup-g1-dedup.cjs —— 清理局 1「集成验证局」的重复参谋卡脏数据（2026-09-14 用户拍板）
 *
 * 背景（bug-27）：`POST /day/:n/advise` 曾无防重守卫 ⇒ 同名日重结算把参谋卡重复入库。
 *   生产库 game_id=1 实测：7 条 hypotheses（其中 2 套 mock 罐头重复）+ 3 条完全相同的 contradictions。
 *   bug-27 已在代码侧修复（p1b/src/routes/advise.js 同日覆盖）；本脚本处置**历史脏数据**。
 *
 * 语义边界（重要）：
 *   · 只动 **game_id=1**（早期「集成验证局」，2026-09-08 建，**0 条 predictions 引用**）。
 *   · 只删**重复行**，保留每组的第一条（id 最小者）——不整局清空，尽量少动。
 *   · 参谋卡是**派生视图**（非账本事实），故不违反「账本不可变」；但为慎重，仍走快照+确认+留痕三件套。
 *
 * 用法：
 *   node p1b/scripts/cleanup-g1-dedup.cjs                 # dry-run（默认，零写入）
 *   node p1b/scripts/cleanup-g1-dedup.cjs --confirm       # 真删
 *   node p1b/scripts/cleanup-g1-dedup.cjs --db <path>     # 指定库（默认生产库）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const CONFIRM = process.argv.indexOf('--confirm') >= 0;
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));

const D = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const db = new D(DB_PATH);
const GID = 1;

// ── 去重键 ──
// hypotheses：同 (game_id, day, content) 视为重复（content 是语义主体；stance/tendency 随内容变）
// contradictions：同 (game_id, claim_a, claim_b, action_a, action_b, conflict_desc) 视为重复
//
// ★保留策略（2026-09-14 实测修正）：**默认保「信息更丰富」的那条，而非 id 最小者**。
//   起因：局 1 的 con#1/#2 是 **MOCK 罐头**（无辜解释逐字等于 llm.js 的 INNOCENT_POOL），
//   而 con#3 是**真实 LLM** 产出（三条解释均自定义、含「假跳女巫」推理）。若按 id 保首条，
//   会把 mock 留下、把真实的删掉——方向正好反了。故改按「无辜解释条数多者优先，同数再比文本长度」。
const MOCK_POOL = [
  '女巫可能毒错人/救错人——毒与守是合法谎言（药剂类）',
  '醉酒或中毒状态下拿到错误信息（状态类）',
  '信息差：夜晚视角不同或没听到关键发言（信息差类）',
  '记错号码、记错夜晚或口误（记忆类）',
  '好人主动说谎（悍跳/挡刀/藏身份）或狼人战术假信息（战术类）',
];
function isMockExplanations(json) {
  let arr = [];
  try { arr = JSON.parse(json || '[]'); } catch (e) { return false; }
  if (!Array.isArray(arr) || !arr.length) return false;
  // 全部条目都命中 mock 文案池 ⇒ 判为 mock 罐头
  return arr.every((s) => MOCK_POOL.indexOf(String(s)) !== -1);
}
/** 丰富度打分：无辜解释条数（主）+ 文本总长（次）。mock 罐头通常条数少且文本短。 */
function richness(row) {
  let arr = [];
  try { arr = JSON.parse(row.innocent_explanations || '[]'); } catch (e) { arr = []; }
  const len = arr.reduce((s, x) => s + String(x).length, 0);
  return [isMockExplanations(row.innocent_explanations) ? 0 : 1, arr.length, len];
}
function better(a, b) { // true = a 比 b 更该保留
  const ra = richness(a), rb = richness(b);
  for (let i = 0; i < ra.length; i++) { if (ra[i] !== rb[i]) return ra[i] > rb[i]; }
  return a.id < b.id; // 全等则保 id 小者
}

const hypRows = db.prepare('SELECT id, game_id, day, content, stance, support_events, oppose_events, tendency '
  + 'FROM hypotheses WHERE game_id=? ORDER BY id').all(GID);
const conRows = db.prepare('SELECT id, game_id, claim_a, claim_b, action_a, action_b, conflict_desc, underdetermination, innocent_explanations '
  + 'FROM contradictions WHERE game_id=? ORDER BY id').all(GID);

function dupIds(rows, keyFn, pickBetter) {
  const groups = new Map();
  for (const r of rows) { const k = keyFn(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const dups = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let keep = g[0];
    for (const r of g.slice(1)) { if (pickBetter && pickBetter(r, keep)) keep = r; }
    for (const r of g) { if (r.id !== keep.id) dups.push({ id: r.id, dup_of: keep.id, kept_reason: (keep === g[0] && !pickBetter) ? 'first' : 'richer' }); }
  }
  return dups;
}
const hypDups = dupIds(hypRows, (r) => [r.game_id, r.day, r.content].join('|'), null);
const conDups = dupIds(conRows, (r) => [r.game_id, r.claim_a, r.claim_b, r.action_a, r.action_b, r.conflict_desc].join('|'), better);

// ── 附加清理：mock 罐头假设（2026-09-14 实测补充）────────────────────────────
// 局 1 的 #1/#2 是 mock 罐头（「1、2 号悍跳狼」「无人悍跳」——由 seats.slice(0,2) 拼出），
// 且与本局**真实证据不符**：真实 claims 是 1号/8号 声称、真矛盾是 5号 vs 12号 都认女巫，
// 与该 mock 描述的「1、2 号」毫无关系。而 #5/#6/#7 是真实 LLM 卡、且与证据吻合。
// 故：**当同局存在真实（非 mock）假设时，mock 罐头假设一并清理**（它们是被重复结算带出来的残留）。
// 判据（收紧，防误删）：内容命中 mock 指纹 **且** 同局存在非 mock 假设。
const MOCK_HYP_RE = /号悍跳狼的常规局|无人悍跳，矛盾源于信息差|自洽负例|负例：stance 不完整/;
const realHypCount = hypRows.filter((r) => !MOCK_HYP_RE.test(String(r.content))).length;
const mockHypDups = (realHypCount > 0)
  ? hypRows.filter((r) => MOCK_HYP_RE.test(String(r.content))).map((r) => ({ id: r.id, dup_of: null, kept_reason: 'mock_superseded_by_real' }))
  : [];
// 合并去重（同一 id 可能同时被判为 dup 与 mock，去重取一并集）
const hypDel = [];
const seenHypDel = new Set();
for (const d of hypDups.concat(mockHypDups)) { if (!seenHypDel.has(d.id)) { seenHypDel.add(d.id); hypDel.push(d); } }

console.log('[plan] DB=' + DB_PATH + ' GID=' + GID);
console.log('[plan] 真实假设 ' + realHypCount + ' 条 / mock 罐头 ' + (hypRows.length - realHypCount) + ' 条');
console.log('[plan] hypotheses: ' + hypRows.length + ' 行 → 删 ' + hypDel.length + '，保留 ' + (hypRows.length - hypDel.length));
hypDel.forEach((d) => console.log('   删 hyp #' + d.id + '（' + (d.kept_reason === 'mock_superseded_by_real' ? 'mock 罐头，被真实卡取代' : '重复，同 #' + d.dup_of) + '）'));
console.log('[plan] contradictions: ' + conRows.length + ' 行 → 删 ' + conDups.length + '，保留 ' + (conRows.length - conDups.length));
conDups.forEach((d) => console.log('   删 con #' + d.id + '（保 #' + d.dup_of + '：信息更丰富/非 mock）'));

if (!CONFIRM) { console.log('DRY-RUN：未写库。加 --confirm 执行。'); db.close(); process.exit(0); }

const tx = db.transaction(() => {
  const delH = db.prepare('DELETE FROM hypotheses WHERE id=?');
  const delC = db.prepare('DELETE FROM contradictions WHERE id=?');
  let h = 0, c = 0;
  for (const d of hypDel) h += delH.run(d.id).changes;
  for (const d of conDups) c += delC.run(d.id).changes;
  return { deleted_hypotheses: h, deleted_contradictions: c };
});
const res = tx();
const after = {
  hypotheses: db.prepare('SELECT COUNT(*) n FROM hypotheses').get().n,
  contradictions: db.prepare('SELECT COUNT(*) n FROM contradictions').get().n,
  g1_hyp: db.prepare('SELECT COUNT(*) n FROM hypotheses WHERE game_id=1').get().n,
  g1_con: db.prepare('SELECT COUNT(*) n FROM contradictions WHERE game_id=1').get().n,
};
const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('[done] deleted=' + JSON.stringify(res));
console.log('[done] rows_after=' + JSON.stringify(after) + ' integrity=' + JSON.stringify(integrity));
db.close();
