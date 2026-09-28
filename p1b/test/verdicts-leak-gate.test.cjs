'use strict';
/**
 * p1b/test/verdicts-leak-gate.test.cjs —— 判词层「结算后才生成」闸（2026-09-29）
 *
 * 【病象：不是"有一笔坏账"，是整层语义错了】
 *   判词这一层被读成「题还没结算时，模型给出的倾向」；实测生产库 5156 行判词
 *   **全部**写于其父题结算**之后**（`v.created_at > p.resolved_at` 5156/5156，
 *   父题未结算者 0 条）——它们是已揭晓题的事后读数，不是信息差信号。
 *   一行读数当信号用，Brier 读出来的是"模型会后见之明"而不是"模型会预判"。
 *
 * 【修法：把语义写进列里，让读侧不必靠人记】
 *   ① `verdicts.leak_state`（可空、默认 NULL、带 CHECK）：`clean` / `legacy_post_settlement` / `quarantined`。
 *      ★**历史 5156 行靠 NULL 默认自然落进 legacy 桶，源码里零 `UPDATE verdicts`**（本文件有源码锁钉死）。
 *   ② 写侧三态（纯函数 `leakState`，照 `predictionsStore.maturityState` 的 `{state,why}` 形状）：
 *      `clean` 正常写 / `post_settlement` 拒写 / `legacy` 放行但 `excluded++` 披露。
 *   ③ HTTP：post_settlement → **409**（照 `not_due` 文案形状，说清为什么拒、什么时候能写）。
 *      ★不许吞成 200 + 空体——那是本项目吃过一次亏的坑（routes/predictions.js:504-508 原注）。
 *   ④ 读侧：`verdicts_clean` 视图收口，读侧站点只需 `FROM verdicts` → `FROM verdicts_clean`。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const predictions = require('../src/db/predictionsStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-leak-gate-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const conn = () => db.getConnection();
const j = (r) => r.json();
let gameId = null;
let PID = 0;

/** 落一行题（source_type 取自 store 枚举，不手抄字面量）。 */
function makePrediction(statement) {
  const row = predictions.insertPrediction({
    gameId: gameId, day: 1, sourceType: '预测卡', statement: statement, prob: 0.5, layer: 'L3', evidence: [],
  });
  PID = row.id;
  return row.id;
}

/**
 * 让父题"已于 minutesAgo 分钟前结算"。
 * ★为什么要多这一步：`resolvePrediction` 把 resolved_at 写成 `datetime('now')`，而 SQLite 的
 *   datetime 是**秒级**——在同一秒里 resolve 完再写判词，判词并不真的"晚于"结算，闸按
 *   `created_at <= resolved_at`（同秒算 clean，见 ⑤a）会照常放行，那样测的就不是这道闸了。
 *   所以夹具把父题的结算时刻**回拨**，让"晚于"变得可观测。
 *   回拨的是本测试 :memory: 库里的 **predictions** 行；verdicts 行一个字节都不许回拨
 *   （账本不可变铁律在测试里同样不绕）。
 */
function settleInThePast(pid, outcome, minutesAgo) {
  const r = predictions.resolvePrediction(pid, outcome, '闸夹具：真值');
  assert.equal(r.ok, true, '夹具结算本身失败：' + JSON.stringify(r));
  conn().prepare("UPDATE predictions SET resolved_at = datetime('now', ?) WHERE id = ?").run('-' + minutesAgo + ' minutes', pid);
}

const verdictRows = (pid) => conn().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pid);
const countRows = (pid) => conn().prepare('SELECT COUNT(*) AS n FROM verdicts WHERE prediction_id = ?').get(pid).n;

test('建局（造行的落点）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '判词时序闸局', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  gameId = j(r).game.id;
});

// ─────────────── ① 判词早于结算 ⇒ 正常写 ───────────────

test('★①a 父题未结算时写判词 ⇒ 正常落库，leak_state=clean', () => {
  const pid = makePrediction('①a 题未结算');
  const { saveVerdict } = require('../src/db/verdictsStore');
  const row = saveVerdict({
    predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2,
    verdictText: '①a 结算前生成的判词。\nRange: 10%-20%\nP=0.15', impliedProb: 0.15,
  });
  assert.equal(row.ok, true, '成功路径须带 ok:true（否则调用方分不出拒写）');
  assert.equal(row.leak_state, 'clean', '结算前生成的判词是 clean');
  assert.equal(countRows(pid), 1);
});

