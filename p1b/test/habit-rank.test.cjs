'use strict';
/**
 * p1b/test/habit-rank.test.cjs —— 「你在哪类事上偏」抽成共享模块后的**回归锁**（2026-09-30）
 *
 * 【这次动的是什么】
 *   归并（按域聚合、只取够样本的格、按 |偏差| 降序）此前**只活在一个 React 组件里**：
 *   p1b/web/src/pages/WhereOffPage.tsx 的 `habits` useMemo（抽取前是 :224-236，git HEAD 可查）。
 *   后端零命中 ⇒ 全项目最核心的那个价值没有可被调用的接口。
 *   ⇒ 判据搬到 p1b/src/disclosure/habitRank.mjs（纯计算、零副作用），
 *     新增只读端点 GET /api/disclosure/habits，网页改为 import 同一份。
 *
 * 【本闸守的是"抽取没顺手改语义"】
 *   判据一行都不许改，所以**唯一能防住"搬家时顺手优化"的，是金样**：
 *     · BEFORE —— 抽取前那段代码的**逐字副本**（下面 BEFORE_SRC，出处见其上注释），
 *       每次跑都真跑一遍，逐字段跟抽出来的结果比；
 *     · GOLDEN —— 当初从 BEFORE 的输出**抓下来钉死**的字面量，
 *       这样连"两份实现一起改错了"也躲不过（BEFORE 被改坏时它会红）。
 *   只做前者（两份实现互相对比）是不够的：一起改错就一起绿。
 *
 * 【n<30 纪律】
 *   样本不够的格只记方向、不给比例。归并里它们**不进 ok/d**，
 *   一个够样本的格都没有的域**整域剔除**（不是排到最后一名）。
 *   端点另把被剔的域如实回在 dropped_domains 里，且那里**没有任何比例字段**。
 *
 * 【零副作用】纯计算：不读文件、不读库、不碰网络；连入参都不许改（见 ⑧）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD_PATH = path.join(ROOT, 'p1b', 'src', 'disclosure', 'habitRank.mjs');
const DTS_PATH = path.join(ROOT, 'p1b', 'src', 'disclosure', 'habitRank.d.mts');
const PAGE_PATH = path.join(ROOT, 'p1b', 'web', 'src', 'pages', 'WhereOffPage.tsx');

const { rankHabits, habitBuckets, HABIT_RANK_BASIS } = require(MOD_PATH);

/* ══ BEFORE：抽取前那份实现的逐字副本 ══════════════════════════════════════════
 * 出处：git HEAD 的 p1b/web/src/pages/WhereOffPage.tsx 第 224-236 行
 *   （`const habits = useMemo(() => { … }, [cells]);`，2026-09-30 抽取**前**）。
 * ★为什么抄在这里而不是回头去 git 取：仓里已经没有这份代码了（组件里删了），
 *   金样必须活得比那次提交久。而抄一份就等于"可以自己改"——所以下面 ② 除了跟它比，
 *   还要跟 GOLDEN（当初从它抓下来的字面量）比；它被改坏时 GOLDEN 会先红。 */
const BEFORE_SRC = `
  function BEFORE(cells) {
    const by: Record<string, { n: number; ok: number; d: number; cnt: number }> = {};
    for (const c of cells) {
      if (c.delta_vs_half === null) continue;
      const b = (by[c.domain] = by[c.domain] || { n: 0, ok: 0, d: 0, cnt: 0 });
      b.n += c.scored_n; b.cnt += 1;
      if (c.conclusion_allowed) { b.ok += 1; b.d += c.delta_vs_half; }
    }
    return Object.entries(by)
      .filter(([, b]) => b.ok > 0)
      .map(([domain, b]) => ({ domain, n: b.n, ok: b.ok, delta: b.d / b.ok }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
`;
// 唯一一处改写：剥掉 TypeScript 的类型标注（运行期无影响）。剥不掉就当场红，
// 绝不"没剥成功也照样跑"——那会让 BEFORE 悄悄变成另一份代码。
const TS_ANNOT = 'const by: Record<string, { n: number; ok: number; d: number; cnt: number }> = {};';
function buildBefore() {
  assert.ok(BEFORE_SRC.includes(TS_ANNOT), '★前置：BEFORE 源里的类型标注不见了（副本被改动过？）');
  const js = BEFORE_SRC.replace(TS_ANNOT, 'const by = {};') + '\nreturn BEFORE;';
  return new Function(js)();
}
const BEFORE = buildBefore();

