'use strict';
/**
 * p1b/src/routes/baseline.js —— 「诚实区间」只读端点（2026-09-29 · 只给区间不给点估计那一轮）。
 *
 * GET /api/baseline/:kind → 200
 *   { ok, kind, state, n, k, enough, interval:[lo,hi]|null, point_estimate:number|null,
 *     coverage_guarantee:string|null, reason, engine_note, method, counts, discipline, generated_at }
 *
 * 【本端点要解决的产品形态】
 *   用户问「某件事会不会发生」时，系统**要么给一个数、要么明说给不了并给出保证覆盖的区间**——
 *   不假装精确。而「要不要一个数」这个选择**不归系统决定**：端点两个都给（能给才给），
 *   页面提供两个出口（严格＝只看区间／给基率＝也看那个数），默认走「严格」。
 *
 * 【★口径单一真源：区间与点估计全部由 l2_baseline 出，本文件不自己算】
 *   `require('../engines/l2_baseline')` 的 MIN_N=30 与 Wilson 区间是本项目的地基
 *   （引擎头注纪律 ②：n<30 一律不出 p、不出区间）。
 *   本文件做的事只有一件：把账本里同类已结算的题**照 0/1 序列**喂给它，然后把它的读数原样搬出来。
 *   ⇒ 换句话说 n 与 k 也是**引擎从序列里数出来的**，不是本文件另算一遍。
 *   ⚠ 另写一套 Wilson = 与 `l2_baseline.js:31-39` 分叉，本项目已经吃过"两份读序"亏，不要。
 *
 * 【三态照 `predictionsStore.maturityState`（due / not_due / no_due_date）的写法】
 *   `enough`   n ≥ MIN_N → 给区间；点估计**允许**给（页面上由用户选要不要看）。
 *   `too_thin` 0 < n < MIN_N → **既不给点估计也不给区间**，reason 说清「只能记方向」。
 *   `no_rows`  n = 0 → 「账本里一道这种题都没有」。
 *   ★后两者是**两件不同的事，不许说成同一句**：那边是"账本上有、但太少"，
 *     这边是"账本上根本没这一类"。合成一句话 = 把"没数据"读成"数据不够"，
 *     而这两件事对人意味着完全不同的下一步（一个等样本，一个去出题）。
 *   第三态为什么单列（照 maturityState 的理由）：第三态是真实存在的一整类题，
 *     把它并进第二态，界面就会对着一类根本没问过的题说"样本不足，不足 30"——那句话对它是假的。
 *
 * 【分母口径：什么算一道「同类已结算」的题】
 *   · 同类＝`json_extract(evidence_json,'$[0].resolve.kind')` 相同
 *     （与 `routes/predictions.js:89,419,467` 及 `evidence/resolveKind.js:7` 逐字同款检索式；
 *      kind 支持表**不在此校验**——查不到就是 no_rows，那才是真答案，不是 400）。
 *   · 已结算＝`resolved_at IS NOT NULL AND outcome IN ('true','false')`：
 *     没揭晓的题不进分母（把"还没到期的题"算进样本会让人以为已经有答案了，
 *     同 `routes/disclosure.js` 同款口径）。
 *   · 剔重言题（`tautology=1`）：恒定结果题对频率无信息量
 *     （同 `predictionsStore.l0Gate` 的「重言式题不计入门禁」理由）。
 *   · 剔真值口径缺陷行：真值取自事件发生**之前**的预报值，剔出来自
 *     `evidence/truthBasis.js` 的 `NOT_TRUTH_BASIS_DEFECT_SQL()`（该文件是判定单一真源，此处只调用）。
 *   ★以上剔除**全部如实计数**（counts.*），不许静默吞题——同 disclosure 页的披露纪律。
 *
 * 【禁词】面向用户的说明句（reason / coverage_guarantee / discipline）禁出现某两个字，
 *   同 `test/audit-kpi.test.cjs:35` 与 QuestionPage 的披露纪律。
 *
 * 【纯只读】只有 SELECT，不改账本任何一列，零 LLM、零网络、零引擎重跑；additive：既有端点零改动。
 */
