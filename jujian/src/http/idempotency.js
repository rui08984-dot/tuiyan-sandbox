'use strict';
/**
 * p1b/src/routes/idempotency.js —— 写口的幂等包装器（2026-09-30，发行阻断项）。
 *
 * 【要挡的那件事】
 *   AI 客户端**默认会重试**超时的调用；账本**不可改**（无修正入口）。
 *   ⇒ 没有幂等时，一次超时重试就是多一条预测/一个局/一条事件/一条排盘档，
 *     用户的准确率当场被污染，而且**没有任何补救手段**。
 *
 * 【三条口径（缺一条就等于没做）】
 *   ① **键由调用方给**（HTTP 头 `Idempotency-Key` 或 body `idempotency_key`），
 *      **不靠内容哈希**——内容相同也可能是用户合法地记了两次，替调用方去重＝误杀用户判断。
 *   ② **不带键的老调用方照写**，不静默改成拒绝（那会让所有网页端调用全挂，是破坏性变更）；
 *      改为**如实返回**（响应体 `idempotency` 段 + 响应头）**并在证据里留痕**（落一行 `keyed=0`）。
 *   ③ **重放同一键返回首次的结果**，含**同一个 id** —— 调用方要靠它对账，
 *      返回"新建的那条"等于让重试和首发变成两笔账。
 *
 * 【响应体逐字节不变的那一半】
 *   老调用方（不带键）拿到的响应体，与加幂等之前**逐字段相同**；
 *   新增的只有一个顶层 `idempotency` 段，是**纯附加**（不改任何既有字段的值），
 *   且同一份响应体原文落在 `idempotency_keys.result_json` 里，可逐字节回比。
 *   账本那一侧则是完全不变：写入路径、写入内容、写入条数，与从前逐字节一致。
 *
 * 【错误语义】
 *   · 同一个键 + 同一个请求体 ⇒ 重放（200/201 与首次相同，id 相同）。
 *   · 同一个键 + **不同**请求体 ⇒ 409（如实给出两个请求指纹，绝不把另一条请求的结果端回去）。
 *   · 同一个键正被别人认领（进程内 in_flight 窗口）⇒ 409（如实说"上一次还没写完"）。
 *   · 处理过程中抛错（400/404/409 各类校验错）⇒ **先删认领行再抛**，
 *     否则一个填错参数的请求就把这个键永久毒化。
 */
const store = require('../db/store');
const { httpError } = require('./util');
const idem = require('../db/idempotencyStore');

/** 响应头：本次写入在幂等协议里处于什么位置（`absent` / `first-write` / `replayed`）。 */
const STATUS_HEADER = 'idempotency-status';

/**
 * 取调用方给的键：HTTP 头优先，其次 body 字段；两处都给了必须一致，不一致即 400。
 * @returns {*} 原始值（未规范化；形状校验由 idem.normalizeKey 统一做）
 */
function rawKeyOf(req) {
  const headers = (req && req.headers) || {};
  const fromHeader = headers[idem.IDEM_HEADER];
  const body = (req && req.body) && typeof req.body === 'object' ? req.body : {};
  const fromBody = body[idem.IDEM_BODY_FIELD];
  if (fromHeader !== undefined && fromHeader !== null && fromBody !== undefined && fromBody !== null
    && String(fromHeader).trim() !== String(fromBody).trim()) {
    throw httpError(400, '幂等键给了两处且不一致：HTTP 头 ' + idem.IDEM_HEADER + ' 与 body.' + idem.IDEM_BODY_FIELD
      + ' 必须相同（防把两次不同的写入当成同一次的重试）');
  }
  if (fromHeader !== undefined && fromHeader !== null) return fromHeader;
  return fromBody === undefined ? null : fromBody;
}

/** 处理后的 HTTP 状态码（处理函数内部可以自己 reply.code(201)）。 */
function statusOf(reply) {
  const c = reply && typeof reply.statusCode === 'number' ? reply.statusCode : 200;
  return c || 200;
}

/** 把幂等说明挂到响应体上（**纯附加**：既有字段一个都不动；非对象响应体原样返回）。 */
function annotate(payload, meta) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return Object.assign({}, payload, { idempotency: meta });
}

