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
 *                              decided_layer?, secondary?,
 *                              game_id?（**可选**，权威：局归属查库拿 games 行）, game_type?（**可选**，提示）}
 *      · 【2026-09-27 边界硬规则 C3·第 -1 步】实验场域门：题挂在**真实对局**（game_type 非
 *        `werewolf_sim*` / `corpus*`，或 games.source='real'）⇒ rejected，reason='other'
 *        （detail.scope='not_prediction_lab'）。模拟局与语料局照常放行。**两个参数都缺省即短路**
 *        （外部题本就没有局；既有调用方零改动）——判据单一真源见 `src/evidence/labBoundary.js`；
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
 *   ①【阶段 4 修订 2026-09-13】gate 状态机：L2/L5 在 G2(R4) PASS ∧ 引擎 built ∧ 引擎 ok 时
 *      descriptive→scored，其余层恒 descriptive；**概率只在 scored 后出现**，未达标一律 descriptive
 *      （原文保留为历史：gate 恒 'descriptive' —— 分类与出数引擎解耦，本入口只记账/只出层）；
 *   ②【阶段 4 修订 2026-09-13】L2/L5 最小统计引擎已接线（engine_plan.built=true）；
 *      L1/L3/L4/L6/unknown 仍 built=false（原文：本轮只做 layer→engine 映射表 + 路由骨架）；
 *   ③ 端点自足 ensure 表（predictions/audit 同先例），additive，零碰 p1a 既有表与 predictions 既有列。
 */
const { db } = require('../deps');
const { httpError, requireInt, requireNonEmptyString } = require('../util');
const store = require('../db/intakeStore');
const { l2Baseline } = require('../engines/l2_baseline'); // 阶段 4：L2 最小统计件（Wilson）
const { l5Certified } = require('../engines/l5_certified'); // 阶段 4：L5 认证源公布分布
const { certifiedSourceForRow } = require('../engines/l5_sources'); // 2026-09-14：L5 认证源读侧重建（与 stage4-run 同源）
const baseRateMod = require('../evidence/baseRate'); // 批次 3：基率结构化字段（形态判别与引擎入参）
const predictionsStore = require('../db/predictionsStore'); // 2026-09-28：只借 deriveMaturesAt（到期日推导的单一真源）
const lab = require('../evidence/labBoundary'); // 2026-09-27：实验场/真实局边界单一真源（第 -1 步·实验场域门）
// 洞三（2026-09-28）：返回体的 matures_at 必须与 create 落库那行**逐字相同** ⇒ 复用写侧那个归一器。
//   路线间 require 是既有先例（`require('./games')` 见 advise/events/oracle/verdicts/predictions），
//   且 predictions 不 require intake ⇒ 无循环。
const { normalizeResolveSpec: normalizeResolveSpecForWrite } = require('./predictions');

/** 清单版本：v2 判据 + v3 注记（unknown 出口 + L4 后置标注），随清单文档冻结。 */
const CHECKLIST_HASH = 'v3';

/** 拒收门三问（顺序=清单第 0 步；任一「否」即拒收，取首个失败问的 reason）。 */
const GATE_QUESTIONS = [
  { key: 'Q0_1', reason: 'no_anchor', label: 'Q0-1 存在可机检/第三方可复核的真值锚' },
  { key: 'Q0_2', reason: 'leak', label: 'Q0-2 cutoff 早于事件决定性时点' },
  { key: 'Q0_3', reason: 'tautology', label: 'Q0-3 结果随实例变化（恒定即拒收）' },
];

