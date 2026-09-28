'use strict';
// _b1-store-verify：#17b 真白名单 + #2 两列的写端行为验证（:memory:，零网络）
const { db } = require('../src/deps');
const S = require('../src/db/predictionsStore');
db.init(':memory:');
const conn = db.getConnection();
conn.exec("CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, game_type TEXT NOT NULL, player_count INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
conn.exec("INSERT INTO games (id, name, game_type, player_count) VALUES (1, 'g', 't', 11)");
S.ensurePredictionsTable(conn);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const throws = (fn, re, m) => { try { fn(); fail++; console.log('  FAIL(未抛) ' + m); } catch (e) { ok(re.test(e.message), m + ' :: ' + e.message.slice(0, 90)); } };
console.log('-- #17b 真白名单 --');
throws(() => S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', fooBar: 1 }), /未知字段/, 'insert 未知键抛错');
throws(() => S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', public_exposure: 0 }), /命名为漂移|命名漂移/, 'insert 下划线键抛错');
throws(() => S.updateAuditFields(1, { unknownKey: 1 }), /未知字段/, 'update 未知键抛错');
throws(() => S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', layer: 'L9' }), /layer 必须是/, 'insert 非法枚举仍抛错');
throws(() => S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', maturesAt: '2026/09/13' }), /maturesAt 必须是/, 'maturesAt 形状校验');
console.log('-- 核心键不误伤 --');
const r1 = S.insertPrediction({ gameId: 1, day: 0, sourceType: '预测卡', statement: '核心键行', prob: 0.5, evidence: [{ a: 1 }], layer: 'L2', engine: 'e', gate: 'descriptive', checklistHash: 'v2', publicExposure: 0, secondaryLayer: 'L3', baselineBrier: 0.25 });
ok(r1.id > 0, '全部 13 键不误伤（id=' + r1.id + '）');
console.log('-- #2 两列持久化 --');
const r2 = S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '#2 两列行', layer: 'L3', engine: 'e', g2Regime: 'R4', maturesAt: '2026-09-14' });
const raw = conn.prepare('SELECT g2_regime, matures_at FROM predictions WHERE id=?').get(r2.id);
ok(raw.g2_regime === 'R4' && raw.matures_at === '2026-09-14', 'g2_regime/matures_at 已落列 ' + JSON.stringify(raw));
console.log('-- deriveMaturesAt 形状 --');
const D = S.deriveMaturesAt;
const cases = [
  [{ date: '2026-09-14' }, '2026-09-14'],
  [{ period: '2026-09' }, '2026-09-30'],
  [{ month: '2026-02' }, '2026-02-28'],
  // 年度题＝**次年** 12-31（契约 g2-contract-frozen-r4.json year/yearly：「date = 次年 12 月 31 日；输入 YYYY」）。
  // 此处原写 2026-12-31，是把写端口当年的 off-by-one 当成了期望值 ⇒ 契约与写端口对齐后本脚本会拿一条
  // 与冻结契约相悖的断言把正确实现判成 FAIL。逐 kind 回归锁另见 test/matures-at-year.test.cjs。
  [{ year: '2026' }, '2027-12-31'],
  [{ week_end: '2026-09-06' }, '2026-09-06'],
  [{ start: '2026-08-01', end: '2026-08-07' }, '2026-08-07'],
  [{ epiweek: '202636' }, null],
  [{ issue: '2026106' }, null],
];
for (const [rs, want] of cases) {
  try { const got = D(rs); ok(want ? got === want : /^\d{4}-\d{2}-\d{2}$/.test(got), 'derive ' + JSON.stringify(rs) + ' -> ' + got); }
  catch (e) { ok(want === null, 'derive ' + JSON.stringify(rs) + ' 抛错（可接受）: ' + e.message.slice(0, 50)); }
}
try { D({ weird: 1 }, []); fail++; console.log('  FAIL 无字段未抛错'); } catch (e) { ok(/无法推导/.test(e.message), '无字段 -> 抛错（防静默出域）'); }
ok(D({ issue: '2026106' }, [{ meta: { drawDate: '2026-09-10' } }]) === '2026-09-10', 'issue+meta.drawDate');
console.log('-- #1 回测两列 / #2 显式性 --');
const r3 = S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '#1 回测行', g2Regime: 'R4', maturesAt: null, metricVersion: 'bt-v1', backtestBatch: 'D2-001' });
const raw3 = conn.prepare('SELECT g2_regime, matures_at, metric_version, backtest_batch FROM predictions WHERE id=?').get(r3.id);
ok(raw3.metric_version === 'bt-v1' && raw3.backtest_batch === 'D2-001', '#1 两列落列 ' + JSON.stringify(raw3));
throws(() => S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', g2Regime: 'R4' }), /必须显式提供 maturesAt/, 'g2Regime 缺 maturesAt -> 抛错');
const colN = conn.prepare("SELECT COUNT(*) n FROM pragma_table_info('predictions') WHERE name IN ('metric_version','backtest_batch','g2_regime','matures_at')").get().n;
ok(colN === 4, '四列齐（新库 DDL） colN=' + colN);
throws(() => S.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'x', metric_version: 'v' }), /命名漂移/, '下划线 metric_version -> 抛错');
console.log('RESULT pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);