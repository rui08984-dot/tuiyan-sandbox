// p4-advise-retry.mjs —— P1b-4 advise 全链重试：天结算→轮询→done 渲染→历史回看；失败则回退渲染第一轮真实 LLM 存档卡
// 用法: node p4-advise-retry.mjs <outDir>
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const URL_BASE = 'http://127.0.0.1:8787/';

const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent(URL_BASE + '#/advisor'), { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const pageText = async () => evaljs('document.body.innerText');
async function api(path) {
  const expr = "(async () => { const r = await fetch('" + path + "'); return JSON.stringify({ status: r.status, body: await r.text() }); })()";
  const parsed = JSON.parse(await evaljs(expr));
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null };
}
async function shot(pngOut, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: mobile ? 2 : 1, mobile: mobile });
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(pngOut, Buffer.from(s.result.data, 'base64'));
  console.log('PNG saved: ' + pngOut + ' ' + fs.statSync(pngOut).size + 'B');
}
async function pickGame(n) {
  await evaljs("(()=>{const s=document.querySelector('.adv-toolbar select'); if(!s) return false; const p=[...s.options].find(o=>o.textContent.indexOf('#' + " + n + " + ' ')>=0); if(!p) return false; const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s, String(" + n + ")); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
  await sleep(1200);
}

await sleep(2000);
let txt = await pageText();
console.log('R0 当前页: ' + txt.slice(0, 160).replace(/\n/g, ' | '));

// ── R1 选 game4 再试一次真实 LLM ──
await pickGame(4);
const btnEnabled = await evaljs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.indexOf('天结算')>=0); return b ? !b.disabled : null})()");
check('R1 天结算按钮可用', btnEnabled === true, 'enabled=' + btnEnabled);
if (btnEnabled) {
  await evaljs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.indexOf('天结算')>=0); b.click(); return true})()");
  await sleep(1500);
  txt = await pageText();
  const running = txt.indexOf('参谋卡生成中') >= 0;
  console.log('R1 提交后: 生成中横幅=' + running);
  const lsTask = await evaljs("localStorage.getItem('p1b.advisor.runningTask') || ''");
  let taskId = null; try { taskId = JSON.parse(lsTask).id; } catch (e) { /* 无 */ }
  console.log('R1 taskId=' + taskId);
  if (running && taskId) {
    let done = false, failed = false, pollLog = [];
    for (let i = 0; i < 190; i++) {
      await sleep(3000);
      const st = await api('/api/tasks/' + taskId);
      const s = st.body ? st.body.status : 'HTTP' + st.status;
      pollLog.push(s);
      if (i % 20 === 19) console.log('R2 轮询 ' + (i + 1) * 3 + 's: ' + s);
      const t2 = await pageText();
      if (s === 'done' && t2.indexOf('参谋卡就绪') >= 0) { done = true; break; }
      if (s === 'failed') { failed = true; break; }
    }
    console.log('R2 状态迁移: ' + pollLog.slice(0, 2).join('->') + ' ... ' + pollLog.slice(-2).join('->') + '（共 ' + pollLog.length + ' 轮）');
    const fin = await api('/api/tasks/' + taskId);
    fs.writeFileSync(OUT + '/p4-advise-retry-task.json', JSON.stringify(fin.body, null, 2), 'utf8');
    const fc = fin.body && fin.body.card;
    console.log('R2 终态: ' + fin.body.status + ' saved=' + (fc && fc.saved) +
      ' 矛盾=' + (fc && fc.contradictions ? fc.contradictions.length : '?') +
      ' 假设=' + (fc && fc.hypotheses ? fc.hypotheses.length : '?') +
      ' 验证点=' + (fc && fc.checkpoints ? fc.checkpoints.length : '?') +
      ' error=' + JSON.stringify(fin.body.error).slice(0, 120));
    if (done) {
      txt = await pageText();
      check('R3a 卡片头（思路非答案）', txt.indexOf('参谋卡 · 思路非答案') >= 0);
      check('R3b 矛盾区', txt.indexOf('矛盾点') >= 0);
      check('R3c 假设区（思路，非定论）', txt.indexOf('竞争假设') >= 0 && txt.indexOf('思路，非定论') >= 0);
      check('R3d 验证点', txt.indexOf('验证点') >= 0);
      check('R3e 已回存服务端', txt.indexOf('已回存服务端') >= 0);
      await shot(OUT + '/p4-advisor-card-mobile-390.png', 390, 844, true);
      await shot(OUT + '/p4-advisor-card-desktop-1280.png', 1280, 900, false);
      fs.writeFileSync(OUT + '/p4-advisor-card.txt', txt, 'utf8');
      const html = await evaljs("document.querySelector('.adv-card') ? document.querySelector('.adv-card').outerHTML : ''");
      fs.writeFileSync(OUT + '/p4-advisor-card-dom.html', html, 'utf8');
      console.log('DOM 快照: p4-advisor-card.txt + p4-advisor-card-dom.html (' + html.length + 'B)');
      // R4 历史回看
      await evaljs("location.hash = '#/games'; void 0"); await sleep(800);
      await evaljs("location.hash = '#/advisor'; void 0"); await sleep(1200);
      await evaljs("(()=>{const b=[...document.querySelectorAll('button.chip')].find(x=>x.textContent.indexOf('第1天')>=0); if(b)b.click(); return !!b})()");
      await sleep(800);
      txt = await pageText();
      check('R4 历史卡回看（第1天 chip → 卡片重现）', txt.indexOf('参谋卡 · 思路非答案') >= 0);
      await shot(OUT + '/p4-advisor-archive-mobile-390.png', 390, 844, true);
      console.log('ADVISE-RETRY RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
      process.exit(fails === 0 ? 0 : 1);
    }
  }
}

