'use strict';
// 撤回留痕（PREREG-判词重跑-v1 §二·四要素4）：verdicts 全量 JSON 归档 → 复核行数 → --delete 清表 → 复核 0
// 用法：node _ra-archive.cjs            （只归档+复核，零删除）
//       node _ra-archive.cjs --delete   （归档复核通过后清表）
const fs = require('fs');
const path = require('path');
const { db } = require('../../p1b/src/deps');
const vstore = require('../../p1b/src/db/verdictsStore');
const conn = db.getConnection();
vstore.ensureVerdictsTable(conn); // additive 补 model/run_id（旧行 NULL），归档列全；服务启动同链同迁移
const OUT = path.join(__dirname, 'verdicts-archive-run0-20260912.json');
const MODE = process.argv.includes('--delete') ? 'delete' : 'archive';
const expected = 263;
const rows = conn.prepare('SELECT id, prediction_id, prompt_variant, temperature, verdict_text, implied_prob, model, run_id, created_at FROM verdicts ORDER BY id').all();
console.log('COUNT ' + rows.length + ' (expected ' + expected + ')');
if (rows.length !== expected) { console.log('FATAL 行数不符，拒绝继续'); process.exit(2); }
const payload = {
  archive: 'verdicts-archive-run0-20260912',
  purpose: 'PREREG-判词重跑-v1 §二·四要素4 撤回留痕：run0 旧判词全量固化后清表重跑（90×3）',
  prereg_sha256: 'f232e2a546890fabe5faf04c769b4628295d447faf0b4e5f577da3ec24eeb319',
  freeze_commit: 'a1f7f1d (批次1-R-A：PREREG v1 冻结+hash 记档)',
  exported_at: new Date().toISOString(),
  table: 'verdicts',
  row_count: rows.length,
  variant_counts: rows.reduce((m, r) => { m[r.prompt_variant] = (m[r.prompt_variant] || 0) + 1; return m; }, {}),
  schema_note: 'run0 行 model/run_id 为 NULL（批次0.5 版本戳列晚于 run0 落库，旧行如实留空不回填）',
  rows: rows,
};
if (MODE === 'archive') {
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');
  const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const ok = back.row_count === expected && back.rows.length === expected;
  console.log('ARCHIVE -> ' + OUT);
  console.log('READBACK rows=' + back.rows.length + ' first_id=' + back.rows[0].id + ' last_id=' + back.rows[back.rows.length - 1].id + ' variants=' + JSON.stringify(back.variant_counts));
  console.log(ok ? 'CHECK archive OK' : 'CHECK archive FAIL');
} else {
  // --delete：仅当归档文件已在盘且行数吻合才执行
  const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (back.row_count !== expected || back.rows.length !== expected) { console.log('FATAL 归档文件行数不符，拒绝清表'); process.exit(2); }
  const info = conn.prepare('DELETE FROM verdicts').run();
  const n = conn.prepare('SELECT COUNT(*) n FROM verdicts').get().n;
  console.log('DELETE changes=' + info.changes + ' -> after_count=' + n);
  console.log(n === 0 ? 'CHECK cleared OK' : 'CHECK cleared FAIL');
}
// 附：既有 predictions 快照（批次0.5 先例）与当前库一致性核对（只读，不重写先例文件）
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'assigned-prob-snapshot-20260912.json'), 'utf8'));
const cur = conn.prepare('SELECT id, assigned_prob FROM predictions ORDER BY id').all();
let diff = 0;
for (let i = 0; i < Math.max(snap.rows.length, cur.length); i++) {
  const a = snap.rows[i], b = cur[i];
  if (!a || !b || a.id !== b.id || a.assigned_prob !== b.assigned_prob) diff++;
}
console.log('SNAPSHOT-COMPARE snapshot_rows=' + snap.rows.length + ' db_rows=' + cur.length + ' diff=' + diff + (diff === 0 && snap.rows.length === 90 ? ' (快照即重跑前现状 ✓)' : ' (需人工核查)'));
try { db.closeCurrent(); } catch (e) {}