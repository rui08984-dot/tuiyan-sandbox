'use strict';
/**
 * p1b/test/matures-at-two-paths.test.cjs —— 洞三：classify 与 create 两条到期日推导路径必须同数（2026-09-28）
 *
 * 【实测到的真因（与原始判断不同，先记在这里免得下一个人再查一遍）】
 *   原始判断是"两条路径喂的 **evidence 数组**不同"（classify 喂 `engineEvidence`、
 *   create 喂 `[{resolve:spec}]`）⇒ "classify 算出日期、create 落 null"。
 *   **实测两条都不成立**：
 *     ① 那两个数组**在效果上等价**：`deriveMaturesAt` 只在 `resolve` 的九个日历字段全落空之后
 *        才去扫 `evidence[i].meta`（predictionsStore.js:220-226），而 create 侧那个数组是
 *        `[{resolve:spec}]`——**没有 `meta`**，扫了也是空。⇒ 换掉它不会改变任何一行结果。
 *     ② NotePage 发的是 `{kind}`（无任何日历字段）⇒ **两侧都是 null，本来就没有矛盾**。
 *        实测：classify `matures_at: null`、create `matures_at: null`、落库 `NULL`。
 *
 *   ★**真因是 `normalizeResolveSpec` 的白名单宽度**，不是 evidence：
 *     `intake.js:231` 的那份只放行 `url_template|field|threshold|cmp|date` **五个键**，
 *     `predictions.js:49` 的那份**全量透传**（"其余键一律原样保留"）。
 *     ⇒ 同一个请求体，经 classify 时 `month`/`year`/`period`/`week_end`/`end`/
 *       `date_plus7`/`week_start`/`epiweek`/`week` **当场被丢掉**，`deriveMaturesAt` 推不出日期；
 *       经 create 时这些键原样进去，推出日期并**真的落库**。
 *   ⇒ 实测出的矛盾方向与原始判断**相反**：
 *       `{kind, month:'2026-10'}` → classify `null` ／ create+落库 `2026-10-31`
 *       `{kind, year:2026}`      → classify `null` ／ create+落库 `2027-12-31`
 *     即"**classify 说没有到期日、账本里却有一个**"。
 *
 * 【为什么这仍然是必须修的洞】
 *   classify 的 `matures_at` 是**同一个问题的第二个答案**。今天界面上没炸，是因为
 *   NotePage 的回执那行「到期」读的是 `ledger.matures_at`（create 侧），
 *   classify 那个 null 从没被渲染（`Receipt` 里 `detail.matures_at` 只解构、没显示）。
 *   可它已经在 API 上自相矛盾：任何按 classify 的答复渲染到期日的调用方
 *   （包括下一版前端、包括脚本）都会显示"本题无日历到期日"，而账本里明明有一个日期，
 *   且到期日是**结算通道的选题闸门**（predictionsStore.js:213-216 写过：早一年会让年度题
 *   在真值尚未发布时就被选中）——判错方向同样静默。
 *
 * 【修法：两侧走同一函数、同一份输入】
 *   单一真源是 `predictionsStore.deriveMaturesAt`（两侧**本来就在调它**，不新增第三套日期算法；
 *   照 predictionsStore.js:352-355「两边各写一套日期算法正是本项目已经吃过一次亏的地方」那条）。
 *   要收敛的是**输入**：classify 那侧的返回体必须按**调用方真正发来的那份 resolve_spec** 推导，
 *   而不是按 intake 自己截断过的那份。⇒ 两侧对同一个请求体给出同一个数。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/predictionsStore');
const kindGate = require('../src/evidence/resolveKind');

const J = (r) => r.json();
const post = (app, url, payload) => app.inject({ method: 'POST', url: url, payload: payload });
const conn = () => db.getConnection();

let app = null;
/** 真值锚 kind 取自支持表（不手抄字面量）。 */
let KIND = null;
/** NotePage 实际发的那份 checklist（L2 建议层全 true、其余四层发 'unknown'）。 */
const CHECKLIST = {
  Q0_1: true, Q0_2: true, Q0_3: true,
  L5: ['unknown', 'unknown', 'unknown'],
  L6: ['unknown', 'unknown', 'unknown', 'unknown'],
  L1: ['unknown', 'unknown', 'unknown', 'unknown'],
  L3: ['unknown', 'unknown', 'unknown', 'unknown'],
  L2: [true, true, true, true],
};

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: path.join(require('os').tmpdir(), 'matures-two-paths-prov.json') });
  KIND = kindGate.supportedKinds()[0];
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 同一份 payload 走一遍 classify 与 create，返回两个到期日。 */
async function bothPaths(spec) {
  const q = require('../src/routes/intake').classifyIntake; // 直接调同款契约，避免 HTTP 前置差异
  void q;
  const c = await post(app, '/api/intake/classify', { statement: '到日期数一致性用的题面', resolve_spec: spec, checklist: CHECKLIST });
  assert.equal(c.statusCode, 200, 'classify 失败：' + c.body.slice(0, 200));
  const cj = J(c);
  const p = await post(app, '/api/predictions', { statement: '到日期数一致性用的题面', prob: 0.5, resolve_spec: spec });
  assert.equal(p.statusCode, 201, 'create 失败：' + p.body.slice(0, 200));
  const pj = J(p);
  const row = conn().prepare('SELECT matures_at FROM predictions WHERE id=?').get(pj.id);
  return { classify: cj.matures_at, create: pj.matures_at, row: row.matures_at, id: pj.id };
}

