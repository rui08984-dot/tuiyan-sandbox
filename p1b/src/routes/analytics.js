'use strict';
/**
 * p1b/src/routes/analytics.js —— P0-4 埋点端点（三写一读，additive 新增，零碰既有端点）。
 *
 *   POST /api/analytics/session/start  会话开始（无 id ⇒ 服务端发访客 id；有 session_id ⇒ 幂等）
 *   POST /api/analytics/session/end    会话结束（幂等：首次结束时间不被覆盖）
 *   POST /api/analytics/event          三事件上报：question_created / question_settled / question_revisited
 *   GET  /api/analytics/summary        计数导出（**纯只读**：零写、零 LLM）
 *   ── P0-5：题的两视图（我的题 / 语料库）────────────────────────────────────
 *   POST /api/analytics/claim          认领一道题归某个访客（幂等；归属不可抢 → 409）
 *   GET  /api/analytics/questions      两视图只读端点（?view=mine|corpus|all；缺省 mine）
 *
 * ── ★隐私硬约束（本文件的第一纪律，写在这里是因为它最容易在赶工时被破坏）────
 *   本文件**从不 spread 请求体**。每个入参都从白名单里逐个取值，取不到的键直接丢弃。
 *   于是「把题面顺手塞进请求体」这个动作在结构上就无法落库——测试里有反证：
 *   带 statement / email / ip / user_agent 的请求返回 200，但三张表里扫不到任何一个字。
 *   题目只以 subject_id（整数）出现：可计数、不可阅读。
 *   要看题面请走题库自己的端点；埋点不复制题面、不记 IP / UA / Referer / 任何个人信息。
 *
 * ── ★作者判定（详见 src/db/analyticsStore.js 文件头与 docs/specs/2026-09-28-P0-4-埋点与作者判定-design.md）──
 *   出示方式二选一：请求体 `author_key`，或 header `x-p1b-author-key`。
 *   服务端与 env `P1B_AUTHOR_KEY` 做常量时间比较 ⇒ actor = author | visitor。
 *   未配 env ⇒ fail-closed（谁也判不出作者），且 GET summary 会显式告警。
 *
 * ── 前端怎么用（最小接线）───────────────────────────────────────────────────
 *   1) 进站：POST /api/analytics/session/start（带 localStorage 里存着的 visitor_id，可选）
 *      ⇒ 存下返回的 visitor_id / session_id；
 *   2) 离站：pagehide/卸载时 POST /api/analytics/session/end { session_id, reason:'pagehide' }；
 *   3) 建题成功 / 落定完成 / 点开一道题：POST /api/analytics/event
 *      { event, visitor_id, session_id, subject_id }。
 *   重复调用都幂等，重复上报不会把数刷大。
 *
 * ── P0-5：建题即归属 ────────────────────────────────────────────────────────
 *   上报 `question_created` 时，同一个请求顺带把这道题记到访客名下（how='created'），
 *   前端不用为归属多调一个接口；漏报也只是"进语料库"，**不丢题**。
 */
const { httpError } = require('../util');
const store = require('../db/analyticsStore');
const ownership = require('../db/ownershipStore');

/** 从请求里取作者密钥：body 优先，其次 header。两个都只用于内存里的一次比较。 */
function presentedKey(req) {
  const body = req.body || {};
  if (typeof body.author_key === 'string' && body.author_key) return body.author_key;
  const h = req.headers && req.headers['x-p1b-author-key'];
  return typeof h === 'string' && h ? h : undefined;
}

/** 访客 id：可空；给了但格式不合法 ⇒ 400（不静默丢弃，免得前端以为记上了）。 */
function visitorIdOr(req, name) {
  const body = req.body || {};
  const v = body[name];
  if (v === undefined || v === null || v === '') return undefined;
  if (!store.isValidId(v)) throw httpError(400, name + ' 格式非法（只允许字母数字与 _ - . :，≤64 字符）');
  return v;
}

function subjectIdOr(req) {
  const body = req.body || {};
  const s = body.subject_id;
  if (s === undefined || s === null || s === '') return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw httpError(400, 'subject_id 必须是非负整数（只收题的整数 id，**不收题面**）');
  return n;
}

/** 认领要落归属 ⇒ 访客必须已存在（服务端发过号）。陌生 id 400，不凭空造归属。 */
function requireKnownVisitor(visitorId) {
  if (!store.getVisitorRow(visitorId)) {
    throw httpError(400, 'visitor_id ' + visitorId + ' 不认识——请先 POST /api/analytics/session/start 换一个');
  }
  return visitorId;
}

