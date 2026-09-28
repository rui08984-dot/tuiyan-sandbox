'use strict';
/**
 * p1b/mcp/cliBridge.cjs —— MCP → CLI 的唯一通道。**本层对 p1a.db 的全部权限就是 spawn 一个进程。**
 *
 * ── 三条不可让步的边界 ────────────────────────────────────────────────────
 * ① **只 spawn，绝不 require**。本件不 require `p1b/src/db`、不 require 任何
 *    `p1b/scripts/*.cjs`、不 require `p1b/src/**` 的任何东西。
 *    它 require 的全部模块是：`p1b/cli/index.cjs`（路由与 spawn）与 `p1b/cli/commands.cjs`
 *    （纯数据表）。⇒ **本层进程自身永远不持有 p1a.db 的写句柄**，
 *    连只读句柄都不持有。要读账本的数据，一律由 CLI 起的子进程去读。
 * ② **永不带 --确认**。见下方 `buildArgv`。
 * ③ **走同一条命令、同一个入口**。拼出来的 argv 与人类在终端敲的逐 token 相同，
 *    所以「模型看到的」和「人看到的」是同一份代码的同一份输出，不存在第二套口径。
 *
 * ── 为什么 stdio 是 `pipe` 而不是 `inherit` ────────────────────────────────
 *  `p1b/cli/index.cjs` 的 `main()` 写死 `['ignore','inherit','inherit']`：子进程直接写
 *  本进程 stdout，父进程拿不到一个字节。MCP 要把输出交回给模型，就必须收回来。
 *  所以这里调的是从 `main()` 里抽出来的 `runChild()`，显式传 `pipe`；
 *  `main()` 自己仍然传 `inherit`。差异只在调用点，`node p1b/cli` 的行为逐位不变。
 */

const path = require('path');
const CLI = require(path.join(__dirname, '..', 'cli', 'index.cjs'));
const T = require('./toolTable.cjs');

/** 超时上限。18 条里最慢的（分层跑批）实测在分钟级，180s 给足余量又不至于把 server 挂死。 */
const DEFAULT_TIMEOUT_MS = 180000;

/** 确认闸的两个 token（`p1b/cli/index.cjs:184`）。**本层构造的 argv 里永不出现它们。 */
const CONFIRM_TOKENS = ['--确认', '--confirm'];

/**
 * 把工具调用拼成 CLI 的 argv。
 *
 * ★**为什么这里必须、且只能靠「不拼」来保证永不带 --确认**：
 *   确认闸在 `p1b/cli/index.cjs` 的 `main()` 里、**spawn 之前** return，
 *   子进程一次都不起。所以「永不带 --确认」不需要任何新代码 —— 只要本函数
 *   **不把调用方给的任何参数原样转发**就成立。这是本层最省事也最不容易被绕过的一条：
 *   模型就算在 arguments 里塞 `--确认`，它进不了 argv（本函数只认 `pos` 里登记过的
 *   4 个键，见 `POS`），于是闸照常拦下。
 *
 * @param {object} cmd   commands.cjs 的命令对象
 * @param {object} args  MCP 侧 arguments
 * @returns {string[]} argv（不含 node 与入口路径）
 */
function buildArgv(cmd, args) {
  const k = cmd.group.key + '/' + cmd.zh;
  const reg = T.POS[k] || {};
  const argv = [cmd.group.zh, cmd.zh];   // 与人类敲的 `node p1b/cli <组> <命令>` 逐 token 相同
  // 顺序按 commands.cjs 的 `pos` 数组，不是按 arguments 的键序 —— 位置参数本来就是有序的。
  for (const p of cmd.pos || []) {
    if (!reg.key) throw new Error('[p1b/mcp] 命令有 pos 但没登记 ASCII 键：' + k);
    const v = args ? args[reg.key] : undefined;
    if (v !== undefined && v !== null) argv.push(String(v));
  }
  return argv;
}

/**
 * 调一次 CLI，捕获 stdout / stderr / 退出码。
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} [opt] {timeoutMs, env}
 * @returns {{toolName:string, argv:string[], exit:number|null, stdout:string, stderr:string, signal:?string}}
 */
function callCli(toolName, args, opt) {
  const cmd = T.lookup(toolName);
  if (!cmd) throw new Error('[p1b/mcp] 未知工具：' + toolName);
  const argv = buildArgv(cmd, args);
  const scriptPath = path.join(__dirname, '..', 'cli', 'index.cjs');

  // 最后一道机械保险：拼完再扫一遍确认 token。拼装逻辑变了、或者将来有人给某条命令
  // 加了自动注入，这条断言会在第一次调用时就炸，而不是等到某天写库了才发现。
  for (const tok of CONFIRM_TOKENS) {
    if (argv.indexOf(tok) >= 0) throw new Error('[p1b/mcp] 拒绝执行：argv 里出现了确认 token ' + tok);
  }

  const res = CLI.runChild(scriptPath, argv, ['ignore', 'pipe', 'pipe']);
  if (res.error) {
    return { toolName, argv, exit: CLI.EXIT.ERR, stdout: '', stderr: '✗ spawn 失败：' + res.error.message, signal: null };
  }
  if (res.signal) {
    return { toolName, argv, exit: null, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), signal: res.signal };
  }
  return {
    toolName,
    argv,
    exit: res.status,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    signal: null,
  };
}

module.exports = { callCli, buildArgv, CONFIRM_TOKENS, DEFAULT_TIMEOUT_MS };