/**
 * ★2026-09-28：本函数**只服务于返回体里 matures_at 那一个键**，不参与任何判定。
 *   判据契约、拒收门、决策树、gate 状态机一律未动。
 *
 * 到期口径：真值锚里带日历字段（date / week_end / end / date_plus7 / week_start /
 *   period / month / year / epiweek / week）⇒ 推出日期；推不出来 ⇒ **显式 null**。
 * ★推不出来就 null，绝不猜：题面里那句「2026-09-30 伦敦日降水量…」里的日期是
 *   **人的散文**，从自由文本里正则抓一个日期当作到期日，就是替用户编造确定性
 *   （与 `predictionsStore.deriveMaturesAt` 的 #2 纪律同源）。
 *   推导本身复用 store 的单一真源，不在这里另写一套日期优先级。
 *
 * ★★洞三（2026-09-28 收敛）：入参从「intake 自己截断过的 resolveSpec」改成
 *   **调用方发来的那份 raw spec，先过写侧那个 normalizeResolveSpec**。
 *   为什么必须这样（实测，见 test/matures-at-two-paths.test.cjs）：
 *     本文件原有一份 5 键白名单的 `normalizeResolveSpec`（url_template|field|threshold|cmp|date），
 *     而 `predictions.js` 那份是**全量透传**。⇒ 同一个请求体经 classify 时
 *     `month`/`year`/`period`/`week_end`/`end`/`date_plus7`/`week_start`/`epiweek`/`week`
 *     **当场被丢掉**，经 create 时原样进去。实测矛盾方向是
 *     「classify 说无到期日、账本里却有一个」：
 *       {kind, month:'2026-10'} → classify `null` ／ create+落库 `2026-10-31`
 *       {kind, year:2026}      → classify `null` ／ create+落库 `2027-12-31`
 *     而到期日是**结算通道的选题闸门**（predictionsStore.js:213-216：早一年会让年度题在
 *     真值尚未发布时就被选中），判错方向同样静默。
 *   ⇒ 直接从 `./predictions` 取写侧那个归一器（路线间 require 是本项目既有先例：
 *     `require('./games')` 见 advise/events/oracle/verdicts/predictions），**同一函数、同一份输入**。
 *   ★为什么不能图省事直接喂 raw：写侧归一会**丢掉 null 值键**，而
 *     `deriveMaturesAt({year: null})` 命中 `String(null).length === 4` 这条分支
 *     会算出 `1-12-31`（一个垃圾日期）⇒ raw 与归一后**不等价**。
 *     这条不等价是本文件的测试②逐字段钉出来的，不是推理。
 *   ★本函数**不改**本文件那份 5 键归一器：它喂的是 intake_questions 落库内容与引擎入参，
 *     改它就动了落库语义（超出"只许改返回体"的边界）。它自己那份白名单仍是一个**已知缺陷**，
 *     已在测试文件头登记，等另立项。
 */
function intakeMaturesAt(rawResolveSpec) {
  if (!rawResolveSpec) return null;
  let spec;
  try {
    spec = normalizeResolveSpecForWrite(rawResolveSpec);
  } catch (e) {
    return null; // 归一不过 ⇒ 推不出（不抛给调用方：返回体这一键不该把整个 classify 变成 500）
  }
  try {
    const d = predictionsStore.deriveMaturesAt(spec, []);
    return String(d).slice(0, 10);
  } catch (e) {
    return null; // 题面/锚里没有日历字段 ⇒ 无日历到期日（显式 null，不静默留空）
  }
}

/** 决策树顺序（R1-F1 修后：L4 已移出，改后置叠加标注）。 */
const DECISION_ORDER = ['L5', 'L6', 'L1', 'L3', 'L2'];
/** 各层二元问数量（清单 v2 逐层条目数；L4=3 用于后置标注）。 */
const QUESTION_COUNT = { L5: 3, L6: 4, L1: 4, L3: 4, L2: 4, L4: 3 };
/** primary 合法取值（L4 是叠加层，永不作 primary）。 */
const PRIMARY_LAYERS = ['L1', 'L2', 'L3', 'L5', 'L6', 'unknown'];
const ALL_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

/**
 * 分层引擎映射表（阶段 4 起 L2/L5 已接线）：layer→engine 位。
 *   L1 proc_calc（程序计算，计错率）/ L2 stat_baseline+Wilson（built）/ L3 stat_baseline+ACI /
 *   L5 certified_dist（认证源分布，built）/ L6 structural（结构推断）/ L4 与 unknown=classify-only。
 * gate≠scored 时一律只记账不预测（predicts=false）——分类与预测解耦铁律的工程实现。
 */
