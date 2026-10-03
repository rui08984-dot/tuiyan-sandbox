'use strict';
/**
 * p1b/src/db/idempotencyStore.js —— 写口幂等键存储（2026-09-30，发行阻断项）。
 *
 * 【为什么这是阻断项而不是优化项】
 *   AI 客户端**默认会重试**超时的调用（mcp/tools.cjs 的 tier 注释也照这条前提写），
 *   而本项目的账本**不可改**（predictionsStore.resolvePrediction 的文件头：没有修正入口）。
 *   于是重试一次 = 多一条预测 = 用户的准确率**立刻**被污染，且没有任何补救手段。
 *
 * 【为什么不靠内容哈希去重】
 *   内容哈希会把「用户合法地记两条一模一样的判断」判成重试——那是误杀，
 *   而那两条判断是用户真的记了两次。所以**键必须由调用方给**（Idempotency-Key 头
 *   或 body.idempotency_key），服务端只校验它成不成立，不替调用方编。
 *   本表另存一列 `request_sha256`：它**不参与去重**，只用来在「同一个键配了不同请求体」
 *   时**如实报冲突**（409），而不是悄悄把另一条请求的结果端回去。
 *
 * 【存储切分】照 predictionsStore.js / oracleStore.js 先例：共享库禁 DDL，于是 p1b 私有表
 *   `CREATE TABLE IF NOT EXISTS` 的 additive 新表，**零碰 p1a 任何既有表**（禁改面）。
 *
 * 【认领协议】better-sqlite3 是同步 API，于是认领用一次 `INSERT OR IGNORE` 当原子闸：
 *   changes=1 ⇒ 本次调用拥有这个键，照常写、然后 complete()；
 *   changes=0 ⇒ 这个键以前用过：
 *       · state='done'      ⇒ **重放**首次的结果（同一个 id），本次不再写；
 *       · state='in_flight' ⇒ 上一次调用还在路上（进程内同步写，正常窗口极短）⇒ 409；
 *       · sha256 不一致     ⇒ 同一个键配了不同请求体 ⇒ 409，如实说清两个指纹。
 *   失败（含 400/404/409 各类校验错）一律 release() 删掉认领行再把异常抛出去——
 *   ★否则一个填错参数的请求就把这个键**永久毒化**，改对之后重试也永远拿不回 201。
 *
 * 【认领与账本写入不在同一个事务里 —— 这是一处**已知且有界的**缺口，不隐瞒】
 *   好处：被 `idempotent()` 包住的处理函数将来变成异步（有 await 的 I/O）也不会把写事务
 *   撑到 await 之后——那会卡住 SQLite 唯一的写者。宁可不要这个"好处"里的反面。
 *   代价：若进程**恰好死在**认领与账本写入之间，这一个键会永远停在 in_flight，
 *   用同一个键重发恒得 409。范围有界（只影响那一个键，不影响任何别的写入），
 *   症状可查（`SELECT * FROM idempotency_keys WHERE state='in_flight'`），
 *   处方如实写在 409 文案里（换一个键；或按那条 SELECT 手工清掉那一行）。
 *   正常路径下这个窗口是零 await 的同步区间，不存在可观测的中间态。
 *
 * 【不带键的老调用方】不是拒绝，是照写 + 留痕：写一行 `keyed=0` 的记录
 *   （含请求指纹与响应体快照），并把这件事如实回给调用方。
 *   静默改成拒绝会让所有网页端调用全挂，那是破坏性变更（见 routes/idempotency.js 文件头）。
 */
const crypto = require('crypto');
const store = require('./store');

/** 幂等键长度上限（超长即拒，不静默截断——截断会让两个不同的键撞成同一个）。 */
const MAX_KEY_LEN = 255;
/** 请求体字段名（与 HTTP 头 idempotency-key 同义，二选一即可给）。 */
const IDEM_BODY_FIELD = 'idempotency_key';
const IDEM_HEADER = 'idempotency-key';

/**
 * 键里不许有的字符：控制字符（ASCII 0..31 与 127）、逗号/引号类分隔符。
 * 用码位逐个判，不用正则——正则里写控制字符字面量会让源文件本身变成"二进制"，
 * 源码扫描类工具（发行闸 C3 逐行扫）读它会直接报错。一行码位判断就够，不值当。
 */
const KEY_BAD_CHARS = [',', '"', "'", '\\', ' ', '\t'];
function badCharIn(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
    if (KEY_BAD_CHARS.indexOf(s[i]) !== -1) return true;
  }
  return false;
}

