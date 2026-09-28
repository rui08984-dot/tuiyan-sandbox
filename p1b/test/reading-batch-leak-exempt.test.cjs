'use strict';
/**
 * p1b/test/reading-batch-leak-exempt.test.cjs —— 读数批的判词时序豁免（2026-09-29）
 *
 * 病象不是"报错了"，是**语义**：判词层新装了结算时序闸（`p1b/src/db/verdictsStore.js` 的
 *   `leakState`，第七批）。闸装在**写侧**：`saveVerdict` 见到「判词晚于父题结算」就**拒写**，
 *   除非调用点**显式**传 `{ allowPostSettlement: true }`——那一传不会把行洗成 clean，
 *   它把行落成 `leak_state='legacy_post_settlement'`（自报家门）并在返回值里 `excluded++` 披露。
 *
 * ★这道闸对「离线读数批」收紧是**有意的**：读数批本来就是拿**已揭晓的题**做读数实验。
 *   所以读数批不许沉默地混进 clean 桶，必须**自己声明**它是读数行——声明的方式就是逐调用点传豁免。
 *   豁免的作用面只有一个：让这一层继续跑，且跑出来的行自带 legacy 标记与排除数。
 *
 * ★先摆事实（本件 ① 就是钉这一条，防止"凭印象改"）：
 *   点名的四个脚本里**只有一个真的写判词**。另三个以 `{readOnly:true}` 打开库句柄、
 *   对 `verdicts` 全是 `SELECT` ⇒ 闸装在写侧，它们**结构上碰不到**，不需要也不许有豁免。
 *   （`decouple9-run.cjs:14` 的纪律原文：「产物只落 JSONL 工件；`verdicts` 表一行不写」。）
 *
 * 本件锁五件事：
 *   ① 事实锁：四个点名脚本各自有几个 `saveVerdict` 调用点；
 *   ② 真写的那一处**每个调用点都显式传 `true`**（逐调用点，漏一处就红）；
 *   ③ ★全仓 `p1b/scripts/**` 只有它传这个豁免，且必须是**字面量 true**
 *      （不许"某个开关被脚本悄悄打开"式的透传）；
 *   ④ ★不许有环境变量闸（`process.env.*SETTLEMENT*` 零命中）；
 *   ⑤ 豁免的落库形态自检：带豁免 ⇒ legacy + `excluded`，不带 ⇒ 拒写（`:memory:`，零网络）。
 *
 * 铁律：
 *   · 本件**绝不 require 这四个批脚本**——`ablation.cjs:213` 顶层就是 `process.exit(main())`，
 *     require 它等于开跑；另三个顶层要开真库句柄。判据一律**读源码文本**，静态、零副作用。
 *   · DB=:memory:；零网络；零新依赖。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { db } = require('../src/deps');
const predictions = require('../src/db/predictionsStore');
const vstore = require('../src/db/verdictsStore');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'p1b', 'scripts');
const SRC = path.join(ROOT, 'p1b', 'src');

/** 点名的四个离线读数批脚本（相对 p1b/scripts）。 */
const NAMED = ['ablation.cjs', 'stage4-run.cjs', 'role3-replay.cjs', 'decouple9-run.cjs'];
/** ★全仓唯一允许传时序豁免的脚本（依据见本件①；另三个不写判词，豁免对它们无意义）。 */
const EXEMPT_ALLOWED = 'ablation.cjs';
/** 豁免键名（单一真源在 verdictsStore.saveVerdict 的 opts，禁各写各的别名）。 */
const EXEMPT_KEY = 'allowPostSettlement';

const read = (rel) => fs.readFileSync(path.join(SCRIPTS, rel), 'utf8');

/**
 * 只留代码：去块注释与行注释，并把**字符串/模板字面量的内容**涂成空格（定界符保留）。
 * ★为什么涂内容：判据要数的是「代码里真的把这个键传进去了」，
 *   注释里写一句豁免名不算、字符串里写一句也不算（否则文档与文案会把检测糊成恒真）。
 */
function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === q) { out += q; i++; break; }
        out += (src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * 找出 `name(` 的调用点：返回每处的**完整实参文本**（从 `name(` 到配对右括号）。
 * 前接标识符字符的（`x.saveVerdictFoo(` 之类）不算；括号在涂过字符串的代码上配对。
 */
function callArgs(code, name) {
  const needle = name + '(';
  const out = [];
  let from = 0;
  for (;;) {
    const i = code.indexOf(needle, from);
    if (i < 0) break;
    from = i + needle.length;
    // 前接标识符字符的（`mySaveVerdict(` 之类）不算；**前接点是成员调用，照样算**
    if (i > 0 && /[A-Za-z0-9_$]/.test(code[i - 1])) continue;
    const open = i + name.length;
    let depth = 0, j = open, closed = false;
    for (; j < code.length; j++) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') { depth--; if (depth === 0) { closed = true; break; } }
    }
    if (!closed) continue;
    out.push(code.slice(i, j + 1));
  }
  return out;
}

