// p5-drive.mjs —— P1b-5 集成实测 CDP 驱动：真浏览器 390x844+移动UA 全链
// （建局改真名→自由文本真实LLM抽取→确认入账→3宏→事件流最新在上→天结算→看卡→历史卡→导出）
// 用法: node p5-drive.mjs <outDir>（前提: 后端 :8787 已起 + chrome CDP :9223 已起）
// 产物: p5-*.png / p5-*.txt / p5-*.json（OUT 目录），本日志由外层重定向到 p5-drive-log.txt
import fs from 'node:fs';
const OUT = process.argv[2] || '.';
const BASE = 'http://127.0.0.1:8787';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
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
  return evaljs("(()=>{const el=" + sel + ";if(!el)return false;(" + SETVAL + ")(" + "el," + JSON.stringify(v) + ");return true})()");
}
const nth = (sel, i) => "(document.querySelectorAll('" + sel + "'))[" + i + "]";
async function api(path, opts) {
  const expr = "(async () => { const r = await fetch('" + path + "', " + JSON.stringify(opts || {}) + "); return JSON.stringify({ status: r.status, body: await r.text() }); })()";
  const parsed = JSON.parse(await evaljs(expr));
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null };
}
async function shot(pngOut, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: mobile ? 2 : 1, mobile: mobile });
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(pngOut, Buffer.from(s.result.data, 'base64'));
  console.log('PNG saved: ' + pngOut.split('\\').pop().split('/').pop() + ' ' + fs.statSync(pngOut).size + 'B');
}
async function nav(hash) { await send('Page.navigate', { url: BASE + '/' + hash }); await sleep(1800); }

// ── S0 移动环境 ──
await send('Emulation.setUserAgentOverride', { userAgent: UA });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await nav('#/games');
const uaGot = await evaljs('navigator.userAgent');
check('S0a 移动 UA 生效（iPhone Safari UA）', uaGot === UA, String(uaGot).slice(0, 80));
check('S0b 视口 390x844（innerWidth/Height）', (await evaljs('window.innerWidth + "x" + window.innerHeight')) === '390x844');
check('S0c 前端可达（对局页头 + 新建局按钮）', (await pageText()).indexOf('＋ 新建局') >= 0);