function meta(provided, replayed, extra) {
  return Object.assign({
    provided: provided,
    replayed: replayed,
    key_header: idem.IDEM_HEADER,
    key_body_field: idem.IDEM_BODY_FIELD,
  }, extra || {});
}

/**
 * 建表（幂等；注册时调一次，与 predictionsStore/oracleStore 的 ensure 同一模式）。
 */
function ensureIdempotencyTables(conn) {
  idem.ensureIdempotencyTable(conn || store.getConnection());
}

/**
 * 幂等包装器：`idempotent(scope, handler)` 返回一个可直接挂 `app.post` 的处理函数。
 * @param {string} scope 路由模板（如 `POST /api/predictions`）；用作键的命名空间，
 *   取路由模板而不是实际 URL，是为了让「同一个键用在另一个口」判成冲突而不是串账。
 * @param {Function} handler 原处理函数（签名不变 `(req, reply)`）
 */
function idempotent(scope, handler) {
  return async function idempotentHandler(req, reply) {
    const conn = store.getConnection();
    idem.ensureIdempotencyTable(conn);
    const key = idem.normalizeKey(rawKeyOf(req));
    const sha = idem.requestFingerprint(req);

    // ── ② 老调用方：没带键 ⇒ 照写，如实回报，并在证据里留一行 ──
    if (key === null) {
      const payload = await handler(req, reply);
      const status = statusOf(reply);
      idem.recordAbsent(conn, scope, sha, status, payload);
      reply.header(STATUS_HEADER, 'absent');
      return annotate(payload, meta(false, false, {
        why: '本次请求未带幂等键（HTTP 头 ' + idem.IDEM_HEADER + ' 或 body.' + idem.IDEM_BODY_FIELD + '）——'
          + '按既有行为照写一次，不拒绝；但客户端若重试这次调用，账本会多一行。'
          + '带幂等键后重试则返回首次的结果（同一个 id），不多写。',
        evidence: '本次写入已在 idempotency_keys 留痕（keyed=0），可查"这批写入里有多少没带键"。',
      }));
    }

    // ── ① 带键：认领 → 照写 → 登记首次结果；已认领过则重放 ──
    reply.header(idem.IDEM_HEADER, key);
    const c = idem.claim(conn, scope, key, sha);
    if (c.outcome === idem.CLAIM_REPLAY) {
      reply.code(c.status);
      reply.header(STATUS_HEADER, 'replayed');
      return annotate(c.body, meta(true, true, {
        note: '同一个幂等键的首次写入已在账本里，本次未新增任何行，返回的就是首次那条（含同一个 id）。',
      }));
    }
    if (c.outcome === idem.CLAIM_CONFLICT) {
      throw httpError(409, '同一个幂等键配了不同的请求体 ⇒ 拒绝（否则会把另一条请求的结果当成本次结果端回去）。'
        + '本次请求指纹 ' + sha.slice(0, 16) + '，该键首次写入的指纹 ' + String(c.first_sha256).slice(0, 16) + '。'
        + '要真的再写一次，请换一个幂等键——每一次逻辑写入用一个新的键。');
    }
    if (c.outcome === idem.CLAIM_IN_FLIGHT) {
      throw httpError(409, '同一个幂等键的首次写入还在进行中（认领未完成）⇒ 本次拒绝。'
        + '这不是"重试"（重试会拿到首次结果），是并发；等首次那次返回后再决定要不要重试。'
        + '★若首次那次是进程崩溃/被杀留下的（认领行永远停在 in_flight），'
        + '换一个幂等键即可照常写入——账本那一侧没有半截记录（认领行是独立的一行，不含账本内容）。');
    }
    let payload;
    try {
      payload = await handler(req, reply);
      idem.complete(conn, scope, key, statusOf(reply), payload);
    } catch (e) {
      idem.release(conn, scope, key); // 失败不占坑：改对参数后同一个键还能正常用
      throw e;
    }
    reply.header(STATUS_HEADER, 'first-write');
    return annotate(payload, meta(true, false, {
      note: '本次是该幂等键的首次写入；之后用同一个键重发将返回这一条（同一个 id），不多写。',
    }));
  };
}

module.exports = { idempotent, ensureIdempotencyTables, STATUS_HEADER, rawKeyOf, statusOf };
