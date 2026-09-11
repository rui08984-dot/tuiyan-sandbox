// p4-drive.mjs —— P1b-4 验收 CDP 驱动：建局(改真名)→列表标记→天数推进→宏录事件→天结算(真实LLM)→轮询→卡片渲染→历史回看→导出
// 用法: node p4-drive.mjs <outDir>   （前提: 后端 :8787 已起 + chrome --remote-debugging-port=9223 已起）
// 产物（p4- 前缀）: 截图 + DOM 文本快照 + 导出 JSON + 控制台检查日志
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
  return m.result ? m.result.result ? m.result.result.value : undefined : undefined;
}
const btn = (s) => "[...document.querySelectorAll('button')].find(b=>b.textContent.includes(" + JSON.stringify(s) + "))";
const SETVAL = "(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}";
const pageText = async () => evaljs('document.body.innerText');
const click = async (s) => evaljs("(()=>{const b=" + s + ";if(!b)return false;b.click();return true})()");
async function setVal(sel, v) {
  return evaljs("(()=>{const el=" + sel + ";if(!el)return false;(" + SETVAL + ")(el," + JSON.stringify(v) + ");return true})()");
}
const nth = (sel, i) => "(document.querySelectorAll('" + sel + "'))[" + i + "]";
async function api(path, opts) {
  const expr = "(async () => { const r = await fetch('" + path + "', " + JSON.stringify(opts || {}) +
    "); return JSON.stringify({ status: r.status, body: await r.text() }); })()";
  const r = await evaljs(expr);
  const parsed = JSON.parse(r);
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null };
}
async function shot(pngOut, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: mobile ? 2 : 1, mobile: mobile });
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(pngOut, Buffer.from(s.result.data, 'base64'));
  console.log('PNG saved: ' + pngOut + ' ' + fs.statSync(pngOut).size + 'B');
}

// ── S1 打开对局页（手机竖屏 390x844）──
await shot(OUT + '/p4-games-mobile-390.png', 390, 844, true);
let txt = await pageText();
check('S1 对局页渲染（页头+新建局按钮）', txt.indexOf('对局') >= 0 && txt.indexOf('＋ 新建局') >= 0, txt.slice(0, 120));

// ── S2 新建 8 人局，改 2 个真名（张三/李四）──
await click(btn('＋ 新建局'));
await sleep(500);
await setVal(nth('.sheet input', 0), 'P4验收·狼人杀8人');
await setVal(nth('.sheet select', 0), 'werewolf');
await setVal(nth('.sheet input[type=number]', 0), '8');
await sleep(300);
await setVal(nth('.sheet .seat-row input', 0), '张三');
await setVal(nth('.sheet .seat-row input', 2), '李四');
await sleep(200);
await click(btn('创建局'));
await sleep(1200);
txt = await pageText();
check('S2a 建局成功（局名+8席就位）', txt.indexOf('P4验收·狼人杀8人') >= 0 && txt.indexOf('8 席') >= 0, txt.slice(0, 200));
const mGid = txt.match(/#(\d+) · 狼人杀/);
const gid = mGid ? Number(mGid[1]) : null;
check('S2b 局详情出现（解析出 game id）', gid != null, 'txt=' + txt.slice(0, 160));
const seat1 = await evaljs("(document.querySelectorAll('.seat-row input'))[0] ? document.querySelectorAll('.seat-row input')[0].value : null");
const seat3 = await evaljs("(document.querySelectorAll('.seat-row input'))[2] ? document.querySelectorAll('.seat-row input')[2].value : null");
check('S2c 座位真名生效（1号=张三 3号=李四）', seat1 === '张三' && seat3 === '李四', '1号=' + seat1 + ' 3号=' + seat3);
const seat2 = await evaljs("(document.querySelectorAll('.seat-row input'))[1] ? document.querySelectorAll('.seat-row input')[1].value : null");
check('S2d 未改名席位保持默认（2号=2号）', seat2 === '2号', '2号=' + seat2);

// ── S3 宏录 3 条事件（走录入页同一服务端链路：macro→confirm，确定性不走 LLM）──
async function seedMacro(kind, payload) {
  const card = await api('/api/games/' + gid + '/events/macro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ kind: kind, day: 1 }, payload)) });
  if (card.status !== 200) throw new Error('macro ' + kind + ' -> ' + card.status + ' ' + JSON.stringify(card.body));
  const cf = await api('/api/games/' + gid + '/events/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card.body) });
  if (cf.status !== 201) throw new Error('confirm ' + kind + ' -> ' + cf.status + ' ' + JSON.stringify(cf.body));
  return cf.body;
}
const s1 = await seedMacro('claim_role', { seat: 2, role: '预言家' });
const s2 = await seedMacro('check', { seat: 3, target_seat: 5 });
const s3 = await seedMacro('good', { seat: 1, target_seat: 4 });
console.log('S3 事件入账: e' + s1.event_id + '/e' + s2.event_id + '/e' + s3.event_id + '（claim ' + (s1.claim_ids.length + s2.claim_ids.length + s3.claim_ids.length) + ' 条）');

// ── S4 局列表标记（进行中 · 第1天）+ 天数推进器 ──
await evaljs("location.hash = '#/games'; location.reload(); void 0");
await sleep(2200);
txt = await pageText();
check('S4a 列表标记进行中（进行中 · 第1天）', txt.indexOf('进行中 · 第1天') >= 0, txt.slice(0, 260));
check('S4b 列表含事件计数（3 事件）', txt.indexOf('3 事件') >= 0);
await click(btn('详情'));
await sleep(1000);
txt = await pageText();
check('S4c 详情默认推进到当前天（第 1 天）', txt.indexOf('第 1 天') >= 0 && txt.indexOf('服务端最新事件天 1') >= 0, txt.slice(0, 260));
check('S4d 账本摘要（截至第 1 天：事件 3 条）', txt.indexOf('事件 3 条') >= 0);
const clickedNext = await evaljs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='后一天'); if(!b) return false; b.click(); return true})()");
check('S4e-点击 后一天 成功', clickedNext === true, 'clicked=' + clickedNext);
await sleep(900);
txt = await pageText();
check('S4f 推进到第 2 天（允许预看/预结）', txt.indexOf('第 2 天') >= 0, txt.slice(0, 300));
await evaljs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='前一天'); if(b)b.click(); return !!b})()");
await sleep(700);