const { db } = require('../deps');
const { l2Baseline, MIN_N, Z_95 } = require('../engines/l2_baseline');
const truthBasis = require('../evidence/truthBasis');
const { requireNonEmptyString } = require('../util'); // kind 空白 ⇒ 400（它自己抛 httpError）

/** 已结算且真值可判（true/false）的集合条件——「分母」的第一道门。 */
const SETTLED_SQL = "p.resolved_at IS NOT NULL AND p.outcome IN ('true','false')";

/** 真值口径缺陷的**非**谓词（单一真源：evidence/truthBasis.js）。 */
const NOT_DEFECT = truthBasis.NOT_TRUTH_BASIS_DEFECT_SQL();

/** 进分母的条件（**不含 kind 占位**）：已结算 ∧ 非重言 ∧ 真值口径正常。
 *  计数与序列两处共用它，kind 的 `?` 只在各自 SQL 里各写一次——
 *  共用带占位的那一串会让同一条 SQL 出现两个 `?`，少传一个就报 "Too few parameter values"。 */
const USABLE_WHERE = SETTLED_SQL + ' AND COALESCE(p.tautology, 0) = 0 AND ' + NOT_DEFECT;

/** 进分母的完整条件（含 kind 占位）：同类 ∧ 已结算 ∧ 非重言 ∧ 真值口径正常。 */
const USABLE_SQL = "json_extract(p.evidence_json,'$[0].resolve.kind') = ? AND " + USABLE_WHERE;

/**
 * 计数与序列各一次 SELECT：计数用于**如实披露剔了多少**，
 * 序列（0/1）喂引擎——引擎从序列里数出 n 与 k，本文件不另算。
 */
function readClass(kind) {
  const conn = db.getConnection();
  const c = conn.prepare(
    'SELECT COUNT(*) AS total,'
    + ' SUM(CASE WHEN ' + SETTLED_SQL + ' THEN 1 ELSE 0 END) AS settled,'
    + ' SUM(CASE WHEN COALESCE(p.tautology, 0) = 1 THEN 1 ELSE 0 END) AS taut,'
    + ' SUM(CASE WHEN ' + SETTLED_SQL + ' AND NOT ' + NOT_DEFECT + ' THEN 1 ELSE 0 END) AS defect,'
    + ' SUM(CASE WHEN ' + USABLE_WHERE + ' THEN 1 ELSE 0 END) AS usable'
    + ' FROM predictions p WHERE json_extract(p.evidence_json,\'$[0].resolve.kind\') = ?'
  ).get(kind);
  const outcomes = conn.prepare('SELECT p.outcome AS o FROM predictions p WHERE ' + USABLE_SQL + ' ORDER BY p.id').all(kind);
  return {
    counts: {
      rows_total: c ? Number(c.total) || 0 : 0,
      settled: c ? Number(c.settled) || 0 : 0,
      excluded_tautology: c ? Number(c.taut) || 0 : 0,
      excluded_truth_basis: c ? Number(c.defect) || 0 : 0,
      excluded_unsettled: 0, // 下面按差值回填（total − settled），避免再查一次
    },
    history: outcomes.map((r) => r.o === 'true'),
  };
}

/**
 * 覆盖保证文案。**只在真的有区间时给**——没有区间就没有「盖住」的承诺可说，
 * 硬凑一句就是凭空给一个保证（比不给更坏）。
 */
function coverageText() {
  // ★纯文本（不带 markdown 标记）：这段字是直接上屏的，`**` 会原样显出来。
  return 'Wilson score 区间，置信水平 95%（z=' + Z_95 + '）。'
    + '它保证的是「抽样过程」：同一类题反复抽同样多次，100 次里大约 95 次这样的区间会盖住真实发生比例。'
    + '它不保证这一道题——这一道题的答案仍然可能落在区间之外，那不是区间算错了。';
}

