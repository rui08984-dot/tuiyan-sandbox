'use strict';
/** 只读审计 predictions_public 面：覆盖度 + 真值列缺席 + truth_preview 字面缺席。零写。 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const DB = process.argv[2] || path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const db = new Database(DB, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 15000');
const g = (s) => db.prepare(s).get();
const cols = db.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
const FORBIDDEN = ['outcome', 'resolved_at', 'resolve_note', 'evidence_json', 'truth_preview'];
const out = {
  db: DB,
  view_exists: !!g("SELECT name FROM sqlite_master WHERE type='view' AND name='predictions_public'"),
  columns: cols,
  leaked_columns: FORBIDDEN.filter((c) => cols.indexOf(c) !== -1),
  rows: g('SELECT COUNT(*) n FROM predictions_public').n,
  cutoff_notnull: g('SELECT COUNT(*) n FROM predictions_public WHERE cutoff_at IS NOT NULL').n,
  resolve_spec_notnull: g('SELECT COUNT(*) n FROM predictions_public WHERE resolve_spec IS NOT NULL').n,
  truth_vault_n: g('SELECT COUNT(*) n FROM truth_vault').n,
  process_roles_n: g('SELECT COUNT(*) n FROM process_roles').n,
  contract_roles: g("SELECT COUNT(*) n FROM process_roles WHERE enforcement='contract'").n,
  kernel_roles: g("SELECT COUNT(*) n FROM process_roles WHERE enforcement='kernel'").n,
};
// 字面泄漏扫描：视图输出里任何一列都不许出现 truth_preview 关键字段名
const lit = g("SELECT COUNT(*) n FROM predictions_public WHERE (COALESCE(cutoff_at,'') || COALESCE(resolve_spec,'') || COALESCE(statement,'')) LIKE '%truth_preview%'").n;
out.truth_preview_literal_hits = lit;
// 视图与 predictions 行集一致性（题面行数必须等于账本行数）
out.row_count_matches_predictions = out.rows === g('SELECT COUNT(*) n FROM predictions').n;
console.log(JSON.stringify(out, null, 1));
db.close();
