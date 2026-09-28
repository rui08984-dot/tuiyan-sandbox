'use strict';
/**
 * p1b/test/intake-protocol.test.cjs —— 接题问卷协议层回归锁（2026-09-29）
 *
 * 覆盖：
 *   ① ★同源锁：协议投影出来的 8 个常量须与**活模块真导出**逐字相同；
 *      问数 QUESTION_COUNT **没有导出**，用 classifyIntake 的 400 路径**探**出真值再对账
 *      （全程不写库：错长度必在落库前抛；都对则用 decided_layer 哨兵拦在落库前）。
 *   ② ★端到端对拍：校验器算出的拒收/落层/叠加，须与**真端点**（app.inject，:memory:）一致。
 *      三态归一是复刻的，这里是复刻的账。
 *   ③ ★零副作用源码锁：协议层不许 require 应用代码/开库/连网/连 LLM（纪律②的机械门自身要比模型更死）。
 *   ④ 夹具判定：合规一份、不合规若干（越界取值／漏答必答／用「不知道」逃过拒收门）。
 *   ⑤ ★变异测试：从协议里删掉一道必答项（或改必答性、或加一道不存在的问），校验器必须红。
 *
 * 铁律：不起真端口（app.inject）；DB=:memory:；零网络零 LLM；零写生产库；intake.js 只读不改。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const live = require('../src/routes/intake');                       // 冻结件：只读
const { buildProtocol, getProtocol } = require('../src/protocol/intakeProtocol');
const { validateIntakeAnswers, protocolSelfCheck, CODES } = require('../src/protocol/validateIntakeAnswers');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-proto-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
test.before(async () => { app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders }); });
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const yes = (n) => Array.from({ length: n }, () => true);
const no = (n) => Array.from({ length: n }, () => false);
const unk = (n) => Array.from({ length: n }, () => 'unknown');

/** 过门 + 五层皆非全绿 ⇒ 期望落 unknown。 */
function ck(over) {
  return Object.assign({ Q0_1: true, Q0_2: true, Q0_3: true, L5: no(3), L6: no(4), L1: no(4), L3: no(4), L2: no(4) }, over || {});
}
async function classify(payload) {
  const r = await app.inject({ method: 'POST', url: '/api/intake/classify', payload: payload });
  return { status: r.statusCode, body: r.json() };
}
const codesOf = (r) => r.errors.map((e) => e.code);
const warnCodesOf = (r) => r.warnings.map((w) => w.code);

// ══════════════════════════════════════════════════════════════════════════
// ① 同源锁：投影 == 冻结件活模块
// ══════════════════════════════════════════════════════════════════════════

test('①-1 投影的常量与活模块真导出逐字相同（7 个有导出的）', () => {
  const p = getProtocol();
  assert.deepStrictEqual(p.projection.checklist_hash, live.CHECKLIST_HASH);
  assert.deepStrictEqual(p.projection.decision_order, live.DECISION_ORDER);
  assert.deepStrictEqual(p.projection.primary_layers, live.PRIMARY_LAYERS);
  assert.deepStrictEqual(p.projection.scorable_layers, live.SCORABLE_LAYERS);
  assert.deepStrictEqual(p.projection.gate_transitions, live.GATE_TRANSITIONS);
  assert.deepStrictEqual(p.projection.g2, live.G2);
  assert.deepStrictEqual(p.projection.engine_table, live.ENGINE_TABLE);
  // 拒收门三问的 key/reason 逐项对
  const gateQs = p.questions.filter((q) => q.block === 'reject_gate');
  assert.equal(gateQs.length, live.GATE_QUESTIONS.length);
  live.GATE_QUESTIONS.forEach((q, i) => {
    assert.equal(gateQs[i].key, q.key);
    assert.equal(gateQs[i].reason_on_fail, q.reason);
    assert.equal(gateQs[i].label, q.label);
  });
  // ★ALL_LAYERS 与 QUESTION_COUNT **都没有导出**（intake.js:485 的 exports 里没有）——
  //   所以这两项不靠「值相等」对账：ALL_LAYERS 走 ①-1b 的行为对拍，
  //   QUESTION_COUNT 走 ①-2 的 400 路径探针。这里只登记「它们确实没导出」这个事实。
  assert.strictEqual('ALL_LAYERS' in live, false, 'ALL_LAYERS 若已导出，改成直接值对账（比行为对拍强）');
  assert.strictEqual('QUESTION_COUNT' in live, false, 'QUESTION_COUNT 若已导出，改成直接值对账');
});

