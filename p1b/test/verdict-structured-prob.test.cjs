'use strict';
/**
 * p1b/test/verdict-structured-prob.test.cjs —— 判词取数换口径的闸（2026-09-29）
 *
 * 【病象：不是"数字错了"，是"数字是猜的"】
 *   `verdicts.js` 一直用「末行 P=0.xx」正则抽 implied_prob：让模型只写散文，路由再去猜它想说什么。
 *   项目两次负结果（模型自由给数 → 稳定地给错同一个数）是**真的**，但当时的解法选错了：
 *     错的解法 = 禁止模型给数字 ⇒ 逼它写散文，再猜；
 *     对的解法 = 约束它**按结构**给数字 ⇒ schema 约束 ＋ 范围校验 ＋ 越界即拒。
 *   正则那一层读得懂 "P=0.42"，读不懂 "P=0.42 附近"，也分不清
 *   「模型声明的置信度」和「散文里碰巧出现的那个 0.42」——两种东西长得一模一样。
 *
 * 【这一批的落点】
 *   ① 结构化判词块（role/direction/confidence/p/reason/abstain）→ 机械校验 → 直接读；
 *   ② p 必须是 [0,1] 的**数值**：1.5 / "大概率" / 缺失 一律拒，不编数；
 *   ③ ★缺结构化字段即拒（no_fallback），**不得回退文本抽取**；旧数据靠显式兼容开关读，
 *      新数据不许走老路；开关**默认关**；
 *   ④ 拒因可机读、可从响应里看见（不然"p 落 NULL"和"这行压根没跑"读起来一样）。
 *
 * 铁律：DB=:memory:；**零网络**（fetchImpl 夹具注入结构化响应，不调真 LLM——本用例
 *   验的是取数闸，不是供应商的 JSON 能力）；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const predictions = require('../src/db/predictionsStore');
const V = require('../src/routes/verdicts');
const S = require('../src/evidence/verdictSchema');

const FENCE = S.FENCE_TAG; // 结构化块围栏标记（与 schema 模块同源，防两处各敲一个字面量）
const FALLBACK_ENV = V.LEGACY_TEXT_FALLBACK_ENV;

// ═══════════════ 夹具 ═══════════════

/** 结构化块合法的一份（p=0.42，方向 against，档位 mid） */
const GOOD_PAYLOAD = {
  role: 'evidence_aggregation',
  direction: 'against',
  confidence: 'mid',
  p: 0.42,
  reason: '夜死公告与 2 号的指认互斥，倾向不成立。',
  abstain: false,
};

/** 把 payload 包成一段"模型响应"（散文 + 结构化块；末行 P= 照旧给，模拟仍在役的老契约行） */
function structuredText(payload, opts) {
  const o = opts || {};
  const lines = [o.prose || '夹具：证据聚合视角下的分析散文。'];
  lines.push('```' + FENCE);
  lines.push(JSON.stringify(payload));
  lines.push('```');
  if (o.range) lines.push(o.range);
  if (o.legacyP !== undefined) lines.push('P=' + o.legacyP);
  return lines.join('\n');
}

/** ★验收③ 的核心夹具：散文里**有** P=0.42，但**没有**结构化块（旧格式响应） */
const TEXT_ONLY_WITH_P = [
  '夹具：这是一段只有散文、没有结构化块的旧式判词。',
  'Range: 30%-50%',
  'P=0.42',
].join('\n');

/** 活的服务实例（fetchImpl 夹具 ⇒ LIVE 模式下三路都吃我们注入的响应） */
let app = null;
let gameId = null;
/** 假 fetch：按 system prompt 里的视角标记分派不同的响应（照 prompt 变体，不联网） */
let responder = () => TEXT_ONLY_WITH_P;

