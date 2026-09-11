'use strict';
/**
 * p1b/src/llmOptions.js —— 把「激活供应商配置」翻译成 p1a llm.js 的 options 注入。
 * 链路对齐 p1a-terminal/src/cli.js 的 loadLlmConfig/withLlmOptions：
 *   {apiKey, baseUrl, model}（model 取 cards.model 优先）注入 llm.extract/advisor 的 input.options。
 * mock 优先级：P1B_LLM_MOCK=1（或 buildServer opts.llmMock）→ options.mockMode=true（零网络，测试铁律）；
 * 无激活供应商/无 key 时不注入 apiKey —— llm.js resolveMode 自然落 MOCK。
 */
function resolveLlmOptions({ store, llmMock, fetchImpl }) {
  const opts = {};
  if (llmMock) opts.mockMode = true;
  // 测试缝（B3）：makeAdviseRunner 的 ctx 可直传 fetchImpl（llm.js 明示「options.fetchImpl
  // 可注入，测试零真实网络」）。server.js 组装的 ctx 无此键 → 生产恒 undefined，零行为变化。
  if (typeof fetchImpl === 'function') opts.fetchImpl = fetchImpl;
  try {
    const cfg = store.read();
    const p = cfg.active && cfg.providers ? cfg.providers[cfg.active] : null;
    if (p) {
      if (typeof p.api_key === 'string' && p.api_key) opts.apiKey = p.api_key;
      if (p.base_url) opts.baseUrl = p.base_url;
      const model = (p.cards && p.cards.model) || (p.extraction && p.extraction.model) || p.model;
      if (model) opts.model = model;
    }
  } catch (e) {
    // 配置缺失/损坏不阻断服务：LLM 层自行落 MOCK（与 cli.js loadLlmConfig 容错同思路）
  }
  return opts;
}

module.exports = { resolveLlmOptions };
