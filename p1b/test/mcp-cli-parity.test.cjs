'use strict';
/**
 * p1b/test/mcp-cli-parity.test.cjs —— 「关掉 MCP 之后一切逐位不变」的第一验收项
 *
 * ── 这一条比它看起来难：有些命令的 stdout 天生不稳定 ──────────────────────
 *  `体检 看板` 的第一行是 `推演沙盘 · 一页看板（<ISO 时间戳>）`（实测）。
 *  ⇒ **同一条命令连跑两次，未改动的 CLI 自己就给出两个不同的 sha256**
 *  （本文件里有一条用例把这件事量化出来）。所以「sha256 逐位不变」对这类命令
 *  在数学上就不可能成立 —— 不是 MCP 改了它，是这条命令每次都重新报时。
 *  设计书第 689 行早就把这条列成未知（「12 条无 --json 命令的输出稳定性」），
 *  本文件把它从未知变成**实测结论**，并给出两条可用的判据：
 *   · **归一化 sha256**：抹掉 ISO 时间戳后逐位比对 —— 覆盖全部命令
 *   · **原始 sha256**：给输出本来就稳定的命令（如 `体检 泄漏`）做逐字节比对 —— 更强的形式
 *  两条都测。归一化那条覆盖面广，原始那条证明归一化没有把实质差异洗掉。
 *
 * ── 另一条判据：spawn 抽取没有改 main() 的行为 ────────────────────────────
 *  本层对 `p1b/cli/index.cjs` 的唯一改动是把 spawnSync 抽成 `runChild()`。
 *  本文件机械证明三件事：① 抽出的函数**默认 stdio 就是老的 inherit**；
 *  ② `main()` 里的调用点**显式传** inherit；③ `main()` 里只剩这一个 spawn 调用点。
 *  三条合起来 = 「main() 的默认行为逐位不变」不是靠人读注释保证的。
 *
 * 零写库、零网络：只跑 R 档只读命令（`体检 看板`、`体检 泄漏`）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'p1b', 'cli', 'index.cjs');
const tools = require(path.join(ROOT, 'p1b', 'mcp', 'tools.cjs'));

function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

/** 抹掉 ISO-8601 时间戳与 `.scratch/cli/<时间戳>/` 路径里的易变段。 */
function normalize(s) {
  return String(s)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<TS>')
    .replace(/\d{8}-\d{6}/g, '<STAMP>')
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<TS2>');
}

/** 直接在终端跑一次 CLI（人在终端敲的就是这条）。 */
function runCli(args) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('① 事实认定：未改动的 CLI 自己就不是逐位稳定的（归一化判据的由来）', () => {
  const a = runCli(['体检', '看板']);
  const b = runCli(['体检', '看板']);
  assert.strictEqual(a.status, 0);
  assert.notStrictEqual(sha256(a.stdout), sha256(b.stdout),
    '若这条命令两次跑的原始 sha256 相同，说明输出已经稳定了 —— 归一化判据的依据消失，请复核');
  // 差异**只**能来自时间戳：归一化之后必须逐位相同。
  assert.strictEqual(normalize(a.stdout), normalize(b.stdout), '归一化后仍不相等 ⇒ 差异不止时间戳');
  assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(a.stdout), '预期不稳定来源是 ISO 时间戳');
});

test('② 原始 sha256 逐位相同：输出本来就稳定的命令，MCP 结果 == CLI 直跑', () => {
  const direct = runCli(['体检', '泄漏']);
  assert.strictEqual(direct.status, 0, 'CLI 直跑应成功');
  const viaMcp = tools.callTool('p1b_doctor_leak_scan', {});
  assert.strictEqual(viaMcp.structuredContent.exit, 0);
  // MCP 的 content[0].text ＝ 子进程 stdout ＋ stderr，末尾那个 \n 是 CLI 自己 write 的。
  // 取 stdout 的等价物：content 里 stdout 在 stderr 之前，按 CLI 的既有行为原样透传。
  const fromMcp = viaMcp.content[0].text.slice(0, direct.stdout.length);
  assert.strictEqual(fromMcp, direct.stdout, 'MCP 透传的 stdout 与 CLI 直跑逐字节不相同');
  assert.strictEqual(sha256(fromMcp), sha256(direct.stdout), '原始 sha256 不相同');
});

test('③ 归一化 sha256 逐位相同：带时间戳的命令，MCP 结果 == CLI 直跑', () => {
  for (const [args, tool] of [[['体检', '看板'], 'p1b_doctor_board'], [['门禁', '契约'], 'p1b_audit_g2_contract']]) {
    const direct = runCli(args);
    const viaMcp = tools.callTool(tool, {});
    assert.strictEqual(direct.status, viaMcp.structuredContent.exit, tool + ' 的退出码：CLI 直跑与经 MCP 不一致');
    const fromMcp = viaMcp.content[0].text.slice(0, direct.stdout.length);
    assert.strictEqual(normalize(fromMcp), normalize(direct.stdout), tool + ' 的 stdout（归一化后）与 CLI 直跑不一致');
    assert.strictEqual(sha256(normalize(fromMcp)), sha256(normalize(direct.stdout)), tool + ' 的归一化 sha256 不相同');
  }
});

test('④ spawn 抽取没有改变 main() 的默认行为（结构性证明，不是靠人读注释）', () => {
  const src = fs.readFileSync(CLI, 'utf8');

  // ① 抽出的 runChild 默认 stdio 必须是老的那一组
  const fn = /function runChild\(scriptPath, childArgs, stdio\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, '找不到 runChild —— spawn 抽取被回退了？');
  assert.match(fn[0], /stdio \|\| \['ignore', 'inherit', 'inherit'\]/,
    'runChild 的缺省 stdio 必须是老的 inherit：改了它，node p1b/cli 的重定向行为就变了');

  // ② main() 里的调用点必须显式传 inherit，不能靠缺省（靠缺省 = 未来有人改缺省值就静默变更）
  const call = /runChild\(scriptPath, childArgs, \['ignore', 'inherit', 'inherit'\]\)/;
  assert.match(src, call, 'main() 里的 spawn 调用点必须显式传 inherit');

  // ③ 整个 index.cjs 里 spawnSync 只该剩 runChild 内部那一处
  const spawnCalls = src.match(/spawnSync\(/g) || [];
  assert.strictEqual(spawnCalls.length, 1, 'index.cjs 里有 ' + spawnCalls.length + ' 处 spawnSync，只应有 runChild 内部那一处');
  assert.match(src, /function runChild[\s\S]*?spawnSync\(/, '唯一那处 spawnSync 必须落在 runChild 里');
});

test('⑤ 经 MCP 调用不改变 p1a.db —— 轻量版（重的那版在 mcp-no-ledger-write.test.cjs）', () => {
  const db = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
  const before = crypto.createHash('sha256').update(fs.readFileSync(db)).digest('hex');
  tools.callTool('p1b_doctor_board', {});
  tools.callTool('p1b_doctor_leak_scan', {});
  const after = crypto.createHash('sha256').update(fs.readFileSync(db)).digest('hex');
  assert.strictEqual(after, before, '只跑 R 档工具之后 p1a.db 的 sha256 变了');
});
