'use strict';
/**
 * p1b/src/routes/events.js —— 事件录入与修订路由（P1B-SPEC §3/§4）：
 *   POST /api/games/:id/events/macro    （宏待确认卡：§4 三宏直接结构化构造，不走 LLM —— 契约扩展路由）
 *   POST /api/games/:id/events/extract  （自由文本 → LIVE/mock 抽取 → 待确认卡）
 *   POST /api/games/:id/events/confirm  （确认后的 event+claims+actions → 入账；宏与自由文本同一入库路径）
 *   POST /api/games/:id/claims/:claimId/edit | retract   （actions 同构）
 * 安全/账本纪律：retracted 行拒绝修改（409）；edit/retract 校验 claim 归属局；全 confirm 事务原子。
 */
const { db, llm } = require('../deps');
const botcClaims = require('../botc/claims'); // B2：BOTC 局声称分流（角色→主表归一，阵营/状态→botc_claims）
const { withBotcExtractContext, mapBotcCarriersBack } = require('../botc/extractPrompt'); // B7：抽取侧 BOTC 上下文注入+载体还原
const { buildMacroCard, MACRO_KINDS } = require('../macros');
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404, currentDayOf } = require('./games');
const {
  httpError, requireInt, requireEnum, requireNonEmptyString,
  PHASES, PREDICATES, ACTIONS, ACTIONS_NEED_TARGET, EVENT_TYPES,
} = require('../util');

// B7 机械复查：原话含 BOTC 阵营/状态关键词但抽取 0 claims → 警告留痕（防整条丢失无痕）
const BOTC_ZERO_CLAIM_KEYWORDS = /醉酒|醉了|中毒|被投毒|毒了|恶魔|爪牙/;

function seatExistsOr400(gameId, seat, label) {
  if (!db.seatExists(gameId, seat)) {
    throw httpError(400, label + '=' + seat + ' 不在局 ' + gameId + ' 的座位名单中');
  }
  return seat;
}

function validateEventHead(gameId, ev) {
  if (!ev || typeof ev !== 'object') throw httpError(400, 'event 必须是对象');
  const day = requireInt('event.day', ev.day, 1);
  const phase = requireEnum('event.phase', ev.phase, PHASES);
  const type = requireEnum('event.type', ev.type, EVENT_TYPES);
  const rawText = requireNonEmptyString('event.raw_text', ev.raw_text === undefined ? '' : String(ev.raw_text));
  let actor = (ev.actor_seat === null || ev.actor_seat === undefined) ? null : requireInt('event.actor_seat', ev.actor_seat, 1);
  if (actor !== null) seatExistsOr400(gameId, actor, 'event.actor_seat');
  else if (type !== 'system') throw httpError(400, '非 system 事件必须带 event.actor_seat');
  return { day, phase, type, raw_text: rawText, actor_seat: actor };
}

function validateClaim(gameId, c, idx, extraPredicates) {
  if (!c || typeof c !== 'object') throw httpError(400, 'claims[' + idx + '] 必须是对象');
  const seat = requireInt('claims[' + idx + '].seat', c.seat, 1);
  const subject = requireInt('claims[' + idx + '].subject_seat', c.subject_seat, 1);
  // B2：botc 局传入 BOTC 专属谓词扩展枚举（is_demon/is_minion/status_drunk/status_poisoned）；
  // 缺省仅 7 通用枚举（werewolf 路径零改动，BOTC 谓词在 werewolf 局直接 400）
  const enums = (extraPredicates && extraPredicates.length) ? PREDICATES.concat(extraPredicates) : PREDICATES;
  const predicate = requireEnum('claims[' + idx + '].predicate', c.predicate, enums);
  const isBotcPredicate = !!(extraPredicates && extraPredicates.includes(predicate));
  // BOTC 专属谓词（阵营/状态类）无对象语义：object 为可选备注，缺省 ''
  const object = isBotcPredicate
    ? (c.object === undefined || c.object === null ? '' : String(c.object).trim())
    : requireNonEmptyString('claims[' + idx + '].object', c.object === undefined ? '' : String(c.object));
  seatExistsOr400(gameId, seat, 'claims[' + idx + '].seat');
  seatExistsOr400(gameId, subject, 'claims[' + idx + '].subject_seat');
  return { seat, subject_seat: subject, predicate, object };
}

