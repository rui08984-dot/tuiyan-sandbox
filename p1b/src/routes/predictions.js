'use strict';
/**
 * p1b/src/routes/predictions.js —— 预测卡 L0 账本 API（第十棒 W1）。
 *
 * 契约（任务书 W1-2）：
 *   POST /api/games/:id/predictions     落注：statement + prob（prob 必须 0-1 数值；
 *                                       口语「大概率」由调用方澄清后传数值，本路由拒收口语）
 *                                       evidence 收**两种形状**：事件 id 数组（旧，向后兼容）
 *                                       或结构化对象数组（{resolve:{kind}, baseRate?}）
 *   GET  /api/games/:id/predictions     分页清单（limit/offset + total + l0_gate）
 *   POST /api/predictions/:id/resolve   真值回填：outcome ∈ true|false|ambiguous + note
 *                                       （歧义必须附 note 留痕，不许硬判；账本不可变，已 resolve 拒改 409）
 *   GET  /api/predictions/unresolved    未 resolve 清单
 *   GET  /api/predictions/:id           单题完整一生（2026-09-28 T8：题面/当时押的数/引擎基率/真值/
 *                                       判词条数/真值口径是否被排除统计；只读零写）
 *   GET  /api/predictions/domains       账本按域分组（2026-09-28 洞一：报「其中 N 条是人手写的」；
 *                                       real/lab/external/unknown 四域互斥、只分组不筛除）
 *   ★`/unresolved` 与 `/calibration` 均带 `by_scope`：外部题不许和批量灌入的语料题同栏分不开。
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
const kindGate = require('../evidence/resolveKind'); // 真值锚 kind 支持表单一真源（三表派生），本路由不另立字面量
const lab = require('../evidence/labBoundary'); // 域边界单一真源（real / lab / external 三种 scope）
const extLedger = require('../db/externalLedger'); // 外部题容器局（2026-09-28 · 实现裁定待创始人复核）
const { idempotent, ensureIdempotencyTables } = require('./idempotency'); // 2026-09-30 落注写口幂等（发行阻断项）

const SOURCE_TYPES = store.SOURCE_TYPES;
const OUTCOMES = store.OUTCOMES;

/**
 * 外部题落注用的 `resolve_spec` 取值。
 * ★**这里只取 kind，不复述一遍 kind 的枚举**——那会立刻变成第二份支持表
 *   （本文件头 `kindGate` 的注释写过：写端放进来一种、读端查不到，就回到今天的病）。
 *   真正的合法性校验发生在下面的 `normalizeStructured` → `requireEnum(kindGate.supportedKinds())`，
 *   与真库那 52 种 kind 同一个真源。
 */
function normalizeResolveSpec(spec) {
  if (spec === undefined || spec === null) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) throw httpError(400, 'resolve_spec 必须是对象 {kind,...}');
  const out = {};
  for (const k of Object.keys(spec)) {
    if (spec[k] === undefined || spec[k] === null) continue;
    out[k] = spec[k];
  }
  out.kind = String(out.kind === undefined ? '' : out.kind).trim();
  if (!out.kind) throw httpError(400, 'resolve_spec.kind 必填（真值锚类型，如 openmeteo_daily_max）');
  return out;
}

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
 * evidence 的**两种形状**分派。
 *
 * 【病象：建库通路是断的】真库的 evidence_json 装的是结构化对象数组
 * （`[{ resolve:{kind}, baseRate:{p,n,k,...} }]`），可本函数只收事件 id 数组
 * ⇒ 走 HTTP 建出来的行没有真值锚、没有基率。而基率读数与真值锚端点一律用
 * `json_extract(evidence_json,'$[0].resolve.kind')` 检索 ⇒ 那类行查不到历史频率，
 * 等于落了一本没有索引的账（本轮实测真库 1994 行、1308 行的基率都在第 0 个元素上）。
 *
 * ★ 形状按**元素是不是普通对象**分，不看"能不能解析成整数"：
 *   旧形状的元素是 id（旧调用方可能传字符串数字），元素是对象时绝无可能是事件 id。
 *   混在一行 ⇒ 拒收，理由不是"格式不对"而是**后果**：读端只看 $[0]，
 *   混形状行要么读不到锚、要么读不到事件引用，两头都残 ⇒ 等于没建索引。
 */