// ── S5 导出 JSON（UI 触发下载 + 页内取同源内容存档比对）──
await click(btn('导出 JSON'));
await sleep(900);
txt = await pageText();
check('S5a 导出触发（toast 提示已导出 p1b-game-' + gid + '.json）', txt.indexOf('已导出 p1b-game-' + gid + '.json') >= 0, txt.slice(0, 200));
const exp = await api('/api/games/' + gid + '/export');
fs.writeFileSync(OUT + '/p4-export-game-' + gid + '.json', JSON.stringify(exp.body, null, 2), 'utf8');
check('S5b 导出内容（meta.game_id=' + gid + ' + counts.events=3）', exp.status === 200 && exp.body.meta.game_id === gid && exp.body.meta.counts.events === 3, JSON.stringify(exp.body.meta));

// ── S6 进参谋卡页（真名名单跨页生效）──
await click(btn('去参谋卡'));
await sleep(2000);
txt = await pageText();
check('S6a 参谋卡页（对局下拉默认选中 P4 验收局）', txt.indexOf('P4验收·狼人杀8人') >= 0, txt.slice(0, 220));
check('S6b 名单真名跨页生效（1号·张三 3号·李四）', txt.indexOf('1号·张三') >= 0 && txt.indexOf('3号·李四') >= 0, txt.slice(0, 300));

// ── S7 天结算 → 202 异步 → 生成中横幅 ──
const btnEnabled = await evaljs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.indexOf('天结算')>=0); return b ? !b.disabled : null})()");
check('S7-预检 天结算按钮可用（无残留任务占用）', btnEnabled === true, 'enabled=' + btnEnabled);
await click(btn('天结算'));
await sleep(1500);
txt = await pageText();
check('S7a 提交成功（参谋卡生成中… 横幅出现）', txt.indexOf('参谋卡生成中') >= 0, txt.slice(0, 220));
const lsTask = await evaljs("localStorage.getItem('p1b.advisor.runningTask') || ''");
let taskId = null;
try { taskId = JSON.parse(lsTask).id || null; } catch (e) { taskId = null; }
console.log('S7b taskId=' + taskId + '（真实 LLM：tokenrhythm/glm-5.3-flash，约 2-3 分钟）');
check('S7c 202 返回任务 id（LS 在跑任务已落）', taskId != null, 'ls=' + lsTask.slice(0, 120));