/* ══ 夹具：判据 ①-⑤ 每条至少一格对应 ═══════════════════════════════════════════
 * 逐条对应关系（抽出来的模块与 BEFORE 都要在这上面给出同样的结果）：
 *   ① delta_vs_half === null 的格整格不计（n 也不进，连桶都不建） → ghostnull
 *   ② 只加 conclusion_allowed 的格进 ok/d                          → 每个 ok=true 的格
 *   ③ 一个够样本的格都没有 ⇒ 整域不进榜                            → allthin
 *   ④ n 加的是**全部**非 null 格（含薄格）                           → energycharts / noaa 各带一格薄格
 *   ⑤ |delta| 相同者按入列先后（排序稳定）                            → tie_a / tie_b
 *   另：正负号都要有（页面据此写「报大了 / 报小了」）。 */
const CELLS = [
  { layer: 'L2', domain: 'ghostnull', scored_n: 999, conclusion_allowed: true, delta_vs_half: null },
  { layer: 'L2', domain: 'energycharts', scored_n: 99, conclusion_allowed: true, delta_vs_half: -0.01429365480943448 },
  { layer: 'L2', domain: 'energycharts', scored_n: 12, conclusion_allowed: false, delta_vs_half: 0.4 },
  { layer: 'L3', domain: 'noaa', scored_n: 52, conclusion_allowed: true, delta_vs_half: -0.0373652483814616 },
  { layer: 'L3', domain: 'noaa', scored_n: 7, conclusion_allowed: false, delta_vs_half: 0.5 },
  { layer: 'L6', domain: 'allthin', scored_n: 11, conclusion_allowed: false, delta_vs_half: 0.5 },
  { layer: 'L1', domain: 'tie_a', scored_n: 30, conclusion_allowed: true, delta_vs_half: -0.05 },
  { layer: 'L1', domain: 'tie_b', scored_n: 30, conclusion_allowed: true, delta_vs_half: -0.05 },
  { layer: 'L1', domain: 'werewolf_sim', scored_n: 180, conclusion_allowed: true, delta_vs_half: -0.25 },
  { layer: 'L4', domain: 'frankfurter', scored_n: 36, conclusion_allowed: true, delta_vs_half: 0.014455893204366688 },
  { layer: 'L5', domain: 'dbnomics', scored_n: 79, conclusion_allowed: true, delta_vs_half: -0.000016379875519112463 },
  { layer: 'L6', domain: 'wikimedia', scored_n: 43, conclusion_allowed: true, delta_vs_half: -0.033191376081418617 },
];

/* ══ GOLDEN：抽取前实现的输出，当场抓下来钉死（2026-09-30）═══════════════════════ */
const GOLDEN = [
  { domain: 'werewolf_sim', n: 180, ok: 1, delta: -0.25 },
  { domain: 'tie_a', n: 30, ok: 1, delta: -0.05 },
  { domain: 'tie_b', n: 30, ok: 1, delta: -0.05 },
  { domain: 'noaa', n: 59, ok: 1, delta: -0.0373652483814616 },
  { domain: 'wikimedia', n: 43, ok: 1, delta: -0.033191376081418617 },
  { domain: 'frankfurter', n: 36, ok: 1, delta: 0.014455893204366688 },
  { domain: 'energycharts', n: 111, ok: 1, delta: -0.01429365480943448 },
  { domain: 'dbnomics', n: 79, ok: 1, delta: -0.000016379875519112463 },
];

