'use strict';
/**
 * p1b/src/db/ownershipStore.js —— P0-5「题归谁」（p1b 私有表 question_owners）。
 *
 * ── 为什么有这张表 ───────────────────────────────────────────────────────────
 *   病象（实测 2026-09-28 真实库）：predictions 1994 条，已揭晓 1700 条，
 *   **未揭晓 294 条**（`outcome IS NULL`），source_type 全是人工落注那一类，
 *   且题面里能 grep 到 2 条「护栏：G2 行域样例」——**那是测试夹具**。
 *   外部用户第一屏看到的就是这 294 条他不认识的机器题。
 *   ⇒ 要把「我的题」和「语料库」分开，就得先有「这道题归谁」这个事实。
 *   账本里没有这一列，而共享库禁 DDL（照 intakeStore/verdictsStore/predictionsStore 范式）
 *   ⇒ 新建一张 p1b 私有**映射表**��additive、幂等、不碰 predictions 任何一列）。
 *
 * ── ★三条不可让步的纪律 ─────────────────────────────────────────────────────
 *   ① **绝不删除、绝不隐藏**。归属只决定「在哪个视图里出现」，不决定「存不存在」。
 *      三桶（我的题 / 语料库 / 别人的题）互斥且完备，之和恒等于账本总数；
 *      端点每个视图都把这三个数一并返回，前端可自校验。
 *   ② **归属不改变结算口径**。语料库里的题照旧由守护进程自动揭晓、照旧进审计与真值表；
 *      本模块只读 predictions，**零写账本**。把题挪进「语料库视图」不是把它搁置。
 *   ③ **别人的题只报数、不列行**。语料库 = **无归属记录**的题（批量灌入那些），
 *      绝不把「有主但不是我的」的题混进语料库——那等于把 A 的题面显示给 B。
 *
 * ── 归属怎么来的（两条路，都幂等）──────────────────────────────────────────
 *   ① 建题即归属：P0-4 的 `question_created` 事件上报时，同一请求自动落一行
 *      （how='created'）。前端零额外操作。
 *   ② 显式认领：POST /api/analytics/claim { prediction_id }（how='claim'），
 *      给「先有题、后有归属」的历史题补一条归属。
 *   归属**不可抢**：已归属他人的题再认领 → 409（不静默改写归属记录）。
 */
const { db } = require('../deps');
const { ensureAnalyticsTables } = require('./analyticsStore');

/** 三桶。listed=false 的桶只报数、不列行（见纪律③）。 */
const BUCKETS = [
  { key: 'mine', label: '我的题', listed: true, desc: '归属你的题' },
  { key: 'corpus', label: '语料库', listed: true, desc: '批量灌入、没有归属记录的题（**一条没删，只是归在这里**）' },
  { key: 'others', label: '别人的题', listed: false, desc: '有归属但不是你的题（**只报数，不列行**——不给你看别人的题面）' },
];
/** 可列举的视图（all = 前两桶的并集，仍不含他人题面；复核用）。 */
const VIEWS = ['mine', 'corpus', 'all'];
/** 归属来源。 */
const HOWS = ['created', 'claim'];

/** n<30 纪律：与 auditKpi.brierCi / 披露件 compiler 门面同口径。分母不足 30 一律不给比例。 */
const MIN_N = 30;

const SCHEMA_QUESTION_OWNERS = [
  'CREATE TABLE IF NOT EXISTS question_owners (',
  '  prediction_id INTEGER PRIMARY KEY REFERENCES predictions(id),',  // 一道题至多一个归属
  '  visitor_id TEXT NOT NULL REFERENCES analytics_visitors(visitor_id),',
  "  how TEXT NOT NULL CHECK(how IN ('created','claim')),",
  "  claimed_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ');',
  'CREATE INDEX IF NOT EXISTS idx_question_owners_visitor ON question_owners(visitor_id);',
].join('\n');

