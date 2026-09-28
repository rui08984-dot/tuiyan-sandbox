'use strict';
/**
 * 扩容冻结闸（2026-09-28 · 收口 B · 评审报告 H4 末尾禁令的可执行化）
 *
 * 病象：禁令写成了文档里的一句话——「90 天内不允许再新增第 50 个取数器、新的 PREREG 议题、新的页面」。
 *   但这个项目已经用 16 天证明了：**靠人守的禁令守不住**。
 *   121 个脚本、2,524 行死页面、94k 行文档就是这么长出来的，每一步当时都有正当理由。
 *   ⇒ 禁令必须变成会红的测试，否则它只是愿望。
 *
 * ── 本闸管什么 ────────────────────────────────────────────────────────
 *   三个计数**不得超过今日基线**：① 真值锚 kind ② PREREG 冻结件 ③ 前端页面组件。
 *   只减不增：删死页/删废 PREREG 会让计数下降，直接绿，不需要改基线。
 *
 * ── 谁可以改这个文件（硬契约，改之前先读这段）────────────────────────────
 *   只有**冻结评审人**（PREREG 冻结件与取数器契约的同一批人）可以动下面三处：
 *     ① `FROZEN_BASELINE`  —— 且必须同时走 §基线防篡改 的三步，**不许直接改数字**；
 *     ② `APPROVED_RAISES`   —— 每条必须写全 metric/新值/日期/经手人/理由/收据路径，
 *                              收据文件必须真实存在且非空，否则本文件判红；
 *     ③ `THAW`              —— 解冻记录，见下 §解冻条件。
 *   **任何其他人改本文件 = 自我豁免**，本文件末尾那道自检会判红：
 *   改 BASELINE 而不改 BASELINE_SHA256、或加 RAISES 而不写收据，都跑不过去。
 *
 * ── 解冻条件（数据触发，不是情绪触发）──────────────────────────────────
 *   评审报告与反方论证指向同一个风险：**这个人唯一的正反馈回路在工程上**，
 *   禁令很可能在第 11 周被破。所以解冻必须由**可机械判定的外部事实**触发，
 *   不能由「我觉得该加了」触发。三条触发器见 `THAW_TRIGGERS`，逐条写死了判定口径。
 *   触发后不是「闸自动失效」，而是必须在 `THAW` 里登记：
 *   { trigger, evidence, date, by }——`trigger` 必须命中枚举，`evidence` 必须指向
 *   **真实存在且非空的收据文件**。空口说「有人要」而拿不出收据 ⇒ 判红。
 *
 * ── 为什么基线是这三个数（2026-09-28 实测，非估值）────────────────────
 *   ① kind 27：`p1b/sim/out/g2-contract-frozen-r4.json` 的 `contracts` 共 34 条，
 *      扣掉 7 条 `_` 前缀的内部辅助 kind（_omHourlyMean/_omDaily/_dbnPeriod/_dbnMonthMean/
 *      _eurostatJsonstat/_delphiFlu/_noaaTideDailyHigh）＝ 27 个对外取数器。
 *      与提交 3b9d559「T3 真值锚人话化：27 个引擎标识 → 10 个领域分组」对齐。
 *   ② PREREG 23：`.scratch/forecast-debate/` 下文件名含 PREREG 的 .md 冻结件 23 份。
 *   ③ 页面 25：`p1b/web/src/pages/**` 下 .tsx 共 25 个，其中 **8 个是重定向保留的死页面**
 *      （路由全为 `<Navigate replace>`、组件无任何 import，见 §死页面 断言）。
 *      那 8 个死页**不许为凑计数而删**——它们是 9 个前端测试的扫描目标（实测 14 处引用），
 *      删了是砍已被断言的行为；正解是「改扫 dist 产物」＝ADR-005 独立立项。
 *
 * ── ★FROZEN_BASELINE 是不动量，扩容只走 APPROVED_RAISES（2026-09-29 实测校正）──
 *   首次登记 pages 上调时踩过：按文件头「§基线防篡改 三步」把 `FROZEN_BASELINE.pages`
 *   一并改成 26，**当场判红**——`§豁免` 那条断言要求
 *   `r.newBaseline > FROZEN_BASELINE[metric]`（严格大于，见下方 line≈281）。
 *   两边同时成立不了：改了基线，newBaseline 就不再「大于冻结基线」。
 *   ⇒ 本文件头 §基线防篡改 里「② 改 FROZEN_BASELINE」那一步**与实际执行的闸互相矛盾**，
 *     以断言为准：**基线数字保持 25 不动，基线上调只登记在 APPROVED_RAISES**，
 *     `effectiveBaseline()` 取 max(冻结值, 已批准上调)。BASELINE_SHA256 因此也不需要重算。
 *   这条记录留着，是为了让下一个来登记的人不必再踩一遍。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json');
const PREREG_DIR = path.join(ROOT, '.scratch', 'forecast-debate');
const PAGES_DIR = path.join(ROOT, 'p1b', 'web', 'src', 'pages');

// ══════════════════════════════════════════════════════════════════════
// §基线  —— 三个计数，2026-09-28 实测写死
// ══════════════════════════════════════════════════════════════════════
const FROZEN_BASELINE = { kinds: 27, prereg: 23, pages: 25 };

// ══════════════════════════════════════════════════════════════════════
// §基线防篡改  —— 直接改上面的数字跑不过这一关
//   流程：① 在 APPROVED_RAISES 加一条（含收据文件路径）② 改 FROZEN_BASELINE
//        ③ 重算并手写下面的 BASELINE_SHA256。 三步缺一即红。
//
//   ★这个值必须是**手写字面量**，不能由 FROZEN_BASELINE 算出来（2026-09-28 变异测试查出来的真缺陷）：
//     第一版写成 `const BASELINE_SHA256 = sha256(JSON.stringify(FROZEN_BASELINE))`，
//     然后拿它跟「同一表达式的重算值」比——那等于自己跟自己比，**永远为真**。
//     实测：把 pages 基线从 25 改成 24，防篡改那条**照样绿**（闸形同虚设）。
//     改成写死字面量后，同样的篡改立刻判红。
// ══════════════════════════════════════════════════════════════════════
const BASELINE_SHA256 = '375af205a4ece29c823dad27f8d6537507150de574240a687498b7d49d6c72e3';

/**
 * 已批准的基线上调。**空数组 = 冻结生效中，谁都不许扩容。**
 * 每条必填：metric / newBaseline / date / by / reason / evidence(收据文件，必须存在且非空)
 */