function normalizeEvidence(gameId, evidence) {
  if (evidence === undefined || evidence === null) return [];
  if (!Array.isArray(evidence)) throw httpError(400, 'evidence 必须是事件 id 数组或结构化对象数组');
  if (evidence.length > 10) throw httpError(400, 'evidence 最多 10 项（事件 id 或结构化证据元素）');
  const objs = evidence.filter((v) => v !== null && typeof v === 'object' && !Array.isArray(v)).length;
  if (objs === 0) return normalizeEventIds(gameId, evidence);
  if (objs !== evidence.length) {
    throw httpError(400, 'evidence 一行内不许混两种形状（事件 id 与结构化对象）'
      + '——读端只认第 0 个元素的位置，混形状行读端要么读不到真值锚、要么读不到事件引用，两头都残');
  }
  return normalizeStructured(evidence);
}

/**
 * 旧形状：事件 id 引用校验。必须是整数 id（≤10），且每个 id 真实存在并属于本局
 * （账本干净铁律：不留悬空引用；验证点自动路径的 id 已过 p1a postValidate 白名单）。
 * ★向后兼容硬要求：既有调用方走的就是这条，一行都不许改口径。
 */
function normalizeEventIds(gameId, evidence) {
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
 * 新形状：结构化证据元素 `{ resolve:{kind,...}, baseRate?:{p,n,k,...}, ...其余键原样保留 }`。
 *
 * 校验只加两处，其余键**一律原样透传**（kind/slug/note/forecast/reference_tail/baseRateNote
 * 都是生成批自己写的，读端在用；这里重写它们等于在写端另立一套生成口径）：
 *   ① `resolve.kind` 必须在**支持表**内 —— 沿用 util.js 的 requireEnum 报错口径（字段名 + 收到的值 + 全部枚举），
 *      禁另立魔法字符串式报错。支持表来源见 evidence/resolveKind.js（三表派生，非手抄字面量）。
 *   ② `baseRate` 若出现则必须结构合法 —— 判据复用 baseRate.js 的 isStructured（基率字段的单一真源）。
 *      ★非法就拒，不静默丢字段：丢了之后这行"看着落了库、其实没有基率"，
 *      读端会一路退到文本兜底甚至报"没有基率"，而账本不可改，错了就永远错在那儿。
 *   合法时用 baseRate.js 的 buildBaseRate 归一（补 schema 标签与 kind 缺省），
 *   使新行与真库既有 1308 行的基率字段**同形**，不是"另一种基率"。
 */
function normalizeStructured(evidence) {
  let kinds;
  try {
    kinds = kindGate.supportedKinds();
  } catch (e) {
    // 支持表读不到 ⇒ 无从判定 kind 合法性。如实报 500（服务端缺件），不伪装成用户的 400。
    throw httpError(500, '真值锚支持表不可用，落注已中止（未写库）：' + e.message);
  }
  return evidence.map((el, i) => {
    if (el === null || typeof el !== 'object' || Array.isArray(el)) {
      throw httpError(400, 'evidence[' + i + '] 必须是结构化对象 {resolve:{kind}, baseRate?}');
    }
    const res = el.resolve;
    if (res === null || typeof res !== 'object' || Array.isArray(res)) {
      throw httpError(400, 'evidence[' + i + '].resolve.kind 必填（真值锚类型，如 openmeteo_daily_max）'
        + '—— 没有真值锚的行既查不到基率、也判不了真值口径，等于没建索引');
    }
    requireEnum('evidence[' + i + '].resolve.kind', res.kind, kinds);
    const out = Object.assign({}, el);
    if (el.baseRate !== undefined && el.baseRate !== null) {
      if (!baseRateMod.isStructured(el.baseRate)) {
        throw httpError(400, 'evidence[' + i + '].baseRate 结构非法'
          + '（须为 {p, n?, k?, kind?, window?, basis?, cmp?, threshold?}，p 必填且落在 [0,1]；'
          + 'n/k 缺省表示未知，不是 0）—— 非法基率一律拒收，不静默丢字段'
          + '（账本不可改，丢了就永远缺基率），收到: ' + JSON.stringify(el.baseRate));
      }
      out.baseRate = baseRateMod.buildBaseRate(el.baseRate);
    }
    return out;
  });
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

/**
 * 落注的**公共骨架**（2026-09-28）。
 *
 * 【为什么抽出来：病象是"分类信息全丢"】
 *   原实现直接把 `{gameId, day, sourceType, statement, prob, evidence}` 六个字段
 *   递给 `store.insertPrediction`，而 store 那一侧的 INSERT 写的是**十七列**
 *   （predictionsStore.js:298），其中 layer / secondary_layer / engine / gate /
 *   matures_at / g2_regime 全都是可选入参 —— 这里一个都没给。
 *   ⇒ **走 HTTP 建出来的行，layer 恒为 NULL**。行"落库了"，可分层读数、
 *     按层校准、按 gate 门控全都查不到它 —— 账本里有一条看不见分层的题。
 *   store 侧的白名单早就支持这些字段（`AUDIT_KEYS`），缺的只是**路由没往下传**。
 *
 * ★本函数只做"往下传"这一件事，判据与校验一行都不新增、不放松
 *   （`requireProb` / `normalizeEvidence` / store 的枚举白名单都原样在前面挡着）。
 */
function insertFromBody(gameId, body, opts) {
  const o = opts || {};
  const statement = requireNonEmptyString('statement', body.statement === undefined ? '' : String(body.statement));
  // ★prob 必填：不是"没填就补一个"，是**没填就 400**。`requireProb` 拒口语、拒区间外。
  const prob = requireProb(body.prob);
  let day = null;
  if (body.day !== undefined && body.day !== null) day = requireInt('day', body.day, 0);
  else if (o.dayFromGame) day = currentDayOf(gameId); // 缺省=账本最新天（仅对局落注有意义）
  const evidence = normalizeEvidence(gameId, body.evidence);

  /* ── 分类与到期口径：往下传，但**只在给了的时候**给 ──
     省略与"显式 null"是两件事（store 的 F16 白名单就是防这个的）：
       · 给了就校验后照传，校验口径仍以 store 的 `assertAuditFields` 为准；
       · 没给就整个键不出现 ⇒ store 写 NULL（既有 HTTP 调用方行为逐字不变）。 */
  const audit = {};
  if (body.layer !== undefined) audit.layer = body.layer;
  if (body.secondary_layer !== undefined) audit.secondaryLayer = body.secondary_layer;
  if (body.engine !== undefined) audit.engine = body.engine;
  if (body.gate !== undefined) audit.gate = body.gate;
  if (body.checklist_hash !== undefined) audit.checklistHash = body.checklist_hash;
  if (body.metric_version !== undefined) audit.metricVersion = body.metric_version;
  if (body.backtest_batch !== undefined) audit.backtestBatch = body.backtest_batch;
  if (body.public_exposure !== undefined) audit.publicExposure = body.public_exposure;
  // 到期日：调用方显式给了就用它的；否则**尝试从真值锚推**（resolve_spec/evidence 里的日历字段），
  // 推得出来就用，推不出来就显式写 null 并在返回里说明原因——**不静默留空**。
  //   （store 的 #2 纪律：有日历到期日给日期，无日历语义者显式传 null 并注释原因。）
  let maturesAt = null;
  let maturesWhy = null;
  if (body.matures_at !== undefined && body.matures_at !== null) {
    maturesAt = String(body.matures_at).slice(0, 10);
  } else {
    try {
      maturesAt = store.deriveMaturesAt(o.resolveSpec || null, evidence);
    } catch (e) {
      maturesWhy = '题面与真值锚里没有任何日历字段 ⇒ 本题无日历到期日，'
        + '按题目自身节奏结算（matures_at 显式写 null，不静默留空）';
    }
  }
  audit.maturesAt = maturesAt;
  // g2_regime：外部题不经 G2 批写通道，显式声明为 null（"本行不由 G2 批写"）而不是省略
  audit.g2Regime = body.g2_regime === undefined ? null : body.g2_regime;

  const row = store.insertPrediction(Object.assign(
    { gameId: gameId, day: day, sourceType: o.sourceType, statement: statement, prob: prob, evidence: evidence },
    audit,
  ));
  return Object.assign({}, row, {
    matures_why: maturesWhy,
    external: !!o.external,
  });
}

/**
 * 各域的人话标签（读侧披露用）。
 * ★人话标签是**披露的一部分**，不是装饰：只给 "external=2" 用户无从判断那两条是什么；
 *   反过来只给一句「人手写的题」而不给数，等于让人以为「一条都没有」——那与隐藏同一种误导。
 */
const SCOPE_TEXT = {
  external: {
    label: '人手写的题（外部题）',
    note: '这些挂在一个**容器局**下——那不是一局对局。「记一笔」里你亲手写下的题都落在这里。',
  },
  lab: {
    label: '批量灌入的语料题／实验场题',
    note: 'CLI 批量灌进来的那批，以及实验场（模拟局）里出的题——它们不是人手写的。',
  },
  real: {
    label: '真实对局里的题',
    note: '挂在真实对局下。域门上线前落的历史题在这儿（现在这类题在接题层会被拒收）。',
  },
  unknown: {
    label: '查不到局归属的题',
    note: '局行查不到或 game_type 缺省 ⇒ 归 unknown，**不据此判真实局**（取「拒收」要确凿证据）。',
  },
};

/**
 * 库上有没有 `games.source` 这一列（**只读** pragma，一次 prepare 前一次查询）。
 *
 * ★为什么每次都查、不缓存：这一列是 `sim-loop.cjs:77` / `db/externalLedger.ensureSourceColumn`
 *   的 **additive ALTER** 才有的，而这两条路都在运行期发生（本文件下面的 `POST /api/predictions`
 *   第一次跑就会建容器局并补这一列）⇒ 进程启动时"没有"、落第一条外部题后"有"，缓存会把其中
 *   一个状态一直错下去。pragma 打在内存库上是微秒级，不值得为它引入一个会过期的缓存。
 *
 * 查不到这一列时必须**从 SQL 里整段拿掉 source 分支**（不是 COALESCE 兜底）——
 * SQLite 在 prepare 期解析列名，缺列会直接 `SqliteError: no such column`。
 * 拿掉之后按 game_type 判，与 `classifyGame` 读 `row.source === undefined` 走同一条回退路。
 */
function gamesHaveSourceColumn() {
  const cols = db.getConnection().pragma('table_info(games)');
  for (const c of cols) if (c.name === 'source') return true;
  return false;
}

/** 域口径 SQL（每次现查列有无；判定本身全部来自 labBoundary，本文件不重写）。 */
function scopeSql(alias) {
  return lab.PREDICTION_SCOPE_SQL(alias || 'g', { hasSource: gamesHaveSourceColumn() });
}

/**
 * 域计数（只读；**判定一律来自 `lab.PREDICTION_SCOPE_SQL`**，本文件不重写任何域口径）。
 * 缺省就把 SCOPES 四个域全开成 0 —— 只报碰巧非空的域，读者无法区分
 * 「这个域是 0 条」和「这个域根本没查」，那正是「筛掉了 N 条被读成数据没了」的同一种病。
 * @param {string} [where] 附加 WHERE（不含 WHERE 关键字），不传＝全账本
 * @param {Array}  [args] 对应的 ? 绑定
 * @returns {{real:number, lab:number, external:number, unknown:number}}
 */
function scopeCounts(where, args) {
  const c = db.getConnection();
  const by = {};
  for (const s of lab.SCOPES) by[s] = 0;
  const stmt = c.prepare(
    'SELECT ' + scopeSql() + ' AS scope, COUNT(*) AS n'
    + ' FROM predictions p LEFT JOIN games g ON g.id = p.game_id'
    + (where ? ' WHERE ' + where : '')
    + ' GROUP BY scope'
  );
  // apply 须以 statement 自身为 thisArg（better-sqlite3 原生绑定，照 predictionsStore.js:334 的先例；
  // 传 null 会得到 "Illegal invocation" —— 不是 SQL 错，是 thisArg 错，极易误诊）
  const rows = stmt.all.apply(stmt, args || []);
  for (const r of rows) {
    // CASE 恒非 NULL（有 ELSE），这里的兜底只防「有人往 SCOPES 之外加了新域却忘了改这个映射」
    by[lab.SCOPES.indexOf(r.scope) === -1 ? 'unknown' : r.scope] += r.n;
  }
  return by;
}

/** 逐 id 取域（读侧给每行挂标签用；一次查询，不 N+1）。查不到的行记 unknown。 */
function scopesOfIds(ids) {
  const out = {};
  if (!ids || !ids.length) return out;
  const q = db.getConnection().prepare(
    'SELECT p.id AS id, ' + scopeSql() + ' AS scope'
    + ' FROM predictions p LEFT JOIN games g ON g.id = p.game_id WHERE p.id = ?'
  );
  for (const id of ids) {
    const r = q.get(id);
    out[id] = r ? r.scope : 'unknown';
  }
  return out;
}

/** 四域之和（守恒自校验：分组「互斥且完备」不是口头承诺，是一个能算出来的数）。 */
function scopeSum(by) {
  return lab.SCOPES.reduce((a, k) => a + (by[k] || 0), 0);
}

/** 域拆分挂到一组行上（就地加 `scope` 键，并按域分好计数）。 */
function tagRowsByScope(items) {
  const ids = items.map((r) => r.id);
  const scopes = scopesOfIds(ids);
  const by = {};
  for (const s of lab.SCOPES) by[s] = 0;
  for (const it of items) {
    const sc = scopes[it.id] || 'unknown';
    it.scope = sc;
    it.scope_label = (SCOPE_TEXT[sc] || SCOPE_TEXT.unknown).label;
    by[sc] += 1;
  }
  return by;
}

/** 域披露端点可取的视图（三值穷尽；`all` = 不筛）。缺省 `all`——**缺省不许筛**，筛必须显式要。 */
const DOMAIN_VIEWS = ['all', 'hand_written', 'other'];

function register(app) {
  store.ensurePredictionsTable(db.getConnection()); // additive 私有表（幂等，零碰 p1a 既有表）
  ensureIdempotencyTables(db.getConnection()); // 幂等键私有表（additive、幂等，同上纪律）

  // 落注（人工/调用方）
  // ★2026-09-30：加幂等包装（发行阻断项，见 routes/idempotency.js 文件头）。
  //   这条口是「记一道判断」的入口，一次超时重试 = 多一条预测 = 准确率当场被污染（账本无修正入口）。
  //   键由调用方给；没带键的老调用方**照写**（只在响应里如实回报 + 落一行 keyed=0 证据）。
  app.post('/api/games/:id/predictions', idempotent('POST /api/games/:id/predictions', async (req, reply) => {
    const gameId = requireInt('game id', req.params.id, 1);
    getGameOr404(gameId);
    const body = req.body || {};
    const sourceType = body.source_type === undefined || body.source_type === null
      ? '预测卡'
      : requireEnum('source_type', body.source_type, SOURCE_TYPES);
    const row = insertFromBody(gameId, body, { sourceType: sourceType, dayFromGame: true });
    reply.code(201);
    return row;
  }));

  /* ══ 2026-09-28：外部题免局落注（`POST /api/predictions`）══
   *
   * 【本端点是给「外部题」用的】题面 + 真值锚类型（resolve_spec.kind）+ 用户自己的判断，
   *   **没有对局**。判据是它落进的那个容器局不是一局对局（`db/externalLedger` 文件头）。
   *
   * 【为什么需要】`predictions.game_id NOT NULL` ⇒ 落注必须挂一局，而外部题
   *   （天气/汇率/开奖…）没有对局。`routes/intake.js:25` 把域容器规则写成了待定项，
   *   于是「记一笔」记完的题**从不进 predictions 账**——界面全程"收下了"，
   *   账本里什么都没有，而用户填的那个数也一起没了。
   *
   * 【★本端点不收事件 id 证据（洞二 · 2026-09-28 · 显式拒绝，不是"漏检"）】
   *   事件（夜里谁死了、谁投了谁、谁跳大神）是**对局线**的概念。外部题没有对局，
   *   也就没有"第几号事件"可言。实测三条依据（`test/external-evidence-shape.test.cjs` 有闸）：
   *     ① 本端点写的是**容器局**，不是调用方那一局；`normalizeEventIds` 查的是
   *        `events WHERE id=? AND game_id=<容器局>` ⇒ 调用方真正想引用的局内事件
   *        **结构上取不到**（实测：事件 id 1 属于真实局 2，容器局是 1，交叉查不到）。
   *     ② 容器局**装不下**有意义的局内事件：`events.phase` 的 CHECK 是
   *        `IN ('night','day','dusk')`，而天气/汇率/开奖没有夜、日、黄昏
   *        （实测：插 `phase='forecast'` 被 CHECK 挡掉）。
   *     ③ 容器局**不建席**（`externalLedger.js` 文件头：与 createGameCore 唯一的差别），
   *        实测 0 席位 ⇒ 事件连叙事主体都没有。
   *   ⇒ 所以这里选的是**显式拒绝**而不是"支持它"：唯一能通过校验的 id 属于一个
   *     **不该存在的事件序列**；硬收则 id 在 evidence_json 里存成数字，
   *     读端 `json_extract(evidence_json,'$[0].resolve.kind')`（基率/真值口径/单题详情全走这条）
   *     照样取不到锚 ⇒ 落一条"看着落了库、其实没建索引"的黑洞行（本文件头铁律）。
   *
   *   ★改动前这条路径给的是**指错方向**的报错：调用方发 `evidence:[1,2]`（只一种形状），
   *     路由把 `[{resolve}]` 拼上去才变成 `[{resolve},1,2]`，然后报
   *     「evidence 一行内不许混两种形状」——**混形状是服务端自己造的**，
   *     照这条提示去查，调用方会去检查"我是不是混了两种形状"，永远查不出问题。
   *     现在在**拼锚之前**就拒，报错说的是真正的原因。
   *   ★要按局落注、带局内事件证据，请用 `POST /api/games/:id/predictions`（那边照旧收事件 id）。
   *
   * 【本端点其余三件事，一律沿用既有落注链路】
   *   ① 把题挂到**显式的外部题容器局**（`db/externalLedger`，`games.source='external'`）；
   *      ⚠ 那是实现裁定、需创始人复核，见该文件头。
   *   ② 真值锚 **必须**给（`resolve_spec.kind`）——没有锚的行查不到历史频率、
   *      判不了真值口径，等于落了一本没有索引的账（与本文件头 L0 铁律同源）。
   *   ③ 用户给的 `prob` **必填**，缺省即 400（不许拿基率/引擎读数顶上）。
   *
   * 纪律：口算概率（"大概率"）仍被 `requireProb` 拒；layer 枚举、gate 枚举、
   *   evidence 结构仍由 store 的白名单校验，一条都没放松。 */
  app.post('/api/predictions', idempotent('POST /api/predictions', async (req, reply) => {
    const body = req.body || {};
    const spec = normalizeResolveSpec(body.resolve_spec);
    if (!spec) {
      throw httpError(400, 'resolve_spec 必填（真值锚类型，如 {kind:"openmeteo_daily_max"}）'
        + '—— 没有真值锚的行查不到历史频率、也判不了真值口径，等于没建索引');
    }
    const callerEv = Array.isArray(body.evidence) ? body.evidence : [];
    /* ★洞二：在**拼锚之前**拒事件 id。位置很要紧——放到后面就会被拼出来的
     *   `[{resolve}, 1]` 触发 normalizeEvidence 的"混形状"分支，
     *   而那句提示说的因果是反的（混形状是路由自己造的）。
     *   判据是"元素是不是普通对象"（照 normalizeEvidence 同款分派）：非对象元素
     *   在本端点的语义里只可能是事件 id（本端点只认结构化对象 + 事件 id 两种形状）。
     *   注意 `[{resolve}, 1]` 这种**调用方自己也混了**的，一并在此拒：
     *   对它们说"混两种形状"是次诊断，说"这里不收事件 id"才是真诊断。 */
    for (let i = 0; i < callerEv.length; i++) {
      const e = callerEv[i];
      if (e !== null && (typeof e !== 'object' || Array.isArray(e))) {
        throw httpError(400, '外部题端点（POST /api/predictions）不收事件 id 证据：'
          + 'evidence[' + i + '] 收到 ' + JSON.stringify(e) + '，而事件（夜里谁死了、谁投了谁）是对局线的概念，'
          + '这个端点收的是外部题——题面 + 真值锚类型 + 你自己的判断，它落进的是「外部题容器局」'
          + '（不是一局对局：没有席位，也没有夜/日/黄昏的阶段），'
          + '所以容器局下取不到你那些局内事件。'
          + '★要按局落注、带局内事件证据，请改用 POST /api/games/:id/predictions。'
          + '（若只是想给外部题挂基率/说明，请传结构化对象数组，每个元素带 resolve.kind。）');
      }
    }
    const container = extLedger.ensureExternalContainer();
    /* ★真值锚必须落在 **evidence[0]**，否则等于没建索引。
     *   读端一律用 `json_extract(evidence_json,'$[0].resolve.kind')` 检索
     *   （基率读数、真值口径、单题详情都是这条路）—— 锚不在第 0 个元素上，
     *   这条行就查不到历史频率、判不了真值口径，看着落了库、其实是个黑洞。
     *   沿用本文件头那条铁律的口径：**没有真值锚的行等于没建索引**。
     *   调用方自带 evidence 且第 0 个元素已有 resolve 时以它的为准，不重复塞。 */
    const hasAnchorAt0 = !!(callerEv.length && callerEv[0] && typeof callerEv[0] === 'object' && callerEv[0].resolve);
    const withAnchor = hasAnchorAt0 ? callerEv : [{ resolve: spec }].concat(callerEv);
    const row = insertFromBody(container.id, Object.assign({}, body, { evidence: withAnchor }),
      { sourceType: '预测卡', resolveSpec: spec, external: true });
    reply.code(201);
    return Object.assign({}, row, {
      container: { game_id: container.id, name: container.name, scope: lab.classifyGameType(container.game_type).scope },
      intake_question_id: body.intake_question_id === undefined ? null : body.intake_question_id,
    });
  }));

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
    // ★洞一：外部题原来在这里和批量灌入的语料题同栏分不开。
    //   加的是**两个**拆分，不是把其中一栏藏起来：
    //     · `by_scope`      —— 全部未落定（outcome IS NULL）的域拆分，也就是 l0_gate.unresolved 那批
    //     · `page_by_scope` —— **这一页**里各域多少条（到期闸已过滤过，两者是不同口径）
    //   刻意不给 `by_scope` 套用到期闸：闸的日期口径在 store 里（`todayShanghai` + 成熟日比较），
    //   在这里复刻一遍就是又一处日期算法分叉——本项目已经吃过一次亏（见 store 的 maturityState 注释）。
    //   故两个数都如实标出口径，由读的人自己比，不替他合并成一个。
    const pageBy = tagRowsByScope(page.items);
    return Object.assign({}, page, {
      l0_gate: store.l0Gate(),
      by_scope: scopeCounts('outcome IS NULL'),
      page_by_scope: pageBy,
      scope_note: 'by_scope 数的是**全部未落定**的题；page_by_scope 数的是**这一页**（已过到期闸，'
        + '没到期的那些不在页里）。两个数口径不同，都不是"数据少了"——账本一条都没删。',
    });
  });

  // 校准读数（W2）：ECE+分桶，n<30 →「数据不足」；纯统计零 LLM（C 方案 5 对照组；
  // logit 聚合/层级 Platt 只留挂点不实现——无 resolve 积累不装学习件，YAGNI）
  app.get('/api/predictions/calibration', async () => {
    // ★洞一：域拆分跟着读数一起给。**不改 store 的 ECE 口径**（它按 source_type 分桶是既有契约），
    //   这里额外报一份域拆分，让"这个 ECE 里混了几条人手写的"看得见；看不清就等于没分。
    //   分母 = 与 store.calibration 完全同一条筛选（outcome IN (true,false) ∧ assigned_prob IS NOT NULL），
    //   两处任何一边改了筛选，这个数就会与 ECE 的 n 对不上——故 `by_scope` 之和 == `n` 是硬闸。
    const CALIB_WHERE = "outcome IN ('true','false') AND assigned_prob IS NOT NULL";
    const byScope = scopeCounts(CALIB_WHERE);
    return Object.assign({}, store.calibration(), {
      by_scope: byScope,
      by_scope_total: scopeSum(byScope),
      by_scope_note: '域拆分与本读数的 n 同源同筛（已落定 ∧ 押过数），故 by_scope_total 恒等于 n；'
        + '域口径见 evidence/labBoundary.js（real/lab/external/unknown 四值互斥）。'
        + '人手写的那部分（external）在 by_scope.external 里单列，未被混进同一个读数。',
    });
  });

  /* ══ 洞一（2026-09-28）：`GET /api/predictions/domains` —— 账本按域分组 · 只读披露 ══
   *
   * 【病象（实测）】
   *   `NOT_REAL_GAME_PREDICTION_SQL()` 全仓 grep 的调用点只有 labBoundary 自己的定义/导出
   *   ＋ 两个测试文件；`classifyGame(...).scope` 的生产消费方只有 `intake.js:278` 一处，
   *   且只判 `=== 'real'`。⇒ external 题**不会**被误当成真实局剔掉（安全方向没问题），
   *   但「按域分组、说清其中 N 条是人手写的」这件事**生产代码里没有任何地方在做**：
   *   它们混在未落定清单、校准读数里，和批量灌入的语料题**同栏分不开**。
   *
   * 【先确认现有端点能不能承载（ask 明写的前置）】
   *   能承载一半、不能承载全部，故本端点是**加**不是**换**：
   *     · `/api/predictions/unresolved` 与 `/api/predictions/calibration` 已就地加了 `by_scope`
   *       （这两处就是混得最凶的地方，改它们即可让既有消费方直接拿到拆分）；
   *     · 但**全账本**的域分组、以及"两视图互斥且完备"这个可自校验的守恒量，
   *       既有端点都给不出（unresolved 只覆盖未落定那部分，calibration 只覆盖已落定且押过数那部分），
   *       所以另立这一个只读端点。**不改 predictions 表结构，也不建任何新的读侧表。**
   *
   * 【两条纪律】
   *   ① **只分组，不筛除**。`total` 恒等于账本真实行数，与翻页/视图参数**无关**——
   *      否则「筛掉了 N 条」会被读成「数据没了 N 条」，那是本项目最忌的静默失真。
   *   ② **域口径不在本文件写死**。全部来自 `lab.PREDICTION_SCOPE_SQL`（= `classifyGame` 的 SQL 镜像），
   *      本文件只做计数与措辞；`NOT_REAL_GAME_PREDICTION_SQL` 也由它派生 ⇒ 剔真实局与分域永远一致。
   */
  app.get('/api/predictions/domains', async (req) => {
    const q = (req && req.query) || {};
    const view = (q.view === undefined || q.view === '' || q.view === null) ? 'all' : String(q.view);
    if (DOMAIN_VIEWS.indexOf(view) === -1) {
      throw httpError(400, 'view 必须是 ' + DOMAIN_VIEWS.join('|') + '，收到: ' + JSON.stringify(view));
    }
    const page = pageOpts(q);
    const c = db.getConnection();
    const total = c.prepare('SELECT COUNT(*) AS n FROM predictions').get().n;
    const byScope = scopeCounts();
    // 只读页：列出选中那一栏的题（人话标签 + 域），让人不只看到一个数
    const sql = scopeSql();
    const scopeClause = view === 'hand_written' ? " AND " + sql + " = 'external'"
      : (view === 'other' ? " AND " + sql + " <> 'external'" : '');
    // game_source 同样受 hasSource 约束（缺列时整列不出现在 SELECT 里，否则 500）
    const srcCol = gamesHaveSourceColumn() ? 'g.source' : "NULL";
    const items = c.prepare(
      'SELECT p.id AS id, p.game_id AS game_id, p.statement AS statement, p.layer AS layer,'
      + ' p.created_at AS created_at, p.matures_at AS matures_at, p.resolved_at AS resolved_at,'
      + ' p.outcome AS outcome, g.game_type AS game_type, ' + srcCol + ' AS game_source,'
      + ' ' + sql + ' AS scope'
      + ' FROM predictions p LEFT JOIN games g ON g.id = p.game_id'
      + ' WHERE 1=1' + scopeClause
      + ' ORDER BY p.id DESC LIMIT ? OFFSET ?'
    ).all(page.limit, page.offset);
    for (const it of items) {
      it.view_bucket = view;
      it.scope_label = (SCOPE_TEXT[it.scope] || SCOPE_TEXT.unknown).label;
    }
    const handN = byScope.external;
    return {
      ok: true,
      view: view,
      total: total,
      by_scope: byScope,
      // ★守恒量：四域互斥 ⇒ 各域之和恒等于总数。不是承诺，是每次调用现算的一个数。
      sum_check: { sum: scopeSum(byScope), total: total, ok: scopeSum(byScope) === total },
      by_settled: {
        settled: { n: c.prepare("SELECT COUNT(*) AS n FROM predictions WHERE outcome IN ('true','false')").get().n },
        unsettled: { n: c.prepare('SELECT COUNT(*) AS n FROM predictions WHERE outcome IS NULL').get().n },
      },
      hand_written: Object.assign({
        key: 'hand_written',
        scope: 'external',
        n: handN,
        // ★「这一栏之外还有多少」必须照报。只报这一栏的人会以为账本就这么多题。
        excluded_from_this_view: total - handN,
      }, SCOPE_TEXT.external),
      other: {
        key: 'other',
        n: total - handN,
        excluded_by_domain: { real: byScope.real, lab: byScope.lab, unknown: byScope.unknown },
        note: '这一栏只是**没算进「人手写的」**那一条，一条都没删：账本总数仍是 ' + total + ' 条。',
      },
      items: items,
      page: page,
      disclosure: [
        '账本共 ' + total + ' 条题：其中 ' + handN + ' 条是人手写的（挂在「外部题（容器局 · 非对局）」下，'
          + '那不是一局对局）；其余 ' + (total - handN) + ' 条是批量灌入的语料题、实验场题或真实局里的题。',
        '★本端点只分组，不筛除：账本一条都没删。要按域筛的时候，必须连着「筛掉了多少」一起报。',
        '域口径只有一套（evidence/labBoundary.js 的 classifyGame 及其 SQL 镜像），'
          + '四值互斥：real / lab / external / unknown；求和恒等于总数，可自校验。',
      ],
      discipline: [
        '只读：一次 SELECT 都不写，不改账本任何一列。',
        '域判定不在本端点重写：全部取自 lab.PREDICTION_SCOPE_SQL（= classifyGame 的 SQL 镜像）。',
        '总数与翻页/视图无关：筛掉 N 条不许被读成数据少了 N 条。',
      ],
      l0_gate: store.l0Gate(),
      generated_at: new Date().toISOString(),
    };
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

module.exports = { register, SOURCE_TYPES, OUTCOMES, normalizeResolveSpec };
