'use strict';
/**
 * p1b/src/routes/predictions.js —— 预测卡 L0 账本 API（第十棒 W1）。
 *
 * 契约（任务书 W1-2）：
 *   POST /api/games/:id/predictions     落注：statement + prob（prob 必须 0-1 数值；
 *                                       口语「大概率」由调用方澄清后传数值，本路由拒收口语）
 *   GET  /api/games/:id/predictions     分页清单（limit/offset + total + l0_gate）
 *   POST /api/predictions/:id/resolve   真值回填：outcome ∈ true|false|ambiguous + note
 *                                       （歧义必须附 note 留痕，不许硬判；账本不可变，已 resolve 拒改 409）
 *   GET  /api/predictions/unresolved    未 resolve 清单
 *
 * L0 铁律落点：本路由只记账/只回填真值，不计算不返回任何准确率/校准评分；l0_gate 字段
 * 如实回报门禁状态（review_unlocked=false 时 UI 一切数字只配「参考」，禁「预测」字样）。
 * ensure 表放 register 内（oracleCast p9 同先例）= server.js 单行原子编辑约束。
 */
const { db } = require('../deps');
const { getGameOr404, currentDayOf } = require('./games');
const { httpError, requireInt, requireEnum, requireNonEmptyString } = require('../util');
const store = require('../db/predictionsStore');

const SOURCE_TYPES = store.SOURCE_TYPES;
const OUTCOMES = store.OUTCOMES;

/** 分页钳制：limit 缺省 20、上限 100（oracleStore 同约定）；offset ≥0。 */
function pageOpts(query) {
  const q = query || {};
  let limit = 20;
  if (q.limit !== undefined && q.limit !== '') {
    limit = requireInt('limit', q.limit, 1);
    if (limit > 100) limit = 100;
  }
  let offset = 0;
  if (q.offset !== undefined && q.offset !== '') offset = requireInt('offset', q.offset, 0);
  return { limit: limit, offset: offset };
}

/** 口语概率拒收门：prob 必须是 [0,1] 数值（这是「澄清后落库」纪律的服务端强制面）。 */
function requireProb(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw httpError(400, 'prob 必须是 0-1 的数值（口语概率如「大概率」须由调用方澄清为数值后落库，本接口不收口语），收到: ' + JSON.stringify(v));
  }
  if (v < 0 || v > 1) throw httpError(400, 'prob 必须在 [0,1] 区间，收到: ' + v);
  return v;
}

/**
 * evidence 事件 id 引用校验：必须是整数 id 数组（≤10），且每个 id 真实存在并属于本局
 * （账本干净铁律：不留悬空引用；验证点自动路径的 id 已过 p1a postValidate 白名单）。
 */
function normalizeEvidence(gameId, evidence) {
  if (evidence === undefined || evidence === null) return [];
  if (!Array.isArray(evidence)) throw httpError(400, 'evidence 必须是事件 id 数组');
  if (evidence.length > 10) throw httpError(400, 'evidence 最多引用 10 个事件 id');
  const stmt = db.getConnection().prepare('SELECT id FROM events WHERE id = ? AND game_id = ?');
  const ids = [];
  for (const v of evidence) {
    const id = requireInt('evidence[]', v, 1);
    if (!stmt.get(id, gameId)) {
      throw httpError(400, 'evidence 引用的事件 id ' + id + ' 不存在或不属于本局（账本不留悬空引用）');
    }
    if (ids.indexOf(id) === -1) ids.push(id);
  }
  return ids;
}

function register(app) {
  store.ensurePredictionsTable(db.getConnection()); // additive 私有表（幂等，零碰 p1a 既有表）

  // 落注（人工/调用方）
  app.post('/api/games/:id/predictions', async (req, reply) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const body = req.body || {};
    const statement = requireNonEmptyString('statement', body.statement === undefined ? '' : String(body.statement));
    const prob = requireProb(body.prob);
    const sourceType = body.source_type === undefined || body.source_type === null
      ? '预测卡'
      : requireEnum('source_type', body.source_type, SOURCE_TYPES);
    let day = null;
    if (body.day !== undefined && body.day !== null) day = requireInt('day', body.day, 0);
    else day = currentDayOf(gameId); // 缺省=账本最新天
    const evidence = normalizeEvidence(gameId, body.evidence);
    const row = store.insertPrediction({ gameId: gameId, day: day, sourceType: sourceType, statement: statement, prob: prob, evidence: evidence });
    reply.code(201);
    return row;
  });

  // 分页清单
  app.get('/api/games/:id/predictions', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const page = store.listByGame(gameId, pageOpts(req.query));
    return Object.assign({ game_id: gameId }, page, { l0_gate: store.l0Gate() });
  });

  // 真值回填（生产真值等打局后手动 POST；测试用 :memory: 库+固定 outcome 注入——设计即回填 API，不做录像导入 YAGNI）
  app.post('/api/predictions/:id/resolve', async (req) => {
    const id = requireInt('prediction id', req.params.id, 1);
    const body = req.body || {};
    const outcome = requireEnum('outcome', body.outcome, OUTCOMES);
    let note = null;
    if (body.note !== undefined && body.note !== null) note = requireNonEmptyString('note', String(body.note));
    if (outcome === 'ambiguous' && !note) {
      throw httpError(400, 'outcome=ambiguous 必须附 note 说明歧义点（判定标准歧义不许硬判，L0 判据：歧义争议率<5%）');
    }
    const r = store.resolvePrediction(id, outcome, note);
    if (!r.ok && r.reason === 'not_found') throw httpError(404, '预测记录不存在: ' + id);
    if (!r.ok && r.reason === 'already_resolved') {
      // ★2026-08-28 T1（M7）：**原 409 文案是死胡同**——它让用户去开一条
      //   不存在的修正记录路径（实测全库 grep amend 零命中，没有任何修正接口）。
      //   教用户走一条不存在的路，比不说更糟。改为如实说明现状：
      //   账本不可改（这正是它可信的原因）＋ 目前没有修正入口。
      //   真要做修正功能，涉及「修正记录算不算进校准统计」⇒ 动账本不可变语义 ⇒ 须另立项。
      throw httpError(409, '该记录已落定（resolved_at=' + r.row.resolved_at + '，outcome=' + r.row.outcome + '）。'
        + '账本不可改——这正是它可信的原因。'
        + '目前**没有**修正入口（需要单独立项）：修正记录算不算进统计，会影响已冻结的读数。');
    }
    return r.row;
  });

  // 未 resolve 清单（resolve 待办）
  app.get('/api/predictions/unresolved', async (req) => {
    const page = store.listUnresolved(pageOpts(req.query));
    return Object.assign({}, page, { l0_gate: store.l0Gate() });
  });

  // 校准读数（W2）：ECE+分桶，n<30 →「数据不足」；纯统计零 LLM（C 方案 5 对照组；
  // logit 聚合/层级 Platt 只留挂点不实现——无 resolve 积累不装学习件，YAGNI）
  app.get('/api/predictions/calibration', async () => {
    return store.calibration();
  });
}

module.exports = { register, SOURCE_TYPES, OUTCOMES };