const ENGINE_TABLE = {
  L1: { engine: 'proc_calc', calibrator: null, posture: 'classify_only', built: false },
  L2: { engine: 'stat_baseline', calibrator: 'wilson', posture: 'score', built: true },
  L3: { engine: 'stat_baseline', calibrator: 'aci', posture: 'classify_only', built: false },
  L4: { engine: 'none', calibrator: null, posture: 'classify_only', built: false },
  L5: { engine: 'certified_dist', calibrator: null, posture: 'score', built: true },
  L6: { engine: 'structural', calibrator: null, posture: 'classify_only', built: false },
  unknown: { engine: 'none', calibrator: null, posture: 'classify_only', built: false },
};

/** G2 状态（阶段 3 已转正：design §4.2 R4 五条全 PASS）——gate 状态机的唯一闸门来源。 */
const G2 = { passed: true, regime: 'R4', decided_at: '2026-09-13', receipt: 'p1b/sim/out/g2-report-r4.out' };
/** 可 scored 的层：本轮只有 L2/L5 建有引擎；L3 检索代码解禁仍须另行评审立项。 */
const SCORABLE_LAYERS = ['L2', 'L5'];
/** gate 允许转移（design §3：descriptive/scored/blocked）。blocked 预留给 G3 争议/void，本轮引擎不产生。 */
const GATE_TRANSITIONS = [
  { from: 'descriptive', to: 'scored', when: 'layer∈{L2,L5} ∧ G2(R4) PASS ∧ 引擎 built ∧ 引擎 ok' },
  { from: 'descriptive', to: 'blocked', when: 'G3 结算争议/void（预留）' },
  { from: 'scored', to: 'descriptive', when: '改判/作废后回退（预留）' },
];

/**
 * gate 状态机（纯函数）：本题最终 gate。
 * 铁律：概率只在 scored 后出现；非 L2/L5、G2 未过、引擎未建、引擎未达标 → 一律 descriptive。
 */
function resolveGate(layer, engineResult, opts) {
  const o = opts || {};
  const g2Passed = o.g2Passed === undefined ? G2.passed : !!o.g2Passed;
  const built = o.built === undefined ? SCORABLE_LAYERS.indexOf(layer) !== -1 : !!o.built;
  if (SCORABLE_LAYERS.indexOf(layer) === -1) return { gate: 'descriptive', scored: false, reason: 'layer_not_authorized' };
  if (!g2Passed) return { gate: 'descriptive', scored: false, reason: 'g2_not_passed' };
  if (!built) return { gate: 'descriptive', scored: false, reason: 'engine_not_built' };
  if (!engineResult || engineResult.ok !== true) {
    const st = engineResult && engineResult.status ? engineResult.status : 'missing';
    return { gate: 'descriptive', scored: false, reason: 'engine_' + st };
  }
  return { gate: 'scored', scored: true, reason: 'g2_r4_passed+engine_ok' };
}

/** layer→引擎位读模型。built=该层引擎是否已建；predicts=本**题**是否真的出了数（gate=scored）。 */
function engineFor(layer, gate, engineResult) {
  const row = ENGINE_TABLE[layer] || ENGINE_TABLE.unknown;
  const gateVal = gate || 'descriptive';
  const ok = !!(engineResult && engineResult.ok === true);
  return {
    layer: layer,
    engine: row.engine,
    calibrator: row.calibrator,
    posture: row.posture,
    built: !!row.built,
    predicts: !!row.built && gateVal === 'scored' && ok,
    gate: gateVal,
  };
}