/** 该段代码里有没有传这个豁免（键存在即算"传了"，形状由另一条用例单独钉）。 */
const passesExempt = (code) => code.indexOf(EXEMPT_KEY) >= 0;
/** 豁免必须是**逐调用点的字面量 true**：`{ allowPostSettlement: true }`。 */
const LITERAL_TRUE = new RegExp(EXEMPT_KEY + '\\s*:\\s*true\\b');

/** 递归列目录下的 .cjs（相对 p1b/scripts），排除 archive 之外的隐藏目录。 */
function listScripts(dir = SCRIPTS) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listScripts(p));
    else if (e.name.endsWith('.cjs')) out.push(path.relative(SCRIPTS, p).split(path.sep).join('/'));
  }
  return out.sort();
}

/** 递归列目录下的 .js/.cjs（相对根），返回绝对路径。 */
function listCode(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...listCode(p, exts)); continue; }
    if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// ─────────────── ① 事实锁：四个点名脚本里到底谁写判词 ───────────────

test('★① 事实锁：四个点名脚本各调几次 saveVerdict——只读的那个不许有豁免（防止"凭印象改"）', () => {
  const counts = {};
  for (const n of NAMED) counts[n] = callArgs(codeOnly(read(n)), 'saveVerdict').length;
  assert.equal(counts['ablation.cjs'], 1,
    'ablation.cjs 的烟测里有一处直调 saveVerdict（真实计数 ' + JSON.stringify(counts) + '）——'
    + '若将来增删调用点，请同步改本件与下面的逐调用点断言');
  for (const n of ['stage4-run.cjs', 'role3-replay.cjs', 'decouple9-run.cjs']) {
    assert.equal(counts[n], 0,
      n + ' 实测不写判词（对 verdicts 全是 SELECT，且以 {readOnly:true} 开库），所以它不需要豁免；'
      + '若你给它加了 saveVerdict 调用，**必须**同时传豁免并把本条改成允许非零计数。'
      + '当前计数 ' + JSON.stringify(counts));
  }
});

test('★①b 那三个只读脚本仍以 {readOnly:true} 开库（"不写判词"这条纪律本身要钉住）', () => {
  for (const n of ['stage4-run.cjs', 'role3-replay.cjs', 'decouple9-run.cjs']) {
    const code = codeOnly(read(n));
    assert.ok(/new\s+DatabaseSync\s*\([^)]*\{\s*readOnly\s*:\s*true\s*\}/.test(code),
      n + ' 不再以 readOnly 句柄开库 ⇒ 它已经可能写库了，① 的"零调用"结论要重核');
    assert.equal(/INSERT\s+INTO\s+verdicts/i.test(code), false, n + ' 里出现了往 verdicts 插行的语句');
  }
});

// ─────────────── ② 逐调用点显式传豁免 ───────────────

test('★② ablation.cjs 的每一个 saveVerdict 调用点都显式传了时序豁免（漏一处就红）', () => {
  const code = codeOnly(read(EXEMPT_ALLOWED));
  const sites = callArgs(code, 'saveVerdict');
  assert.equal(sites.length, 1, '调用点数量变了，先核清再改断言（实得 ' + sites.length + ' 处）');
  for (const s of sites) {
    assert.ok(passesExempt(s), '这一处 saveVerdict 没传 ' + EXEMPT_KEY + ' ⇒ 结算后写的判词会被时序闸拒写：\n' + s);
    assert.ok(LITERAL_TRUE.test(s),
      '豁免必须是逐调用点的字面量 { ' + EXEMPT_KEY + ': true }，不许透传变量/环境开关：\n' + s);
  }
  // 豁免必须写在**第二个实参**（opts）上，不是塞进判词行对象里当字段
  assert.ok(/\}\s*,\s*\{\s*[^{}]*allowPostSettlement\s*:\s*true[^{}]*\}\s*\)/.test(code),
    '豁免没落在 opts 形参上（saveVerdict(v, opts) 的第二个实参）');
});

