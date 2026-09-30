'use strict';
/**
 * p1b/test/mcp-golden.test.cjs —— MCP 工具表金样（2026-09-29 首版；2026-09-30 加对外工具三条）
 *
 * 钉死四件「对外暴露面」的性质。每一条都对应一种具体的翻车方式：
 *
 *   ① **恰好 21 条 ＝ 18 条 CLI 投影（R10 / F7 / W1）＋ 3 条对外工具（R2 / 写意图 1）**
 *      —— 防「悄悄加了一个写工具」。工具表是对外契约，而这份项目里
 *      **0 个工具能写 p1a.db**（W 那条被确认闸物理拦死；写意图那条连子进程都不起）。
 *      多出一条**真能写**的工具 = 对外多开一个面，且没人会注意到 tools/list 变长了。
 *      少一条 = 能力静默消失，模型从此不知道它能问什么。
 *   ② **工具名集合的 sha256 固定** —— 改名比多条更难发现：模型仍然看得见全部条数，
 *      但所有 prompt/脚本/文档里引用的旧名全部失效。条数不变而名字全换，肉眼扫不出来。
 *   ③ **CLI 投影那 18 条与 commands.cjs 严格 1:1**；对外那 3 条**不在**命令表里（它们在 CLI 侧
 *      没有对应命令，见 `p1b/mcp/userTools.cjs` 头注），本断言把它们分开数、且**不许重叠**。
 *   ④ **本层自撰文案里不出现「预测」二字** —— 合规红线（设计书 :560）：
 *      MCP 的 description 与返回文本一旦出现指向未来的措辞，外部调用者就会读成「建议」。
 *      ★**只扫本层自撰的文案**：CLI 子进程的 stdout 逐位透传，里面该有的字一个都不能改
 *      （改了就是在 CLI 与 MCP 之间造第二套口径）。所以本断言扫的是「源码 ＋ tools/list
 *      载荷」两层，而不是工具返回值。
 *
 * ★2026-09-30 的改动只有一处：18 → 21（加对外工具三条），以及把 ①③ 的口径从「全表」
 *   拆成「CLI 投影 18 条」与「对外 3 条」两段分别断言。**判据一个都没放宽**：
 *   两段的条数、档位、名字集合、不重叠，仍全部钉死；指纹也照旧重算并写死在 ② 里。
 *
 * 零写库、零网络：本文件只 require `p1b/mcp/**` 与 `p1b/cli/commands.cjs`，
 * 前者对 p1a.db 零接触（见 `mcp-no-ledger-write.test.cjs` 的机械证明）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const MCP = path.join(ROOT, 'p1b', 'mcp');

const T = require(path.join(MCP, 'toolTable.cjs'));
const U = require(path.join(MCP, 'userTools.cjs'));
const tools = require(path.join(MCP, 'tools.cjs'));
const C = require(path.join(ROOT, 'p1b', 'cli', 'commands.cjs'));

/** CLI 投影那 18 条（对外工具不算在内 —— 它不在 commands.cjs 里）。 */
function cliProjected() { return tools.listTools().filter((t) => T.lookup(t.name) !== null); }
/** 对外那 3 条。 */
function userFacing() { return tools.listTools().filter((t) => T.lookup(t.name) === null); }

/** 工具名集合的指纹。**排序后**再哈希 —— 顺序不是契约，集合才是。 */
function namesSha256(list) {
  return crypto.createHash('sha256').update(list.slice().sort().join('\n')).digest('hex');
}

