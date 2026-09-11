// p5pre-drive.mjs —— 平迁补丁验收 CDP 驱动：
//   ①UI 改名→PUT /seats 落库→另一端（脚本直连 GET）可见新名=同库可见性
//   ②新建局带真名→POST+PUT /seats→服务端 GET 回读为真名（服务端即真相源）
//   ③服务端卡存档回看渲染（game1：矛盾+证据天 chips；game2：0 矛盾路径）
// 用法: node p5pre-drive.mjs <outDir>（前提: 后端 :8787 已起 + CDP :9223 已起）
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const URL_BASE = 'http://127.0.0.1:8787/';

const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent(URL_BASE + '#/games'), { method: 'PUT' })).json();
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
const btn = (s) => "[...document.querySelectorAll('button')].find(b=>b.textContent.includes(" + JSON.stringify(s) + "))";
const SETVAL = "(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}";
const pageText = async () => evaljs('document.body.innerText');
const click = async (s) => evaljs("(()=>{const b=" + s + ";if(!b)return false;b.click();return true})()");
async function setVal(sel, v) {
  return evaljs("(()=>{const el=" + sel + ";if(!el)return false;(" + SETVAL + ")(el," + JSON.stringify(v) + ");return true})()");
}
const nth = (sel, i) => "(document.querySelectorAll('" + sel + "'))[" + i + "]";
const inputVal = (i) => "(document.querySelectorAll('.seat-row input'))[" + i + "] ? document.querySelectorAll('.seat-row input')[" + i + "].value : null";
async function shot(pngOut, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: mobile ? 2 : 1, mobile: mobile });
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(pngOut, Buffer.from(s.result.data, 'base64'));
  console.log('PNG saved: ' + pngOut + ' ' + fs.statSync(pngOut).size + 'B');
}
async function openGameDetail(num) {
  const ok = await evaljs("(()=>{const li=[...document.querySelectorAll('.game-item')].find(x=>x.textContent.indexOf('#" + num + " ')>=0); if(!li) return false; const b=li.querySelector('button.btn')||li.querySelector('button'); if(!b) return false; b.click(); return true})()");
  await sleep(1300);
  return ok;
}

// ── S1 改名：game2 座位4 → 王五（UI 乐观+防抖 PUT /seats）──
await shot(OUT + '/p5pre-games-mobile-390.png', 390, 844, true);
await openGameDetail(2);
const before4 = await evaljs(inputVal(3));
check('S1a game2 详情打开（座位4原名=' + before4 + '）', before4 === '4号', 'v=' + before4);
await setVal(nth('.seat-row input', 3), '王五');
await sleep(1400); // 0.5s 防抖 + PUT 往返
const after4 = await evaljs(inputVal(3));
check('S1b UI 显示新名（座位4=王五）', after4 === '王五', 'v=' + after4);
const mirror = await evaljs("localStorage.getItem('p1b.seatNames.v1') || ''");
check('S1c 离线镜像缓存已同步（2:4=王五）', mirror.indexOf('"4":"王五"') >= 0, mirror.slice(0, 120));

// ── S2 另一端 GET（脚本直连，非页面会话）= 同库可见性 ──
const fresh = await fetch(URL_BASE + 'api/games/2').then((r) => r.json());
const p4name = (fresh.players || []).find((p) => p.seat === 4);
check('S2a 另一端 GET /api/games/2 可见新名（players[seat=4].name=王五）', p4name && p4name.name === '王五', JSON.stringify(fresh.players));
fs.writeFileSync(OUT + '/p5pre-seats-visibility.json', JSON.stringify({ when: new Date().toISOString(), game: 2, seat: 4, expect: '王五', got: p4name ? p4name.name : null, players: fresh.players }, null, 2), 'utf8');
console.log('S2b 摘录落盘: p5pre-seats-visibility.json');

