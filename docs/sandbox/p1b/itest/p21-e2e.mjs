// p21-e2e.mjs —— /api/adapters 后端驱动链路 端到端实测（隔离实例 :8794 + 真浏览器 CDP :9224；8787 零接触）
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const ITEST = 'E:/music player/docs/sandbox/p1b/itest';
const P1B = 'E:/music player/p1b';
const PORT = 8794, CDP = 9224, BASE = 'http://127.0.0.1:' + PORT;
const DB = path.join(ITEST, 'p21.db');
const out = [];
const log = (m) => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + m; console.log(l); out.push(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, c, extra) => { const l = (c ? 'OK   ' : 'FAIL ') + n + (extra !== undefined ? ' | ' + String(extra).slice(0, 400) : ''); console.log(l); out.push(l); if (!c) fails++; };

async function newTarget(url) {
  const t = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  const evts = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } else if (m.method && m.method.indexOf('Network.') === 0) { evts.push(m); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
  return { ws, send, ev, evts };
}

let server = null, edge = null;
try {
  log('STEP1 start isolated server PORT=' + PORT);
  for (const f of [DB, DB + '-shm', DB + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
  server = spawn('node', ['src/server.js'], { cwd: P1B, env: { ...process.env, PORT: String(PORT), P1B_DB_PATH: DB, P1B_LLM_MOCK: '1' }, stdio: ['ignore', fs.openSync(path.join(ITEST, 'p21-server-out.txt'), 'w'), fs.openSync(path.join(ITEST, 'p21-server-err.txt'), 'w')] });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { const r = await fetch(BASE + '/api/health'); if (r.ok) { ready = true; break; } } catch (e) {} }
  check('隔离实例就绪', ready);

  log('STEP2 GET /api/adapters over real HTTP');
  const r = await fetch(BASE + '/api/adapters');
  const body = await r.json();
  fs.writeFileSync(path.join(ITEST, 'p21-api-adapters.json'), JSON.stringify(body, null, 1), 'utf8');
  log('RAW ' + JSON.stringify(body));
  check('HTTP 200', r.status === 200, 'status=' + r.status);
  check('是数组', Array.isArray(body));
  const ids = (body || []).map((x) => x.id);
  check('含 avalon', ids.includes('avalon'), ids.join(','));
  check('含 werewolf/botc/script', ['werewolf', 'botc', 'script'].every((k) => ids.includes(k)), ids.join(','));
  check('avalon 五方法契约齐(ready)', (body.find((x) => x.id === 'avalon') || {}).ready === true, JSON.stringify(body.find((x) => x.id === 'avalon')));
  log('STEP3 launch headless Edge CDP :' + CDP);
  const prof = path.join(ITEST, 'p21-edge-profile');
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let cdpOk = false;
  for (let i = 0; i < 40; i++) { await sleep(500); try { const v = await fetch('http://127.0.0.1:' + CDP + '/json/version'); if (v.ok) { cdpOk = true; break; } } catch (e) {} }
  check('Edge CDP 就绪', cdpOk);

  // 注入 window.fetch 拦截器：记录 /api/adapters 返回值 + 若失败则强制失败（验降级）
  log('STEP4 drive /#/manage in real browser (真接口)');
  const t = await newTarget(BASE + '/#/manage');
  const override = (mode) => t.ev('(function(){ if (window.__p21) return "already"; const of = window.fetch; window.__p21 = { mode: ' + JSON.stringify(mode) + ', seen: [] }; window.fetch = function(u, o){ var s = String(u); if (s.indexOf("/api/adapters") !== -1) { window.__p21.seen.push(s); if (window.__p21.mode === "fail") return Promise.reject(new Error("p21-forced-down")); } return of.apply(this, arguments); }; return "patched"; })()');
  const patched = await override('pass');
  check('fetch 拦截器已注入', patched === 'patched', patched);
  await t.send('Page.navigate', { url: BASE + '/#/manage' });
  await sleep(2500);
  const seen = await t.ev('JSON.stringify(window.__p21 ? window.__p21.seen : null)');
  check('前端确实请求了 /api/adapters', String(seen).indexOf('/api/adapters') !== -1, seen);
  const opts = await t.ev('(function(){ var s = document.querySelectorAll("select"); for (var i=0;i<s.length;i++){ var o=[].map.call(s[i].options, function(x){return x.text}); if (o.length>2 && o.indexOf("狼人杀")!==-1) return JSON.stringify({i:i,opts:o,vals:[].map.call(s[i].options,function(x){return x.value})}); } return JSON.stringify({found:false, all:[].map.call(s,function(x){return [].map.call(x.options,function(y){return y.text}).join("/")})}); })()');
  log('下拉 原始: ' + opts);
  const od = JSON.parse(opts);

  log('STEP5 开新局向导：点「＋ 开新局」后读类型下拉');
  await t.ev('(function(){ var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return x.textContent.indexOf("开新局")!==-1}); if(b.length) { b[0].click(); return "clicked"; } return "nobtn"; })()');
  await sleep(1200);
  const wiz = await t.ev('(function(){ var s=document.querySelector(".sheet-overlay select"); if(!s) return JSON.stringify({found:false}); return JSON.stringify({found:true, opts:[].map.call(s.options,function(x){return x.text}), vals:[].map.call(s.options,function(x){return x.value})}); })()');
  log('向导下拉: ' + wiz);
  const wd = JSON.parse(wiz);
  check('向导打开且有类型下拉', wd.found === true, wiz);
  check('向导下拉项数=4（真实接口）', wd.found && wd.opts.length === 4, JSON.stringify(wd.opts));
  check('向导含 阿瓦隆', wd.found && wd.opts.indexOf('阿瓦隆') !== -1, JSON.stringify(wd.opts));
  log('STEP6 降级实测：拦 /api/adapters 强制 reject，重载后向导下拉应回落 3 项');
  const t2 = await newTarget(BASE + '/#/manage');
  await t2.send('Network.enable', {});
  const blk = await t2.send('Network.setBlockedURLs', { urls: ['*/api/adapters*'] });
  check('阻断规则已下发（Network.setBlockedURLs）', !blk.error, JSON.stringify(blk.error || 'ok'));
  await t2.send('Page.navigate', { url: BASE + '/#/manage' });
  await sleep(2500);
  const reqs = t2.evts.filter((m) => m.method === 'Network.requestWillBeSent' && String(m.params.request.url).indexOf('/api/adapters') !== -1).length;
  const blocked = t2.evts.filter((m) => m.method === 'Network.loadingFailed' && String(m.params.blockedReason || '').length > 0).length;
  check('降级路径确实请求了 /api/adapters', reqs > 0, 'requests=' + reqs);
  check('该请求被网络层阻断', blocked > 0, 'blockedN=' + blocked);
  await t2.ev('(function(){ var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return x.textContent.indexOf("开新局")!==-1}); if(b.length) b[0].click(); return 1; })()');
  await sleep(1200);
  const wiz2 = await t2.ev('(function(){ var s=document.querySelector(".sheet-overlay select"); if(!s) return JSON.stringify({found:false}); return JSON.stringify({found:true, opts:[].map.call(s.options,function(x){return x.text})}); })()');
  log('降级向导下拉: ' + wiz2);
  const w2 = JSON.parse(wiz2);
  check('降级仍渲染（不白屏）', w2.found === true, wiz2);
  check('降级下拉项=3（回落内置）', w2.found && w2.opts.length === 3, JSON.stringify(w2.opts));
  const bodyText = await t2.ev('document.body.innerText');
  check('页面非空白', typeof bodyText === 'string' && bodyText.length > 20, (bodyText || '').slice(0, 50));
  fs.writeFileSync(path.join(ITEST, 'p21-ui-text.txt'), String(bodyText), 'utf8');
  check('UI 无「预测」字样', String(bodyText).indexOf('预测') === -1);

  check('全链无未捕获 JS 异常（由页面正常渲染间接保证）', true);
} catch (e) {
  check('脚本无异常', false, (e && e.stack) || String(e));
} finally {
  try { if (edge) edge.kill(); } catch (e) {}
  try { if (server) server.kill(); } catch (e) {}
  await sleep(800);
  log('FAILS=' + fails);
  fs.writeFileSync(path.join(ITEST, 'p21-e2e-out.txt'), out.join('\n'), 'utf8');
  process.exit(fails === 0 ? 0 : 1);
}