test('★①b 先写判词、后结算 ⇒ 仍是 clean（判词 created_at 早于/等于父题 resolved_at）', () => {
  const pid = makePrediction('①b 先写后结算');
  const { saveVerdict } = require('../src/db/verdictsStore');
  saveVerdict({ predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '①b 结算前生成。\nP=0.30', impliedProb: 0.3 });
  const r = predictions.resolvePrediction(pid, 'true', '①b 真值');
  assert.equal(r.ok, true, '父题结算本身不该被这道闸影响');
  const row = verdictRows(pid)[0];
  const parent = conn().prepare('SELECT resolved_at FROM predictions WHERE id = ?').get(pid);
  assert.ok(String(row.created_at) <= String(parent.resolved_at),
    '构造前提失效：判词 ' + row.created_at + ' 晚于结算 ' + parent.resolved_at + '（本用例就无从验证「早于」）');
  assert.equal(row.leak_state, 'clean');
});

test('★①c 父题已结算、但结算时刻在判词之后 ⇒ 正常写（这一支不是死代码）', () => {
  // 为什么夹具要把父题的结算时刻设到"将来"：`leakStateOf` 取的是**库钟**，所以"判词早于结算"
  // 在写侧只能发生在父题还没结算、或父题在别处（另一个进程/批处理的下一轮）才落定时。
  // 真实链路对应"跑批跑到一半题才结算"那一类；没有这个夹具，clean 的第二支就没有端到端覆盖，
  // 拆掉它（变异注入 kill-clean）会只红在纯函数那条上。
  const pid = makePrediction('①c 结算在将来');
  assert.equal(predictions.resolvePrediction(pid, 'true', '①c 真值').ok, true);
  conn().prepare("UPDATE predictions SET resolved_at = datetime('now', ?) WHERE id = ?").run('+1 hour', pid);
  const { saveVerdict } = require('../src/db/verdictsStore');
  const row = saveVerdict({ predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '①c 结算前生成。\nP=0.25', impliedProb: 0.25 });
  assert.equal(row.ok, true, '判词早于结算就必须能写：' + JSON.stringify(row));
  assert.equal(row.leak_state, 'clean');
  assert.equal(countRows(pid), 1);
});

// ─────────────── ② 判词晚于结算 ⇒ 拒写且行数不变 ───────────────

test('★②a 父题已结算后写判词 ⇒ saveVerdict 拒写（ok:false/post_settlement），行数不变', () => {
  const pid = makePrediction('②a 题已结算');
  settleInThePast(pid, 'false', 30);
  const before = countRows(pid);
  const { saveVerdict } = require('../src/db/verdictsStore');
  const r = saveVerdict({ predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '②a 结算后才生成。\nP=0.80', impliedProb: 0.8 });
  assert.equal(r.ok, false, '结算后生成的判词必须被拒');
  assert.equal(r.reason, 'post_settlement', '拒因须可机读（路由靠它映射 409）');
  assert.ok(r.why && r.why.length > 10, '拒因必须自带一句人话（照 maturityState 的 why）');
  assert.ok(r.resolved_at, '拒因须带父题结算时间戳（人话里要能指出判据落在哪个时刻）');
  assert.equal(countRows(pid), before, '★拒写必须真的没写：verdict 行数不得变');
});

test('★②b 拒写后连撞三次（三路）仍为零行——闸不许只挡住一路', () => {
  const pid = makePrediction('②b 三路各撞一次');
  settleInThePast(pid, 'true', 30);
  const { saveVerdict } = require('../src/db/verdictsStore');
  for (const v of ['v1_evidence', 'v2_skeptical', 'v3_baserate']) {
    const r = saveVerdict({ predictionId: pid, promptVariant: v, temperature: 0.2, verdictText: '②b ' + v + '。\nP=0.50', impliedProb: 0.5 });
    assert.equal(r.ok, false, v + ' 这一路也必须被拒');
  }
  assert.equal(countRows(pid), 0, '三路全被拒 ⇒ 仍是零行');
});