test('① tools/list 恰好 21 条 ＝ CLI 投影 18（R10/F7/W1）＋ 对外 3（R2 ＋ 写意图 1）', () => {
  const list = tools.listTools();
  assert.strictEqual(list.length, 21, '工具条数变了：' + list.length);

  // ── CLI 投影那 18 条：档位分布直接从 commands.cjs 数，不从 tools.cjs 数 —— 前者是分类的源头。
  const byTier = {};
  for (const c of C.allCommands()) byTier[c.tier] = (byTier[c.tier] || 0) + 1;
  assert.deepStrictEqual(byTier, { R: 10, F: 7, W: 1 }, 'commands.cjs 的档位分布变了');

  // 再从 MCP 侧的 annotations 反数一遍，两个数必须对上：这是「档位→hint 是 1:1 抄写」的机械证明。
  const proj = cliProjected();
  const ro = proj.filter((t) => t.annotations.readOnlyHint === true).length;
  const de = proj.filter((t) => t.annotations.destructiveHint === true).length;
  const ow = proj.filter((t) => t.annotations.openWorldHint === true).length;
  const ww = proj.filter((t) => t.annotations.destructiveHint === true && t.annotations.readOnlyHint === false).length;
  assert.strictEqual(proj.length, 18, 'CLI 投影条数变了：' + proj.length);
  assert.strictEqual(ro, byTier.R, 'readOnlyHint=true 的条数应等于 R 档条数');
  assert.strictEqual(de, byTier.W, 'destructiveHint=true 的条数应等于 W 档条数（W 档默认就是 true，必须显式写）');
  assert.strictEqual(ww, byTier.W, 'readOnly=false 且 destructive=true 的应只有 W 档');
  assert.strictEqual(ow, C.allCommands().filter((c) => c.net).length, 'openWorldHint=true 的条数应等于 net:true 的条数');

  // ── 对外那 3 条：结构自检见 userTools.assertUserCoverage，这里钉对外可见的性质。
  const usr = userFacing();
  assert.strictEqual(usr.length, 3, '对外工具条数变了：' + usr.length);
  // ★**0 个工具真能写库**这条老纪律现在要覆盖两张表：
  //   对外那 3 条里没有一条 destructiveHint=true（写意图那条结构上写不了任何东西）。
  const usrDestructive = usr.filter((t) => t.annotations.destructiveHint === true);
  assert.deepStrictEqual(usrDestructive.map((t) => t.name), [], '★出现了自报破坏性的对外工具');
  const usrNet = usr.filter((t) => t.annotations.openWorldHint === true);
  assert.deepStrictEqual(usrNet.map((t) => t.name), [], '★出现了打网的对外工具（本批三条一律不联网）');
  // 写意图那一条必须自报「不是只读」——客户端据此决定要不要拦一下。
  const noteRec = usr.filter((t) => t.name === 'p1b_note_record');
  assert.strictEqual(noteRec.length, 1, 'p1b_note_record 不在表里');
  assert.strictEqual(noteRec[0].annotations.readOnlyHint, false, '写意图工具必须自报 readOnlyHint=false');
});

test('② 工具名集合的 sha256 固定（改名比多条更难发现）', () => {
  // 2026-09-29 首次落地时实测写死；2026-09-30 加对外三条后重算。
  // 改工具名 = 改对外契约，必须连同所有引用一起改，然后才允许动这一个常量。
  const EXPECTED = 'b10c4626316027692c7036e07455dd2f9f3bd2f22d9b52d074d35490998ddfb0';
  const actual = namesSha256(tools.listTools().map((t) => t.name));
  assert.strictEqual(actual, EXPECTED, '工具名集合变了 —— 若是刻意改名，请连同所有引用一起改并在此处更新指纹');
});

test('③ CLI 投影那 18 条与 commands.cjs 严格 1:1；对外 3 条不在命令表里且不与之重叠', () => {
  const NAME_RE = /^[a-z][a-z0-9_]*$/;
  for (const t of tools.listTools()) {
    assert.match(t.name, NAME_RE, '工具名不是全 ASCII 小写蛇形：' + t.name);
    assert.ok(t.name.startsWith('p1b_'), '工具名必须以 p1b_ 前缀开头：' + t.name);
  }
  // 双向：不多不少一一对上
  const fromCli = C.allCommands().map((c) => 'p1b_' + c.group.key + '_' + T.asciiMap()[c.group.key + '/' + c.zh]).sort();
  assert.deepStrictEqual(cliProjected().map((t) => t.name).sort(), fromCli, 'MCP 工具名与 commands.cjs 不是一一对应');

  // 对外那 3 条：既不在命令表投影里，也不与它重叠（不重叠由上面的过滤式定义保证，
  // 这里显式再钉一次「对外表自己那份也在 tools/list 里」，防止有人把 userTools 忘了接进 listTools）。
  const userNames = U.allUserToolNames().slice().sort();
  assert.deepStrictEqual(userFacing().map((t) => t.name).sort(), userNames, '对外工具表与 tools/list 里的对外那几条对不上');
  assert.strictEqual(userNames.length, 3, '对外工具条数变了：' + userNames.length);
  for (const n of userNames) {
    assert.ok(fromCli.indexOf(n) < 0, n + ' 同时出现在命令表投影与对外表里（重叠会让 1:1 断言失去意义）');
  }
});