/** 全部会推出日期的 resolve_spec 形状（照 deriveMaturesAt 的分支清单逐条来）。 */
const SPECS = [
  ['无日历字段（NotePage 原样）', {}],
  ['date', { date: '2026-10-01' }],
  ['week_end', { week_end: '2026-10-04' }],
  ['end', { end: '2026-10-02' }],
  ['date_plus7', { date: '2026-10-01', date_plus7: '2026-10-08' }],
  ['week_start', { week_start: '2026-09-28' }],
  ['period（月末）', { period: '2026-10' }],
  ['month（月末）', { month: '2026-11' }],
  ['year（次年 12-31）', { year: 2026 }],
  ['epiweek（周六）', { epiweek: '202641' }],
  ['week（ISO 周的周日）', { week: '2026W40' }],
  ['非法 date（应与无字段同数）', { date: '下周三' }],
];

// ─────────────── ① 两条路径同数（ask 点名的核心断言）───────────────

test('★同一 payload 经 classify 与 create 得到的 matures_at 相同（九个日历字段逐条）', async () => {
  for (const [label, extra] of SPECS) {
    const spec = Object.assign({ kind: KIND }, extra);
    const r = await bothPaths(spec);
    assert.equal(r.classify, r.create,
      '两条路径对同一 payload 给出不同到期日（' + label + '）：classify=' + JSON.stringify(r.classify)
      + ' create=' + JSON.stringify(r.create));
    assert.equal(r.row, r.create,
      '返回体报的到期日与**账本里落的那一行**不一致（' + label + '）：回执=' + JSON.stringify(r.create)
      + ' 落库=' + JSON.stringify(r.row));
  }
});

test('★两个都要 nil 时才是 nil（kind-only：两侧都"推不出"，不许一侧有值）', async () => {
  const r = await bothPaths({ kind: KIND });
  assert.equal(r.classify, null, 'classify 不该凭空给日期：' + JSON.stringify(r.classify));
  assert.equal(r.create, null, 'create 不该凭空给日期：' + JSON.stringify(r.create));
  assert.equal(r.row, null, '落库那行必须是 NULL（不是空串、不是省略）');
});

// ─────────────── ② 为什么必须过归一器，不能图省事直接喂 raw ───────────────

test('★raw spec **不**等价于归一后的 spec（所以收敛必须走归一器，不能直接喂 raw）', () => {
  // 这条测试的作用是**钉住一个陷阱**，不是要求它们相等。
  //   `deriveMaturesAt` 的 year 分支写的是 `String(r.year).length === 4 && isFinite(Number(r.year))`。
  //   喂 `{year: null}` ⇒ `String(null)` 是 'null'（长度 4 ✓）且 `Number(null)` 是 0（isFinite ✓）
  //   ⇒ 算出 `(0+1)+'-12-31'` = **'1-12-31'**，一个垃圾日期。
  //   写侧 `normalizeResolveSpec` 会把 null 值键**丢掉**，所以 create 永远看不到这个值。
  //   ⇒ 若 classify 侧图省事直接喂调用方的 raw spec，遇到 `resolve_spec:{kind, year:null}`
  //     就会报 1-12-31，而账本里落的是 null —— 收敛反而造出**第三个**不一致。
  const trap = (() => { try { return store.deriveMaturesAt({ kind: KIND, year: null }, []); } catch (e) { return null; } })();
  const honest = (() => { try { return store.deriveMaturesAt({ kind: KIND }, []); } catch (e) { return null; } })();
  assert.equal(trap, '1-12-31', 'deriveMaturesAt 对 year:null 的行为变了？本测试的依据就是它，请重看');
  assert.equal(honest, null);
  assert.notEqual(trap, honest, 'raw 与归一后**不等价**（这正是必须走写侧归一器的原因）');
});

test('★过归一器之后：含 null 值的字段形态，classify 与 create 仍然同数（陷阱形态走真端点）', async () => {
  // 把上面那个 `year:null ⇒ 1-12-31` 的陷阱**走真端点**再打一遍：
  // 两侧都先过写侧归一器（null 键被丢）⇒ 都推不出 ⇒ 都是 null。
  // 若哪天有人图省事让 classify 直接吃 raw，这条会红（classify 报 1-12-31 / create 报 null）。
  for (const [label, extra] of [
    ['year 给 null', { year: null }],
    ['date 给 null', { date: null }],
    ['month 给 null', { month: null }],
    ['week_end 给 null', { week_end: null }],
  ]) {
    const r = await bothPaths(Object.assign({ kind: KIND }, extra));
    assert.equal(r.classify, r.create, label + '：两侧不同数');
    assert.equal(r.row, r.create, label + '：返回体与落库不同数');
    assert.equal(r.classify, null, label + '：归一后本该推不出日期，却报出了 ' + JSON.stringify(r.classify));
  }
});