function fakeFetch(url, init) {
  let variant = 'v?';
  try {
    const body = JSON.parse((init && init.body) || '{}');
    const sys = String((body.messages && body.messages[0] && body.messages[0].content) || '');
    if (sys.indexOf('证据聚合视角') >= 0) variant = 'v1_evidence';
    else if (sys.indexOf('怀疑派视角') >= 0) variant = 'v2_skeptical';
    else if (sys.indexOf('基率视角') >= 0) variant = 'v3_baserate';
  } catch (e) { /* 夹具解析失败就走默认响应 */ }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: responder(variant) } }], usage: {} }),
  });
}

const providersPath = path.join(os.tmpdir(), 'p1b-test-verdictstruct-providers-' + process.pid + '-' + Date.now() + '.json');
const savedEnv = {};
const ENV_KEYS = ['P1B_LLM_MOCK', 'P1B_RESULT_CACHE_DIR', FALLBACK_ENV];

test.before(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.P1B_LLM_MOCK;
  delete process.env.P1B_RESULT_CACHE_DIR;   // 免得命中磁盘缓存把夹具绕过去
  delete process.env[FALLBACK_ENV];           // 默认形态：不许回退
  fs.writeFileSync(providersPath, JSON.stringify({
    active: 'fix',
    providers: { fix: { label: '夹具供应商', base_url: 'https://fixture.invalid/v1', api_key: 'fixture-key-000001', extraction: { model: 'fixture-model' } } },
  }), 'utf8');
  app = await buildServer({ dbPath: ':memory:', providersPath: providersPath, fetchImpl: fakeFetch });
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '结构化判词局', type: 'werewolf', player_count: 6 } });
  gameId = g.json().game.id;
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(providersPath); } catch (e) { /* ignore */ }
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 临时改 env（每次用完复原，避免漏复原把后面的用例染了） */
function withEnv(name, value, fn) {
  const saved = process.env[name];
  try {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env[name]; else process.env[name] = saved;
  }
}

const mkPid = (statement) => predictions.insertPrediction({
  gameId: gameId, day: 1, sourceType: '预测卡', statement: statement, prob: 0.5, layer: 'L6', evidence: [],
}).id;
const verdictRows = (pid) => db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pid);

// ═══════════════ ① 结构化正常读 ═══════════════

test('① 结构化正常读：合法块 ⇒ 直接读 p（不经文本抽取）', () => {
  const r = V.readImpliedProb(structuredText(GOOD_PAYLOAD, { range: 'Range: 35%-50%', legacyP: '0.42' }));
  assert.equal(r.prob, 0.42, '结构化块里的 p 应当被直接读出');
  assert.equal(r.source, 'structured');
  assert.equal(r.ok, true);
  assert.equal(r.structured.found, true, '可观测：结构化块确实被找到了');
  assert.equal(r.structured.value.p, 0.42);
  assert.equal(r.structured.value.abstain, false);
  // ★结构化值与散文里的 P= 行**可以不同**，且以结构化块为准：路由不再猜散文。
  const diverged = V.readImpliedProb(structuredText(Object.assign({}, GOOD_PAYLOAD, { p: 0.11 }), { legacyP: '0.42' }));
  assert.equal(diverged.prob, 0.11, '★真源是结构化块：散文末行说什么都不影响入库值');
});

test('①b 拒答标记是合法结构化块：abstain=true ⇒ p 落 NULL（不是"缺字段"）', () => {
  const r = V.readImpliedProb(structuredText({
    role: 'skeptical', direction: 'mixed', confidence: 'low', p: null,
    reason: '题面条件不足，无法给出倾向。', abstain: true,
  }, { legacyP: '0.42' }));
  assert.equal(r.ok, true, '合法拒答不是坏数据');
  assert.equal(r.prob, null, '★拒答不许带数：散文里的 P=0.42 也不许顶上来');
  assert.equal(r.source, 'structured_refusal', '拒答要自报家门（与"坏数据"读起来不一样）');
  // 拒答与 p 同时给 ⇒ 自相矛盾，拒
  const both = V.readImpliedProb(structuredText(Object.assign({}, GOOD_PAYLOAD, { abstain: true, p: 0.7 })));
  assert.equal(both.ok, false, '既说拒答又给数 = 自相矛盾，必须拒');
  assert.equal(both.prob, null);
});

