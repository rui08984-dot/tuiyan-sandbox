// p8-drive.mjs —— W3 集成收口端到端（v2）：chrome 由本脚本 spawn（沙箱允许 node stdio:ignore spawn）。
// 链路：spawn chrome CDP 9224 → 建局→入账→天结算→判词自动弹→防重弹→手动入口→API 对齐→截图 → 收口杀 chrome。
// 用法: node p8-drive.mjs <outDir>（前提: 后端 :8789 MOCK 已起，p8-w3-run.ps1 负责）
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const OUT = process.argv[2] || '.';
const BASE = 'http://127.0.0.1:8789';
const CDP = 'http://127.0.0.1:9224';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── chrome 自管：spawn（stdio ignore 沙箱安全）+ exit 钩子兜杀 ──
const chromePath = process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe';
const chromeProc = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=9224',
  '--user-data-dir=' + OUT + '\\p8-chrome-prof2',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chromeProc.kill(); } catch { } });
let cdpOk = false;
for (let i = 0; i < 60; i++) {
  try {
    const v = await (await fetch(CDP + '/json/version')).json();
    if (v && v.Browser) { cdpOk = true; console.log('CDP: ' + v.Browser); break; }
  } catch { }
  await sleep(500);
}
if (!cdpOk) { console.log('FAIL CDP 9224 never came up'); process.exit(1); }

const t = await (await fetch(CDP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('OK   ' + name);
  else { fails++; console.log('FAIL ' + name + (extra ? ' | ' + String(extra).slice(0, 240) : '')); }
  return cond;
}
async function evaljs(expr) {
  const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result && m.result.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result && m.result.result ? m.result.result.value : undefined;
}
const btn = (s) => "[...document.querySelectorAll('button')].find(b=>b.textContent.includes(" + JSON.stringify(s) + "))";
const SETVAL = "(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}";
const pageText = async () => evaljs('document.body.innerText');
const click = async (s) => evaljs("(()=>{const b=" + s + ";if(!b)return false;b.click();return true})()");
async function setVal(sel, v) {
  return evaljs("(()=>{const el=document.querySelector('" + sel + "');if(!el)return false;(" + SETVAL + ")(el," + JSON.stringify(v) + ");return true})()");
}
const q = (sel) => "document.querySelector('" + sel + "')";
async function api(path, opts) {
  const expr = "(async () => { const r = await fetch('" + path + "', " + JSON.stringify(opts || {}) + "); return JSON.stringify({ status: r.status, body: await r.text() }); })()";
  const parsed = JSON.parse(await evaljs(expr));
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null };
}
async function shot(pngOut, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: mobile ? 2 : 1, mobile: mobile });
  await sleep(700);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(pngOut, Buffer.from(s.result.data, 'base64'));
  console.log('PNG saved: ' + pngOut.split('\\').pop() + ' ' + fs.statSync(pngOut).size + 'B');
}
async function nav(hash) { await send('Page.navigate', { url: BASE + '/' + hash }); await sleep(1200); }
async function waitSel(sel, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    if (await evaljs("!!" + q(sel))) return true;
    await sleep(400);
  }
  return false;
}
async function waitGone(sel, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    if (!(await evaljs("!!" + q(sel)))) return true;
    await sleep(400);
  }
  return false;
}
async function waitText(txt, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    const p = await pageText();
    if (p.indexOf(txt) >= 0) return true;
    await sleep(400);
  }
  return false;
}