// ── S1 建局：8人局 + 改2真名（对局页 UI 全程）──
await shot(OUT + '/p5-games-mobile-390.png', 390, 844, true);
await click(btn('＋ 新建局'));
await sleep(500);
await setVal(nth('.sheet input', 0), 'P5集成实测局');
await setVal(nth('.sheet select', 0), 'werewolf');
await setVal(nth('.sheet input[type=number]', 0), '8');
await sleep(300);
await setVal(nth('.sheet .seat-row input', 0), '张三');
await setVal(nth('.sheet .seat-row input', 2), '李四');
await sleep(200);
await click(btn('创建局'));
await sleep(1600);
let txt = await pageText();
const mG = txt.match(/#(\d+) · 狼人杀/);
const gid = mG ? Number(mG[1]) : null;
check('S1a 建局成功（局详情出现，game id=' + gid + '）', gid != null, txt.slice(0, 180));
const s1 = await evaljs("(document.querySelectorAll('.seat-row input'))[0]?.value ?? null");
const s3 = await evaljs("(document.querySelectorAll('.seat-row input'))[2]?.value ?? null");
check('S1b 真名入库并回显（1号=张三 3号=李四）', s1 === '张三' && s3 === '李四', '1号=' + s1 + ' 3号=' + s3);
check('S1c 其余席位默认（2号=2号）', (await evaljs("(document.querySelectorAll('.seat-row input'))[1]?.value ?? null")) === '2号');
// ── S2 录入页：切换到实测局 → 顶部条 → 自由文本真实 LLM 抽取 → 确认入账 ──
await nav('#/input');
await click(btn('切换/建局'));
await sleep(600);
const pickBtn = "[...document.querySelectorAll('.sheet button')].find(b=>b.textContent.indexOf('" + "P5集成实测局" + "')>=0)";
check('S2-预检 选局表单列出实测局', await evaljs(pickBtn + " ? true : false"));
await evaljs("(()=>{const b=" + pickBtn + "; if(b)b.click(); return !!b})()");
await sleep(1200);
txt = await pageText();
check('S2a 顶部条=局名+第1天+存活8/8', txt.indexOf('P5集成实测局') >= 0 && txt.indexOf('第 1 天') >= 0 && txt.indexOf('存活 8/8') >= 0, txt.slice(0, 200));
check('S2b 名单横条真名渲染（1号·张三 3号·李四）', txt.indexOf('1号·张三') >= 0 && txt.indexOf('3号·李四') >= 0);
await shot(OUT + '/p5-entry-mobile-390.png', 390, 844, true);
await setVal(nth('.input-main textarea', 0), '3号说自己是预言家，说5号是查杀');
await click(btn('AI 拆解'));
console.log('S2c 已提交自由文本，等待真实 LLM 抽取（轮询 .confirm-sheet，上限 150s）…');
let cardShown = false, waited = 0;
for (let i = 0; i < 50; i++) {
  await sleep(3000); waited += 3;
  if (await evaljs("!!document.querySelector('.confirm-sheet')")) { cardShown = true; break; }
  if (i % 5 === 4) console.log('S2c 等待中 ' + waited + 's…');
}
check('S2c 真实 LLM 抽取返回待确认卡（' + waited + 's）', cardShown);
txt = await pageText();
const mockBadge = txt.indexOf('MOCK') >= 0;
const aiBadge = txt.indexOf('AI 抽取') >= 0;
check('S2d 抽取卡为真实 LLM（有 AI 抽取徽标、无 MOCK 徽标）', cardShown && aiBadge && !mockBadge, 'ai=' + aiBadge + ' mock=' + mockBadge);
await click(btn('确认入账'));
await sleep(1200);
txt = await pageText();
check('S2e 自由文本入账（raw 原文 + 声称入时间线）', txt.indexOf('3号说自己是预言家，说5号是查杀') >= 0 && txt.indexOf('已入账') >= 0, txt.slice(0, 260));

// ── S3 3 宏各一条（宏表单 → 确认卡 → 入账，全程 UI）──
async function macro(kind, seat, extraSel, extraVal, expectText) {
  await click(btn(kind));
  await sleep(450);
  await setVal(nth('.sheet select', 0), String(seat));
  if (extraSel != null) await setVal(extraSel, extraVal);
  await click(btn('出确认卡'));
  await sleep(500);
  const okCard = await evaljs("!!document.querySelector('.confirm-sheet')");
  await click(btn('确认入账'));
  await sleep(1200);
  const t2 = await pageText();
  return check('S3 宏[' + kind + '] ' + seat + '号 入账（' + expectText + '）', okCard && t2.indexOf(expectText) >= 0, 'card=' + okCard + ' | ' + t2.slice(0, 160));
}
await macro('跳身份', 2, nth('.sheet input', 0), '预言家', '预言家');
await macro('查杀', 6, nth('.sheet select', 1), '7', '查杀');
await macro('金水', 2, nth('.sheet select', 1), '3', '好人');

// ── S4 事件流最新在上 ──
const claims = await evaljs("[...document.querySelectorAll('.tl-claim')].map(x=>x.textContent.slice(0,50))");
console.log('S4 时间线 claim 顺序: ' + JSON.stringify(claims));
check('S4a 最新在上（首条=最后录入的金水）', claims.length > 0 && claims[0].indexOf('好人') >= 0, JSON.stringify(claims.slice(0, 2)));
check('S4b 时序（金水索引 < 跳身份索引）', claims.findIndex(c => c.indexOf('好人') >= 0) < claims.findIndex(c => c.indexOf('预言家') >= 0));
// ── S5 天结算 → 异步任务 → 轮询（真实 LLM；504/failed 走存档卡回退并如实注明）──
await nav('#/advisor');
const selG = "document.querySelector('.adv-toolbar select')";
await evaljs("(()=>{const s=" + selG + "; if(!s) return false; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'" + gid + "'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
await sleep(1500);
txt = await pageText();
check('S5-预检 参谋卡页选中实测局', txt.indexOf('P5集成实测局') >= 0, txt.slice(0, 160));
const en = await evaljs("(()=>{const b=" + btn('天结算') + "; return b ? !b.disabled : null})()");
check('S5-预检 天结算按钮可用', en === true, 'enabled=' + en);
await click(btn('天结算'));
await sleep(1500);
txt = await pageText();
check('S5a 提交后生成中横幅', txt.indexOf('参谋卡生成中') >= 0, txt.slice(0, 200));
const lsT = await evaljs("localStorage.getItem('p1b.advisor.runningTask') || ''");
let taskId = null; try { taskId = JSON.parse(lsT).id || null; } catch (e) {}
check('S5b 202 任务 id 落 localStorage', taskId != null, lsT.slice(0, 100));
let st = 'unknown', pollLog = [], polls = 0;
for (let i = 0; i < 170; i++) {
  await sleep(3000); polls++;
  const r = await api('/api/tasks/' + taskId).catch(() => ({ body: { status: 'http-err' } }));
  st = (r.body && r.body.status) || 'unknown';
  if (pollLog[pollLog.length - 1] !== st) pollLog.push(st);
  if (st === 'done' || st === 'failed') break;
  if (i === 20 || i === 40 || i === 80) console.log('S5c 轮询中 ' + (i * 3) + 's 状态=' + st);
}
console.log('S5c 轮询 ' + polls + ' 次（3s 间隔）状态迁移: ' + pollLog.join(' -> '));
const finalTask = await api('/api/tasks/' + taskId).catch(() => ({ body: null }));
fs.writeFileSync(OUT + '/p5-advise-task-final.json', JSON.stringify(finalTask.body, null, 2), 'utf8');
const advFailed = st !== 'done';
if (advFailed) {
  const em = finalTask.body && finalTask.body.error ? String(finalTask.body.error).slice(0, 200) : '(无 error 字段)';
  console.log('FALLBACK 注明: 天结算任务 failed（' + em + '）→ 按任务书改用已存档历史卡完成「看卡」验证（不造假）');
} else {
  console.log('S5d 真实 LLM 参谋卡生成成功: 耗时 ' + (finalTask.body.finished_at && finalTask.body.created_at ? Math.round((new Date(finalTask.body.finished_at) - new Date(finalTask.body.created_at)) / 1000) + 's' : '?'));
}

// ── S6 看卡：渲染三要素（色标/双栏/验证点）——优先本局新卡，失败则 game1 服务端存档卡 ──
await evaljs("location.reload(); void 0");
await sleep(2500);
if (advFailed) {
  await evaljs("(()=>{const s=" + selG + "; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'1'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
  await sleep(1500);
  await click(btn('第1天'));
  await sleep(1200);
  console.log('S6-注明 以下看卡验证对象 = game1 服务端存档历史卡（非本轮新卡）');
}
txt = await pageText();
check('S6a 卡头（参谋卡 · 思路非答案）', txt.indexOf('参谋卡 · 思路非答案') >= 0);
check('S6b 矛盾区 + 欠定度色标图例', txt.indexOf('矛盾点') >= 0 && txt.indexOf('欠定度色标') >= 0, txt.slice(0, 300));
check('S6c 竞争假设区', txt.indexOf('竞争假设') >= 0);
check('S6d 验证点区渲染', txt.indexOf('验证点') >= 0, '（服务端存档卡=（无验证点）属正常语义）');
const hasHigh = txt.indexOf('高欠定度') >= 0, hasMid = txt.indexOf('中欠定度') >= 0;
console.log('S6e 色标实际出现: high=' + hasHigh + ' mid=' + hasMid);
const geo = await evaljs("(()=>{const cards=[...document.querySelectorAll('.hyp-card')]; if(cards.length<2) return null; const g=cards[0].getBoundingClientRect(), h=cards[1].getBoundingClientRect(); return {n:cards.length, top0:Math.round(g.top), top1:Math.round(h.top), left0:Math.round(g.left), left1:Math.round(h.left), cols:getComputedStyle(document.querySelector('.hyp-grid')).gridTemplateColumns};})()");
check('S6f 假设区双栏对峙（390px 两卡并排）', geo && Math.abs(geo.top0 - geo.top1) <= 2 && geo.left0 < geo.left1, JSON.stringify(geo));
await shot(OUT + '/p5-card-mobile-390.png', 390, 844, true);
fs.writeFileSync(OUT + '/p5-card.txt', txt, 'utf8');
// ── S6g 验证点 checklist 交互（仅当卡面有 .cp-item：本轮新卡或 localStorage 兜底卡）──
const hasCp = await evaljs("!!document.querySelector('.cp-item')");
if (hasCp) {
  await evaljs("(()=>{const c=document.querySelector('.cp-item input[type=checkbox]'); if(c)c.click(); return !!c})()");
  await sleep(400);
  const cp = await evaljs("(()=>{const it=document.querySelector('.cp-item'); return {done: it.classList.contains('done'), ls: localStorage.getItem('p1b.advisor.checks.v1')||''};})()");
  check('S6g 勾选验证点生效+本机持久化', cp.done === true && cp.ls.length > 0, JSON.stringify(cp).slice(0, 140));
} else {
  console.log('S6g-注明 当前卡面无 .cp-item（服务端存档卡验证点不入库为既定语义，见 S6d）——验证点交互在历史 localStorage 卡上另行验证');
  const ks = await evaljs("JSON.parse(localStorage.getItem('p1b.advisor.cards.v1')||'{}') && Object.keys(JSON.parse(localStorage.getItem('p1b.advisor.cards.v1')||'{}'))");
  console.log('S6g localStorage 兜底卡键: ' + JSON.stringify(ks));
  let done2 = false;
  for (const k of (ks || [])) {
    const g2 = k.split(':')[0];
    await evaljs("(()=>{const s=" + selG + "; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'" + g2 + "'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
    await sleep(1400);
    const chips = await evaljs("[...document.querySelectorAll('button.chip')].map(x=>x.textContent)");
    if (!(chips || []).length) continue;
    await evaljs("(()=>{const b=document.querySelector('button.chip'); if(b)b.click(); return !!b})()");
    await sleep(1100);
    if (await evaljs("!!document.querySelector('.cp-item')")) {
      await evaljs("(()=>{const c=document.querySelector('.cp-item input[type=checkbox]'); if(c)c.click(); return !!c})()");
      await sleep(400);
      const cp = await evaljs("(()=>{const it=document.querySelector('.cp-item'); return {done: it.classList.contains('done'), ls: localStorage.getItem('p1b.advisor.checks.v1')||''};})()");
      done2 = check('S6g 勾选验证点生效+本机持久化（localStorage 兜底卡 game' + g2 + '）', cp.done === true, JSON.stringify(cp).slice(0, 140));
      break;
    }
  }
  if (!done2) console.log('S6g-注明 无含验证点的兜底卡可用，验证点交互未覆盖（如实记录）');
}

// ── S7 历史卡回看（切走再切回，chip 重开）──
await nav('#/games');
await sleep(800);
await nav('#/advisor');
await sleep(1800);
txt = await pageText();
const chipIdx = txt.indexOf('第1天');
check('S7a 存档 chip 列出（第1天 在历史区）', chipIdx >= 0, txt.slice(0, 200));
if (chipIdx >= 0) {
  await click(btn('第1天'));
  await sleep(1200);
  txt = await pageText();
  check('S7b 历史卡重开（卡头重现）', txt.indexOf('参谋卡 · 思路非答案') >= 0);
}
await shot(OUT + '/p5-advisor-archive-mobile-390.png', 390, 844, true);

// ── S8 导出 JSON（UI 触发 + 同源取内容落盘比对）──
await nav('#/games');
await sleep(1000);
await evaljs("(()=>{const li=[...document.querySelectorAll('.game-item')].find(x=>x.textContent.indexOf('#" + gid + " ')>=0); const b=li&&(li.querySelector('button.btn')||li.querySelector('button')); if(b)b.click(); return !!li})()");
await sleep(1200);
await click(btn('导出 JSON'));
await sleep(1000);
txt = await pageText();
check('S8a UI 导出触发（toast 已导出 p1b-game-' + gid + '.json）', txt.indexOf('已导出 p1b-game-' + gid + '.json') >= 0, txt.slice(0, 200));
const exp = await api('/api/games/' + gid + '/export');
fs.writeFileSync(OUT + '/p5-export-game-' + gid + '.json', JSON.stringify(exp.body, null, 2), 'utf8');
check('S8b 导出内容（game_id=' + gid + '，事件≥4）', exp.status === 200 && exp.body.meta.game_id === gid && exp.body.meta.counts.events >= 4, JSON.stringify(exp.body.meta));

// ── S9 桌面 1280 档截图（关键页响应式对照）──
await shot(OUT + '/p5-games-desktop-1280.png', 1280, 900, false);
await nav('#/input');
await sleep(1000);
await shot(OUT + '/p5-entry-desktop-1280.png', 1280, 900, false);
await nav('#/advisor');
await sleep(1500);
await shot(OUT + '/p5-card-desktop-1280.png', 1280, 900, false);

console.log('P5-DRIVE RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED') + (advFailed ? '（其中看卡走存档卡回退，见 FALLBACK 注明）' : ''));
process.exit(fails === 0 ? 0 : 1);