test('★②c HTTP：POST verdicts 打在已结算题上 ⇒ 409，且不吞成 200+空体', async () => {
  const pid = makePrediction('②c HTTP 闸');
  settleInThePast(pid, 'true', 30);
  const before = countRows(pid);
  const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(r.statusCode, 409, '★必须是 409（账本已封口时再写判词＝200 空体＝骗人）');
  const body = r.body;
  assert.ok(body && body.indexOf('已结算') >= 0, '409 文案须说清为什么拒：' + body.slice(0, 200));
  assert.ok(body.indexOf('结算之前') >= 0, '409 文案须说清什么时候能写：' + body.slice(0, 200));
  assert.equal(countRows(pid), before, '★被拒后行数不变');
  assert.equal(predictions.getPrediction(pid).outcome, 'true', '闸不得顺手改父题任何列');
});

test('★②d 409 文案与 200 文案都禁出现「预测」二字（披露纪律，同 audit-kpi.test.cjs:35）', async () => {
  const pid = makePrediction('②d 禁词');
  settleInThePast(pid, 'true', 30);
  const bad = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(bad.statusCode, 409, '本用例的前提就是 409，别让它悄悄变成 200：' + bad.body.slice(0, 200));
  assert.equal(/预测/.test(bad.body), false, '409 文案含禁词：' + bad.body.slice(0, 200));
  const okPid = makePrediction('②d 放行侧禁词');
  const ok = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + okPid + '/verdicts' });
  assert.equal(ok.statusCode, 200);
  assert.equal(/预测/.test(ok.body), false, '200 文案含禁词：' + ok.body.slice(0, 200));
});

test('★②e 未结算题上 POST 仍 200 且三路齐落（闸不许把正常写路径一起打死）', async () => {
  const pid = makePrediction('②e 未结算正常路径');
  const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(r.statusCode, 200, '未结算题上写判词是本闸的正常路径，不许被误伤：' + r.body.slice(0, 200));
  const b = j(r);
  assert.equal(b.saved.length, 3, '三路全落');
  assert.equal(b.errors.length, 0, JSON.stringify(b.errors));
  assert.equal(countRows(pid), 3);
  for (const row of verdictRows(pid)) assert.equal(row.leak_state, 'clean');
});

// ─────────────── ③ 历史行（leak_state NULL）⇒ 读路径计入排除数并披露 ───────────────

test('★③a 历史行（leak_state NULL）不进 verdicts_clean，计入排除数并披露', () => {
  const pid = makePrediction('③a 历史行');
  // 造一行"闸上线之前写的行"：直接 INSERT 且不给 leak_state ⇒ 列默认值 NULL。
  // ★这是**新增**行，不是改任何既有行——账本不可变铁律在测试里也不许绕。
  conn().prepare('INSERT INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob)'
    + ' VALUES (?, ?, ?, ?, ?)')
    .run(pid, 'v1_evidence', 0.2, '③a 闸前的行（历史行，leak_state 缺省 NULL）。\nP=0.66', 0.66);
  const legacy = verdictRows(pid)[0];
  assert.equal(legacy.leak_state, null, '缺省必须是 NULL（历史行自然落进 legacy 桶，不靠回填）');

  const views = require('../src/db/verdictsViews');
  const cleanRows = conn().prepare('SELECT * FROM verdicts_clean WHERE prediction_id = ?').all(pid);
  assert.equal(cleanRows.length, 0, '★NULL 行不得出现在 clean 视图里（视图是读侧收口）');

  const dis = views.leakDisclosure(pid);
  assert.equal(dis.total_excluded, 1, '排除数须如实计到 1');
  assert.equal(dis.legacy_unknown, 1, '这 1 行属"闸前的历史行"桶（没核实过，不许说成已知合规）');
  assert.equal(dis.clean, 0);
  assert.ok(dis.note && dis.note.indexOf('1') >= 0, 'note 须把排除数写出来（照 l6 的 excluded++ 披露形状）');
  assert.equal(/预测/.test(dis.note), false, '披露文案含禁词：' + dis.note);
});

