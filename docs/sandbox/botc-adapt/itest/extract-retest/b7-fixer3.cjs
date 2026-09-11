'use strict';
const fs = require('fs');
const f = 'E:/music player/p1b/src/botc/extractPrompt.js';
let s = fs.readFileSync(f, 'utf8');
const before = s;
// 1) 头部：守卫去掉 !res.ok（非 2xx 原样透传），读自有 ok/status
s = s.replace(
  "if (!res || typeof res.ok !== 'boolean' || !res.ok || typeof res.json !== 'function') return res;\n  return Object.assign({}, res, {",
  "if (!res || typeof res.ok !== 'boolean' || typeof res.json !== 'function') return res;\n  const ok = res.ok;\n  if (!ok) return res; // 非 2xx：原样透传，交 llm.js 走其 HTTP 错误语义\n  const status = res.status;\n  return {\n    ok, status,\n    json: async () => {"
);
// 2) 收尾：Object.assign 的 '});' 需变成裸对象 '};'
s = s.replace(/(translateContentToCarriers\(msg\.content\);\n        if \(translated !== msg\.content\) msg\.content = translated;\n      \}\n      return data;\n    \},\n  \}\);)/,
  '      }\n      return data;\n    },\n  };');
fs.writeFileSync(f, s, 'utf8');
console.log('changed=' + (before !== s));
console.log('hasOwnOk=' + s.includes('const ok = res.ok;'));
console.log('noAssign=' + !s.includes('return Object.assign({}, res, {'));