// p7-drive.mjs —— B6 一页现场流 13 项双局回归（werewolf + botc tb）。改自 p5-drive.mjs 成熟 CDP 方案。
// 用法: node p7-drive.mjs <outDir>（前提: 后端 :8787 MOCK 已起 + chrome CDP :9223 已起）
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
  const isExpr = /^[(\[]/.test(sel) || sel.indexOf('document') === 0;
  const elExpr = isExpr ? sel : q(sel);
  return evaljs("(()=>{const el=" + elExpr + ";if(!el)return false;(" + SETVAL + ")(" + "el," + JSON.stringify(v) + ");return true})()");
}
const nth = (sel, i) => "(document.querySelectorAll('" + sel + "'))[" + i + "]";
const q = (sel) => "document.querySelector('" + sel + "')";
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
  console.log('PNG saved: ' + pngOut.split('\\').pop() + ' ' + fs.statSync(pngOut).size + 'B');
}
async function nav(hash) { await send('Page.navigate', { url: BASE + '/' + hash }); await sleep(1800); }
async function waitSel(sel, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    if (await evaljs("!!" + q(sel))) return true;
    await sleep(450);
  }
  return false;
}
async function waitText(txt, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    const p = await pageText();
    if (p.indexOf(txt) >= 0) return true;
    await sleep(450);
  }
  return false;
}async function ensureOnGame(name) {
  await nav('#/');
  await sleep(800);
  if ((await pageText()).indexOf(name) >= 0) return 'already';
  await evaljs("(()=>{const b=" + btn('切换/建局') + ";if(b)b.click();return !!b})()");
  await sleep(700);
  await evaljs("(()=>{const b=" + btn(name) + ";if(b)b.click();return !!b})()");
  await sleep(1600);
  return (await pageText()).indexOf(name) >= 0 ? 'switched' : 'fail';
}

