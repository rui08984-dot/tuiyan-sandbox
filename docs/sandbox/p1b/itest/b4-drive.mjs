// b4-drive.mjs —— B4 前端剧本联动 全链实测（真浏览器 390x844+移动UA；后端 :8787 + chrome CDP :9223）
// 用法: node b4-drive.mjs <outDir>   产物: p6-*.png / b4-log.txt
// 验收链: botc建局带剧本 → 详情剧本徽章+角色参考 → 宏跳身份(确认卡中文角色名) →
//         金水卡谓词切是恶魔(落botc_claims) → 事件流/详情可见 → werewolf回归零变化
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
let fails = 0; const log = [];
function check(name, cond, extra) {
  const line = (cond ? 'OK   ' : 'FAIL ') + name + (extra ? ' | ' + String(extra).slice(0, 300) : '');
  console.log(line); log.push(line);
  if (!cond) fails++;
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
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = OUT + '/' + name;
  fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  console.log('SHOT ' + name + ' ' + fs.statSync(p).size + 'B');
}
async function api(path, opts) {
  const expr = "(async () => { const r = await fetch('" + path + "', " + JSON.stringify(opts || {}) + "); return JSON.stringify({ status: r.status, body: await r.text() }); })()";
  const parsed = JSON.parse(await evaljs(expr));
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null };
}
async function goto(hash, waitMs) {
  await evaljs("location.hash = " + JSON.stringify(hash) + "; location.reload();");
  await sleep(waitMs || 2600);
}

// ── 视口 ──
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setUserAgentOverride', { userAgent: UA });
await evaljs("location.href = '" + BASE + "/#/games'");
await sleep(2800);

// ── 1. API：botc 建局带剧本 ──
const cr = await api('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B4暗流涌动局', type: 'botc', player_count: 6, script: 'tb' }) });
check('POST /games botc+script=tb → 201 & game.script=tb', cr.status === 201 && cr.body && cr.body.game && cr.body.game.script === 'tb', JSON.stringify(cr.body).slice(0, 200));
const botcId = cr.body.game.id;
const list1 = await api('/api/games', {});
const botcRow = list1.body.games.find((g) => g.id === botcId);
check('GET /games 列表行带 script=tb', !!botcRow && botcRow.script === 'tb');

// ── 2. 对局详情：剧本徽章 + 阵营/状态声称空态 ──
await goto('#/games');
await click(nth('.game-item-main', 0)); // 列表 id DESC，首个=刚建的 botc 局
await sleep(1200);
const d1 = await pageText();
check('详情头含 剧本徽章「暗流涌动 TB」', d1.includes('暗流涌动 TB'), d1.slice(0, 400));
check('botc 声称卡出现（空态提示）', d1.includes('血染钟楼 · 阵营/状态声称') && d1.includes('暂无阵营/状态声称'));
check('角色参考按钮计数 27 角色（TB，展开前）', d1.includes('27 角色'));
await shot('p6-games-botc-detail.png');

// ── 3. 角色参考面板 ──
await click(btn('展开本剧本角色参考'));
await sleep(700);
const d2 = await pageText();
check('角色参考含「洗衣妇」+团队徽章「镇民」', d2.includes('洗衣妇') && d2.includes('镇民'));
check('角色参考含「恶魔」团队', d2.includes('恶魔'));
await shot('p6-role-ref.png');

// ── 4. 录入：宏跳身份（确认卡中文角色名 + BOTC 谓词选项）──
await evaljs("localStorage.setItem('p1b.input.gameId', '" + botcId + "')");
await goto('#/input');
const i0 = await pageText();
check('录入页选到 botc 局（血染钟楼）', i0.includes('B4暗流涌动局') && i0.includes('血染钟楼'));
await click(btn('跳身份'));
await sleep(600);
await setVal(nth('.sheet select', 0), '2');
await setVal(nth('.sheet input[list="role-suggest"]', 0), '洗衣妇');
await shot('p6-macro-role-botc.png');
await click(btn('出确认卡'));
await sleep(700);
const c1 = await pageText();
check('确认卡为 BOTC 模式（谓词可切换 .claim-edit）', (await evaljs("!!document.querySelector('.claim-edit select')")) === true);
check('确认卡谓词全集含「是恶魔(is_demon)」选项', (await evaljs("[...document.querySelectorAll('.claim-edit select option')].some(o=>o.textContent.includes('是恶魔(is_demon)'))")) === true);
check('确认卡角色建议来自 TB 剧本（datalist 含 洗衣妇）', (await evaljs("[...document.querySelectorAll('#botc-roles-dl option')].some(o=>o.value==='洗衣妇')")) === true);
check('确认卡展示中文角色名「洗衣妇」', c1.includes('洗衣妇'));
await shot('p6-confirm-role-zh.png');
await click(btn('确认入账'));
await sleep(1500);
const i1 = await pageText();
check('入账成功（事件流出现 洗衣妇）', i1.includes('已入账') && i1.includes('洗衣妇'));
const st1 = await api('/api/games/' + botcId + '/state', {});
const roleClaim = st1.body.claims[st1.body.claims.length - 1];
check('主表声称 object 已归一为角色 id=washerwoman', roleClaim && roleClaim.predicate === 'claims_role' && roleClaim.object === 'washerwoman', JSON.stringify(roleClaim));