/** 建表：幂等（全部 IF NOT EXISTS）。必须先建 analytics_visitors（外键指向它）。 */
function ensureOwnershipTables(conn) {
  if (!conn) throw new Error('ensureOwnershipTables: 需要 better-sqlite3 连接');
  ensureAnalyticsTables(conn);
  conn.exec(SCHEMA_QUESTION_OWNERS);
}

function getOwner(predictionId) {
  return db.getConnection().prepare('SELECT * FROM question_owners WHERE prediction_id = ?')
    .get(predictionId) || null;
}

/**
 * 落一条归属。**幂等**：同一题同一访客重复认领 ⇒ duplicate（不产生第二行）。
 * 归属不可抢：已归属他人 ⇒ 返回 { taken_by_other:true }，调用方据此报 409（不静默改写）。
 * 题目不存在 ⇒ 抛 404（不凭空造归属行）。
 */
function claim(predictionId, visitorId, how) {
  const conn = db.getConnection();
  const p = conn.prepare('SELECT id FROM predictions WHERE id = ?').get(predictionId);
  if (!p) { const e = new Error('题 ' + predictionId + ' 不存在'); e.statusCode = 404; throw e; }
  const h = HOWS.indexOf(how) === -1 ? 'claim' : how;

  const cur = getOwner(predictionId);
  if (cur) {
    if (cur.visitor_id === visitorId) return { row: cur, duplicate: true, taken_by_other: false };
    return { row: cur, duplicate: false, taken_by_other: true };
  }
  conn.prepare('INSERT INTO question_owners (prediction_id, visitor_id, how) VALUES (?,?,?)')
    .run(predictionId, visitorId, h);
  return { row: getOwner(predictionId), duplicate: false, taken_by_other: false };
}

/** 某道题在「给 viewer 看」的语境下是否归他（不依赖视图，先查归属表）。 */
function getOwnerFor(predictionId, viewerId) {
  if (!viewerId) return null;
  return db.getConnection().prepare('SELECT * FROM question_owners WHERE prediction_id = ? AND visitor_id = ?')
    .get(predictionId, viewerId) || null;
}

/** 三桶计数（互斥且完备，恒等于账本总数）。 */
function bucketCounts(viewerId) {
  const conn = db.getConnection();
  const total = conn.prepare('SELECT COUNT(*) n FROM predictions').get().n;
  const mine = viewerId
    ? conn.prepare('SELECT COUNT(*) n FROM question_owners o JOIN predictions p ON p.id = o.prediction_id'
      + ' WHERE o.visitor_id = ?').get(viewerId).n
    : 0;
  const owned = conn.prepare('SELECT COUNT(*) n FROM question_owners').get().n;
  // 语料库 = 无归属记录（不是「不是我的」——见文件头纪律③）
  const corpus = conn.prepare(
    'SELECT COUNT(*) n FROM predictions p WHERE NOT EXISTS (SELECT 1 FROM question_owners o WHERE o.prediction_id = p.id)'
  ).get().n;
  const others = owned - mine;   // 有归属但不是我的
  return { mine: mine, corpus: corpus, others: others, total: total };
}

/** n<30 口径块：分母不足 30 ⇒ 比例给 null + note，原始计数照给。 */
function shareBlock(mineN, totalN) {
  const n = Number(mineN) || 0;
  const d = Number(totalN) || 0;
  const enough = d >= MIN_N;
  return {
    numerator: n, denominator: d, enough: enough,
    share: enough ? (d > 0 ? n / d : null) : null,
    note: enough
      ? ('分母 ' + d + ' ≥ ' + MIN_N + ' ⇒ 给比例')
      : ('账本里只有 ' + d + ' 条（不足 ' + MIN_N + '）⇒ 不给比例，只记原始计数'),
  };
}

/** 已自动揭晓（resolved_at 与 outcome 都非空）的条数，按三桶拆开。
 *  ★这个拆解是**账本的性质**、与当前视图无关：两个视图读到的必须是同一份数字，
 *    否则「语料库里的题也在自动结算」这件事会被界面自己说漏。 */