// ═══════════════ ② 越界即拒，不编数 ═══════════════

test('② 越界即拒：p=1.5 / p="大概率" / p 缺失 / p=NaN 一律 NULL', () => {
  const cases = [
    ['p=1.5 越上界', 1.5],
    ['p=-0.1 越下界', -0.1],
    ['p="大概率" 文字档位冒充数值', '大概率'],
    ['p="0.42" 数字字符串不是数值', '0.42'],
    ['p=null 但 abstain=false（说了要给数却没给）', null],
    ['p 键整个缺失', undefined],
    ['p=NaN', NaN],
    ['p=Infinity', Infinity],
    ['p=true 布尔冒充数值', true],
  ];
  for (const [why, bad] of cases) {
    const payload = Object.assign({}, GOOD_PAYLOAD, { legacyP: '0.42' });
    if (bad === undefined) delete payload.p; else payload.p = bad;
    const text = structuredText(payload, { legacyP: '0.42' });
    const r = V.readImpliedProb(text);
    assert.equal(r.ok, false, why + '：必须判为坏数据');
    assert.equal(r.prob, null, why + '：★一律落 NULL，不编数（散文末行 P=0.42 也不许顶上来）');
    assert.equal(r.source, 'no_fallback_structured_invalid', why + '：拒因要可机读');
    assert.ok(r.structured.errors.length > 0, why + '：要带得出手的错在哪');
  }
});

test('②b 其他字段同样受校验：枚举越界 / 理由空 / abstain 非布尔 ⇒ 整个块作废', () => {
  const bads = [
    ['role 不在白名单', { role: 'astrologer' }],
    ['direction 不在白名单', { direction: 'probably' }],
    ['confidence 不在白名单', { confidence: '0.9' }],
    ['reason 空串', { reason: '   ' }],
    ['reason 缺字段', { reason: undefined }],
    ['abstain 非布尔', { abstain: 'yes' }],
  ];
  for (const [why, patch] of bads) {
    const payload = Object.assign({}, GOOD_PAYLOAD, patch);
    if (patch.reason === undefined) delete payload.reason;
    const r = V.readImpliedProb(structuredText(payload, { legacyP: '0.42' }));
    assert.equal(r.ok, false, why + '：必须作废');
    assert.equal(r.prob, null, why + '：★一字段不合格整块作废（不许"哪个字段能用就用哪个"）');
  }
});

test('②c 边界值合法：p=0 与 p=1 都是合法概率，不是越界', () => {
  assert.equal(V.readImpliedProb(structuredText(Object.assign({}, GOOD_PAYLOAD, { p: 0 }))).prob, 0);
  assert.equal(V.readImpliedProb(structuredText(Object.assign({}, GOOD_PAYLOAD, { p: 1 }))).prob, 1);
});

// ═══════════════ ③ ★缺结构化字段即拒，不得回退文本抽取 ═══════════════

test('★★③ 响应里只有散文 P=0.42、没有结构化字段 ⇒ p 落 NULL（不是 0.42）', () => {
  const r = V.readImpliedProb(TEXT_ONLY_WITH_P);
  assert.equal(r.structured.found, false, '前提：本响应压根没有结构化块');
  assert.equal(r.prob, null, '★★缺结构化字段即拒：绝不许回退到文本抽取把 0.42 捡回来');
  assert.equal(r.source, 'no_fallback_structured_missing', '拒因可机读');
  assert.ok(r.why && r.why.indexOf('结构化') >= 0, '要有一句人话说清为什么拒：' + r.why);
});

