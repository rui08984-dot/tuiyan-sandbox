#!/usr/bin/env node
'use strict';
/*
 * PREREG-命题A-3.0消融 · §8-④ 跑前归档与快照（**零 LLM／零网络**）
 * ① verdicts 全量归档（sim 域；含 run_id/model 指纹，供跑后复现）；
 * ② predictions 快照＝better-sqlite3 在线备份 API（源库 {readonly:true}，只读）；
 * ③ 快照**必须 {readonly:true} 打开**复验（integrity_check + 行数），并记录两件 sha256。
 * 用法：node p1b/scripts/prereg-a-archive.cjs [--out-dir <dir>] [--tag <tag>]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const TAG = arg('tag', 'preregA-20260913');
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'prereg-a')));
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const db = new Database(DB_PATH, { readonly: true }); // 只读纪律：源库绝不写（无 INSERT/UPDATE）
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const VERDICTS_SQL = 'SELECT v.id, v.prediction_id, v.prompt_variant, v.temperature, v.model, v.implied_prob, v.created_at, v.run_id, '
  + 'p.game_id, p.layer, p.outcome, p.statement '
  + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id JOIN games g ON g.id = p.game_id '
  + "WHERE g.source = 'sim' ORDER BY v.id";
const rows = db.prepare(VERDICTS_SQL).all();
const byRun = {};
for (const r of rows) { const k = r.run_id === null ? 'NULL' : String(r.run_id); byRun[k] = (byRun[k] || 0) + 1; }
const archive = {
  meta: { script: 'p1b/scripts/prereg-a-archive.cjs', tag: TAG, domain: "games.source='sim'（题源列口径；predictions.source_type 恒为中文「预测卡」不可作域过滤）",
    prereg: { file: 'docs/assets/forecast-debate/PREREG-命题A-3.0消融-v1.md', sha256: '5d6907d1910acab842b92a172714d44b13cadf474f33d45008ea67f0a6098845' },
    generated_at: new Date().toISOString(), note: '跑前归档：账本不可变，本件生成后禁改。' },
  counts: { verdicts_sim: rows.length, by_run_id: byRun }, rows: rows
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const arcPath = path.join(OUT_DIR, 'verdicts-archive-' + TAG + '.json');
  fs.writeFileSync(arcPath, JSON.stringify(archive, null, 1), 'utf8');
  // ② 在线备份 API（源=只读连接 → 目标新文件；不触碰源库）
  const snapPath = path.join(OUT_DIR, 'p1a-snapshot-' + TAG + '.db');
  await db.backup(snapPath);
  // ③ 快照只读复验
  const snap = new Database(snapPath, { readonly: true });
  const integrity = snap.prepare('PRAGMA integrity_check').get();
  const snapVerdicts = snap.prepare('SELECT COUNT(*) c FROM verdicts').get().c;
  const snapPredictions = snap.prepare('SELECT COUNT(*) c FROM predictions').get().c;
  snap.close();
  const manifest = {
    tag: TAG, source_db: DB_PATH, source_readonly: true,
    artifacts: [
      { file: arcPath, kind: 'verdicts-archive-json', bytes: fs.statSync(arcPath).size, sha256: sha256(arcPath), rows: rows.length },
      { file: snapPath, kind: 'predictions-snapshot-sqlite', bytes: fs.statSync(snapPath).size, sha256: sha256(snapPath), readonly_reopened: true,
        integrity_check: integrity, verdicts_rows: snapVerdicts, predictions_rows: snapPredictions },
    ],
    generated_at: new Date().toISOString(),
  };
  const manPath = path.join(OUT_DIR, 'manifest-' + TAG + '.json');
  fs.writeFileSync(manPath, JSON.stringify(manifest, null, 1), 'utf8');
  console.log('[prereg-a-archive] OUT_DIR=' + OUT_DIR);
  console.log('  verdicts_sim=' + rows.length + ' by_run=' + JSON.stringify(byRun));
  console.log('  archive sha256=' + manifest.artifacts[0].sha256 + ' bytes=' + manifest.artifacts[0].bytes);
  console.log('  snapshot sha256=' + manifest.artifacts[1].sha256 + ' bytes=' + manifest.artifacts[1].bytes + ' integrity=' + JSON.stringify(integrity) + ' (readonly reopened: verdicts=' + snapVerdicts + ' predictions=' + snapPredictions + ')');
  console.log('  manifest -> ' + manPath);
  db.close();
}
main().catch((e) => { console.error('[prereg-a-archive] FAIL ' + (e && e.message)); process.exit(1); });
