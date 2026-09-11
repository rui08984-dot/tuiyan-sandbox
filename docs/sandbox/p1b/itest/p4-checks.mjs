// p4-checks.mjs —— 视觉通道不可用时的几何量测验证：假设区双栏对峙（两卡同 top 异 left）+ 验证点勾选持久化
// 用法: node p4-checks.mjs <outDir>
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const tabs = await fetch('http://127.0.0.1:9223/json').then((r) => r.json());
const page = tabs.filter((x) => x.type === 'page' && x.url.indexOf('8787') >= 0 && x.url.indexOf('advisor') >= 0)[0];
if (!page) { console.log('FAIL 无 #/advisor 标签页'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('OK   ' + name);
  else { fails++; console.log('FAIL ' + name + (extra ? ' | ' + String(extra).slice(0, 200) : '')); }
  return cond;
}
const evaljs = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return m.result && m.result.result ? m.result.result.value : undefined;
};
// 手机视口
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(900);
// G1 双栏对峙：前两张假设卡同 top、不同 left
const geo = await evaljs("(()=>{const cards=[...document.querySelectorAll('.hyp-card')]; if(cards.length<2) return null; const g=cards[0].getBoundingClientRect(), h=cards[1].getBoundingClientRect(); return { n: cards.length, top0: Math.round(g.top), top1: Math.round(h.top), left0: Math.round(g.left), left1: Math.round(h.left), cols: getComputedStyle(document.querySelector('.hyp-grid')).gridTemplateColumns };})()");
console.log('G1 假设区几何: ' + JSON.stringify(geo));
check('G1 双栏对峙（两卡并排：同 top±2、left0<left1）', geo && Math.abs(geo.top0 - geo.top1) <= 2 && geo.left0 < geo.left1, JSON.stringify(geo));
// G2 勾选验证点 1 → done 样式 + localStorage 持久化
await evaljs("(()=>{const c=document.querySelector('.cp-item input[type=checkbox]'); if(!c) return false; c.click(); return true})()");
await sleep(400);
const after = await evaljs("(()=>{const it=document.querySelector('.cp-item'); return { done: it.classList.contains('done'), ls: localStorage.getItem('p1b.advisor.checks.v1') };})()");
check('G2a 勾选生效（done 划线样式）', after && after.done === true, JSON.stringify(after));
check('G2b 本机持久化（p1b.advisor.checks.v1 含 2:1）', after && (after.ls || '').indexOf('"2:1"') >= 0, after && after.ls);
// G3 刷新后勾选仍在（回看会话恢复）
await evaljs("location.reload(); void 0");
await sleep(2200);
await evaljs("(()=>{const b=[...document.querySelectorAll('button.chip')].find(x=>x.textContent.indexOf('第1天')>=0); if(b)b.click(); return !!b})()");
await sleep(900);
const afterReload = await evaljs("(()=>{const it=document.querySelector('.cp-item'); return it ? it.classList.contains('done') : null;})()");
check('G3 刷新回看后勾选保持', afterReload === true, 'afterReload=' + afterReload);
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT + '/p4-advisor-checks-mobile-390.png', Buffer.from(s.result.data, 'base64'));
console.log('PNG saved: p4-advisor-checks-mobile-390.png');
console.log('CHECKS RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);
