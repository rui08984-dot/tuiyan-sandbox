'use strict';
/**
 * p1b/test/resolve-due-guard.test.cjs —— 「未到期的题不许被落定」双层设防（2026-09-28）
 *
 * 病象（本轮最严重的一条）：**任何未到期的题都能被永久落定**，且不可回滚。
 *   ① `predictionsStore.listUnresolved` 曾是 `listWhere('outcome IS NULL', [])`——**零到期过滤**；
 *   ② `resolvePrediction` 只查 `outcome !== null`，**不看 `matures_at`**；
 *   ③ HTTP 端点 `POST /api/predictions/:id/resolve` 仍开着这条路（界面虽已改走只读的
 *      T6 `resolve-queue`，端点本身照旧可写）；
 *   ④ 账本**没有修正入口**（409 文案自己写明「目前没有修正入口」）⇒ 一次误点＝不可逆污染。
 *
 * 修法（双层，两层都堵）：
 *   ① 写端口 `resolvePrediction` 落定前校验到期：未到期 ⇒ `{ok:false,reason:'not_due',due}`，**不写**；
 *   ② 读端口 `listUnresolved` 默认按到期过滤（opt 可关，供内部诊断）。
 *
 * ★**到期口径不另写**：判定式与 T6 只读端点 `GET /api/disclosure/resolve-queue`
 *   （`p1b/src/routes/disclosure.js:70,86`）**逐字同款**＝`matures_at <= 上海日历日今天`。
 *   两边各写一套日期算法正是本项目已经吃过一次亏的地方（缺陷一的 year 分叉），故只此一套。
 *
 * ★**「永不到期」不许笼统拒绝**：`matures_at` 为空的题（botc 程序结算 / cwl·dlt 开奖，
 *   全库 474 条 underivable + 大量显式 null）**照常放行**——它们按来源自身节奏结算，
 *   一刀切拦掉会把整类题打死；但回带一句人话理由，不让「无到期日」变成看不见的状态。
 *
 * 铁律：不起真端口（app.inject）；DB=:memory:；LLM 全 mock；零网络。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/predictionsStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-dueguard-prov-' + process.pid + '-' + Date.now() + '.json');
let app = null, gameId = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '到期守卫局', type: 'werewolf', player_count: 6 } });
  gameId = g.json().game.id;
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 上海日历日今天（与 store / T6 端点同源口径）。 */
const shToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10);
/** 纯日期算术（把 YYYY-MM-DD 当 UTC 日处理，只做加减，不涉时刻语义）。 */
const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** 造一条题。`maturesAt === undefined` ⇒ 完全不碰两列（走「无日历到期日」那条路）。 */
function mk(statement, maturesAt) {
  const p = { gameId, day: 0, sourceType: '预测卡', statement, prob: 0.5, evidence: [] };
  if (maturesAt !== undefined) { p.g2Regime = 'R4'; p.maturesAt = maturesAt; }
  return store.insertPrediction(p);
}

test('① 未到期的题：落定被拒，outcome 仍为 NULL、resolved_at 仍为 NULL（不可逆的那一步不许发生）', () => {
  const t = shToday();
  const row = mk('未到期题（到期日 30 天后）', shift(t, 30));
  const r = store.resolvePrediction(row.id, 'true', '未到期就点落定');
  assert.equal(r.ok, false, '未到期不得落定');
  assert.equal(r.reason, 'not_due', '理由须是 not_due（实得 ' + r.reason + '）');
  assert.equal(r.due, shift(t, 30), '须回带到期日，供界面/人话说明用');
  const after = store.getPrediction(row.id);
  assert.equal(after.outcome, null, '★outcome 必须仍是 NULL（账本不可变，错写进去就回不来了）');
  assert.equal(after.resolved_at, null, '★resolved_at 必须仍是 NULL');
  assert.equal(after.resolve_note, null, 'resolve_note 也不许被这次拒绝写脏');
});

test('② 已到期的题：落定成功（设防不许把正常结算打死）', () => {
  const row = mk('已到期题（到期日为昨天）', shift(shToday(), -1));
  const r = store.resolvePrediction(row.id, 'true', '已到期，正常落定');
  assert.equal(r.ok, true, '已到期必须能落定：' + JSON.stringify(r));
  assert.equal(r.row.outcome, 'true');
  assert.ok(r.row.resolved_at, 'resolved_at 应写入');
});

