'use strict';
/**
 * p1b/mcp/index.cjs —— stdio MCP server 入口（零第三方依赖，手写 JSON-RPC 2.0）
 *
 * 用法（MCP 客户端配置里的一行）：
 *   { "command": "node", "args": ["E:/music player/p1b/mcp/index.cjs"] }
 *
 * ── 本进程对 p1a.db 的权限：零 ──────────────────────────────────────────────
 * 本件与其同目录的模块**不 require `p1b/src/db`、不 require 任何 `p1b/src/**`、
 * 不 require 任何 `p1b/scripts/*.cjs`**。它对账本的唯一接触方式是
 * `p1b/cli/cliBridge.cjs` 里那一次 `spawn` —— 由 `node p1b/cli/index.cjs` 去开句柄。
 * 所以：**MCP 进程自己永远不持有 p1a.db 的写句柄，连只读句柄都不持有。**
 * 关掉这个 server 之后，`node p1b/cli …` 走的是同一条代码路径、同一份输出，逐位不变。
 *
 * ── 为什么是手写而不是引 SDK ──────────────────────────────────────────────
 * ① exit 3 的映射 SDK 不提供（它只认「成功/失败」两分），那几十行照样要自己写，
 *    用 SDK 等于多一条无审计的供应链、少一个黑盒、代码量不见少。
 * ② 本项目是 1 人维护的工具链，每一轮 MCP breaking change 都要人读规范动手改；
 *    「能删掉的三百行适配器」比「一个要跟着升级的依赖」更符合这个项目的形态。
 * ③ 零新依赖是硬铁律：`p1b/mcp/` 全部模块只用 node 内建 ＋ `p1b/cli/commands.cjs`。
 */

const path = require('path');
const { readLines, parseLine, makeWriter, JSONRPC_ERRORS: E } = require('./framing.cjs');
const { handleMessage } = require('./protocol.cjs');

/** 引导信息走 stderr —— **stdout 是协议通道**，一个字节都不能被日志污染。 */
function bootstrap() {
  const n = require('./tools.cjs').listTools().length;
  process.stderr.write('[p1b/mcp] stdio server 就绪，' + n + ' 个工具（协议 2026-07-28，零新依赖）\n');
}

/**
 * 跑 server 主循环。抽成函数是为了让测试能喂一个假 stdin。
 *
 * @param {import('stream').Readable} input
 * @param {import('stream').Writable} output
 * @param {object} [opt] {env}
 */
function serve(input, output, opt) {
  const write = makeWriter(output);
  readLines(input, (line) => {
    const p = parseLine(line);
    if (!p.ok) {
      // 坏行也要回一条 -32700：静默丢弃会让客户端永远等在那条 id 上。
      write({ jsonrpc: '2.0', id: null, error: { code: E.PARSE_ERROR, message: 'JSON 解析失败：' + p.error } });
      return;
    }
    const res = handleMessage(p.value, opt);
    if (res) write(res);
  });
  return write;
}

if (require.main === module) {
  // require('readline') 之前先确认 toolTable 断言过了：工具表对不上就**拒绝启动**，
  // 而不是启动一个少暴露/多暴露了工具的 server。
  require('./toolTable.cjs');
  bootstrap();
  serve(process.stdin, process.stdout);
}

module.exports = { serve, bootstrap, handleMessage };