// ── 5. 阵营声称：金水卡谓词切「是恶魔」→ 落 botc_claims ──
await click(btn('金水'));
await sleep(600);
await setVal(nth('.sheet select', 0), '2');
await setVal(nth('.sheet select', 1), '3');
await click(btn('出确认卡'));
await sleep(700);
await setVal(nth('.claim-edit select', 0), 'is_demon');
await sleep(400);
await setVal(nth('.claim-edit input', 0), '夜里跳法衣那批人可信');
await sleep(300);
const c2 = await pageText();
check('确认卡谓词已切「是恶魔(is_demon)」', c2.includes('是恶魔(is_demon)'));
await shot('p6-confirm-demon.png');
await click(btn('确认入账')); // 第一次=重显复核（修改过）
await sleep(900);
await click(btn('复核无误，确认入账'));
await sleep(1500);
const bc = await api('/api/games/' + botcId + '/botc-claims', {});
check('GET botc-claims 返回 is_demon 声称（subject=3）', bc.status === 200 && bc.body.claims.length === 1 && bc.body.claims[0].predicate === 'is_demon' && bc.body.claims[0].subject_seat === 3, JSON.stringify(bc.body));
check('事件流出现「是恶魔」徽章行', (await pageText()).includes('是恶魔'));
await shot('p6-event-botc-claims.png');

// ── 6. 详情页合并渲染 botc 声称 ──
await goto('#/games');
await click(nth('.game-item-main', 0));
await sleep(1200);
const d3 = await pageText();
check('详情阵营/状态声称区显示「是恶魔」（2号→3号）', d3.includes('是恶魔') && d3.includes('2号 → 3号'), d3.slice(0, 600));
await shot('p6-games-botc-claims.png');

// ── 7. werewolf 局回归：界面零变化 ──
const wr = await api('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B4狼人杀回归局', type: 'werewolf', player_count: 8 }) });
check('POST werewolf 局 201（无 script）', wr.status === 201 && wr.body.game.script == null, JSON.stringify(wr.body).slice(0, 160));
const wolfId = wr.body.game.id;
const wbc = await api('/api/games/' + wolfId + '/botc-claims', {});
check('werewolf 局 GET botc-claims = 空数组（路由不炸）', wbc.status === 200 && Array.isArray(wbc.body.claims) && wbc.body.claims.length === 0);
await evaljs("localStorage.setItem('p1b.input.gameId', '" + wolfId + "')");
await goto('#/input');
await click(btn('查杀'));
await sleep(600);
await setVal(nth('.sheet select', 0), '3');
await setVal(nth('.sheet select', 1), '5');
await click(btn('出确认卡'));
await sleep(700);
check('werewolf 确认卡无谓词切换（.claim-edit 不存在）', (await evaljs("!!document.querySelector('.claim-edit')")) === false);
check('werewolf 确认卡保持原样（is_wolf 徽章 + 「查杀」）', (await pageText()).includes('is_wolf') && (await pageText()).includes('「查杀」'));
await shot('p6-werewolf-confirm.png');
await click(btn('确认入账'));
await sleep(1500);
check('werewolf 事件流 is_wolf 入账正常', (await pageText()).includes('is_wolf'));
await shot('p6-werewolf-event.png');
await goto('#/games');
await click(nth('.game-item-main', 0)); // 最新 = werewolf 局
await sleep(1200);
const d4 = await pageText();
check('werewolf 详情无血染钟楼卡/无剧本徽章', !d4.includes('血染钟楼 · 阵营/状态声称') && !d4.includes('展开本剧本角色参考'));
await shot('p6-werewolf-detail.png');

// ── 收尾 ──
log.push('FAILS=' + fails);
fs.writeFileSync(OUT + '/b4-log.txt', log.join('\n'), 'utf8');
console.log('DONE fails=' + fails);
process.exit(0);