test('④ 发出去的文案不出现「预测」二字（合规红线）', () => {
  // ★**扫描面只取「真正发出去的东西」**：tools/list 载荷 ＋ server/discover 的 instructions。
  //   刻意不扫本层源码全文 —— 那会把「禁止使用某词」这条规则自己的说明也判成违规，
  //   而红线（设计书 :560）管的是 **description 与返回文本**，不是代码注释。
  //   源码里的字只要没进载荷，就不构成对外文案。
  // ★子进程的 stdout **逐位透传**，里面该有的字一个都不能改（改了就是在 CLI 与 MCP
  //   之间造第二套口径，见设计书 §2.4 否决方案③ 的理由）—— 所以本条也不扫工具返回值。
  const list = tools.listTools();
  for (const t of list) {
    assert.ok(t.description.indexOf('预测') < 0, '工具描述含禁用词：' + t.name);
    assert.ok(t.annotations.title.indexOf('预测') < 0, '工具 title 含禁用词：' + t.name);
    assert.ok(JSON.stringify(t.inputSchema).indexOf('预测') < 0, '工具 inputSchema 含禁用词：' + t.name);
  }
  const { INSTRUCTIONS } = require(path.join(MCP, 'protocol.cjs'));
  assert.ok(INSTRUCTIONS.indexOf('预测') < 0, 'server/discover 的 instructions 含禁用词');
  // 整份 tools/list 载荷兜一层：防「某天有人往 tool 上加了 notes/title 之类的新字段并塞进禁词」。
  assert.ok(JSON.stringify(list).indexOf('预测') < 0, 'tools/list 整份载荷含禁用词');
  // 顺带钉住一条：本层**不转发** commands.cjs 的原始 desc（`读数 分层` 那条含该词）。
  // 这是「描述是本层自撰的」这条纪律的机械证据 —— 哪天有人图省事改成 c.desc 就打红。
  assert.ok(C.allCommands().some((c) => (c.desc || '').indexOf('预测') >= 0),
    'commands.cjs 里已无 desc 含该词 ⇒ 本层的「不转发原始 desc」已失去意义，请复核此断言是否还成立');
});

test('⑤ 联机工具可被部署策略整体关掉（P1B_MCP_ALLOW_NET=0 ⇒ 20 条）', () => {
  const withNet = tools.listTools({ env: { P1B_MCP_ALLOW_NET: '1' } });
  const offNet = tools.listTools({ env: { P1B_MCP_ALLOW_NET: '0' } });
  assert.strictEqual(withNet.length, 21);
  assert.strictEqual(offNet.length, 20, '关掉联机后应少一条');
  const gone = withNet.map((t) => t.name).filter((n) => offNet.map((x) => x.name).indexOf(n) < 0);
  assert.deepStrictEqual(gone, ['p1b_settle_corpus'], '关掉的应当且仅应当是唯一那条 net:true 的工具');
  // 被关掉的工具调不动：不能只是「不列出来」而是「列出来也调不通」
  assert.throws(() => tools.callTool('p1b_settle_corpus', {}, { env: { P1B_MCP_ALLOW_NET: '0' } }), /已按部署策略下线/);
  // ★对外那 3 条**不受**这条闸影响：它们一条都不联网，「关掉联机」不该把只读能力一起摘掉。
  for (const n of U.allUserToolNames()) {
    assert.ok(offNet.map((x) => x.name).indexOf(n) >= 0, n + ' 在关掉联机后消失了（它不联网，不该被摘）');
  }
});

test('⑥ 确认闸类工具的描述必须写明「不会真的执行」与「不要重试」', () => {
  for (const n of ['p1b_settle_corpus', 'p1b_backup_offsite']) {
    const d = T.DESC[n];
    assert.ok(d.indexOf('不要重试') >= 0, n + ' 的描述缺「不要重试」');
    assert.ok(d.indexOf('--确认') >= 0, n + ' 的描述没交代确认闸怎么过');
  }
  // ★写意图那条走的是另一张表（userTools），判据同上：闸 + 不要重试，两句都得在。
  const noteDesc = U.USER_TOOLS.find((t) => t.name === 'p1b_note_record').desc;
  assert.ok(noteDesc.indexOf('不要重试') >= 0, 'p1b_note_record 的描述缺「不要重试」');
  assert.ok(noteDesc.indexOf('永远不会真的记账') >= 0, 'p1b_note_record 的描述没写明它永远不会记账');
  // exit 3 的逐命令语义必须在表里，否则模型只能笼统读成「门禁不通过」
  assert.strictEqual(T.exit3Of('p1b_audit_anchor_gate').kind, 'VERDICT');
  assert.strictEqual(T.exit3Of('p1b_audit_prereg_freeze').kind, 'CRASH', 'prereg-freeze 的 exit 3 是解析崩溃，不是裁决');
  assert.ok(T.DESC.p1b_audit_anchor_gate.indexOf('不是崩溃') >= 0, '锚点工具的描述必须写明 exit 3 是裁决不是崩溃');
  assert.ok(T.DESC.p1b_audit_prereg_freeze.indexOf('真崩溃不是裁决') >= 0, '冻结哈希工具的描述必须写明它的 exit 3 语义相反');
});
