'use strict';
/**
 * p1b/scripts/merged-migration.cjs —— 计划内「合并迁移」执行器
 *   D-8.1 unknown 入账（放 open predictions.layer CHECK 的表重建）
 *   ＋ F4 第一阶段（truth_vault 真值表 + predictions_public 只读题面视图 + process_roles 角色表）
 *
 * 依据：docs/specs/2026-09-11-万物可预测性审计器-design.md §8 D-8.1（重建与 F4 合并为同一次计划内账本迁移）
 *       docs/specs/历史回测引擎-规格D2-20260913.md §3.1/§3.2（G-D2-0 第①②③步）
 *       docs/specs/红队R2-复核-20260913.md §2.2（爆炸半径 / 三分表 / 建议路径）
 *
 * 铁律（本脚本内可核）：
 *   · 默认 dry-run（零写入）；真实写入必须显式 --apply。
 *   · 每次写入前先做 SQLite 在线备份（backup API，WAL 一致快照）+ sha256。
 *   · busy_timeout=15000，遇 SQLITE_BUSY 指数退避重试（最多 6 次）；不强杀进程、不删 -wal。
 *   · phase2 走标准 12 步法、单事务；重建前落全量 sqlite_master/索引/FK 声明；重建后逐行全列校验。
 *
 * 用法：
 *   node p1b/scripts/merged-migration.cjs snapshot --db <库> [--label <名>]
 *   node p1b/scripts/merged-migration.cjs phase1   --db <库> [--apply]
 *   node p1b/scripts/merged-migration.cjs phase2   --db <库> [--apply]
 *   node p1b/scripts/merged-migration.cjs verify   --db <库>
 *   node p1b/scripts/merged-migration.cjs rollback-script --db <库> --baseline <快照>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const store = require(path.join(ROOT, 'p1b', 'src', 'db', 'predictionsStore.js'));
const intake = require(path.join(ROOT, 'p1b', 'src', 'db', 'intakeStore.js'));

const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const BACKUP_DIR = path.join(ROOT, '.scratch', 'backup');
const EVID_DIR = path.join(ROOT, '.scratch', 'merged-migration');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const nxt = process.argv[i + 1];
  if (nxt === undefined || nxt.startsWith('--')) return true;
  return nxt;
}
function has(name) { return process.argv.indexOf('--' + name) !== -1; }
function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
/** 打开可写连接：busy_timeout=15000（铁律）。 */
function openRw(p) {
  const db = new Database(p, { fileMustExist: true });
  db.pragma('busy_timeout = 15000');
  return db;
}
function openRo(p) {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 15000');
  return db;
}
/** SQLITE_BUSY 退避重试（指数退避 300ms→9.6s，最多 6 次）；非 BUSY 直接抛。 */
function withBusyRetry(label, fn) {
  let delay = 300;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return fn(); } catch (e) {
      const code = (e && e.code) || '';
      if (code !== 'SQLITE_BUSY' && !/database is locked/i.test(String(e && e.message))) throw e;
      if (attempt === 6) { e.busyRetries = attempt; throw e; }
      console.error('[busy] ' + label + ' 第 ' + attempt + ' 次 BUSY，退避 ' + delay + 'ms 重试');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      delay = Math.min(delay * 2, 9600);
    }
  }
}

