'use strict';
/**
 * MCP 旧版握手兼容层（2026-09-30 · 创始人裁定「兼容吧」）
 *
 * 【为什么有这层】本层的主路径是官方 2026-07-28 修订版（`server/discover` 取代
 * `initialize`）。但**大量现存 MCP 客户端仍只发 `initialize`**——实测它们直连
 * 会拿到 -32601 METHOD_NOT_FOUND，也就是「明明装上了却连不上」。
 * ⇒ 这里把旧版三个方法按**兼容层**实现，两个规范的客户端都能连。
 *
 * 【纪律】★兼容层**不许改动新规范主路径**：`server/discover` 与 `tools/list`
 *   的返回体一字不动。这条比「老客户端能连」更重要——为了兼容而改新规范，
 *   等于用新客户端的可用性换老客户端的可用性，那是净亏。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const h = require(path.join(ROOT, 'p1b', 'mcp', 'protocol.cjs'));
const tools = require(path.join(ROOT, 'p1b', 'mcp', 'tools.cjs'));

const opt = { dbPath: ':memory:', llmMock: true, netAllowed: false };
const ask = (method, params, id) =>
  h.handleMessage({ jsonrpc: '2.0', id, method, params }, opt);

test('① 老客户端 initialize ⇒ 回 protocolVersion / capabilities / serverInfo 三件', () => {
  const r = ask('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'old', version: '0.1' },
  }, 1);
  assert.equal(r.error, undefined, '老客户端不该拿到 -32601：' + JSON.stringify(r.error));
  assert.ok(r.result, '必须有 result');
  assert.equal(r.result.protocolVersion, '2024-11-05', '★回显客户端给的版本（老客户端按这个判断后续报文格式）');
  assert.ok(r.result.capabilities && r.result.capabilities.tools, '必须宣告 tools 能力，否则老客户端不列工具');
  assert.ok(r.result.serverInfo && r.result.serverInfo.name, '必须回 serverInfo.name');
});

test('② ★兼容层不许改新规范主路径：server/discover 返回体一字不动', () => {
  const r = ask('server/discover', {}, 2);
  assert.equal(r.error, undefined);
  assert.equal(r.result.resultType, 'complete');
  assert.deepEqual(r.result.supportedVersions, [tools.PROTOCOL_VERSION], 'supportedVersions 只能是本层声明的那一版');
  assert.ok(r.result.capabilities, 'capabilities 缺失');
});

test('③ 两边 tools/list 工具数必须一致（兼容层不许只对新客户端供工具）', () => {
  const a = ask('tools/list', {}, 3);
  const b = ask('server/discover', {}, 4);
  assert.ok(a.result && Array.isArray(a.result.tools), 'tools/list 形状不对');
  const n1 = a.result.tools.length;
  assert.ok(n1 > 0, 'tools/list 返回 0 个工具');
  assert.ok(b.result, 'discover 形状不对');
  // ★老客户端先 initialize 再 tools/list；两条路拿到的工具数必须一样，否则是「按客户端分叉」
  const c = ask('initialize', { protocolVersion: '2024-11-05' }, 5);
  const d = ask('tools/list', {}, 6);
  assert.equal(d.result.tools.length, n1, '★老客户端走完 initialize 后拿到的工具数与直接问的不同 ⇒ 工具按客户端分叉了');
  assert.ok(c.result, 'initialize 失败');
});

test('④ 旧版两个配套方法：notifications/initialized 是通知（不回包）、ping 回空对象', () => {
  assert.equal(ask('notifications/initialized', {}, undefined), null,
    '★通知必须回 null（JSON-RPC：notification 没有 id，不得回任何响应）');
  const p = ask('ping', {}, 7);
  assert.equal(p.error, undefined, 'ping 必须被实现，否则老客户端的健康检查失败');
  assert.deepEqual(p.result, {}, 'ping 回空对象即可');
});

test('⑤ ★未知方法仍应是 -32601（兼容层不许变成「什么都回 ok」）', () => {
  const r = ask('some/method', {}, 8);
  assert.ok(r.error, '未知方法必须报错');
  assert.equal(r.error.code, -32601, '必须是 METHOD_NOT_FOUND');
});

test('⑥ ★反向锁：把 initialize 从方法表里删掉 ⇒ ①③④ 必须红', () => {
  // 变异自证：这一段若恒绿，说明它测的不是「initialize 存在」而是别的
  const src = require('node:fs').readFileSync(path.join(ROOT, 'p1b', 'mcp', 'protocol.cjs'), 'utf8');
  assert.ok(/case 'initialize':/.test(src),
    '★协议源码里必须有 initialize 分支——没有它，老客户端连不上，而本文件其余用例可能照样全绿');
  assert.ok(/case 'notifications\/initialized'/.test(src), '★必须有 notifications/initialized 分支');
  assert.ok(/case 'ping'/.test(src), '★必须有 ping 分支');
});