test('★②b 留痕：豁免处必须自带一句人话，写明「读数批／题已结算／有意」，且不得影响在线落注', () => {
  const src = read(EXEMPT_ALLOWED);
  const at = src.indexOf(EXEMPT_KEY);
  assert.ok(at > 0, '脚本里找不到豁免键');
  // 取该调用点前 1200 字符的注释区（豁免的理由必须写在它旁边，不许飘在文件头）
  const near = src.slice(Math.max(0, at - 1200), at + 400);
  for (const kw of ['读数', '结算', '有意']) {
    assert.ok(near.indexOf(kw) >= 0, '豁免处附近缺留痕关键词「' + kw + '」——豁免必须说明为什么是有意的');
  }
  assert.ok(/routes\/verdicts\.js|HTTP|在线/.test(near),
    '豁免处必须写明它不作用于在线落注路径（HTTP 路由不持此口）');
});

// ─────────────── ③ 全仓唯一 + ④ 无开关 ───────────────

test('★③ 全仓 p1b/scripts/** 只有 ' + EXEMPT_ALLOWED + ' 传这个豁免（逐调用点显式，不许第二个脚本偷开）', () => {
  const carriers = listScripts().filter((rel) => passesExempt(codeOnly(read(rel))));
  assert.deepEqual(carriers, [EXEMPT_ALLOWED],
    '以下脚本也传了判词时序豁免：' + JSON.stringify(carriers)
    + ' —— 豁免必须逐调用点显式给出并留痕，不许扩散成惯例，更不许靠开关打开');
});

test('★④ 不许"开关被脚本悄悄打开"：全仓没有按环境变量/全局常量放行这道闸的口子', () => {
  const files = listCode(SCRIPTS, ['.cjs']).concat(listCode(SRC, ['.js', '.cjs']));
  for (const f of files) {
    const code = codeOnly(fs.readFileSync(f, 'utf8'));
    for (const m of code.match(/process\.env\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*['"]([^'"]+)['"]\s*\])/g) || []) {
      const name = (m.match(/\.\s*([A-Za-z0-9_]+)/) || [, m.match(/['"]([^'"]+)['"]/)[1]])[1];
      assert.equal(/SETTLEMENT/i.test(String(name)), false,
        path.relative(ROOT, f) + ' 读了环境变量 ' + name + ' —— 判词时序闸不许有环境变量开关');
    }
    // 豁免的放行只认"调用点显式传 true"，不许有模块级常量默认开着
    assert.equal(/ALLOW_POST_SETTLEMENT|POST_SETTLEMENT_EXEMPT|allowPostSettlement\s*=\s*true/.test(code), false,
      path.relative(ROOT, f) + ' 里出现了「把豁免赋成常量」的写法（开关式豁免）');
  }
});