// ── S0 环境 ──
await send('Emulation.setUserAgentOverride', { userAgent: UA });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await nav('#/');
check('S0a 移动 UA + 视口 390x844', (await evaljs('navigator.userAgent')) === UA && (await evaljs('window.innerWidth + "x" + window.innerHeight')) === '390x844');
check('S0b 现场页可达（空态或现场主屏）', (await evaljs("!!" + q('[data-testid=live-empty]'))) || (await pageText()).indexOf('第 1 天') >= 0 || (await pageText()).indexOf('未选局') >= 0);
// ── S1 向导建狼人杀局（8人，2真名）──
await click(btn('＋ 开新局'));
check('S1a 向导弹出（.sheet 引导）', await waitSel('.sheet', 8000));
await setVal('.form-grid .field input', 'P7狼人杀回归');
await setVal('.form-grid .row2 select', 'werewolf');
await setVal('.form-grid input[type=number]', '8');
await click(btn('下一步'));
await sleep(700);
await setVal('input[aria-label="1号真名"]', '张三');
await setVal('input[aria-label="3号真名"]', '李四');
await click(btn('创建局并进入现场'));
check('S1b 创建后现场 TopBar（局名+第 1 天+真名 1号·张三）', await waitText('1号·张三', 8000) && (await pageText()).indexOf('P7狼人杀回归') >= 0);
const gl = await api('/api/games');
const gWolf = (gl.body.games || []).find((g) => g.name === 'P7狼人杀回归');
const gid = gWolf ? gWolf.id : 0;
check('S1c 局落库（id=' + gid + '，8人）', gid > 0 && gWolf.player_count === 8);
// ── S2 manage 座位改名（防抖 PUT 服务端真相）──
await nav('#/manage');
await sleep(1000);
await evaljs("(()=>{const li=[...document.querySelectorAll('.game-item')].find(x=>x.textContent.indexOf('P7狼人杀回归')>=0); const b=li&&(li.querySelector('button.btn')||li.querySelector('button')); if(b)b.click(); return !!li})()");
await sleep(1200);
await setVal('input[aria-label="2号真名"]', '赵六');
await sleep(1600);
const gAfter = await api('/api/games/' + gid);
const p2 = (gAfter.body.players || []).find((x) => x.seat === 2);
check('S2 管理页座位改名落库（2号=赵六）', p2 && p2.name === '赵六', JSON.stringify(gAfter.body.players || {}).slice(0, 160));
// ── S3 天数推进 ──
await nav('#/');
await sleep(1200);
await click(q('button[aria-label=后一天]'));
await sleep(600);
const day2 = (await pageText()).indexOf('第 2 天') >= 0;
await click(q('button[aria-label=前一天]'));
await sleep(600);
check('S3 天数步进（后一天→第 2 天 / 前一天→第 1 天）', day2 && (await pageText()).indexOf('第 1 天') >= 0);
// ── S4 自由文本抽取+确认流（YD5，MOCK 确定性拆解）──
await setVal('.input-main textarea', '3号说自己是预言家，说5号是查杀');
await click(btn('AI 拆解'));
const cardShown = await waitSel('.confirm-sheet', 15000);
check('S4a 确认卡弹出（.confirm-sheet）', cardShown);
const rawTxt = cardShown ? await evaljs("(" + q('.confirm-raw') + "||{}).textContent||''") : '';
check('S4b 确认卡带原文（.confirm-raw）', rawTxt.indexOf('预言家') >= 0, rawTxt.slice(0, 120));
await click(btn('确认入账'));
check('S4c 自由文本入账（时间线见原文）', await waitText('3号说自己是预言家', 6000));
// ── S5 3 宏（宏表单→确认卡→入账）──
async function macro(kind, seat, roleVal, targetVal, expectText) {
  await click(btn(kind));
  await sleep(500);
  await setVal(nth('.sheet select', 0), String(seat));
  if (roleVal != null) await setVal(nth('.sheet input[list=role-suggest]', 0), roleVal);
  if (targetVal != null) await setVal(nth('.sheet select', 1), String(targetVal));
  await click(btn('出确认卡'));
  const okCard = await waitSel('.confirm-sheet', 8000);
  await click(btn('确认入账'));
  const ok2 = await waitText(expectText, 6000);
  return check('S5 宏[' + kind + '] 入账（' + expectText + '）', okCard && ok2, 'card=' + okCard);
}
await macro('跳身份', 2, '女巫', null, '女巫');
await macro('查杀', 4, null, 5, '查杀');
await macro('金水', 2, null, 3, '好人');
// ── S6 时间线 edit + retract ──
const claimCount0 = (await evaljs("document.querySelectorAll('.tl-claim').length")) || 0;
await evaljs("(()=>{const it=document.querySelector('.tl-item .tl-row-actions')||document.querySelector('.tl-claim .tl-row-actions'); const b=it&&[...it.querySelectorAll('button')].find(x=>x.textContent.includes('编辑')); if(b)b.click(); return !!b})()");
check('S6a 编辑弹层（EditSheet .sheet）', await waitSel('.sheet', 6000));
await click(btn('提交修订'));
await sleep(1200);
await evaljs("(()=>{const rows=[...document.querySelectorAll('.tl-row-actions')]; const last=rows[rows.length-1]; const b=last&&[...last.querySelectorAll('button')].find(x=>x.textContent.includes('撤回')); if(b)b.click(); return !!b})()");
await sleep(500);
const armed = (await pageText()).indexOf('确认撤回') >= 0;
await evaljs("(()=>{const rows=[...document.querySelectorAll('.tl-row-actions')]; const last=rows[rows.length-1]; const b=last&&[...last.querySelectorAll('button')].find(x=>x.textContent.includes('撤回')); if(b)b.click(); return !!b})()");
await sleep(1200);
const claimCount1 = (await evaljs("document.querySelectorAll('.tl-claim').length")) || 0;
check('S6b 两击撤回生效（armed 出现+条目 ' + claimCount0 + '→' + claimCount1 + '）', armed && claimCount1 < claimCount0);
// ── S7 天结算→任务→就绪（MOCK 秒级）──
await click(btn('⚡ 天结算'));
await sleep(800);
const ready = await waitText('就绪', 15000) || await waitSel('.adv-badge.is-ready', 5000);
check('S7a 天结算任务完成（✓ 第 N 天就绪）', ready, (await pageText()).slice(0, 200));
await evaljs("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('展开')); if(b)b.click(); return !!b})()");
await sleep(1200);
check('S7b 参谋卡内联展开（.adv-card）', await evaljs("!!" + q('.adv-card[data-testid=advisor-card]')));
// ── S8 卡渲染三要素 + 验证点勾选 ──
const cardTxt = await pageText();
check('S8a 卡头（参谋卡 · 思路非答案）', cardTxt.indexOf('思路非答案') >= 0);
check('S8b 矛盾区+欠定度色标图例', cardTxt.indexOf('矛盾点') >= 0 && cardTxt.indexOf('欠定度色标') >= 0, cardTxt.slice(0, 200));
const hypN = (await evaljs("document.querySelectorAll('.hyp-grid > .hyp-card').length")) || 0;
check('S8c 竞争假设双栏（.hyp-card x' + hypN + '）', hypN >= 1);
const hasCp = await evaljs("!!" + q('.cp-item input[type=checkbox]'));
if (hasCp) {
  await evaljs("(()=>{const c=document.querySelector('.cp-item input[type=checkbox]'); if(c)c.click(); return !!c})()");
  await sleep(400);
  const cp = await evaljs("(()=>{const it=document.querySelector('.cp-item'); return it?it.classList.contains('done'):false})()");
  check('S8d 验证点勾选生效（.cp-item.done）', cp === true);
} else {
  console.log('S8d-注明 本卡无验证点（MOCK 卡可能不含 cp）——如实记录');
}
await shot(OUT + '/p7-card-wolf-390.png', 390, 844, true);
// ── S9 导出 JSON ──
await nav('#/manage');
await sleep(1000);
await evaljs("(()=>{const li=[...document.querySelectorAll('.game-item')].find(x=>x.textContent.indexOf('P7狼人杀回归')>=0); const b=li&&(li.querySelector('button.btn')||li.querySelector('button')); if(b)b.click(); return !!li})()");
await sleep(1200);
await click(btn('⬇ 导出 JSON'));
await sleep(1000);
check('S9a UI 导出 toast', (await pageText()).indexOf('已导出 p1b-game-' + gid + '.json') >= 0);
const exp = await api('/api/games/' + gid + '/export');
fs.writeFileSync(OUT + '/p7-export-wolf.json', JSON.stringify(exp.body, null, 2), 'utf8');
check('S9b 导出内容（events≥4）', exp.status === 200 && exp.body.meta.counts.events >= 4, JSON.stringify(exp.body.meta));
// ── S10 设置页（只看不改）──
await evaljs("(()=>{const g=document.querySelector('.appbar-gear'); if(g)g.click(); return !!g})()");
await sleep(1200);
const setTxt = await pageText();
check('S10a 设置页可达（供应商管理器）', setTxt.indexOf('供应商') >= 0, setTxt.slice(0, 160));
await click(btn('编辑'));
await sleep(600);
const edOpen = await evaljs("!!" + q('.sheet'));
await evaljs("(()=>{const x=document.querySelector('.sheet .btn-ghost[aria-label=关闭]'); if(x)x.click(); return !!x})()");
await sleep(500);
check('S10b 供应商编辑弹层开合（未保存任何改动）', edOpen);
// ── S11 BOTC 局（tb 暗流涌动，5人）：剧本选择/中文角色/BOTC 谓词/botc-claims ──
await nav('#/manage');
await sleep(1000);
await click(btn('＋ 开新局'));
await sleep(600);
await setVal('.form-grid .field input', 'P7血染回归');
await setVal('.form-grid .row2 select', 'botc');
await sleep(400);
const scriptOpts = await evaljs("[...document.querySelectorAll('.form-grid select')].map(s=>[...s.options].map(o=>o.textContent).join('|')).join(' ;; ')");
check('S11a botc 剧本选择出现（三本标签）', String(scriptOpts).indexOf('暗流涌动') >= 0 && String(scriptOpts).indexOf('黯月初升') >= 0, String(scriptOpts).slice(0, 200));
await setVal('.form-grid input[type=number]', '5');
await click(btn('下一步'));
await sleep(700);
await click(btn('创建局并进入现场'));
await ensureOnGame('P7血染回归');
check('S11b BOTC 局现场（切局兜底后）', (await pageText()).indexOf('血染钟楼') >= 0 && (await pageText()).indexOf('5人') >= 0);
const gl2 = await api('/api/games');
const gBotc = (gl2.body.games || []).find((g) => g.name === 'P7血染回归');
const gid2 = gBotc ? gBotc.id : 0;
check('S11c BOTC 局落库（id=' + gid2 + '）', gid2 > 0);
// 中文角色建议（item 12）：botc 局宏 datalist=本剧本中文角色
await click(btn('跳身份'));
await sleep(500);
const dl = await evaljs("[...document.querySelectorAll('#role-suggest option')].map(o=>o.value).join(',')");
check('S11d 角色建议=tb 中文角色表（含 洗衣妇/厨师）', dl.indexOf('洗衣妇') >= 0 && dl.indexOf('厨师') >= 0, String(dl).slice(0, 160));
await setVal(nth('.sheet select', 0), '2');
await setVal(nth('.sheet input[list=role-suggest]', 0), '洗衣妇');
await click(btn('出确认卡'));
await sleep(600);
check('S11e 确认卡弹出（BOTC 局谓词可切换）', await evaljs("!!" + q('.confirm-sheet')));
const predRes = await evaljs("(()=>{const ss=[...document.querySelectorAll('.confirm-sheet select')]; const s=ss.find(x=>[...x.options].some(o=>o.value==='is_demon')); if(!s) return 'no-select'; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'is_demon'); s.dispatchEvent(new Event('change',{bubbles:true})); return 'switched';})()");
check('S11e2 谓词切换器找到并切到 is_demon', predRes === 'switched', String(predRes));
await click(btn('确认入账'));
await sleep(1500);
const bc = await api('/api/games/' + gid2 + '/botc-claims');
const bcList = (bc.body && (bc.body.claims || bc.body)) || [];
check('S11f BOTC 专属谓词落 botc_claims（is_demon）', Array.isArray(bcList) && bcList.some((c) => c.predicate === 'is_demon'), JSON.stringify(bcList).slice(0, 200));
check('S11g 时间线 b 前缀可见（含 是恶魔）', (await pageText()).indexOf('是恶魔') >= 0 || (await evaljs("[...document.querySelectorAll('.tl-claim')].map(x=>x.textContent.slice(0,30)).join('|')")).indexOf('是恶魔') >= 0);
// 中文角色名上时间线（item 12）：第二条声称不改谓词，保持 claims_role
await click(btn('跳身份'));
await sleep(500);
await setVal(nth('.sheet select', 0), '3');
await setVal(nth('.sheet input[list=role-suggest]', 0), '厨师');
await click(btn('出确认卡'));
await sleep(600);
await click(btn('确认入账'));
await sleep(1500);
check('S11h 时间线中文角色名（厨师）', (await evaljs("document.body.innerText")).indexOf('厨师') >= 0);
// manage BotcClaimsCard 可见（item 13）
await nav('#/manage');
await sleep(1000);
await evaljs("(()=>{const li=[...document.querySelectorAll('.game-item')].find(x=>x.textContent.indexOf('P7血染回归')>=0); const b=li&&(li.querySelector('button.btn')||li.querySelector('button')); if(b)b.click(); return !!li})()");
await sleep(1200);
const mgTxt = await pageText();
check('S11i manage BotcClaimsCard 可见（阵营/状态声称区）', mgTxt.indexOf('阵营/状态声称') >= 0 || mgTxt.indexOf('暂无阵营/状态声称') >= 0, mgTxt.slice(0, 160));
// ── S12 截图组（390/1280）──
await nav('#/');
await sleep(1200);
await shot(OUT + '/p7-live-botc-390.png', 390, 844, true);
await nav('#/manage');
await sleep(1000);
await shot(OUT + '/p7-manage-1280.png', 1280, 900, false);
await nav('#/settings');
await sleep(1000);
await shot(OUT + '/p7-settings-1280.png', 1280, 900, false);
await nav('#/');
await sleep(1200);
await shot(OUT + '/p7-live-wolf-390.png', 390, 844, true);
await shot(OUT + '/p7-live-1280.png', 1280, 900, false);
console.log('P7-DRIVE RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);