/**
 * p1b 私有表 DDL。★`keyed` 与 `state` 是两件事：
 *   `keyed`=调用方带没带键（证据行）；`state`=这次带键的写入走到哪一步了。
 *   未带键的行一律 keyed=0 且直接 state='done'（没有认领过程可言）。
 */
const IDEMPOTENCY_TABLE_DDL = [
  'CREATE TABLE IF NOT EXISTS idempotency_keys (',
  '  scope TEXT NOT NULL,',
  '  idem_key TEXT NOT NULL,',
  '  keyed INTEGER NOT NULL CHECK(keyed IN (0,1)),',
  '  request_sha256 TEXT NOT NULL,',
  "  state TEXT NOT NULL CHECK(state IN ('in_flight','done')),",
  '  status_code INTEGER,',
  '  result_json TEXT,',
  "  created_at TEXT DEFAULT (datetime('now')),",
  '  completed_at TEXT,',
  '  PRIMARY KEY (scope, idem_key)',
  ');',
].join('\n');

let ensuredFor = null; // 已建表的连接对象；换连接（测试 :memory: / 重开）自动重跑

/**
 * 建 p1b 私有表（幂等）。**只在连接对象换掉时重跑**——同一连接上 CREATE TABLE IF NOT EXISTS
 * 是纯开销，而写口每次落注都要过这里。
 */
function ensureIdempotencyTable(conn) {
  if (!conn) throw new Error('ensureIdempotencyTable: 需要 better-sqlite3 连接');
  if (ensuredFor === conn) return;
  conn.exec(IDEMPOTENCY_TABLE_DDL);
  ensuredFor = conn;
}

/** 连接换了（测试换库/重开进程）时忘掉已建标记。测试用；生产不需要。 */
function resetEnsureCache() {
  ensuredFor = null;
}

function keyError(msg) {
  const e = new Error(IDEM_HEADER + ' ' + msg);
  e.statusCode = 400;
  return e;
}

/**
 * 键的形状校验。**只校验、不生成、不猜**：没给就是没给（走 keyed=0 那条路），
 * 给了就必须是可打印的非空短串；超长串/控制字符/非字符串一律 400
 * （当场报错，好过"存一个垃圾键然后永久占坑"）。
 *
 * ★**空串与纯空白一律当"没给"**，不报 400：有些 HTTP 客户端会把没填的键发成
 *   `Idempotency-Key: `（空值），把它判成非法等于让这些调用方直接写不进去——
 *   那是破坏性变更，而破坏性变更正是本轮明令不许做的。这类调用照样**照写**，
 *   并且照样在响应里如实回报"这次没带键"，所以它不是静默裸奔。
 * @returns {string|null} 规范化后的键；调用方没给（或给的是空/空白）时返回 null
 */
function normalizeKey(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw keyError('必须是字符串（收到 ' + typeof raw + '），收到: ' + JSON.stringify(raw));
  }
  const k = raw.trim();
  if (k.length === 0) return null; // 空/纯空白＝没给（见上）
  if (k.length > MAX_KEY_LEN) {
    throw keyError('长度不得超过 ' + MAX_KEY_LEN + '，收到长度 ' + k.length + '（不静默截断：截断会让两个不同的键撞成同一个）');
  }
  if (badCharIn(k)) {
    throw keyError('不得含内部空白或控制字符（换行/制表/逗号/引号等）——它要进 HTTP 头，也进日志');
  }
  return k;
}

/**
 * 稳定序列化（**只用于算指纹**）。键名排序 ⇒ 同内容不同书写顺序算出同一个指纹，
 * 否则调用方重试时把 JSON 键序换了就会被误判成"同一个键配了不同请求体"。
 * `idempotency_key` 自身从指纹里剔掉（键是"这次是谁"，不是"这次要做什么"）。
 */
function canonicalize(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const keys = Object.keys(v).filter((k) => k !== IDEM_BODY_FIELD).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
}