// ── ① 前置：夹具与金样非空，且夹具真的覆盖了五条判据（防空集假通过）────────────
test('① 前置：夹具非空、五条判据逐条有格、金样非空', () => {
  // 三方共用一份口径的三个落点都在（端点在本文件里测；页面与端点的同源由前端道
  // p1b/web/src/pages/habit-rank-wiring.test.mjs ④ 钉）。这里先钉住文件都在。
  for (const p of [MOD_PATH, DTS_PATH, PAGE_PATH]) {
    assert.ok(fs.existsSync(p), '★前置：缺文件 ' + p);
  }
  assert.equal(CELLS.length, 12, '夹具格数变了（新增/删除请同步更新覆盖表）');
  assert.ok(GOLDEN.length > 0, '金样是空的 ⇒ 下面的比对照样跑 0 行');
  const 覆盖 = {
    '① delta 为 null 的格': CELLS.filter((c) => c.delta_vs_half === null).length,
    '② 够样本的格': CELLS.filter((c) => c.conclusion_allowed).length,
    '③ 整域无够样本格': CELLS.filter((c) => c.domain === 'allthin').length,
    '④ 薄格（进 n、不进 ok）': CELLS.filter((c) => !c.conclusion_allowed && c.delta_vs_half !== null).length,
    '⑤ |delta| 相同的两个域': CELLS.filter((c) => c.domain === 'tie_a' || c.domain === 'tie_b').length,
  };
  for (const [判据, 命中] of Object.entries(覆盖)) {
    assert.ok(命中 > 0, '★夹具没覆盖' + 判据 + ' —— 这条判据本闸就没人测');
  }
  assert.ok(BEFORE(CELLS).length > 0, '★BEFORE 在夹具上返回空 ⇒ 下面的比对照样跑 0 行');
  assert.equal(rankHabits(CELLS).length, GOLDEN.length, '抽出来的行数与金样行数不同');
});

// ── ② ★★金样：抽出来的结果与抽之前**逐字段**相同 ───────────────────────────────
test('② ★★金样：rankHabits 与抽取前实现逐字段相同，且与钉死的字面量相同', () => {
  const 抽之前 = BEFORE(CELLS);
  const 抽之后 = rankHabits(CELLS);

  // 逐字段（deepEqual 比的是结构 + 值；下面再补一条"字段名逐字相同"，
  // 因为少一个字段 deepEqual 也会红，但多一个/改名要靠它把话说死）
  assert.deepEqual(抽之后, 抽之前, '★抽出来的结果与抽之前的逐字段不同：抽取时改了语义');
  assert.deepEqual(抽之后, GOLDEN, '★与钉死的金样不同：要么判据变了，要么 BEFORE 副本被改过');

  assert.ok(抽之后.length > 0, '★前置：结果为空，逐字段比较等于没比');
  const 字段集 = [...new Set(抽之后.flatMap((r) => Object.keys(r)))].sort();
  assert.deepEqual(字段集, ['delta', 'domain', 'n', 'ok'], '★字段集合变了（抽取前只有这四个）');
  for (const r of 抽之后) {
    assert.deepEqual(Object.keys(r), ['domain', 'n', 'ok', 'delta'],
      '★字段顺序/集合变了：' + r.domain);
  }
  // 键的插入顺序也要一样：网页按 h.domain / h.delta / h.n / h.ok 读，JSON 下发也按这个序
  assert.equal(JSON.stringify(抽之后), JSON.stringify(抽之前), '★键序或数值表示变了（JSON 下发会不一样）');
});

