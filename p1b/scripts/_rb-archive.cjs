'use strict';
// RB-2 撤回留痕：verdicts 全列导出 JSON（archive-rb-pre）→复核行数→不清表（runId 批次隔离）
const fs = require('fs');
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const rows = conn.prepare('SELECT * FROM verdicts ORDER BY id').all();
const out = {
  archived_at: new Date().toISOString(),
  purpose: 'archive-rb-pre（PREREG-RB v1 §二.4：R-B 判词跑批前全量归档；R-A 268 行保留不清表，批次隔离由 runId 列承担）',
  row_count: rows.length,
  rows: rows,
};
const dest = 'E:/music player/.scratch/forecast-debate/verdicts-archive-rb-pre-20260912.json';
fs.writeFileSync(dest, JSON.stringify(out, null, 1), 'utf8');
console.log('ARCHIVE rows=' + rows.length + ' -> ' + dest);
console.log('复核回读=' + JSON.parse(fs.readFileSync(dest, 'utf8')).row_count);
console.log('run_id 分布: ' + JSON.stringify(conn.prepare('SELECT run_id, COUNT(*) n FROM verdicts GROUP BY run_id').all()));
db.closeCurrent();
