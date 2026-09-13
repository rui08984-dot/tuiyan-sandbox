/* 只读：pid 91/92 三臂 implied_prob 分布（旁证臂开关在 inject 时生效） */
const D = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new D('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
for (const pid of [91, 92, 93]) {
  console.log('pid=' + pid);
  const rows = db.prepare("SELECT run_id, implied_prob, temperature FROM verdicts WHERE prediction_id=? AND run_id LIKE 'preregA%' ORDER BY run_id, id").all(pid);
  const byRun = {};
  for (const r of rows) { (byRun[r.run_id] = byRun[r.run_id] || []).push(r.implied_prob); }
  for (const k of Object.keys(byRun).sort()) console.log('  ' + k + ' n=' + byRun[k].length + ' probs=[' + byRun[k].join(', ') + ']');
}
db.close();
