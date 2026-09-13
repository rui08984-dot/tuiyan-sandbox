'use strict';
/**
 * p1b/scripts/gd2-0-accept.cjs —— D2 硬门 G-D2-0 三点可执行验收（规格 D2 §3.2）
 *   ①角色表存在  ②predictions_public 只读题面视图可用  ③回测进程 SELECT ... FROM truth_vault 必须失败
 *
 * 隔离级别诚实声明（本脚本自身举证）：
 *   · SQLite 单库单进程**没有内核级角色**。process_roles 是**契约级**声明（enforcement='contract'，
 *     库里 kernel 角色数应为 0）。
 *   · 唯一带内核级强制的面 = 独立 public surface 文件：回测进程以 readonly 只打开该文件，
 *     truth_vault 在该文件里**物理不存在** ⇒ SELECT 必然 no such table。
 *   · 反证（必须跑、必须落收据）：同一个 SELECT 直连生产库**能成功**（本脚本把它如实记为
 *     contract_only_leak_reachable=true）。所以本阶段是「面级隔离＋契约隔离」，不是内核级隔离。
 *
 * 用法：node p1b/scripts/gd2-0-accept.cjs [--db <生产库>] [--out <surface 文件>]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SURFACE = path.join(ROOT, '.scratch', 'backtest', 'predictions-public-surface.db');
const EVID = path.join(ROOT, '.scratch', 'merged-migration', 'gd2-0-evidence.json');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const nxt = process.argv[i + 1];
  return (nxt === undefined || nxt.startsWith('--')) ? true : nxt;
}
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";
/** 捕获 SQL 失败原文（point ③ 的证据形态）。 */
function tryRead(conn, sql) {
  try { return { ok: true, rows: conn.prepare(sql).all().length }; }
  catch (e) { return { ok: false, code: (e && e.code) || null, message: String((e && e.message) || e).split('\n')[0] }; }
}
/** 建独立 public surface 文件：从**只读**生产连接读入内存、再用新连接落盘（禁在生产连接上 ATTACH 建文件：
 *  readonly 主连接 ATTACH 新文件会 SQLITE_CANTOPEN）。文件内仅 predictions_public + public_surface_meta。 */
function buildPublicSurface(prodDb, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  for (const f of [outFile, outFile + '-wal', outFile + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* 不存在即忽略 */ } }
  const src = new Database(prodDb, { readonly: true, fileMustExist: true });
  src.pragma('busy_timeout = 15000');
  const info = src.prepare('PRAGMA table_info(predictions_public)').all();
  const cols = info.map((c) => c.name);
  const rows = src.prepare('SELECT * FROM predictions_public ORDER BY prediction_id ASC').all();
  src.close();
  const pick = (r, c) => (r[c] === undefined ? null : r[c]);
  const payload = rows.map((r) => JSON.stringify(cols.map((c) => pick(r, c)))).join('\n') + '\n';
  const fp = crypto.createHash('sha256').update(payload).digest('hex');
  const db = new Database(outFile);
  db.pragma('busy_timeout = 15000');
  db.exec('CREATE TABLE predictions_public (' + info.map((c) => '"' + c.name + '" ' + (c.type || 'BLOB')).join(', ') + ')');
  db.exec('CREATE TABLE public_surface_meta (k TEXT PRIMARY KEY, v TEXT)');
  const ins = db.prepare('INSERT INTO predictions_public (' + cols.map((c) => '"' + c + '"').join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')');
  db.transaction(() => { for (const r of rows) ins.run(cols.map((c) => pick(r, c))); }).exclusive();
  const put = db.prepare('INSERT INTO public_surface_meta (k, v) VALUES (?, ?)');
  put.run('source_db', prodDb);
  put.run('generated_at', new Date().toISOString());
  put.run('rows', String(rows.length));
  put.run('columns', JSON.stringify(cols));
  put.run('rows_fingerprint_sha256', fp);
  put.run('truth_objects', '0 (by construction: only predictions_public + public_surface_meta)');
  db.close();
  return { file: outFile, bytes: fs.statSync(outFile).size, sha256: sha256File(outFile), rows: rows.length, columns: cols, rows_fingerprint_sha256: fp };
}
/** ① 角色表存在（并如实标注契约级 / 内核级计数）。 */
function checkRoleTable(prodDb) {
  const db = new Database(prodDb, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 15000');
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='process_roles'").get();
  let roles = [];
  if (t) roles = db.prepare('SELECT role,enforcement,may_read,forbidden FROM process_roles ORDER BY role').all();
  db.close();
  const need = ['backtest', 'resolver', 'scorer', 'participant'];
  const have = roles.map((r) => r.role);
  const kernel = roles.filter((r) => r.enforcement === 'kernel').length;
  const contract = roles.filter((r) => r.enforcement === 'contract').length;
  return { point: '①角色表存在', pass: !!t && need.every((r) => have.indexOf(r) !== -1),
    table_exists: !!t, roles: roles, contract_roles: contract, kernel_roles: kernel,
    isolation_level: kernel === 0 ? 'contract-only（无内核级角色）' : 'mixed' };
}

/** ② predictions_public 只读题面视图可用，且不含任何真值列。 */
function checkPublicView(prodDb) {
  const db = new Database(prodDb, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 15000');
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='predictions_public'").get();
  const cols = db.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
  const FORBIDDEN = ['outcome', 'resolved_at', 'resolve_note', 'evidence_json'];
  const leaked = FORBIDDEN.filter((c) => cols.indexOf(c) !== -1);
  const rows = db.prepare('SELECT COUNT(*) n FROM predictions_public').get().n;
  const usable = db.prepare('SELECT prediction_id, statement, layer, gate, cutoff_at FROM predictions_public LIMIT 5').all().length;
  db.close();
  return { point: '②predictions_public 视图可用', pass: !!tbl && leaked.length === 0 && rows > 0 && usable > 0,
    view_exists: !!tbl, columns: cols, leaked_columns: leaked, rows: rows, sample_query_rows: usable };
}
/** ③ 回测进程 SELECT truth_vault 必须失败（独立连接 + readonly 视图角色 + ATTACH 变体）。 */
function checkBacktestIsolation(surface) {
  const FORBIDDEN = 'SELECT prediction_id, outcome FROM truth_vault LIMIT 1';
  const rt = new Database(surface.file, { readonly: true, fileMustExist: true });
  rt.pragma('busy_timeout = 15000');
  const readView = tryRead(rt, 'SELECT prediction_id, statement, layer, gate, cutoff_at FROM predictions_public LIMIT 5');
  const forbidden = tryRead(rt, FORBIDDEN);
  let writeAttempt;
  try { rt.prepare('INSERT INTO predictions_public (prediction_id) VALUES (999999999)').run(); writeAttempt = { ok: true }; }
  catch (e) { writeAttempt = { ok: false, code: (e && e.code) || null, message: String(e.message).split('\n')[0] }; }
  const objects = rt.prepare('SELECT type,name FROM sqlite_master ORDER BY type,name').all();
  rt.close();
  const uriMem = new Database(':memory:');
  let uriAttach;
  try {
    uriMem.exec('ATTACH DATABASE ' + sqlStr('file:' + surface.file + '?mode=ro') + ' AS public');
    uriAttach = { ok: true, view: tryRead(uriMem, 'SELECT COUNT(*) AS n FROM public.predictions_public'), forbidden: tryRead(uriMem, FORBIDDEN) };
  } catch (e) {
    uriAttach = { ok: false, error: String(e.message).split('\n')[0],
      note: '本机 better-sqlite3 未启用 URI 文件名 ⇒ ATTACH ...?mode=ro 变体不可用（如实记录，非静默跳过）' };
  }
  uriMem.close();
  const mem = new Database(':memory:');
  let attach;
  try {
    mem.exec('ATTACH DATABASE ' + sqlStr(surface.file) + ' AS public');
    mem.pragma('query_only = 1');
    attach = { mode: 'plain ATTACH + PRAGMA query_only=1',
      view: tryRead(mem, 'SELECT COUNT(*) AS n FROM public.predictions_public'),
      forbidden: tryRead(mem, FORBIDDEN) };
    try { mem.prepare('INSERT INTO public.predictions_public (prediction_id) VALUES (999999998)').run(); attach.write_attempt = { ok: true }; }
    catch (e) { attach.write_attempt = { ok: false, code: (e && e.code) || null, message: String(e.message).split('\n')[0] }; }
    mem.pragma('query_only = 0');
    mem.exec('DETACH DATABASE public');
  } catch (e) { attach = { mode: 'plain ATTACH', error: String(e.message).split('\n')[0] }; }
  mem.close();
  return { point: '③回测进程 SELECT truth_vault 必须失败',
    pass: readView.ok === true && forbidden.ok === false && writeAttempt.ok === false
      && !!attach.view && attach.view.ok === true && !!attach.forbidden && attach.forbidden.ok === false,
    read_view: readView, truth_vault_select: forbidden, write_attempt: writeAttempt,
    surface_objects: objects, attach_plain: attach, attach_uri: uriAttach };
}

/** 反证（诚实项，必须跑）：同一 SELECT 直连生产库能成功 ⇒ 内核级隔离不存在。 */
function counterProof(prodDb) {
  const db = new Database(prodDb, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 15000');
  const r = tryRead(db, 'SELECT prediction_id, outcome FROM truth_vault LIMIT 1');
  const n = db.prepare('SELECT COUNT(*) n FROM truth_vault').get().n;
  db.close();
  return { reachable_from_prod_connection: r.ok, rows_in_vault: n,
    note: '直连生产库可读 truth_vault ⇒ 内核级隔离不存在；本阶段=面级隔离（独立 surface 文件）+ 契约级声明' };
}
function main() {
  const prod = arg('db', PROD);
  const out = arg('out', SURFACE);
  const surface = buildPublicSurface(prod, out);
  const r1 = checkRoleTable(prod);
  const r2 = checkPublicView(prod);
  const r3 = checkBacktestIsolation(surface);
  const cp = counterProof(prod);
  const result = { generated_at: new Date().toISOString(), db: prod, surface: surface,
    spec: 'docs/specs/历史回测引擎-规格D2-20260913.md §3.2 G-D2-0（第①②③步）',
    points: [r1, r2, r3], counter_proof: cp };
  result.verdict = (r1.pass && r2.pass && r3.pass) ? 'PASS' : 'FAIL';
  fs.mkdirSync(path.dirname(EVID), { recursive: true });
  fs.writeFileSync(EVID, JSON.stringify(result, null, 1));
  console.log('=== G-D2-0 三点验收（' + result.generated_at + '）===');
  console.log('① 角色表存在               : ' + (r1.pass ? 'PASS' : 'FAIL') + '  roles=' + r1.roles.length
    + ' contract=' + r1.contract_roles + ' kernel=' + r1.kernel_roles + ' (' + r1.isolation_level + ')');
  console.log('② predictions_public 可用  : ' + (r2.pass ? 'PASS' : 'FAIL') + '  rows=' + r2.rows
    + ' leaked_columns=' + JSON.stringify(r2.leaked_columns));
  console.log('③ 回测进程 truth_vault 失败: ' + (r3.pass ? 'PASS' : 'FAIL'));
  console.log('   失败原文: ' + JSON.stringify(r3.truth_vault_select));
  console.log('   只读写入拒绝: ' + JSON.stringify(r3.write_attempt));
  console.log('   ATTACH(plain+query_only) 变体: view=' + JSON.stringify(r3.attach_plain.view)
    + ' forbidden=' + JSON.stringify(r3.attach_plain.forbidden) + ' write=' + JSON.stringify(r3.attach_plain.write_attempt));
  console.log('   ATTACH(URI ?mode=ro) 变体: ' + JSON.stringify(r3.attach_uri));
  console.log('反证（诚实项）: ' + JSON.stringify(cp));
  console.log('SURFACE=' + surface.file);
  console.log('SURFACE_SHA256=' + surface.sha256);
  console.log('EVIDENCE=' + EVID);
  console.log('VERDICT=' + result.verdict);
  if (result.verdict !== 'PASS') process.exit(1);
}
main();