// ── S8 轮询到 done（3s 间隔，上限 8 分钟）──
let done = false, polls = 0, pollLog = [];
for (let i = 0; i < 160; i++) {
  await sleep(3000);
  polls++;
  const st = await api('/api/tasks/' + taskId);
  const taskState = st.body ? st.body.status : ('HTTP' + st.status);
  pollLog.push(taskState + (st.body && st.body.finished_at ? '@' + st.body.finished_at.slice(11, 19) : ''));
  const t2 = await pageText();
  if (taskState === 'done' && t2.indexOf('参谋卡就绪') >= 0) { done = true; break; }
  if (taskState === 'failed') break;
  if (i === 20 || i === 40 || i === 80) console.log('S8 轮询中… ' + i * 3 + 's 任务状态=' + taskState);
}
console.log('S8 轮询 ' + polls + ' 次（3s 间隔）状态迁移: ' + pollLog.slice(0, 3).join(' -> ') + ' ... ' + pollLog.slice(-3).join(' -> '));
check('S8a 任务到 done 且 UI 就绪提醒', done, 'polls=' + polls);
const finalTask = await api('/api/tasks/' + taskId);
fs.writeFileSync(OUT + '/p4-advise-task-final.json', JSON.stringify(finalTask.body, null, 2), 'utf8');
const fc = finalTask.body && finalTask.body.card;
console.log('S8-证据 任务终态: status=' + finalTask.body.status + ' saved=' + (fc && fc.saved) +
  ' 矛盾=' + (fc && fc.contradictions ? fc.contradictions.length : '?') +
  ' 假设=' + (fc && fc.hypotheses ? fc.hypotheses.length : '?') +
  ' 验证点=' + (fc && fc.checkpoints ? fc.checkpoints.length : '?') +
  ' 耗时=' + (finalTask.body.finished_at && finalTask.body.created_at ? (new Date(finalTask.body.finished_at) - new Date(finalTask.body.created_at)) / 1000 + 's' : '?'));
txt = await pageText();
check('S8b 卡片头（═══ 参谋卡 · 思路非答案 ═══）', txt.indexOf('参谋卡 · 思路非答案') >= 0);
check('S8c 矛盾区渲染（矛盾点 N 条 + 色标图例）', txt.indexOf('矛盾点') >= 0 && txt.indexOf('欠定度色标') >= 0);
check('S8d 假设区渲染（竞争假设三件套）', txt.indexOf('竞争假设') >= 0 && (txt.indexOf('思路，非定论') >= 0 || txt.indexOf('（无假设') >= 0));
check('S8e 验证点渲染（验证点区）', txt.indexOf('验证点') >= 0 && (txt.indexOf('（分辨') >= 0 || txt.indexOf('（无验证点）') >= 0));
check('S8f 已回存服务端（saved 徽标）', txt.indexOf('已回存服务端') >= 0);
const hasHigh = txt.indexOf('高欠定度') >= 0, hasMid = txt.indexOf('中欠定度') >= 0;
console.log('S8g 色标实际出现: high=' + hasHigh + ' mid=' + hasMid + '（红=高 黄=中 样式见截图）');

// ── S9 快照（卡片页 手机+桌面）──
await shot(OUT + '/p4-advisor-card-mobile-390.png', 390, 844, true);
await shot(OUT + '/p4-advisor-card-desktop-1280.png', 1280, 900, false);
fs.writeFileSync(OUT + '/p4-advisor-card.txt', txt, 'utf8');
const html = await evaljs("document.querySelector('.adv-card') ? document.querySelector('.adv-card').outerHTML : ''");
fs.writeFileSync(OUT + '/p4-advisor-card-dom.html', html, 'utf8');
console.log('DOM 快照: p4-advisor-card.txt + p4-advisor-card-dom.html (' + html.length + 'B)');

// ── S10 历史卡回看（切走再点存档 chip）──
await evaljs("location.hash = '#/games'; void 0");
await sleep(900);
await evaljs("location.hash = '#/advisor'; void 0");
await sleep(1200);
await click(btn('第1天'));
await sleep(800);
txt = await pageText();
check('S10 历史参谋卡按天回看（存档 chip 第1天 → 卡片重现）', txt.indexOf('参谋卡 · 思路非答案') >= 0 && txt.indexOf('第1天') >= 0, txt.slice(0, 220));

// ── S11 对局页桌面截图收尾 ──
await evaljs("location.hash = '#/games'; void 0");
await sleep(1200);
await shot(OUT + '/p4-games-desktop-1280.png', 1280, 900, false);
txt = await pageText();
fs.writeFileSync(OUT + '/p4-games.txt', txt, 'utf8');
console.log('DOM 快照: p4-games.txt');

console.log('P4-DRIVE RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);