// ── ③ 判据逐条落地（在真实落盘件上也跑一遍：不靠夹具背书）──────────────────────
test('③ 判据逐条落地，且在真实落盘件的 cells 上同样成立', () => {
  const OUT = path.join(ROOT, 'p1b', 'sim', 'out');
  const 件名 = fs.readdirSync(OUT).filter((f) => /^calibration-report-\d{8}[a-z]?\.json$/.test(f)).sort().pop();
  assert.ok(件名, '★找不到 calibration-report 落盘件（端点与网页的数据源）');
  const cells = JSON.parse(fs.readFileSync(path.join(OUT, 件名), 'utf8')).cells;
  assert.ok(Array.isArray(cells) && cells.length > 0, '★落盘件里没有 cells —— 下面的比对照样跑 0 行');

  const 实测 = rankHabits(cells);
  assert.deepEqual(实测, BEFORE(cells), '★真实件上：抽出来的结果与抽之前逐字段不同');
  assert.ok(实测.length > 0, '★前置：真实件上结果为空');

  // ① delta 为 null 的格，连桶都不建
  //   注意判据是"这一格不计"，不是"这个域不许有桶"——同一个域可能还有别的可算格。
  //   所以这里比的是桶里的格数/题数与"该域**可算**格"的数目，而不是桶在不在。
  const 桶 = new Map(habitBuckets(cells).map((b) => [b.domain, b]));
  const 空的格 = cells.filter((c) => c.delta_vs_half === null);
  assert.ok(空的格.length > 0, '★前置：真实件里没有 delta 为 null 的格 ⇒ 判据①这一条没测到');
  for (const c of 空的格) {
    const 可算 = cells.filter((x) => x.domain === c.domain && x.delta_vs_half !== null);
    const b = 桶.get(c.domain);
    assert.equal(b ? b.cells : 0, 可算.length,
      '★delta_vs_half 为 null 的格被算进桶了：' + c.domain);
    assert.equal(b ? b.n : 0, 可算.reduce((s, x) => s + x.scored_n, 0),
      '★delta_vs_half 为 null 的格把题数算进 n 了：' + c.domain);
  }
  // ② 只加 conclusion_allowed 的格 ⇒ 每行 delta 都可由 d/ok 复算出来
  for (const r of 实测) {
    const b = 桶.get(r.domain);
    assert.equal(b.ok, r.ok, '★ok 与归并不一致：' + r.domain);
    assert.equal(r.delta, b.d / b.ok, '★delta 不是 d/ok —— ★分母必须是格数 ok，不是题数 n');
  }
  // ③ ok=0 的域整域不在榜上
  const 榜上 = new Set(实测.map((r) => r.domain));
  for (const b of 桶.values()) {
    if (b.ok > 0) { assert.ok(榜上.has(b.domain), '★够样本的域没进榜：' + b.domain); }
    else { assert.equal(榜上.has(b.domain), false, '★ok=0 的域进了榜：' + b.domain); }
  }
  // ④ n 累加全部非 null 格 ⇒ n ≥ 每格的 scored_n 之和（逐格核）
  for (const b of 桶.values()) {
    const 和 = cells.filter((c) => c.domain === b.domain && c.delta_vs_half !== null)
      .reduce((s, c) => s + c.scored_n, 0);
    assert.equal(b.n, 和, '★n 没有把全部可算格加起来：' + b.domain);
    assert.equal(b.cells, cells.filter((c) => c.domain === b.domain && c.delta_vs_half !== null).length,
      '★cells（可算格数）与实际不符：' + b.domain);
  }
  // ⑤ 按 |delta| 降序；同值保持入列先后
  for (let i = 1; i < 实测.length; i++) {
    assert.ok(Math.abs(实测[i - 1].delta) >= Math.abs(实测[i].delta),
      '★不是按 |delta| 降序：第 ' + i + ' 行 ' + 实测[i].domain);
  }
  const 入列序 = [...桶.keys()];
  const tie = [];
  for (let i = 1; i < 实测.length; i++) {
    if (Math.abs(实测[i - 1].delta) === Math.abs(实测[i].delta)) tie.push([实测[i - 1].domain, 实测[i].domain]);
  }
  for (const [x, y] of tie) {
    assert.ok(入列序.indexOf(x) < 入列序.indexOf(y),
      '★|delta| 相同时次序被改：' + x + ' 应排在 ' + y + ' 前（排序稳定）');
  }
  assert.ok(实测.some((r) => r.delta < 0) && 实测.some((r) => r.delta > 0),
    '★真实件上正负号只剩一种 —— 「报大了/报小了」那一支没人测');
});

