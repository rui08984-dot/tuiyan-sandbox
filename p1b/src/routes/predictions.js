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
 *   GET  /api/predictions/:id           单题完整一生（2026-09-28 T8：题面/当时押的数/引擎基率/真值/
 *                                       判词条数/真值口径是否被排除统计；只读零写）
 *
 * L0 铁律落点：本路由只记账/只回填真值，不计算不返回任何准确率/校准评分；l0_gate 字段
 * 如实回报门禁状态（review_unlocked=false 时 UI 一切数字只配「参考」，禁「预测」字样）。
 * ensure 表放 register 内（oracleCast p9 同先例）= server.js 单行原子编辑约束。
 */
const { db } = require('../deps');
const { getGameOr404, currentDayOf } = require('./games');
const { httpError, requireInt, requireEnum, requireNonEmptyString } = require('../util');
const store = require('../db/predictionsStore');
const vstore = require('../db/verdictsStore'); // 只读列判词（不写：生成仍走 verdicts 路由）
const truthBasis = require('../evidence/truthBasis'); // 真值口径排除谓词的**单一真源**，本路由不重写判定
const baseRateMod = require('../evidence/baseRate'); // 基率读数单一真源（结构化优先/文本兜底），本路由不另写解析器

const SOURCE_TYPES = store.SOURCE_TYPES;
const OUTCOMES = store.OUTCOMES;

/** 样本量下限：与 auditKpi／stage4／compiler 门面同一口径，n 不足一律降级为「只记方向」。 */
const MIN_N = 30;

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

/**
 * 排除原因的**命中项清单**（只解释，不判定）。
 * 为什么单独写：truthBasis.isTruthBasisDefect 只给 true/false，而一个纯布尔在详情页上无法回答
 * 「凭什么把它踢出统计」。若在这里另写一套判定，两处口径迟早漂移 ⇒ 本函数只报**哪一条命中**，
 * 布尔结论仍以 truthBasis 为准，测试逐行断言两者等价。
 * @param {{resolved_at:?string, matures_at:?string, resolve_note:?string, evidence_json:*}} row
 * @returns {string[]} 空数组＝谓词不成立
 */