/** 请求指纹 = 路径参数 + 查询串 + 稳定序列化请求体 的 sha256（十六进制）。 */
function requestFingerprint(req) {
  const parts = [];
  parts.push('params:' + canonicalize((req && req.params) || {}));
  parts.push('query:' + canonicalize((req && req.query) || {}));
  parts.push('body:' + canonicalize((req && req.body) || {}));
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** 认领结果判据（穷尽四态，路由层逐态处理，不许 default 兜底）。 */
const CLAIM_CLAIMED = 'claimed';
const CLAIM_REPLAY = 'replay';
const CLAIM_CONFLICT = 'conflict';
const CLAIM_IN_FLIGHT = 'in_flight';
/** 认领重试上限（只为应对"行刚被别人删掉"这一种瞬时态；正常一发即中）。 */
const CLAIM_ATTEMPTS = 5;

function readRow(conn, scope, key) {
  return conn.prepare('SELECT * FROM idempotency_keys WHERE scope=? AND idem_key=?').get(scope, key);
}

/**
 * 认领一个幂等键（原子）。见文件头「认领协议」。
 * @returns {{outcome:'claimed'}|{outcome:'replay',status:number,body:*}|{outcome:'conflict',first_sha256:string}|{outcome:'in_flight'}}
 */
function claim(conn, scope, key, sha) {
  const ins = conn.prepare(
    "INSERT OR IGNORE INTO idempotency_keys (scope, idem_key, keyed, request_sha256, state) VALUES (?, ?, 1, ?, 'in_flight')");
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const info = ins.run(scope, key, sha);
    if (info.changes === 1) return { outcome: CLAIM_CLAIMED };
    const row = readRow(conn, scope, key);
    // 认领行已被上一次失败的调用删掉（见 release）⇒ 原地重试认领，不当冲突处理。
    if (!row) continue;
    if (row.state === 'done') {
      if (row.request_sha256 !== sha) return { outcome: CLAIM_CONFLICT, first_sha256: row.request_sha256 };
      let body = null;
      if (row.result_json !== null && row.result_json !== undefined) {
        try { body = JSON.parse(row.result_json); } catch (e) { body = null; }
      }
      return { outcome: CLAIM_REPLAY, status: row.status_code === null ? 200 : row.status_code, body: body };
    }
    return { outcome: CLAIM_IN_FLIGHT };
  }
  return { outcome: CLAIM_IN_FLIGHT };
}

/**
 * 写完账本后登记首次结果（供重放）。
 * @throws 序列化失败时抛错（由路由层 release 掉认领行）——宁可整次失败，
 *   也不能出现"写进账本了但没有可重放的结果"，那正是超时重试要挡的那种污染。
 */
function complete(conn, scope, key, statusCode, payload) {
  let json;
  try {
    json = JSON.stringify(payload === undefined ? null : payload);
  } catch (e) {
    const err = new Error('幂等结果无法序列化，认领已作废（本次未留下半截记录）: ' + e.message);
    err.statusCode = 500;
    throw err;
  }
  conn.prepare(
    "UPDATE idempotency_keys SET state='done', status_code=?, result_json=?, completed_at=datetime('now')"
    + ' WHERE scope=? AND idem_key=?')
    .run(statusCode, json, scope, key);
}

/** 失败路径：删掉认领行，让同一个键还能被下一次（改对参数后的）调用正常使用。 */
function release(conn, scope, key) {
  conn.prepare("DELETE FROM idempotency_keys WHERE scope=? AND idem_key=? AND state='in_flight'").run(scope, key);
}

/**
 * 未带键的一次照写留痕（keyed=0）。★这是「证据」那一半：调用方那边能看到的只是响应，
 * 落在这里才查得到"这批写入里有多少是没带键的"。
 * @param {*} [payload] 响应体快照（留它是为了能逐字节比对"老调用方行为未变"，不是给人看的）
 */
function recordAbsent(conn, scope, sha, statusCode, payload) {
  let json = null;
  try { json = JSON.stringify(payload === undefined ? null : payload); } catch (e) { json = null; }
  conn.prepare(
    "INSERT INTO idempotency_keys (scope, idem_key, keyed, request_sha256, state, status_code, result_json, completed_at)"
    + " VALUES (?, ?, 0, ?, 'done', ?, ?, datetime('now'))")
    .run(scope, 'absent:' + crypto.randomBytes(12).toString('hex'), sha, statusCode, json);
}

module.exports = {
  IDEMPOTENCY_TABLE_DDL, IDEM_BODY_FIELD, IDEM_HEADER, MAX_KEY_LEN,
  CLAIM_CLAIMED, CLAIM_REPLAY, CLAIM_CONFLICT, CLAIM_IN_FLIGHT,
  ensureIdempotencyTable, resetEnsureCache, normalizeKey, canonicalize, requestFingerprint,
  claim, complete, release, recordAbsent, badCharIn,
};