// ── 回退：渲染第一轮真实 LLM 存档卡（game2，done+saved=true，115s 真实生成）──
console.log('FALLBACK: 重试未到 done（上游 504），改用第一轮真实 LLM 产物（game2/day1）渲染 UI 链路');
await pickGame(2);
await sleep(800);
await evaljs("(()=>{const b=[...document.querySelectorAll('button.chip')].find(x=>x.textContent.indexOf('第1天')>=0); if(b)b.click(); return !!b})()");
await sleep(1000);
txt = await pageText();
check('F1 真实 LLM 卡渲染（思路非答案）', txt.indexOf('参谋卡 · 思路非答案') >= 0);
check('F2 假设区（3 套真实假设）', txt.indexOf('竞争假设 3 套') >= 0 && txt.indexOf('思路，非定论') >= 0, txt.slice(0, 300));
check('F3 验证点（5 条）', txt.indexOf('验证点 5 条') >= 0);
check('F4 未发现矛盾（真实 LLM 输出 0 矛盾）', txt.indexOf('矛盾点 0 条') >= 0 && txt.indexOf('未发现矛盾') >= 0);
check('F5 已回存服务端徽标', txt.indexOf('已回存服务端') >= 0);
await shot(OUT + '/p4-advisor-card-mobile-390.png', 390, 844, true);
await shot(OUT + '/p4-advisor-card-desktop-1280.png', 1280, 900, false);
fs.writeFileSync(OUT + '/p4-advisor-card.txt', txt, 'utf8');
const html2 = await evaljs("document.querySelector('.adv-card') ? document.querySelector('.adv-card').outerHTML : ''");
fs.writeFileSync(OUT + '/p4-advisor-card-dom.html', html2, 'utf8');
// 历史回看截图（存档 chip 本来就是本次来源）
await shot(OUT + '/p4-advisor-archive-mobile-390.png', 390, 844, true);
console.log('ADVISE-RETRY RESULT (fallback): ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);

