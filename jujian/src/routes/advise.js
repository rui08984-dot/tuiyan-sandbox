'use strict';
/**
 * p1b/src/routes/advise.js —— 天结算参谋卡（P1B-SPEC §0 拍板 #4 / §3）：
 *   POST /api/games/:id/day/:n/advise → 202 {task_id}（异步启动，录入不被阻塞）
 *   GET  /api/tasks/:taskId → {status, card?}（轮询；status ∈ running|done|failed）
 * 链路对齐 p1a-terminal/src/cli.js cmdDay：loadGameState(uptoDay=n) → llm.advisor（引擎比对器+LLM 卡）
 * → saveAdvisorCard（回存失败不影响展示，与 cli 同思路）。
 */
const store = require('../db/store');
const llm = require('../llm/engine');
const botcClaims = require('../game/botcClaims'); // B2：BOTC 局剧本/私有声称读取
const { findBotcContradictions } = require('../kernel/botc/contradictions'); // B2：剧本数据驱动矛盾预处理
const { buildBotcPromptContext, withBotcPromptContext } = require('../kernel/botc/advisePrompt'); // B3：剧本上下文注入
const { resolveLlmOptions } = require('../llm/options');
const { getGameOr404 } = require('./games');
const { httpError, requireInt } = require('../http/util');

/**
 * B2：BOTC 局参谋卡——矛盾预处理走 contradictions.js（剧本数据驱动，替代 p1a engine 的
 * R1/R2 werewolf 路径：UNIQUE_ROLES 不认识血染角色），欠定度与无辜解释仍归 llm.generateCards
 * （RD1 两层归属不变）。仅引用 botc_claims 的冲突对（botc_only）不落共享 contradictions 表
 * （FK 只认 claims/actions），只挂 live 卡；含主表引用的对照常存档。
 * B3：generateCards 的 options 经 withBotcPromptContext 包装——本局剧本上下文
 * （角色清单/说书人裁量警示/剧本特有机制/假设区生成要求）追加进 system 消息尾部。
 */
async function runBotcAdvise(state, day, options) {
  const gameId = state.game.id;
  const script = botcClaims.getGameScript(gameId);
  if (!script) throw httpError(400, 'botc 局 ' + gameId + ' 未挂剧本（tb|bmr|snv），无法天结算');
  const botcRows = botcClaims.listBotcClaims(gameId, { uptoDay: day });
  const pairs = findBotcContradictions({
    script,
    claims: state.claims, botcClaims: botcRows, events: state.events,
  });
  const byPairId = new Map(pairs.map((p) => [p.pair_id, p]));
  // B3：prompt 注入本局剧本上下文（角色清单/说书人裁量警示/剧本特有机制/假设区要求）。
  // 通道 = 包装 options.fetchImpl（llm.js 明示扩展点）把上下文追加到 system 消息尾部；
  // 仅 BOTC 分支经此处，werewolf 局 prompt 零改动；MOCK 模式不产生 prompt = no-op。
  const r = await llm.generateCards({
    day,
    seats: state.players.map((p) => p.seat),
    events: state.events, claims: state.claims, actions: state.actions,
    pairs,
  }, withBotcPromptContext(options, buildBotcPromptContext(script)));
  if (!r || !Array.isArray(r.contradictions) || !Array.isArray(r.hypotheses)) {
    throw new Error('LLM 参谋卡缺 contradictions/hypotheses 数组，违反契约 §3');
  }
  // 引用/冲突描述回填（与 llm.advisor 的 pair_id 回填同思路；额外带回 botc_refs）
  const contradictions = r.contradictions.map((c) => {
    const src = byPairId.get(c.pair_id);
    if (!src) return c;
    return Object.assign({}, c, {
      claim_a: src.claim_a, claim_b: src.claim_b,
      action_a: src.action_a, action_b: src.action_b,
      conflict_desc: src.conflict_desc,
      botc_refs: src.botc_refs || [],
      botc_only: (src.botc_refs || []).length > 0
        && src.claim_a === null && src.claim_b === null
        && src.action_a === null && src.action_b === null,
    });
  });
  const card = {
    day,
    contradictions,
    hypotheses: r.hypotheses,
    checkpoints: Array.isArray(r.checkpoints) ? r.checkpoints : [],
    warnings: r.warnings || [],
    meta: Object.assign({}, r.meta || null, { script, botc_pairs: pairs.length }),
  };
  // 存档仅收含主表 claim/action 引用的对（saveAdvisorCard 引用存在性硬校验）；botc-only 对仅 live 展示
  const persistable = contradictions.filter((c) =>
    [c.claim_a, c.claim_b, c.action_a, c.action_b].some((v) => v !== null && v !== undefined));
  const checklist = reviewChecklist(card);
  let saved = false, saveError = null, replaced = null;
  try {
    replaced = hasCardForDay(gameId, day) ? replaceSameDayCard(gameId, day) : null; // bug-27 修：同日覆盖
    store.saveAdvisorCard(gameId, day, { contradictions: persistable, hypotheses: r.hypotheses });
    saved = true;
  } catch (e) {
    saveError = (e && e.message) ? e.message : String(e); // 回存失败不影响展示（cli 同思路）
  }
  return Object.assign({}, card, { saved, save_error: saveError, replaced: replaced, checklist });
}

