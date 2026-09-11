// cdp-dump-text.mjs —— 无依赖 CDP 文本抽取器（Chrome GUI 子系统 stdout 不可捕获的替代验证路）
// 用法: node cdp-dump-text.mjs <url> [outFile]   （前提: chrome --remote-debugging-port=9223 已起）
const [,, url, out] = process.argv;
const base = 'http://127.0.0.1:9223';
// 新开目标页（新版 Chrome 要求 PUT）
const t = await (await fetch(base + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
if (!t.webSocketDebuggerUrl) { console.error('TARGET FAIL: ' + JSON.stringify(t)); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await new Promise(r => setTimeout(r, 2500)); // 等 React 挂载 + 数据请求
const text = await new Promise((resolve) => {
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === 1) resolve(m.result?.result?.value ?? '');
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.body.innerText', returnByValue: true } }));
});
console.log(text);
if (out) (await import('node:fs')).writeFileSync(out, text, 'utf8');
ws.close();
process.exit(0);