test('★★③b 有结构化块但 p 缺失（散文里有 P=0.42）⇒ 仍落 NULL，兼容开关也救不了', () => {
  const payload = { role: 'skeptical', direction: 'mixed', confidence: 'low', reason: '只有理由没给数。', abstain: false };
  const text = structuredText(payload, { legacyP: '0.42' });
  // 默认形态
  assert.equal(V.readImpliedProb(text).prob, null, '默认：拒');
  // ★开关只对"压根没有结构化块"生效；有块但坏 ⇒ 任何形态都拒（否则"校验不过"就有了逃生门）
  withEnv(FALLBACK_ENV, '1', () => {
    const r = V.readImpliedProb(text);
    assert.equal(r.prob, null, '★★结构化块存在但校验不过 ⇒ 开关不得放行回退（否则拒就形同虚设）');
    assert.equal(r.source, 'no_fallback_structured_invalid');
  });
});

test('★③c 非对象 / 坏 JSON 的围栏块也算"有块但坏"（不许当成"没有块"）', () => {
  const array = ['散文', '```' + FENCE, '[1,2,3]', '```', 'P=0.42'].join('\n');
  const broken = ['散文', '```' + FENCE, '{role:', '```', 'P=0.42'].join('\n');
  for (const [why, text] of [['围栏里是数组', array], ['围栏里 JSON 坏了', broken]]) {
    const r = V.readImpliedProb(text);
    assert.equal(r.structured.found, true, why + '：围栏在就算找到了（找到≠校验通过）');
    assert.equal(r.ok, false, why + '：必须判为坏数据');
    assert.equal(r.prob, null, why + '：★不许拿散文里的 0.42 顶上');
  }
});

test('★③d 默认形态就是「不许回退」：env 未设时开关必须关着', () => {
  withEnv(FALLBACK_ENV, undefined, () => {
    assert.equal(V.legacyTextFallbackEnabled(), false, '★默认不许回退：新数据不许走老路');
    assert.equal(V.readImpliedProb(TEXT_ONLY_WITH_P).prob, null);
  });
  // 非法取值也按"关"处理（闸的默认值必须是收紧的那一侧）
  for (const v of ['0', 'off', 'false', 'no', '', 'nonsense']) {
    withEnv(FALLBACK_ENV, v, () => {
      assert.equal(V.legacyTextFallbackEnabled(), false, 'env=' + JSON.stringify(v) + ' 必须判为关闭');
    });
  }
});

// ═══════════════ ④ 旧数据在兼容开关下仍可读 ═══════════════

test('④ 兼容开关开启：只有 verdict_text 的旧响应仍读得到数（且自报 legacy_text）', () => {
  withEnv(FALLBACK_ENV, '1', () => {
    const r = V.readImpliedProb(TEXT_ONLY_WITH_P);
    assert.equal(r.prob, 0.42, '旧数据要能读：开关就是为它们留的');
    assert.equal(r.source, 'legacy_text', '★走老路必须自报家门（否则新旧数据在库里读起来一样）');
    assert.equal(r.ok, true);
  });
  // opts 显式优先级高于 env（消融脚本要能单次覆盖，不必改进程环境）
  withEnv(FALLBACK_ENV, undefined, () => {
    assert.equal(V.readImpliedProb(TEXT_ONLY_WITH_P, { legacyTextFallback: true }).prob, 0.42);
    assert.equal(V.readImpliedProb(TEXT_ONLY_WITH_P, { legacyTextFallback: false }).prob, null, '显式 false 覆盖 env=1');
  });
  withEnv(FALLBACK_ENV, '1', () => {
    assert.equal(V.readImpliedProb(TEXT_ONLY_WITH_P, { legacyTextFallback: false }).prob, null, '显式 false 覆盖 env=1');
  });
});

test('④b 旧数据走老路时抽不到数也照实 NULL（开关只放开"尝试"，不放开"编数"）', () => {
  withEnv(FALLBACK_ENV, '1', () => {
    const r = V.readImpliedProb('散文一句，没有任何可抽的行。');
    assert.equal(r.prob, null);
    assert.equal(r.source, 'legacy_text_no_match', '老路也没抽到 ≠ 结构化读到了');
  });
});

// ═══════════════ 路由级：真 HTTP 语义（fetchImpl 夹具，零网络） ═══════════════