/**
 * 三态判定（纯函数，导出供单测直接打）。写法照 `predictionsStore.maturityState`：
 * 每态都自带一句人话 `why`，且**三句互不相同**。
 * @param {{n:number|null, k:number|null}} eng l2Baseline 的读数（n 由引擎从序列数出）
 */
function enoughState(eng) {
  const n = Number(eng && eng.n) || 0;
  const k = eng && eng.k !== undefined && eng.k !== null ? Number(eng.k) : null;
  if (n >= MIN_N) {
    return {
      state: 'enough',
      why: '同类已结算 ' + n + ' 条，其中 ' + (k === null ? '—' : k) + ' 条真的发生了。'
        + '样本过了 ' + MIN_N + ' 的准入线 ⇒ 给区间；点估计也给，但要不要看由你在界面上选。',
    };
  }
  if (n > 0) {
    return {
      state: 'too_thin',
      why: '同类只有 ' + n + ' 条，不足 ' + MIN_N + '，只能记方向。'
        + '这一类既不给区间也不给数——' + n + ' 条里发生 ' + (k === null ? '若干' : k) + ' 条，'
        + '拿它当结论就是把随机当信号。',
    };
  }
  return {
    state: 'no_rows',
    why: '账本里一道这种题都没有——同类真值出来过的题是 0 条。'
      + '这跟"有若干条但不足 ' + MIN_N + '"是两件事：那边是账本上有、这边是账本上根本没落过这一类，'
      + '所以眼下连"方向"都无从记起（先出一道这种题，账本里才会有同类可比）。',
  };
}

/** 组装读数（纯函数，导出供单测直接打）。 */
function buildReading(kind, eng) {
  const st = enoughState(eng);
  const enough = st.state === 'enough';
  return {
    ok: true,
    kind: kind,
    state: st.state,
    n: Number(eng.n) || 0,
    k: eng.k === undefined ? null : eng.k,
    enough: enough,
    // ★两个出口读的是**同一个**字段：n<30 时它恒为 null，
    //   于是"严格"和"给基率"两个出口在薄样本上**同时**拿不到点估计——
    //   「这是基率不是判断」不构成给得出去的理由，那只是绕过纪律的话术。
    point_estimate: enough ? eng.p : null,
    interval: enough ? eng.ci : null,
    coverage_guarantee: enough ? coverageText() : null,
    method: eng.method,
    source: eng.source,
    reason: st.why,
    engine_note: eng.note, // 引擎原话照登，不加工（本端点的话与引擎的话都摆在明面上）
  };
}

function register(app) {
  app.get('/api/baseline/:kind', async (req) => {
    const kind = requireNonEmptyString('kind', req.params.kind === undefined ? '' : String(req.params.kind));
    const { counts, history } = readClass(kind);
    // ★n 与 k 都由引擎从序列里数出来（l2Baseline 的 history 分支），本文件不另算一遍。
    const eng = l2Baseline({ history: history });
    counts.excluded_unsettled = counts.rows_total - counts.settled;
    const reading = buildReading(kind, eng);
    return Object.assign(reading, {
      counts: counts,
      discipline: [
        '区间与点估计全部由 engines/l2_baseline.js 出（Wilson score，95%），本端点不自己算区间；'
          + 'n 与 k 也是引擎从 0/1 序列里数出来的。',
        'n<' + MIN_N + ' 一律不出点估计、不出区间——界面上的两个出口在薄样本上同时拿不到数。',
        '没揭晓的题不进分母（把还没到期的题算进样本，会让人以为已经有答案了）。',
        '重言题与真值口径缺陷行剔出分母，剔了多少在 counts 里如实报出，不静默吞题'
          + '（两个计数各自独立，一行可能同时中两条，所以它们不保证相加等于 rows_total）。',
        '本端点只读：只有 SELECT，账本一行都不会被它改。',
        'kind 不在支持表里也照常查——查不到就是 no_rows（真答案），不是报错。',
      ],
      generated_at: new Date().toISOString(),
    });
  });
}

module.exports = { register, readClass, enoughState, buildReading, coverageText, MIN_N };