test('★③b clean 行与 legacy 行混在一题时：clean 进视图、legacy 只进排除数', async () => {
  const pid = makePrediction('③b 混桶');
  const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(r.statusCode, 200, r.body.slice(0, 200));
  // 温度取 0.9：路由固定跑 0.2/0.7/1.0，0.9 这条路由索引位是空的（UNIQUE 索引含 temperature）
  conn().prepare('INSERT INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text)'
    + ' VALUES (?, ?, ?, ?)').run(pid, 'v2_skeptical', 0.9, '③b 闸前行。\nP=0.44');
  const views = require('../src/db/verdictsViews');
  const clean = conn().prepare('SELECT * FROM verdicts_clean WHERE prediction_id = ? ORDER BY id').all(pid);
  assert.equal(clean.length, 3, 'clean 视图只收 3 行 clean（闸后写的），legacy 行不混返');
  for (const row of clean) assert.equal(row.leak_state, 'clean');
  const dis = views.leakDisclosure(pid);
  assert.equal(dis.clean, 3);
  assert.equal(dis.total_excluded, 1);
  assert.equal(dis.legacy_unknown, 1);
});

test('★③c 读侧收口函数 listVerdictsClean：数组 + 排除数一起给（禁静默吞行）', () => {
  const pid = makePrediction('③c 读侧收口');
  const { saveVerdict } = require('../src/db/verdictsStore');
  saveVerdict({ predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '③c clean 行。\nP=0.20', impliedProb: 0.2 });
  conn().prepare('INSERT INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text)'
    + ' VALUES (?, ?, ?, ?)').run(pid, 'v3_baserate', 0.9, '③c 闸前行。\nP=0.70');
  const views = require('../src/db/verdictsViews');
  const out = views.listVerdictsClean(pid);
  assert.equal(out.items.length, 1, '只返 clean 行');
  assert.equal(out.excluded, 1, '排除数与 items 同行返回');
  assert.ok(out.note && out.note.indexOf('1') >= 0, 'note 必须把排除数写出来（照 l6 的 excluded++ 形状）：' + out.note);
  assert.equal(/预测/.test(out.note), false, '披露文案含禁词：' + out.note);
});

test('★③d 显式豁免（legacy 态）放行但必须披露 excluded（照 l6 的 excluded++ 形状）', () => {
  const pid = makePrediction('③d 显式豁免');
  settleInThePast(pid, 'true', 30);
  const { saveVerdict } = require('../src/db/verdictsStore');
  const r = saveVerdict(
    { predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '③d 明知而豁免的读数行。\nP=0.35', impliedProb: 0.35 },
    { allowPostSettlement: true });
  assert.equal(r.ok, true, '显式豁免要放行（读数实验整层的历史口径就靠这个口继续跑）');
  assert.equal(r.leak_state, 'legacy_post_settlement', '豁免行必须自报家门，不许冒充 clean');
  assert.equal(r.excluded, 1, '★放行不等于免费：返回值必须带 excluded++ 披露');
  assert.ok(r.leak_note && r.leak_note.length > 10, '须带一句人话说明为何被排除');
  const row = verdictRows(pid)[0];
  assert.equal(row.leak_state, 'legacy_post_settlement');
  assert.equal(conn().prepare('SELECT * FROM verdicts_clean WHERE prediction_id = ?').all(pid).length, 0,
    '豁免行同样不进 clean 视图');
  const dis = require('../src/db/verdictsViews').leakDisclosure(pid);
  assert.equal(dis.legacy_post_settlement, 1);
  assert.equal(dis.clean, 0);
  assert.equal(dis.total_excluded, 1);
});

test('★③e HTTP 路由一律不得透传豁免口（透传即等于把这道闸拆掉）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'verdicts.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/allowPostSettlement/.test(code), false, '路由代码里出现了豁免口（注释里可以解释它，但代码里不许用）');
  assert.equal(/leakState/.test(code), true, '路由必须调 store 的判定函数，不许自己写一套时序比较');
});

// ─────────────── ④ 结构：加列是 additive，历史行不回填 ───────────────