/** 全量 sqlite_master 导出（对象清单；含 sql 文本，供迁移前后逐字对照）。 */
function captureMaster(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY type,name").all();
}
/** 某表的 CREATE INDEX 定义（origin='c'，跳过 sqlite_autoindex）。 */
function captureIndexes(db, table) {
  return db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(table);
}
/** 引用某表的视图/触发器定义（重建前后必须逐项对照）。 */
function captureDependents(db, table) {
  return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('view','trigger') AND sql LIKE ? ORDER BY type,name").all('%' + table + '%');
}
/** 逐行全列转储（JSONL，按 id 升序、列序固定）→ {path,sha256,rows}。 */
function dumpTable(db, table, outPath) {
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name);
  const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY id ASC').all();
  const lines = rows.map((r) => JSON.stringify(cols.map((c) => (r[c] === undefined ? null : r[c]))));
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  return { path: outPath, sha256: sha256File(outPath), rows: rows.length, columns: cols };
}
/** 逐行哈希 manifest（id + 全列 sha256）→ {path,sha256,rows}。 */
function manifestTable(db, table, outPath) {
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name);
  const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY id ASC').all();
  const lines = rows.map((r) => {
    const payload = JSON.stringify(cols.map((c) => (r[c] === undefined ? null : r[c])));
    return r.id + '\t' + crypto.createHash('sha256').update(payload).digest('hex');
  });
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  return { path: outPath, sha256: sha256File(outPath), rows: rows.length, columns: cols };
}
/** 一致性快照：SQLite 在线备份 API（读 WAL 一致态，不复制文件）。 */
async function snapshot(dbPath, label, outPath) {
  ensureDir(BACKUP_DIR);
  const out = outPath || path.join(BACKUP_DIR, path.basename(dbPath, '.db') + '-pre-' + label + '-' + ts() + '.db');
  const db = openRo(dbPath);
  await db.backup(out);
  db.close();
  const info = { label: label, source: dbPath, snapshot: out, bytes: fs.statSync(out).size, sha256: sha256File(out), taken_at: new Date().toISOString() };
  const v = openRo(out);
  info.snapshot_integrity = v.prepare('PRAGMA integrity_check').get().integrity_check;
  info.snapshot_predictions_n = v.prepare('SELECT COUNT(*) n FROM predictions').get().n;
  v.close();
  return info;
}

/** 真值对账：truth_vault 与 predictions 真值列逐行一致（NULL 归一化比较）。 */
function reconcileTruthVault(db) {
  const total = db.prepare('SELECT COUNT(*) n FROM predictions').get().n;
  const vault = db.prepare('SELECT COUNT(*) n FROM truth_vault').get().n;
  const resolved = db.prepare('SELECT COUNT(*) n FROM predictions WHERE outcome IS NOT NULL').get().n;
  const missing = db.prepare('SELECT COUNT(*) n FROM predictions p LEFT JOIN truth_vault t ON t.prediction_id=p.id WHERE t.prediction_id IS NULL').get().n;
  const orphan = db.prepare('SELECT COUNT(*) n FROM truth_vault t LEFT JOIN predictions p ON p.id=t.prediction_id WHERE p.id IS NULL').get().n;
  const diff = db.prepare("SELECT COUNT(*) n FROM predictions p JOIN truth_vault t ON t.prediction_id=p.id"
    + " WHERE IFNULL(t.outcome,'∅') <> IFNULL(p.outcome,'∅')"
    + " OR IFNULL(t.resolved_at,'∅') <> IFNULL(p.resolved_at,'∅')"
    + " OR IFNULL(t.resolve_note,'∅') <> IFNULL(p.resolve_note,'∅')").get().n;
  return { predictions_total: total, predictions_resolved: resolved, vault_rows: vault, vault_missing: missing, vault_orphan: orphan, truth_column_diff: diff, ok: missing === 0 && orphan === 0 && diff === 0 && vault === total };
}