test('①-1b ALL_LAYERS 未导出 ⇒ 用 secondary 的接受/拒绝行为反证它', async () => {
  const p = getProtocol();
  for (const layer of p.projection.all_layers) {
    const r = await classify({ statement: 'secondary 接受 ' + layer, checklist: ck(), secondary: layer });
    assert.equal(r.status, 200, layer + ' 须被 secondary 接受（' + r.body.message + '）');
    assert.strictEqual(r.body.secondary, layer);
  }
  for (const bad of ['L7', 'unknown', 'l1', 'L4 ', '']) {
    const r = await classify({ statement: 'secondary 拒绝 ' + bad, checklist: ck(), secondary: bad });
    if (bad === '') continue;   // 空串＝不发，走「不覆盖」分支，不是拒绝
    assert.equal(r.status, 400, 'secondary=' + JSON.stringify(bad) + ' 须 400（实得 ' + r.status + '）');
  }
});

test('①-2 ★QUESTION_COUNT 无导出：用 classifyIntake 的 400 路径探出真值并对账（零写库）', () => {
  // 探针原理：对目标层给一个候选长度 k，让前面的层都用**已知**正确长度。
  //   · 若抛的 400 点名**目标层** ⇒ k 错，继续试；
  //   · 若抛的 400 点名别的层（或压根不是长度错，是 decided_layer 哨兵）⇒ k 对。
  // 两条路都在落库前抛出（决策循环在 insertIntakeQuestion 之前，decided_layer 检查更早）。
  const SENTINEL = '__probe_not_a_layer__';   // 不在 PRIMARY_LAYERS 里
  const known = {};
  for (const layer of live.DECISION_ORDER) {
    let found = null;
    for (let k = 0; k <= 16 && found === null; k++) {
      const checklist = { Q0_1: true, Q0_2: true, Q0_3: true };
      for (const L of live.DECISION_ORDER) {
        if (L === layer) checklist[L] = new Array(k).fill(true);
        else if (known[L] !== undefined) checklist[L] = new Array(known[L]).fill(true);
        else checklist[L] = [];   // 未知的后续层：多半长度不对，让它自己先抛
      }
      let msg = null;
      try { live.classifyIntake({ statement: 'probe', checklist, decided_layer: SENTINEL }); }
      catch (e) { msg = e.message; }
      const m = /^checklist\.(L[1-6]) 需要/.exec(msg || '');
      if (!m || m[1] !== layer) found = k;   // 长度检查**没**点到目标层 ⇒ k 就是它的问数
    }
    assert.notStrictEqual(found, null, '探不出 ' + layer + ' 的问数');
    known[layer] = found;
  }
  const p = getProtocol();
  // 决策树五层：探针实测 == 投影值
  for (const layer of live.DECISION_ORDER) {
    assert.strictEqual(known[layer], p.projection.question_count[layer],
      layer + ' 问数：探针实测 ' + known[layer] + ' ≠ 投影 ' + p.projection.question_count[layer]);
  }
  // L4 不在决策树里，探针探不到；用「L4 全 true 才记 secondary」这条实测它。
  assert.strictEqual(p.projection.question_count.L4, 3, 'L4 问数应为 3（与清单标题声明一致，装配时已双源对账）');
});

