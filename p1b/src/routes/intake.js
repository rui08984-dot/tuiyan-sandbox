'use strict';
/**
 * p1b/src/routes/intake.js —— 开放接题·最小闭环入口（阶段 3 出口件，2026-09-13）。
 *
 * 依据：docs/specs/2026-09-11-万物可预测性审计器-design.md §1.1（拒收门）/§1.2（决策树）/§2（分层引擎
 * 映射）/§7（MVP-A）；docs/specs/万物分类清单-v2.md 第 0/1/2 步 + v3 注记（红队 R1-F1/R1-F13 修法）。
 *
 * 契约：
 *   POST /api/intake/classify  入参 {statement, resolve_spec:{kind,url_template?,field?,threshold?,cmp?,date?},
 *                              checklist:{Q0_1,Q0_2,Q0_3, L5,L6,L1,L3,L2 各层二元问答, L4 可选},
 *                              decided_layer?, secondary?}
 *      · 拒收门三问（Q0-1 真值锚 / Q0-2 cutoff 早于决定性时点 / Q0-3 结果随实例变化）任一「否」
 *        → rejected，reason=no_anchor|leak|tautology，落 intake_rejects 留痕（拒收不是失败，分布进月报）；
 *      · 通过 → 决策树 L5→L6→L1→L3→L2 首个全绿层即 primary（最特殊优先）；
 *      · R1-F13 修：五层皆非全绿且无层可归 → layer='unknown'（清单 v3 出口 7）；
 *      · R1-F1 修：L4 移出决策树尾节点，改「后置叠加标注」——L4 三问全绿只记 secondary='L4'，
 *        primary 恒为底层（L4 永不作 primary，否则永远不可达）；
 *      · 返回 {ok, rejected|layer, secondary, checklist_hash, engine, gate:'descriptive', ...}。
 *        D-8.2：通过（非拒收）时另落 intake_questions（外部题挂载表，返回 intake_question_id）；
 *        本轮**不自动落 predictions**（外部题 resolve 后的域容器规则待定义，禁沿用隐式 corpus:* 模式）。
 *   GET /api/intake/rejects   拒收原因分布（防 Goodhart：分布须可见，含 0 计数）+ 分页明细。
 *
 * D-8.1：unknown 的入账路径（design §8）——unknown 留在接题层，predictions.layer CHECK 不放宽；
 *   报表侧走只读归一视图 predictions_r4（intakeStore.ensureIntakeTables 建）。**F13 = 半闭环**：
 *   接题层已闭环、入账层待与 F4 真值分库合并的同一次账本迁移；G2 判定仍只读 predictions 原表。
 *
 * 铁律落点：
 *   ① gate 恒 'descriptive' —— 分类与出数引擎解耦（本入口只记账/只出层，不产出任何概率或评分）；
 *   ② 本轮只做 layer→engine 映射表 + 路由骨架，不建任何引擎（engine_plan.built=false）；
 *   ③ 端点自足 ensure 表（predictions/audit 同先例），additive，零碰 p1a 既有表与 predictions 既有列。
 */
const { db } = require('../deps');
const { httpError, requireInt, requireNonEmptyString } = require('../util');
const store = require('../db/intakeStore');

/** 清单版本：v2 判据 + v3 注记（unknown 出口 + L4 后置标注），随清单文档冻结。 */
const CHECKLIST_HASH = 'v3';

/** 拒收门三问（顺序=清单第 0 步；任一「否」即拒收，取首个失败问的 reason）。 */
const GATE_QUESTIONS = [
  { key: 'Q0_1', reason: 'no_anchor', label: 'Q0-1 存在可机检/第三方可复核的真值锚' },
  { key: 'Q0_2', reason: 'leak', label: 'Q0-2 cutoff 早于事件决定性时点' },
  { key: 'Q0_3', reason: 'tautology', label: 'Q0-3 结果随实例变化（恒定即拒收）' },
];

/** 决策树顺序（R1-F1 修后：L4 已移出，改后置叠加标注）。 */
const DECISION_ORDER = ['L5', 'L6', 'L1', 'L3', 'L2'];
/** 各层二元问数量（清单 v2 逐层条目数；L4=3 用于后置标注）。 */
const QUESTION_COUNT = { L5: 3, L6: 4, L1: 4, L3: 4, L2: 4, L4: 3 };
/** primary 合法取值（L4 是叠加层，永不作 primary）。 */
const PRIMARY_LAYERS = ['L1', 'L2', 'L3', 'L5', 'L6', 'unknown'];
const ALL_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