/**
 * 验证点 = 「明天该盯什么」的清单，**到此为止就是清单**。
 *
 * ★这里是被剥离掉的一条跨产品耦合，记下来免得日后有人「顺手接回去」：
 *   沙盘原版会把验证点自动落成「预测卡」进它的 Brier 计分账本——
 *   那是推演沙盘的核心机制（记判断 → 事后打分 → 校准）。
 *   局鉴没有账本，也不需要：玩家的对局没有「事后结算」这个概念，
 *   强行造一个只会把另一个产品的机制拖进来，还会让复盘结果被计分逻辑污染。
 *
 * ⇒ 验证点就停在 card.checkpoints：一张给人看的「明天盯这个」的清单。
 *   它不写库、不计分、也不会被谁自动勾掉——因为**只有玩家本人知道答案**。
 */
function reviewChecklist(card) {
  const raw = Array.isArray(card.checkpoints) ? card.checkpoints : [];
  return raw.map((c, i) => ({
    n: i + 1,
    text: typeof c === 'string' ? c : (c && (c.text || c.content || c.statement)) || '',
  })).filter((c) => c.text);
}

/** 任务执行体：参谋卡生成 + 回存（在 taskQueue 的异步上下文中运行） */
function makeAdviseRunner(ctx) {
  return async function adviseRunner(gameId, day) {
    const state = store.loadGameState(gameId, day);
    if (!state) throw httpError(404, '局不存在: ' + gameId);
    if (!state.events.length) {
      throw httpError(400, '局 ' + gameId + ' 第 ' + day + ' 天前没有任何事件记录，无法天结算');
    }
    // B3：fetchImpl 为测试缝（server.js 组装的 ctx 无此键 → 生产恒 undefined，零行为变化）
    const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
    // B2：BOTC 局分流（剧本数据驱动矛盾预处理）；werewolf 局走原 R1/R2 路径零改动
    if (state.game.game_type === botcClaims.BOTC_GAME_TYPE) {
      return runBotcAdvise(state, day, options);
    }
    const r = await llm.advisor({
      game: state.game, players: state.players, day,
      events: state.events, claims: state.claims, actions: state.actions,
      options,
    });
    if (!r || !Array.isArray(r.contradictions) || !Array.isArray(r.hypotheses)) {
      throw new Error('LLM 参谋卡缺 contradictions/hypotheses 数组，违反契约 §3');
    }
    const card = {
      day,
      contradictions: r.contradictions,
      hypotheses: r.hypotheses,
      checkpoints: Array.isArray(r.checkpoints) ? r.checkpoints : [],
      warnings: r.warnings || [],
      meta: r.meta || null,
    };
    const checklist = reviewChecklist(card);
    let saved = false, saveError = null, replaced = null;
    try {
      // bug-27 修：同日重结算＝覆盖（先清当日旧卡，再写新卡），防重复入库灌水
      replaced = hasCardForDay(gameId, day) ? replaceSameDayCard(gameId, day) : null;
      store.saveAdvisorCard(gameId, day, card); // RD1 + 引用 id 存在性 + 事务原子（db 层硬校验）
      saved = true;
    } catch (e) {
      saveError = (e && e.message) ? e.message : String(e); // 回存失败不影响展示（cli 同思路）
    }
    return Object.assign({}, card, { saved, save_error: saveError, replaced: replaced, checklist });
  };
}

// ── P1b-4 增补：参谋卡存档读取（读 saveAdvisorCard 已落库数据，不重算）──
// 矛盾行无 day 列（表设计如此）→ 用其引用 claim/action 所在事件的最大 day 反推 evidence_day（additive 只读 SQL），
// 卡语义 =「截至该天」：evidence_day ≤ day 的矛盾 + 该天假设，与 POST /day/:n/advise 生成时点一致。
const EVIDENCE_DAY_SQL = 'SELECT c.id AS row_id,'
  + ' (SELECT MAX(ev.day) FROM events ev WHERE ev.id IN ('
  + 'SELECT event_id FROM claims WHERE id IN (c.claim_a, c.claim_b)'
  + ' UNION SELECT event_id FROM actions WHERE id IN (c.action_a, c.action_b))) AS evidence_day'
  + ' FROM contradictions c WHERE c.game_id=?';

function buildCards(gameId) {
  const conn = store.getConnection();
  const allContradictions = store.getContradictions(gameId); // 局鉴 store 只有单参签名（自己管连接）
  const evidenceRows = conn.prepare(EVIDENCE_DAY_SQL).all(gameId);
  const evidenceByRowId = new Map(evidenceRows.map((r) => [r.row_id, r.evidence_day]));
  const hypotheses = store.getHypotheses(gameId);
  const days = Array.from(new Set(hypotheses.map((h) => h.day))).sort((a, b) => b - a);
  return days.map((day) => ({
    day,
    hypotheses: hypotheses.filter((h) => h.day === day),
    contradictions: allContradictions
      .filter((c) => { const ed = evidenceByRowId.get(c.id); return ed !== undefined && ed !== null && ed <= day; })
      .map((c) => Object.assign({}, c, { evidence_day: evidenceByRowId.get(c.id) })),
  }));
}