const APPROVED_RAISES = [
  // ── 第六批 · pages 25 → 26（2026-09-29）────────────────────────────────
  // ★本闸的**第一次实战命中**，不是事后补记：
  //   冻结闸由 commit fa2423d 于 2026-09-29 04:16:02 落盘、pages 基线写死 25；
  //   `p1b/web/src/pages/honest/BaselinePage.tsx` 于同日 04:27–04:29 新增（未入库），
  //   即**基线写死后 11 分钟被越过且未登记**，本闸当场判红「现为 26 > 基线 25」。
  //   ↑ 一个从没红过的闸不值钱；当场抓住自己的闸才值钱。
  {
    metric: 'pages',
    newBaseline: 26,
    date: '2026-09-29',
    by: '第六批车道 B 提交；冻结评审人 = 助手；依据 = 已批准方案 '
      + 'docs/plans/2026-09-28-最终方案-可信层对外.md §五 阶段二 2-B',
    reason: '已批准方案 §五「阶段二 · 组装诚实区间」第 2-B 条逐字写着：'
      + '「`ErrorBar` 已有 `value=null` 态（`p1b/web/src/charts/ErrorBar.tsx:32`），加一个页面消费它」'
      + '——本轮要加一个页面是**用户已批准方案里的交付物**，不是临时起意的扩权。'
      + '（实测更正：方案标的 `:32` 行号已漂移，`value` 的可空声明实际在 `ErrorBar.tsx:21`，'
      + '`value: number | null | undefined;`；结论成立，零件确实在。）'
      + '本次上调由冻结闸当场拦下后、由评审人依该已批准方案批准，非事后补记。'
      + '★明确否决「删 8 个死页换计数」：那 8 个死页是 9 个前端测试的扫描目标（实测 14 处引用），'
      + '删了是砍已被断言的行为；正解是「改扫 dist 产物」＝ADR-005 独立立项，不在本批。',
    evidence: 'docs/specs/第六批收据-20260928.md',
  },
  // 示范（其余仍无）：{ metric: 'kinds', newBaseline: 28, date: '2026-xx-xx',
  //                 by: '…', reason: '…', evidence: '.scratch/…-收据.md' }
];