// ─────────────── ③ 单一真源：不得出现第三套日期算法 ───────────────

test('★两侧调的都是 predictionsStore.deriveMaturesAt（没有第三套日期算法）', () => {
  for (const f of ['intake.js', 'predictions.js']) {
    const rawSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', f), 'utf8');
    assert.ok(/deriveMaturesAt/.test(rawSrc), f + ' 必须调 store.deriveMaturesAt');
    // 只看**代码**：去掉块注释与行注释，再去掉 `new Date().toISOString()`（那是 generated_at 读钟，
    // 不是日历推导）。剩下任何日期算术都说明有人在本文件里另写了一套推导。
    const code = rawSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/new Date\(\)\.toISOString\(\)/g, 'CLOCK_READ');
    for (const [pat, why] of [
      [/new Date\(/, 'new Date(...)'],
      [/getFullYear|getUTCMonth|getMonth\(\)/, '日历字段读取'],
      [/setMonth|setDate|setFullYear/, '日历字段运算'],
      [/\+\s*12\s*-\s*31|-12-31/, '手写年末日期'],
      [/-01-31/, '手写月末日期'],
      [/lastDayOfMonth|epiweekEnd|isoWeekSunday/, 'store 里的私有日期助手'],
    ]) {
      assert.equal(pat.test(code), false, f + ' 的**代码**里出现了' + why + ' ⇒ 那是第三套日期算法');
    }
    assert.equal(/maturityState/.test(code), false,
      f + ' 的**代码**里不该拿 maturityState 做推导：那是读侧到期比较（matures_at <= 今天），不是推导函数，拿它推导是范畴错误');
  }
});

test('★classify 的返回体直接复用写侧那个归一器（不是自己再写一份口径）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'intake.js'), 'utf8');
  assert.ok(/normalizeResolveSpecForWrite/.test(src), 'intake 必须从 ./predictions 取写侧那个归一器');
  assert.ok(/require\('\.\/predictions'\)/.test(src), '那个归一器要从写侧模块取，不是本地重写');
  // 本文件那份 5 键白名单**必须原样保留**（它喂的是 intake_questions 落库内容与引擎入参，
  // 改它就动了落库语义，超出"只许改返回体"的边界）
  assert.ok(/\['url_template',\s*'field',\s*'threshold',\s*'cmp',\s*'date'\]/.test(src),
    '本文件 5 键白名单被改了——它喂落库内容，不在"只许改返回体"的边界内');
});

// ─────────────── ④ PREREG 冻结：判据契约/拒收门/决策树一个字未动 ───────────────

test('★intake 的判据契约、拒收门、决策树逐字未动（PREREG 冻结）', async () => {
  const intake = require('../src/routes/intake');
  assert.equal(intake.CHECKLIST_HASH, 'v3');
  assert.deepEqual(intake.DECISION_ORDER, ['L5', 'L6', 'L1', 'L3', 'L2'], '决策树顺序动了');
  assert.deepEqual(intake.PRIMARY_LAYERS, ['L1', 'L2', 'L3', 'L5', 'L6', 'unknown'], 'primary 合法取值动了');
  assert.deepEqual(intake.SCORABLE_LAYERS, ['L2', 'L5'], '可 scored 的层动了');
  assert.deepEqual(intake.GATE_QUESTIONS.map((q) => q.key), ['Q0_1', 'Q0_2', 'Q0_3'], '拒收门三问动了');
  assert.deepEqual(intake.GATE_QUESTIONS.map((q) => q.reason), ['no_anchor', 'leak', 'tautology'], '拒收原因枚举动了');
  // 端到端复核：判层与拒收判定逐字未变
  const c1 = J(await post(app, '/api/intake/classify', {
    statement: 'x', resolve_spec: { kind: KIND }, checklist: CHECKLIST,
  }));
  assert.equal(c1.rejected, false);
  assert.equal(c1.layer, 'L2', 'L2 全绿应判 L2');
  const c2 = J(await post(app, '/api/intake/classify', {
    statement: 'x', resolve_spec: { kind: KIND },
    checklist: Object.assign({}, CHECKLIST, { Q0_1: 'unknown' }),
  }));
  assert.equal(c2.rejected, true);
  assert.equal(c2.reason, 'no_anchor', '拒收门第一问不过应记 no_anchor');
  // 真实局题仍被域门拒（洞一的门不许被这次改动顺手拆掉）
  const gid = Number(conn().prepare(
    "INSERT INTO games (name, game_type, player_count) VALUES ('洞三·真实局', 'werewolf', 6)"
  ).run().lastInsertRowid);
  const c3 = J(await post(app, '/api/intake/classify', {
    statement: 'x', game_id: gid, resolve_spec: { kind: KIND }, checklist: CHECKLIST,
  }));
  assert.equal(c3.rejected, true);
  assert.equal(c3.reason, 'other', '实验场域门被动了');
  assert.equal(c3.detail.scope, 'not_prediction_lab');
});