// ── ④ ★n<30 纪律：格数不足时只报方向，不给比例 ────────────────────────────────
test('④ ★n<30 纪律：薄格不进平均、整域无够样本格就不进榜、也不许给比例', () => {
  const 实测 = rankHabits(CELLS);
  const 榜上 = new Set(实测.map((r) => r.domain));

  // ③ allthin 一格都测不够 ⇒ 整域不在榜（不是排最后一名）
  assert.equal(榜上.has('allthin'), false, '★整域无够样本格却进了榜');
  // 它的桶还在（好让端点如实回答"为什么不在榜"），但 ok=0、不含任何比例
  const 桶 = habitBuckets(CELLS).find((b) => b.domain === 'allthin');
  assert.ok(桶, '★allthin 的桶不见了（端点就没法解释它为什么被剔）');
  assert.equal(桶.ok, 0, '★allthin 的 ok 不是 0');
  assert.equal(桶.n, 11, '★allthin 的 n 没把薄格算进去（薄格只记方向，但仍是一条题）');
  assert.equal('delta' in 桶, false, '★桶里出现了 delta —— ok=0 时不许有任何比例');

  // ④ 薄格不得污染 delta：energycharts 的薄格偏差 +0.4 大到离谱，
  //   若它进了平均，delta 一定不再是负的 0.0143…
  const e = 实测.find((r) => r.domain === 'energycharts');
  assert.ok(e, '★energycharts 不在榜上');
  assert.equal(e.n, 111, '★n 应含薄格那 12 条（99+12）');
  assert.equal(e.ok, 1, '★ok 只该算够样本的那一格');
  assert.ok(e.delta < 0, '★薄格污染了平均（delta 变正了）');

  // 同理 noaa：薄格 +0.5 不得进平均
  const na = 实测.find((r) => r.domain === 'noaa');
  assert.equal(na.n, 59, '★noaa 的 n 应含薄格那 7 条（52+7）');
  assert.equal(na.delta, -0.0373652483814616, '★noaa 的 delta 被薄格改了');

  // 兜底：榜上每一行的 ok 都必须 > 0（没有"格数不足却给了比例"的行）
  for (const r of 实测) {
    assert.ok(r.ok > 0, '★有 ok=0 的行进了榜：' + r.domain);
    assert.ok(Number.isFinite(r.delta), '★有非有限的比例：' + r.domain);
  }
});

// ── ⑤ 端点：已注册、只读、口径与共享模块一致、返回体带"为什么这么排" ──────────
function mkReply() { return { _c: 200, code(c) { this._c = c; return this; }, send(x) { this._sent = x; return x; } }; }
function routesOf() {
  const { register } = require(path.join(ROOT, 'p1b', 'src', 'routes', 'disclosure.js'));
  const routes = {};
  register({ get: (p, h) => { routes[p] = h; } });
  return routes;
}

