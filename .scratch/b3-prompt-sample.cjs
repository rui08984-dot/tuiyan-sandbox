'use strict';
/* B3 验证样例：走真实 withBotcPromptContext 包装链路捕获 BOTC 局 prompt（零网络）。 */
const path = require('path');
const { llm } = require(path.join(__dirname, '..', 'p1b', 'src', 'deps'));
const { buildBotcPromptContext, withBotcPromptContext, BOTC_CONTEXT_MARK } =
  require(path.join(__dirname, '..', 'p1b', 'src', 'botc', 'advisePrompt'));

(async () => {
  const contextText = buildBotcPromptContext('tb');
  const captured = [];
  const fakeFetch = async (url, init) => { captured.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }; };
  const options = withBotcPromptContext({ fetchImpl: fakeFetch, apiKey: 'test-key-B3-MOCK-NOT-REAL' }, contextText);
  // 模拟 llm.generateCards → chatCompletion 的请求体（messages 每次尝试从原 system 重建 → 幂等）
  const messages = [
    { role: 'system', content: llm.CARDS_SYSTEM_PROMPT },
    { role: 'user', content: '【第1天结算 | 在册座位】1,2,3,4,5\n（略）' },
  ];
  const body = JSON.stringify({ model: 'test', messages, temperature: 0.2 });
  await options.fetchImpl('http://b3.invalid/v1/chat/completions', { method: 'POST', body });
  const sys = captured[0].messages[0].content;
  const idx = sys.indexOf(BOTC_CONTEXT_MARK);
  const lines = [];
  lines.push('=== 捕获确认 ===');
  lines.push('system 前缀=CARDS_SYSTEM_PROMPT 原文: ' + sys.startsWith(llm.CARDS_SYSTEM_PROMPT));
  lines.push('注入位置: system 消息尾部（追加上下文 ' + (sys.length - idx) + ' 字符）');
  lines.push('');
  lines.push('=== BOTC 局捕获 prompt 节选（TB 局，注入段起） ===');
  lines.push(sys.slice(idx, idx + 1200));
  lines.push('……（角色清单其余行省略）……');
  lines.push('');
  lines.push('=== 注入段尾部（说书人裁量警示 + 假设区要求） ===');
  const wIdx = sys.indexOf('【说书人裁量警示');
  lines.push(sys.slice(wIdx, sys.length));
  require('fs').writeFileSync(path.join(__dirname, 'b3-prompt-sample.txt'), lines.join('\n'), 'utf8');
  console.log('OK');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