/** 阶段 1：additive 真值表 + 角色表 + 只读题面视图（单事务；不碰 predictions 任何既有列）。 */
async function phase1(dbPath, apply) {
  ensureDir(EVID_DIR);
  const ro = openRo(dbPath);
  const preMaster = captureMaster(ro);
  const pre = {
    predictions_n: ro.prepare('SELECT COUNT(*) n FROM predictions').get().n,
    predictions_sql: (preMaster.filter((o) => o.type === 'table' && o.name === 'predictions')[0] || {}).sql || null,
    truth_vault_exists: preMaster.some((o) => o.name === 'truth_vault'),
    process_roles_exists: preMaster.some((o) => o.name === 'process_roles'),
    predictions_public_exists: preMaster.some((o) => o.name === 'predictions_public'),
    objects_n: preMaster.length,
  };
  ro.close();
  const plan = { phase: 1, db: dbPath, apply: !!apply, pre: pre };
  if (!apply) { console.log(JSON.stringify(Object.assign({ dry_run: true }, plan), null, 1)); return plan; }

  plan.snapshot = await snapshot(dbPath, 'phase1');
  const db = openRw(dbPath);
  const t0 = Date.now();
  const tx = db.transaction(() => {
    db.exec(intake.SCHEMA_PROCESS_ROLES);
    db.exec(intake.SCHEMA_TRUTH_VAULT);
    const ins = db.prepare('INSERT OR IGNORE INTO process_roles (role,may_read,may_write,forbidden,enforcement,note) VALUES (?,?,?,?,?,?)');
    for (const r of intake.PROCESS_ROLE_SEEDS) ins.run(r.role, JSON.stringify(r.may_read), JSON.stringify(r.may_write), JSON.stringify(r.forbidden), r.enforcement, r.note);
    db.prepare('INSERT INTO truth_vault (prediction_id,outcome,resolved_at,resolve_note,source)'
      + " SELECT id,outcome,resolved_at,resolve_note,'predictions' FROM predictions"
      + ' WHERE id NOT IN (SELECT prediction_id FROM truth_vault)').run();
    db.exec('DROP VIEW IF EXISTS predictions_public');
    db.exec(intake.PREDICTIONS_PUBLIC_SQL);
  });
  plan.busy_retries = 0;
  withBusyRetry('phase1', () => tx.exclusive());
  plan.ms = Date.now() - t0;
  plan.post = reconcileTruthVault(db);
  plan.post.predictions_sql_unchanged = ((captureMaster(db).filter((o) => o.type === 'table' && o.name === 'predictions')[0] || {}).sql || null) === pre.predictions_sql;
  plan.post.roles = db.prepare('SELECT role,enforcement,may_read,forbidden FROM process_roles ORDER BY role').all();
  plan.post.view_columns = db.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
  plan.post.view_rows = db.prepare('SELECT COUNT(*) n FROM predictions_public').get().n;
  db.close();
  fs.writeFileSync(path.join(EVID_DIR, 'phase1-evidence.json'), JSON.stringify(plan, null, 1));
  console.log(JSON.stringify(plan, null, 1));
  return plan;
}
const tableSql = (master, name) => ((master.filter((o) => o.type === 'table' && o.name === name)[0] || {}).sql) || null;
const colSig = (db, t) => JSON.stringify(db.prepare('PRAGMA table_info(' + t + ')').all());
const idxSig = (db, t) => JSON.stringify(captureIndexes(db, t));

/** 逐行比较两段 DDL 文本：返回差异行（用于证明"只动了 layer CHECK 一行"）。 */
function sqlDiffLines(a, b) {
  const A = String(a).split('\n'), B = String(b).split('\n');
  const changed = [];
  if (A.length === B.length) {
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) changed.push({ line: i + 1, before: A[i], after: B[i] });
  }
  return { len_equal: A.length === B.length, changed: changed };
}

/** 语义级 DDL 比对（严格判据）：
 *  归一空白 + 归一 RENAME 后的表名引号 → 新的 DDL **恰好等于** 旧 DDL 在
 *  primary layer CHECK 内插入一处 ",'unknown'"。据此可证「除放开 unknown 外零语义改动」。 */
function semanticDiff(a, b) {
  const norm = (s) => String(s)
    .replace(/"predictions"/g, 'predictions')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();
  const A = norm(a), B = norm(b);
  const needle = ",'unknown'";
  const occ = B.split("'unknown'").length - 1;
  const site = B.indexOf(needle);
  const lStart = B.indexOf('layer TEXT CHECK(layer IS NULL OR layer IN(');
  const lEnd = lStart === -1 ? -1 : B.indexOf(')', lStart);
  const inLayer = site !== -1 && lStart !== -1 && site >= lStart && site < lEnd;
  const bMinus = site === -1 ? B : B.slice(0, site) + B.slice(site + needle.length);
  return {
    normalized_before: A, normalized_after: B,
    normalized_equal: A === B,
    unknown_literal_occurrences_in_after: occ,
    insertion_needle: needle, insertion_site_in_layer_check: inLayer,
    remove_insertion_equals_before: bMinus === A,
    only_change_is_unknown_in_layer_check: bMinus === A && occ === 1 && inLayer,
  };
}

