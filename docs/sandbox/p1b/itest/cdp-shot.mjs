// cdp-shot.mjs —— CDP 移动视口(390x844@2x)截图 + 可选交互后文本抽取（零 npm 依赖）
// 用法: node cdp-shot.mjs <url> <pngOut> [txtOut] [clickText]
import fs from 'node:fs';
const [,, url, pngOut, txtOut, clickText] = process.argv;
const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaljs = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, returnByValue: true });
  return m.result?.result?.value;
};
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await new Promise(r => setTimeout(r, 3500));
if (clickText) {
  await evaljs("[...document.querySelectorAll('button')].find(b=>b.textContent.includes(" + JSON.stringify(clickText) + "))?.click()");
  await new Promise(r => setTimeout(r, 1200));
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(pngOut, Buffer.from(shot.result.data, 'base64'));
console.log('PNG saved:', pngOut, fs.statSync(pngOut).size + 'B');
if (txtOut) {
  fs.writeFileSync(txtOut, await evaljs('document.body.innerText'), 'utf8');
  console.log('TXT saved:', txtOut);
}
process.exit(0);
