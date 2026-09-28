'use strict';
/**
 * p1b/test/mcp-golden.test.cjs —— MCP 工具表金样（2026-09-29）
 *
 * 钉死四件「对外暴露面」的性质。每一条都对应一种具体的翻车方式：
 *
 *   ① **恰好 18 条，档位分布 R10 / F7 / W1** —— 防「悄悄加了一个写工具」。
 *      工具表是对外契约，而这份项目里 0 个工具写 p1a.db（W 那条被确认闸物理拦死）。
 *      多出一条写工具 = 对外多开一个面，且没人会注意到 tools/list 变长了。
 *      少一条 = 能力静默消失，模型从此不知道它能问什么。
 *   ② **工具名集合的 sha256 固定** —— 改名比多条更难发现：模型仍然看得见 18 条，
 *      但所有 prompt/脚本/文档里引用的旧名全部失效。条数不变而名字全换，肉眼扫不出来。
 *   ③ **工具名全 ASCII 小写蛇形** —— `commands.cjs` 的 `zh` 是中文，不能直接当 tool name；
 *      这条断言防的是有人图省事把 `p1b_doctor_看板` 之类混进来。
 *   ④ **本层自撰文案里不出现「预测」二字** —— 合规红线（设计书 :560）：
 *      MCP 的 description 与返回文本一旦出现指向未来的措辞，外部调用者就会读成「建议」。
 *      ★**只扫本层自撰的文案**：CLI 子进程的 stdout 逐位透传，里面该有的字一个都不能改
 *      （改了就是在 CLI 与 MCP 之间造第二套口径）。所以本断言扫的是「源码 ＋ tools/list
 *      载荷」两层，而不是工具返回值。
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
const tools = require(path.join(MCP, 'tools.cjs'));
const C = require(path.join(ROOT, 'p1b', 'cli', 'commands.cjs'));

/** 工具名集合的指纹。**排序后**再哈希 —— 顺序不是契约，集合才是。 */
function namesSha256(list) {
  return crypto.createHash('sha256').update(list.slice().sort().join('\n')).digest('hex');
}

test('① tools/list 恰好 18 条，档位分布 R10 / F7 / W1', () => {
  const list = tools.listTools();
  assert.strictEqual(list.length, 18, '工具条数变了：' + list.length);

  // 档位分布直接从 commands.cjs 数，不从 tools.cjs 数 —— 前者是分类的源头。
  const byTier = {};
  for (const c of C.allCommands()) byTier[c.tier] = (byTier[c.tier] || 0) + 1;
  assert.deepStrictEqual(byTier, { R: 10, F: 7, W: 1 }, 'commands.cjs 的档位分布变了');

  // 再从 MCP 侧的 annotations 反数一遍，两个数必须对上：这是「档位→hint 是 1:1 抄写」的机械证明。
  const ro = list.filter((t) => t.annotations.readOnlyHint === true).length;
  const de = list.filter((t) => t.annotations.destructiveHint === true).length;
  const ow = list.filter((t) => t.annotations.openWorldHint === true).length;
  const ww = list.filter((t) => t.annotations.destructiveHint === true && t.annotations.readOnlyHint === false).length;
  assert.strictEqual(ro, byTier.R, 'readOnlyHint=true 的条数应等于 R 档条数');
  assert.strictEqual(de, byTier.W, 'destructiveHint=true 的条数应等于 W 档条数（W 档默认就是 true，必须显式写）');
  assert.strictEqual(ww, byTier.W, 'readOnly=false 且 destructive=true 的应只有 W 档');
  assert.strictEqual(ow, C.allCommands().filter((c) => c.net).length, 'openWorldHint=true 的条数应等于 net:true 的条数');
});

