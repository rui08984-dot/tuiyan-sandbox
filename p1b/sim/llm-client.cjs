'use strict';
/**
 * p1b/sim/llm-client.cjs —— sim loop 专用最小 LLM 通道（M0 冒烟）。
 * 走 tokenrhythm 供应商（p1a-terminal/config/providers.json 服务端共享配置），
 * key 仅进程内使用，不落日志、不进产物。协议与 p1b/src/lib/llmChat.js 对齐
 * （POST {base_url}/chat/completions），差异：①按供应商 key 取配置（非 active）；
 * ②带 usage 回传（成本如实记录）；③带超时与一次重试由调用方决定。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_PROVIDERS = path.join(__dirname, '..', '..', 'p1a-terminal', 'config', 'providers.json');

function resolveProvider(providerKey) {
  const raw = fs.readFileSync(DEFAULT_PROVIDERS, 'utf8');
  const cfg = JSON.parse(raw);
  const p = (cfg.providers && cfg.providers[providerKey]) || null;
  if (!p) throw new Error('providers.json 无供应商: ' + providerKey);
  const apiKey = typeof p.api_key === 'string' ? p.api_key : '';
  if (!apiKey) throw new Error('供应商 ' + providerKey + ' 无 api_key（LIVE 模式必须）');
  const baseUrl = String(p.base_url || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('供应商 ' + providerKey + ' 无 base_url');
  const model = (p.cards && p.cards.model) || (p.extraction && p.extraction.model) || p.model;
  if (!model) throw new Error('供应商 ' + providerKey + ' 无 model');
  return { apiKey, baseUrl, model };
}

/** 返回 {content, usage, model}；失败抛错（重试策略归调用方） */
async function chatOnce(messages, opts) {
  const o = opts || {};
  const { apiKey, baseUrl, model: pModel } = resolveProvider(o.providerKey || 'tokenrhythm');
  const model = o.model || pModel;
  const body = {
    model,
    messages,
    temperature: typeof o.temperature === 'number' ? o.temperature : 0.7,
    stream: false,
  };
  if (o.maxTokens) body.max_tokens = o.maxTokens;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 60000);
  let res;
  try {
    res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('LLM HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 响应缺 content');
  return { content: content.trim(), usage: data.usage || null, model: data.model || model };
}

module.exports = { chatOnce, resolveProvider };
