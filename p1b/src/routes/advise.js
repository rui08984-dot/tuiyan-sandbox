'use strict';
/**
 * p1b/src/routes/advise.js —— 天结算参谋卡（P1B-SPEC §0 拍板 #4 / §3）：
 *   POST /api/games/:id/day/:n/advise → 202 {task_id}（异步启动，录入不被阻塞）
 *   GET  /api/tasks/:taskId → {status, card?}（轮询；status ∈ running|done|failed）
 * 链路对齐 p1a-terminal/src/cli.js cmdDay：loadGameState(uptoDay=n) → llm.advisor（引擎比对器+LLM 卡）
 * → saveAdvisorCard（回存失败不影响展示，与 cli 同思路）。
 */
const { db, llm } = require('../deps');
const botcClaims = require('../botc/claims'); // B2：BOTC 局剧本/私有声称读取
const { findBotcContradictions } = require('../botc/contradictions'); // B2：剧本数据驱动矛盾预处理
const { buildBotcPromptContext, withBotcPromptContext } = require('../botc/advisePrompt'); // B3：剧本上下文注入
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404 } = require('./games');
const { httpError, requireInt } = require('../util');
const { convertCheckpointsToPredictions } = require('../db/predictionsStore'); // p10 W1：验证点自动落预测卡（L0 核心自动化）

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
  const cpPred = convertCheckpoints(gameId, day, card); // p10 W1：验证点自动落预测卡（失败不炸卡）
  let saved = false, saveError = null;
  try {
    db.saveAdvisorCard(gameId, day, { contradictions: persistable, hypotheses: r.hypotheses });
    saved = true;
  } catch (e) {
    saveError = (e && e.message) ? e.message : String(e); // 回存失败不影响展示（cli 同思路）
  }
  return Object.assign({}, card, { saved, save_error: saveError, cp_predictions: cpPred });
}

/** p10 W1：验证点 → predictions 落卡包装（失败不炸参谋卡，error 留痕——回存失败同思路） */
function convertCheckpoints(gameId, day, card) {
  try {
    return Object.assign({ ok: true }, convertCheckpointsToPredictions({ gameId, day, card }));
  } catch (e) {
    return { ok: false, inserted: 0, skipped: 0, error: (e && e.message) ? e.message : String(e) };
  }
}

/** 任务执行体：参谋卡生成 + 回存（在 taskQueue 的异步上下文中运行） */
function makeAdviseRunner(ctx) {
  return async function adviseRunner(gameId, day) {
    const state = db.loadGameState(gameId, day);
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
    const cpPred = convertCheckpoints(gameId, day, card); // p10 W1：验证点自动落预测卡（失败不炸卡）
    let saved = false, saveError = null;
    try {
      db.saveAdvisorCard(gameId, day, card); // RD1 + 引用 id 存在性 + 事务原子（db 层硬校验）
      saved = true;
    } catch (e) {
      saveError = (e && e.message) ? e.message : String(e); // 回存失败不影响展示（cli 同思路）
    }
    return Object.assign({}, card, { saved, save_error: saveError, cp_predictions: cpPred });
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
  const conn = db.getConnection();
  const allContradictions = db.getContradictions(conn, gameId); // 句柄式签名（db 层已解析 JSON 字段）
  const evidenceRows = conn.prepare(EVIDENCE_DAY_SQL).all(gameId);
  const evidenceByRowId = new Map(evidenceRows.map((r) => [r.row_id, r.evidence_day]));
  const hypotheses = db.getHypotheses(conn, gameId);
  const days = Array.from(new Set(hypotheses.map((h) => h.day))).sort((a, b) => b - a);
  return days.map((day) => ({
    day,
    hypotheses: hypotheses.filter((h) => h.day === day),
    contradictions: allContradictions
      .filter((c) => { const ed = evidenceByRowId.get(c.id); return ed !== undefined && ed !== null && ed <= day; })
      .map((c) => Object.assign({}, c, { evidence_day: evidenceByRowId.get(c.id) })),
  }));
}

function register(app, ctx) {
  app.post('/api/games/:id/day/:n/advise', async (req, reply) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const day = requireInt('day', req.params.n, 1);
    // 提交时同步预检（快速失败）：局存在 + day 之前有事件；任务执行时再重载一次最新状态
    const pre = db.loadGameState(gameId, day);
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
