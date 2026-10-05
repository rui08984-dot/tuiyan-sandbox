'use strict';
/**
 * p1b/test/mcp-user-tools.test.cjs —— 三条对外工具的行为锁 ＋ 偶发红落盘闸的边界锁
 *
 * ── 覆盖的两件事 ────────────────────────────────────────────────────────────
 *   A. `p1b/mcp/userTools.cjs` 那三条（记一笔 / 我在哪类事上偏 / 这事该归哪一类）
 *   B. `p1b/gates/flakeGate.cjs` 的落盘判据（B 是顺带修的那个洞，见该件头注）
 *
 * ── 为什么 A 的判据要在这里重写一遍而不是抄脚本 ──────────────────────────────
 *   「偏差榜」的口径真源是 `p1b/src/disclosure/habitRank.mjs`（另两轨 2026-09-30 抽出来的），
 *   本文件**照抄那套判据**造一份合成 cells，然后断言归并结果逐位相同 ——
 *   抄的不是「算法」（算法在真源里），是**期望值**。
 *   ★最要紧的一处是**分母**：`delta = 偏差之和 ÷ 够样本的格数 ok`，**不是 ÷ 题数 n**。
 *     下面第 ③ 例专门造一个「n 很大但 ok 只有 1」的域，让「除以 n」的实现必然算错。
 *
 * ── 关于「不许空跑绿灯」 ────────────────────────────────────────────────────
 *   第 ③ 例断言里带一条**同级前置断言**：先验那组合成 cells 真的进了循环
 *   （`cells_total` 5、剔掉 1、剩 4 桶），再验归并数值。循环一次没跑也能过的写法
 *   在这里是不合格的 —— 断言顺序即证明顺序。
 *
 * 零写库、零网络：本文件只 spawn 两个**只读**子脚本（读 `p1b/sim/out` 的 JSON
 *   与 `p1b/src/evidence` 的登记表），不 require 任何 db 模块。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MCP = path.join(ROOT, 'p1b', 'mcp');

const tools = require(path.join(MCP, 'tools.cjs'));
const U = require(path.join(MCP, 'userTools.cjs'));
const flakeGate = require(path.join(ROOT, 'p1b', 'gates', 'flakeGate.cjs'));

/** 一次性暂存目录（合成披露件写这里；跑完即删，不碰仓库任何目录）。 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-mcp-user-tools-'));

/**
 * 合成披露件。★格子的四个字段就是 `habitRank.mjs` 声明的最小形状。
 * 设计的每一格都有用意（旁边逐格注明），期望值在第 ③ 例里逐字写出。
 */
const CELLS = [
  // 域 alpha：两格都够样本。偏差 0.20 与 -0.10 ⇒ 和 0.10，ok=2 ⇒ delta=0.05
  { layer: 'L2', domain: 'alpha', scored_n: 100, conclusion_allowed: true, delta_vs_half: 0.2 },
  { layer: 'L5', domain: 'alpha', scored_n: 20, conclusion_allowed: true, delta_vs_half: -0.1 },
  // 域 beta：**n 很大但只有 1 格够样本**。这一格专门杀「除以 n」的实现
  //   （除以 n 会得 0.4/9000，除以 ok 才得 0.4）
  { layer: 'L2', domain: 'beta', scored_n: 9000, conclusion_allowed: true, delta_vs_half: 0.4 },
  // 域 beta 还有一格**不够样本** ⇒ 它只计 n、不进偏差平均（n 因此变成 9200，ok 仍是 1）
  { layer: 'L3', domain: 'beta', scored_n: 200, conclusion_allowed: false, delta_vs_half: 0.9 },
  // 域 gamma：唯一那格 delta_vs_half 为 null ⇒ 整格不计 ⇒ 这个域**连桶都不该有**
  { layer: 'L1', domain: 'gamma', scored_n: 50, conclusion_allowed: true, delta_vs_half: null },
  // 域 delta：唯一那格**不够样本**（delta 非 null，所以它进了桶，但 ok=0）
  //   ⇒ 它是「被剔掉的域」那一条通路：如实报出来、但不给比例。
  { layer: 'L6', domain: 'delta', scored_n: 7, conclusion_allowed: false, delta_vs_half: 0.5 },
];

const CALIB_FIXTURE = path.join(TMP, 'calibration-report-20991231.json');

