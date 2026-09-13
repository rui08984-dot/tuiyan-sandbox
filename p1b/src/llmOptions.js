'use strict';
/**
 * p1b/src/llmOptions.js —— 把「激活供应商配置」翻译成 p1a llm.js 的 options 注入。
 * 链路对齐 p1a-terminal/src/cli.js 的 loadLlmConfig/withLlmOptions：
 *   {apiKey, baseUrl, model}（model 取 cards.model 优先）注入 llm.extract/advisor 的 input.options。
 * mock 优先级：P1B_LLM_MOCK=1（或 buildServer opts.llmMock）→ options.mockMode=true（零网络，测试铁律）；
 * 无激活供应商/无 key 时不注入 apiKey —— llm.js resolveMode 自然落 MOCK。
 */
// ── 默认超时 fetch（2026-09-14 新增，additive；不改变任何契约）──────────────
// 事故根因：2026-09-13 21:46 起的补漏跑批 wedge 在首个 LLM 请求上（TCP Established、
// 86 分钟 CPU 仅 0.11s、out/err 日志 0 字节、state 零写入）——上游不回包而 fetch 无超时，
// 整条跑批永久挂死。此处为所有未注入 fetchImpl 的 LLM 路径套 AbortController 超时：
// 超时 → AbortError → 由各调用方既有 try/catch 记录并继续（fail-fast 取代 hang-forever）。
// 默认 120s（实测单次 ≈18.5s，6 倍余量）；P1B_LLM_TIMEOUT_MS 可覆盖；<=0 表示不超时。
const DEFAULT_LLM_TIMEOUT_MS = Number(process.env.P1B_LLM_TIMEOUT_MS || 120000);
function timeoutFetch(ms) {
  return function (url, init) {
    const opts = Object.assign({}, init || {});
    if (ms > 0 && !opts.signal) {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
      opts.signal = ctrl.signal;
      return fetch(url, opts).finally(function () { clearTimeout(timer); });
    }
    return fetch(url, opts);
  };
}

function resolveLlmOptions({ store, llmMock, fetchImpl }) {
  const opts = {};
  if (llmMock) opts.mockMode = true;
  // 测试缝（B3）：makeAdviseRunner 的 ctx 可直传 fetchImpl（llm.js 明示「options.fetchImpl
  // 可注入，测试零真实网络」）。生产 ctx 无此键 → 落到下面的默认超时 fetch（2026-09-14 修复）。
  if (typeof fetchImpl === 'function') opts.fetchImpl = fetchImpl;
  else if (typeof fetch === 'function') opts.fetchImpl = timeoutFetch(DEFAULT_LLM_TIMEOUT_MS);
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
