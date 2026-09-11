'use strict';
// _multiprovider-check.cjs — 多服务商 env 切换验证（注入 fetch，零真实网络）
process.env.LLM_API_KEY = 'test-key-123';
process.env.LLM_BASE_URL = 'https://api.moonshot.cn';
process.env.LLM_MODEL = 'kimi-k2';
const m = require('../src/llm.js');
console.log('mode=' + m.resolveMode());
let captured = null;
const fake = { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
  contradictions: [], hypotheses: [{ content: 'x', stance: { '1': 'neutral' }, support_events: [], oppose_events: [], tendency: 'weak' }], checkpoints: []
}) } }] }) };
m.generateCards({ day: 1, seats: [{ seat: 1, name: 'a' }], events: [], claims: [], actions: [], pairs: [] }, {
  fetchImpl: async (url, opts) => { captured = { url: url, model: JSON.parse(opts.body).model }; return fake; }
}).then(() => {
  console.log('captured_url=' + captured.url);
  console.log('captured_model=' + captured.model);
  console.log(captured.url === 'https://api.moonshot.cn/chat/completions' && captured.model === 'kimi-k2' ? 'MULTIPROVIDER_OK' : 'MISMATCH');
}).catch(e => console.log('ERR: ' + e.message));