test('A① 落账草案的判据：prob 收闭区间 [0,1]，0 与 1 都是合法判断而不是「没填」', () => {
  // ★这一条最容易写错：把 0 当成缺填，会让一条真实判断（「我押它不发生」）凭空消失。
  //   口径出处：p1b/src/routes/predictions.js:75-81 的 requireProb（区间 [0,1]，闭）。
  assert.strictEqual(U.buildNotePlan({ statement: 's', kind: 'k', prob: 0 }).ok, true, 'prob=0 被当成缺填了');
  assert.strictEqual(U.buildNotePlan({ statement: 's', kind: 'k', prob: 1 }).ok, true, 'prob=1 被当成缺填了');
  assert.strictEqual(U.buildNotePlan({ statement: 's', kind: 'k', prob: 0.62 }).ok, true, 'prob=0.62 被拒了');
  // 原样带，不换算、不取整、不拿基率顶
  const p = U.buildNotePlan({ statement: 's', kind: 'k', prob: 0.62 }).plan;
  assert.strictEqual(p.assigned_prob, 0.62, '用户那个数被动了');
  // 越界与非数逐条拒
  for (const bad of [-0.1, 1.1, NaN, Infinity, '0.6', null, undefined]) {
    const r = U.buildNotePlan({ statement: 's', kind: 'k', prob: bad });
    assert.strictEqual(r.ok, false, '越界的 prob 竟然放行了：' + JSON.stringify(bad));
    assert.ok(r.bad[0].why.length > 0, '拒收理由是空的：' + JSON.stringify(bad));
  }
  // 题面 / 真值锚缺一不可（照抄 web/src/lib/noteProb.ts 的 submitGuard 三件）
  assert.deepStrictEqual(
    U.buildNotePlan({ kind: 'k', prob: 0.5 }).bad.map((b) => b.field), ['statement'],
    '缺题面没被指出来');
  assert.deepStrictEqual(
    U.buildNotePlan({ statement: '   ', kind: 'k', prob: 0.5 }).bad.map((b) => b.field), ['statement'],
    '纯空白的题面被当成有题面了');
  assert.deepStrictEqual(
    U.buildNotePlan({ statement: 's', prob: 0.5 }).bad.map((b) => b.field), ['kind'],
    '缺真值锚没被指出来');
});

test('A② 记一笔是写意图工具：草案不成立 ⇒ isError；成立 ⇒ NOT_CONFIRMED 且账本未动', () => {
  // 两种返回**语义相反**，混起来是最容易犯的错：草案没成形是**用法错**（可以重试），
  // 草案成形但闸拦下了是**正常的预览**（重试无用）。断言把两者分开钉死。
  const bad = tools.callTool('p1b_note_record', { statement: '', prob: 5, kind: 'openmeteo_daily_max' });
  assert.strictEqual(bad.isError, true, '草案没成形却报成了成功');
  assert.strictEqual(bad.structuredContent.verdict.gate, 'INPUT');
  assert.deepStrictEqual(bad.structuredContent.verdict.bad_fields, ['statement', 'prob']);

  const ok = tools.callTool('p1b_note_record', { statement: '明天 上海 最高气温 > 35°C', prob: 0.62, kind: 'openmeteo_daily_max' });
  assert.ok(ok.isError !== true, '正常调用报错了');
  assert.strictEqual(ok.structuredContent.verdict.gate, 'NOT_CONFIRMED');
  assert.strictEqual(ok.structuredContent.verdict.do_not_retry, true, '没标出「不要重试」');
  assert.strictEqual(ok.structuredContent.recorded, false, '自称记账了');
  assert.strictEqual(ok.structuredContent.write_plan.statement, '明天 上海 最高气温 > 35°C');
  assert.strictEqual(ok.structuredContent.write_plan.assigned_prob, 0.62);
  // ★没有 will_execute 是**有意的**（闸后面没有一条现成的命令行），并说清了为什么。
  assert.strictEqual(ok.structuredContent.will_execute, null);
  assert.ok(ok.structuredContent.will_execute_absent_why.length > 0, '没交代为什么没有可粘贴的命令');
  assert.ok(ok.structuredContent.how_to_record.length >= 2, '没列出真实存在的落账通路');
  // 不碰私钥：返回体里不得出现任何形似地址/端口/令牌的串。
  const dumped = JSON.stringify(ok.structuredContent);
  assert.ok(dumped.indexOf('://') < 0, '返回体里出现了 scheme:// 形状的串：' + dumped.slice(0, 200));
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(dumped), '返回体里出现了 IPv4 形状的串');
});

test('A③ 我在哪类事上偏：分母是「够样本的格数」而不是题数，且 n<30 的格不参与', () => {
  fs.writeFileSync(CALIB_FIXTURE, JSON.stringify({
    generated_at: '2099-12-31T00:00:00.000Z',
    cells: CELLS,
  }), 'utf8');

  // ★用真表跑一遍：先证明合成件真的被读到了、循环真的逐格走过，再验归并数值。
  //   一次没跑也能过的写法在这里不合格。
  const direct = require('node:child_process').spawnSync(
    process.execPath,
    [path.join(ROOT, 'p1b', 'scripts', 'where-i-bias.cjs'), '--calibration', CALIB_FIXTURE, '--json'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(direct.status, 0, '子件没跑成功：' + direct.stderr);
  const j = JSON.parse(direct.stdout);

  // ── 前置断言：循环确实执行了 ──
  // 6 格进循环 ⇒ alpha 2 ＋ beta 2 ＋ gamma 1 ＋ delta 1。
  // gamma 那格 delta 为 null ⇒ 整格跳过 ⇒ gamma 连桶都不进；
  // delta 那格 delta 非 null 但不够样本 ⇒ 进了桶、ok=0 ⇒ 落进「被剔掉的域」那一条通路。
  // ⇒ 桶 = alpha / beta / delta 三个；榜 = beta / alpha 两个；被剔 = delta 一个。
  assert.strictEqual(j.cells_total, 6, '合成件没被读到（cells_total 应为 6）');
  assert.strictEqual(j.habit_buckets_total, 3, '归并桶数不对：应剩 alpha/beta/delta 三个桶');
  assert.strictEqual(j.habit_buckets_dropped, 1, '被剔掉的域数不对（只有 delta 一个 ok=0）');
  assert.ok(j.habits.length > 0, '榜是空的 —— 循环一定没跑（若判据被改成全剔，这里就会空）');

  // ── 归并数值：逐字期望值，不是「差不多」──
  const byDomain = {};
  for (const h of j.habits) byDomain[h.domain] = h;
  assert.deepStrictEqual(Object.keys(byDomain).sort(), ['alpha', 'beta'],
    'gamma（唯一那格为 null）不该进榜；delta（ok=0）也不该进榜');
  // alpha：偏差和 0.10，够样本格数 2 ⇒ 0.05。★若错除以 n（120）会得 0.000833…
  assert.strictEqual(byDomain.alpha.ok, 2, 'alpha 的够样本格数不对');
  assert.strictEqual(byDomain.alpha.n, 120, 'alpha 的题数不对（应含全部可算格）');
  assert.strictEqual(byDomain.alpha.delta, 0.05, 'alpha 的 delta 不对');
  // beta：★分母是格数不是题数 —— 唯一够样本格的 0.4，n 高达 9200，除以 n 会得 0.000043
  assert.strictEqual(byDomain.beta.ok, 1, 'beta 的够样本格数不对');
  assert.strictEqual(byDomain.beta.n, 9200, 'beta 的题数不对（不够样本的那格也要计 n）');
  assert.strictEqual(byDomain.beta.delta, 0.4, 'beta 的 delta 不对（分母必须是格数 1，不是题数 9200）');
  // 排序：|delta| 降序 ⇒ beta(0.4) 在 alpha(0.05) 之前
  assert.deepStrictEqual(j.habits.map((h) => h.domain), ['beta', 'alpha'], '排序不是按 |delta| 降序');
  // 被剔掉的域：delta（唯一那格不够样本 ⇒ ok=0）必须**如实**回，且不给比例。
  // ★gamma 不在这里：它那格 delta 为 null，整格在进桶之前就被跳过了，桶数组里根本没有它
  //   —— 「压根没进循环」与「进了循环但样本不够」是两件事，前者不出现在 dropped 里。
  assert.deepStrictEqual(j.dropped_domains.map((d) => d.domain), ['delta'], '该被如实报成被剔掉的域不是 delta');
  assert.strictEqual(j.dropped_domains[0].reason.indexOf('n<30') >= 0, true, '剔掉的理由没写明 n<30 纪律');
  assert.strictEqual(j.dropped_domains[0].delta, undefined, '被剔掉的域不该带比例');
  // 口径随计算走（不给黑盒数字）
  assert.ok(j.ranking && j.ranking.denominator.indexOf('格数') >= 0, '返回体没带上分母口径');
  assert.ok(Array.isArray(j.discipline) && j.discipline.length > 0, '返回体没带纪律声明');
});

test('A④ 我在哪类事上偏：走 MCP 通道时，structuredContent.data 与原文一致', () => {
  const r = tools.callTool('p1b_where_i_bias', {});
  assert.ok(r.isError !== true, 'MCP 通道调它报错了：' + r.content[0].text.slice(0, 300));
  assert.strictEqual(r.structuredContent.exit, 0);
  // 真实披露件在仓里（calibration-report-*.json），所以这里必须有内容。
  // ★前置断言：真的返回了非空榜 —— 空榜会让后面所有数值断言变成空转。
  assert.ok(r.structuredContent.data, '没有解析出 data');
  assert.ok(Array.isArray(r.structuredContent.data.habits), 'habits 不是数组');
  assert.ok(r.structuredContent.data.habits.length > 0,
    '真实披露件上算出空榜（若判据被改坏，这里会空）');
  // 每一行都必须同时带 n 与 ok —— 只报一个就是在骗人
  for (const h of r.structuredContent.data.habits) {
    assert.strictEqual(typeof h.n, 'number', '榜上一行缺 n：' + JSON.stringify(h));
    assert.strictEqual(typeof h.ok, 'number', '榜上一行缺 ok：' + JSON.stringify(h));
  }
  // 原文逐位透传（不改一个字）—— data 只是附加的一份便利视图
  assert.deepStrictEqual(JSON.parse(r.content[0].text), r.structuredContent.data, '原文与 data 不是同一份');
});

test('A⑤ 这事该归哪一类：查一个 kind / 查全表 / 未登记的 kind 都照实答', () => {
  const one = tools.callTool('p1b_which_layer', { kind: 'cta_daily_total_rides' });
  assert.ok(one.isError !== true, '查一个 kind 报错了：' + one.content[0].text.slice(0, 200));
  assert.strictEqual(one.structuredContent.data.one.cls, 'stuck', '地域封禁那个 kind 应判 stuck');
  assert.strictEqual(one.structuredContent.data.one.registered_in_reveal_class, true);

  // ★未登记的 kind **不是错**，是「保守按要人答处理」—— 而且两件事要分开报
  const unknown = tools.callTool('p1b_which_layer', { kind: 'some_kind_never_seen_2099' });
  assert.ok(unknown.isError !== true, '未登记的 kind 报错了（它应当照实答 human）');
  assert.strictEqual(unknown.structuredContent.data.one.cls, 'human');
  assert.strictEqual(unknown.structuredContent.data.one.registered_in_reveal_class, false);
  assert.strictEqual(unknown.structuredContent.data.one.supported_kind, false,
    '未登记的 kind 竟然自报在支持表内');

  // 全表：三类互斥且完备，计数与清单对得上
  const all = tools.callTool('p1b_which_layer', {});
  assert.ok(all.isError !== true);
  const d = all.structuredContent.data;
  assert.ok(d.kinds.length > 0, '全表是空的');
  assert.strictEqual(d.total, d.kinds.length, 'total 与清单行数对不上');
  assert.strictEqual(d.by_class.ok + d.by_class.human + d.by_class.stuck, d.total,
    '三类之和必须等于总数（互斥且完备）');
  // ★前置断言：三类**都真的有行**（三类各至少 1 条，循环确实逐行跑过）
  for (const c of ['ok', 'human', 'stuck']) {
    assert.ok(d.by_class[c] > 0, '第 ' + c + ' 类一行都没有 ⇒ 分类循环没跑');
  }
});

test('A⑥ 对外表的自检：写意图工具不许挂子脚本，spawn 型必须自报只读', () => {
  assert.doesNotThrow(() => U.assertUserCoverage(), '对外工具表自检没过');
  // 写意图那一条结构上写不了任何东西 —— 这条不变量由 assertUserCoverage 钉住，
  // 这里再从**表的内容**上验一遍（自检函数本身也可以被顺手改掉）。
  const note = U.USER_TOOLS.find((t) => t.name === 'p1b_note_record');
  assert.ok(note, 'p1b_note_record 不在对外表里');
  assert.strictEqual(note.script, undefined, '★记一笔挂了子脚本 —— 它会从预览变成真写');
  assert.strictEqual(note.run, 'confirm-gate');
  // 两条只读的那几条都挂在**只读**子脚本上，且都不打网
  for (const n of ['p1b_where_i_bias', 'p1b_which_layer']) {
    const t = U.USER_TOOLS.find((x) => x.name === n);
    assert.ok(t, n + ' 不在对外表里');
    assert.strictEqual(t.run, 'spawn-script');
    assert.strictEqual(t.annotations.readOnlyHint, true, n + ' 没有自报只读');
    assert.strictEqual(t.annotations.openWorldHint, false, n + ' 自报了联网');
  }
  // 每条对外工具的描述都必须写清「不能做什么」与「越界时返回什么」
  for (const t of U.USER_TOOLS) {
    assert.ok(t.desc.indexOf('不能做什么') >= 0, t.name + ' 的描述缺「不能做什么」');
    assert.ok(t.desc.indexOf('越界时返回什么') >= 0, t.name + ' 的描述缺「越界时返回什么」');
    assert.ok(t.desc.indexOf('私钥') >= 0, t.name + ' 的描述没写「不碰私钥」');
  }
});

test('B 偶发红落盘闸：那份打桩现场（0.00s / 0.00s）必须被拒，真现场必须放行', () => {
  // ★判据取两次里**较慢**的那次：复跑才是「真跑一遍」的那次。
  //   起点是 `.run-out/gate-flakes/` 里那份假现场（首跑 0.00s / 复跑 0.00s），
  //   它曾让「看最新一份」的人得出「后端道今天又红了」的错误结论。
  assert.strictEqual(flakeGate.decide(0, 0).record, false, '0.00s 的打桩现场被放进了证据目录');
  // 同目录另三份真现场（78s / 112s / 123s）必须照常落盘 —— 闸不能把真现场也杀掉
  assert.strictEqual(flakeGate.decide(78, 123).record, true, '真现场被误杀了');
  assert.strictEqual(flakeGate.decide(112.4, 0.3).record, true, '真现场被误杀了（首跑慢的那次）');
  assert.strictEqual(flakeGate.decide(0.2, 98).record, true, '真现场被误杀了（复跑慢的那次 —— 判据必须看较慢的那次）');
  // 边界：恰好 1s 放行、0.999s 拒
  assert.strictEqual(flakeGate.MIN_SECS, 1);
  assert.strictEqual(flakeGate.decide(1, 0).record, true, '恰好 1s 被拒了');
  assert.strictEqual(flakeGate.decide(0.999, 0.999).record, false, '0.999s 被放行了');
  // ★NaN 必须按 0 参与比较：`NaN < 1` 是 false，不加这道防御的话 NaN 会**放行**一份不可信现场。
  assert.strictEqual(flakeGate.decide(NaN, 0).record, false, 'NaN 用时放行了（比较语义被 NaN 吞掉）');
  assert.strictEqual(flakeGate.decide(NaN, NaN).record, false, '两个 NaN 放行了');
  // 返回值要带得上「为什么拒」，否则下一个人会以为记录丢了
  const d = flakeGate.decide(0, 0);
  assert.strictEqual(typeof d.slowest, 'number');
  assert.strictEqual(d.min, flakeGate.MIN_SECS);
});

test('B② 落盘处真的接上了判据（不是只加了一个没人调的件）', () => {
  // flakeGate 住在自己的件里是为了能被测；但**闸门脚本必须真的调它**，
  // 否则就是「加了个测试，却没接到现场」—— 这条断言防的正是那种改动。
  const src = fs.readFileSync(path.join(ROOT, 'p1b', 'gates', 'gates.cjs'), 'utf8');
  assert.ok(src.indexOf("require(path.join(__dirname, 'flakeGate.cjs'))") >= 0, 'gates.cjs 没有 require flakeGate');
  assert.ok(/flakeGate\.decide\(/.test(src), 'gates.cjs 没有调用 flakeGate.decide');
  // 落盘的那一行必须落在判据的**否**分支之外：拒收分支里不许出现 writeFileSync 目标目录
  const guardAt = src.indexOf('flakeGate.decide(');
  const writeAt = src.indexOf("path.join(REPO, '.run-out', 'gate-flakes')", guardAt);
  assert.ok(writeAt > guardAt, '落盘处的闸门不在写盘之前（顺序反了）');
});