/**
 * 从请求体抽取引擎入参（evidence 为契约位置；顶层 history/base_rate 为便捷别名）。
 * 批次 3（2026-09-14）：`evidence.baseRate` **形态判别**——
 *   · 结构化形态（含 p，见 src/evidence/baseRate.js isStructured）⇒ 送引擎 baseRate（优先级高于文本注记）；
 *   · 其余形态 ⇒ 沿用旧义＝计数 {k,n}（零行为变化）。
 */
function engineInputs(body, resolveSpec) {
  const b = body || {};
  const ev = (b.evidence && typeof b.evidence === 'object' && !Array.isArray(b.evidence)) ? b.evidence : {};
  const history = b.history !== undefined ? b.history : (ev.history !== undefined ? ev.history : ev.series);
  const brRaw = ev.baseRate !== undefined ? ev.baseRate : undefined;
  const structured = baseRateMod.isStructured(brRaw) ? brRaw : null;
  const counts = b.base_rate !== undefined ? b.base_rate
    : (structured ? ev.counts : (brRaw !== undefined ? brRaw : ev.counts));
  return {
    evidence: ev,
    history: history,
    counts: counts,
    baseRate: structured,
    baseRateNote: ev.baseRateNote !== undefined ? ev.baseRateNote : b.baseRateNote,
    certifiedSource: ev.certifiedSource !== undefined ? ev.certifiedSource
      : (b.certified_source !== undefined ? b.certified_source : (resolveSpec && resolveSpec.certified_source)),
  };
}

