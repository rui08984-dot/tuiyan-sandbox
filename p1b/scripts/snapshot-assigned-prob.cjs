'use strict';
/**
 * p1b/scripts/snapshot-assigned-prob.cjs —— 旧 assigned_prob 快照（p13 批次0.5）。
 *
 * 用途：判词修复重跑（后续批次）会改写 predictions.assigned_prob（median(implied_prob)），
 * 重跑前把账本现状全量固化到 JSON，作为对比/回滚锚点（账本不可变纪律下的诚实留痕——
 * assigned_prob 本列可被 runner 重算，故重算前必须先留快照）。
 *
 * 导出 predictions 全部行 (id, game_id, statement, assigned_prob, resolved_at, outcome) 到
 * .scratch/forecast-debate/assigned-prob-snapshot-20260912.json；预期 90 行，行数≠90 如实
 * 打印 WARN 不硬过。只读库，零写入（除快照 JSON 本身）。
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../src/deps');

const OUT = path.join(__dirname, '..', '..', '.scratch', 'forecast-debate', 'assigned-prob-snapshot-20260912.json');
const EXPECTED_ROWS = 90;

function main() {
  const conn = db.getConnection();
  const rows = conn.prepare(
    'SELECT id, game_id, statement, assigned_prob, resolved_at, outcome FROM predictions ORDER BY id'
  ).all();
  const payload = {
    snapshot: 'assigned-prob-snapshot-20260912',
    exported_at: new Date().toISOString(),
    table: 'predictions',
    row_count: rows.length,
    expected_rows: EXPECTED_ROWS,
    rows: rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log('SNAPSHOT rows=' + rows.length + ' expected=' + EXPECTED_ROWS + ' -> ' + OUT);
  if (rows.length !== EXPECTED_ROWS) {
    console.log('WARN 行数 ' + rows.length + ' != 预期 ' + EXPECTED_ROWS + '（如实报告，不硬过）');
  } else {
    console.log('CHECK row_count=90 OK');
  }
  try { db.closeCurrent(); } catch (e) { /* 忽略关闭异常 */ }
}

main();
