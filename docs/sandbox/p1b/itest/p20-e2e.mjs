// p20-e2e.mjs —— 审计页新块 端到端实测（隔离实例 :8793 + DB 快照 + 真浏览器 CDP；8787 零接触）
// 用法: node p20-e2e.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const requireP1a = createRequire('E:/music player/p1a-terminal/package.json');

const ITEST = 'E:/music player/docs/sandbox/p1b/itest';
const P1B = 'E:/music player/p1b';
const PORT = 8793, CDP = 9223, BASE = 'http://127.0.0.1:' + PORT;
const DB = path.join(ITEST, 'p20.db');
const out = [];
const log = (m) => { const l = '[' + new Date().toISOString().slice(11, 19) + '] ' + m; console.log(l); out.push(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, cond, extra) => { const l = (cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined ? ' | ' + String(extra).slice(0, 300) : ''); console.log(l); out.push(l); if (!cond) fails++; };

let server = null, edge = null;
try {
  log('STEP1 snapshot real p1a.db -> p20.db (VACUUM INTO, source read-only)');
  const Database = requireP1a('better-sqlite3');
  const src = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
  for (const f of [DB, DB + '-shm', DB + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
  src.exec("VACUUM INTO '" + DB + "'");
  src.close();
  log('snapshot ok ' + fs.statSync(DB).size + ' bytes');

  log('STEP2 start isolated server PORT=' + PORT);
  server = spawn('node', ['src/server.js'], { cwd: P1B, env: { ...process.env, PORT: String(PORT), P1B_DB_PATH: DB, P1B_LLM_MOCK: '1' }, stdio: ['ignore', fs.openSync(path.join(ITEST, 'p20-server-out.txt'), 'w'), fs.openSync(path.join(ITEST, 'p20-server-err.txt'), 'w')] });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { const r = await fetch(BASE + '/api/health'); if (r.ok) { ready = true; break; } } catch (e) {} }
  check('隔离实例就绪', ready);

  log('STEP3 GET /api/audit/summary over real HTTP');
  const r = await fetch(BASE + '/api/audit/summary');
  const b = await r.json();
  check('HTTP 200', r.status === 200, 'status=' + r.status);
  check('响应含 layer_calibration', Array.isArray(b.layer_calibration), 'type=' + typeof b.layer_calibration);
  check('响应含 pending_forward', Array.isArray(b.pending_forward), 'n=' + (b.pending_forward || []).length);
  check('pending_forward_total=112', b.pending_forward_total === 112, 'got=' + b.pending_forward_total);
  check('pending_forward 截断到 50', b.pending_forward.length === 50, 'got=' + b.pending_forward.length);
  const days = b.pending_forward.map((x) => x.event_day || '9999-99-99');
  const sorted = days.every((d, i) => i === 0 || days[i - 1] <= d);
  check('事件日升序（无日粒度排后）', sorted);
  check('全部为未回填真值的前瞻题', b.pending_forward.every((x) => String(x.statement).includes('【forward】')));
  check('layer_calibration 5 层', b.layer_calibration.length === 5, JSON.stringify(b.layer_calibration.map((x) => [x.layer, x.n, x.resolved, x.brier, x.base_rate])));
  check('Brier 非 null 且 brier_n 有量', b.layer_calibration.every((x) => x.brier === null || (x.brier_n > 0 && x.brier >= 0 && x.brier <= 1)));
  fs.writeFileSync(path.join(ITEST, 'p20-api-summary.json'), JSON.stringify(b, null, 1), 'utf8');

  log('STEP4 launch headless Edge CDP :' + CDP);
  for (const f of [path.join(ITEST, 'p20-edge-profile')]) { try { fs.rmSync(f, { recursive: true, force: true }); } catch (e) {} }
  edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(ITEST, 'p20-edge-profile'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
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
    if (m.result && m.result.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/#/audit' });
  await sleep(4500);
  const text = await evaljs('document.body.innerText');
  const has = (s) => String(text).includes(s);
  check('页面根 audit-page 渲染', (await evaljs("!!document.querySelector('[data-testid=\"audit-page\"]')")) === true);
  check('恒挂定位横幅「万物审计 · 只记不评」', has('万物审计') && has('只记不评'));
  check('新块①：待解前瞻卡存在', (await evaljs("!!document.querySelector('[data-testid=\"audit-forward-card\"]')")) === true);
  check('新块②：分层校准卡存在', (await evaljs("!!document.querySelector('[data-testid=\"audit-layer-calib-card\"]')")) === true);
  const fwdNote = await evaljs("(document.querySelector('[data-testid=\"audit-forward-card\"] .audit-card-note')||{}).textContent");
  check('前瞻卡副标题含「前瞻批次 · 真值未发生」', String(fwdNote).includes('真值未发生') && String(fwdNote).includes('前瞻批次'), fwdNote);
  const fwdRows = await evaljs("document.querySelectorAll('[data-testid=\"audit-forward-table\"] tbody tr').length");
  check('前瞻表有数据行（≤50）', fwdRows > 0 && fwdRows <= 50, 'rows=' + fwdRows);
  check('前瞻表含已知题面（上海/温度）', has('上海') && has('气温'));
  check('前瞻表含到期日 2026-09-14', has('2026-09-14'));
  const calibRows = await evaljs("document.querySelectorAll('[data-testid=\"audit-layer-calib-table\"] tbody tr').length");
  check('分层校准表 5 行', calibRows === 5, 'rows=' + calibRows);
  const calibTxt = await evaljs("document.querySelector('[data-testid=\"audit-layer-calib-card\"]').innerText");
  check('校准卡含 L1/L3/L6 层名', ['L1', 'L3', 'L6'].every((x) => calibTxt.includes(x)));
  check('校准卡显示 Brier 样例（0.211/0.253/0.194）', calibTxt.includes('0.211') && calibTxt.includes('0.253') && calibTxt.includes('0.194'), (calibTxt.match(/0\.\d{3}/g) || []).join(','));
  check('校准卡显示基率百分数', /\d+\.\d%/.test(calibTxt), (calibTxt.match(/\d+\.\d%/g) || []).join(','));
  const banned = ['预测', '预报', '押注', '胜率', '猜'].filter((w) => has(w));
  check('铁律：UI 全文禁「预测」等宣称字样', banned.length === 0, 'hits=' + JSON.stringify(banned));
  fs.writeFileSync(path.join(ITEST, 'p20-audit-dom.txt'), text, 'utf8');
  const shotW = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(ITEST, 'p20-audit-desktop-1280.png'), Buffer.from(shotW.result.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const shotM = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(ITEST, 'p20-audit-mobile-390.png'), Buffer.from(shotM.result.data, 'base64'));
  log('screenshots + dom dumped');
} catch (e) {
  log('EXCEPTION: ' + (e && e.stack ? e.stack : e));
  fails++;
} finally {
  try { if (server) server.kill(); } catch (e) {}
  try { if (edge) edge.kill(); } catch (e) {}
  await sleep(600);
  try { fs.rmSync(path.join(ITEST, 'p20-edge-profile'), { recursive: true, force: true }); } catch (e) {}
}
log('FAILS=' + fails);
fs.writeFileSync(path.join(ITEST, 'p20-e2e-out.txt'), out.join('\n'), 'utf8');
process.exit(fails ? 1 : 0);
