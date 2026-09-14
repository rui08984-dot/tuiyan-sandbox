'use strict';
// RC 清理②：切片干验事故的 DRYRUNTEST 假批次行 → 归档后删除。
// 教训入册：judge-runner 无 dry-run 模式，任何带 runId 的启动都会真调 LLM 真写库；
// 未来工程验证一律用独立副本库或纯 SELECT 探针，禁拿生产库跑假 runId。
const fs = require('fs');
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const junk = conn.prepare("SELECT * FROM verdicts WHERE run_id = 'DRYRUNTEST' ORDER BY id").all();
console.log('DRYRUNTEST 行数=' + junk.length);
if (junk.length) {
  const out = {
    archived_at: new Date().toISOString(),
    purpose: '切片干验事故归档：judge-runner --slice 验证误用生产库+假 runId=DRYRUNTEST，'
      + '新 runId 幂等语义（按批计数）导致对既有行免疫、重新生成 3 路判词落库。'
      + '行本身是真 LLM 输出但批次指纹为测试值，不入任何实验批次，归档后删除。',
    row_count: junk.length,
    rows: junk,
  };
  const dest = 'E:/music player/.scratch/forecast-debate/verdicts-archive-dryruntest-20260912.json';
  fs.writeFileSync(dest, JSON.stringify(out, null, 1), 'utf8');
  console.log('归档 -> ' + dest + ' 回读=' + JSON.parse(fs.readFileSync(dest, 'utf8')).row_count);
  const del = conn.transaction(() => {
    conn.prepare("DELETE FROM verdicts WHERE run_id = 'DRYRUNTEST'").run();
  });
  del();
}
// f4f7 批近 20 分钟新增行（切片测试产生）——合法 R-C 行，留库并列明细供对账
const newrc = conn.prepare(
  "SELECT v.id, v.prediction_id, v.prompt_variant, v.implied_prob FROM verdicts v"
  + " WHERE v.run_id='f4f760aa50e1' AND v.created_at > datetime('now','-30 minutes') ORDER BY v.id"
).all();
console.log('f4f7 批近 30 分钟新增（合法，留库）=' + JSON.stringify(newrc));
console.log('全表 run_id 分布: ' + JSON.stringify(conn.prepare('SELECT run_id, COUNT(*) n FROM verdicts GROUP BY run_id').all()));
db.closeCurrent();
