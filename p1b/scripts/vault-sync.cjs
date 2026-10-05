'use strict';
/*
 * vault-sync.cjs —— truth_vault ↔ predictions 真值列同步器（任务 6 · 批次 3 · **F4 同批账本操作**）
 *
 * 背景（为什么存在）：
 *   F4 一期建了 `truth_vault`（真值镜像，`source='predictions'`）作为回测/评分面的真值来源。但它是
 *   **一次性镜像**：`merged-migration.cjs` 的 phase1 只 INSERT 缺行、不 UPDATE 差异行 ⇒ 之后每次
 *   `resolvePrediction` 只写 predictions，vault 不再跟随。2026-09-14 实测：vault 1923 行、predictions 1935 行，
 *   **25 行 outcome/resolved_at/resolve_note 与 predictions 不一致** ⇒ F4 自己的对账函数
 *   `reconcileTruthVault()`（merged-migration.cjs）当前 **ok=false**。本脚本把它恢复一致。
 *
 * 纪律：
 *   ① **只动 truth_vault**：predictions 一字不改（写前写后用全列 dump sha256 证明）。
 *   ② dry-run 默认（零写入）；--confirm 才写，且**先做在线快照**（SQLite 在线备份 API，避免 WAL 未 checkpoint 时拷文件丢数据）＋快照 integrity_check。
 *   ③ 写后重跑对账：`ok` 必须为 true（missing=0 ∧ orphan=0 ∧ diff=0 ∧ vault==total），否则抛错（fail loud）。
 *   ④ 孤儿（vault 有、predictions 无）**只报告不删**（账本侧不可用本脚本裁决历史）。
 *
 * 用法：node p1b/scripts/vault-sync.cjs [--db <path>] [--confirm] [--report <json>] [--snapshot <path>]
 *   默认只读演练；--confirm 落库（单事务）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));

function arg(name, dflt) {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : dflt;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const CONFIRM = process.argv.indexOf('--confirm') >= 0;
const REPORT = arg('report', null);
const SNAP = arg('snapshot', null);
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const ts = () => new Date().toISOString().replace(/[:.]/g, '-');

/** predictions 全列 dump sha256（证明「predictions 一字未改」）。 */
function predictionsDumpHash(db) {
  const rows = db.prepare('SELECT * FROM predictions ORDER BY id').all();
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(JSON.stringify(Object.keys(r).sort().map((k) => r[k])) + '\n');
  return { sha256: h.digest('hex'), rows: rows.length };
}

/** F4 对账（与 merged-migration.cjs reconcileTruthVault 同口径；此处读 readonly 连接亦可跑）。 */
function reconcile(db) {
  const one = (s) => db.prepare(s).get().n;
  const total = one('SELECT COUNT(*) n FROM predictions');
  const vault = one('SELECT COUNT(*) n FROM truth_vault');
  const resolved = one('SELECT COUNT(*) n FROM predictions WHERE outcome IS NOT NULL');
  const missing = one('SELECT COUNT(*) n FROM predictions p LEFT JOIN truth_vault t ON t.prediction_id=p.id WHERE t.prediction_id IS NULL');
  const orphan = one('SELECT COUNT(*) n FROM truth_vault t LEFT JOIN predictions p ON p.id=t.prediction_id WHERE p.id IS NULL');
  const diff = one("SELECT COUNT(*) n FROM predictions p JOIN truth_vault t ON t.prediction_id=p.id"
    + " WHERE IFNULL(t.outcome,'∅') <> IFNULL(p.outcome,'∅')"
    + " OR IFNULL(t.resolved_at,'∅') <> IFNULL(p.resolved_at,'∅')"
    + " OR IFNULL(t.resolve_note,'∅') <> IFNULL(p.resolve_note,'∅')");
  return { predictions_total: total, predictions_resolved: resolved, vault_rows: vault,
    vault_missing: missing, vault_orphan: orphan, truth_column_diff: diff,
    ok: missing === 0 && orphan === 0 && diff === 0 && vault === total,
    ok_ignoring_orphans: missing === 0 && diff === 0 && vault === total + orphan };
}

const DIFF_WHERE = "IFNULL(t.outcome,'∅') <> IFNULL(p.outcome,'∅')"
  + " OR IFNULL(t.resolved_at,'∅') <> IFNULL(p.resolved_at,'∅')"
  + " OR IFNULL(t.resolve_note,'∅') <> IFNULL(p.resolve_note,'∅')";
const INSERT_SQL = 'INSERT INTO truth_vault (prediction_id,outcome,resolved_at,resolve_note,source)'
  + " SELECT id,outcome,resolved_at,resolve_note,'predictions' FROM predictions"
  + ' WHERE id NOT IN (SELECT prediction_id FROM truth_vault)';
const UPDATE_SQL = 'UPDATE truth_vault SET'
  + ' outcome=(SELECT p.outcome FROM predictions p WHERE p.id = truth_vault.prediction_id),'
  + ' resolved_at=(SELECT p.resolved_at FROM predictions p WHERE p.id = truth_vault.prediction_id),'
  + ' resolve_note=(SELECT p.resolve_note FROM predictions p WHERE p.id = truth_vault.prediction_id)'
  + ' WHERE EXISTS (SELECT 1 FROM predictions p WHERE p.id = truth_vault.prediction_id AND ('
  + "  IFNULL(truth_vault.outcome,'∅') <> IFNULL(p.outcome,'∅')"
  + "  OR IFNULL(truth_vault.resolved_at,'∅') <> IFNULL(p.resolved_at,'∅')"
  + "  OR IFNULL(truth_vault.resolve_note,'∅') <> IFNULL(p.resolve_note,'∅')))";