test('★路由 ①：三路结构化响应 ⇒ implied_prob 全部来自 structured，库内值可读回', async () => {
  responder = () => structuredText(GOOD_PAYLOAD, { range: 'Range: 35%-50%', legacyP: '0.42' });
  const pid = mkPid('路由用例①：结构化正常');
  const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(r.statusCode, 200, r.body.slice(0, 300));
  const b = r.json();
  assert.equal(b.errors.length, 0, JSON.stringify(b.errors));
  assert.equal(b.saved.length, 3);
  for (const s of b.saved) {
    assert.equal(s.implied_prob, 0.42, '三路都读到结构化 p');
    assert.equal(s.prob_source, 'structured', '响应里要能看出这个数是怎么来的');
    assert.equal(s.extracted, true);
  }
  const rows = verdictRows(pid);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.implied_prob, 0.42, '库内落的是结构化值');
});

test('★★路由 ③：三路响应都只有散文 P=0.42 ⇒ 库内 implied_prob 全 NULL，且响应自报拒因', async () => {
  responder = () => TEXT_ONLY_WITH_P;
  const pid = mkPid('路由用例③：缺结构化字段即拒');
  const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(r.statusCode, 200, r.body.slice(0, 300));
  const b = r.json();
  assert.equal(b.errors.length, 0, '拒 p 不是"某一路挂了"：HTTP 200，p 如实落 NULL');
  assert.equal(b.saved.length, 3, '判词文本照旧全量落库（只有数被拒）');
  for (const s of b.saved) {
    assert.equal(s.implied_prob, null, '★★库里必须是 NULL —— 绝不能是散文里的 0.42');
    assert.equal(s.prob_source, 'no_fallback_structured_missing');
    assert.ok(s.prob_why && s.prob_why.length > 5, '要有一句人话说清为什么这个数没有');
  }
  const rows = verdictRows(pid);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.implied_prob, null, '★★逐行核对：库里的 implied_prob 必须是 NULL');
    assert.ok(/P=0\.42/.test(row.verdict_text), '散文原文照旧落库（可复盘，只是不再被当成数）');
  }
});

test('路由 ④：开关开启时旧格式响应仍能取到数，但每行都自报 legacy_text', async () => {
  const pid = mkPid('路由用例④：旧数据可读');
  await withEnvAsync(FALLBACK_ENV, '1', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    const b = r.json();
    assert.equal(b.saved.length, 3);
    for (const s of b.saved) {
      assert.equal(s.implied_prob, 0.42, '旧数据可读');
      assert.equal(s.prob_source, 'legacy_text');
    }
  });
  for (const row of verdictRows(pid)) assert.equal(row.implied_prob, 0.42);
});

/** async 版的临时改 env（await withEnvAsync(k, v, async () => {...})） */
function withEnvAsync(name, value, fn) {
  const saved = process.env[name];
  const restore = () => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; };
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  return Promise.resolve()
    .then(fn)
    .then((out) => { restore(); return out; }, (e) => { restore(); throw e; });
}

test('路由响应禁出现「预测」二字（披露纪律，同 verdicts-leak-gate ②d）', async () => {
  responder = () => TEXT_ONLY_WITH_P;
  const pid = mkPid('路由用例：禁词自查');
  const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions/' + pid + '/verdicts' });
  assert.equal(r.statusCode, 200);
  assert.equal(/预测/.test(r.body), false, '响应体含禁词：' + r.body.slice(0, 400));
});

// ═══════════════ MOCK 判词与 prompt 契约 ═══════════════

test('MOCK 判词也走结构化：三路 p 不变（0.25/0.5/0.75），但来源已是 structured', () => {
  const want = { v1_evidence: 0.25, v2_skeptical: 0.5, v3_baserate: 0.75 };
  for (const [variant, p] of Object.entries(want)) {
    const text = V.buildMockVerdict(variant, 0.2, 'MOCK 结构化用例', {});
    const r = V.readImpliedProb(text);
    assert.equal(r.prob, p, variant + '：MOCK 的数不许变（既有测试钉死这三个值）');
    assert.equal(r.source, 'structured', variant + '：★MOCK 也不许走文本抽取老路');
    // 老契约仍在：scripts/decouple9-run.cjs 之类直接调 extractImpliedProb
    assert.equal(V.extractImpliedProb(text), p, variant + '：末行 P= 契约保留（禁改面之外的旧消费方）');
    assert.ok(text.indexOf('Range: ') !== -1, variant + '：区间行保留（第二信号源）');
  }
});