/** 重建后逐项校验（对照迁移前快照/清单）。checks 全绿才 ok。 */
function verifyPredictionsRebuild(dbPath, pre) {
  const ro = openRo(dbPath);
  const master = captureMaster(ro);
  const post = {
    predictions_sql: tableSql(master, 'predictions'),
    predictions_columns: colSig(ro, 'predictions'),
    predictions_indexes: captureIndexes(ro, 'predictions'),
    triggers: ro.prepare("SELECT type,name,sql FROM sqlite_master WHERE type='trigger'").all(),
    dependents: captureDependents(ro, 'predictions'),
    fk_list: JSON.stringify(ro.prepare('PRAGMA foreign_key_list(predictions)').all()),
    rows: ro.prepare('SELECT COUNT(*) n FROM predictions').get().n,
    integrity: ro.prepare('PRAGMA integrity_check').get().integrity_check,
    fk_check_errors: ro.prepare('PRAGMA foreign_key_check').all().length,
    views_all: ro.prepare("SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY name").all(),
  };
  post.dump = dumpTable(ro, 'predictions', path.join(EVID_DIR, 'predictions-after.jsonl'));
  post.manifest = manifestTable(ro, 'predictions', path.join(EVID_DIR, 'predictions-after.manifest'));
  ro.close();
  const diff = sqlDiffLines(pre.predictions_sql, post.predictions_sql);
  const sem = semanticDiff(pre.predictions_sql, post.predictions_sql);
  const checks = {
    rows_equal: post.rows === pre.rows,
    dump_sha256_equal: post.dump.sha256 === pre.dump.sha256,
    manifest_sha256_equal: post.manifest.sha256 === pre.manifest.sha256,
    columns_equal: post.predictions_columns === pre.predictions_columns,
    indexes_equal: JSON.stringify(post.predictions_indexes) === JSON.stringify(pre.predictions_indexes),
    triggers_equal: JSON.stringify(post.triggers) === JSON.stringify(pre.triggers),
    dependents_equal: JSON.stringify(post.dependents) === JSON.stringify(pre.dependents),
    fk_equal: post.fk_list === pre.fk_list,
    views_equal: JSON.stringify(post.views_all) === JSON.stringify(pre.views_all),
    integrity_ok: post.integrity === 'ok',
    fk_check_clean: post.fk_check_errors === 0,
    sql_diff_is_layer_check_only: sem.only_change_is_unknown_in_layer_check === true,
  };
  const names = Object.keys(checks);
  const ok = names.every((k) => checks[k] === true);
  const info = {
    raw_sql_text_differs: diff.changed.length > 0 || !diff.len_equal,
    raw_sql_note: '原表 DDL 由历史 ALTER 追加过列（末行合并），故原文本换行位置与新 DDL 不同；这是格式差，不是语义差',
    sql_diff_lines: diff.changed,
    semantic_diff: sem,
  };
  return { ok: ok, checks: checks, info: info,
    before: { sql: pre.predictions_sql, dump_sha256: pre.dump.sha256, manifest_sha256: pre.manifest.sha256, rows: pre.rows, indexes: pre.predictions_indexes, fk_list: pre.fk_list, views: pre.views_all, triggers: pre.triggers },
    after: { sql: post.predictions_sql, dump_sha256: post.dump.sha256, manifest_sha256: post.manifest.sha256, rows: post.rows, indexes: post.predictions_indexes, fk_list: post.fk_list, views: post.views_all, triggers: post.triggers, integrity: post.integrity, fk_check_errors: post.fk_check_errors } };
}