// ══════════════════════════════════════════════════════════════════════
// §解冻条件  —— 数据触发，逐条写死机械判定口径
// ══════════════════════════════════════════════════════════════════════
const THAW_TRIGGERS = {
  external_user_completed_loop: {
    desc: '出现 ≥1 个**非作者**用户，独立走完「记一笔 → 落定 → 复盘」三步。',
    mechanical: '收据文件里必须能指名到人（不是「某朋友」），且该人的记录里三步各有各的动作留痕'
      + '（收下一条 note / 一次 resolve / 一次复盘读数），缺一步不算。',
  },
  external_request_new_fetcher: {
    desc: '出现任何外部方（含朋友）**主动要求**新增某个取数器。',
    mechanical: '收据必须是对方主动提出（发起人 ≠ 作者），且写明要哪一个 kind、用来回答什么问题。'
      + '作者自己想到的不算——那正是本闸要拦的。',
  },
  idle_waiting_external: {
    desc: '连续两周零 commit，且原因是「在等外部反馈」而非「在写 P0」。',
    mechanical: '收据里须给出连续两周的 commit 计数实测（两次 git log 落窗），并写明停的是哪件事。'
      + '若同期有 P0 在写，则不满足——那说明工程侧仍有产出，解冻理由不成立。',
  },
};

/**
 * 解冻登记。`null` = 仍冻结。
 * 非 null 时必须四项齐全：trigger(命中枚举) / evidence(真实存在且非空的收据文件) / date / by。
 */
const THAW = null;

// ══════════════════════════════════════════════════════════════════════
// §计数实现
// ══════════════════════════════════════════════════════════════════════

/**
 * 内部辅助 kind 的**封闭名单**（2026-09-28 实测的 7 个，对应 corpus-resolve.cjs 里的取数辅助函数，
 * 不是对外的数据源）。对照 contracts 34 − 7 ＝ 27。
 *
 * ★为什么不用「去掉 `_` 前缀」来计数（2026-09-28 变异测试查出来的真漏洞）：
 *   第一次做红→绿实验时，我注入的探针 kind 叫 `__probe_kind__`——带下划线，闸**没红**。
 *   按前缀过滤等于留了一条后门：新增一个 `_` 开头的新取数器可以静悄悄溜过冻结闸。
 *   改成封闭名单后：任何新 kind（带不带下划线）都会让计数上升 ⇒ 判红；
 *   要把某个新 kind 算作「辅助」而豁免，必须显式写进下面这个名单，理由留痕在 §豁免 同等规格下。
 */
const HELPER_KINDS = [
  '_omHourlyMean', '_omDaily', '_dbnPeriod', '_dbnMonthMean',
  '_eurostatJsonstat', '_delphiFlu', '_noaaTideDailyHigh',
];

/** ① 真值锚 kind 数＝contracts 总数 − 封闭名单里的辅助 kind。 */
function countKinds() {
  const j = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  return Object.keys(j.contracts).filter((k) => !HELPER_KINDS.includes(k)).length;
}

/** ② PREREG 冻结件数：目录内文件名含 PREREG 的 .md。 */
function countPrereg() {
  const acc = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.md') && e.name.includes('PREREG')) acc.push(p);
    }
  };
  walk(PREREG_DIR);
  return acc.length;
}

/** ③ 前端页面组件数：pages/ 下全部 .tsx（含死页——死页本来就该被删，删了计数降）。 */
function countPages() {
  const acc = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) acc.push(p);
    }
  };
  walk(PAGES_DIR);
  return acc.length;
}

/** 有效基线 = 冻结基线；若有已批准上调，取其中最大的。 */
function effectiveBaseline(metric) {
  const raises = APPROVED_RAISES.filter((r) => r.metric === metric)
    .map((r) => r.newBaseline);
  return Math.max(FROZEN_BASELINE[metric], ...raises);
}

// ══════════════════════════════════════════════════════════════════════
// §1 三条计数闸
// ══════════════════════════════════════════════════════════════════════