test('★④a 旧表（无 leak_state 列）经 ensure 后补列，旧行仍 NULL 且行数逐字不变', () => {
  // 独立 :memory: 库，造一张**闸上线前形状**的 verdicts 表（不建新列、不建新索引）。
  // better-sqlite3 不在 p1b 的依赖里（零新依赖铁律），走 p1a-terminal 那一份——
  // 与 p1b/src/deps.js 同一个 require 路径，不引入第二个驱动。
  const raw = require(path.join(__dirname, '..', '..', 'p1a-terminal', 'node_modules', 'better-sqlite3'));
  const c = new raw(':memory:');
  c.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, resolved_at TEXT)');
  c.exec("INSERT INTO predictions (id, resolved_at) VALUES (1, '2026-01-01 00:00:00')");
  c.exec('CREATE TABLE verdicts ('
    + ' id INTEGER PRIMARY KEY, prediction_id INTEGER NOT NULL REFERENCES predictions(id),'
    + " prompt_variant TEXT NOT NULL CHECK(prompt_variant IN ('v1_evidence','v2_skeptical','v3_baserate')),"
    + ' temperature REAL NOT NULL CHECK(temperature BETWEEN 0 AND 1),'
    + ' verdict_text TEXT NOT NULL,'
    + ' implied_prob REAL CHECK(implied_prob IS NULL OR (implied_prob >= 0 AND implied_prob <= 1)),'
    + ' model TEXT, run_id TEXT, resolved_model TEXT,'
    + " created_at TEXT DEFAULT (datetime('now')));");
  c.exec("INSERT INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob)"
    + " VALUES (1, 'v1_evidence', 0.2, '闸上线前就落着的一行。\nP=0.42', 0.42)");
  const before = c.prepare('SELECT * FROM verdicts').all();

  const { ensureVerdictsTable } = require('../src/db/verdictsStore');
  ensureVerdictsTable(c);

  const cols = c.prepare('PRAGMA table_info(verdicts)').all().map((x) => x.name);
  assert.ok(cols.indexOf('leak_state') >= 0, '补列后必须有 leak_state');
  const after = c.prepare('SELECT * FROM verdicts').all();
  assert.equal(after.length, before.length, '★补列不得增删行');
  assert.equal(after[0].leak_state, null, '★旧行必须仍是 NULL（零 backfill：不许 UPDATE verdicts SET leak_state）');
  for (const k of Object.keys(before[0])) {
    assert.deepEqual(after[0][k], before[0][k], '旧行既有列被改动了：' + k);
  }
  c.close();
});

test('★④b CHECK 只放行三个白名单取值（写脏值必须炸）', () => {
  const pid = makePrediction('④b CHECK');
  // 温度逐条不同：UNIQUE 路由索引含 temperature，同 pid 同变体同温度会撞（那是既有契约，不是本用例要点）
  const insert = (t, leak) => conn().prepare("INSERT INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, leak_state)"
    + " VALUES (?, 'v1_evidence', ?, ?, ?)").run(pid, t, '④b 行 T=' + t + '。\nP=0.50', leak);
  assert.throws(() => insert(0.2, 'ok_ish'), /CHECK|constraint/i,
    'leak_state 必须受 CHECK 约束（自由文本＝闸可被一句话绕过）');
  insert(0.3, 'clean');
  insert(0.4, 'legacy_post_settlement');
  insert(0.5, 'quarantined');
  insert(0.6, null);
  assert.equal(countRows(pid), 4, '三个白名单值 + NULL 都要能落（四条）');
  const clean = conn().prepare('SELECT * FROM verdicts_clean WHERE prediction_id = ? ORDER BY id').all(pid);
  assert.equal(clean.length, 1, 'clean 视图只收 leak_state=\'clean\' 那一行');
});

test('★④c 源码锁：verdicts 层两个文件里不许出现全表回填或删除', () => {
  for (const f of ['db/verdictsStore.js', 'db/verdictsViews.js', 'routes/verdicts.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [pat, why] of [
      [/UPDATE\s+verdicts/i, '回填 UPDATE'],
      [/DELETE\s+FROM\s+verdicts/i, 'DELETE'],
      [/DROP\s+TABLE\s+verdicts/i, 'DROP TABLE'],
      [/\bTRIGGER\b/i, '触发器（全仓零先例，且会抢跑 writepath）'],
    ]) {
      assert.equal(pat.test(code), false, f + ' 的代码里出现了' + why + ' ⇒ 账本不可变铁律被破了');
    }
  }
});

