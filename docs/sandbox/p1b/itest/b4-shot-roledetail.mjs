// b4-shot-roledetail.mjs —— 补拍：角色参考面板展开态 + 阵营/状态声称区（滚动到可见）
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = 'http://127.0.0.1:8787';
const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaljs = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (m.result && m.result.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
  return m.result && m.result.result ? m.result.result.value : undefined;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '/' + name, Buffer.from(s.result.data, 'base64'));
  console.log('SHOT ' + name + ' ' + fs.statSync(OUT + '/' + name).size + 'B');
};
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await evaljs("location.href = '" + BASE + "/#/games'");
await sleep(2800);
await evaljs("[...document.querySelectorAll('.game-item-main')].find(b=>b.textContent.includes('暗流涌动')).click()"); // 按名选 botc 局
await sleep(1400);
await evaljs("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('展开本剧本角色参考')).click()");
await sleep(800);
await evaljs("document.querySelector('.role-ref-grid').scrollIntoView({ block: 'start' })");
await sleep(500);
await shot('p6-role-ref-open.png');
await evaljs("document.querySelector('.botc-claim-list')?.scrollIntoView({ block: 'center' })");
await sleep(500);
await shot('p6-games-botc-claims-visible.png');
process.exit(0);
