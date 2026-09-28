'use strict';
/**
 * p1b/src/evidence/dueBranches.js —— **到期口径的契约分组单一真源**（2026-09-27 · 结算通道欠账告警）
 *
 * 病象（本件存在的理由）：
 *   契约 `g2-contract-frozen-r4.json` 的 `date_derivations` 登记了「每个 kind 的日期从哪个字段、按什么规则推」，
 *   而 `corpus-resolve-daemon.cjs` 的 `dueOf()` 是**另写的一份**手写分支表。两者之间**没有任何断言**。
 *   ⇒ 契约新增一个 kind（换了 `source_key` / 换了粒度），`dueOf` 不跟着改 ⇒ 该 kind 的题**静默落
 *   `undatable`** ⇒ daemon 永不选中 ⇒ **明明有 resolver 也永不结算，且没有任何告警**。
 *   09-27 这轮实测就是这个病：契约 22 个 kind，`dueOf` 只覆盖 14 个，缺口 8 个 kind / 86 条全量行。
 *
 * 修法（为什么是「契约覆盖断言」而不是「例外名单」）：
 *   · 例外名单（KNOWN_UNDATABLE 之类）是**手抄的快照**——它登记的是「今天哪几个没实现」，
 *     而要发现的是「明天多了哪个没实现」。快照登记不了增量 ⇒ 覆盖断言才有效。
 *   · 断言的登记源必须是**不会腐坏的东西**：契约文件本身被 `p1b/test/kind-table.test.cjs`
 *     用 sha256 锁住（比对 `kind-table-latest.json` 与 `docs/specs/kind-目录表.md` 的 `contract_sha256`
 *     是否等于当前契约文件的 sha256）⇒ **谁改契约、谁先打红 kind-table 那条**，本件不必另设哨兵。
 *
 * ★**本件只读契约，绝不写**（`readFileSync` 是本件唯一的 fs 调用；改契约会连带打红两份产物）。
 *
 * 纪律：纯函数式导出 + 不做 db 读取（形制照 `p1b/src/evidence/truthBasis.js:37-43`）。
 */
const fs = require('fs');
const path = require('path');

/** 契约本体路径（只读）。相对本件定位，不依赖 cwd。 */
const CONTRACT_PATH = path.join(__dirname, '..', '..', 'sim', 'out', 'g2-contract-frozen-r4.json');
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
/** `date_derivations`：kind → { source_key, granularity, rule, note? } */
const DATE_DERIVATIONS = CONTRACT.date_derivations || {};

/**
 * 分组主表：`(source_key, granularity)` → 该组全部 kind（字典序）。
 * 键的拼法固定为 `source_key + '/' + granularity`（`DERIV_BY_PAIR` 的键即此串，`PAIRS` 是它的键序列表）。
 * 实测（2026-09-27）：22 个 kind 聚成 9 组 ——
 *   month/monthly×6、year/yearly×4、issue/draw×3、end/daily×2、epiweek/weekly×2、
 *   week_start/weekly×2、period/monthly×1、week_end/daily×1、week/weekly×1。
 * ★**只登记分组，不登记「实现状态」**——实现与否由断言方（`dueOf`）现场判定，见 `UNIMPLEMENTED` 的设计注。
 */
const DERIV_BY_PAIR = (() => {
  const m = {};
  for (const kind of Object.keys(DATE_DERIVATIONS).sort()) {
    const d = DATE_DERIVATIONS[kind] || {};
    const key = String(d.source_key) + '/' + String(d.granularity);
    (m[key] = m[key] || []).push(kind);
  }
  return m;
})();

/** 分组枚举（键序，与 `DERIV_BY_PAIR` 一一对应）。 */
const PAIRS = Object.keys(DERIV_BY_PAIR).sort();

/** 反查：某 kind 属于哪一组；不在契约 `date_derivations` 里则返回 null（不猜）。 */
function pairOf(kind) {
  const d = DATE_DERIVATIONS[String(kind)];
  if (!d) return null;
  return String(d.source_key) + '/' + String(d.granularity);
}

/**
 * ★**未实现登记**：`group` → 原因（人写的，须非空）。
 *
 * 这不是「例外名单」——它的作用是让「已知且已拍板的缺口」显式化，而不是把缺口藏起来：
 * 断言的通过条件是「`dueOf` 能推出来 **或** 该组在此登记了原因」，所以
 *   · 契约**新增**一组没人实现 ⇒ 未登记 ⇒ 断言转红（这正是要抓的增量）；
 *   · 契约**新增**一组且有人登记了原因 ⇒ 绿，但原因摆在明处，评审看得见。
 *
 * ★**登记项刻意不与实现状态挂钩**（有意设计，不是遗漏）：判定顺序是「先探 `dueOf`，探得到就不看登记」，
 *   分支落地后登记项**自动失效**，既不用删、也不会因为「施工方落地了、没顺手删登记」而互相打红。
 *   代价（如实登记）：若某个已实现的分支日后被**删掉**，本断言不会靠这条登记兜住——
 *   那属于「已有分支被回归」，由同文件 ③④ 的逐值断言覆盖，不在本告警的设计射程内。
 */
const UNIMPLEMENTED = {
  // ★2026-09-28：`year/yearly` 原登记在此（「dueOf 无 r.year 分支…落地后本条自动失效」）——
  //   year 分支已补（corpus-resolve-daemon.cjs dueOf，判据与算式照写端口 deriveMaturesAt 逐字同源），
  //   契约覆盖断言 p1b/test/corpus-resolve-dueof.test.cjs ⑧ 已把该组判为 covered。
  //   按本表设计注「登记项刻意不与实现状态挂钩；分支落地后登记项自动失效」——故此处删除，而非留一条失效登记。
  'epiweek/weekly':
    'dueOf 无 MMWR `epiweek`(YYYYWW)→日期折算。★禁凭记忆编日历：须先登记 CDC 公开日历页/可复算规则。',
  'end/daily':
    'dueOf 以 `k === "npm_downloads_window"` 硬卡，`openalex_works_count` 永不命中。'
    + '★该分支尚无交叉验证（openalex 4 条 matures_at 全 NULL），且契约 prose 写「end 原值」而 npm 兄弟现走 end+1d '
    + '⇒ 落地前须拍板 end/daily 组统一走哪条口径（**本轮不改，留作已知风险**）。',
  'week/weekly':
    'dueOf 无 BOM `week`(YYYYWNN)→周日折算（契约 note 记 W37/W40 两锚，rule_status=verified_2026_web）。',
};

module.exports = {
  CONTRACT_PATH,
  DATE_DERIVATIONS,
  DERIV_BY_PAIR,
  PAIRS,
  UNIMPLEMENTED,
  pairOf,
};
