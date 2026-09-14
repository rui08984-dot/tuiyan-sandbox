'use strict';
/**
 * p1b/test/llm-reasoning-effort.test.cjs —— 请求体旋钮 reasoning_effort（2026-09-14 新增）
 *
 * 锁四点（防"静默改请求体"与"忘了关"）：
 *   ① env 未设 ⇒ body 一字不改（零行为变化——这是默认态）；
 *   ② env=low ⇒ 对 chat/completions 的 JSON body 注入 reasoning_effort=low；
 *   ③ 已显式带 reasoning_effort 的 body ⇒ 不覆盖（调用方优先）；
 *   ④ 非 chat/completions URL / 非 JSON body ⇒ 不改；非法 env 值 ⇒ 视同未设。
 * 零网络：注入假 fetch 捕获 init。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mergeReasoningEffort } = require(path.join(__dirname, '..', 'src', 'llmOptions'));

const URL_CHAT = 'https://example.invalid/v1/chat/completions';
function bodyOf(init) { return JSON.parse(init.body); }

test('env 未设 ⇒ body 一字不改（默认态零行为变化）', () => {
  delete process.env.P1B_LLM_REASONING_EFFORT;
  const init = { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) };
  const out = mergeReasoningEffort(URL_CHAT, init);
  assert.equal(out, init, '同一对象原样返回');
  assert.equal(bodyOf(out).reasoning_effort, undefined);
});

test('env=low ⇒ 注入 reasoning_effort=low；原始 init 不被就地修改', () => {
  process.env.P1B_LLM_REASONING_EFFORT = 'low';
  const init = { method: 'POST', body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x' }] }) };
  const out = mergeReasoningEffort(URL_CHAT, init);
  assert.notEqual(out, init, '返回新对象');
  assert.equal(bodyOf(out).reasoning_effort, 'low');
  assert.equal(bodyOf(out).model, 'm', '其余字段保留');
  assert.equal(bodyOf(init).reasoning_effort, undefined, '原 init 未被就地篡改');
  delete process.env.P1B_LLM_REASONING_EFFORT;
});

test('已显式给值不覆盖 / 非 chat 端点不改 / 非 JSON body 不改 / 非法 env 视同未设', () => {
  process.env.P1B_LLM_REASONING_EFFORT = 'low';
  const given = { body: JSON.stringify({ reasoning_effort: 'high' }) };
  assert.equal(bodyOf(mergeReasoningEffort(URL_CHAT, given)).reasoning_effort, 'high', '调用方优先');
  const other = { body: JSON.stringify({ x: 1 }) };
  assert.equal(bodyOf(mergeReasoningEffort('https://example.invalid/v1/models', other)).reasoning_effort, undefined, '非 chat 端点不动');
  const notJson = { body: 'not-json' };
  assert.equal(mergeReasoningEffort(URL_CHAT, notJson), notJson, '非 JSON body 原样');
  const noBody = { method: 'GET' };
  assert.equal(mergeReasoningEffort(URL_CHAT, noBody), noBody, '无 body 原样');
  process.env.P1B_LLM_REASONING_EFFORT = 'yolo';
  const init = { body: JSON.stringify({ a: 1 }) };
  assert.equal(mergeReasoningEffort(URL_CHAT, init), init, '非法值视同未设');
  delete process.env.P1B_LLM_REASONING_EFFORT;
});