// ── S3 新建局带真名（POST 建局 + PUT /seats 落库）→ 服务端 GET 回读 ──
await click(btn('＋ 新建局'));
await sleep(500);
await setVal(nth('.sheet input', 0), 'P5pre平迁局');
await setVal(nth('.sheet input[type=number]', 0), '6');
await sleep(300);
await setVal(nth('.sheet .seat-row input', 0), '张三');
await setVal(nth('.sheet .seat-row input', 2), '李四');
await click(btn('创建局'));
await sleep(1600);
let txt = await pageText();
const mNew = txt.match(/#(\d+) · 狼人杀/);
const newGid = mNew ? Number(mNew[1]) : null;
check('S3a 建局成功（解析 id=' + newGid + '）', newGid != null, txt.slice(0, 180));
const s1v = await evaljs(inputVal(0));
const s3v = await evaljs(inputVal(2));
check('S3b 详情显示真名（1号=张三 3号=李四，来源=服务端 GET）', s1v === '张三' && s3v === '李四', '1号=' + s1v + ' 3号=' + s3v);
const freshNew = await fetch(URL_BASE + 'api/games/' + newGid).then((r) => r.json());
const namesNew = (freshNew.players || []).map((p) => p.seat + '=' + p.name).join(' ');
check('S3c 另一端 GET 回读真名（张三/李四在库）', namesNew.indexOf('1=张三') >= 0 && namesNew.indexOf('3=李四') >= 0, namesNew);
fs.writeFileSync(OUT + '/p5pre-newgame-seats.json', JSON.stringify({ when: new Date().toISOString(), game: newGid, players: freshNew.players }, null, 2), 'utf8');

// ── S4 服务端卡回看：game1（3 矛盾带证据天 + 7 假设）──
await click(btn('🧠 去参谋卡'));
await sleep(1800);
await evaljs("(()=>{const s=document.querySelector('.adv-toolbar select'); if(!s) return false; const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s, '1'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
await sleep(1800);
txt = await pageText();
check('S4a 历史区=服务端存档口径', txt.indexOf('服务端存档 · 按天') >= 0, txt.slice(0, 200));
check('S4b 服务端 chip 出现（第1天 · 7假设）', txt.indexOf('第1天 · 7假设') >= 0);
await click(btn('第1天'));
await sleep(1300);
txt = await pageText();
check('S4c 卡面=服务端存档（截至该天）', txt.indexOf('服务端存档（截至该天）') >= 0);
check('S4d 矛盾区（3 条，证据天 d1 chips）', txt.indexOf('矛盾点 3 条') >= 0 && txt.indexOf('证据天 d1') >= 0, txt.slice(0, 300));
check('S4e 假设区（7 套）', txt.indexOf('竞争假设 7 套') >= 0);
check('S4f 验证点不入库提示（（无验证点））', txt.indexOf('（无验证点）') >= 0);
await shot(OUT + '/p5pre-advisor-servercard-mobile-390.png', 390, 844, true);
await shot(OUT + '/p5pre-advisor-servercard-desktop-1280.png', 1280, 900, false);
fs.writeFileSync(OUT + '/p5pre-advisor-servercard.txt', txt, 'utf8');
const html = await evaljs("document.querySelector('.adv-card') ? document.querySelector('.adv-card').outerHTML : ''");
fs.writeFileSync(OUT + '/p5pre-advisor-servercard-dom.html', html, 'utf8');
console.log('S4g 快照: txt+dom(' + html.length + 'B)+2 图');

// ── S5 服务端卡回看：game2（0 矛盾路径）──
await evaljs("(()=>{const s=document.querySelector('.adv-toolbar select'); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s, '2'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
await sleep(1600);
await click(btn('第1天'));
await sleep(1200);
txt = await pageText();
check('S5a game2 服务端卡（未发现矛盾 + 3 假设 + 无验证点）', txt.indexOf('未发现矛盾') >= 0 && txt.indexOf('竞争假设 3 套') >= 0 && txt.indexOf('（无验证点）') >= 0, txt.slice(0, 300));
const cardsJson = await fetch(URL_BASE + 'api/games/1/cards').then((r) => r.json());
fs.writeFileSync(OUT + '/p5pre-cards-game1.json', JSON.stringify(cardsJson, null, 2), 'utf8');
console.log('S5b game1 /cards 摘录落盘: p5pre-cards-game1.json（evidence_day 字段在列）');

console.log('P5PRE-DRIVE RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);