test('⑤ 只读端点：已注册、只读、口径与共享模块同一份、返回体带排序理由', async () => {
  const routes = routesOf();
  assert.ok(routes['/api/disclosure/habits'], '★缺 /api/disclosure/habits 端点');
  const reply = mkReply();
  const r = await routes['/api/disclosure/habits']({}, reply);

  assert.equal(reply._sent, undefined, '★端点回 404 了：' + JSON.stringify(reply._sent));
  assert.ok(r && typeof r === 'object', '端点应返回对象');
  assert.equal(r.read_only, true, '★须自报只读');

  // ⑤-1 端点的榜与共享模块**同一份**算出来的（不许端点自己再数一遍）
  const OUT = path.join(ROOT, 'p1b', 'sim', 'out');
  const 件名 = fs.readdirSync(OUT).filter((f) => /^calibration-report-\d{8}[a-z]?\.json$/.test(f)).sort().pop();
  const cells = JSON.parse(fs.readFileSync(path.join(OUT, 件名), 'utf8')).cells;
  assert.deepEqual(r.habits, rankHabits(cells), '★端点的榜与共享模块算的不一致（口径分叉了）');
  assert.deepEqual(r.habits, BEFORE(cells), '★端点的榜与抽取前实现不一致');
  assert.equal(r.source_file, 件名, '★端点读的件与 /calibration 不是同一件');
  assert.ok(r.habits.length > 0, '★前置：端点返回空榜，后面的比对照样跑 0 行');

  // ⑤-2 返回体必须带"为什么这么排"——不许给调用方一个黑盒数字
  assert.ok(r.ranking, '★返回体没有 ranking（为什么这么排）');
  const 要说的 = ['what', 'order', 'denominator', 'cell_rules', 'dropped', 'ties', 'n30', 'page_note'];
  const 缺的 = 要说的.filter((k) => r.ranking[k] === undefined || r.ranking[k] === '');
  assert.deepEqual(缺的, [], '★ranking 缺字段（调用方会看到黑盒）');
  assert.ok(Array.isArray(r.ranking.cell_rules) && r.ranking.cell_rules.length >= 3, '★ranking.cell_rules 太薄');
  for (const s of [].concat(r.ranking.cell_rules)) {
    assert.equal(typeof s, 'string', '★cell_rules 里有非字符串');
  }
  // 理由里必须把最容易搞错的那一处说死：分母是格数不是题数
  assert.match(r.ranking.denominator, /格数/, '★denominator 没说清分母是格数');
  assert.match(r.ranking.denominator, /不是除以题数/, '★denominator 没点明"不是题数"');
  assert.match(r.ranking.n30, /只记方向/, '★n30 那条没写"只记方向"');
  assert.equal(r.ranking, HABIT_RANK_BASIS, '★端点带的理由与共享模块那份不是同一个对象');

  // ⑤-3 纪律声明要落在返回体里
  assert.ok(Array.isArray(r.discipline) && r.discipline.length >= 3, '★缺 discipline 声明');
  const 纪 = r.discipline.join('\n');
  assert.match(纪, /只读/, '★discipline 未声明只读');
  assert.match(纪, /格数/, '★discipline 未声明分母是格数');

  // ⑤-4 端点不许把整件原样透传出去（那不是接口，是文件服务器）
  for (const heavy of ['cells', 'qualification_block', 'prequential_two_order', 'lag_rank_test', 'o7_maxent']) {
    assert.equal(r[heavy], undefined, '★端点透传了 ' + heavy + '（应只回归并后的榜）');
  }
  assert.deepEqual(Object.keys(r).sort(),
    ['cells_total', 'cells_with_conclusion', 'discipline', 'dropped_domains', 'generated_at', 'habits', 'ranking', 'read_only', 'source_file'].sort(),
    '★返回体键集合变了：' + JSON.stringify(Object.keys(r).sort()));
});

// ── ⑥ 端点的 dropped_domains：被剔的域如实回，且**不带比例** ──────────────────
test('⑥ 端点对 ok=0 的域：如实回、不进榜、不带任何比例字段', async () => {
  // 真实件上可能一个都没有（每个域都至少有一格够样本）——所以这里用**行为**判：
  //   先证明"真实件上 dropped 确实为空"这件事与 cells 对得上（不是漏算），
  //   再在合成 cells 上证明"真的剔掉时它长什么样"（端点的这条分支不许没测过）。
  const routes = routesOf();
  const reply = mkReply();
  const r = await routes['/api/disclosure/habits']({}, reply);

  const OUT = path.join(ROOT, 'p1b', 'sim', 'out');
  const 件名 = fs.readdirSync(OUT).filter((f) => /^calibration-report-\d{8}[a-z]?\.json$/.test(f)).sort().pop();
  const cells = JSON.parse(fs.readFileSync(path.join(OUT, 件名), 'utf8')).cells;
  const 桶 = habitBuckets(cells);
  const 该剔 = 桶.filter((b) => b.ok === 0).map((b) => b.domain);
  assert.deepEqual(r.dropped_domains.map((d) => d.domain), 该剔,
    '★dropped_domains 与"桶里 ok=0 的域"对不上（既可能漏报，也可能多报）');
  const 榜上 = new Set(r.habits.map((h) => h.domain));
  let 查过 = 0;
  for (const d of r.dropped_domains) {
    查过++;
    assert.equal(榜上.has(d.domain), false, '★被剔的域又出现在榜上：' + d.domain);
    assert.equal('delta' in d, false, '★被剔的域带比例字段 delta：' + d.domain);
    assert.equal('brier' in d, false, '★被剔的域带其他比例字段：' + d.domain);
    assert.match(d.reason, /ok=0|一格都/, '★没说明为什么被剔：' + d.domain);
  }
  assert.equal(查过, r.dropped_domains.length, '★前置：上面的循环没跑满');

  // ★合成件：确有一个整域被剔时，端点必须如实回它（不许静默丢一个域）
  const 合 = CELLS.filter((c) => c.domain === 'allthin' || c.domain === 'werewolf_sim');
  const 剔前 = habitBuckets(合).filter((b) => b.ok === 0);
  assert.equal(剔前.length, 1, '★前置：合成件里没有 ok=0 的域，这条分支就白测了');
  const 应剔 = 剔前[0].domain;
  assert.equal(rankHabits(合).some((x) => x.domain === 应剔), false, '★前置：' + 应剔 + ' 其实进了榜');
});

