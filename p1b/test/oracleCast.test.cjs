'use strict';
/**
 * p1b/test/oracleCast.test.cjs —— 独立玄学排盘 W1 测试（node:test + fastify inject，不起真端口）。
 * 覆盖：时间起卦锚点（2026-09-25 12:00 中秋·八月十五·午时 → A=30,B=37 水风井，冻结自
 *   p9-anchor-probe.cjs 实测 + 公开历表事实）/ 历法口径冻结（春节/闰六月/正月初一年界/晚子时）/
 *   三法管线单源（与 meihua.qiGuaByNumbers 直调一致）/ random 形状与注入确定性 /
 *   API 形状+落档+历史回读+分页+game_id 挂局（自由排盘 NULL）。
 * 铁律：DB=:memory:；providers 指向 os.tmpdir() 临时文件；绝不外呼真实 API；恒挂「娱乐参考」。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const meihua = require('../src/lib/meihua.js');
const { castByNumbers, castByTime, castByRandom, lunarComponents, DISCLAIMER } = require('../src/lib/oracleCast');
const { MAX_MANUAL_NUMBER } = require('../src/routes/oracleCast');

const tmpProviders = path.join(os.tmpdir(), 'p1b-oraclecast-test-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
let numbersAnchorId = null;   // POST (7,3) 的落档 id（回读逐字段一致用）
let numbersAnchorCasting = null;
let attachId = null;          // 挂局 cast 的落档 id（新→旧排序断言用）
let attachedGameId = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

// ── 时间起卦（历法锚点，冻结自 p9-anchor-probe.cjs 实测 + 公开历表事实）──
test('时间起卦锚点：2026-09-25 12:00（中秋·八月十五·午时）→ A=30,B=37 水风井·动1·互火泽睽·变水天需·体坎水/用巽木·体生用', () => {
  const c = castByTime(new Date(2026, 8, 25, 12, 0, 0));
  assert.deepEqual(c.numbers, { a: 30, b: 37 });
  assert.equal(c.benGua.fullName, '水风井');
  assert.equal(c.huGua.fullName, '火泽睽');
  assert.equal(c.bianGua.fullName, '水天需');
  assert.equal(c.dongYao, 1);
  assert.equal(c.ti.trigram, '坎');
  assert.equal(c.ti.wuXing, '水');
  assert.equal(c.yong.trigram, '巽');
  assert.equal(c.yong.wuXing, '木');
  assert.equal(c.tiYongRelation, '体生用');
  // 农历输入留档（公开历表事实：2026-09-25=中秋节八月十五，丙午年）
  assert.equal(c.derived_from.lunar_month, 8);
  assert.equal(c.derived_from.lunar_day, 15);
  assert.equal(c.derived_from.leap_month, false);
  assert.equal(c.derived_from.year_zhi, '午');
  assert.equal(c.derived_from.hour_zhi, '午');
  assert.equal(c.derived_from.method, 'time');
  assert.match(c.derived_from.calendar, /^lunar-javascript@/);
});

test('历法口径冻结（公开历表事实核验，p9-anchor-probe.cjs 实测）：春节锚/闰六月记法/正月初一年界/晚子时', () => {
  // 春节 2026-02-17 = 正月初一（公开历表事实）
  const chunjie = lunarComponents(new Date(2026, 1, 17, 0, 0, 0));
  assert.equal(chunjie.lunar_month, 1);
  assert.equal(chunjie.lunar_day, 1);
  // 2025-08-01 落闰六月（公开历表事实）→ lunar-javascript 负数记闰，本实现取本宫 6
  const run = lunarComponents(new Date(2025, 7, 1, 12, 0, 0));
  assert.equal(run.leap_month, true);
  assert.equal(run.lunar_month, 6);
  // 年界：2026-02-05（立春 02-04 后、春节 02-17 前）→ 年支=巳 ⇒ 正月初一换年口径（非立春界）
  const boundary = lunarComponents(new Date(2026, 1, 5, 12, 0, 0));
  assert.equal(boundary.year_zhi, '巳');
  // 晚子时：23:30 → 时支=子、农历日仍当日（默认 sect 口径）
  const zi = lunarComponents(new Date(2026, 8, 25, 23, 30, 0));
  assert.equal(zi.hour_zhi, '子');
  assert.equal(zi.lunar_day, 15);
});

test('三法管线单源：castByTime/castByRandom/castByNumbers 结果与 meihua.qiGuaByNumbers 直调一致（零复制卦理）', () => {
  const t = castByTime(new Date(2026, 8, 25, 12, 0, 0));
  const direct = meihua.qiGuaByNumbers(30, 37);
  assert.equal(t.benGua.fullName, direct.benGua.fullName);
  assert.equal(t.huGua.fullName, direct.huGua.fullName);
  assert.equal(t.bianGua.fullName, direct.bianGua.fullName);
  assert.equal(t.dongYao, direct.dongYao);
  assert.equal(t.tiYongRelation, direct.tiYongRelation);

  const r = castByRandom(() => 123); // 注入恒值
  const rd = meihua.qiGuaByNumbers(123, 123);
  assert.equal(r.benGua.fullName, rd.benGua.fullName);
  assert.equal(r.dongYao, rd.dongYao);

  const n = castByNumbers(7, 3); // meihua README 冻结锚点：贲(7,3)=本卦
  assert.equal(n.benGua.fullName, '山火贲');
  const nd = meihua.qiGuaByNumbers(7, 3);
  assert.equal(n.dongYao, nd.dongYao);
  assert.equal(n.bianGua.fullName, nd.bianGua.fullName);
});

test('确定性：castByTime 同时刻恒同卦；castByRandom 注入序列端界（1/512）确定性可测', () => {
  const d = new Date(2026, 8, 25, 12, 0, 0);
  assert.deepEqual(castByTime(d), castByTime(d));
  let call = 0;
  const seq = () => [1, 512][call++]; // 第一次取下界 1、第二次取上界 512（闭区间缝）
  const s = castByRandom(seq);
  assert.deepEqual(s.numbers, { a: 1, b: 512 });
  assert.equal(s.derived_from.source, 'injected');
  // rem8(1)=1 乾上 / rem8(512)=0→8 坤下 → 天地否；动爻 rem6(513)=3
  assert.equal(s.benGua.fullName, '天地否');
  assert.equal(s.dongYao, 3);
});

test('random 形状：缺省 CSPRNG 20 次采样全部 1..512 整数、casting 结构完整、source=crypto.randomInt', () => {
  for (let i = 0; i < 20; i++) {
    const c = castByRandom();
    assert.ok(Number.isInteger(c.numbers.a) && c.numbers.a >= 1 && c.numbers.a <= 512, 'a 越界: ' + c.numbers.a);
    assert.ok(Number.isInteger(c.numbers.b) && c.numbers.b >= 1 && c.numbers.b <= 512, 'b 越界: ' + c.numbers.b);
    assert.ok(c.benGua && c.benGua.fullName, '缺本卦');
    assert.ok(c.huGua && c.bianGua, '缺互/变卦');
    assert.ok(c.dongYao >= 1 && c.dongYao <= 6, '动爻越界');
    assert.equal(c.derived_from.source, 'crypto.randomInt');
  }
});

test('非法输入拒绝：castByTime 非 Date/Invalid Date；castByNumbers 0/负数（meihua 自校验透传）', () => {
  assert.throws(() => castByTime('2026-09-25'), /Date/);
  assert.throws(() => castByTime(new Date('not-a-date')), /Date/);
  assert.throws(() => castByNumbers(0, 3), /数A/);
  assert.throws(() => castByNumbers(7, -1), /数B/);
});

test('DISCLAIMER 单源：lib/oracleCast 复用 lib/oracle 的「娱乐参考」（不另立字符串）', () => {
  assert.equal(DISCLAIMER, '娱乐参考');
});

// ── API（MOCK 模式，:memory: db）──
test('POST /api/oracle/cast numbers：201+形状+冻结锚(7,3)→山火贲+disclaimer 精确+verdict NULL+game_id NULL', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'numbers', params: { n1: 7, n2: 3 } } });
  assert.equal(r.statusCode, 201);
  const b = r.json();
  assert.equal(b.method, 'numbers');
  assert.deepEqual(b.inputs, { n1: 7, n2: 3 });
  assert.equal(b.casting.benGua.fullName, '山火贲');
  assert.equal(b.disclaimer, '娱乐参考'); // 恒挂标注，精确相等
  assert.equal(b.verdict, null);          // 断语属推断层，排盘落档先留结构位
  assert.equal(b.game_id, null);          // 自由排盘不挂局
  assert.equal(typeof b.id, 'number');
  assert.equal(typeof b.created_at, 'string');
  numbersAnchorId = b.id;
  numbersAnchorCasting = b.casting;
});

test('POST cast 校验：n1=0 / 缺 n2 / 非整数 / 超防滥用上限 / 非法 method / 缺 method → 全 400', async () => {
  const bad = [
    { method: 'numbers', params: { n1: 0, n2: 3 } },
    { method: 'numbers', params: { n1: 7 } },
    { method: 'numbers', params: { n1: 'abc', n2: 3 } },
    { method: 'numbers', params: { n1: MAX_MANUAL_NUMBER + 1, n2: 3 } },
    { method: 'bogus' },
    {},
  ];
  for (const payload of bad) {
    const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload });
    assert.equal(r.statusCode, 400, 'payload=' + JSON.stringify(payload) + ' → ' + r.statusCode + ' ' + r.body);
  }
});

test('POST cast time：固定 ISO 锚点与 lib castByTime 同卦+inputs 留档；缺 date=当前时刻 smoke', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'time', params: { date: '2026-09-25T12:00:00' } } });
  assert.equal(r.statusCode, 201);
  const b = r.json();
  const local = castByTime(new Date(2026, 8, 25, 12, 0, 0));
  assert.deepEqual(b.casting.numbers, local.numbers);
  assert.deepEqual(b.casting.numbers, { a: 30, b: 37 });
  assert.equal(b.casting.benGua.fullName, '水风井');
  assert.equal(b.inputs.date, '2026-09-25T12:00:00');
  assert.equal(b.casting.derived_from.local_time, '2026-09-25T12:00:00');
  assert.equal(b.disclaimer, '娱乐参考');

  const now = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'time' } });
  assert.equal(now.statusCode, 201);
  const nb = now.json();
  assert.ok(nb.casting.benGua && nb.casting.benGua.fullName, '缺本卦');
  assert.equal(nb.casting.derived_from.method, 'time');
  assert.equal(nb.inputs.date, null);
});

test('POST cast time 非法 date → 400', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'time', params: { date: '无法解析的日子' } } });
  assert.equal(r.statusCode, 400);
});

test('POST cast random：201+两数 1..512+形状+disclaimer', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'random' } });
  assert.equal(r.statusCode, 201);
  const b = r.json();
  assert.equal(b.method, 'random');
  assert.deepEqual(b.inputs, {});
  assert.ok(b.casting.numbers.a >= 1 && b.casting.numbers.a <= 512);
  assert.ok(b.casting.numbers.b >= 1 && b.casting.numbers.b <= 512);
  assert.ok(b.casting.benGua.fullName);
  assert.equal(b.disclaimer, '娱乐参考');
});

test('game_id 挂局：建局→cast 带 game_id 落档关联；(8,16)→坤为地·动6·变山地剥（meihua README 变卦锚）；不存在→404', async () => {
  const cg = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '排盘挂局测试', type: 'werewolf', player_count: 6 } });
  assert.equal(cg.statusCode, 201);
  attachedGameId = cg.json().game.id;
  const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'numbers', params: { n1: 8, n2: 16 }, game_id: attachedGameId } });
  assert.equal(r.statusCode, 201);
  const b = r.json();
  assert.equal(b.game_id, attachedGameId);
  assert.equal(b.casting.benGua.fullName, '坤为地');
  assert.equal(b.casting.dongYao, 6);
  assert.equal(b.casting.bianGua.fullName, '山地剥');
  attachId = b.id;
  const miss = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'numbers', params: { n1: 8, n2: 16 }, game_id: 999999 } });
  assert.equal(miss.statusCode, 404);
});

test('GET /api/oracle/readings：回读=落档证据（新→旧，首条=挂局行），total ≥ 5', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=100' });
  assert.equal(r.statusCode, 200);
  const a = r.json();
  assert.ok(a.total >= 5, '至少落档 5 行（numbers/time锚/time now/random/挂局），total=' + a.total);
  assert.ok(a.items.length <= 100);
  assert.equal(a.items[0].id, attachId);
  assert.equal(a.items[0].game_id, attachedGameId);
  assert.equal(a.limit, 100);
  assert.equal(a.offset, 0);
});

test('回读逐字段一致：readings 里的 (7,3) 行 casting 与 POST 响应 deepEqual、inputs 还原', async () => {
  const all = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=100' }).then((r) => r.json());
  const mine = all.items.find((it) => it.id === numbersAnchorId);
  assert.ok(mine, '回读缺 id=' + numbersAnchorId);
  assert.deepEqual(mine.casting, numbersAnchorCasting);
  assert.deepEqual(mine.inputs, { n1: 7, n2: 3 });
  assert.equal(mine.method, 'numbers');
});

test('分页与钳制：limit=2 首条=全量首条、offset=2 首条=全量第3条；limit=0/offset=-1→400；limit=5000 钳 100', async () => {
  const all = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=100' }).then((r) => r.json());
  const p1 = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=2&offset=0' }).then((r) => r.json());
  const p2 = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=2&offset=2' }).then((r) => r.json());
  assert.equal(p1.items.length, 2);
  assert.equal(p1.items[0].id, all.items[0].id);
  assert.equal(p1.total, all.total);
  assert.equal(p2.items[0].id, all.items[2].id);
  const zero = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=0' });
  assert.equal(zero.statusCode, 400);
  const negOff = await app.inject({ method: 'GET', url: '/api/oracle/readings?offset=-1' });
  assert.equal(negOff.statusCode, 400);
  const over = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=5000' });
  assert.equal(over.statusCode, 200);
  assert.equal(over.json().limit, 100); // 静默钳制
});

test('game_id 过滤：?game_id=挂局id 只含挂局行；自由排盘行 game_id=null 且仍在全量中', async () => {
  const f = await app.inject({ method: 'GET', url: '/api/oracle/readings?game_id=' + attachedGameId }).then((r) => r.json());
  assert.ok(f.total >= 1);
  for (const it of f.items) assert.equal(it.game_id, attachedGameId);
  const all = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=100' }).then((r) => r.json());
  assert.ok(all.items.some((it) => it.game_id === null), '自由排盘应存在');
  assert.ok(all.total > f.total, '全量应多于挂局过滤');
  const bad = await app.inject({ method: 'GET', url: '/api/oracle/readings?game_id=abc' });
  assert.equal(bad.statusCode, 400);
});

test('落档直查 DB：oracle_readings 行数与 API total 一致（better-sqlite3 直查证据）', async () => {
  const total = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=1' }).then((r) => r.json().total);
  const row = db.getConnection().prepare('SELECT COUNT(*) AS n FROM oracle_readings').get();
  assert.equal(row.n, total);
});
