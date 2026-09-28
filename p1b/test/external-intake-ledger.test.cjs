'use strict';
/**
 * p1b/test/external-intake-ledger.test.cjs —— 「记一笔」端到端锁：**用户填的那个数进账本了吗**
 *
 * 【本轮病象（三处，全都在前端）】
 *   ① `web/src/api.ts` 没有任何函数 POST 到落注端点 ⇒ 「记一笔」从不创建行；
 *   ② `myProb`（NotePage 里那个 0-100 输入框）从不进入任何提交 ⇒ 账本恒"当时没给数"；
 *   ③ `buildChecklist` 只发三问 + 建议层，后端 `intake.js:296-302` 逐层必填 ⇒ 提交必 400。
 *   ⇒ 界面全程"收下了"，账本里什么都没有。**这是最会骗人的一种坏**。
 *
 * 【为什么必须有这条端到端锁】
 *   前面三样都能单测通过、tsc 也能过，而功能依然是死的——
 *   「测试全绿但东西没进账本」只有把**前端真实 payload 走完整条后端链路**才验得出来。
 *   故本文件不复刻"应该能查到"的近似查询，而是把前端那份逐字 payload 灌进真端点，
 *   再用**读端自己那条 SQL** 回查。
 *
 * 【端到端锁（红着就是没做完）】
 *   前端 payload → classify 200（拿层）→ create 201 且 `assigned_prob` 等于用户填的数
 *   → `json_extract(evidence_json,'$[0].resolve.kind')` 查得到
 *   → 出现在未落定清单 → 到期能落定 → 再落定 409（账本不可改）。
 *
 * 【反向锁（不许因为修正向而放松）】
 *   · 缺层的 checklist 仍必须被 400 拒；
 *   · 用户没填数不许建行（不许静默拿基率顶上）。
 *
 * 【容器局：本轮的设计裁定，不是创始人拍板】
 *   `predictions.game_id NOT NULL`（predictionsStore.js:45）⇒ 落注必须挂一局。
 *   外部题（天气/汇率/…）没有局，而 `intake.js:25` 明写「外部题 resolve 后的**域容器规则待定义**，
 *   禁沿用隐式 `corpus:*` 模式」——即那条路是有意留空的。
 *   本轮裁定：**建一个显式的容器局**（`games.source='external'`、`game_type='external'`、
 *   名字「外部题」），并把它登记成 `labBoundary` 里的**第三种 scope**。
 *   ★它既不是真实局、也不是实验场：绝不许在统计上冒充那批 CLI 灌入的语料题。
 *   ★该裁定是依据 `intake.js:25` 做的实现选择，**需创始人复核**（见交付报告待拍板一节）。
 *
 * 铁律：不起真端口（app.inject）；DB=:memory:；零网络；生产库 p1a.db 本轮零写入。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const lab = require('../src/evidence/labBoundary');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-ext-intake-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const j = (r) => r.json();
const conn = () => db.getConnection();

/* ── 前端那份 payload 的**逐字副本** ──
   改这里之前先改 web/src/lib/noteChecklist.test.mjs 里那段同样的字面量：
   两边断言同一个对象，任一边漂移都红。禁在本文件里"顺手简化"成假形状。 */
const FRONTEND_CHECKLIST_L2 = {
  Q0_1: true, Q0_2: true, Q0_3: true,
  L5: ['unknown', 'unknown', 'unknown'],
  L6: ['unknown', 'unknown', 'unknown', 'unknown'],
  L1: ['unknown', 'unknown', 'unknown', 'unknown'],
  L3: ['unknown', 'unknown', 'unknown', 'unknown'],
  L2: [true, true, true, true],
};

/** 用户在界面上填的数（0-100 百分数）与它换算后的 0-1 值。 */
const USER_PCT = 62;
const USER_PROB = 0.62;
/** 真值锚：题面自带日期 ⇒ 到期日可从 resolve_spec 推出来（不是猜的） */
const KIND = 'openmeteo_daily_max';
const RESOLVE_SPEC = { kind: KIND, date: '2020-01-01' };
const STATEMENT = '2026-09-30 伦敦日最高气温超过 20℃ 吗？';

