'use strict';
// .tmp/db-snapshot.cjs — 生产库一致性快照 + sha256（写前纪律：只读源连接，零写入生产库）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const SRC = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const OUTDIR = path.join(ROOT, '.tmp', 'snapshots');
fs.mkdirSync(OUTDIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const DEST = path.join(OUTDIR, 'p1a-' + stamp + '.db');
function sha256(p) { if (!fs.existsSync(p)) return null; return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
(async () => {
  const before = { db: sha256(SRC), wal: sha256(SRC + '-wal'), shm: sha256(SRC + '-shm') };
  const src = new Database(SRC, { readonly: true });
  await src.backup(DEST);
  const snap = new Database(DEST, { readonly: true });
  const hasIQ = snap.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intake_questions'").get();
  let cols = null, n = null;
  if (hasIQ) { cols = snap.prepare('PRAGMA table_info(intake_questions)').all().map((c) => c.name); n = snap.prepare('SELECT COUNT(*) n FROM intake_questions').get().n; }
  const tbls = snap.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  snap.close(); src.close();
  const report = { generated_at: new Date().toISOString(), source: SRC, snapshot: DEST,
    source_sha256_before: before, snapshot_sha256: sha256(DEST), snapshot_bytes: fs.statSync(DEST).size,
    prod_intake_questions: hasIQ ? { exists: true, columns: cols, rows: n } : { exists: false },
    prod_tables: tbls };
  fs.writeFileSync(path.join(OUTDIR, 'snapshot-' + stamp + '.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error('SNAPSHOT FAIL: ' + e.message); process.exit(1); });
