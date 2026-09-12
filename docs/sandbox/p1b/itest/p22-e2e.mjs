// p22-e2e.mjs —— 审计页「三层递进」改造 端到端实测（隔离实例 :8794 + DB 快照 + 真浏览器 CDP；8787 零接触）
// 用法: node p22-e2e.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const requireP1a = createRequire('E:/music player/p1a-terminal/package.json');

const ITEST = 'E:/music player/docs/sandbox/p1b/itest';
const P1B = 'E:/music player/p1b';
const PORT = 8794, CDP = 9224, BASE = 'http://127.0.0.1:' + PORT;
const DB = path.join(ITEST, 'p22.db');
const out = [];
const log = (m) => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + m; console.log(l); out.push(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, cond, extra) => { const l = (cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined ? ' | ' + String(extra).slice(0, 300) : ''); console.log(l); out.push(l); if (!cond) fails++; };

let server = null, edge = null;
try {
  log('STEP1 snapshot real p1a.db -> p22.db (VACUUM INTO, source read-only)');
  const Database = requireP1a('better-sqlite3');
  const src = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
  for (const f of [DB, DB + '-shm', DB + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
  src.exec("VACUUM INTO '" + DB + "'");
  src.close();
  log('snapshot ok ' + fs.statSync(DB).size + ' bytes');

  log('STEP2 start isolated server PORT=' + PORT);
  server = spawn('node', ['src/server.js'], { cwd: P1B, env: { ...process.env, PORT: String(PORT), P1B_DB_PATH: DB, P1B_LLM_MOCK: '1' }, stdio: ['ignore', fs.openSync(path.join(ITEST, 'p22-server-out.txt'), 'w'), fs.openSync(path.join(ITEST, 'p22-server-err.txt'), 'w')] });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { const r = await fetch(BASE + '/api/health'); if (r.ok) { ready = true; break; } } catch (e) {} }
  check('隔离实例就绪', ready);

  log('STEP3 GET /api/audit/summary');
  const rs = await fetch(BASE + '/api/audit/summary');
  const sb = await rs.json();
  check('HTTP 200', rs.status === 200, 'status=' + rs.status);
  check('l0_gate 双口径字段齐', sb.l0_gate && typeof sb.l0_gate.unresolved === 'number' && typeof sb.l0_gate.resolved === 'number' && typeof sb.l0_gate.review_unlocked === 'boolean', JSON.stringify(sb.l0_gate));
  check('layer_calibration 非空', Array.isArray(sb.layer_calibration) && sb.layer_calibration.length > 0, 'n=' + sb.layer_calibration.length);
  check('pending_forward_total>0', sb.pending_forward_total > 0, 'total=' + sb.pending_forward_total);
  fs.writeFileSync(path.join(ITEST, 'p22-api-summary.json'), JSON.stringify(sb, null, 1), 'utf8');

  log('STEP4 launch headless Edge CDP :' + CDP);
  try { fs.rmSync(path.join(ITEST, 'p22-edge-profile'), { recursive: true, force: true }); } catch (e) {}
  edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(ITEST, 'p22-edge-profile'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let cdpOk = false;
  for (let i = 0; i < 40; i++) { await sleep(500); try { const v = await fetch('http://127.0.0.1:' + CDP + '/json/version'); if (v.ok) { cdpOk = true; break; } } catch (e) {} }
  check('Edge CDP 就绪', cdpOk);

  log('STEP5 drive /#/audit in real browser');
  const t = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaljs = async (expr) => {
    const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result && m.result.exceptionDetails) throw new Error('EVAL <<' + expr + '>> ' + JSON.stringify(m.result.exceptionDetails).slice(0, 200));
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/#/audit' });
  await sleep(4500);
  // 页内选择器助手（无引号拼装，规避转义）
  await evaljs('window.__t=function(s){return document.querySelector(String.fromCharCode(91)+"data-testid="+s+String.fromCharCode(93))}');
  const q = (s) => "!!document.querySelector(String.fromCharCode(91)+'data-testid='+'" + s + "'+String.fromCharCode(93))";
  const text = await evaljs('document.body.innerText');
  const has = (s) => String(text).includes(s);

  // ① 导航入口（本棒修的 bug：/audit 只能手输网址）
  const navLinks = await evaljs("Array.prototype.map.call(document.querySelectorAll('.appbar-nav a'), function(a){return a.textContent.trim()+'|'+a.getAttribute('href')}).join(' , ')");
  check('appbar-nav 含审计导航链接', String(navLinks).includes('审计|#/audit'), navLinks);
  await evaljs("(function(){var a=[].find.call(document.querySelectorAll('.appbar-nav a'),function(x){return x.textContent.trim()==='审计'}); if(a) a.click(); return !!a;})()");
  await sleep(900);
  const afterClick = await evaljs("location.hash + ' :: ' + " + q('audit-page'));
  check('点击导航后落在 /#/audit 且页面渲染', String(afterClick).indexOf('#/audit :: true') === 0, afterClick);

  // ② 第一屏 + 第二屏
  check('第一屏状态卡存在', (await evaljs(q('audit-hero'))) === true);
  check('第一屏三张数字卡（在观察/已回填/门禁）', (await evaljs("document.querySelectorAll('.audit-hero-num').length")) === 3,
    await evaljs("Array.prototype.map.call(document.querySelectorAll('.audit-hero-num'),function(d){return d.innerText.replace(/\s+/g,' ').trim()}).join(' | ')"));
  const heroLine = await evaljs("(document.querySelector('.audit-hero-line')||{}).innerText");
  check('第一屏含一句人话总结', typeof heroLine === 'string' && heroLine.length > 8, heroLine);
  const heroTxt = await evaljs("document.querySelector('.audit-hero').innerText");
  check('第一屏数字旁挂「参考」', String(heroTxt).indexOf('参考') >= 0, String(heroTxt).replace(/\s+/g, ' ').slice(0, 200));
  const lcards = await evaljs("document.querySelectorAll('[data-testid^=audit-lcard-]').length");
  check('第二屏六张分层卡 L1-L6', lcards === 6, 'cards=' + lcards);
  const cardIds = await evaljs("Array.prototype.map.call(document.querySelectorAll('[data-testid^=audit-lcard-]'),function(d){return d.getAttribute('data-testid')}).join(',')");
  check('分层卡 id=L1..L6', cardIds === 'audit-lcard-L1,audit-lcard-L2,audit-lcard-L3,audit-lcard-L4,audit-lcard-L5,audit-lcard-L6', cardIds);
  const openBefore = await evaljs("document.querySelectorAll('[data-testid^=audit-lcard-][open]').length");
  check('分层卡默认折叠', openBefore === 0, 'open=' + openBefore);
  const clicked = await evaljs("(function(){var d=document.querySelector('[data-testid=audit-lcard-L6] summary'); if(!d) return 'NOSUM'; d.click(); return 'CLICKED';})()");
  await sleep(500);
  const openAfter = await evaljs("document.querySelectorAll('[data-testid^=audit-lcard-][open]').length");
  check('点击卡片可展开该层明细（第二屏内折叠）', clicked === 'CLICKED' && openAfter === 1, clicked + ' open=' + openAfter);
  const l6txt = await evaljs("document.querySelector('[data-testid=audit-lcard-L6]').innerText.replace(/\s+/g,' ')");
  check('展开后显示 题量/已解真值/校准参考/基率', ['题量', '已解真值', '校准参考', '基率'].every((k) => String(l6txt).includes(k)), l6txt);

  const l6closed = await evaljs("document.querySelector('[data-testid=audit-lcard-L6]').innerText.replace(/\s+/g,' ')");
  check('折叠态卡片即显示 层名/题量/已解/校准参考', ['L6','对抗','题量','已解真值','校准参考'].every(function(k){return String(l6closed).includes(k)}), l6closed);
  // ③ 第三屏：明细折叠
  const foldOpenBefore = await evaljs("document.querySelector('[data-testid=audit-detail-fold]').hasAttribute('open')");
  check('第三屏明细默认折叠', foldOpenBefore === false, 'open=' + foldOpenBefore);
  check('第三屏标题含明细清单', String(await evaljs("document.querySelector('[data-testid=audit-detail-fold] summary').innerText")).indexOf('明细') >= 0);
  await evaljs("document.querySelector('[data-testid=audit-detail-fold] summary').click()");
  await sleep(600);
  const legacy = await evaljs("['audit-ledger-card','audit-gate-card','audit-calib-card','audit-forward-card','audit-layer-calib-card','audit-layers-card'].filter(function(t){return !!document.querySelector('[data-testid='+t+']')}).join(',')");
  check('p20 已验收的六块卡片全部保留', legacy.split(',').length === 6, legacy);
  check('展开后落在第三屏折叠区内部', (await evaljs("!!document.querySelector('[data-testid=audit-detail-fold] [data-testid=audit-ledger-card]')")) === true);
  check('六层说明行仍在（audit-layer-L1..L6）', (await evaljs("document.querySelectorAll('[data-testid^=audit-layer-L]').length")) === 6);

  // ④ 铁律词检（在「全部折叠展开后」的全文上做，覆盖三层全部文案）
  const textFull = await evaljs('document.body.innerText');
  const banned = ['预测', '预报', '押注', '胜率'].filter((w) => String(textFull).includes(w));
  check('铁律：UI 全文（含展开明细）禁「预测/预报/押注/胜率」0 命中', banned.length === 0, 'hits=' + JSON.stringify(banned) + ' len=' + String(textFull).length);
  fs.writeFileSync(path.join(ITEST, 'p22-audit-dom.txt'), text, 'utf8');
  fs.writeFileSync(path.join(ITEST, 'p22-audit-dom-full.txt'), textFull, 'utf8');

  // ⑤ 截图（桌面 + 手机）
  const shotW = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(ITEST, 'p22-audit-desktop-1280.png'), Buffer.from(shotW.result.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const shotM = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(ITEST, 'p22-audit-mobile-390.png'), Buffer.from(shotM.result.data, 'base64'));
  log('screenshots + dom dumped');
} catch (e) {
  log('EXCEPTION: ' + (e && e.stack ? e.stack : e));
  fails++;
} finally {
  try { if (server) server.kill(); } catch (e) {}
  try { if (edge) edge.kill(); } catch (e) {}
  await sleep(600);
  try { fs.rmSync(path.join(ITEST, 'p22-edge-profile'), { recursive: true, force: true }); } catch (e) {}
}
log('FAILS=' + fails);
fs.writeFileSync(path.join(ITEST, 'p22-e2e-out.txt'), out.join('\n'), 'utf8');
process.exit(fails ? 1 : 0);