/** 阶段 2：标准 12 步法单事务重建 predictions（放开 layer CHECK 允许 'unknown'）。 */
async function phase2(dbPath, apply) {
  ensureDir(EVID_DIR);
  const ro = openRo(dbPath);
  const preMaster = captureMaster(ro);
  const pre = {
    predictions_sql: tableSql(preMaster, 'predictions'),
    predictions_columns: colSig(ro, 'predictions'),
    predictions_indexes: captureIndexes(ro, 'predictions'),
    triggers: ro.prepare("SELECT type,name,sql FROM sqlite_master WHERE type='trigger'").all(),
    dependents: captureDependents(ro, 'predictions'),
    fk_list: JSON.stringify(ro.prepare('PRAGMA foreign_key_list(predictions)').all()),
    rows: ro.prepare('SELECT COUNT(*) n FROM predictions').get().n,
    integrity: ro.prepare('PRAGMA integrity_check').get().integrity_check,
    fk_check_errors: ro.prepare('PRAGMA foreign_key_check').all().length,
    unknown_layer_rows: ro.prepare("SELECT COUNT(*) n FROM predictions WHERE layer='unknown'").get().n,
  };
  pre.views_all = ro.prepare("SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY name").all();
  pre.dump = dumpTable(ro, 'predictions', path.join(EVID_DIR, 'predictions-before.jsonl'));
  pre.manifest = manifestTable(ro, 'predictions', path.join(EVID_DIR, 'predictions-before.manifest'));
  ro.close();
  const plan = { phase: 2, db: dbPath, apply: !!apply, pre: pre };
  if (!apply) {
    delete plan.pre.dump; delete plan.pre.manifest;
    console.log(JSON.stringify(Object.assign({ dry_run: true }, plan), null, 1));
    return plan;
  }
  plan.snapshot = await snapshot(dbPath, 'phase2');
  const db = openRw(dbPath);
  const t0 = Date.now();
  db.pragma('foreign_keys = OFF');                       // 步骤 1（事务外）
  const oldCols = db.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
  const depViews = captureDependents(db, 'predictions').filter((d) => d.type === 'view');
  const preIdx = captureIndexes(db, 'predictions');
  const preTrig = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%predictions%' ORDER BY name").all();
  const tx = db.transaction(() => {
    for (const v of depViews) db.exec('DROP VIEW IF EXISTS "' + v.name + '"');   // 步骤 3/9 前置：先摘依赖视图
    db.exec('DROP TABLE IF EXISTS new_predictions');
    db.exec(store.predictionsTableDdl('new_predictions'));                         // 步骤 4
    const cl = oldCols.map((c) => '"' + c + '"').join(', ');
    db.exec('INSERT INTO new_predictions (' + cl + ') SELECT ' + cl + ' FROM predictions');  // 步骤 5
    db.exec('DROP TABLE predictions');                                            // 步骤 6
    db.exec('ALTER TABLE new_predictions RENAME TO predictions');                  // 步骤 7
    for (const ix of preIdx) db.exec(ix.sql);                                     // 步骤 8
    for (const tr of preTrig) db.exec(tr.sql);
    for (const v of depViews) db.exec(v.sql);                                     // 步骤 9
    const fkErr = db.prepare('PRAGMA foreign_key_check').all();                    // 步骤 10
    if (fkErr.length) throw new Error('foreign_key_check 有 ' + fkErr.length + ' 条悬空，事务回滚');
  });
  plan.busy_retries = 0;
  withBusyRetry('phase2', () => tx.exclusive());   // BEGIN EXCLUSIVE + busy_timeout=15000，BUSY 指数退避重试
  plan.ms = Date.now() - t0;
  db.pragma('foreign_keys = ON');                        // 步骤 12
  db.close();
  plan.post = verifyPredictionsRebuild(dbPath, pre);
  fs.writeFileSync(path.join(EVID_DIR, 'phase2-evidence.json'), JSON.stringify(plan, null, 1));
  console.log(JSON.stringify(plan, null, 1));
  return plan;
}

