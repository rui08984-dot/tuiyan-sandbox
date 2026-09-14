'use strict';
/**
 * vault-sync.test.cjs —— 任务 6 · 批次 3 · F4 同批账本操作：truth_vault 同步器。
 * 场景（临时库）：一行为「vault 陈旧」（outcome 与 predictions 不一致）、一行为「vault 缺行」、
 *   一行为「一致」、外加一行「孤儿」（vault 有、predictions 无）。
 * 断言：① dry-run 零写入（vault 行数与内容不变，退出码 0）；② --confirm 后对账 ok=true
 *   （missing/orphan 见报告：孤儿只报告不删）、predictions **零改动**（dump sha 证据）、
 *   insert/update 数 == 计划数；③ 回滚剧本可用（写前快照文件可读且内容等于写前态）。
 * 铁律：零网络；不碰生产库（--db 指向临时库；--snapshot 亦临时）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'vault-sync.cjs');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));

function tmp(n) { return path.join(os.tmpdir(), 'p1b-vsync-' + process.pid + '-' + Date.now() + '-' + n); }
const run = (args) => execFileSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' });

function makeDb(dbPath) {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, statement TEXT, outcome TEXT, resolved_at TEXT, resolve_note TEXT)');
  db.exec('CREATE TABLE truth_vault (prediction_id INTEGER PRIMARY KEY, outcome TEXT, resolved_at TEXT, resolve_note TEXT, created_at TEXT DEFAULT (datetime(\'now\')), source TEXT)');
  db.prepare("INSERT INTO predictions VALUES (1,'p1 stale','true','2026-09-01 00:00:00','n1')").run();
  db.prepare("INSERT INTO predictions VALUES (2,'p2 missing','false','2026-09-02 00:00:00','n2')").run();
  db.prepare("INSERT INTO predictions VALUES (3,'p3 ok',NULL,NULL,NULL)").run();
  db.prepare("INSERT INTO truth_vault (prediction_id,outcome,resolved_at,resolve_note,source) VALUES (1,NULL,NULL,NULL,'predictions')").run();
  db.prepare("INSERT INTO truth_vault (prediction_id,outcome,resolved_at,resolve_note,source) VALUES (3,NULL,NULL,NULL,'predictions')").run();
  db.prepare("INSERT INTO truth_vault (prediction_id,outcome,resolved_at,resolve_note,source) VALUES (99,'true','2026-01-01 00:00:00','orphan','predictions')").run();
  db.close();
}

test('vault-sync：dry-run 零写入 → --confirm 同步（孤儿只报告）+ predictions 零改动', () => {
  const dbPath = tmp('t.db');
  const snapPath = tmp('snap.db');
  const repPath = tmp('r.json');
  makeDb(dbPath);
  const before = fs.readFileSync(dbPath);
  const out1 = run(['--db', dbPath, '--report', repPath]);
  assert.match(out1, /DRY-RUN/, '默认 dry-run');
  assert.ok(Buffer.compare(fs.readFileSync(dbPath), before) === 0, 'dry-run 后库文件逐字节不变');
  const r1 = JSON.parse(fs.readFileSync(repPath, 'utf8'));
  assert.deepEqual([r1.plan.insert_n, r1.plan.update_n, r1.plan.orphan_n], [1, 1, 1]);
  assert.equal(r1.before.ok, false);
  const out2 = run(['--db', dbPath, '--confirm', '--snapshot', snapPath, '--report', repPath]);
  assert.match(out2, /predictions 零改动=true/);
  const r2 = JSON.parse(fs.readFileSync(repPath, 'utf8'));
  assert.equal(r2.write.inserted, 1);
  assert.equal(r2.write.updated, 1);
  assert.equal(r2.after.ok, false, '孤儿未删 ⇒ 对账 ok 仍 false（设计如此：孤儿只报告，不自动删）');
  assert.equal(r2.after.vault_orphan, 1);
  assert.equal(r2.after.vault_missing, 0);
  assert.equal(r2.after.truth_column_diff, 0);
  assert.equal(r2.predictions_untouched, true, 'predictions dump sha 前后一致');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  assert.deepEqual(db.prepare('SELECT outcome,resolved_at,resolve_note FROM truth_vault WHERE prediction_id=1').get(),
    { outcome: 'true', resolved_at: '2026-09-01 00:00:00', resolve_note: 'n1' }, '陈旧行已对齐');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM truth_vault WHERE prediction_id=2').get().n, 1, '缺行已补');
  assert.equal(db.prepare('SELECT statement FROM predictions WHERE id=1').get().statement, 'p1 stale', 'predictions 内容未动');
  db.close();
  // 回滚剧本：快照文件可读且为写前态（vault 1 行陈旧/2 行缺失）
  const snap = new Database(snapPath, { readonly: true, fileMustExist: true });
  assert.equal(snap.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(snap.prepare('SELECT COUNT(*) n FROM truth_vault').get().n, 3, '快照=写前 3 行');
  assert.equal(snap.prepare('SELECT outcome FROM truth_vault WHERE prediction_id=1').get().outcome, null, '快照保留陈旧值');
  snap.close();
});
