import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8787';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaljs(expr) {
  const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result && m.result.exceptionDetails) return 'EVALERR: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 200);
  return m.result && m.result.result ? m.result.result.value : undefined;
}
const btn = (s) => "[...document.querySelectorAll('button')].find(b=>b.textContent.includes(" + JSON.stringify(s) + "))";
const q = (sel) => "document.querySelector('" + sel + "')";
const SETVAL = "(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}";
async function setVal(selOrExpr, v) {
  const isExpr = /^[(\[]/.test(selOrExpr) || selOrExpr.indexOf('document') === 0;
  const elExpr = isExpr ? selOrExpr : q(selOrExpr);
  return evaljs("(()=>{const el=" + elExpr + ";if(!el)return 'no-el';(" + SETVAL + ")(el," + JSON.stringify(v) + ");return 'set';})()");
}
const nth = (sel, i) => "(document.querySelectorAll('" + sel + "'))[" + i + "]";
const pageText = async () => evaljs('document.body.innerText');
async function nav(hash) { await send('Page.navigate', { url: BASE + '/' + hash }); await sleep(1800); }
await send('Emulation.setUserAgentOverride', { userAgent: UA });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const click = async (s) => evaljs("(()=>{const b=" + s + ";if(!b)return false;b.click();return true})()");
console.log('=== PROBE D: S4确认入账后紧跟宏 的复现 ===');
await nav('#/');
await sleep(800);
console.log('D0 topbar=' + String(await pageText()).slice(0, 90).replace(/\s+/g, ' '));
await setVal('.input-main textarea', '3号说自己是预言家，说5号是查杀');
await click(btn('AI 拆解'));
console.log('D1 确认卡=' + (await evaljs("!!" + q('.confirm-sheet'))));
await evaljs("(()=>{const b=" + btn('确认入账') + "; if(b)b.click(); return !!b})()");
await sleep(1200);
console.log('D2 入账后 .sheet 数=' + (await evaljs("document.querySelectorAll('.sheet').length")) + ' .confirm-sheet 数=' + (await evaljs("document.querySelectorAll('.confirm-sheet').length")) + ' overlay 数=' + (await evaljs("document.querySelectorAll('.confirm-overlay').length")));
console.log('D3 click 跳身份 -> ' + (await evaljs("(()=>{const b=" + btn('跳身份') + "; if(!b) return 'no-btn'; b.click(); return 'clicked';})()")));
await sleep(800);
console.log('D4 .sheet 数=' + (await evaljs("document.querySelectorAll('.sheet').length")) + ' aria=' + (await evaljs("(document.querySelector('.sheet-overlay')||{}).getAttribute?.('aria-label')")) + ' err=' + (await evaljs("(document.querySelector('.sheet-error')||{}).textContent||'(none)'") ));
console.log('D5 select0 set -> ' + (await setVal(nth('.sheet select', 0), '2')));
console.log('D6 role set -> ' + (await setVal(nth('.sheet input[list=role-suggest]', 0), '女巫')) + ' value=' + (await evaljs("(document.querySelector('.sheet input[list=role-suggest]')||{}).value")));
console.log('D7 出确认卡 -> ' + (await evaljs("(()=>{const b=" + btn('出确认卡') + "; if(!b) return 'no-btn'; b.click(); return 'clicked';})()")));
await sleep(800);
console.log('D8 confirm-sheet=' + (await evaljs("!!" + q('.confirm-sheet'))) + ' err=' + (await evaljs("(document.querySelector('.sheet-error')||{}).textContent||'(none)'") ));
console.log('D9 所有 .sheet-overlay aria=' + String(await evaljs("[...document.querySelectorAll('.sheet-overlay')].map(x=>x.getAttribute('aria-label')).join('|')")));
process.exit(0);