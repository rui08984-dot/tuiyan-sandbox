/** 副本演练：在 .scratch/leakgate/rehearsal.db（生产库的拷贝）上跑 ensure + 视图，逐项核对。
 *  ★绝不碰 p1a-terminal/data/p1a.db。 */
const path = require('path');
const ROOT = 'E:/music player';
process.chdir(path.join(ROOT, 'p1b'));
const { db } = require(path.join(ROOT, 'p1b/src/deps'));
const vstore = require(path.join(ROOT, 'p1b/src/db/verdictsStore'));
const vviews = require(path.join(ROOT, 'p1b/src/db/verdictsViews'));

const DB = path.join(ROOT, '.scratch/leakgate/rehearsal.db');
db.init(DB);
const conn = db.getConnection();
const g = (s) => conn.prepare(s).get();

const before = {
  rows: g('SELECT COUNT(*) n FROM verdicts').n,
  digest: g("SELECT COUNT(*) n, SUM(LENGTH(verdict_text)) t, SUM(COALESCE(implied_prob,0)) p, MAX(id) m FROM verdicts"),
  cols: conn.prepare('PRAGMA table_info(verdicts)').all().map(c => c.name).join(','),
  views: conn.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all().map(x => x.name).join(','),
};
console.log('BEFORE rows =', before.rows, '| cols =', before.cols, '| views =', before.views || '(none)');

vstore.ensureVerdictsTable(conn);
vviews.ensureVerdictsCleanView(conn);

const after = {
  rows: g('SELECT COUNT(*) n FROM verdicts').n,
  digest: g("SELECT COUNT(*) n, SUM(LENGTH(verdict_text)) t, SUM(COALESCE(implied_prob,0)) p, MAX(id) m FROM verdicts"),
  cols: conn.prepare('PRAGMA table_info(verdicts)').all().map(c => c.name).join(','),
  views: conn.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all().map(x => x.name).join(','),
  leak_null: g('SELECT COUNT(*) n FROM verdicts WHERE leak_state IS NULL').n,
  leak_clean: g("SELECT COUNT(*) n FROM verdicts WHERE leak_state='clean'").n,
  clean_view: g('SELECT COUNT(*) n FROM verdicts_clean').n,
};
console.log('AFTER  rows =', after.rows, '| cols =', after.cols, '| views =', after.views);
console.log('行数不变:', before.rows === after.rows);
console.log('内容指纹不变:', JSON.stringify(before.digest) === JSON.stringify(after.digest), JSON.stringify(after.digest));
console.log('leak_state NULL（历史行）=', after.leak_null, '| clean =', after.leak_clean, '| verdicts_clean =', after.clean_view);
console.log('桶守恒 clean+排除==总行:', after.clean_view + after.leak_null === after.rows);
const dis = vviews.leakDisclosure();
console.log('leakDisclosure:', JSON.stringify(dis, null, 1));
// 幂等：第二次 ensure 不炸、不改数
vstore.ensureVerdictsTable(conn); vviews.ensureVerdictsCleanView(conn);
console.log('二次 ensure 后行数:', g('SELECT COUNT(*) n FROM verdicts').n, '| 指纹一致:',
  JSON.stringify(g("SELECT COUNT(*) n, SUM(LENGTH(verdict_text)) t, SUM(COALESCE(implied_prob,0)) p, MAX(id) m FROM verdicts")) === JSON.stringify(after.digest));
// 闸在真实数据形状下的行为：拿一条历史行的父题再写判词
const sample = conn.prepare("SELECT v.prediction_id pid, p.resolved_at ra FROM verdicts v JOIN predictions p ON p.id=v.prediction_id LIMIT 1").get();
const r = vstore.saveVerdict({ predictionId: sample.pid, promptVariant: 'v1_evidence', temperature: 0.55,
  verdictText: '演练：打在已结算题上的新判词。\nP=0.61', impliedProb: 0.61 });
console.log('对已结算题写入 →', JSON.stringify({ ok: r.ok, reason: r.reason }));
console.log('拒写后行数（须仍为 ' + after.rows + '）:', g('SELECT COUNT(*) n FROM verdicts').n);
db.closeCurrent();