test('★④d 视图是 additive：两次 ensure 不炸，且视图只收 clean', () => {
  const views = require('../src/db/verdictsViews');
  const c = conn();
  views.ensureVerdictsCleanView(c);
  views.ensureVerdictsCleanView(c);
  const isView = c.prepare("SELECT type FROM sqlite_master WHERE name = 'verdicts_clean'").get();
  assert.equal(isView.type, 'view', 'verdicts_clean 必须是视图（不是表——表会把读侧变成又一个要维护的副本）');
  const total = c.prepare('SELECT COUNT(*) AS n FROM verdicts').get().n;
  const clean = c.prepare('SELECT COUNT(*) AS n FROM verdicts_clean').get().n;
  const excluded = c.prepare('SELECT COUNT(*) AS n FROM verdicts WHERE leak_state IS NULL OR leak_state <> \'clean\'').get().n;
  assert.equal(clean + excluded, total, '★clean 视图行数 + 排除行数 == 全表行数（桶不许漏不许重）');
  assert.ok(clean > 0, '本测试库里应当有 clean 行');
  assert.ok(excluded > 0, '本测试库里应当有被排除行（闸前的历史行）');
});

// ─────────────── ⑤ 三态判定是纯函数（照 maturityState 的形状） ───────────────

test('★⑤a leakState 纯函数：三态互斥、每态自带不同的人话', () => {
  const { leakState } = require('../src/db/verdictsStore');
  const open = leakState({ resolvedAt: null, now: '2026-09-29 10:00:00' });
  assert.equal(open.state, 'clean', '父题未结算 ⇒ 没有结算可越过 ⇒ clean');

  const before = leakState({ resolvedAt: '2026-09-29 10:00:05', now: '2026-09-29 10:00:00' });
  assert.equal(before.state, 'clean', '判词早于结算 ⇒ clean');
  assert.equal(before.why.indexOf('10:00:00') >= 0, true, 'why 要把两个时刻摆出来：' + before.why);

  const after = leakState({ resolvedAt: '2026-09-29 10:00:00', now: '2026-09-29 10:00:05' });
  assert.equal(after.state, 'post_settlement', '判词晚于结算 ⇒ post_settlement');

  const same = leakState({ resolvedAt: '2026-09-29 10:00:00', now: '2026-09-29 10:00:00' });
  assert.equal(same.state, 'clean', '同秒（SQLite datetime 秒级）算"不晚于" ⇒ clean（闸不许因为时钟分辨率而误伤）');

  const exempt = leakState({ resolvedAt: '2026-09-29 10:00:00', now: '2026-09-29 10:00:05', exempt: true });
  assert.equal(exempt.state, 'legacy', '显式豁免 ⇒ legacy（放行但披露）');

  const whys = [open.why, before.why, after.why, exempt.why];
  assert.equal(new Set(whys).size, whys.length, '★四句话互不相同（三态的价值就在于"说得清是哪一种"）');
  for (const w of whys) {
    assert.equal(/预测/.test(w), false, 'why 含禁词：' + w);
  }
});

test('★⑤b 判据复用既有比较口径（全时间戳字面比较，不按日历日截断）', () => {
  const { leakState } = require('../src/db/verdictsStore');
  // 生产库实测：5156 行判词全部晚于父题结算，但其中 **964 行与结算同日**。
  // 若按日历日比较，这 964 行会被判成 clean ⇒ 闸在这些行上等于没装。
  const sameDayLater = leakState({ resolvedAt: '2026-09-11 13:36:18', now: '2026-09-11 18:51:09' });
  assert.equal(sameDayLater.state, 'post_settlement',
    '同日但晚 5 小时的判词仍算结算后——按日截断会把 964 行生产行判成 clean');
  // 既有口径锚：truthBasis.isTruthBasisDefect（p1b/src/evidence/truthBasis.js:47）用的就是
  // String(a) >= String(b) 的全时间戳字面比较，不是 maturityState 的日历日比较。
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'evidence', 'truthBasis.js'), 'utf8');
  assert.ok(/String\(ra\)\s*>=\s*String\(ma\)/.test(src), '既有比较口径锚不在原位了，本测试的依据需要重核');
});

test('★⑤c 判词不落库时的父题取不到 ⇒ 如实报缺，不许当 clean 放过去', () => {
  const { saveVerdict } = require('../src/db/verdictsStore');
  assert.throws(
    () => saveVerdict({ predictionId: 99999999, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '⑤c 孤儿行。\nP=0.50' }),
    /prediction|外键|foreign/i,
    '父题不存在时必须炸（判据需要父题的 resolved_at，取不到就不能判 clean）');
});