try {
  // ── S0 环境 ──
  await send('Emulation.setUserAgentOverride', { userAgent: UA });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await nav('#/');
  check('S0a 现场页可达', (await pageText()).indexOf('未选局') >= 0 || (await pageText()).indexOf('第 1 天') >= 0 || (await evaljs("!!" + q('[data-testid=live-empty]'))));

  // ── S1 向导建 werewolf 局（6人）──
  await click(btn('＋ 开新局'));
  check('S1a 向导弹出', await waitSel('.sheet', 8000));
  await setVal('.form-grid .field input', 'P8判词收口');
  await setVal('.form-grid .row2 select', 'werewolf');
  await setVal('.form-grid input[type=number]', '6');
  await click(btn('下一步'));
  await sleep(700);
  await click(btn('创建局并进入现场'));
  check('S1b 创建后现场 TopBar', await waitText('P8判词收口', 8000));
  const gl = await api('/api/games');
  const gWolf = (gl.body.games || []).find((g) => g.name === 'P8判词收口');
  const gid = gWolf ? gWolf.id : 0;
  check('S1c 局落库（id=' + gid + '，6人）', gid > 0 && gWolf.player_count === 6);

  // ── S2 常驻入口 ──
  check('S2a 常驻入口「☯ 判词」在场', await waitSel('.oracle-entry', 6000));
  check('S2b 入口旁恒挂提示（非游戏研判）', (await pageText()).indexOf('非游戏研判') >= 0);

  // ── S3 自由文本抽取+入账 ──
  await setVal('.input-main textarea', '3号说自己是预言家，说5号是查杀');
  await click(btn('AI 拆解'));
  check('S3a 确认卡弹出', await waitSel('.confirm-sheet', 15000));
  await click(btn('确认入账'));
  check('S3b-1 确认卡关闭（busy 复位，防天结算点击落空）', await waitGone('.confirm-sheet', 10000));
  check('S3b 自由文本入账', await waitText('3号说自己是预言家', 6000));
  await sleep(400);

  // ── S4 天结算→就绪→判词自动弹（首弹）──
  await click(btn('⚡ 天结算'));
  await sleep(800);
  check('S4a 天结算就绪（.adv-badge.is-ready）', (await waitSel('.adv-badge.is-ready', 20000)) || (await waitText('就绪', 8000)));
  check('S4b 判词弹层自动出现', await waitSel('.oracle-overlay', 15000));
  await sleep(700);
  const guaRows = (await evaljs("document.querySelectorAll('.oracle-gua-row').length")) || 0;
  check('S4c 卦象三行（rows=' + guaRows + '）', guaRows === 3);
  const tyTxt = (await evaljs("(" + q('.oracle-tiyong') + "||{}).textContent||''")) || '';
  check('S4d 动爻体用五行条', tyTxt.indexOf('动爻第') >= 0 && tyTxt.indexOf('体') >= 0 && tyTxt.indexOf('用') >= 0, tyTxt.slice(0, 60));
  const verTxt = (await evaljs("(" + q('.oracle-verdict') + "||{}).textContent||''")) || '';
  check('S4e 断语非空且含「娱乐参考」', verTxt.length >= 8 && verTxt.indexOf('娱乐参考') >= 0, verTxt.slice(0, 80));
  const disTxt = (await evaljs("(" + q('.oracle-disclaimer') + "||{}).textContent||''")) || '';
  check('S4f 恒挂标注「娱乐参考 · 非游戏研判」', disTxt.indexOf('娱乐参考') >= 0 && disTxt.indexOf('非游戏研判') >= 0, disTxt);
  const lsVal = await evaljs("localStorage.getItem('p1b.oracle.seen.v1." + gid + "')");
  check('S4g localStorage 防重弹 key 含 game id（值=' + lsVal + '）', lsVal === '1');
  await shot(OUT + '/p8-oracle-open.png', 390, 844, true);

  // ── S5 关闭 ──
  await click(btn('关闭'));
  check('S5a 关闭按钮生效', await waitGone('.oracle-overlay', 6000));
  await sleep(500);

  // ── S6 防重弹：刷新不重弹 + 同 day 重复结算不重弹 ──
  await nav('#/');
  await sleep(1200);
  check('S6a 刷新后不自动重弹', !(await evaljs("!!" + q('.oracle-overlay'))));
  await click(btn('⚡ 天结算'));
  await sleep(800);
  await (await waitSel('.adv-badge.is-ready', 20000)) || (await waitText('就绪', 8000));
  await sleep(2200);
  check('S6b 同 day 重复结算不自动重弹（seen=1>=day=1）', !(await evaljs("!!" + q('.oracle-overlay'))));
  check('S6c localStorage 值仍=1', (await evaljs("localStorage.getItem('p1b.oracle.seen.v1." + gid + "')")) === '1');

  // ── S7 手动入口 + API 对齐 ──
  await evaljs("(()=>{const b=" + btn('判词') + ";if(b)b.click();return !!b})()");
  check('S7a 手动「☯ 判词」开弹层', await waitSel('.oracle-overlay', 6000));
  await sleep(600);
  const verManual = (await evaljs("(" + q('.oracle-verdict') + "||{}).textContent||''")) || '';
  const o = await api('/api/games/' + gid + '/oracle');
  const ob = o.body || {};
  check('S7b API /oracle 200 + mode=mock + disclaimer 精确', o.status === 200 && ob.mode === 'mock' && ob.disclaimer === '娱乐参考', JSON.stringify({ status: o.status, mode: ob.mode }));
  check('S7c 弹层断语与 API verdict 逐字一致', ob.verdict === verManual, 'ui=' + verManual.slice(0, 40) + ' api=' + String(ob.verdict || '').slice(0, 40));
  check('S7d API verdict 含卦名+娱乐参考', String(ob.verdict).indexOf(ob.casting && ob.casting.benGua ? ob.casting.benGua.fullName : '?') >= 0 && String(ob.verdict).indexOf('娱乐参考') >= 0);
  await shot(OUT + '/p8-oracle-manual.png', 390, 844, true);

  // ── S8 关闭后常态 ──
  await click(btn('关闭'));
  await waitGone('.oracle-overlay', 6000);
  await sleep(500);
  check('S8a 关闭后现场页正常（弹层无+入口在）', !(await evaljs("!!" + q('.oracle-overlay'))) && !!(await evaljs("!!" + q('.oracle-entry'))));
  await shot(OUT + '/p8-oracle-closed.png', 390, 844, true);

  // ── S9 day2 新一天再自动弹（记忆按 day 放行）──
  await click(q('button[aria-label=后一天]'));
  await sleep(500);
  await click(btn('⚡ 天结算'));
  await sleep(800);
  await (await waitSel('.adv-badge.is-ready', 20000)) || (await waitText('就绪', 8000));
  check('S9a day2 就绪后判词再次自动弹', await waitSel('.oracle-overlay', 15000));
  const lsVal2 = await evaljs("localStorage.getItem('p1b.oracle.seen.v1." + gid + "')");
  check('S9b localStorage 值推进=2', lsVal2 === '2', 'val=' + lsVal2);
  await click(btn('关闭'));
  await waitGone('.oracle-overlay', 6000);
} finally {
  try { chromeProc.kill(); } catch { }
}

console.log('P8-DRIVE RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);