test('prompt 契约：既要结构化块，也保留末行 P=（旧消费方在役）', () => {
  const sys = V.buildSystemPrompt('v1_evidence');
  assert.ok(sys.indexOf(FENCE) >= 0, 'system prompt 要点名结构化围栏标记，否则模型不知道往哪写');
  assert.ok(sys.indexOf('Range: A%-B%') >= 0, '区间行契约保留');
  assert.ok(sys.indexOf('最后一行必须严格是「P=0.xx」') >= 0, '末行 P= 契约保留（scripts/decouple9-run.cjs 在役）');
  assert.ok(sys.indexOf('0 到 1') >= 0, '★p 的取值范围必须写进 prompt：约束是给模型看的，不写等于没约束');
  assert.ok(sys.indexOf('abstain') >= 0, '拒答标记也要在 prompt 里说清（否则模型不会填它）');
});

// ═══════════════ schema 模块自身 ═══════════════

test('schema 模块：纯函数、零副作用；parse/validate 分开可单测', () => {
  assert.equal(typeof S.parseStructured, 'function');
  assert.equal(typeof S.validateStructured, 'function');
  assert.equal(S.parseStructured('没有围栏的散文').found, false);
  const found = S.parseStructured(structuredText(GOOD_PAYLOAD));
  assert.equal(found.found, true);
  assert.equal(found.payload.p, 0.42);
  assert.equal(S.validateStructured(found.payload).ok, true);
  assert.equal(S.validateStructured({ role: 'x' }).ok, false);
  // 枚举注册表对外暴露（提示词/测试不许各抄一份）
  assert.ok(S.ROLES.indexOf('evidence_aggregation') >= 0);
  assert.ok(S.DIRECTIONS.length >= 2 && S.CONFIDENCE_BANDS.length >= 2);
});

test('★源码锁：默认取数路径不得绕过结构化闸（no_fallback 必须是默认形态）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'verdicts.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ① 路由处理器本身走 readImpliedProb，不再直接抽文本
  assert.ok(/readImpliedProb\(\s*text\s*\)/.test(code), '路由取数必须走 readImpliedProb（结构化优先）');
  // ② 全文只允许有一处 `= extractImpliedProb(`，且那处必须落在 readImpliedProb 的开关分支里
  const assignments = code.match(/=\s*extractImpliedProb\(/g) || [];
  assert.equal(assignments.length, 1, '★extractImpliedProb 只许在兼容开关分支里被调一次：实得 ' + assignments.length + ' 处');
  const resolverStart = code.indexOf('function readImpliedProb');
  const resolverEnd = code.indexOf('\nfunction ', resolverStart + 10);
  const resolverBody = code.slice(resolverStart, resolverEnd === -1 ? undefined : resolverEnd);
  assert.ok(resolverBody.indexOf('extractImpliedProb(') >= 0, '那唯一一处必须在 readImpliedProb 体内（即开关分支）');
  // ③ 闸的原因码落在源码里（"缺结构化字段即拒"这句不是只写在注释里）
  assert.ok(/no_fallback_structured_missing/.test(src), '★拒因短码要在盘上（读侧才能分辨"拒"和"没跑"）');
});

test('★零新依赖：判词层不引入任何外部包', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  assert.ok(deps.every((d) => ['fastify', '@fastify/cors', '@fastify/static', 'lunar-javascript'].indexOf(d) >= 0),
    '依赖表多了东西：' + deps.join(','));
  const schemaSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'evidence', 'verdictSchema.js'), 'utf8');
  assert.equal(/require\(['"][^.]/.test(schemaSrc), false, '★schema 模块只许用 node 内建（零新依赖）');
});
