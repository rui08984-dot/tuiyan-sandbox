'use strict';
/**
 * p1b/test/llm-chat-usage.test.cjs —— cached_tokens 打点测试（P0+ · 蓝图 §2.1#7 · 2026-09-16）
 * 用假 fetchImpl 走完 chatText 全链，断言 usage 计数含 cached_tokens（含缺失/null 的稳健性）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { chatText, getUsageStats, resetUsageStats } = require(path.join(ROOT, 'p1b', 'src', 'lib', 'llmChat.js'));

function fakeFetch(usage) {
  return async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: usage }) });
}

test('cached_tokens：prompt_tokens_details.cached_tokens 被累计', async () => {
  resetUsageStats();
  await chatText([{ role: 'user', content: 'hi' }], { apiKey: 'k', baseUrl: 'http://x', fetchImpl: fakeFetch({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 64 } }) });
  const s = getUsageStats();
  assert.equal(s.calls, 1);
  assert.equal(s.prompt_tokens, 100);
  assert.equal(s.completion_tokens, 20);
  assert.equal(s.total_tokens, 120);
  assert.equal(s.cached_tokens, 64, 'cached_tokens 未累计');
  assert.equal(s.calls_with_cached, 1);
});

test('cached_tokens：usage 无该字段 ⇒ 计数不变（不编 0 也不报错）', async () => {
  resetUsageStats();
  await chatText([{ role: 'user', content: 'hi' }], { apiKey: 'k', baseUrl: 'http://x', fetchImpl: fakeFetch({ prompt_tokens: 50, completion_tokens: 10 }) });
  const s = getUsageStats();
  assert.equal(s.cached_tokens, 0);
  assert.equal(s.calls_with_cached, 0, '无该字段时不应记入 calls_with_cached');
  assert.equal(s.prompt_tokens, 50);
});

test('resetUsageStats 清空 cached_tokens', async () => {
  await chatText([{ role: 'user', content: 'hi' }], { apiKey: 'k', baseUrl: 'http://x', fetchImpl: fakeFetch({ prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 1 } }) });
  resetUsageStats();
  const s = getUsageStats();
  assert.equal(s.cached_tokens, 0);
  assert.equal(s.calls_with_cached, 0);
  assert.equal(s.total_tokens, 0);
});