function truthBasisHits(row) {
  const hits = [];
  if (!row || !row.resolved_at || !row.matures_at) return hits;
  // 时序条件不成立则整条谓词不成立（truthBasis 的双条件之一），此时**没有**命中项可报
  if (String(row.resolved_at) >= String(row.matures_at)) return hits;
  // 与 truthBasis 同形：字符串就解析、坏 JSON 退空数组（不因一行脏数据把整个详情页打成 500）
  let ev = row.evidence_json;
  if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch (e) { ev = []; } }
  const kind = String((((ev || [])[0] || {}).resolve || {}).kind || '');
  if (/forecast/i.test(kind)) {
    hits.push('结算时间（' + row.resolved_at + '）早于事件日（' + row.matures_at + '），且真值锚 kind=' + kind
      + ' 属预报口径 ⇒ 账本里这条「真值」其实是当时的预报值，不是事后观测');
  }
  if (/forecast|预报/i.test(String(row.resolve_note || ''))) {
    hits.push('结算时间早于事件日，且结算注记是预报口径：「' + String(row.resolve_note).slice(0, 60) + '」');
  }
  return hits;
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
    if (!r.ok && r.reason === 'not_due') {
      // ★2026-09-28：落定到期闸上线后补的分支。此前 `not_due` 会一路落到 `return r.row`
      //   ⇒ 账本虽未被写（守卫在 store 里生效），HTTP 却回 200 + 空体，**状态码会骗人**。
      //   本项目的诚实线要求：拒绝要说得清为什么拒、拒到哪一天、以及没有答案时怎么办。
      throw httpError(409, '这道题还没到期，真值尚未产生（到期日 ' + r.due + '，今天 ' + r.today + '）——'
        + '落定不可逆且没有修正入口，所以现在不能答。' + (r.why || ''));
    }
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

  // ── 2026-09-28 T8：单题只读端点 —— **一道题的完整一生** ──
  //   病象：清单页给的是「行」，但一道题要能被读懂，缺的是**因果链**：
  //   当时押了多少 → 引擎当时给的基率是多少 → 真值是什么 → 判词留了几条
  //   → 最要紧的一条：**这个真值本身可不可信**。
  //   最后一条不能省：实测 98 行的真值是「当时的预报值」（结算时间戳早于事件日），
  //   它们混在读数里和事后观测长得一模一样。不把它标出来＝把两种东西当同一种。
  //   ★只读零写：本端点只有 SELECT，不改账本任何一列（l0_gate 本身是纯统计）。
  //   ★禁词：本端点产出的所有面向用户的说明句里不得出现该词（见 discipline 末条）。
  app.get('/api/predictions/:id', async (req) => {
    const id = requireInt('prediction id', req.params.id, 1);
    const row = store.getPrediction(id);
    if (!row) throw httpError(404, '该记录不存在: ' + id);

    // 真值锚：evidence[0].resolve（真库 1994/1994 行的真值锚与基率都落在第 0 个元素上）
    const ev0 = Array.isArray(row.evidence) && row.evidence.length ? row.evidence[0] : null;
    const truthAnchor = (ev0 && ev0.resolve) ? ev0.resolve : null;

    // 基率：结构化优先、文本兜底（读序由 baseRate 单一真源定，本端点不重写）
    const br = baseRateMod.readBaseRate(ev0);
    const brN = br && br.n !== undefined ? br.n : null;
    const baseRate = br ? {
      p: br.p,
      n: brN,
      k: br.k === undefined ? null : br.k,
      kind: br.kind,
      via: br.via,
      window: br.window,
      basis: br.basis,
      cmp: br.cmp,
      threshold: br.threshold,
      // n 缺失和 n 不足是**两回事**：前者是「不知道分母」，后者是「分母太小」——措辞不能混
      enough: brN !== null && brN >= MIN_N,
      note: brN === null
        ? '这条基率的注记里没有样本量 ⇒ 不知道它是多少次里出来的，不能当强读数用'
        : (brN >= MIN_N
          ? ('同类样本 n=' + brN + (br.k === null || br.k === undefined ? '' : ('，其中 ' + br.k + ' 次成立')))
          : ('样本只有 n=' + brN + '（<30）⇒ 只能记方向，不能当结论用')),
      raw_note: ev0 && ev0.baseRateNote ? String(ev0.baseRateNote) : null,
    } : null;

    // 真值口径是否被排除统计：布尔以 truthBasis 为准，命中项只作解释
    const tbInput = {
      resolved_at: row.resolved_at, matures_at: row.matures_at,
      resolve_note: row.resolve_note, evidence_json: row.evidence,
    };
    const excluded = truthBasis.isTruthBasisDefect(tbInput);
    const hits = truthBasisHits(tbInput);

    // 判词：只读列 verdicts 表（多路判词全量逐行落库），条数与列表取自同一次读，不二次查询
    const verdictRows = vstore.listVerdictsByPrediction(id);

    return {
      id: row.id,
      game_id: row.game_id,
      day: row.day,
      source_type: row.source_type,
      statement: row.statement,
      created_at: row.created_at,
      assigned_prob: row.assigned_prob,          // 当时的数；NULL 就是「当时没给数」，不代填
      base_rate: baseRate,
      truth_anchor: truthAnchor,
      outcome: row.outcome,
      resolved_at: row.resolved_at,
      resolve_note: row.resolve_note,
      matures_at: row.matures_at,
      verdict_count: verdictRows.length,
      verdicts: verdictRows,
      truth_basis: {
        excluded: excluded,
        hits: hits,
        reason: excluded
          ? '这条真值取自事件发生**之前**的预报口径，按既定裁定排除在读数之外（裁定＝丙：排除出池）'
          : (row.resolved_at === null
            ? '还没结算，谈不上口径问题'
            : '真值口径正常：结算时间不早于事件日，或真值不是预报口径'),
        rule: 'resolved_at < matures_at 且（真值锚 kind 含 forecast 或结算注记含 forecast/预报）⇒ 排除',
        fingerprint_sha256: truthBasis.DEFECT_FINGERPRINT_SHA256,
        n_excluded_at_freeze: truthBasis.DEFECT_N_AT_FREEZE,
      },
      layer: row.layer,
      secondary_layer: row.secondary_layer,
      engine: row.engine,
      baseline_brier: row.baseline_brier,
      gate: row.gate,
      tautology: row.tautology,
      l0_gate: store.l0Gate(),
      discipline: [
        '本端点只读：一次 SELECT 都不写，不改账本任何一列。',
        '真值口径被排除的行照样完整展示（不隐藏）——正因如此，excluded 标记必须与题面同屏出现。',
        '基率 n<30 一律降级为「只记方向」；n 未知与 n 不足是两种不同的话，不得混说。',
        '判词里的 implied_prob 是路由层按末行 P=0.xx 机械抽取的，不是模型自由给的数。',
        '本端点所有说明句禁出现该词（披露纪律）：本页只讲已经记下的读数，不作任何宣称。',
      ],
    };
  });
}

module.exports = { register, SOURCE_TYPES, OUTCOMES };
