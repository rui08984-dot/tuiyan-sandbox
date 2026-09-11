// ui-drive.mjs —— CDP 驱动真实 UI 全链（建局→3宏→YD5重显→自由文本MOCK→edit/retract），零 npm 依赖
// 用法: node ui-drive.mjs <url> <outLog>   （前提: chrome --remote-debugging-port=9223 已起）
import fs from 'node:fs';
const [,, url, outFile] = process.argv;
const t = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(name, cond, extra) { if (cond) { console.log('OK   ' + name); } else { fails++; console.log('FAIL ' + name + (extra ? ' | ' + String(extra).slice(0, 200) : '')); } return cond; }
async function evaljs(expr) {
  const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
  return m.result?.result?.value;
}
const btn = s => `[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(s)}))`;
const SETVAL = `(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}`;
const pageText = async () => evaljs('document.body.innerText');
const click = async s => evaljs(`(()=>{const b=${s};if(!b)return false;b.click();return true})()`);
async function setVal(sel, v) { return evaljs(`(()=>{const el=${sel};if(!el)return false;(${SETVAL})(el,${JSON.stringify(v)});return true})()`); }
function nth(sel, i) { return "(document.querySelectorAll('" + sel + "'))[" + i + "]"; }

await sleep(2500);
// S1 建局
await click(btn('切换/建局')); await sleep(400);
await setVal(nth('.sheet input', 0), 'UI驱动联调局');
await setVal(nth('.sheet input', 1), '8');
await click(btn('新建局')); await sleep(900);
check('S1 建局+选局（局名+存活8/8）', (await pageText()).includes('UI驱动联调局') && (await pageText()).includes('存活 8/8'));
// S2 宏1 跳身份
await click(btn('跳身份')); await sleep(400);
await setVal(nth('.sheet select', 0), '2'); await setVal(nth('.sheet input', 0), '预言家');
await click(btn('出确认卡')); await sleep(400);
check('S2 宏1 确认卡出现（宏录入徽标+第1轮）', (await pageText()).includes('待确认卡') && (await pageText()).includes('宏录入'));
await click(btn('确认入账')); await sleep(900);
check('S2 宏1 入账（2号跳预言家）', (await pageText()).includes('2号跳预言家'));
// S3 宏2 查杀
await click(btn('查杀')); await sleep(400);
await setVal(nth('.sheet select', 0), '3'); await setVal(nth('.sheet select', 1), '5');
await click(btn('出确认卡')); await sleep(400);
await click(btn('确认入账')); await sleep(900);
check('S3 宏2 查杀入账（3号查杀5号）', (await pageText()).includes('3号查杀5号'));
// S4 宏3 金水
await click(btn('金水')); await sleep(400);
await setVal(nth('.sheet select', 0), '1'); await setVal(nth('.sheet select', 1), '4');
await click(btn('出确认卡')); await sleep(400);
await click(btn('确认入账')); await sleep(900);
check('S4 宏3 金水入账（1号给4号发金水）', (await pageText()).includes('1号给4号发金水'));
// S5 YD5：修改行为人 → 点确认触发重显一轮（第2轮+提示）→ 复核后再点才入账
await click(btn('跳身份')); await sleep(400);
await setVal(nth('.sheet select', 0), '6'); await setVal(nth('.sheet input', 0), '女巫');
await click(btn('出确认卡')); await sleep(400);
await setVal(nth('.confirm-sheet .ev-grid input[type=number]', 0), '7'); await sleep(300);
await setVal(nth('.confirm-sheet .claim-card input[type=number]', 0), '7'); await sleep(300);
const actorVal = await evaljs("(document.querySelectorAll('.confirm-sheet .ev-grid input[type=number]'))[0] && document.querySelectorAll('.confirm-sheet .ev-grid input[type=number]')[0].value");
check('S5a 席位键控提交成功（行为人+对象均=7）', actorVal === '7', 'got=' + actorVal);
await click(btn('确认入账')); await sleep(500);
let txt = await pageText();
check('S5b YD5 重显一轮（第 2 轮 + 检测到修改 + 复核按钮）', txt.includes('第 2 轮') && txt.includes('检测到修改') && txt.includes('复核无误'));
await click(btn('复核无误')); await sleep(900);
txt = await pageText();
check('S5c YD5 复核入账（claims 跟随行为人 7号 → 7号）', txt.includes('7号 → 7号'));
// S6 自由文本 MOCK 抽取 → 确认
await setVal(nth('.input-main textarea', 0), '3号说自己是预言家，说5号是查杀'); await sleep(200);
await click(btn('AI 拆解')); await sleep(2200);
txt = await pageText();
check('S6 MOCK 抽取卡（AI 抽取 · MOCK 徽标 + 2 条声称）', txt.includes('AI 抽取 · MOCK') && txt.includes('声称 2 条'));
await click(btn('确认入账')); await sleep(900);
check('S6 自由文本入账（raw 文本可见）', (await pageText()).includes('3号说自己是预言家'));
// S7 claims edit（时间线行 → 编辑抽屉 → 改内容）
const rowBtn = (needle, label) => "(()=>{const r=[...document.querySelectorAll('.tl-claim')].find(x=>x.textContent.includes(" + JSON.stringify(needle) + "));if(!r)return false;const b=[...r.querySelectorAll('button')].find(x=>x.textContent.includes(" + JSON.stringify(label) + "));if(!b)return false;b.click();return true})()";
await evaljs(rowBtn('claims_role', '编辑')); await sleep(400);
await setVal(nth('.sheet input', 0), '女巫+守卫');
await click(btn('提交修订')); await sleep(800);
check('S7 claims edit 生效（「女巫+守卫」可见）', (await pageText()).includes('女巫+守卫'));
// S8 claims retract（两击确认）→ 时间线行消失（撤唯一的金水 claim，避免同名撞车）
await evaljs(rowBtn('is_good', '撤回')); await sleep(250);
check('S8 撤回两击武装（确认撤回? 出现）', (await pageText()).includes('确认撤回'));
await click(btn('确认撤回')); await sleep(800);
check('S8 retract 生效（金水 claim 行消失，事件原文仍在）', !(await pageText()).includes('→ 4号「好人」') && (await pageText()).includes('1号给4号发金水'));
// 终态快照
await sleep(300);
fs.writeFileSync(outFile, await pageText(), 'utf8');
console.log('UI-DRIVE RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);
