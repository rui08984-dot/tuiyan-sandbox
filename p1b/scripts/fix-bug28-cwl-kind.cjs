#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/fix-bug28-cwl-kind.cjs —— 修正 bug-28 遗留脏数据（2026-09-14）
 *
 * 病象：v1 写入器 `corpus-forward.cjs` 把 kind 硬编码为 `cwl_ssq_red_contains`，
 *   于是「蓝球为奇数」题（combo=blueodd）被写成 red_contains + ball=null。
 *   解析器 `cwl_ssq_red_contains` 在 ball=null 时 `indexOf(null)` 恒 -1 ⇒ **恒判 false**
 *   ⇒ 若上游跑批即把**错误真值**写进账本（账本不可变 ⇒ 不可逆污染）。
 *
 * 现状（修前实测）：3 行受影响，**全部未 resolve**（0 污染）——id=732/734/736。
 *
 * 修法：把这 3 行的 `evidence[0].resolve` 改写为 `{kind:'cwl_ssq_blue_odd', issue}`（与题面「蓝球为奇数」一致，
 *   与 v2/b2/oct 三批的正确写法同构）；同时删除无意义的 `ball:null` / `blue_odd` 冗余键。
 *
 * 用法：
 *   node p1b/scripts/fix-bug28-cwl-kind.cjs                 # dry-run（默认，零写）
 *   node p1b/scripts/fix-bug28-cwl-kind.cjs --confirm       # 真写
 *   node p1b/scripts/fix-bug28-cwl-kind.cjs --db <path>     # 指定库
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const CONFIRM = process.argv.indexOf('--confirm') >= 0;
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const D = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const db = new D(DB_PATH);

// 定位：kind=red_contains 且 ball 为 null（即 bug-28 特征）
const rows = db.prepare("SELECT p.id, p.outcome, p.evidence_json, p.statement, "
  + "json_extract(e.value,'$.resolve.issue') iss "
  + "FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind')='cwl_ssq_red_contains' "
  + "AND json_extract(e.value,'$.resolve.ball') IS NULL ORDER BY p.id").all();

console.log('[plan] DB=' + DB_PATH);
console.log('[plan] 命中（kind=red_contains 且 ball=null）: ' + rows.length + ' 行');
for (const r of rows) {
  console.log('   id=' + r.id + ' issue=' + r.iss + ' outcome=' + (r.outcome === null ? '未结' : r.outcome)
    + ' | ' + String(r.statement).replace(/【[^】]*】/g, '').slice(0, 40));
}
// 安全检查：必须全部未 resolve（已 resolve 的错判需另立处置，不静默改）
const resolved = rows.filter((r) => r.outcome !== null);
if (resolved.length) {
  console.error('[ABORT] 有 ' + resolved.length + ' 行**已 resolve**——已污染行不可静默改写，须另行裁定: '
    + resolved.map((r) => r.id).join(','));
  db.close(); process.exit(3);
}

if (!CONFIRM) { console.log('DRY-RUN：未写库。加 --confirm 执行。'); db.close(); process.exit(0); }

const tx = db.transaction(() => {
  let n = 0, blocked = 0;
  for (const r of rows) {
    const ev = JSON.parse(r.evidence_json || '[]');
    if (!ev[0] || !ev[0].resolve) continue;
    const before = JSON.stringify(ev[0].resolve);
    ev[0].resolve = { kind: 'cwl_ssq_blue_odd', issue: String(ev[0].resolve.issue) }; // 与题面「蓝球为奇数」对齐
    const after = JSON.stringify(ev[0].resolve);
    // 收口 A（2026-09-28）：把上面的「先查后写」升级成 SQL 里的原子条件。
    // 上面的 abort 只是 SELECT 时刻的快照——从查出到写回之间若该行被别处落定，裸写就会把
    // 错误真值写进已落定行（正是本文件头警告的不可逆污染）。`AND outcome IS NULL` 与赋值同在
    // 一条语句里，靠 SQLite 单语句原子性挡掉这个 TOCTOU；changes=0 ⇒ 拒改并如实计数。
    if (db.prepare('UPDATE predictions SET evidence_json=? WHERE id=? AND outcome IS NULL').run(JSON.stringify(ev), r.id).changes === 0) {
      blocked++;
      console.log('   SKIP-SETTLED id=' + r.id + '（已落定，拒改 resolve spec）');
      continue;
    }
    n++;
    console.log('   fixed id=' + r.id + ' : ' + before + '  =>  ' + after);
  }
  return { n, blocked };
});
const { n: fixed, blocked } = tx();
const integrity = db.prepare('PRAGMA integrity_check').get();
const left = db.prepare("SELECT COUNT(*) n FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind')='cwl_ssq_red_contains' AND json_extract(e.value,'$.resolve.ball') IS NULL").get().n;
console.log('[done] fixed=' + fixed + ' | 守卫拒改(已落定)=' + blocked + ' | 剩余 ball=null 行=' + left + ' | integrity=' + JSON.stringify(integrity));
db.close();