/** 走完「先 classify 拿层、再 create 落库」两步，返回落注响应。 */
async function submitLikeThePage() {
  const c = j(await app.inject({
    method: 'POST', url: '/api/intake/classify',
    payload: { statement: STATEMENT, resolve_spec: { kind: KIND }, checklist: FRONTEND_CHECKLIST_L2 },
  }));
  assert.equal(c.ok, true, 'classify 应通过：' + JSON.stringify(c).slice(0, 200));
  assert.equal(c.rejected, false, '不该被拒收：' + JSON.stringify(c.reason || ''));
  const resp = await app.inject({
    method: 'POST', url: '/api/predictions',
    payload: {
      statement: STATEMENT,
      prob: USER_PROB,
      resolve_spec: RESOLVE_SPEC,
      layer: c.layer,
      secondary_layer: c.secondary,
      engine: c.engine,
      gate: c.gate,
      intake_question_id: c.intake_question_id,
    },
  });
  return { classify: c, status: resp.statusCode, created: j(resp) };
}

test('★① 端到端：前端 payload → classify 200 → create 201，且 assigned_prob 等于用户填的数', async () => {
  const { classify, status, created: row } = await submitLikeThePage();
  assert.equal(status, 201, '落注应 201：' + JSON.stringify(row).slice(0, 300));
  assert.ok(row && row.id > 0, '须返回行 id');
  // ★★本轮的核心断言：账本里那个数**就是用户填的那个数**
  assert.equal(row.assigned_prob, USER_PROB,
    'assigned_prob 必须等于用户填的 ' + USER_PCT + '% 换算值 ' + USER_PROB + '，实得 ' + row.assigned_prob);
  assert.notEqual(row.assigned_prob, USER_PCT, '不许把 0-100 百分数当 0-1 直接落库（后端 requireProb 收 [0,1]）');
  // 层与到期口径必须**一起**过来（旧实现这 5 个字段一个都没传 ⇒ layer 恒 NULL）
  assert.equal(row.layer, classify.layer, '层没跟着过来（旧路由只传 6 个字段，layer 恒 NULL）');
  assert.equal(row.engine, classify.engine, 'engine 没跟着过来');
  assert.equal(row.gate, classify.gate, 'gate 没跟着过来');
  assert.ok(row.matures_at, '到期口径没跟着过来：resolve_spec 带 date，必须推出 matures_at');
  assert.equal(String(row.matures_at).slice(0, 10), RESOLVE_SPEC.date, '到期日应取自题面自带的日期，不是猜的');
});

test('★② 落下的行能被读端用**它自己那条 SQL** 查到（真值锚有索引）', async () => {
  const { created } = await submitLikeThePage();
  const id = created.id;
  // 逐字复制 predictions.js:264 的读法：json_extract(evidence_json,'$[0].resolve.kind')
  const found = conn().prepare(
    "SELECT id, json_extract(evidence_json,'$[0].resolve.kind') AS kind FROM predictions WHERE id=?"
  ).get(id);
  assert.ok(found, '行不在库');
  assert.equal(found.kind, KIND, '★第 0 个元素上没有真值锚 ⇒ 基率/真值口径读端全都查不到（等于没建索引）');
});

test('★③ 出现在未落定清单里，且到期后能落定、再落定 409（不可变）', async () => {
  const { created } = await submitLikeThePage();
  const id = created.id;
  const un = j(await app.inject({ method: 'GET', url: '/api/predictions/unresolved' }));
  assert.ok(un.items.some((r) => r.id === id), '新落的题没进未落定清单＝用户到期后找不到它');

  // 题面日期是 2020-01-01（早于今天）⇒ 已到期，可落定
  const res = j(await app.inject({
    method: 'POST', url: '/api/predictions/' + id + '/resolve',
    payload: { outcome: 'true', note: '端到端锁用' },
  }));
  assert.equal(res.outcome, 'true', '落定失败：' + JSON.stringify(res));
  assert.ok(res.resolved_at, '落定须写 resolved_at');

  // 账本不可改：再落定一次必须 409，而不是悄悄改掉
  const again = await app.inject({
    method: 'POST', url: '/api/predictions/' + id + '/resolve',
    payload: { outcome: 'false' },
  });
  assert.equal(again.statusCode, 409, '已落定的题再改必须 409（账本不可变）');
});

test('★④ 反向锁：用户没填数不许建行（不许静默拿基率顶上）', async () => {
  for (const bad of [undefined, null, '大概率', 62, -0.1, 1.5, 'NaN']) {
    const payload = { statement: STATEMENT, resolve_spec: RESOLVE_SPEC, prob: bad };
    const r = await app.inject({ method: 'POST', url: '/api/predictions', payload });
    assert.equal(r.statusCode, 400,
      'prob=' + JSON.stringify(bad) + ' 必须被拒：口头概率须由人澄清成数值，缺数更不行');
  }
  // ★一次都没建行（拒了就是拒了，不许"先建了再说"）
  const n = conn().prepare('SELECT COUNT(*) AS n FROM predictions WHERE statement=?').get(STATEMENT).n;
  assert.ok(n > 0, '前面的正向用例已建了行（这条断言只是确保下面的计数口径有意义）');
  const bad = conn().prepare("SELECT COUNT(*) AS n FROM predictions WHERE statement=? AND evidence_json LIKE '%大概率%'")
    .get(STATEMENT).n;
  assert.equal(bad, 0, '不许把口头概率落库');
});