function autoRevealedCounts(viewerId) {
  const conn = db.getConnection();
  const REV = "resolved_at IS NOT NULL AND outcome IS NOT NULL";
  const total = conn.prepare('SELECT COUNT(*) n FROM predictions WHERE ' + REV).get().n;
  const mine = viewerId
    ? conn.prepare('SELECT COUNT(*) n FROM question_owners o JOIN predictions p ON p.id = o.prediction_id'
      + ' WHERE o.visitor_id = ? AND p.' + REV).get(viewerId).n
    : 0;
  const corpus = conn.prepare('SELECT COUNT(*) n FROM predictions p WHERE ' + REV
    + ' AND NOT EXISTS (SELECT 1 FROM question_owners o WHERE o.prediction_id = p.id)').get().n;
  const owned = conn.prepare('SELECT COUNT(*) n FROM question_owners o JOIN predictions p ON p.id = o.prediction_id'
    + ' WHERE p.' + REV).get().n;
  return { mine: mine, corpus: corpus, others: owned - mine, total: total };
}

const ROW_COLUMNS =
  'p.id AS id, p.statement AS statement, p.layer AS layer, p.source_type AS source_type,'
  + ' p.matures_at AS matures_at, p.resolved_at AS resolved_at, p.outcome AS outcome,'
  + ' p.assigned_prob AS assigned_prob, p.created_at AS created_at';

/** 列一个视图的行（mine / corpus / all）。
 *  `all` = 前两桶的并集（复核用），**仍不含他人题面**——隐私优先于"给个全量"。 */
function listView(view, viewerId, opts) {
  const o = opts || {};
  const limit = o.limit === undefined ? 50 : o.limit;
  const offset = o.offset === undefined ? 0 : o.offset;
  const conn = db.getConnection();
  const isMine = view === 'mine';
  const isCorpus = view === 'corpus';
  const join = isMine
    ? 'JOIN question_owners o ON o.prediction_id = p.id AND o.visitor_id = ?'
    : 'LEFT JOIN question_owners o ON o.prediction_id = p.id';
  // mine ⇒ 我名下的；corpus ⇒ 完全没有归属记录的；all ⇒ 前两者并集（排除归属他人的）
  const where = isMine ? 'WHERE o.prediction_id IS NOT NULL'
    : isCorpus ? 'WHERE o.prediction_id IS NULL'
      : 'WHERE (o.prediction_id IS NULL OR o.visitor_id = ?)';
  const bind = isMine ? [viewerId, limit, offset]
    : isCorpus ? [limit, offset]
      : [viewerId, limit, offset];
  const stmt = conn.prepare('SELECT ' + ROW_COLUMNS + ' FROM predictions p ' + join + ' ' + where
    + ' ORDER BY p.id DESC LIMIT ? OFFSET ?');
  return stmt.all.apply(stmt, bind).map((r) => ({
    id: r.id, statement: r.statement, layer: r.layer, source_type: r.source_type,
    matures_at: r.matures_at, resolved_at: r.resolved_at, outcome: r.outcome,
    assigned_prob: r.assigned_prob, created_at: r.created_at,
    // 行自带它属于哪个桶（前端不必自己猜；'all' 视图里逐行给准）
    view_bucket: (getOwnerFor(r.id, viewerId) ? 'mine' : 'corpus'),
  }));
}

