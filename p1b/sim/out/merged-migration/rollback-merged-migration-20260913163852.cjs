'use strict';
/*
 * p1b/scripts/_rollback-template.cjs —— 「合并迁移」回滚脚本**模板**。
 * 由 scripts/merged-migration.cjs rollback-script 生成固化实例到 .run-out/backup/（占位符被替换为固化常量）。
 * 用法（生成物）：node rollback-merged-migration-<ts>.cjs --db <库> [--to phase1|pre] [--apply]
 *   --to phase1（默认）：只回退 phase2 —— predictions 恢复原始 CHECK；F4 三件保留。
 *   --to pre          ：两次都回退 —— 再 drop 掉 truth_vault / process_roles / predictions_public。
 * 默认 dry-run；--apply 才写。写入前自动做当前态快照 + sha256。
 * 安全闸：现库若已有 layer='unknown' 行 → 拒绝回滚（旧 CHECK 容纳不了），并给处置指引。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require("E:\\music player\\p1a-terminal\\node_modules\\better-sqlite3");
const ORIGINAL_DDL = "CREATE TABLE predictions (\n  id INTEGER PRIMARY KEY,\n  game_id INTEGER NOT NULL REFERENCES games(id),\n  day INTEGER,\n  source_type TEXT NOT NULL CHECK(source_type IN ('验证点','预测卡')),\n  statement TEXT NOT NULL,\n  assigned_prob REAL CHECK(assigned_prob IS NULL OR (assigned_prob >= 0 AND assigned_prob <= 1)),\n  evidence_json TEXT,\n  created_at TEXT DEFAULT (datetime('now')),\n  resolved_at TEXT,\n  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('true','false','ambiguous')),\n  resolve_note TEXT,\n  layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6')),\n  secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')),\n  engine TEXT,\n  baseline_brier REAL CHECK(baseline_brier IS NULL OR (baseline_brier >= 0 AND baseline_brier <= 1)),\n  public_exposure INTEGER CHECK(public_exposure IS NULL OR public_exposure IN (0,1)),\n  checklist_hash TEXT,\n  gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked'))\n, tautology INTEGER DEFAULT 0, g2_regime TEXT, matures_at TEXT)";
const EXPECTED_ROWS = 1923;
const EXPECTED_DUMP_SHA = "4bd8f607cc299862a7e4f1dace0b9005fa5df39781c01001a9a4239b24495ce0";
const PRE_SNAPSHOT = "E:\\music player\\.scratch\\backup\\p1a-pre-phase2-20260913163707.db";
const GENERATED_AT = "2026-09-13T08:38:52.203Z";
const BACKUPDIR = "E:\\music player\\.scratch\\backup";
const EVIDDIR = "E:\\music player\\.scratch\\merged-migration";
const PROD = "E:\\music player\\p1a-terminal\\data\\p1a.db";

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return (v === undefined || v.startsWith('--')) ? true : v; };
const has = (n) => process.argv.indexOf('--' + n) !== -1;
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const openRw = (p) => { const d = new Database(p, { fileMustExist: true }); d.pragma('busy_timeout = 15000'); return d; };
const openRo = (p) => { const d = new Database(p, { readonly: true, fileMustExist: true }); d.pragma('busy_timeout = 15000'); return d; };

async function main() {
  const dbPath = arg('db', PROD);
  const to = arg('to', 'phase1');
  if (!has('apply')) {
    console.log('DRY-RUN: 将把 ' + dbPath + ' 回滚到 ' + to + '（加 --apply 才真执行）');
    console.log('  原始 DDL : ' + ORIGINAL_DDL.split('\n')[0] + ' ...');
    console.log('  期望行数 : ' + EXPECTED_ROWS + '，期望逐行转储 sha256 : ' + EXPECTED_DUMP_SHA);
    console.log('  迁移前快照: ' + PRE_SNAPSHOT);
    return;
  }
  fs.mkdirSync(BACKUPDIR, { recursive: true });
  const preSnapOut = path.join(BACKUPDIR, 'p1a-rollback-presnap-' + Date.now() + '.db');
  const s = openRo(dbPath); await s.backup(preSnapOut); s.close();
  const rollbackSnapshot = { file: preSnapOut, sha256: sha256File(preSnapOut) };

  const db = openRw(dbPath);
  const unk = db.prepare("SELECT COUNT(*) n FROM predictions WHERE layer='unknown'").get().n;
  if (unk > 0) { db.close(); console.error('ABORT: 现库有 ' + unk + " 行 layer='unknown'，旧 CHECK 容纳不了 → 拒绝回滚（先人工处置这些行）。"); process.exit(3); }
  db.pragma('foreign_keys = OFF');
  const depViews = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='view' AND sql LIKE '%predictions%' ORDER BY name").all();
  const idx = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='predictions' AND sql IS NOT NULL ORDER BY name").all();
  const cols = db.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
  const tx = db.transaction(() => {
    for (const v of depViews) db.exec('DROP VIEW IF EXISTS "' + v.name + '"');
    db.exec('DROP TABLE IF EXISTS new_predictions_old');
    db.exec(ORIGINAL_DDL.replace(/CREATE TABLE (IF NOT EXISTS )?predictions/, 'CREATE TABLE new_predictions_old'));
    const cl = cols.map((c) => '"' + c + '"').join(', ');
    db.exec('INSERT INTO new_predictions_old (' + cl + ') SELECT ' + cl + ' FROM predictions');
    db.exec('DROP TABLE predictions');
    db.exec('ALTER TABLE new_predictions_old RENAME TO predictions');
    for (const i of idx) db.exec(i.sql);
    for (const v of depViews) db.exec(v.sql);
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) throw new Error('foreign_key_check 有 ' + fk.length + ' 条悬空，回滚事务中止');
  });
  tx.exclusive();
  db.pragma('foreign_keys = ON');

  const dropped = [];
  if (to === 'pre') {
    for (const o of [['view', 'predictions_public'], ['table', 'truth_vault'], ['table', 'process_roles']]) {
      const ex = db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get(o[0], o[1]);
      if (ex) { db.exec('DROP ' + o[0].toUpperCase() + ' IF EXISTS "' + o[1] + '"'); dropped.push(o[1]); }
    }
  }
  db.close();

  const ro = openRo(dbPath);
  const cols2 = ro.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
  const rows = ro.prepare('SELECT * FROM predictions ORDER BY id ASC').all();
  const lines = rows.map((r) => JSON.stringify(cols2.map((c) => (r[c] === undefined ? null : r[c]))));
  const dumpSha = crypto.createHash('sha256').update(lines.join('\n') + '\n').digest('hex');
  const integrity = ro.prepare('PRAGMA integrity_check').get().integrity_check;
  const fkErr = ro.prepare('PRAGMA foreign_key_check').all().length;
  const ddlNow = (ro.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='predictions'").get() || {}).sql || '';
  const f4Left = ro.prepare("SELECT name FROM sqlite_master WHERE name IN ('truth_vault','process_roles','predictions_public') ORDER BY name").all().map((x) => x.name);
  ro.close();
  // 用**可写**连接探测旧 CHECK 是否真的回来了（只读连接会得到 SQLITE_READONLY，证明不了 CHECK）
  const probe = openRw(dbPath);
  let unknownStillRejected;
  try {
    const gid = probe.prepare('SELECT id FROM games ORDER BY id LIMIT 1').get().id;
    const i = probe.prepare("INSERT INTO predictions (game_id, source_type, statement, layer) VALUES (?, '预测卡', 'rollback probe', 'unknown')").run(gid);
    unknownStillRejected = { ok: true, id: Number(i.lastInsertRowid), note: '警告：回滚后 unknown 仍可写，说明旧 CHECK 未恢复' };
    probe.prepare('DELETE FROM predictions WHERE id = ?').run(i.lastInsertRowid);
    unknownStillRejected.cleaned_up = true;
  } catch (e) {
    unknownStillRejected = { ok: false, code: (e && e.code) || null, message: String(e.message).split('\n')[0] };
  }
  probe.close();

  const res = { rollback_to: to, db: dbPath, rows: rows.length, rows_ok: rows.length === EXPECTED_ROWS,
    dump_sha256: dumpSha, dump_sha256_ok: dumpSha === EXPECTED_DUMP_SHA, integrity: integrity, fk_check_errors: fkErr,
    layer_check_unknown_removed: ddlNow.indexOf("'unknown'") === -1,
    unknown_insert_after_rollback: unknownStillRejected, f4_objects_left: f4Left, dropped_f4: dropped,
    rollback_snapshot: rollbackSnapshot, pre_migration_snapshot: PRE_SNAPSHOT, generated_at: GENERATED_AT };
  fs.mkdirSync(EVIDDIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDDIR, 'rollback-evidence-' + to + '.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
  const checkBack = unknownStillRejected.ok === false && /CHECK constraint failed/.test(String(unknownStillRejected.message));
  const ok = res.rows_ok && res.dump_sha256_ok && integrity === 'ok' && fkErr === 0
    && res.layer_check_unknown_removed === true && checkBack
    && (to !== 'pre' || res.f4_objects_left.length === 0);
  console.log('ROLLBACK=' + (ok ? 'PASS' : 'FAIL'));
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