/** recheck：只读重验（从 phase2-evidence.json 取迁移前证据 + 现库重算），用于修正校验器后复验。 */
function recheck(dbPath) {
  const evPath = path.join(EVID_DIR, 'phase2-evidence.json');
  const ev = JSON.parse(fs.readFileSync(evPath, 'utf8'));
  const post = verifyPredictionsRebuild(dbPath, ev.pre);
  ev.post = post;
  ev.rechecked_at = new Date().toISOString();
  fs.writeFileSync(evPath, JSON.stringify(ev, null, 1));
  console.log('recheck ok=' + post.ok);
  console.log(JSON.stringify(post.checks, null, 1));
  console.log('semantic_diff=' + JSON.stringify(post.info.semantic_diff));
  console.log('before sql=' + post.before.sql);
  console.log('after  sql=' + post.after.sql);
  if (!post.ok) process.exit(1);
}

/** 写入验收（**只在副本库上**，生产库零写）：
 *  red  = 迁移前快照副本：layer='unknown' 必须被 CHECK 拒绝（旧约束的证据）
 *  green= 迁移后现库副本：layer='unknown' 必须被接受 */
async function unknownAccept(dbPath) {
  ensureDir(EVID_DIR);
  const ev = JSON.parse(fs.readFileSync(path.join(EVID_DIR, 'phase2-evidence.json'), 'utf8'));
  const preSnap = ev.snapshot.snapshot;
  const out = { generated_at: new Date().toISOString(), production_db: dbPath, pre_snapshot: preSnap,
    note: '全部 INSERT 只发生在副本库；生产库仅做只读对账' };
  const mkCopy = async (from, to) => {
    for (const f of [to, to + '-wal', to + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
    const s = openRo(from); await s.backup(to); s.close(); return to;
  };
  const attempt = (file, layer, sec, label) => {
    const db = openRw(file);
    db.pragma('foreign_keys = ON');
    const gid = db.prepare('SELECT id FROM games ORDER BY id LIMIT 1').get().id;
    let r;
    try {
      const i = db.prepare('INSERT INTO predictions (game_id, source_type, statement, layer, secondary_layer) VALUES (?,?,?,?,?)')
        .run(gid, '预测卡', 'D-8.1 unknown 入账验收（副本库临时行）', layer, sec);
      r = { ok: true, id: Number(i.lastInsertRowid) };
    } catch (e) { r = { ok: false, code: (e && e.code) || null, message: String(e.message).split('\n')[0] }; }
    if (r.ok) { db.prepare('DELETE FROM predictions WHERE id = ?').run(r.id); r.cleaned_up = true; }
    db.close();
    r.label = label; r.layer = layer; r.secondary_layer = sec;
    return r;
  };
  const preCopy = await mkCopy(preSnap, path.join(EVID_DIR, 'unknown-accept-pre.db'));
  const postCopy = await mkCopy(dbPath, path.join(EVID_DIR, 'unknown-accept-post.db'));
  out.red_before_migration = attempt(preCopy, 'unknown', null, '迁移前：primary layer=unknown');
  out.green_after_migration = attempt(postCopy, 'unknown', null, '迁移后：primary layer=unknown');
  out.green_secondary_L4 = attempt(postCopy, 'unknown', 'L4', '迁移后：unknown + secondary=L4');
  out.still_rejected_secondary_unknown = attempt(postCopy, 'L1', 'unknown', '迁移后：secondary=unknown 仍应被拒');
  out.still_rejected_L7 = attempt(postCopy, 'L7', null, '迁移后：非法层 L7 仍应被拒');
  out.info_L4_primary = attempt(postCopy, 'L4', null, '信息项：DB CHECK 允许 L4 作 primary（L4 禁作 primary 是接题层规则，非 DB 约束）');
  const prod = openRo(dbPath);
  out.truth_vault_reconcile = reconcileTruthVault(prod);
  out.roles = prod.prepare('SELECT role,enforcement FROM process_roles ORDER BY role').all();
  prod.close();
  out.pass = out.red_before_migration.ok === false && out.green_after_migration.ok === true
    && out.green_secondary_L4.ok === true && out.still_rejected_secondary_unknown.ok === false
    && out.still_rejected_L7.ok === false && out.truth_vault_reconcile.ok === true;
  fs.writeFileSync(path.join(EVID_DIR, 'unknown-accept-evidence.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  console.log('UNKNOWN_ACCEPT=' + (out.pass ? 'PASS' : 'FAIL'));
  if (!out.pass) process.exit(1);
}

/** 生成固化回滚脚本到 .scratch/backup/（把 phase2 前的原始 DDL / 期望行数 / 逐行 sha256 / 快照路径钉死进去）。 */
function takeRollbackScript(dbPath, baseline) {
  const ev = JSON.parse(fs.readFileSync(path.join(EVID_DIR, 'phase2-evidence.json'), 'utf8'));
  const tpl = fs.readFileSync(path.join(ROOT, 'p1b', 'scripts', '_rollback-template.cjs'), 'utf8');
  const map = {
    '@@BS3@@': JSON.stringify(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3')),
    '@@ORIGINAL_DDL@@': JSON.stringify(ev.pre.predictions_sql),
    '@@EXPECTED_ROWS@@': String(ev.pre.rows),
    '@@EXPECTED_DUMP_SHA@@': JSON.stringify(ev.pre.dump.sha256),
    '@@SNAPSHOT@@': JSON.stringify(typeof baseline === 'string' ? baseline : ev.snapshot.snapshot),
    '@@GENERATED_AT@@': JSON.stringify(new Date().toISOString()),
    '@@BACKUPDIR@@': JSON.stringify(BACKUP_DIR),
    '@@EVIDDIR@@': JSON.stringify(EVID_DIR),
    '@@PROD@@': JSON.stringify(path.resolve(ROOT, dbPath)),
  };
  let out = tpl;
  for (const k of Object.keys(map)) out = out.split(k).join(map[k]);
  const leftover = Object.keys(map).filter((k) => out.indexOf(k) !== -1);
  if (leftover.length) throw new Error('模板占位符未全部替换：' + leftover.join(','));
  ensureDir(BACKUP_DIR);
  const file = path.join(BACKUP_DIR, 'rollback-merged-migration-' + ts() + '.cjs');
  fs.writeFileSync(file, out);
  const info = { rollback_script: file, bytes: fs.statSync(file).size, sha256: sha256File(file),
    pinned: { original_ddl_rows: ev.pre.rows, original_dump_sha256: ev.pre.dump.sha256, pre_phase2_snapshot: ev.snapshot.snapshot, phase2_snapshot_sha256: ev.snapshot.sha256 } };
  fs.writeFileSync(path.join(EVID_DIR, 'rollback-script.json'), JSON.stringify(info, null, 1));
  console.log(JSON.stringify(info, null, 1));
}

/** 事后只读体检（不写）：F4 三件 + layer CHECK + 真值对账 + 完整性/索引/视图清单。 */
function verify(dbPath) {
  const db = openRo(dbPath);
  const master = captureMaster(db);
  const has = (t, n) => master.some((o) => o.type === t && o.name === n);
  const ddl = tableSql(master, 'predictions') || '';
  const vcols = db.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
  const out = {
    db: dbPath,
    predictions_rows: db.prepare('SELECT COUNT(*) n FROM predictions').get().n,
    predictions_resolved: db.prepare('SELECT COUNT(*) n FROM predictions WHERE outcome IS NOT NULL').get().n,
    predictions_unknown_layer_rows: db.prepare("SELECT COUNT(*) n FROM predictions WHERE layer='unknown'").get().n,
    predictions_layer_check_allows_unknown: ddl.indexOf("'unknown'") !== -1,
    secondary_layer_check_unchanged: /secondary_layer IS NULL OR secondary_layer IN \('L1','L2','L3','L4','L5','L6'\)/.test(ddl),
    integrity_check: db.prepare('PRAGMA integrity_check').get().integrity_check,
    foreign_key_check_errors: db.prepare('PRAGMA foreign_key_check').all().length,
    process_roles_exists: has('table', 'process_roles'),
    truth_vault_exists: has('table', 'truth_vault'),
    predictions_public_exists: has('view', 'predictions_public'),
    truth_columns_exposed_in_view: ['outcome', 'resolved_at', 'resolve_note', 'evidence_json'].filter((c) => vcols.indexOf(c) !== -1),
    truth_vault_reconcile: reconcileTruthVault(db),
    roles: db.prepare('SELECT role,enforcement FROM process_roles ORDER BY role').all(),
    predictions_indexes: captureIndexes(db, 'predictions'),
    views: db.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all().map((x) => x.name),
  };
  out.ok = out.integrity_check === 'ok' && out.foreign_key_check_errors === 0 && out.process_roles_exists
    && out.truth_vault_exists && out.predictions_public_exists && out.truth_columns_exposed_in_view.length === 0
    && out.truth_vault_reconcile.ok === true && out.predictions_layer_check_allows_unknown === true
    && out.secondary_layer_check_unchanged === true;
  console.log(JSON.stringify(out, null, 1));
  if (!out.ok) process.exit(1);
}

/** 迁移前/后 sqlite_master 逐项对照（pre=phase1 快照，post=现库）→ 新增/删除/定义变更三张清单。 */
function masterDiff(dbPath, preSnapshot) {
  const a = openRo(preSnapshot); const A = captureMaster(a); a.close();
  const b = openRo(dbPath); const B = captureMaster(b); b.close();
  const key = (o) => o.type + ':' + o.name;
  const mapA = {}; const mapB = {};
  for (const o of A) mapA[key(o)] = o;
  for (const o of B) mapB[key(o)] = o;
  const out = {
    pre_snapshot: preSnapshot, post_db: dbPath,
    objects_before: A.length, objects_after: B.length,
    added: B.filter((o) => !mapA[key(o)]).map((o) => ({ type: o.type, name: o.name })),
    removed: A.filter((o) => !mapB[key(o)]).map((o) => ({ type: o.type, name: o.name })),
    changed: B.filter((o) => mapA[key(o)] && mapA[key(o)].sql !== o.sql)
      .map((o) => ({ type: o.type, name: o.name, before: mapA[key(o)].sql, after: o.sql })),
    unchanged_names: B.filter((o) => mapA[key(o)] && mapA[key(o)].sql === o.sql).map((o) => o.name),
  };
  fs.writeFileSync(path.join(EVID_DIR, 'master-diff.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ objects_before: out.objects_before, objects_after: out.objects_after,
    added: out.added, removed: out.removed, changed_names: out.changed.map((c) => c.name),
    unchanged_count: out.unchanged_names.length }, null, 1));
  return out;
}

async function main() {
  const cmd = process.argv[2];
  const dbPath = arg('db', PROD);
  const apply = has('apply');
  ensureDir(EVID_DIR);
  if (cmd === 'snapshot') {
    const s = await snapshot(dbPath, arg('label', 'manual'), arg('out', null));
    console.log(JSON.stringify(s, null, 1));
    return;
  }
  if (cmd === 'phase1') { await phase1(dbPath, apply); return; }
  if (cmd === 'phase2') { await phase2(dbPath, apply); return; }
  if (cmd === 'unknown-accept') { await unknownAccept(dbPath); return; }
  if (cmd === 'master-diff') { masterDiff(dbPath, arg('pre', path.join(BACKUP_DIR, 'p1a-pre-phase1-20260913163521.db'))); return; }
  if (cmd === 'recheck') { recheck(dbPath); return; }
  if (cmd === 'verify') { verify(dbPath); return; }
  if (cmd === 'rollback-script') { takeRollbackScript(dbPath, arg('baseline', null)); return; }
  console.error('用法: snapshot|phase1|phase2|recheck|verify|unknown-accept|rollback-script --db <库> [--apply]');
  process.exit(2);
}
main().catch((e) => { console.error('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });


