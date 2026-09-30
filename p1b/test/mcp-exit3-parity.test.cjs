'use strict';
/**
 * p1b/test/mcp-exit3-parity.test.cjs —— **对照组**测试：exit 3 → isError:false，exit 1 → isError:true
 *
 * ── 为什么必须两个方向都测 ────────────────────────────────────────────────
 * 只测「exit 3 ⇒ isError:false」是一条**恒真也能过**的弱断言：
 * 把映射写成 `isError: false`（不管退出码是什么），它照样绿。
 * 本文件用两个方向把它夹住：
 *   · 真实 exit 3（`门禁 锚点` 喂 0 候选）⇒ `isError` 必须是 false ＋ `verdict.gate==='FAIL'`
 *   · 真实 exit 1（同一条命令喂坏 JSON）  ⇒ `isError` 必须是 **true**
 * 只写前一条 ⇒ 把 `exit 3 ⇒ isError:true` 这个变异打不红。
 * ★变异验证记录在 `docs/specs/2026-09-29-MCP适配层说明.md`（把映射改成 isError:true 后本文件必须红）。
 *
 * ── 两条用例的输入是同一条命令 ────────────────────────────────────────────
 * 变量只有**文件内容**，命令、脚本、参数、代码路径全都一样 ⇒ 退出码 3 与 1 的差别
 * 只可能来自映射本身。这是能证明「不是恒真断言」的最强形式。
 *
 * 零写库：只往 `.scratch/mcp-t/` 写两个一次性 fixture，跑完删掉。
 * `门禁 锚点` 是 R 档（`p1b/cli/commands.cjs:194-203`），只读那个 json、不写任何产物
 * （脚本只在给了 `--out/--md` 时才写盘），不碰 p1a.db。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const tools = require(path.join(ROOT, 'p1b', 'mcp', 'tools.cjs'));
const { mapExit } = require(path.join(ROOT, 'p1b', 'mcp', 'exitMap.cjs'));

/** fixture 放临时目录而不是仓库里：跑测试不该往工作区扔文件。 */
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-mcp-exit-'));
const EMPTY = path.join(FIX, 'empty-candidates.json');
const BAD = path.join(FIX, 'malformed.json');
fs.writeFileSync(EMPTY, JSON.stringify({ candidates: [], drops: [] }), 'utf8');
fs.writeFileSync(BAD, '{ this is not valid json', 'utf8');
test.after(() => { try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* 临时目录，删不掉不影响判定 */ } });

test('exit 3 ⇒ isError 缺席（即 false）且 verdict.gate === "FAIL" —— 裁决不是崩溃', () => {
  const r = tools.callTool('p1b_audit_anchor_gate', { candidates: EMPTY });
  const sc = r.structuredContent;

  // 先确认 fixture 真的触发了 exit 3（否则本测试可能在测一个根本没发生的码）
  assert.strictEqual(sc.exit, 3, '期望子进程退出码 3，实际 ' + sc.exit);
  assert.notStrictEqual(sc.exit, 1, '若这一条实际是 exit 1，本测试已失去对照意义');

  // ★核心断言：门禁码走成功通道。
  assert.strictEqual(r.isError, undefined,
    '★门禁码不得标成 isError:true —— 客户端会把它当「调用失败」去重试，'
    + '而这次调用其实正确地得出了「候选 0 条，不许被读成通过」的裁决。实际 isError=' + r.isError);
  assert.ok(r.content && r.content.length >= 1, '必须带 content 文本块，模型要看得见 stdout');
  assert.ok(r.content[0].text.indexOf('候选 0 条') >= 0, 'content 里应有子进程自己的解释文本');

  assert.strictEqual(sc.verdict.gate, 'FAIL', 'verdict.gate 应为 FAIL');
  assert.strictEqual(sc.verdict.do_not_retry, true, '门禁裁决必须标 do_not_retry');
  assert.strictEqual(sc.verdict.kind, 'VERDICT', '门禁 锚点 的 exit 3 是裁决');
  assert.match(sc.verdict.where, /anchor-gate\.cjs:209/, 'verdict.where 应指到出处');
  assert.strictEqual(sc.disclaimer.length > 0, true, '每条返回都要带 disclaimer');
});

test('对照组：exit 1 ⇒ isError:true —— 证明上一条不是恒真断言', () => {
  // 同样的命令、同样的调用方式，只把 fixture 换成坏 JSON。
  // anchor-gate.cjs 对入参做 JSON.parse 且不包 try/catch ⇒ 未捕获异常 ⇒ node 退出 1。
  const r = tools.callTool('p1b_audit_anchor_gate', { candidates: BAD });
  const sc = r.structuredContent;

  assert.strictEqual(sc.exit, 1, '期望子进程退出码 1，实际 ' + sc.exit);
  assert.strictEqual(r.isError, true,
    '★一般错误必须标 isError:true —— 若这里也是 false，那前一条的 false 就证明不了任何映射');
  assert.strictEqual(sc.verdict.gate, 'ERROR');
  assert.strictEqual(sc.verdict.do_not_retry, undefined, '只有门禁裁决才带 do_not_retry');
});

test('两个方向合起来 ⇒ mapExit 不是恒真断言（直接对纯函数做穷举）', () => {
  // 把 mapExit 当纯函数穷举一遍：0/1/2/3/4/其它 六个输入的 isError 必须**不是同一个常量**。
  const seen = new Set();
  for (const code of [0, 1, 2, 3, 4, 7]) {
    seen.add(mapExit({ toolName: 'p1b_audit_anchor_gate', exit: code, stderr: '' }).isError);
  }
  assert.strictEqual(seen.size, 2, '六个不同退出码只映射出 ' + seen.size + ' 种 isError —— 映射退化成常量了');
});

test('exit 2 的两种来源必须分开：确认闸 ⇒ 不算错；用法错 ⇒ 算错', () => {
  // 确认闸那条：W 档工具，MCP 永不带 --确认 ⇒ CLI 在 spawn 之前 return exit 2。
  const gate = tools.callTool('p1b_settle_corpus', {});
  assert.strictEqual(gate.structuredContent.exit, 2, '期望确认闸的 exit 2，实际 ' + gate.structuredContent.exit);
  assert.strictEqual(gate.isError, undefined, '确认闸正常工作不是错误');
  assert.strictEqual(gate.structuredContent.gate_not_confirmed, true);
  assert.strictEqual(gate.structuredContent.verdict.gate, 'NOT_CONFIRMED');
  assert.strictEqual(gate.structuredContent.verdict.do_not_retry, true, '★不许重试：重试一万次也还是被闸拦着');
  assert.ok(gate.structuredContent.will_execute, '必须带上完整的「将要执行什么」，模型要把它交给人类');
  assert.ok(gate.structuredContent.will_execute.indexOf('--确认') < 0,
    'will_execute 里不得含确认 token —— 它是给人照着敲的，token 由人自己加');

  // 用法错那条：需要位置参数的工具不给参数 ⇒ 也是 exit 2，但这次是真的错。
  const usage = tools.callTool('p1b_audit_prereg_freeze', {});
  assert.strictEqual(usage.structuredContent.exit, 2, '期望用法错的 exit 2，实际 ' + usage.structuredContent.exit);
  assert.strictEqual(usage.isError, true, '缺位置参数是真的错，模型应该改参数后重试');
  assert.strictEqual(usage.structuredContent.verdict.gate, 'USAGE');
});

test('协议层：未知工具走协议级 error，不走 isError；initialize 已改为兼容层', () => {
  const { handleMessage } = require(path.join(ROOT, 'p1b', 'mcp', 'protocol.cjs'));
  const unknown = handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } });
  assert.strictEqual(unknown.error.code, -32602, '未知工具应是 INVALID_PARAMS');

  // ★★2026-09-30 **决策变更**（创始人裁定「兼容吧」，推翻本条原来的另一半）。
  //   原来这里断言「老客户端发 initialize 必须**明确失败**」（-32601），理由是
  //   2026-07-28 修订版已移除该方法（实测 schema/2026-07-28/schema.ts 中该串 0 次）。
  //   ★但那等于「装上了却连不上」——现存 MCP 客户端绝大多数仍只发 initialize。
  //   ⇒ 现在 initialize / notifications/initialized / ping 作为**兼容层**被实现，
  //   老客户端能连；★**新规范主路径（server/discover）一字未动**。
  //   兼容层的完整用例见 `mcp-legacy-handshake.test.cjs`，此处只钉住「它不再是 -32601」。
  const init = handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.strictEqual(init.error, undefined,
    '★initialize 现在是兼容层方法，不该再回 -32601（老客户端靠它连上来）：' + JSON.stringify(init.error));
  assert.ok(init.result && init.result.capabilities && init.result.capabilities.tools,
    '兼容层必须宣告 tools 能力，否则老客户端不列工具');
  // ★但「未知方法仍要失败」这条不能被兼容层带歪：
  assert.strictEqual(
    handleMessage({ jsonrpc: '2.0', id: 3, method: 'some/method', params: {} }).error.code, -32601,
    '★未知方法仍必须是 METHOD_NOT_FOUND——兼容层不许变成「什么都回 ok」');
});