test('★④b 单一入口：store 侧豁免只从 opts 逐次读出，不从任何默认值/全局态读', () => {
  const code = codeOnly(fs.readFileSync(path.join(SRC, 'db', 'verdictsStore.js'), 'utf8'));
  assert.ok(/exempt\s*:\s*!!\s*\(\s*opts\s*&&\s*opts\.allowPostSettlement\s*===\s*true\s*\)/.test(code),
    'verdictsStore 的豁免判据不在原位了（须是 opts.allowPostSettlement === true 的逐次读取）');
  assert.equal(/function\s+saveVerdict\s*\([^)]*=\s*\{/.test(code), false,
    'saveVerdict 的 opts 不得带默认实参（带默认值＝有人能靠少传一个参数偷开豁免）');
});

// ─────────────── ⑤ 落库形态自检（:memory:，零网络，不开跑任何批脚本） ───────────────

let gid = null;
test.before(() => { db.init(':memory:'); });
test.after(() => { try { db.closeCurrent(); } catch (e) { /* ignore */ } });

test('建局（⑤ 的落点）', () => {
  gid = db.createGame('读数批豁免局', 'werewolf', 6).id;
  predictions.ensurePredictionsTable(db.getConnection());
  vstore.ensureVerdictsTable(db.getConnection());
  // clean 视图是读侧收口，由这里显式建（生产路由在 register 里建，测试不依赖服务启动）
  require('../src/db/verdictsViews').ensureVerdictsCleanView(db.getConnection());
});

/** 造一道"已于 30 分钟前结算"的题（结算时刻回拨，让"晚于"可观测——照 verdicts-leak-gate 夹具）。 */
function settledQuestion(statement) {
  const row = predictions.insertPrediction({
    gameId: gid, day: 1, sourceType: '验证点', statement: statement, prob: 0.5, evidence: [],
  });
  assert.equal(predictions.resolvePrediction(row.id, 'true', '豁免夹具：真值').ok, true);
  db.getConnection().prepare("UPDATE predictions SET resolved_at = datetime('now', ?) WHERE id = ?")
    .run('-30 minutes', row.id);
  return row.id;
}

test('★⑤a 传豁免 ⇒ 放行，但行自报 legacy_post_settlement 且返回值带 excluded（放行≠免费）', () => {
  const pid = settledQuestion('⑤a 读数批题（显式豁免）');
  const r = vstore.saveVerdict(
    { predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '⑤a 读数行。\nP=0.30', impliedProb: 0.3 },
    { allowPostSettlement: true });
  assert.equal(r.ok, true, '显式豁免要放行，否则读数批整层跑不动：' + JSON.stringify(r));
  assert.equal(r.leak_state, 'legacy_post_settlement', '豁免行必须自报家门，不许冒充 clean');
  assert.equal(r.excluded, 1, '放行不等于免费：返回值必须带排除数披露');
});

test('★⑤b 不传豁免 ⇒ 同样的写法被拒写（豁免是"逐调用点显式"，不是默认姿态）', () => {
  const pid = settledQuestion('⑤b 读数批题（未声明豁免）');
  const before = db.getConnection().prepare('SELECT COUNT(*) AS n FROM verdicts WHERE prediction_id = ?').get(pid).n;
  const r = vstore.saveVerdict(
    { predictionId: pid, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '⑤b 没声明的读数行。\nP=0.30', impliedProb: 0.3 });
  assert.equal(r.ok, false, '没声明豁免的读数行必须被时序闸拒（这正是"漏一处就拒一处"）');
  assert.equal(r.reason, 'post_settlement');
  const after = db.getConnection().prepare('SELECT COUNT(*) AS n FROM verdicts WHERE prediction_id = ?').get(pid).n;
  assert.equal(after, before, '★拒写必须真的没写');
});

test('★⑤c 豁免行不进 clean 视图、计入排除数（读侧收口不受这条豁免影响）', () => {
  const views = require('../src/db/verdictsViews');
  const rows = db.getConnection().prepare('SELECT prediction_id FROM verdicts WHERE leak_state = ?').all('legacy_post_settlement');
  assert.ok(rows.length >= 1, '本测试库应当至少有一行豁免行（⑤a 造的）');
  for (const row of rows) {
    assert.equal(db.getConnection().prepare('SELECT * FROM verdicts_clean WHERE prediction_id = ?').all(row.prediction_id).length, 0,
      '豁免行不得出现在 clean 视图里');
    assert.ok(views.leakDisclosure(row.prediction_id).total_excluded >= 1, '豁免行必须计入排除数披露');
  }
});

// ─────────────── ⑥ 对照组：探测器非恒真 ───────────────

test('★⑥ 对照组：探测器认得「带豁免／不带豁免／开关式豁免／注释与字符串里的假豁免」四种形状', () => {
  const shape = (body) => codeOnly(body);
  const mk = (opts) => 'vstore.saveVerdict({ predictionId: 1 }, ' + opts + ');\n';

  // ① 逐调用点字面量 true ⇒ 认
  assert.ok(passesExempt(shape(mk('{ allowPostSettlement: true }'))), '对照组①失效：字面量 true 都没认出来');
  assert.ok(LITERAL_TRUE.test(shape(mk('{ allowPostSettlement: true }'))), '对照组①失效：字面量形状没认出来');
  // ② 少传 ⇒ 不认
  assert.equal(passesExempt(shape(mk('{}'))), false, '对照组②失效：没传豁免也被认成传了');
  // ③ 开关式透传 ⇒ 键在但**不是**字面量 true（这正是 ②③ 两条要拦的形状）
  const sw = shape(mk('{ allowPostSettlement: process.env.P1B_X === "1" }'));
  assert.equal(passesExempt(sw), true, '对照组③前提失效：开关式写法连键都没带上');
  assert.equal(LITERAL_TRUE.test(sw), false, '对照组③失效：环境变量开关被当成了逐调用点显式传参');
  // ④ 注释/字符串里的豁免名不算数（否则本文件前三条全是恒真）
  const decoy = shape("// allowPostSettlement: true\nconst s='allowPostSettlement: true';\n");
  assert.equal(passesExempt(decoy), false, '对照组④失效：注释/字符串里的豁免名被当成了真传参');
  // ⑤ 调用点计数不是恒零：两处调用数两处
  assert.equal(callArgs(shape("a.saveVerdict(x);\nb.saveVerdict(y);\nc.saveVerdictFoo(z);\n"), 'saveVerdict').length, 2,
    '对照组⑤失效：调用点计数口径不对（saveVerdictFoo 不该被算进去）');
});