/**
 * 分层引擎路由骨架（只映射不建引擎）：layer→engine 位。
 *   L1 proc_calc（程序计算，计错率）/ L2 stat_baseline+Wilson / L3 stat_baseline+ACI /
 *   L5 certified_dist（认证源分布）/ L6 structural（结构推断）/ L4 与 unknown=classify-only(engine=none)。
 * gate=descriptive 时一律只记账不预测（predicts=false）——分类与预测解耦铁律的工程实现。
 */
const ENGINE_TABLE = {
  L1: { engine: 'proc_calc', calibrator: null, posture: 'classify_only' },
  L2: { engine: 'stat_baseline', calibrator: 'wilson', posture: 'classify_only' },
  L3: { engine: 'stat_baseline', calibrator: 'aci', posture: 'classify_only' },
  L4: { engine: 'none', calibrator: null, posture: 'classify_only' },
  L5: { engine: 'certified_dist', calibrator: null, posture: 'classify_only' },
  L6: { engine: 'structural', calibrator: null, posture: 'classify_only' },
  unknown: { engine: 'none', calibrator: null, posture: 'classify_only' },
};

/** layer→引擎位读模型（built=false：本阶段不建引擎；predicts=false：gate=descriptive 只记账）。 */
function engineFor(layer) {
  const row = ENGINE_TABLE[layer] || ENGINE_TABLE.unknown;
  return {
    layer: layer,
    engine: row.engine,
    calibrator: row.calibrator,
    posture: row.posture,
    built: false,
    predicts: false,
    gate: 'descriptive',
  };
}

const TRUE_WORDS = ['yes', 'y', 'true', '是', '1'];
const FALSE_WORDS = ['no', 'n', 'false', '否', '0'];
const UNKNOWN_WORDS = ['unknown', '未知', 'n/a', 'na'];

/** 三态归一：boolean / 'yes|no|unknown' / 1|0 → true|false|'unknown'；其余抛 400。 */
function normTri(name, v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && (v === 0 || v === 1)) return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (TRUE_WORDS.indexOf(s) !== -1) return true;
    if (FALSE_WORDS.indexOf(s) !== -1) return false;
    if (UNKNOWN_WORDS.indexOf(s) !== -1) return 'unknown';
  }
  throw httpError(400, name + ' 必须是 是/否/未知（boolean 或 yes/no/unknown），收到: ' + JSON.stringify(v));
}

/** 单层是否全绿；未答 → null（由调用方决定是否必填）；'unknown' 视作非全绿（不归该层）。 */
function layerGreen(layer, v) {
  const n = QUESTION_COUNT[layer];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    if (v.length !== n) throw httpError(400, 'checklist.' + layer + ' 需要 ' + n + ' 个二元回答，收到 ' + v.length + ' 个');
    return v.every((x, i) => normTri('checklist.' + layer + '[' + i + ']', x) === true);
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) throw httpError(400, 'checklist.' + layer + ' 不能为空对象');
    return keys.every((k) => normTri('checklist.' + layer + '.' + k, v[k]) === true);
  }
  throw httpError(400, 'checklist.' + layer + ' 必须是二元回答数组或对象，收到: ' + JSON.stringify(v));
}

/** resolve_spec 形状校验（真值锚机检参数；可选，提供即校验）。 */
function normalizeResolveSpec(spec) {
  if (spec === undefined || spec === null) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) throw httpError(400, 'resolve_spec 必须是对象 {kind,...}');
  const kind = spec.kind === undefined || spec.kind === null ? '' : String(spec.kind).trim();
  if (!kind) throw httpError(400, 'resolve_spec.kind 必填（真值锚类型，如 http_json / official_stat）');
  const out = { kind: kind };
  for (const k of ['url_template', 'field', 'threshold', 'cmp', 'date']) {
    if (spec[k] !== undefined && spec[k] !== null) out[k] = spec[k];
  }
  return out;
}

