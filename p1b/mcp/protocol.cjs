'use strict';
/**
 * p1b/mcp/protocol.cjs —— JSON-RPC 2.0 分派。
 *
 * ── 实现哪几个方法，以及为什么就这几个 ──────────────────────────────────────
 * 官方 2026-07-28 修订版（已实测 `schema/2026-07-28/schema.ts`：`initialize`、
 * `notifications/initialized`、`ping`、`Mcp-Session-Id` 各出现 **0 次**）在本层要实现的是：
 *
 *   · `server/discover`   —— schema.ts:666。**新客户端的第一手**，服务端自报协议版本与能力。
 *                            官方注释说客户端「MAY 调可不调，版本协商也可以走每请求的 `_meta`」，
 *                            所以本层**只做应答、不做任何状态机**：MCP 没有协议级 session
 *                            （`Session-Id` 在 schema 里 0 次），无状态是被规范认可的状态。
 *   · `tools/list`        —— schema.ts:1768。
 *   · `tools/call`        —— schema.ts:1883。
 *   · 通知（无 `id`）     —— 一律不回。回一条给通知，客户端会当成对不上号的应答丢掉。
 *
 * ── 「没有握手」这件事为什么敢做 ────────────────────────────────────────────
 * 因为**这层是薄适配器**：它不持有任何需要协商的东西 —— 没有 session、没有订阅、
 * 没有采样、没有 elicitation。客户端发来的第一条消息就是 `tools/list` 或 `tools/call`。
 * 老客户端先发 `initialize` 时会拿到 -32601，这是**正确的**行为：它按旧规范走，
 * 而本 server 明确是 2026-07-28 形态，让它早点失败比让它半懂不懂地跑强。
 *
 * ── 错误码用哪几个 ────────────────────────────────────────────────────────
 *  · -32700 PARSE_ERROR     —— 一行不是合法 JSON
 *  · -32600 INVALID_REQUEST —— 合法 JSON 但不是 JSON-RPC 2.0 请求形状
 *  · -32601 METHOD_NOT_FOUND—— 未知方法（含旧客户端的 initialize）
 *  · -32602 INVALID_PARAMS  —— ★**只有一种情况**：叫了一个不存在的工具。
 *                              工具自己跑失败一律不是协议错误，它走 result 里的 isError，
 *                              理由写在 exitMap.cjs 头注（模型要看得见错误才能自我纠正）。
 */

const { JSONRPC_ERRORS: E } = require('./framing.cjs');
const tools = require('./tools.cjs');

/** 能力自报。`tools.listChanged:false` —— 本层的工具表是编译期常量，永不变。 */
function capabilities() { return { tools: { listChanged: false } }; }

const INSTRUCTIONS = [
  '本 server 把本项目「万物可判定性账本」的 21 个工具原样暴露给你：18 条 CLI 命令的投影 ＋ 3 条对外工具',
  '（p1b_note_record 记一笔 / p1b_where_i_bias 我在哪类事上偏 / p1b_which_layer 这事该归哪一类）。',
  '',
  '四条读法，写进你的输出之前先记住：',
  '① exit 3 是**裁决不是崩溃**。门禁码走成功通道，返回里 isError 故意是 false，',
  '   真正的结论在 structuredContent.verdict（gate / meaning / where）。',
  '   逐条命令的 exit 3 含义不同，照 meaning 读，不要笼统读成「门禁不通过」。',
  '② 写生产账本的 p1b_settle_corpus、写备份的 p1b_backup_offsite，以及**记一笔的 p1b_note_record**',
  '   **永远不会真的执行** —— 确认闸在动作之前就拦下了（verdict.gate=\'NOT_CONFIRMED\'）。',
  '   前两条带 will_execute（一条可粘贴的命令行）；p1b_note_record 不带，',
  '   因为落账通路只有 HTTP 端点与网页、CLI 侧没有对应命令，它给的是 write_plan ＋ how_to_record。',
  '   把它们交给人类，别重试。',
  '③ 「没测到」不等于「通过」：unverifiable / n/a / not_reachable 都要原样报出数量，',
  '   不能折进通过率里。p1b_where_i_bias 的空榜也是同一类：**空榜是「还没测够」，不是「你没偏」**。',
  '④ 每条工具的 description 里都有「不能做什么」与「越界时返回什么」两段 —— 转述前先读它们。',
  '   本 server 不预判未来、不给建议、不碰任何令牌或密钥。',
  '',
  '本 server 只 spawn 子进程（或一个也不起），不自己连 p1a.db；返回体一律是账本中已结算的历史统计事实，',
  '不构成任何对未来结果的判断。',
].join('\n');

/** `server/discover` 的结果体。 */
function discoverResult() {
  return {
    resultType: 'complete',
    supportedVersions: [tools.PROTOCOL_VERSION],
    capabilities: capabilities(),
    instructions: INSTRUCTIONS,
  };
}

function err(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}
function ok(id, result) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, result };
}

/**
 * 处理一条已解析的 JSON-RPC 消息。
 *
 * @param {object} msg
 * @param {object} [opt] {env} 透给 tools 层（联机闸读它）
 * @returns {object|null} null = 这是通知或非法请求，不该回任何东西
 */
function handleMessage(msg, opt) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return err(null, E.INVALID_REQUEST, '不是 JSON-RPC 2.0 请求形状');
  const isNotification = msg.id === undefined || msg.id === null;
  const id = msg.id;

  if (msg.jsonrpc !== '2.0') return isNotification ? null : err(id, E.INVALID_REQUEST, 'jsonrpc 字段必须是 "2.0"');
  if (typeof msg.method !== 'string' || !msg.method) return isNotification ? null : err(id, E.INVALID_REQUEST, '缺 method');

  try {
    switch (msg.method) {
      case 'server/discover':
        return isNotification ? null : ok(id, discoverResult());
      case 'tools/list':
        return isNotification ? null : ok(id, { resultType: 'complete', tools: tools.listTools(opt) });
      case 'tools/call': {
        if (isNotification) return null;   // 调工具一定是请求
        const p = msg.params || {};
        try {
          return ok(id, tools.callTool(p.name, p.arguments, opt));
        } catch (e) {
          // 只有「工具名不存在 / 被部署策略下线」走到这里 —— 那是本层没满足调用，
          // 属于协议层的事（官方原文：finding the tool 的错误走 error 响应）。
          if (e && e.protocolError) return err(id, E.INVALID_PARAMS, e.message);
          return err(id, E.INTERNAL_ERROR, (e && e.message) || String(e));
        }
      }
      default:
        return isNotification ? null : err(id, E.METHOD_NOT_FOUND, '本 server 未实现方法：' + msg.method);
    }
  } catch (e) {
    return err(id, E.INTERNAL_ERROR, (e && e.stack) || String(e));
  }
}

module.exports = { handleMessage, discoverResult, capabilities, INSTRUCTIONS, err, ok };
