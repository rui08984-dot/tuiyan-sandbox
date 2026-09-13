/* prereg-A smoke 跑后只读验证：verdicts 行数 + run_id 分组 + 表结构 + 状态抽样 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const db = new Database(DB, { readonly: true, fileMustExist: true });
const total = db.prepare("SELECT COUNT(*) n FROM verdicts WHERE run_id LIKE 'preregA%'").get().n;
console.log('preregA% rows total = ' + total);
const byRun = db.prepare("SELECT run_id, COUNT(*) n FROM verdicts WHERE run_id LIKE 'preregA%' GROUP BY run_id ORDER BY run_id").all();
for (const r of byRun) console.log('  ' + r.run_id + ' -> ' + r.n);
const cols = db.prepare("PRAGMA table_info(verdicts)").all().map(c => c.name);
console.log('verdicts columns: ' + cols.join(','));
const models = db.prepare("SELECT model, COUNT(*) n FROM verdicts WHERE run_id LIKE 'preregA%' GROUP BY model").all();
for (const m of models) console.log('  model=' + m.model + ' n=' + m.n);
db.close();