/** 接题分类主逻辑（纯函数 + 拒收时写 intake_rejects；不写 predictions，零 LLM）。 */
function classifyIntake(body) {
  const b = body || {};
  const statement = requireNonEmptyString('statement', b.statement === undefined ? '' : String(b.statement));
  const checklist = b.checklist;
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    throw httpError(400, 'checklist 必填（对象：Q0_1/Q0_2/Q0_3 + L5/L6/L1/L3/L2 各层问答，L4 可选）');
  }
  const resolveSpec = normalizeResolveSpec(b.resolve_spec);
  // 第 0 步·拒收门三问
  const gateFails = [];
  for (const q of GATE_QUESTIONS) {
    const v = normTri('checklist.' + q.key, checklist[q.key]);
    if (v !== true) gateFails.push({ question: q.key, reason: q.reason, value: v });
  }
  if (gateFails.length) {
    const first = gateFails[0];
    const detail = {
      question: first.question,
      failures: gateFails.map((f) => f.question + '=' + String(f.value)),
      checklist_hash: CHECKLIST_HASH,
      resolve_spec_kind: resolveSpec ? resolveSpec.kind : null,
    };
    const rec = store.insertReject({ statement: statement, reason: first.reason, detail: detail });
    return {
      ok: true, rejected: true, reason: first.reason,
      reject_id: rec.id, created_at: rec.created_at, detail: detail,
      checklist_hash: CHECKLIST_HASH, engine: 'none', gate: 'descriptive', statement: statement,
    };
  }
  // 第 1 步·决策树（L5→L6→L1→L3→L2 首个全绿；R1-F1 后 L4 不在此列）
  const greens = {};
  for (const layer of DECISION_ORDER) {
    const g = layerGreen(layer, checklist[layer]);
    if (g === null) {
      throw httpError(400, 'checklist.' + layer + ' 必填（决策树 ' + DECISION_ORDER.join('→') + ' 要求逐层问答）');
    }
    greens[layer] = g;
  }
  let computed = null;
  for (const layer of DECISION_ORDER) { if (greens[layer]) { computed = layer; break; } }
  if (!computed) computed = 'unknown'; // R1-F13 出口 7：五层皆非全绿且无层可归
  // 人工定层（MVP 判定者=人按 checklist 填表；缺省=决策树机判）
  let layer = computed;
  let decidedBy = 'auto';
  if (b.decided_layer !== undefined && b.decided_layer !== null && b.decided_layer !== '') {
    const d = String(b.decided_layer);
    if (PRIMARY_LAYERS.indexOf(d) === -1) {
      throw httpError(400, 'decided_layer 必须是 ' + PRIMARY_LAYERS.join('|')
        + '（L4 是叠加层不作 primary——R1-F1 修后语义），收到: ' + JSON.stringify(b.decided_layer));
    }
    layer = d;
    decidedBy = 'human';
  }
  // 第 1.5 步·L4 后置叠加标注（R1-F1）
  let secondary = null;
  if (b.secondary !== undefined && b.secondary !== null && b.secondary !== '') {
    const s = String(b.secondary);
    if (ALL_LAYERS.indexOf(s) === -1) {
      throw httpError(400, 'secondary 必须是 ' + ALL_LAYERS.join('|') + ' 或 null，收到: ' + JSON.stringify(b.secondary));
    }
    secondary = s;
  } else if (layerGreen('L4', checklist.L4) === true) {
    secondary = 'L4';
  }
  const plan = engineFor(layer);
  // D-8.2：接题通过 → 落 intake_questions（外部题挂载表；本轮不自动落 predictions）
  const iq = store.insertIntakeQuestion({
    statement: statement, resolveSpec: resolveSpec, layer: layer, secondaryLayer: secondary,
    gate: 'descriptive', checklistHash: CHECKLIST_HASH, engine: plan.engine, evidence: [],
    intakeRejectId: null,
  });
  return {
    ok: true, rejected: false, layer: layer, computed_layer: computed, secondary: secondary,
    decided_by: decidedBy, checklist_hash: CHECKLIST_HASH, engine: plan.engine, engine_plan: plan,
    gate: 'descriptive', resolve_spec: resolveSpec, statement: statement,
    intake_question_id: iq.id, intake_ledger: 'intake_questions',
  };
}

function register(app) {
  store.ensureIntakeTables(db.getConnection()); // additive 私有表 + predictions_r4 只读视图（幂等，零碰 p1a 既有表/predictions 既有列）

  app.post('/api/intake/classify', async (req) => classifyIntake(req.body || {}));

  app.get('/api/intake/rejects', async (req) => {
    const q = req.query || {};
    let limit = 20;
    if (q.limit !== undefined && q.limit !== '') { limit = requireInt('limit', q.limit, 1); if (limit > 100) limit = 100; }
    let offset = 0;
    if (q.offset !== undefined && q.offset !== '') offset = requireInt('offset', q.offset, 0);
    const stats = store.rejectStats();
    const page = store.listRejects({ limit: limit, offset: offset });
    return {
      ok: true,
      total: stats.total,
      by_reason: stats.by_reason,
      reasons: store.REASONS,
      items: page.items,
      limit: limit,
      offset: offset,
      generated_at: new Date().toISOString(),
      note: '开放接题·拒收原因分布（防 Goodhart：分布可见，含 0 计数）。本页是接题分类唯一台账：'
        + '只记不评（gate=descriptive），分类与出数引擎解耦，不输出任何概率或评分。',
    };
  });
}

module.exports = { register, classifyIntake, engineFor, ENGINE_TABLE, CHECKLIST_HASH, DECISION_ORDER, GATE_QUESTIONS, PRIMARY_LAYERS };
