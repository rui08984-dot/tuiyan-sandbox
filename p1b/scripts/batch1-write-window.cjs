'use strict';
// batch1-write-window.cjs —— 批次1 门卫生写库窗口：
//   (A) #1 additive 迁移两列 metric_version/backtest_batch（D2 回测题标识，G2 排除子句依赖）
//   (B) #17a public_exposure 879 行 NULL → 0（wide/b3/b4 批；设计上非 L4 层 = 0）
// 默认 dry-run（零写入）；--confirm 才写。前置：_b1-snapshot.cjs（VACUUM + sha256）。
const { db } = require('../src/deps');
const S = require('../src/db/predictionsStore');
const CONFIRM = process.argv.includes('--confirm');
const DBP = (process.argv.find((a) => a.startsWith('--db=')) || '').slice(5) || null;
if (DBP) db.init(DBP); else db.init();
const conn = db.getConnection();
const NEED = ['g2_regime', 'matures_at', 'metric_version', 'backtest_batch'];
const colsBefore = new Set(conn.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name));
const missingBefore = NEED.filter((c) => !colsBefore.has(c));
const nullExp = conn.prepare('SELECT COUNT(*) n FROM predictions WHERE public_exposure IS NULL').get().n;
const byLayer = conn.prepare('SELECT layer, COUNT(*) n FROM predictions WHERE public_exposure IS NULL GROUP BY layer ORDER BY layer').all();
const byKind = conn.prepare("SELECT COALESCE(json_extract(evidence_json,'$[0].kind'),'(none)') k, COUNT(*) n FROM predictions WHERE public_exposure IS NULL GROUP BY k ORDER BY n DESC").all();
console.log('[plan] ' + JSON.stringify({ confirm: CONFIRM, missing_cols: missingBefore, exposure_null_to_0: nullExp }));
console.log('[plan] by_layer=' + JSON.stringify(byLayer));
console.log('[plan] by_ev_kind=' + JSON.stringify(byKind));
if (!CONFIRM) { console.log('DRY-RUN：未写库。加 --confirm 执行。'); db.closeCurrent(); process.exit(0); }
S.ensurePredictionsTable(conn);                       // 幂等 additive：缺列才 ALTER
const upd = conn.prepare('UPDATE predictions SET public_exposure = 0 WHERE public_exposure IS NULL');
const tx = conn.transaction(() => upd.run());
const info = tx();
S.ensurePredictionsTable(conn);                       // 二次调用校验（应为 no-op）
const colsAfter = new Set(conn.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name));
const missingAfter = NEED.filter((c) => !colsAfter.has(c));
const nullAfter = conn.prepare('SELECT COUNT(*) n FROM predictions WHERE public_exposure IS NULL').get().n;
const dist = conn.prepare('SELECT CAST(public_exposure AS TEXT) v, COUNT(*) n FROM predictions GROUP BY v').all();
console.log('[write] updated_rows=' + info.changes);
console.log('[verify] ' + JSON.stringify({ missing_cols_after: missingAfter, exposure_null_after: nullAfter, dist: dist,
  integrity: conn.prepare('PRAGMA integrity_check').get().integrity_check, predictions: conn.prepare('SELECT COUNT(*) n FROM predictions').get().n }));
db.closeCurrent();