/**
 * 给**一批已查出的题**标上归属桶，并给出这一集合的三桶计数。
 *
 * ── 为什么不能拿 listView 顶替 ──────────────────────────────────────────────
 *   `listView` 是**全账本**的三桶查询。而页面要的常常是**某个已过滤集合**的三桶拆解
 *   （例：「到期未解」这 33 条里我的几条、语料库几条、别人的几条）。
 *   集合不同 ⇒ 两条路算不出同一个数。
 *
 * ── 恒等式由构造保证，不是「测试里断言过的巧合」 ──────────────────────────────
 *   逐行标注与三桶计数读的是**同一次查询的同一份结果**（下面这一段循环），
 *   所以 `mine + corpus + others === ids.length` 在这里算不出错。
 *   接口纪律是「可自校验」；若两者来自两条独立查询，那句自校验就只是句口号。
 *
 * ── 口径与文件头纪律③一致，且 **fail-closed** ────────────────────────────────
 *   corpus = **无归属记录**（不是「不是我的」——这两个定义在有第二个访客时结果完全不同）；
 *   viewerId 为空（还没拿到访客标识）⇒ 任何有归属的行**一律判 others**：
 *   把别人的题说成你的，比如实说「这是别人的」坏得多。
 */
function bucketize(predictionIds, viewerId) {
  const ids = [];
  const seen = new Set();
  for (const n of (predictionIds || [])) {
    if (Number.isInteger(n) && !seen.has(n)) { seen.add(n); ids.push(n); }
  }
  const conn = db.getConnection();
  const ownerOf = new Map();
  // 分块查：IN 的占位符不能无限长。500 是 SQLite 默认变量上限（老版本 999）之内的安全值。
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => '?').join(',');
    const stmt = conn.prepare(
      'SELECT prediction_id AS id, visitor_id AS vid FROM question_owners WHERE prediction_id IN (' + ph + ')');
    for (const r of stmt.all.apply(stmt, chunk)) ownerOf.set(r.id, r.vid);
  }
  const buckets = {};
  const counts = { mine: 0, corpus: 0, others: 0, total: ids.length };
  for (const id of ids) {
    const vid = ownerOf.get(id);
    const b = vid === undefined ? 'corpus' : (viewerId && vid === viewerId ? 'mine' : 'others');
    buckets[id] = b;
    counts[b] += 1;
  }
  return { buckets, counts };
}

/**
 * 视图总览。**纯只读**：只读 predictions + question_owners，零写账本、零写归属。
 * 每个视图都返回三桶计数（不隐藏语料库与他人题的存在）。
 */
function viewSummary(view, viewerId) {
  const counts = bucketCounts(viewerId);
  const auto = autoRevealedCounts(viewerId);
  return {
    view: view,
    counts: counts,
    auto_revealed: auto,
    min_n: MIN_N,
    shares: {
      mine: shareBlock(counts.mine, counts.total),
      corpus: shareBlock(counts.corpus, counts.total),
      others: shareBlock(counts.others, counts.total),
    },
    buckets: BUCKETS,
    discipline: [
      '三桶互斥且完备：我的题 + 语料库 + 别人的题 ≡ 账本总数（可自校验，一条都没被藏）。',
      '语料库 = **无归属记录**的题（批量灌入那些）。**一条都没删**，只是归在这个视图里；'
      + '语料库里的题照旧由守护进程自动揭晓、照旧进审计与真值表。',
      '「已自动揭晓」的拆解是账本的性质，与当前看的是哪个视图无关——两个视图读到的必须是同一份数字。',
      '别人的题**只报数、不列行**：有归属但不是你的题不进你的任何视图，也不给你看它的题面。',
      '归属只决定「在哪个视图里出现」，**不改变结算口径、不改账本任何一列**。',
      '任何比例的分母 < ' + MIN_N + ' 一律不给数（只记原始计数）。',
    ],
    note: '本端点纯只读。语料库视图与「我的题」视图的并集 == 账本总数（除非有他人题，差额精确等于别人的题桶）。',
  };
}

module.exports = {
  ensureOwnershipTables, SCHEMA_QUESTION_OWNERS, claim, getOwner, getOwnerFor, bucketCounts,
  autoRevealedCounts, shareBlock, listView, viewSummary, bucketize, BUCKETS, VIEWS, HOWS, MIN_N,
};