/** 引擎产出摘要落 engine_note（可追溯：方法/状态/n/k/p/区间/分布/原因/gate）。 */
function engineNoteFor(layer, er, gateInfo) {
  if (!er) return 'layer=' + layer + ' 无引擎位（classify-only，只记账不出数）；gate=' + gateInfo.gate;
  const parts = ['engine=' + er.method, 'status=' + er.status];
  if (er.n !== undefined && er.n !== null) parts.push('n=' + er.n);
  if (er.k !== undefined && er.k !== null) parts.push('k=' + er.k);
  if (er.p !== undefined && er.p !== null) parts.push('p=' + er.p);
  if (er.ci) parts.push('ci=[' + er.ci[0] + ',' + er.ci[1] + ']');
  if (er.distribution) parts.push('dist=' + JSON.stringify(er.distribution));
  if (er.source_origin) parts.push('source_origin=' + er.source_origin);
  if (er.reason) parts.push('reason=' + er.reason);
  if (er.note) parts.push(er.note);
  parts.push('gate=' + gateInfo.gate, 'gate_reason=' + gateInfo.reason);
  return parts.join('; ');
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

/**
 * 第 -1 步·实验场域门判定（2026-09-27 边界硬规则 C3）。
 * 入参约定：
 *   · `game_id`（**可选，权威**）——查库拿 games 行（含 source 列）。给了但库中不存在 ⇒ 400，
 *     不回退到提示值：否则「随便编一个不存在的 game_id + 自称实验场」就能绕过本门。
 *   · `game_type`（**可选，提示**）——调用方自述，仅在 `game_id` 缺省时使用（**不查库**）。
 *   · 两者都缺省 ⇒ 直接短路返回 lab：外部题本就没有局（intake_questions 无 game_id 依赖），
 *     既有四个调用方（web/src/api.ts:267-271 请求体只有 statement/resolve_spec/checklist）零改动、零打红。
 * @returns {{scope:string, basis:string, game_id:?number, game_type:?string, source:?string}}
 */
function labBoundaryOf(body) {
  const b = body || {};
  if (b.game_id !== undefined && b.game_id !== null && b.game_id !== '') {
    const gid = requireInt('game_id', b.game_id, 1);
    const row = db.getConnection().prepare('SELECT * FROM games WHERE id=?').get(gid);
    if (!row) throw httpError(400, 'game_id 在库中不存在: ' + gid + '（局归属以库中 games 行为准，不接受调用方自述）');
    const c = lab.classifyGame(row);
    return { scope: c.scope, basis: c.basis, game_id: gid, game_type: row.game_type, source: c.source };
  }
  if (b.game_type !== undefined && b.game_type !== null && b.game_type !== '') {
    const c = lab.classifyGameType(b.game_type);
    return { scope: c.scope, basis: 'declared_' + c.basis, game_id: null, game_type: String(b.game_type), source: null };
  }
  return { scope: 'lab', basis: 'no_linkage', game_id: null, game_type: null, source: null };
}

/** 接题分类主逻辑（分类主逻辑：拒收时写 intake_rejects；不写 predictions，零 LLM）。 */
function classifyIntake(body) {
  const b = body || {};
  const statement = requireNonEmptyString('statement', b.statement === undefined ? '' : String(b.statement));
  const checklist = b.checklist;
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    throw httpError(400, 'checklist 必填（对象：Q0_1/Q0_2/Q0_3 + L5/L6/L1/L3/L2 各层问答，L4 可选）');
  }
  const resolveSpec = normalizeResolveSpec(b.resolve_spec);
  // 第 -1 步·实验场域门（边界硬规则 C3，2026-09-27）：真实对局（werewolf/botc/…）的题不入预测实验场。
  //   放 Q0 之前是硬理由：真实局题在 Q0-1「存在可机检/第三方可复核的真值锚」上本就答「否」，
  //   若先过 Q0 会被记成 no_anchor/leak，污染那个专为防 Goodhart 设计的拒收原因分布。
  //   reason 复用既有枚举 'other'（intakeStore.js:33 REASONS / :74 CHECK / :267-276 rejectStats 含 0 计数 /
  //   web/src/pages/intake/IntakePage.tsx:26 已标「其他」）⇒ 表/枚举/前端零改动。
  const boundary = labBoundaryOf(b);
  if (boundary.scope === 'real') {
    const detail = {
      scope: 'not_prediction_lab',
      boundary_basis: boundary.basis,
      game_id: boundary.game_id,
      game_type: boundary.game_type,
      game_source: boundary.source,
      checklist_hash: CHECKLIST_HASH,
      resolve_spec_kind: resolveSpec ? resolveSpec.kind : null,
    };
    const rec = store.insertReject({ statement: statement, reason: 'other', detail: detail });
    return {
      ok: true, rejected: true, reason: 'other',
      reject_id: rec.id, created_at: rec.created_at, detail: detail,
      checklist_hash: CHECKLIST_HASH, engine: 'none', gate: 'descriptive', statement: statement,
    };
  }
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
  // 第 2 步·引擎与 gate 状态机（阶段 4：L2/L5 最小统计件；其余层恒 classify-only）
  const eng = engineInputs(b, resolveSpec);
  let engineResult = null;
  if (layer === 'L2') {
    engineResult = l2Baseline({ resolve_spec: resolveSpec, history: eng.history, counts: eng.counts, baseRate: eng.baseRate, baseRateNote: eng.baseRateNote });
  } else if (layer === 'L5') {
    // 2026-09-14：L5 认证源读侧重建（与 stage4-run.cjs 同源）——
    //   声明（evidence.certifiedSource）优先；未声明时按 resolve_spec.kind 从组合数规则表重建
    //   （仅已注册的认证随机族；未注册 kind ⇒ 仍 unsupported，宁缺毋滥）。
    // 来源以 additive 字段 source_origin 透出（declared / read_side_registry），并进 engine_note，可追溯。
    let cs = eng.certifiedSource || null;
    let origin = cs ? 'declared' : null;
    if (!cs) {
      const built = certifiedSourceForRow({ resolve: resolveSpec, baseRate: eng.baseRate, baseRateNote: eng.baseRateNote });
      if (built.ok) { cs = built.source; origin = 'read_side_registry'; }
    }
    engineResult = l5Certified({ resolve_spec: resolveSpec, certifiedSource: cs });
    if (origin) engineResult = Object.assign({}, engineResult, { source_origin: origin });
  }
  const gateInfo = resolveGate(layer, engineResult);
  const plan = engineFor(layer, gateInfo.gate, engineResult);
  // 铁律：概率只在 gate=scored 后出现；否则 prob/ci 恒 null
  const prob = (engineResult && engineResult.ok === true && typeof engineResult.p === 'number') ? engineResult.p : null;
  const probCi = (engineResult && engineResult.ok === true && engineResult.ci) ? engineResult.ci : null;
  const engineNote = engineNoteFor(layer, engineResult, gateInfo);
  const engineEvidence = Object.keys(eng.evidence).length ? [eng.evidence] : [];
  const iq = store.insertIntakeQuestion({
    statement: statement, resolveSpec: resolveSpec, layer: layer, secondaryLayer: secondary,
    gate: gateInfo.gate, checklistHash: CHECKLIST_HASH, engine: plan.engine, evidence: engineEvidence,
    intakeRejectId: null, prob: prob, probCi: probCi, engineNote: engineNote,
  });
  return {
    ok: true, rejected: false, layer: layer, computed_layer: computed, secondary: secondary,
    decided_by: decidedBy, checklist_hash: CHECKLIST_HASH, engine: plan.engine, engine_plan: plan,
    gate: gateInfo.gate, gate_reason: gateInfo.reason, resolve_spec: resolveSpec, statement: statement,
    prob: prob, prob_ci: probCi, engine_note: engineNote, engine_result: engineResult,
    // ★2026-09-28 只加这一个键（判据契约/拒收门/决策树一个字未动）：
    //   **到期口径原先压根不在返回体里**，而「记一笔」的回执读的是 `detail.matures_at`
    //   ⇒ 那个字段恒为 undefined，界面永远落进「按题面判据自动推」兜底，
    //   而调用方据此以为"到期日是系统给的"——实际是它自己编的一句。
    //   口径：题面/真值锚里带日历字段 ⇒ 给出推出来的日期；**推不出来就显式给 null**
    //   （"本题无日历到期日，按自身节奏结算"），**不许留空让人误以为没算**。
    //   与 predictionsStore 的 #2 纪律同源：省略即静默出域。
    // ★洞三：传 `b.resolve_spec`（调用方发来的那份）而不是 `resolveSpec`（本文件 5 键白名单截断过的那份）
    //   —— 两者在九个日历字段上不等价，详见 intakeMaturesAt 的注释。
    matures_at: intakeMaturesAt(b.resolve_spec),
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

  // 接题库只读列表（UI 接题页用；纯只读，不改任何既有列语义）
  app.get('/api/intake/questions', async (req) => {
    const q = req.query || {};
    let limit = 20;
    if (q.limit !== undefined && q.limit !== '') { limit = requireInt('limit', q.limit, 1); if (limit > 100) limit = 100; }
    let offset = 0;
    if (q.offset !== undefined && q.offset !== '') offset = requireInt('offset', q.offset, 0);
    const page = store.listIntakeQuestions({ limit: limit, offset: offset });
    return {
      ok: true,
      total: page.total,
      items: page.items.map((r) => ({
        id: r.id, statement: r.statement, layer: r.layer, secondary_layer: r.secondary_layer,
        gate: r.gate, checklist_hash: r.checklist_hash, engine: r.engine,
        prob: r.prob, prob_ci: r.prob_ci, engine_note: r.engine_note,
        resolve_spec: r.resolve_spec, created_at: r.created_at,
        resolved_at: r.resolved_at, outcome: r.outcome,
      })),
      limit: limit, offset: offset,
      generated_at: new Date().toISOString(),
      note: '最近接的题（只读）。分层与计分状态如实显示；只有该层算法已接线、且该题确实参与计分时才有读数，否则如实留空、不出数。',
    };
  });
}

module.exports = { register, classifyIntake, labBoundaryOf, engineFor, resolveGate, ENGINE_TABLE, CHECKLIST_HASH, DECISION_ORDER, GATE_QUESTIONS, PRIMARY_LAYERS, G2, SCORABLE_LAYERS, GATE_TRANSITIONS, engineInputs, engineNoteFor };
