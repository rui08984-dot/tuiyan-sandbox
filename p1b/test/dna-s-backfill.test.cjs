'use strict';
/**
 * p1b/test/dna-s-backfill.test.cjs —— E1 回填/判据纪律测试（2026-09-16）
 * ① dry-run 零写：对生产库跑 dry-run，sha256 前后一致；
 * ② 副本集成：副本库 --confirm 写出 dna_s_labels 行数=总行数−L1(B) 且 predictions 计数不变；
 * ③ judge 无 gate ⇒ GATE_PENDING（拒绝输出 Δ/CI，退出码 4）；
 * ④ source 路由硬失败（不冒充主口径）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKFILL = path.join(ROOT, 'p1b', 'scripts', 'dna-s-backfill.cjs');
const JUDGE = path.join(ROOT, 'p1b', 'scripts', 'dna-s-judge.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-e1-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('① dry-run 零写：生产库 sha256 前后一致', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [BACKFILL, '--db', PROD, '--out-dir', tmpDir], { stdio: 'ignore' });
  assert.equal(sha(PROD), before, 'dry-run 改动了生产库');
});

test('② 副本集成：--confirm 写标签（INSERT-only）＋ predictions 计数不变', () => {
  const copy = path.join(tmpDir, 'e1.db');
  fs.copyFileSync(PROD, copy);
  const { DatabaseSync } = require('node:sqlite');
  const q = (db, s) => db.prepare(s).get().c;
  let db = new DatabaseSync(copy, { readOnly: true });
  const predBefore = q(db, 'SELECT COUNT(*) c FROM predictions'); db.close();
  execFileSync(process.execPath, [BACKFILL, '--db', copy, '--confirm', '--no-snapshot', '--out-dir', tmpDir], { stdio: 'ignore' });
  db = new DatabaseSync(copy, { readOnly: true });
  const labels = q(db, 'SELECT COUNT(*) c FROM dna_s_labels');
  const predAfter = q(db, 'SELECT COUNT(*) c FROM predictions');
  const noL1 = q(db, "SELECT COUNT(*) c FROM dna_s_labels WHERE dna_s IS NULL");
  const view = q(db, "SELECT COUNT(*) c FROM sqlite_master WHERE type='view' AND name='v_dna_s'");
  const layers = db.prepare('SELECT p.layer AS l, COUNT(*) c FROM dna_s_labels d JOIN predictions p ON p.id=d.prediction_id GROUP BY p.layer').all();
  db.close();
  assert.ok(labels > 0, '写出标签');
  assert.equal(predAfter, predBefore, 'predictions 计数被改动');
  assert.equal(noL1, 0, '标签完整性');
  assert.equal(view, 1, 'v_dna_s 视图存在');
  assert.ok(!layers.some((x) => x.l === 'L1'), 'L1 不应落表（§1 整层剔除）');
});

test('③ judge 无 gate ⇒ GATE_PENDING 且拒绝出读数（退出码 4）', () => {
  const copy = path.join(tmpDir, 'e1.db');   // 复用上例副本（含标签）
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [JUDGE, '--db', copy, '--out-dir', tmpDir], { encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); code = e.status; }
  assert.match(out, /GATE_PENDING/, '未打印 GATE_PENDING');
  assert.ok(out.indexOf('Δ CI=[') === -1, '门未过却输出了 Δ/CI');
  assert.equal(code, 4, '退出码应为 4（GATE_PENDING）');
});

test('④ source 路由硬失败（不冒充主口径）', () => {
  let code = 0, err = '';
  try { execFileSync(process.execPath, [BACKFILL, '--db', PROD, '--route', 'source'], { stdio: 'pipe' }); }
  catch (e) { code = e.status; err = String(e.stderr || ''); }
  assert.equal(code, 3, '应硬失败退出 3');
  assert.match(err, /ROUTE_UNSUPPORTED/, '应说明未实现');
});