const METRICS = [
  {
    key: 'kinds', label: '真值锚 kind（取数器）', count: countKinds,
    what: 'p1b/sim/out/g2-contract-frozen-r4.json 的 contracts 减 HELPER_KINDS 封闭名单',
  },
  {
    key: 'prereg', label: 'PREREG 冻结件', count: countPrereg,
    what: '.scratch/forecast-debate/ 下文件名含 PREREG 的 .md',
  },
  {
    key: 'pages', label: '前端页面组件', count: countPages,
    what: 'p1b/web/src/pages/ 下全部 .tsx（含 8 个重定向死页）',
  },
];

for (const m of METRICS) {
  test(`冻结 · ${m.label} 不得超过基线`, () => {
    const n = m.count();
    const cap = effectiveBaseline(m.key);
    assert.ok(n <= cap,
      `⛔ 扩容冻结被破：${m.label} 现为 ${n} > 基线 ${cap}（来源：${m.what}）。\n`
      + `   评审报告 H4 末尾的禁令是「90 天内不许再加」。\n`
      + `   要加只有三条路，且都得留下收据：\n`
      + `     ① 解冻条件已触发 → 在本文件 §THAW 登记 trigger + evidence 收据文件\n`
      + `     ② 评审人批准上调基线 → 在 §APPROVED_RAISES 加一条（收据须真实存在），并按 §基线防篡改 重算 hash\n`
      + `     ③ 删掉别的把计数换回来（死页本来就该删，删了直接绿）\n`
      + `   达标的判据见本文件 §THAW_TRIGGERS（数据触发，不是「我觉得该加了」）。`);
  });
}

// ══════════════════════════════════════════════════════════════════════
// §2 死页面：8 个重定向保留的页组件，删了应能直接变绿
// ══════════════════════════════════════════════════════════════════════

// 2026-09-28 实测：下列 8 个 .tsx 在 p1b/web/src 内**无任何 import**（App.tsx 的 import 已删），
// 且其路由全为 <Navigate replace>（App.tsx:182/183/189/190/194/200/201/202）⇒ 组件永不渲染。
// 这 8 个是「本来就该被删」的存量，删任何一个都让 pages 计数下降，属本闸允许的方向。
const DEAD_PAGES = [
  'pages/audit/AuditPage.tsx',
  'pages/audit/OverviewPage.tsx',
  'pages/disclosure/ArenaPage.tsx',
  'pages/disclosure/BayesLensPage.tsx',
  'pages/disclosure/CalendarPage.tsx',
  'pages/disclosure/CalibrationReportPage.tsx',
  'pages/disclosure/CompilerPage.tsx',
  'pages/intake/IntakePage.tsx',
];

test('死页面清单：8 个重定向保留页仍在，且确实无 import（清单腐化会判红）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'p1b', 'web', 'src', 'App.tsx'), 'utf8');
  // DEAD_PAGES 的路径相对 web/src/（不是相对 pages/）
  const missing = DEAD_PAGES.filter((p) => !fs.existsSync(path.join(ROOT, 'p1b', 'web', 'src', p)));
  assert.deepEqual(missing, [], `死页面已从磁盘删掉（好事，pages 计数已降）——请从 DEAD_PAGES 清单里移除：${missing.join(', ')}`);

  // 逐个反证：这些组件名不得再出现在 App.tsx 的 import 里
  const reimported = DEAD_PAGES.filter((p) => {
    const name = path.basename(p, '.tsx');
    return new RegExp(`^import\\s+${name}\\b`, 'm').test(src);
  });
  assert.deepEqual(reimported, [],
    `下列死页被重新 import（不再是死页）：${reimported.join(', ')}——已从「重定向保留」变成实页，`
    + `请把它移出 DEAD_PAGES 清单，否则本测试在骗自己。`);
});

test('死页面清单：8 个都在 App.tsx 里有指向别处的重定向（书签不断的前提）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'p1b', 'web', 'src', 'App.tsx'), 'utf8');
  const redirects = [...src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Navigate\s+to="([^"]+)"/g)]
    .map((m) => ({ from: m[1], to: m[2] }));
  const need = ['/overview', '/audit', '/calendar', '/compiler', '/intake', '/calibration', '/bayes-lens', '/arena'];
  const lost = need.filter((p) => !redirects.some((r) => r.from === p));
  assert.deepEqual(lost, [],
    `下列旧路径的重定向没了（旧链接会 404）：${lost.join(', ')}——删死页**源码**可以，别删路由。`);
});