/**
 * 幂等守卫（2026-09-14 修 bug-27）：**重复天结算会导致参谋卡重复入库**。
 *
 * 病象（实测）：`POST /api/games/:id/day/:n/advise` 对同一 (game,day) 无防重守卫；每次 enqueue 都跑一遍
 *   adviseRunner → `store.saveAdvisorCard` 是**纯 INSERT 无幂等** ⇒ 同一天的 hypotheses/contradictions 逐次累加。
 *   实证：生产库 game_id=1 有 7 条 hypotheses（含 2 套重复）+ 3 条完全相同的 contradictions。
 *
 * 修法（**不动禁改面** p1a-terminal/src/store.js）：在 p1b 调用侧，保存**之前**先删掉该 (game,day) 的旧卡，
 *   再写新卡 —— 语义＝「同一天重结算＝覆盖」，与「账本不可变」不冲突（参谋卡是**派生视图**，非账本事实）。
 *
 * 边界（写死，防误伤）：
 *   · hypotheses 有 day 列 ⇒ 精确按 (game_id, day) 删。
 *   · contradictions **无 day 列**（表设计如此）⇒ 其归属由「引用的 claim/action 所在事件的最大 day」反推
 *     （与 buildCards 的 evidence_day 同口径）。只删 **day ≤ 本次 day** 的矛盾，避免误删后续天的证据对。
 *     ⚠ 已知局限：若某矛盾引用的 claim 跨天，其反推 day 可能落在别的天 —— 故删除范围保守取 ≤ 本次 day。
 *   · 只删 generated_by='llm' 的行（人类手工/其它来源不可被结算覆盖）。
 */
function replaceSameDayCard(gameId, day) {
  const conn = store.getConnection();
  const tx = store.tx(conn, () => {
    // 1) 当日假设：精确删
    const delH = conn.prepare('DELETE FROM hypotheses WHERE game_id=? AND day=?');
    const delHN = delH.run(gameId, day).changes;
    // 2) 当日矛盾：无 day 列 ⇒ 用「引用事件的最大 day ≤ 本次 day」反推
    const rows = conn.prepare(EVIDENCE_DAY_SQL).all(gameId);
    const ids = rows.filter((r) => r.evidence_day !== null && r.evidence_day !== undefined && r.evidence_day <= day)
      .map((r) => r.row_id);
    let delCN = 0;
    if (ids.length) {
      const delC = conn.prepare("DELETE FROM contradictions WHERE game_id=? AND id=? AND generated_by='llm'");
      for (const id of ids) delCN += delC.run(gameId, id).changes;
    }
    return { deleted_hypotheses: delHN, deleted_contradictions: delCN };
  });
  return tx();
}

/** 该 (game,day) 是否已有参谋卡存档（用于上报 replaced 标记，不阻断生成） */
function hasCardForDay(gameId, day) {
  const conn = store.getConnection();
  const r = conn.prepare('SELECT COUNT(*) n FROM hypotheses WHERE game_id=? AND day=?').get(gameId, day);
  return Number(r && r.n ? r.n : 0) > 0;
}

function register(app, ctx) {
  app.post('/api/games/:id/day/:n/advise', async (req, reply) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const day = requireInt('day', req.params.n, 1);
    // 提交时同步预检（快速失败）：局存在 + day 之前有事件；任务执行时再重载一次最新状态
    const pre = store.loadGameState(gameId, day);
    if (!pre) throw httpError(404, '局不存在: ' + gameId);
    if (!pre.events.length) {
      throw httpError(400, '局 ' + gameId + ' 第 ' + day + ' 天前没有任何事件记录，无法天结算');
    }
    const task = ctx.queue.enqueue(gameId, day);
    reply.code(202);
    return { task_id: task.task_id, status: task.status, game_id: gameId, day, poll: '/api/tasks/' + task.task_id };
  });

  app.get('/api/tasks/:taskId', async (req) => {
    const task = ctx.queue.get(String(req.params.taskId || ''));
    if (!task) throw httpError(404, '任务不存在: ' + req.params.taskId);
    return {
      task_id: task.task_id,
      status: task.status,
      game_id: task.game_id,
      day: task.day,
      card: task.card,
      error: task.error,
      created_at: task.created_at,
      finished_at: task.finished_at,
    };
  });

  app.get('/api/games/:id/cards', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    return { game_id: gameId, cards: buildCards(gameId) };
  });

  app.get('/api/games/:id/cards/:day', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const day = requireInt('day', req.params.day, 1);
    const card = buildCards(gameId).find((c) => c.day === day);
    if (!card) throw httpError(404, '局 ' + gameId + ' 第 ' + day + ' 天没有参谋卡存档');
    return card;
  });
}

module.exports = { register, makeAdviseRunner };