test('①-3 L4 的「可选」只指**键可以不发**；一旦发就必须定长 3', async () => {
  const p = getProtocol();
  const r = await classify({ statement: '叠加层问数实测题', checklist: ck({ L4: yes(3) }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.secondary, 'L4', 'L4 三问全 true ⇒ secondary=L4');
  // ★少一问答 400，不是「非全绿」——「可选」说的是键缺省，不是长度宽限。
  //   （这条语义本协议已登记在 L4 各问的 omission.detail 里；实测在此钉住。）
  const r2 = await classify({ statement: '叠加层少一问', checklist: ck({ L4: yes(2) }) });
  assert.equal(r2.status, 400, 'L4 发了但长度不对 ⇒ 400（实得 ' + r2.status + '）');
  assert.ok(/checklist\.L4/.test(r2.body.error || ''), '400 信息须点名 L4：' + r2.body.error);
  // 键完全不发 ⇒ 不报错、不误标
  const r3 = await classify({ statement: '叠加层不发', checklist: ck() });
  assert.equal(r3.status, 200);
  assert.strictEqual(r3.body.secondary, null, '不发 L4 ⇒ secondary 留空，不误标');
  // 校验器与真端点同口径
  const vShort = validateIntakeAnswers({ checklist: ck({ L4: yes(2) }) });
  assert.equal(vShort.ok, false, '校验器同样拒 L4 短数组');
  assert.ok(codesOf(vShort).indexOf(CODES.E_SHAPE) !== -1, '须 E_SHAPE，实得 ' + codesOf(vShort));
  const vAbsent = validateIntakeAnswers({ checklist: ck() });
  assert.equal(vAbsent.ok, true, '不发 L4 不算错');
  assert.strictEqual(vAbsent.outcome.secondary, null);
  assert.strictEqual(p.counts.overlay, 3);
});

test('①-4 协议自检：未变异时零漂移', () => {
  assert.deepStrictEqual(protocolSelfCheck(getProtocol()), [], '原版协议自检须干净');
});

// ══════════════════════════════════════════════════════════════════════════
// ② 端到端对拍：校验器算出 vs 真端点
// ══════════════════════════════════════════════════════════════════════════

test('②-1 落层结果与真端点一致（逐层各打一遍）', async () => {
  const cases = [
    ['L5', { L5: yes(3) }],
    ['L6', { L5: no(3), L6: yes(4) }],
    ['L1', { L5: no(3), L6: no(4), L1: yes(4) }],
    ['L3', { L5: no(3), L6: no(4), L1: no(4), L3: yes(4) }],
    ['L2', { L5: no(3), L6: no(4), L1: no(4), L3: no(4), L2: yes(4) }],
    ['unknown', { L5: no(3), L6: no(4), L1: no(4), L3: no(4), L2: no(4) }],
  ];
  for (const [expect, over] of cases) {
    const v = validateIntakeAnswers({ checklist: ck(over) });
    assert.equal(v.ok, true, expect + ' 夹具自身须合协议');
    const r = await classify({ statement: '对拍 ' + expect, checklist: ck(over) });
    assert.equal(r.status, 200);
    assert.equal(r.body.rejected, false);
    assert.strictEqual(r.body.layer, expect, '真端点落层 ' + expect);
    assert.strictEqual(v.outcome.layer, expect, '校验器算出的落层须一致');
    assert.strictEqual(v.outcome.computed_layer, expect, '决策树计算层须一致');
  }
});

test('②-2 拒收后果与真端点一致（三问各一：否 / unknown 各打一遍）', async () => {
  for (const q of ['Q0_1', 'Q0_2', 'Q0_3']) {
    for (const val of [false, 'unknown', '否', '未知']) {
      const over = {}; over[q] = val;
      const v = validateIntakeAnswers({ checklist: ck(over) });
      assert.equal(v.ok, true, '取值本身在域内（是协议允许的写法）');
      assert.equal(v.outcome.rejected, true, q + '=' + JSON.stringify(val) + ' 应判为拒收');
      const r = await classify({ statement: '拒收对拍 ' + q + '=' + val, checklist: ck(over) });
      assert.equal(r.status, 200);
      assert.equal(r.body.rejected, true, '真端点也应拒收');
      assert.strictEqual(r.body.reason, v.outcome.reason, 'reason 须一致');
      assert.strictEqual(r.body.detail.question, v.outcome.first_failing_question, '首个失败问须一致');
    }
  }
});

test('②-3 三态归一复刻：投影词表每个词都过一遍真端点', async () => {
  const d = getProtocol().value_domain;
  for (const w of d.accepts.true_words.concat(d.accepts.false_words, d.accepts.unknown_words)) {
    const v = validateIntakeAnswers({ checklist: ck({ Q0_1: w }) });
    const r = await classify({ statement: '词表对拍 ' + w, checklist: ck({ Q0_1: w }) });
    assert.equal(r.status, 200, '「' + w + '」真端点须收（在 UNKNOWN/FALSE/TRUE 词表内）');
    assert.strictEqual(v.outcome.rejected, r.body.rejected, '「' + w + '」拒收判定须一致');
    if (r.body.rejected) assert.strictEqual(v.outcome.reason, r.body.reason);
  }
  // 布尔与 0|1
  for (const w of [true, false, 1, 0, 'Yes', ' YES ']) {
    const v = validateIntakeAnswers({ checklist: ck({ Q0_1: w }) });
    const r = await classify({ statement: '归一对拍 ' + w, checklist: ck({ Q0_1: w }) });
    assert.strictEqual(v.outcome.rejected, r.body.rejected, JSON.stringify(w) + ' 判定须一致');
  }
});

test('②-4 形状非法：真端点 400，校验器也判红（错误码不同但都红）', async () => {
  // 注意：对象形式**不在**这一组——冻结件收它，分歧单列在 ②-5。
  const bad = [
    ['层少一问', ck({ L6: yes(3) })],
    ['层多一问', ck({ L2: yes(5) })],
    ['层给标量', ck({ L1: true })],
    ['层给字符串', ck({ L3: 'yes' })],
  ];
  for (const [name, checklist] of bad) {
    const v = validateIntakeAnswers({ checklist });
    assert.equal(v.ok, false, name + '：校验器须判红');
    assert.ok(codesOf(v).indexOf(CODES.E_SHAPE) !== -1, name + '：须 E_SHAPE，实得 ' + codesOf(v));
    const r = await classify({ statement: '形状 ' + name, checklist });
    assert.equal(r.status, 400, name + '：真端点须 400（实得 ' + r.status + '）');
  }
});

test('②-5 ★已登记的分歧：对象形式本协议拒、冻结件收，且冻结件不校验长度', async () => {
  // 本协议只收定长数组。冻结件的 layerGreen 有对象分支且**不校验长度**——
  // 下面这条 L2 只给 1 个键，真端点照样判成全绿并落 L2。
  const thin = ck({ L2: { only: true } });
  const v = validateIntakeAnswers({ checklist: thin });
  assert.equal(v.ok, false, '本协议须拒对象形式');
  assert.ok(codesOf(v).indexOf(CODES.E_SHAPE) !== -1, '错误码须是 E_SHAPE');
  const r = await classify({ statement: '对象形式·冻结件收', checklist: thin });
  assert.equal(r.status, 200, '冻结件确实收（这就是本协议收紧的理由，不是猜测）');
  assert.strictEqual(r.body.layer, 'L2', '一票就把四问的层判成全绿 ⇒ 长度检查被绕过');
  // 收紧方向只有一条：拒。本协议**不放行**该形状（且不会悄悄把它算成任何层）。
  assert.equal(v.ok, false);
  assert.ok(codesOf(v).indexOf(CODES.E_SHAPE) !== -1);
  assert.strictEqual(v.per_question['L2[0]'].normalized, null, '被拒的问没有归一值，不许拿它去算层');
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 零副作用源码锁（纪律②：机械门自己要比模型更死）
// ══════════════════════════════════════════════════════════════════════════

test('③ ★零副作用源码锁：协议层不碰应用代码/库/网/LLM，且不动态执行', () => {
  const files = ['intakeSource.js', 'intakeProtocol.js', 'validateIntakeAnswers.js', 'index.js'];
  for (const f of files) {
    const p = path.join(__dirname, '..', 'src', 'protocol', f);
    const src = fs.readFileSync(p, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const pat of [
      /require\(\s*['"]\.\.\/(deps|db|routes|engines|evidence|util)/,   // 应用代码
      /require\(\s*['"](node:)?(http|https|net|tls|dgram|child_process)/, // 网络/子进程
      /\bfetch\s*\(/,                                                    // 网络
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,            // 写库
      // 照 leak-scan.test.cjs:51-57 的零写库锁范式：卡 DB 的具体调用形态，
      // 而不是卡 `.exec(`（那是 RegExp.prototype.exec，纯字符串运算，会误伤）
      /\bconn\.exec\s*\(/,
      /\.prepare\s*\(/,
      /\bgetConnection\b/,
      /\bllm\b/i,                                                       // LLM
    ]) {
      assert.ok(!pat.test(code), f + ' 不得含：' + pat);
    }
    // 动态执行：只许 vm.runInNewContext + 空沙箱；禁 eval / new Function
    assert.ok(!/\beval\s*\(/.test(code), f + ' 禁 eval');
    assert.ok(!/new\s+Function\s*\(/.test(code), f + ' 禁 new Function');
  }
  const srcText = fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', 'intakeSource.js'), 'utf8');
  assert.ok(/runInNewContext/.test(srcText), '唯一求值处须是 vm.runInNewContext');
  assert.ok(/Object\.create\(null\)/.test(srcText), 'vm 沙箱须是空原型对象');
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 夹具判定
// ══════════════════════════════════════════════════════════════════════════

test('④-1 合规夹具：过门 + L5 全绿 + L4 叠加 ⇒ 零错零告警', () => {
  const r = validateIntakeAnswers({ checklist: ck({ L5: yes(3), L4: yes(3) }) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.outcome.layer, 'L5');
  assert.strictEqual(r.outcome.secondary, 'L4');
});

test('④-2 越界取值：六种脏写法全部 E_DOMAIN', () => {
  for (const junk of ['maybe', 'probably', 2, -1, 1.5, [], {}, null, '是是', 'true1']) {
    const v = validateIntakeAnswers({ checklist: ck({ Q0_1: junk }) });
    // null 按「漏答」处理（required=true ⇒ E_MISSING_REQUIRED），其余按越界
    const isNull = junk === null;
    assert.equal(v.ok, false, JSON.stringify(junk) + ' 须判红');
    if (isNull) assert.ok(codesOf(v).indexOf(CODES.E_MISSING_REQUIRED) !== -1);
    else assert.ok(codesOf(v).indexOf(CODES.E_DOMAIN) !== -1, JSON.stringify(junk) + ' 须 E_DOMAIN，实得 ' + codesOf(v));
  }
});

test('④-3 漏答必答项：漏拒收门 / 漏决策层 ⇒ E_MISSING_REQUIRED，且后果是 400 不是拒收', async () => {
  const cases = [
    ['漏 Q0_2', (() => { const c = ck(); delete c.Q0_2; return c; })()],
    ['漏 L2', (() => { const c = ck(); delete c.L2; return c; })()],
    ['漏整层 L1', (() => { const c = ck(); delete c.L1; return c; })()],
    // 拼错键：把对的键**挪到错的键上**（而不是额外加一个）——那才是发送方以为自己答了的形状
    ['Q0_2 拼成 Q0_ 2', (() => { const c = ck(); c['Q0_ 2'] = c.Q0_2; delete c.Q0_2; return c; })()],
    ['L5 拼成 L5_', (() => { const c = ck(); c.L5_ = c.L5; delete c.L5; return c; })()],
    ['L3 拼成 l3（小写）', (() => { const c = ck(); c.l3 = c.L3; delete c.L3; return c; })()],
  ];
  for (const [name, checklist] of cases) {
    const v = validateIntakeAnswers({ checklist });
    assert.equal(v.ok, false, name + ' 须判红');
    assert.ok(codesOf(v).indexOf(CODES.E_MISSING_REQUIRED) !== -1, name + ' 须 E_MISSING_REQUIRED，实得 ' + codesOf(v));
    const someQ = Object.values(v.per_question).find((q) => q.effect === 'http_400');
    assert.ok(someQ, name + ' 须标出 400 后果');
    const r = await classify({ statement: '漏答 ' + name, checklist });
    assert.equal(r.status, 400, name + ' 真端点须 400（实得 ' + r.status + '）');
  }
});

test('④-3b 拼错的键：既点名叫漏答，也点名它是个不认识的键', () => {
  const checklist = ck();
  checklist['Q0_ 2'] = checklist.Q0_2;
  delete checklist.Q0_2;
  const v = validateIntakeAnswers({ checklist });
  assert.equal(v.ok, false, '漏了真键 ⇒ 判红');
  assert.ok(codesOf(v).indexOf(CODES.E_MISSING_REQUIRED) !== -1);
  assert.ok(warnCodesOf(v).indexOf(CODES.W_UNKNOWN_KEY) !== -1, '★同时点名假键：冻结件静默忽略它，但账本上等于没答');
  const stray = v.warnings.filter((w) => w.code === CODES.W_UNKNOWN_KEY).map((w) => w.key);
  assert.deepStrictEqual(stray, ['Q0_ 2']);
});

test('④-4 漏答 L4（可选层）不算错', () => {
  const v = validateIntakeAnswers({ checklist: ck({ L5: yes(3) }) });
  assert.equal(v.ok, true, 'L4 可选：漏它不判红');
  assert.strictEqual(v.outcome.secondary, null);
});

test('④-5 ★用「不知道」逃过拒收门：三种形态分别点名', async () => {
  // 形态一：拒收门填 unknown —— 判据是 !== true，与「否」同一条拒收路
  const g = validateIntakeAnswers({ checklist: ck({ Q0_1: 'unknown' }) });
  assert.equal(g.ok, true, '写法本身合法（值域内）');
  assert.equal(g.outcome.rejected, true, '但它拒收，不是豁免');
  assert.strictEqual(g.outcome.reason, 'no_anchor');
  assert.ok(warnCodesOf(g).indexOf(CODES.W_GATE_UNKNOWN_REJECTS) !== -1, '须点名');

  // 形态二：全部门过，但五层全答 unknown —— 一份合法、零判断的提交
  const e = validateIntakeAnswers({ checklist: ck({ L5: unk(3), L6: unk(4), L1: unk(4), L3: unk(4), L2: unk(4) }) });
  assert.equal(e.ok, true, '它不会红——这正是要点名的地方');
  assert.equal(e.outcome.rejected, false, '拒收门挡不住它（三问都 true）');
  assert.strictEqual(e.outcome.layer, 'unknown', '全层非全绿 ⇒ 落 unknown 入账');
  assert.ok(warnCodesOf(e).indexOf(CODES.W_UNKNOWN_ESCAPE_TOTAL) === -1, '门问都 true，不算「全答不出」');

  // 形态三：连拒收门一起答 unknown —— 全部 22 个必答项都「答不出」
  const all = validateIntakeAnswers({ checklist: ck({ Q0_1: 'unknown', Q0_2: '未知', Q0_3: 'unknown', L5: unk(3), L6: unk(4), L1: unk(4), L3: unk(4), L2: unk(4) }) });
  assert.equal(all.ok, true, '值域全合法');
  assert.ok(warnCodesOf(all).indexOf(CODES.W_UNKNOWN_ESCAPE_TOTAL) !== -1, '★须点名为「合法但零判断」');
  assert.ok(warnCodesOf(all).indexOf(CODES.W_GATE_UNKNOWN_REJECTS) !== -1, '门问那三条也要点名');
  assert.strictEqual(all.outcome.rejected, true, '且它其实是被拒的');
  // 与真端点对拍：拒收 + reason 一致
  const r = await classify({ statement: '全 unknown 对拍', checklist: ck({ Q0_1: 'unknown', Q0_2: '未知', Q0_3: 'unknown', L5: unk(3), L6: unk(4), L1: unk(4), L3: unk(4), L2: unk(4) }) });
  assert.equal(r.body.rejected, true);
  assert.strictEqual(r.body.reason, all.outcome.reason);
});

test('④-6 五层皆非全绿（答否，不是答不出）⇒ 落 unknown 并给告警', async () => {
  const v = validateIntakeAnswers({ checklist: ck() });
  assert.equal(v.ok, true);
  assert.strictEqual(v.outcome.layer, 'unknown');
  assert.ok(warnCodesOf(v).indexOf(CODES.W_LAYER_UNKNOWN) !== -1, '须给「不是一次归层」的告警');
  assert.ok(warnCodesOf(v).indexOf(CODES.W_UNKNOWN_ESCAPE_TOTAL) === -1, '答否不是逃逸（那是判断，不是弃权）');
  const r = await classify({ statement: '全否对拍', checklist: ck() });
  assert.strictEqual(r.body.layer, 'unknown');
});

test('④-7 覆盖字段越界：decided_layer / secondary', () => {
  const d = validateIntakeAnswers({ checklist: ck({ L5: yes(3) }), decided_layer: 'L4' });
  assert.equal(d.ok, false, 'L4 是叠加层，不在 primary 合法值里');
  assert.ok(codesOf(d).indexOf(CODES.E_DECIDED_LAYER) !== -1);
  const s = validateIntakeAnswers({ checklist: ck({ L5: yes(3) }), secondary: 'L7' });
  assert.equal(s.ok, false);
  assert.ok(codesOf(s).indexOf(CODES.E_SECONDARY) !== -1);
  // 合法覆盖：decided_layer 合法时优先于决策树
  const okv = validateIntakeAnswers({ checklist: ck({ L5: yes(3) }), decided_layer: 'L2' });
  assert.equal(okv.ok, true);
  assert.strictEqual(okv.outcome.computed_layer, 'L5', '决策树仍算 L5');
  assert.strictEqual(okv.outcome.layer, 'L2', '但覆盖生效');
});

test('④-8 提交体形状：没有 checklist / checklist 是数组 ⇒ E_ENVELOPE', () => {
  for (const s of [null, undefined, {}, { checklist: null }, { checklist: [] }, { checklist: 'x' }, 42, 'x']) {
    const v = validateIntakeAnswers(s);
    assert.equal(v.ok, false, JSON.stringify(s) + ' 须判红');
    assert.ok(codesOf(v).indexOf(CODES.E_ENVELOPE) !== -1, JSON.stringify(s) + ' 须 E_ENVELOPE');
  }
});

test('④-9 带局标识 ⇒ 点名第 -1 步实验场域门先跑（本校验器不评它）', async () => {
  const v = validateIntakeAnswers({ checklist: ck({ L5: yes(3) }), game_type: 'werewolf' });
  assert.equal(v.ok, true, '值域/必答层面它没问题——局边界不是问卷问题');
  assert.ok(warnCodesOf(v).indexOf(CODES.W_LAB_BOUNDARY_UNCHECKED) !== -1, '须点名');
  const r = await classify({ statement: '真实局题', checklist: ck({ L5: yes(3) }), game_type: 'werewolf' });
  assert.equal(r.body.rejected, true);
  assert.strictEqual(r.body.reason, 'other', '第 -1 步先于拒收门 ⇒ reason=other，不是 no_anchor');
  assert.strictEqual(r.body.detail.scope, 'not_prediction_lab');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ ★变异测试：改协议，校验器必须红
// ══════════════════════════════════════════════════════════════════════════

/** 拿一份可安全改的协议副本（深拷贝）。 */
function cloneProtocol() { return JSON.parse(JSON.stringify(getProtocol())); }

test('⑤-1 ★从协议里删掉一道必答项（拒收门）⇒ 校验器红', () => {
  const p = cloneProtocol();
  p.questions = p.questions.filter((q) => q.key !== 'Q0_2');
  delete p.by_key.Q0_2;
  const v = validateIntakeAnswers({ checklist: ck({ L5: yes(3) }) }, p);
  assert.equal(v.ok, false, '★删掉必答项后校验器必须红');
  assert.ok(codesOf(v).indexOf(CODES.E_PROTOCOL_DRIFT) !== -1, '须报 E_PROTOCOL_DRIFT，实得 ' + codesOf(v));
  const drift = v.errors.filter((e) => e.code === CODES.E_PROTOCOL_DRIFT);
  assert.ok(drift.some((e) => e.key === 'Q0_2'), '漂移须点名是哪一问，实得 ' + drift.map((e) => e.key).join(','));
  // 单例没被这次变异碰到
  assert.deepStrictEqual(protocolSelfCheck(getProtocol()), [], '★改副本不得污染单例');
});

test('⑤-2 ★从协议里删掉一道必答项（决策层内）⇒ 校验器红', () => {
  const p = cloneProtocol();
  p.questions = p.questions.filter((q) => q.key !== 'L2[3]');
  delete p.by_key['L2[3]'];
  const v = validateIntakeAnswers({ checklist: ck({ L2: yes(4) }) }, p);
  assert.equal(v.ok, false, '★删掉必答项后校验器必须红');
  assert.ok(codesOf(v).indexOf(CODES.E_PROTOCOL_DRIFT) !== -1);
  // 关键：删了协议就不再检查 L2[3]——没有自检的话这份提交会「通过」，那就是逃逸成功
  assert.strictEqual(v.per_question['L2[3]'], undefined, '那一问确实不再被检查了，所以自检是唯一防线');
  assert.ok(v.errors.some((e) => e.code === CODES.E_PROTOCOL_DRIFT && e.key === 'L2[3]'), '自检须把缺的这问点出来');
  // 单例没被污染
  assert.deepStrictEqual(protocolSelfCheck(getProtocol()), []);
});

test('⑤-3 把一道必答项改成选答 ⇒ 校验器红', () => {
  const p = cloneProtocol();
  p.by_key['L3[0]'].required = false;
  p.questions.forEach((q) => { if (q.key === 'L3[0]') q.required = false; });
  const v = validateIntakeAnswers({ checklist: ck() }, p);
  assert.equal(v.ok, false);
  const drift = v.errors.filter((e) => e.code === CODES.E_PROTOCOL_DRIFT);
  assert.ok(drift.length > 0, '必答性漂移须报出来');
  assert.ok(drift.some((e) => e.key === 'L3[0]'), '须点名 L3[0]');
});

test('⑤-4 给协议加一道冻结件里没有的问 ⇒ 校验器红', () => {
  const p = cloneProtocol();
  const bogus = JSON.parse(JSON.stringify(p.by_key['L2[0]']));
  bogus.key = 'L2[9]'; bogus.checklist_key = 'L2'; bogus.array_index = 9; bogus.prompt = '凭空多出来的一问';
  p.questions.push(bogus);
  p.by_key['L2[9]'] = bogus;
  const v = validateIntakeAnswers({ checklist: ck() }, p);
  assert.equal(v.ok, false);
  assert.ok(codesOf(v).indexOf(CODES.E_PROTOCOL_DRIFT) !== -1);
});

test('⑤-5 改投影里的问数（比冻结件多一问）⇒ 自检立刻红', () => {
  // 投影被改成 L2 要 5 问，而协议里只有 L2[0..3] ⇒ 独立重算多出 L2[4] ⇒ 漂移。
  // ★用副本改，不碰 getProtocol() 那份缓存——否则后面的测试全被污染（初版就踩了这个，
  //   表现为 ⑤-6「未变异时干净」莫名其妙不干净）。顺带把「别污染单例」也钉成一条断言。
  const p = cloneProtocol();
  p.projection.question_count.L2 = 5;
  const v = validateIntakeAnswers({ checklist: ck() }, p);
  assert.equal(v.ok, false);
  assert.ok(codesOf(v).indexOf(CODES.E_PROTOCOL_DRIFT) !== -1, '投影多一问 ⇒ 协议缺该问 ⇒ 须红');
  const drift = v.errors.filter((e) => e.code === CODES.E_PROTOCOL_DRIFT).map((e) => e.key);
  assert.ok(drift.indexOf('L2[4]') !== -1, '须点名多出来的那一问 L2[4]，实得 ' + drift.join(','));
  // 缓存那份没被这次变异碰到
  assert.deepStrictEqual(protocolSelfCheck(getProtocol()), [], '★改副本不得污染单例');
});

test('⑤-6 变异测试的自检是**唯一**防线：确认没有别的地方把洞补上', () => {
  // 反向锁：自检必须真的在看「协议 vs 投影」的差集，而不是恒返回空
  const p = cloneProtocol();
  assert.deepStrictEqual(protocolSelfCheck(p), [], '未变异时干净');
  p.questions = p.questions.slice(1);          // 删掉第一道（Q0_1）
  delete p.by_key.Q0_1;
  const drift = protocolSelfCheck(p);
  assert.ok(drift.length > 0, '删一问必须产生漂移');
  assert.ok(drift.some((d) => d.key === 'Q0_1'), '漂移须点名 Q0_1');
});
