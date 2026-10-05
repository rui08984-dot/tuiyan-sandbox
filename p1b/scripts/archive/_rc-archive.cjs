'use strict';
// RC-2 撤回留痕：verdicts 全量 1348 行导出（archive-rc-pre）→复核→不清表（R-A NULL/R-B ca1b/R-C 新 runId 三批隔离）
const fs = require('fs');
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const rows = conn.prepare('SELECT * FROM verdicts ORDER BY id').all();
const out = {
  archived_at: new Date().toISOString(),
  purpose: 'archive-rc-pre（PREREG-RC v1 §二.4：R-C 判词跑批前全量归档；不清表，三批由 runId 隔离：R-A NULL/R-B ca1b5cdbddfc/R-C 新 runId）',
  row_count: rows.length,
  rows: rows,
};
const dest = 'E:/music player/docs/assets/forecast-debate/verdicts-archive-rc-pre-20260913.json';
fs.writeFileSync(dest, JSON.stringify(out, null, 1), 'utf8');
console.log('ARCHIVE rows=' + rows.length + ' -> ' + dest);
console.log('复核回读=' + JSON.parse(fs.readFileSync(dest, 'utf8')).row_count);
console.log('run_id 分布: ' + JSON.stringify(conn.prepare('SELECT run_id, COUNT(*) n FROM verdicts GROUP BY run_id').all()));
db.closeCurrent();
