'use strict';
/**
 * p1b/src/lib/llmChat.js —— 玄学判词专用最小文本 chat 通道（P2 线 W1）。
 *
 * 为什么存在：p1a-terminal/src/llm.js 全部导出面都是 JSON 契约（extract/generateCards，
 * 强制 response_format=json_object），未导出通用文本 chatCompletion，且 p1a 为禁改面。
 * 本文件按 llm.js 的 LIVE_MODE 同协议实现最小文本通道：
 *   POST {baseUrl}/chat/completions，Bearer options.apiKey；
 *   options{apiKey, baseUrl, model, fetchImpl, temperature} 与 p1b/src/llmOptions.js
 *   的 resolveLlmOptions 输出对齐（供应商配置仍走现有链，key 永不出服务端）。
 * 与 llm.js 的两处差异（有意为之，写死）：①不发 response_format（断语要自然文本，非 JSON 契约）；
 * ②无重试环（娱乐彩蛋，失败直接落 mock_fallback，由 routes/oracle.js 兜底）。
 * 仅供 routes/oracle.js 赛后娱乐判词使用，禁止接入任何游戏研判功能。
 */
// ── token 用量计数（additive；命题 A 消融要实测单次费用；不改变返回契约）──
const usageStats = { calls: 0, calls_with_usage: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
function noteUsage(u) {
  if (!u) return;
  usageStats.calls_with_usage++;
  usageStats.prompt_tokens += Number(u.prompt_tokens || 0);
  usageStats.completion_tokens += Number(u.completion_tokens || 0);
  usageStats.total_tokens = usageStats.prompt_tokens + usageStats.completion_tokens;
}
function getUsageStats() { return Object.assign({}, usageStats); }
function resetUsageStats() { usageStats.calls = 0; usageStats.calls_with_usage = 0; usageStats.prompt_tokens = 0; usageStats.completion_tokens = 0; usageStats.total_tokens = 0; }

async function chatText(messages, options) {
  options = options || {};
  const apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) {
    throw new Error('LIVE_MODE 需要 LLM_API_KEY（或 DEEPSEEK_API_KEY）环境变量（契约§5：env-only，禁止写入任何文件）');
  }
  const baseUrl = String(options.baseUrl || process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new Error('当前环境无可用 fetch 实现');
  const body = {
    model: options.model || process.env.LLM_MODEL || 'deepseek-chat',
    messages: messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.8,
    stream: false,
  }; // 无 response_format：断语是自然文本，不进 JSON 契约
  const res = await fetchImpl(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  });
  if (!res || typeof res.ok !== 'boolean') throw new Error('LLM 响应异常（fetchImpl 须返回 {ok,status,json()}）');
  if (!res.ok) throw new Error('LLM API HTTP ' + res.status);
  const data = await res.json();
  usageStats.calls++;
  noteUsage(data && data.usage);
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 响应缺少 choices[0].message.content');
  return content.trim();
}

module.exports = { chatText, getUsageStats, resetUsageStats };