test('③ 边界：到期日＝今天 ⇒ 放行（与 T6 端点 substr(matures_at,1,10) <= today 同款含当日）', () => {
  const row = mk('今天到期题', shToday());
  const r = store.resolvePrediction(row.id, 'false', '今天到期');
  assert.equal(r.ok, true, '到期日＝今天应放行（实得 ' + JSON.stringify(r) + '）');
});

test('④ 无日历到期日（matures_at 为空）：照常放行 + 回带人话理由，不许一刀切拦死', () => {
  const a = mk('无到期日题（连两列都没写）', undefined);
  const b = mk('显式 null 到期日题', null);
  for (const row of [a, b]) {
    const r = store.resolvePrediction(row.id, 'true', '无日历到期日，按来源自身节奏结算');
    assert.equal(r.ok, true, 'matures_at 为空的题必须照常放行（实得 ' + JSON.stringify(r) + '）——'
      + '全库 botc/cwl/dlt 大量此类题，一刀切拦掉等于把整类题打死');
    assert.ok(r.due_note && String(r.due_note).trim().length > 0,
      '必须回带一句人话理由，说明为什么这道题不受到期日约束（不许静默放行）');
  }
});

test('⑤ listUnresolved 默认剔除「未到期」；opt 关闭可回旧行为；两桶条数如实回报（不许静默吞）', () => {
  const due = store.listUnresolved({});
  const optOff = store.listUnresolved({ dueFilter: false });
  assert.ok(due.total < optOff.total, '默认必须已过滤（未到期题不该出现在待办清单里）');
  const df = due.due_filter;
  assert.ok(df && df.on === true, '须回带 due_filter.on=true，让调用方知道这份清单被过滤过');
  assert.equal(typeof df.excluded_not_yet_due, 'number', '未到期被排除的条数须如实计数');
  assert.equal(typeof df.included_no_due_date, 'number', '无到期日的条数也须单独计数，不许混进「未到期」里当同一回事');
  assert.equal(df.excluded_not_yet_due, optOff.total - due.total,
    '被排除的条数须等于 opt 关闭时的差额（互斥且完备，可自校验）');
  for (const it of due.items) {
    // ★无到期日的题**留在清单里**：它们此刻就是可落定的（botc/cwl/dlt），
    //   一并剔除等于把整类题从待办里抹掉。
    if (it.matures_at) assert.ok(String(it.matures_at).slice(0, 10) <= df.today, '清单内每条都应是已到期的');
  }
});

test('⑥ HTTP 端点 POST /api/predictions/:id/resolve：未到期题打不进去（端点不写库、不回已落定行）', async () => {
  const row = mk('未到期题（走 HTTP 端点）', shift(shToday(), 45));
  const r = await app.inject({ method: 'POST', url: '/api/predictions/' + row.id + '/resolve', payload: { outcome: 'true', note: '端点误点' } });
  const after = store.getPrediction(row.id);
  assert.equal(after.outcome, null, '★端点这条路也必须写不进去（防的就是它）');
  assert.equal(after.resolved_at, null, '★端点这条路也不许写 resolved_at');
  // 断言「响应里不得出现一个已落定的行」——这是跨路由都成立的危害面：
  // 客户端若收到 outcome=true 的行，就会以为这次误点成功了。
  assert.ok(!/"outcome"\s*:\s*"(true|false|ambiguous)"/.test(r.body || ''),
    '响应不得回一个已落定的行（会让人以为误点成功了）：' + (r.body || '').slice(0, 200));
  // ★2026-09-28 补：路由缺口已补（`p1b/src/routes/predictions.js` 现映射 not_due → 409），
  //   上一轮特意不断言状态码，因为那等于留一条当时无权修的红；现在可以锁死了。
  //   危害是「账本挡住了但接口说成功」——本项目诚实线要求拒绝必须说清为什么、拒到哪天。
  assert.equal(r.statusCode, 409, '未到期必须是 409（实得 ' + r.statusCode + '，body=' + (r.body || '').slice(0, 160) + '）');
  assert.ok(/未到期|还没到期/.test(r.body || ''), '409 文案须说清「还没到期」，不能是一句无来由的拒绝：' + (r.body || '').slice(0, 160));
  assert.ok(/到期日/.test(r.body || ''), '409 文案须给出到期日，让人知道什么时候能答：' + (r.body || '').slice(0, 160));
});