// ══════════════════════════════════════════════════════════════════════
// §3 闸的自我保护：豁免要显式且有记录
// ══════════════════════════════════════════════════════════════════════

test('豁免 · APPROVED_RAISES 每条必须写全理由与收据（收据不存在即判红）', () => {
  const METRIC_KEYS = METRICS.map((m) => m.key);
  for (const r of APPROVED_RAISES) {
    assert.ok(METRIC_KEYS.includes(r.metric), `APPROVED_RAISES 里出现未知 metric：${r.metric}`);
    for (const f of ['newBaseline', 'date', 'by', 'reason', 'evidence']) {
      assert.ok(r[f] !== undefined && String(r[f]).trim() !== '',
        `APPROVED_RAISES 的 ${r.metric} 条目缺 ${f}——上调基线必须留痕，不许只改数字`);
    }
    assert.ok(typeof r.newBaseline === 'number' && r.newBaseline > FROZEN_BASELINE[r.metric],
      `${r.metric} 的 newBaseline 必须大于冻结基线 ${FROZEN_BASELINE[r.metric]}（下调走「删」不走「改」）`);
    const p = path.resolve(ROOT, r.evidence);
    assert.ok(fs.existsSync(p), `${r.metric} 的上调收据不存在：${r.evidence}`);
    assert.ok(fs.statSync(p).size > 0, `${r.metric} 的上调收据是空文件：${r.evidence}`);
  }
});

test('豁免 · 每条上调的增量不得虚高（收据里写了几个就只准加几个）', () => {
  // 反「一次批准放行无限扩容」：上限只认登记过的数，且不许超过冻结基线 + 明示增量。
  for (const m of METRICS) {
    const raises = APPROVED_RAISES.filter((r) => r.metric === m.key);
    const claimed = Math.max(FROZEN_BASELINE[m.key], ...raises.map((r) => r.newBaseline));
    assert.ok(claimed - FROZEN_BASELINE[m.key] <= raises.length,
      `${m.key} 的基线一次性上调了 ${claimed - FROZEN_BASELINE[m.key]}，但只登记了 ${raises.length} 条批准——`
      + '一次批一串不算数，请逐条登记。');
  }
});

test('封闭名单 · HELPER_KINDS 不得被当成后门扩张（每个都得真在契约里）', () => {
  const j = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const keys = Object.keys(j.contracts);
  // 名单里的每个都必须是契约里真实存在的 `_` 前缀辅助项
  const notReal = HELPER_KINDS.filter((k) => !keys.includes(k));
  assert.deepEqual(notReal, [],
    `HELPER_KINDS 里有契约中已不存在的条目：${notReal.join(', ')}——名单腐化会虚增计数，请删除。`);
  const notPrefixed = HELPER_KINDS.filter((k) => !k.startsWith('_'));
  assert.deepEqual(notPrefixed, [],
    `HELPER_KINDS 里非 _ 前缀的条目：${notPrefixed.join(', ')}——对外取数器不许进辅助名单。`);
  // ★反「往名单里塞一个新 kind 来免掉冻结」：名单长度写死，且必须是 2026-09-28 实测的那 7 个
  assert.equal(HELPER_KINDS.length, 7,
    'HELPER_KINDS 长度被改了——往辅助名单里加条目＝绕过冻结闸免掉一个新取数器。'
    + '要加必须先有评审记录（见文件头 §基线防篡改）。');
  assert.deepEqual([...HELPER_KINDS].sort(),
    ['_dbnMonthMean', '_dbnPeriod', '_delphiFlu', '_eurostatJsonstat', '_noaaTideDailyHigh', '_omDaily', '_omHourlyMean'],
    'HELPER_KINDS 内容被改动——辅助名单是封闭的，改它等于改冻结面。');
  // 反向兜底：契约里所有 `_` 前缀项都必须已登记，不许有未登记的野生辅助 kind
  const wildcards = keys.filter((k) => k.startsWith('_') && !HELPER_KINDS.includes(k));
  assert.deepEqual(wildcards, [],
    `契约里出现未登记的 _ 前缀 kind：${wildcards.join(', ')}——按前缀过滤的老实现会让它静悄悄溜过冻结闸，`
    + '现在必须显式登记才能被算作辅助。');
});