function validateAction(gameId, a, idx) {
  if (!a || typeof a !== 'object') throw httpError(400, 'actions[' + idx + '] 必须是对象');
  const seat = requireInt('actions[' + idx + '].seat', a.seat, 1);
  seatExistsOr400(gameId, seat, 'actions[' + idx + '].seat');
  const action = requireEnum('actions[' + idx + '].action', a.action, ACTIONS);
  let target;
  if (a.target_seat === null || a.target_seat === undefined) target = null;
  else target = requireInt('actions[' + idx + '].target_seat', a.target_seat, 1);
  if (ACTIONS_NEED_TARGET.includes(action)) {
    if (target === null) throw httpError(400, 'actions[' + idx + ']: ' + action + ' 需要 target_seat');
    seatExistsOr400(gameId, target, 'actions[' + idx + '].target_seat');
  } else {
    target = null; // abstain/self_explode 固定无目标
  }
  const result = (a.result === undefined || a.result === null) ? null : String(a.result);
  return { seat, action, target_seat: target, result };
}

function register(app, ctx) {
  // ── §4 宏：直接结构化构造（不走 LLM），产同构待确认卡 ──
  app.post('/api/games/:id/events/macro', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const card = buildMacroCard(req.body);
    seatExistsOr400(gameId, card.event.actor_seat, 'seat');
    for (const c of card.claims) seatExistsOr400(gameId, c.subject_seat, '对象席位');
    return card;
  });

  // ── 自由文本抽取（LIVE 或 mock；P1B_LLM_MOCK=1 时零网络）──
  app.post('/api/games/:id/events/extract', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const body = req.body || {};
    const text = requireNonEmptyString('text', body.text === undefined ? '' : String(body.text));
    const players = db.getPlayers(gameId);
    if (!players.length) throw httpError(400, '局 ' + gameId + ' 没有席位，无法抽取');
    const currentDay = currentDayOf(gameId);
    const day = body.day === undefined || body.day === null || body.day === ''
      ? (currentDay || 1) : requireInt('day', body.day, 1);
    let phase = (body.phase === undefined || body.phase === null || body.phase === '') ? 'day' : body.phase;
    if (!PHASES.includes(phase)) throw httpError(400, 'phase 必须是 ' + PHASES.join('|'));
    // B7：fetchImpl 测试缝（生产恒 undefined 零行为变化，同 B3 advise 模式）
    const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
    // B7：botc 局挂了剧本才注入抽取上下文（角色清单/4 专属谓词/发言席位/反例）；werewolf 局零注入。
    // 无剧本 botc 局（兼容既有建局路径）不注入——与 confirm 的「无剧本拒角色/阵营声称」口径一致。
    const script = botcClaims.getGameScript(gameId);
    const r = await llm.extract({ text, players, day, phase, speakerSeat: body.speaker_seat,
      options: script ? withBotcExtractContext(options, script, body.speaker_seat) : options });
    // B7 L3：载体声明还原为 BOTC 专属谓词出卡；自然硬塞（阵营词）按 BOTC 语义还原并留痕
    const mapped = mapBotcCarriersBack(r.claims || []);
    const warnings = (r.warnings || []).concat(mapped.warnings);
    if (!mapped.claims.length && BOTC_ZERO_CLAIM_KEYWORDS.test(text)) {
      warnings.push('机械复查：原话含 BOTC 阵营/状态关键词但抽取 0 claims——可能整条丢失，建议人工补录或重述（B7 护栏）');
    }
    const actor = (r.event && r.event.actor_seat !== undefined && r.event.actor_seat !== null) ? r.event.actor_seat : null;
    return {
      event: {
        day: r.event.day, phase: r.event.phase, type: r.event.type,
        actor_seat: actor, raw_text: r.event.raw_text,
      },
      claims: mapped.claims.map((c) => ({
        seat: (c.seat !== undefined && c.seat !== null) ? c.seat : actor,
        subject_seat: c.subject_seat, predicate: c.predicate, object: c.object,
      })),
      actions: r.action ? [{
        seat: (r.action.seat !== undefined && r.action.seat !== null) ? r.action.seat : actor,
        action: r.action.action, target_seat: r.action.target_seat, result: r.action.result || '',
      }] : [],
      warnings,
      extracted_by: 'llm',
      meta: { source: 'text', mode: r.meta && r.meta.mode, attempts: r.meta && r.meta.attempts, script: script || undefined },
    };
  });

  // ── 确认入账（宏与自由文本同一路径；事务原子）──
  app.post('/api/games/:id/events/confirm', async (req, reply) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const body = req.body || {};
    const head = validateEventHead(gameId, body.event);
    if (!Array.isArray(body.claims)) throw httpError(400, 'claims 必须是数组');
    const actions = body.actions === undefined ? [] : body.actions;
    if (!Array.isArray(actions)) throw httpError(400, 'actions 必须是数组');
    if (actions.length > 1) throw httpError(400, '一条输入最多 1 个 action（契约 §2：0..1）');
    // B2：BOTC 局声称分流——botc 局扩展 BOTC 专属谓词枚举并按存储切分；werewolf 局零改动。
    // 无剧本 botc 局（兼容既有建局路径）：通用谓词照走主表；角色/阵营/状态声称需剧本语境，400。
    const gameRow = getGameOr404(gameId);
    const isBotc = gameRow.game_type === botcClaims.BOTC_GAME_TYPE;
    const script = isBotc ? botcClaims.getGameScript(gameId) : null;
    const claimsV = body.claims.map((c, i) => {
      const v = validateClaim(gameId, c, i, isBotc ? botcClaims.BOTC_CLAIM_PREDICATES : undefined);
      if (isBotc && !script
        && (botcClaims.BOTC_CLAIM_PREDICATES.includes(v.predicate)
          || botcClaims.ROLE_ASSERT_PREDICATES.includes(v.predicate))) {
        throw httpError(400, 'botc 局 ' + gameId + ' 未挂剧本（tb|bmr|snv），无法录入 ' + v.predicate + ' 声称');
      }
      return v;
    });
    const split = script ? botcClaims.splitBotcClaims(script, claimsV) : { main: claimsV, botc: [] };
    const actionsV = actions.map((a, i) => validateAction(gameId, a, i));
    const extractedBy = (body.extracted_by === 'macro' || body.extracted_by === 'user') ? body.extracted_by : 'llm';

    const conn = db.getConnection();
    let eventId = null, seq = null;
    const claimIds = [], actionIds = [], botcClaimIds = [];
    const tx = conn.transaction(() => {
      const ev = db.addEvent({
        game_id: gameId, day: head.day, phase: head.phase, type: head.type,
        actor_seat: head.actor_seat, raw_text: head.raw_text,
      });
      eventId = ev.id; seq = ev.seq;
      for (const c of split.main) {
        const row = db.addClaim({
          event_id: eventId, seat: c.seat, subject_seat: c.subject_seat,
          predicate: c.predicate, object: c.object,
          extracted_by: extractedBy, confirmed_by_user: 1,
        });
        claimIds.push(row.id);
      }
      // B2：BOTC 专属谓词（阵营/状态类）落 p1b 私有表 botc_claims（同一事件，事务原子）
      for (const c of split.botc) {
        const res = botcClaims.addBotcClaim({
          game_id: gameId, event_id: eventId, seat: c.seat, subject_seat: c.subject_seat,
          predicate: c.predicate, object: c.object,
          extracted_by: extractedBy, confirmed_by_user: 1,
        });
        botcClaimIds.push(Number(res.lastInsertRowid));
      }
      for (const a of actionsV) {
        const row = db.addAction({
          event_id: eventId, seat: a.seat, action: a.action,
          target_seat: a.target_seat, result: a.result,
        });
        actionIds.push(row.id);
      }
    });
    tx();
    reply.code(201);
    return { ok: true, event_id: eventId, seq, claim_ids: claimIds, botc_claim_ids: botcClaimIds, action_ids: actionIds, warnings: split.warnings || [] };
  });

  // ── claims 修订 ──
  app.post('/api/games/:id/claims/:claimId/edit', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const claimId = requireInt('claim id', req.params.claimId, 1);
    const claim = db.getClaim(claimId);
    if (!claim || claim.game_id !== gameId) throw httpError(404, 'claim #' + claimId + ' 不存在（局 ' + gameId + '）');
    if (claim.retracted) throw httpError(409, 'claim #' + claimId + ' 已撤回，不能修改（账本纪律）');
    const body = req.body || {};
    const hasObject = body.object !== undefined && body.object !== null;
    const hasPredicate = body.predicate !== undefined;
    const hasSubject = body.subject_seat !== undefined && body.subject_seat !== null;
    if (!hasObject && !hasPredicate && !hasSubject) {
      throw httpError(400, 'edit 至少提供 object/predicate/subject_seat 之一');
    }
    if (hasObject) db.updateClaimObject(claimId, requireNonEmptyString('object', String(body.object)));
    if (hasPredicate || hasSubject) {
      // db 层（契约 v1）只支持 object 修订；predicate/subject_seat 为 p1b 服务端扩展（同样拒绝已撤回行）
      const predicate = hasPredicate ? requireEnum('predicate', body.predicate, PREDICATES) : claim.predicate;
      const subject = hasSubject ? requireInt('subject_seat', body.subject_seat, 1) : claim.subject_seat;
      seatExistsOr400(gameId, subject, 'subject_seat');
      db.getConnection().prepare('UPDATE claims SET predicate=?, subject_seat=? WHERE id=?').run(predicate, subject, claimId);
    }
    return { ok: true, claim: db.getClaim(claimId) };
  });

  app.post('/api/games/:id/claims/:claimId/retract', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const claimId = requireInt('claim id', req.params.claimId, 1);
    const claim = db.getClaim(claimId);
    if (!claim || claim.game_id !== gameId) throw httpError(404, 'claim #' + claimId + ' 不存在（局 ' + gameId + '）');
    db.retractClaim(claimId); // 软删幂等（契约 v1：绝不物理删）
    return { ok: true, retracted: true, claim: db.getClaim(claimId) };
  });

  // ── actions 修订（与 claims 同构）──
  app.post('/api/games/:id/actions/:actionId/edit', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const actionId = requireInt('action id', req.params.actionId, 1);
    const action = db.getAction(actionId);
    if (!action || action.game_id !== gameId) throw httpError(404, 'action #' + actionId + ' 不存在（局 ' + gameId + '）');
    if (action.retracted) throw httpError(409, 'action #' + actionId + ' 已撤回，不能修改（账本纪律）');
    const body = req.body || {};
    const patch = {};
    if (body.target_seat !== undefined) {
      if (body.target_seat === null) throw httpError(400, 'target_seat 不能为 null（要清空请 retract 后重录）');
      patch.target_seat = requireInt('target_seat', body.target_seat, 1);
      seatExistsOr400(gameId, patch.target_seat, 'target_seat');
    }
    if (body.result !== undefined) {
      if (body.result === null) throw httpError(400, 'result 不能为 null');
      patch.result = requireNonEmptyString('result', String(body.result));
    }
    if (!('target_seat' in patch) && !('result' in patch)) {
      throw httpError(400, 'edit 至少提供 target_seat/result 之一');
    }
    db.updateAction(actionId, patch);
    return { ok: true, action: db.getAction(actionId) };
  });

  app.post('/api/games/:id/actions/:actionId/retract', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const actionId = requireInt('action id', req.params.actionId, 1);
    const action = db.getAction(actionId);
    if (!action || action.game_id !== gameId) throw httpError(404, 'action #' + actionId + ' 不存在（局 ' + gameId + '）');
    db.retractAction(actionId);
    return { ok: true, retracted: true, action: db.getAction(actionId) };
  });

  // ── B2：BOTC 专属谓词声称的读取/撤回（botc_claims，p1b 私有表；与 claims 修订同纪律）──
  app.get('/api/games/:id/botc-claims', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    return { game_id: gameId, claims: botcClaims.listBotcClaims(gameId) };
  });

  app.post('/api/games/:id/botc-claims/:claimId/retract', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const claimId = requireInt('claim id', req.params.claimId, 1);
    const row = botcClaims.getBotcClaim(claimId);
    if (!row || row.game_id !== gameId) throw httpError(404, 'botc claim #' + claimId + ' 不存在（局 ' + gameId + '）');
    botcClaims.retractBotcClaim(claimId); // 软删幂等（账本纪律：绝不物理删）
    return { ok: true, retracted: true, claim: botcClaims.getBotcClaim(claimId) };
  });

  // ── B2 微补丁三：botc 声称修订（B4 录入实测缺口：is_demon/is_minion/status_* 此前无 edit 通道）──
  // 语义：谓词仍是 BOTC 专属枚举 → 原地 UPDATE botc_claims；谓词改回 7 通用枚举 → 跨表迁移
  //（软删本行 + 主表新建，账本纪律不物理删）。主表 claims 行的 edit 路由不动（7 枚举边界不变，
  // 主表行改向 BOTC 谓词走「撤回重录」）。
  app.post('/api/games/:id/botc-claims/:claimId/edit', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const claimId = requireInt('claim id', req.params.claimId, 1);
    const row = botcClaims.getBotcClaim(claimId);
    if (!row || row.game_id !== gameId) throw httpError(404, 'botc claim #' + claimId + ' 不存在（局 ' + gameId + '）');
    if (row.retracted) throw httpError(409, 'botc claim #' + claimId + ' 已撤回，不能修改（账本纪律）');
    const body = req.body || {};
    const hasObject = body.object !== undefined && body.object !== null;
    const hasPredicate = body.predicate !== undefined;
    const hasSubject = body.subject_seat !== undefined && body.subject_seat !== null;
    if (!hasObject && !hasPredicate && !hasSubject) {
      throw httpError(400, 'edit 至少提供 object/predicate/subject_seat 之一');
    }
    const subject = hasSubject ? requireInt('subject_seat', body.subject_seat, 1) : row.subject_seat;
    seatExistsOr400(gameId, subject, 'subject_seat');
    if (hasPredicate && !botcClaims.BOTC_CLAIM_PREDICATES.includes(body.predicate)
      && !PREDICATES.includes(body.predicate)) {
      throw httpError(400, 'predicate 必须是 '
        + PREDICATES.concat(botcClaims.BOTC_CLAIM_PREDICATES).join('|')
        + '，收到: ' + JSON.stringify(body.predicate));
    }
    const toMain = hasPredicate && PREDICATES.includes(body.predicate);
    if (toMain) {
      // 跨表迁移：botc_claims → 主表 claims（主表 object 非空契约沿用）
      const object = requireNonEmptyString('object', hasObject ? String(body.object) : (row.object || ''));
      let newId = null;
      const tx = db.getConnection().transaction(() => {
        botcClaims.retractBotcClaim(claimId);
        const created = db.addClaim({
          event_id: row.event_id, seat: row.seat, subject_seat: subject,
          predicate: body.predicate, object,
          extracted_by: row.extracted_by, confirmed_by_user: 1,
        });
        newId = created.id;
      });
      tx();
      return { ok: true, moved_to: 'claims', claim_id: newId, claim: db.getClaim(newId), botc_claim: botcClaims.getBotcClaim(claimId) };
    }
    const patch = {};
    if (hasPredicate) patch.predicate = body.predicate;
    if (hasSubject) patch.subject_seat = subject;
    if (hasObject) patch.object = String(body.object).trim();
    return { ok: true, moved_to: 'botc_claims', claim: botcClaims.updateBotcClaim(claimId, patch) };
  });
}

module.exports = { register, validateEventHead, validateClaim, validateAction, seatExistsOr400, MACRO_KINDS };
