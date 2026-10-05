'use strict';
// RC-M2 前置清理：f4f760aa50e1 批次内 checklist_hash != 'v2' 的越界残段（R-A 老域 pred 1-41，
// 09-12 15:04/15:27 两跑由旧选题 SQL 产生）→ 先归档 JSON 再删除。
// 零触碰保证：DELETE 仅限 run_id='f4f760aa50e1' 行——R-A(NULL)/R-B(ca1b5cdbddfc) 行与
// predictions 账本一行不动（verdicts=LLM 衍生数据可再生，archive 先例=run0/rb-pre/rc-pre）。
const fs = require('fs');
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const RUN_ID = 'f4f760aa50e1';
const oos = conn.prepare(
  "SELECT v.* FROM verdicts v JOIN predictions p ON p.id = v.prediction_id"
  + " WHERE v.run_id = ? AND COALESCE(p.checklist_hash,'') <> 'v2' ORDER BY v.id"
).all(RUN_ID);
const keep = conn.prepare(
  "SELECT COUNT(*) n FROM verdicts v JOIN predictions p ON p.id = v.prediction_id"
  + " WHERE v.run_id = ? AND COALESCE(p.checklist_hash,'') = 'v2'"
).get(RUN_ID).n;
console.log('R-C 批内 v2 域行（保留）=' + keep + '；越界残段行（待清除）=' + oos.length);
if (oos.length) {
  const out = {
    archived_at: new Date().toISOString(),
    purpose: 'RC 越界残段归档：judge-runner 旧选题 SQL（无 checklist_hash 过滤，选 450 条）'
      + '在 09-12 15:04（空转跑）/15:27（中断跑）把 R-C 判词生成于 R-A 老域 predictions'
      + '（checklist_hash=v1），超出 PREREG-RC §一题源（v2 360 条）。归档后删除；'
      + 'R-A(run_id NULL) 与 R-B(ca1b5cdbddfc) 行零触碰，predictions 账本一行不动。',
    run_id: RUN_ID,
    row_count: oos.length,
    prediction_ids: [...new Set(oos.map((r) => r.prediction_id))],
    rows: oos,
  };
  const dest = 'E:/music player/docs/assets/forecast-debate/verdicts-archive-rc-oos-20260912.json';
  fs.writeFileSync(dest, JSON.stringify(out, null, 1), 'utf8');
  const back = JSON.parse(fs.readFileSync(dest, 'utf8'));
  console.log('归档 -> ' + dest + ' 回读 row_count=' + back.row_count);
  const ids = oos.map((r) => r.id);
  const del = conn.transaction(() => {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      conn.prepare('DELETE FROM verdicts WHERE id IN (' + chunk.map(() => '?').join(',') + ')').run(...chunk);
    }
  });
  del();
}
const after = conn.prepare('SELECT COUNT(*) n FROM verdicts WHERE run_id = ?').get(RUN_ID).n;
const total = conn.prepare('SELECT run_id, COUNT(*) n FROM verdicts GROUP BY run_id ORDER BY run_id').all();
console.log('删除后 R-C 批行数=' + after + '（预期=' + keep + '）');
console.log('全表 run_id 分布: ' + JSON.stringify(total));
db.closeCurrent();