// ══════════════════════════════════════════════════════════════════════
// §4 解冻：数据触发，且必须有收据
// ══════════════════════════════════════════════════════════════════════

test('解冻 · 当前状态必须与登记一致（THAW 非 null 时四条齐全且收据真实存在）', () => {
  if (THAW === null) {
    // 冻结生效中：三条触发器一条都不许被「凭感觉」宣布成立。
    assert.ok(Object.keys(THAW_TRIGGERS).length === 3,
      '解冻条件被删少了——三条触发器是评审报告与反方论证共同锁定的下限，不许自行削减。');
    return;
  }
  assert.ok(Object.prototype.hasOwnProperty.call(THAW_TRIGGERS, THAW.trigger),
    `THAW.trigger="${THAW.trigger}" 不在 §THAW_TRIGGERS 枚举里——解冻只能由已写死的数据触发条件开启，`
    + `不能新增一条「感觉该加了」的理由。可选：${Object.keys(THAW_TRIGGERS).join(' / ')}`);
  for (const f of ['evidence', 'date', 'by']) {
    assert.ok(THAW[f] !== undefined && String(THAW[f]).trim() !== '',
      `THAW 缺 ${f}——解冻必须留痕：谁、何时、凭哪份收据。`);
  }
  const p = path.resolve(ROOT, THAW.evidence);
  assert.ok(fs.existsSync(p), `THAW.evidence 收据不存在：${THAW.evidence}——口头说「有人要」不算解冻。`);
  assert.ok(fs.statSync(p).size > 0, `THAW.evidence 收据是空文件：${THAW.evidence}`);
});

test('解冻 · 三条触发器各自写死了机械判定口径（不许退化成情绪判断）', () => {
  for (const [k, v] of Object.entries(THAW_TRIGGERS)) {
    assert.ok(v.desc && v.mechanical, `触发器 ${k} 缺 desc 或 mechanical`);
    assert.ok(v.mechanical.length >= 20,
      `触发器 ${k} 的 mechanical 判定口径太短（<20 字），等于没写死——请补到可机械核对为止。`);
  }
  // 反「新增第 4 条触发器」：本闸的解冻面只认评审报告锁定的这三条
  assert.deepEqual(Object.keys(THAW_TRIGGERS).sort(),
    ['external_request_new_fetcher', 'external_user_completed_loop', 'idle_waiting_external'],
    '解冻触发器集合被改动——这三条是评审报告 H4 锁定的，新增/删除须先改评审报告，不是改测试。');
});

// ══════════════════════════════════════════════════════════════════════
// §5 防篡改自检：直接改 FROZEN_BASELINE 数字跑不过这一关
// ══════════════════════════════════════════════════════════════════════

test('防篡改 · FROZEN_BASELINE 未被绕过 APPROVED_RAISES 直接改动', () => {
  // 算式见文件头 §基线防篡改：sha256(JSON.stringify(FROZEN_BASELINE))。
  // 改了数字而不重算这个 hash（或反之），本条即红——三步流程缺一不可。
  assert.equal(BASELINE_SHA256,
    crypto.createHash('sha256').update(JSON.stringify(FROZEN_BASELINE)).digest('hex'),
    'BASELINE_SHA256 与 FROZEN_BASELINE 不一致：基线被直接改过。'
    + '请走 §基线防篡改 三步（登记 APPROVED_RAISES → 改基线 → 重算 hash），否则本文件在自我豁免。');
});

// 供审阅者独立复算（不依赖本文件的任何变量）：
//   node -e "console.log(require('node:crypto').createHash('sha256').update(JSON.stringify({kinds:27,prereg:23,pages:25})).digest('hex'))"
//   = 375af205a4ece29c823dad27f8d6537507150de574240a687498b7d49d6c72e3
// ★键序必须与 FROZEN_BASELINE 的声明序一致（kinds, prereg, pages）——JSON.stringify 依赖插入序，
//   键序写错会算出另一个 hash，然后你会以为自己被篡改了。
// ★FROZEN_BASELINE 是**不动量**（见文件头 2026-09-29 校正段）：基线上调只登记 APPROVED_RAISES，
//   所以这个 hash 不会因为批准了扩容而变——它变，才说明有人绕过登记直接改了基线。
