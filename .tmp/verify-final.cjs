'use strict';
// .tmp/verify-final.cjs —— 终验：生产库只读探测（零写入）+ 目标文件 CRLF/大小
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const SRC = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const sha = (p) => fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
const db = new Database(SRC, { readonly: true });
const iq = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('intake_questions','intake_rejects')").all().map((r) => r.name);
const preds = db.prepare('SELECT COUNT(*) n FROM predictions').get().n;
const cols = db.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name).filter((c) => ['gate','engine','layer','g2_regime'].indexOf(c) !== -1);
db.close();
const st = fs.statSync(SRC);
const files = ['p1b/src/engines/l2_baseline.js', 'p1b/src/engines/l5_certified.js', 'p1b/src/routes/intake.js',
  'p1b/src/db/intakeStore.js', 'p1b/test/intake-engines.test.cjs', 'p1b/test/intake.test.cjs',
  'docs/specs/变更留痕索引-20260912.md', 'p1b/sim/out/stage4-l2-l5-receipt.out'];
const inv = files.map((f) => {
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return { file: f, bytes: fs.statSync(path.join(ROOT, f)).size, crlf: (raw.match(/\r\n/g) || []).length, bare_lf: (raw.match(/(?<!\r)\n/g) || []).length };
});
console.log(JSON.stringify({
  prod_db: { path: SRC, bytes: st.size, mtime_utc: st.mtime.toISOString(),
    sha256_db: sha(SRC), sha256_wal: sha(SRC + '-wal'), sha256_shm: sha(SRC + '-shm'),
    intake_tables_present: iq, predictions_rows: preds, audit_cols: cols,
    note: '本片未对生产库执行任何写操作（快照脚本只读打开；全部测试跑 :memory:）' },
  inventory: inv }, null, 1));