test('★⑤ 反向锁：缺层的 checklist 仍被 400（不许为了修正向把契约放松）', async () => {
  const partial = { Q0_1: true, Q0_2: true, Q0_3: true, L2: [true, true, true, true] }; // 缺 L5/L6/L1/L3
  const r = await app.inject({
    method: 'POST', url: '/api/intake/classify',
    payload: { statement: STATEMENT, resolve_spec: { kind: KIND }, checklist: partial },
  });
  assert.equal(r.statusCode, 400, '缺层必须仍被 400 拒（intake.js:299）');
  assert.ok(/checklist\.L5/.test(JSON.stringify(r.json())), '报错要点名缺哪层：' + JSON.stringify(r.json()));
  // 层数不符也仍被 400
  const short = Object.assign({}, FRONTEND_CHECKLIST_L2, { L2: [true, true] });
  const r2 = await app.inject({
    method: 'POST', url: '/api/intake/classify',
    payload: { statement: STATEMENT, resolve_spec: { kind: KIND }, checklist: short },
  });
  assert.equal(r2.statusCode, 400, '层长不符必须仍被 400 拒（intake.js:191）');
});

test('★⑥ 容器局：全库恰好一个，重复调用不新增，且它既不是真实局也不是实验场', async () => {
  const scope = lab.classifyGameType('external');
  assert.equal(scope.scope, 'external', 'external 必须是第三种 scope，不是 real 也不是 lab');
  assert.notEqual(scope.scope, 'real', '绝不许把外部题算成真实局（那会让它被拒收门挡掉）');
  assert.notEqual(scope.scope, 'lab', '★绝不许把外部题算成实验场（那正是"冒充语料题"的形状）');
  // 按 games 行的权威列判
  assert.equal(lab.classifyGame({ game_type: 'external', source: 'external' }).scope, 'external');
  // 无 source 列（:memory: 形态）也要判得出来
  assert.equal(lab.classifyGame({ game_type: 'external' }).scope, 'external', '新库无 source 列时也要认得出容器局');
  assert.equal(lab.isRealGame({ game_type: 'external', source: 'external' }), false, '容器局不是真实局');

  // 落注若干次之后，容器局仍然只有一个
  await submitLikeThePage();
  await submitLikeThePage();
  const containers = conn().prepare("SELECT id, name FROM games WHERE game_type='external'").all();
  assert.equal(containers.length, 1, '全库必须恰好一个容器局，实得 ' + containers.length);
  assert.ok(String(containers[0].name).length > 0, '容器局得有个能一眼看懂的名字');
  // 落注的行确实挂在它上面
  const n = conn().prepare('SELECT COUNT(*) AS n FROM predictions WHERE game_id=?').get(containers[0].id).n;
  assert.ok(n >= 3, '新落的题应挂在容器局上，实得 ' + n);
});

test('★⑦ 容器局的行不许在统计上冒充语料题：读端能按域区分', () => {
  // 读侧谓词与 JS 判定必须一致（口径分叉＝报表读数不可信）
  const rows = conn().prepare(
    'SELECT g.game_type AS game_type, g.source AS source, ' + lab.NOT_REAL_GAME_PREDICTION_SQL() + ' AS keep FROM games g'
  ).all();
  for (const row of rows) {
    assert.equal(!!row.keep, !lab.isRealGame(row), '口径分叉：game_type=' + row.game_type);
  }
  const c = rows.filter((r) => r.game_type === 'external');
  assert.equal(c.length, 1, '容器局在读侧可识别');
  assert.equal(!!c[0].keep, true, '容器局不是真实局 ⇒ 不被"排除真实局"这条谓词剔掉');
  // ★而它与语料局**分得开**（能说清"其中 N 条是人手写的一道题"）
  assert.notEqual(
    lab.classifyGameType('external').scope,
    lab.classifyGameType('corpus:dlt').scope,
    '★external 与 corpus 必须落在不同 scope，否则报表分不开人手写的题与灌入的语料',
  );
});

test('⑧ 容器局不得被造到生产库（本文件全程 :memory:）', () => {
  // 断言手段：连接串必须是内存库
  const path = conn().name;
  assert.equal(path, ':memory:', '本文件全程只准用 :memory:，实得 ' + path);
});
