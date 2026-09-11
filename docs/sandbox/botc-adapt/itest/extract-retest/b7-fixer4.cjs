'use strict';
const fs = require('fs');
const f = 'E:/music player/p1b/src/botc/extractPrompt.js';
let s = fs.readFileSync(f, 'utf8');
const startMark = '/** L2';
const endMark = '/**'
const a = s.indexOf(startMark);
const b = s.indexOf('function withBotcExtractContext');
if (a === -1 || b === -1 || b <= a) { console.log('ANCHOR FAIL a=' + a + ' b=' + b); process.exit(1); }
const fn = [
  '/** L2 响应侧壳：res.json() 内容翻译（llm.js 只消费 ok/status/json()）。 */',
  'function augmentResponse(res) {',
  "  if (!res || typeof res.ok !== 'boolean' || typeof res.json !== 'function') return res;",
  '  const ok = res.ok;',
  '  if (!ok) return res; // 非 2xx：原样透传，交 llm.js 走其 HTTP 错误语义',
  '  const status = res.status;',
  '  return {',
  '    ok, status,',
  '    json: async () => {',
  '      const data = await res.json();',
  '      const msg = data && data.choices && data.choices[0] && data.choices[0].message;',
  "      if (msg && typeof msg.content === 'string') {",
  '        const translated = translateContentToCarriers(msg.content);',
  '        if (translated !== msg.content) msg.content = translated;',
  '      }',
  '      return data;',
  '    },',
  '  };',
  '}',
  '',
].join('\n');
s = s.slice(0, a) + fn + s.slice(b);
fs.writeFileSync(f, s, 'utf8');
console.log('rebuilt ok');