function register(app /*, ctx */) {
  // 建表放在注册时：additive + 幂等，零碰 p1a 既有表（照 intakeStore/verdictsStore 范式）
  store.ensureAnalyticsTables(require('../deps').db.getConnection());
  ownership.ensureOwnershipTables(require('../deps').db.getConnection());

  app.post('/api/analytics/session/start', async (req) => {
    const sessionId = visitorIdOr(req, 'session_id');
    const r = store.startSession({
      visitorId: visitorIdOr(req, 'visitor_id'),
      sessionId: sessionId,
      authorKey: presentedKey(req),
    });
    return {
      ok: true,
      visitor_id: r.visitor_id || r.session.visitor_id,
      session_id: r.session.session_id,
      actor: r.actor,                       // 'author' | 'visitor' —— 计数时按这个分桶
      actor_proof: r.actor_proof || r.session.actor,
      duplicate: r.duplicate,               // 同一 session_id 重复 start ⇒ true（不新开一行）
      visitor_reissued: r.reissued,         // 客户端带来的访客 id 不认识 ⇒ 服务端重发了一枚
      started_at: r.session.started_at,
    };
  });

  app.post('/api/analytics/session/end', async (req) => {
    const body = req.body || {};
    const sessionId = body.session_id;
    if (typeof sessionId !== 'string' || !store.isValidId(sessionId)) {
      throw httpError(400, 'session_id 必须是非空字符串（≤64 字符，字母数字与 _ - . :）');
    }
    const reason = (typeof body.reason === 'string' && store.END_REASONS.indexOf(body.reason) !== -1)
      ? body.reason : null;
    const r = store.endSession(sessionId, reason);
    if (!r) throw httpError(404, 'session ' + sessionId + ' 不存在（如实报错，不静默造行）');
    return { ok: true, session_id: r.session.session_id, ended_at: r.session.ended_at, duplicate: r.duplicate };
  });

  app.post('/api/analytics/event', async (req) => {
    const body = req.body || {};
    const event = body.event;
    if (typeof event !== 'string' || store.EVENTS.indexOf(event) === -1) {
      throw httpError(400, 'event 必须是 ' + store.EVENTS.join('|') + '，收到: ' + JSON.stringify(event));
    }
    // ★白名单取值：body 里其余键（题面/邮箱/IP/UA…）在这里就被丢掉，不会进存储层。
    const r = store.recordEvent({
      event: event,
      visitorId: visitorIdOr(req, 'visitor_id'),
      sessionId: visitorIdOr(req, 'session_id'),
      subjectId: subjectIdOr(req),
      authorKey: presentedKey(req),
    });
    const sid = r.event_row ? r.event_row.subject_id : null;
    // ★P0-5 建题即归属：报了一次「建题」就等于宣布这道题归我——前端不用为归属多调一个接口。
    //   归属失败（如题已被别人认领）**不牵连埋点**：埋点照记，归属照旧归原来那个人。
    let owned = null;
    if (event === 'question_created' && sid !== null) {
      try {
        owned = ownership.claim(sid, r.visitor_id, 'created').row;
      } catch (e) { owned = null; }
    }
    return {
      ok: true, event: event, duplicate: r.duplicate, actor: r.actor,
      visitor_id: r.visitor_id,
      subject_id: sid,
      owned: owned ? { prediction_id: owned.prediction_id, how: owned.how } : null,
    };
  });

  // ── P0-5：认领一道题（幂等；归属不可抢 → 409；题不存在 → 404）──
  app.post('/api/analytics/claim', async (req) => {
    const body = req.body || {};
    const pid = Number(body.prediction_id);
    if (!Number.isInteger(pid) || pid <= 0) throw httpError(400, 'prediction_id 必须是正整数（只收题的整数 id）');
    const visitorId = requireKnownVisitor(visitorIdOr(req, 'visitor_id'));
    const r = ownership.claim(pid, visitorId, (typeof body.how === 'string' && body.how) ? body.how : 'claim');
    if (r.taken_by_other) {
      throw httpError(409, '题 ' + pid + ' 已归属另一位使用者 —— 归属不可抢，也不可静默改写');
    }
    const vr = store.getVisitorRow(visitorId);
    return { ok: true, prediction_id: pid, visitor_id: visitorId, actor: vr ? vr.actor : 'visitor',
      duplicate: r.duplicate, how: r.row.how, claimed_at: r.row.claimed_at };
  });

  // ── P0-5：题的两视图只读端点（我的题 / 语料库）──────────────────────────
  //   缺省 view=mine：**外部用户第一屏不再是一整片他不认识的机器题**。
  //   ★但语料库一条没删：每个视图都同时报出 mine / corpus / others 三个数，
  //     三者之和恒等于账本总数（前端可自校验，不靠口头承诺）。
  app.get('/api/analytics/questions', async (req) => {
    const q = (req && req.query) || {};
    const view = (q.view === undefined || q.view === '' || q.view === null) ? 'mine' : String(q.view);
    if (ownership.VIEWS.indexOf(view) === -1) {
      throw httpError(400, 'view 必须是 ' + ownership.VIEWS.join('|') + '，收到: ' + JSON.stringify(view));
    }
    const rawVisitor = (q.visitor_id === undefined || q.visitor_id === '') ? null : String(q.visitor_id);
    if (rawVisitor && !store.isValidId(rawVisitor)) {
      throw httpError(400, 'visitor_id 格式非法（只允许字母数字与 _ - . :，≤64 字符）');
    }
    // ★「我的题」缺 visitor_id ⇒ 400。宁可报错，**绝不用全库冒充「我的」**。
    if (view === 'mine' && !rawVisitor) {
      throw httpError(400, 'view=mine 必须带 visitor_id —— 不知道你是谁时，「我的题」只能是不给，而不是给你全库');
    }
    const visitorId = rawVisitor ? requireKnownVisitor(rawVisitor) : null;
    const limit = q.limit === undefined ? 50 : Number(q.limit);
    const offset = q.offset === undefined ? 0 : Number(q.offset);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) throw httpError(400, 'limit 必须是 1..500 的整数');
    if (!Number.isInteger(offset) || offset < 0) throw httpError(400, 'offset 必须是非负整数');
    return Object.assign(ownership.viewSummary(view, visitorId), {
      ok: true,
      viewer: { visitor_id: visitorId, actor: visitorId ? (store.getVisitorRow(visitorId) || {}).actor : null },
      rows: ownership.listView(view, visitorId, { limit: limit, offset: offset }),
      page: { limit: limit, offset: offset },
    });
  });

  // ★只读导出端点：供作者本人和用户直接查「有没有人用过第二次」。
  app.get('/api/analytics/summary', async () => store.summary());
}

module.exports = { register };