// ── ⑦ 零副作用：同一入参两次跑一样，且**入参本身不许被改** ────────────────────
test('⑦ 零副作用：不读不写不改入参，同一入参两次结果一致', () => {
  const 快照 = JSON.stringify(CELLS);
  const 一 = rankHabits(CELLS);
  const 二 = rankHabits(CELLS);
  assert.equal(JSON.stringify(CELLS), 快照, '★归并改了入参（纯计算不许写调用方的东西）');
  assert.deepEqual(habitBuckets(CELLS), habitBuckets(CELLS), '★同一入参两次结果不同');
  assert.deepEqual(二, 一, '★重复调用结果漂移');
  assert.equal(二.length, 一.length, '★重复调用行数漂移');
  // 空与非法入参不许炸出别的东西来（页面首帧就是空数组）
  assert.deepEqual(rankHabits([]), [], '空入参应回空榜');
  assert.deepEqual(rankHabits(null), [], 'null 入参应回空榜');
  assert.deepEqual(rankHabits(undefined), [], 'undefined 入参应回空榜');
  assert.equal(一.length, 8, '★空入参那条把结果也弄没了（8 行才对）');
  assert.ok(一.length > 0, '★前置：主结果为空，重复调用的比对照样跑 0 行');
});

// ── ⑧ 类型声明是**声明**不是第二份实现 ───────────────────────────────────────
test('⑧ .d.mts 只有类型，没有可执行代码（不许悄悄长出第二份实现）', () => {
  assert.ok(fs.existsSync(DTS_PATH), '缺 ' + DTS_PATH);
  const dts = fs.readFileSync(DTS_PATH, 'utf8');
  // 声明文件里每一个 export 都必须是 interface / declare —— 否则就是长出了实现
  const 非声明 = [...dts.matchAll(/^export\s+(?!interface\b|declare\b).*$/gm)].map((m) => m[0].trim());
  assert.deepEqual(非声明, [], '★.d.mts 里有非声明的导出（=第二份实现）');
  // 每个 function 都必须带 declare
  const 函数数 = (dts.match(/\bfunction\b/g) || []).length;
  const 声明函数数 = (dts.match(/\bdeclare function\b/g) || []).length;
  assert.ok(函数数 > 0, '★前置：.d.mts 里一个 function 都没有 ⇒ 下面这条比对照样跑 0 次');
  assert.equal(函数数, 声明函数数, '★.d.mts 里有不带 declare 的 function（=实现）');
  for (const 禁 of ['module.exports', 'require(', 'export default']) {
    assert.equal(dts.includes(禁), false, '★.d.mts 里有可执行代码：' + 禁);
  }
  // 但它必须真的声明了共享模块导出的两个函数（否则前端会退化成 any）
  assert.match(dts, /export declare function rankHabits\(/, '缺 rankHabits 的声明');
  assert.match(dts, /export declare function habitBuckets\(/, '缺 habitBuckets 的声明');
  assert.match(dts, /export declare const HABIT_RANK_BASIS/, '缺 HABIT_RANK_BASIS 的声明');
  // 声明的字段集必须与实现真吐的字段集一致（声明漂了，前端就在读不存在的字段）
  const m = require(MOD_PATH);
  const 一行 = m.rankHabits([{ layer: 'L1', domain: 'd', scored_n: 1, conclusion_allowed: true, delta_vs_half: 0.1 }])[0];
  assert.ok(一行, '★前置：实现对最小入参返回空（字段集无从核对）');
  for (const k of Object.keys(一行)) {
    assert.ok(dts.includes(k), '★.d.mts 没声明实现真吐的字段：' + k);
  }
});
