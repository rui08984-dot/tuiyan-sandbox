'use strict';
/**
 * 局鉴 · src/mcp/protocol.cjs —— JSON-RPC 2.0 分派
 *
 * ── 实现哪几个方法，以及为什么就这几个 ──────────────────────────────────────
 * MCP 官方 2026-07-28 修订版里，`initialize` / `notifications/initialized` /
 * `ping` / `Mcp-Session-Id` 各出现 0 次；本层实现的是：
 *
 *   · `server/discover` —— 新客户端的第一手，服务端自报协议版本与能力
 *   · `tools/list`      —— 工具清单
 *   · `tools/call`      —— 调工具
 *   · 通知（无 id）     —— 一律不回（回一条给通知，客户端会当成对不上号的应答丢掉）
 *
 * ★**兼容旧版握手**（`initialize` / `initialized` / `ping`）：
 *   大量现存 MCP 客户端仍然只发 `initialize`。只支持新规范的话，
 *   它们直连会拿到 -32601，也就是「明明装上了却连不上」——
 *   这是最难排查的一类装不上。故三个旧方法**按兼容层实现**，
 *   新规范主路径 `server/discover` 一字未动、仍是首选。
 *
 * ── 错误码 ────────────────────────────────────────────────────────────────
 *  · -32700 PARSE_ERROR     一行不是合法 JSON
 *  · -32600 INVALID_REQUEST 合法 JSON 但不是 JSON-RPC 2.0 形状
 *  · -32601 METHOD_NOT_FOUND 未知方法
 *  · -32602 INVALID_PARAMS  ★只有一种情况：叫了一个不存在的工具
 *  · -32603 INTERNAL_ERROR  其余
 *
 *   工具自己跑失败**一律不是协议错误**，它走 result 里的 isError ——
 *   因为模型必须看得见错误才能自我纠正，把它们藏进协议错误里等于让它瞎试。
 */

const { JSONRPC_ERRORS: E } = require('./framing.cjs');
const tools = require('./tools.cjs');

/** 能力自报。`listChanged:false` —— 工具表是编译期常量，永不变。 */
function capabilities() { return { tools: { listChanged: false } }; }

const INSTRUCTIONS = [
  '本 server 把局鉴的 8 个复盘工具暴露给你：5 条读工具 ＋ 3 条「只起草不写入」的工具。',
  '',
  '四条读法，写进你的输出之前先记住：',
  '① **本 server 不能替你往对局账本里写任何东西。** jujian_record_claim / jujian_record_speech /',
  '   jujian_review_day 三条永远只返回草案，返回体里 gate 恒为 NOT_CONFIRMED。',
  '   ★这不是失败，也绝不是重试信号 —— 任何情况下都不要重试这三条。',
  '   要真写入：由人自己跑草案里 how_to_record 给出的那条命令。',
  '② **局鉴是复盘器，不是破案器。** 它给你矛盾清单、欠定度与无辜解释，',
  '   **不给你嫌疑排序、不告诉你谁是狼**。不要替它补一个排名出来 —— 那是被实测证伪过的。',
  '③ 转述矛盾时，**四件都要说**：矛盾描述、欠定度、无辜解释、回指哪几条声称。',
  '   只说「矛盾」不说「也可能不是矛盾」，就等于抹掉了这个工具存在的理由。',
  '④ 「空清单」的意思是「还没结算过或没录够发言」，**不是**「这局没人撒谎」。',
  '',
  '本 server 不联网、不写账本、不碰任何令牌或密钥；返回的每一句都可以回查到原始发言。',
].join('\n');

/** serverId 单一真源：docs/mcp/server.json（读它而不是另写一份）。 */
function serverName() {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'mcp', 'server.json'), 'utf8'));
    return (j && typeof j.name === 'string' && j.name) || 'jujian';
  } catch (e) {
    return 'jujian';
  }
}

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
 * @returns {object|null} null = 通知或非法请求，不该回任何东西
 */
function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return err(null, E.INVALID_REQUEST, '不是 JSON-RPC 2.0 请求形状');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const id = msg.id;

  if (msg.jsonrpc !== '2.0') return isNotification ? null : err(id, E.INVALID_REQUEST, 'jsonrpc 字段必须是 "2.0"');
  if (typeof msg.method !== 'string' || !msg.method) return isNotification ? null : err(id, E.INVALID_REQUEST, '缺 method');

  try {
    switch (msg.method) {
      // ── 兼容层：旧规范三方法 ────────────────────────────────────────────
      case 'initialize': {
        const r = discoverResult();
        return isNotification ? null : ok(id, {
          protocolVersion: (msg.params && msg.params.protocolVersion) || tools.PROTOCOL_VERSION,
          capabilities: r.capabilities,
          serverInfo: { name: serverName(), version: tools.PROTOCOL_VERSION },
          // 老客户端会忽略未知字段，但它据此能发现本层也支持新规范
          supportedVersions: r.supportedVersions,
          resultType: r.resultType,
          instructions: INSTRUCTIONS,
        });
      }
      case 'notifications/initialized':
      case 'initialized':
        return null;
      case 'ping':
        return isNotification ? null : ok(id, {});
      // ── 新规范主路径 ────────────────────────────────────────────────────
      case 'server/discover':
        return isNotification ? null : ok(id, discoverResult());
      case 'tools/list':
        return isNotification ? null : ok(id, { resultType: 'complete', tools: tools.listTools() });
      case 'tools/call': {
        if (isNotification) return null;
        const p = msg.params || {};
        try {
          return ok(id, tools.callTool(p.name, p.arguments || {}));
        } catch (e) {
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

module.exports = { handleMessage, discoverResult, capabilities, INSTRUCTIONS, err, ok, serverName };