test('② 工具名集合的 sha256 固定（改名比多条更难发现）', () => {
  // 2026-09-29 首次落地时实测写死。改工具名 = 改对外契约，必须连同所有引用一起改，
  // 然后才允许动这一个常量。
  const EXPECTED = 'eebf22a15f6a243cda871a63e32a1d3c162834024dbf1087ba89862bbdb9d338';
  const actual = namesSha256(tools.listTools().map((t) => t.name));
  assert.strictEqual(actual, EXPECTED, '工具名集合变了 —— 若是刻意改名，请连同所有引用一起改并在此处更新指纹');
});

test('③ 工具名全 ASCII 小写蛇形，且与 commands.cjs 一一对应', () => {
  const NAME_RE = /^[a-z][a-z0-9_]*$/;
  for (const t of tools.listTools()) {
    assert.match(t.name, NAME_RE, '工具名不是全 ASCII 小写蛇形：' + t.name);
    assert.ok(t.name.startsWith('p1b_'), '工具名必须以 p1b_ 前缀开头：' + t.name);
  }
  // 双向：不多不少一一对上
  const fromCli = C.allCommands().map((c) => 'p1b_' + c.group.key + '_' + T.asciiMap()[c.group.key + '/' + c.zh]).sort();
  assert.deepStrictEqual(tools.listTools().map((t) => t.name).sort(), fromCli, 'MCP 工具名与 commands.cjs 不是一一对应');
});

test('④ 发出去的文案不出现「预测」二字（合规红线）', () => {
  // ★**扫描面只取「真正发出去的东西」**：tools/list 载荷 ＋ server/discover 的 instructions。
  //   刻意不扫本层源码全文 —— 那会把「禁止使用某词」这条规则自己的说明也判成违规，
  //   而红线（设计书 :560）管的是 **description 与返回文本**，不是代码注释。
  //   源码里的字只要没进载荷，就不构成对外文案。
  //   ★子进程的 stdout **逐位透传**，里面该有的字一个都不能改（改了就是在 CLI 与 MCP
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

test('⑤ 联机工具可被部署策略整体关掉（P1B_MCP_ALLOW_NET=0 ⇒ 17 条）', () => {
  const withNet = tools.listTools({ env: { P1B_MCP_ALLOW_NET: '1' } });
  const offNet = tools.listTools({ env: { P1B_MCP_ALLOW_NET: '0' } });
  assert.strictEqual(withNet.length, 18);
  assert.strictEqual(offNet.length, 17, '关掉联机后应少一条');
  const gone = withNet.map((t) => t.name).filter((n) => offNet.map((x) => x.name).indexOf(n) < 0);
  assert.deepStrictEqual(gone, ['p1b_settle_corpus'], '关掉的应当且仅应当是唯一那条 net:true 的工具');
  // 被关掉的工具调不动：不能只是「不列出来」而是「列出来也调不通」
  assert.throws(() => tools.callTool('p1b_settle_corpus', {}, { env: { P1B_MCP_ALLOW_NET: '0' } }), /已按部署策略下线/);
});

test('⑥ 确认闸类工具的描述必须写明「不会真的执行」与「不要重试」', () => {
  for (const n of ['p1b_settle_corpus', 'p1b_backup_offsite']) {
    const d = T.DESC[n];
    assert.ok(d.indexOf('不要重试') >= 0, n + ' 的描述缺「不要重试」');
    assert.ok(d.indexOf('--确认') >= 0, n + ' 的描述没交代确认闸怎么过');
  }
  // exit 3 的逐命令语义必须在表里，否则模型只能笼统读成「门禁不通过」
  assert.strictEqual(T.exit3Of('p1b_audit_anchor_gate').kind, 'VERDICT');
  assert.strictEqual(T.exit3Of('p1b_audit_prereg_freeze').kind, 'CRASH', 'prereg-freeze 的 exit 3 是解析崩溃，不是裁决');
  assert.ok(T.DESC.p1b_audit_anchor_gate.indexOf('不是崩溃') >= 0, '锚点工具的描述必须写明 exit 3 是裁决不是崩溃');
  assert.ok(T.DESC.p1b_audit_prereg_freeze.indexOf('真崩溃不是裁决') >= 0, '冻结哈希工具的描述必须写明它的 exit 3 语义相反');
});