async function main() {
  const report = { generated_at: new Date().toISOString(), script: 'p1b/scripts/vault-sync.cjs', db: DB_PATH, confirm: CONFIRM };
  const ro = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  ro.pragma('busy_timeout = 15000');
  report.before = reconcile(ro);
  report.before_pred_dump = predictionsDumpHash(ro);
  const insertPlan = ro.prepare('SELECT id, outcome, resolved_at, LENGTH(IFNULL(resolve_note,\'\')) note_len FROM predictions p'
    + ' WHERE id NOT IN (SELECT prediction_id FROM truth_vault) ORDER BY id').all();
  const updatePlan = ro.prepare('SELECT p.id, t.outcome t_outcome, p.outcome p_outcome FROM predictions p JOIN truth_vault t ON t.prediction_id=p.id'
    + ' WHERE ' + DIFF_WHERE + ' ORDER BY p.id LIMIT 500').all();
  const orphanIds = ro.prepare('SELECT t.prediction_id id FROM truth_vault t LEFT JOIN predictions p ON p.id=t.prediction_id WHERE p.id IS NULL ORDER BY 1 LIMIT 50').all().map((r) => r.id);
  ro.close();
  report.plan = { insert_n: insertPlan.length, update_n: updatePlan.length, orphan_n: orphanIds.length,
    insert_ids: insertPlan.map((r) => r.id).slice(0, 50), update_ids: updatePlan.map((r) => r.id).slice(0, 100), orphan_ids: orphanIds };
  console.log('[vault-sync] before: ' + JSON.stringify(report.before));
  console.log('[vault-sync] plan: insert=' + report.plan.insert_n + ' update=' + report.plan.update_n + ' orphan=' + report.plan.orphan_n
    + (report.plan.orphan_n ? '（孤儿只报告不删；请人工核）' : ''));
  if (REPORT) fs.writeFileSync(path.resolve(REPORT), JSON.stringify(report, null, 1), 'utf8');

  if (!CONFIRM) { console.log('DRY-RUN：未写库（--confirm 才执行；执行前自动在线快照）。'); return; }

  // ── 快照（在线备份 API；WAL 未 checkpoint 时拷文件会丢数据）──
  const snapPath = SNAP ? path.resolve(SNAP) : path.join(ROOT, '.run-out', 'backup', 'p1a-pre-vaultsync-' + ts() + '.db');
  fs.mkdirSync(path.dirname(snapPath), { recursive: true });
  const src = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  await src.backup(snapPath);
  src.close();
  const snapCheck = new Database(snapPath, { readonly: true, fileMustExist: true });
  report.snapshot = { path: path.relative(ROOT, snapPath).replace(/\\/g, '/'), sha256: sha256File(snapPath),
    integrity: snapCheck.prepare('PRAGMA integrity_check').get().integrity_check,
    predictions_rows: snapCheck.prepare('SELECT COUNT(*) n FROM predictions').get().n };
  snapCheck.close();
  console.log('[vault-sync] snapshot: ' + report.snapshot.path + ' sha256=' + report.snapshot.sha256.slice(0, 16) + '… integrity=' + report.snapshot.integrity);

  // ── 写（单事务）──
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 15000');
  const t0 = Date.now();
  const tx = db.transaction(() => {
    const insRes = db.prepare(INSERT_SQL).run();
    const updRes = db.prepare(UPDATE_SQL).run();
    return { inserted: Number(insRes.changes), updated: Number(updRes.changes) };
  });
  report.write = tx.exclusive();
  report.write.ms = Date.now() - t0;
  report.after = reconcile(db);
  report.after_pred_dump = predictionsDumpHash(db);
  report.predictions_untouched = report.after_pred_dump.sha256 === report.before_pred_dump.sha256
    && report.after_pred_dump.rows === report.before_pred_dump.rows;
  report.integrity_check = db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close();
  console.log('[vault-sync] write: inserted=' + report.write.inserted + ' updated=' + report.write.updated + ' (' + report.write.ms + 'ms)');
  console.log('[vault-sync] after : ' + JSON.stringify(report.after));
  console.log('[vault-sync] predictions 零改动=' + report.predictions_untouched + '｜integrity=' + report.integrity_check);
  if (REPORT) fs.writeFileSync(path.resolve(REPORT), JSON.stringify(report, null, 1), 'utf8');
  if (!report.after.ok_ignoring_orphans) throw new Error('写后对账未通过（missing/diff/行数）：' + JSON.stringify(report.after));
  if (!report.after.ok) console.log('[vault-sync] 注意：存在孤儿（vault 有、predictions 无）⇒ F4 对账 ok=false（孤儿只报告不删，须人工核）');
  if (!report.predictions_untouched) throw new Error('predictions dump sha 变化（违反「只动 vault」纪律）');
  if (report.write.inserted !== report.plan.insert_n) throw new Error('插入数与计划不符 plan=' + report.plan.insert_n + ' actual=' + report.write.inserted);
}
main().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
