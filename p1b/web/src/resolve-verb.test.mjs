/* 待落定页闸（2026-08-27 八轮第五改）
 *
 * 这道闸锁的不是样式，是**一个产品事实**：
 *   `POST /api/predictions/:id/resolve` 与 `GET /api/predictions/unresolved`
 *   后端早就有（含 409 不可变守卫、ambiguous 强制附注），
 *   而在此之前**前端一次都没调过** —— 1994 道题全由 CLI 灌入，人手写的题 0 道。
 *   题线上只有「入账」没有「落定」，且落定还发生在终端里
 *   ⇒ 一个没有第二个动词的界面，长出来必然是仪表盘。
 *   这就是「像后端维护的东西」的真正来源。
 *
 * 所以锁三条：①页必须能写账本 ②不可变铁律必须显式呈现（409 不静默）
 *   ③ambiguous 必须强制附注（歧义不许硬判）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'ResolvePage.tsx'), 'utf8');
const api = readFileSync(join(dir, 'api.ts'), 'utf8');
const app = readFileSync(join(dir, 'App.tsx'), 'utf8');
const css = readFileSync(join(dir, 'styles', 'resolve.css'), 'utf8');

test('① 题线上有「落定」这个动作了（不再是只读账本）', () => {
  assert.ok(api.includes('/predictions/'), 'api 须调 /predictions 端点');
  assert.ok(api.includes("/resolve'"), 'api 须有落定调用（POST …/resolve）');
  assert.ok(page.includes('resolvePrediction'), '页面须真的调用落定接口');
  assert.ok(app.includes('path="/resolve"'), '须有 /resolve 路由');
  // 反向锁：若哪天有人把这两个调用删了，这道闸会红
  assert.ok(!/^\s*\/\/.*listUnresolved/m.test(api), 'listUnresolved 不应被整体注释掉');
});

test('② 账本不可变：409 必须显式告知，不静默失败也不给假选项', () => {
  assert.ok(page.includes('409'), '须处理 409（已落定）');
  assert.ok(page.includes('账本不可改') || page.includes('账本不可变'),
    '须把不可变这条讲给用户听——它正是账本可信的原因');
  // ★2026-08-28 T1（M7）：原文案要求页面出现「另开」，但后端**没有 amend 接口**
  //   （全库 grep 零命中）⇒ 那是指向一条不存在的路的死胡同。断言随之改口径：
  //   页面必须**如实说明「没有修正入口」**，而不是教用户去走一条不存在的路。
  assert.equal(page.includes('另开'), false,
    '★不得再出现「另开修正记录」——后端无 amend 接口，那是死胡同（M7 已改为如实说明）');
  assert.ok(page.includes('没有') && page.includes('修正入口'),
    '须如实说明目前没有修正入口，而不是指向一条不存在的路');
});

test('③ ambiguous 强制附注：歧义不许硬判', () => {
  assert.ok(page.includes('判定不清') || page.includes('ambiguous'), '须有「判定不清」这条出路');
  assert.ok(page.includes('note'), '须提交 note');
  assert.ok(/disabled=\{!note\.trim\(\)\}/.test(page), 'note 为空时提交键必须禁用');
});

test('④ 不做「推荐先落哪一条」（推荐是观点，会撒谎）', () => {
  assert.equal(/推荐|建议先|优先处理/.test(page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), false,
    '页面代码里不得出现推荐/建议字样（注释里的说明不算）');
});

/* ══ 2026-09-29 补：归属三桶（我的题 / 语料库 / 别人的题）══
 *
 * 病象（实测当日真实库）：/resolve 上看到的 33 条**全是没主的机器题**，
 *   每条挂着「真发生 / 没发生 / 判定不清」三个写键；端点也压根不知道题归谁
 *   （到期未解的查询里没有 join 归属表）。
 *   归属不是显示偏好，它决定**谁有权动这一行**。
 *
 * 本闸锁的是**接线形状**（沿 honestIntervalUx 的做法：源码断言 + 一次真函数调用），
 *   因为这个缺陷的两条失败形态都不会让页面崩：桶恒为 0（谁也没答到自己的题），
 *   或者更糟——把别人的题连同写键端出来。两条都只有断言能抓。 */
const libVisitor = readFileSync(join(dir, 'lib', 'visitor.ts'), 'utf8');
const route = readFileSync(join(dir, '..', '..', 'src', 'routes', 'disclosure.js'), 'utf8');
const store = readFileSync(join(dir, '..', '..', 'src', 'db', 'ownershipStore.js'), 'utf8');

test('⑤ 三个桶都在键上，且**别人的题这一桶不列行、不给键**', () => {
  for (const b of ['mine', 'corpus', 'others']) {
    assert.ok(page.includes('data-testid="resolve-view-' + b + '"'), '缺「' + b + '」桶的切换键');
  }
  // ② 这一块是唯一挂写键的地方 ⇒ 它在别人桶里必须整块不渲染
  assert.ok(/bucket !== 'others' \? \(/.test(page),
    '★待你确认那一块（含三个写键）必须在别人的题这一桶整块不渲染——'
    + '「只报数」不能只体现在文案上');
  // 语料库/别人的题一条都没删：切换键上永远带条数
  assert.ok(/knownLabel = \(b: OwnerBucket\) => \(openBuckets \? openBuckets\[b\] : '—'\)/.test(page),
    '桶的条数必须从端点给的 open_buckets 直读（不许自己数，也不许在缺数时编 0）');
  // 三桶恒等式照打，且对不上时**说出来**而不是悄悄改数
  assert.ok(page.includes('resolve-bucket-warn'), '缺三桶对不上时的告警块');
  assert.ok(/三者之和 = /.test(page), '恒等式必须被报出来（不可自校验的恒等式只是句口号）');
});

test('★⑥ 首访不许卡在「没有访客标识」：发号与取数串成一条链', () => {
  assert.ok(page.includes("from '../lib/visitor'"), '未接 lib/visitor');
  assert.ok(/ensureVisitorId\(\)/.test(page), '页面必须 await 发号，不能在挂载那一刻同步读 localStorage');
  // 取数的 effect 必须等它落定 —— 依赖里有那个 ready 闸
  assert.ok(/if \(vidReady\) void load\(vid\)/.test(page),
    '★取数 effect 缺 vidReady 闸：首访时标识还没换回来就会读出一个「没有访客」的假答案，'
    + '而且不会重跑（这正是 WhereOffPage:189-200 踩的形状）');
  assert.ok(/\?visitor_id=/.test(page), '取数必须把标识带给端点，否则端点只能 fail-closed 当「不知道」');
  // 分不开时必须换措辞：那个 0 的意思是「不知道你是谁」，不是「你没有题」
  assert.ok(page.includes('不是「你没有题」'), '缺「分不开 ≠ 没有」这句限定语');
});

test('★⑦ 落定回声要把这一题从**所有**桶里一致摘掉', () => {
  // 两个下标：ok/human/stuck 哪一类、mine/corpus/others 哪一桶。只改前一个，
  // 切到别的桶时这一行还赖在列表里，而它已经落定了。
  const fn = page.slice(page.indexOf('function dropResolved'), page.indexOf('function bucketTail'));
  assert.ok(fn, '缺 dropResolved');
  for (const a of ['d.ok', 'd.need_human', 'd.stuck']) {
    assert.ok(fn.includes(a), '回声须同时处理 ' + a + ' 这一个数组');
  }
  assert.ok(/open_buckets\[row\.view_bucket\] -= 1/.test(fn),
    '★归属桶的计数也必须减 —— 只减「待你确认」那一类，桶上的数就和明细对不上了');
  assert.ok(/open_total: Math\.max\(0, d\.counts\.open_total - 1\)/.test(fn),
    'open_total 必须同步减：后端注释明写「三桶之和 ≡ 本值」，前端得让它继续成立');
  // 落定后那枚题变成 revealed ⇒ ① 与已揭晓拆解要跟着对齐
  assert.ok(/void load\(vid, true\)/.test(page), '落定后须静默重取，把 ① 与已揭晓拆解对齐');
  assert.ok(/if \(silent\) return;/.test(page),
    '★静默重取失败不得把刚落的回声擦掉、把整页打成错误态');
});

test('⑧ 端点侧：到期未解的行必须带归属，且三桶与行**同源**', () => {
  // ★2026-09-29 放宽字面形式：原式只匹配 `view_bucket: own.buckets[r.id]` 一种写法，
  //   而「先取 bucket 常量再打标签」是等价且更安全的写法（脱敏要用到 bucket）。
  //   **断言的意图一字未改**：每行仍须带 view_bucket。
  assert.ok(/view_bucket: (own\.buckets\[r\.id\]|bucket)/.test(route)
    && /const bucket = own\.buckets\[r\.id\]/.test(route),
    '每行须带 view_bucket（页面不自己猜归属）');
  assert.ok(/open_buckets: own\.counts/.test(route), '端点须回归属三桶计数');
  assert.ok(/function bucketize\(predictionIds, viewerId\)/.test(store),
    '归属三桶须由 ownershipStore 出（页与端点两处各算一遍＝迟早对不上）');
  // 恒等式由构造保证：逐行标注与三桶计数读的是同一次查询的同一份循环
  const bz = store.slice(store.indexOf('function bucketize'), store.indexOf('function viewSummary'));
  assert.ok(/buckets\[id\] = b;[\s\S]{0,40}counts\[b\] \+= 1/.test(bz),
    '★逐行标注与计数必须来自同一个循环 —— 两条独立查询算出来的恒等式只是句口号');
  // 缺标识 ⇒ fail-closed：不知道你是谁时不能把别人的题说成你的
  assert.ok(/vid === undefined \? 'corpus' : \(viewerId && vid === viewerId \? 'mine' : 'others'\)/.test(bz),
    '缺 visitor_id 时有归属的行必须落 others，不得落 mine');
  // ★2026-09-29：原式只认 isValidId(visitorId) 一种参数名；守卫在即算数。
  assert.ok(/!analytics\.isValidId\(/.test(route) && /httpError\(400/.test(route),
    '格式非法的 visitor_id 必须 400（静默忽略等于把「我的题」悄悄降级成「别人的题」）');
});

test('⑧b 发号不许凭空造 id：换不到就是换不到', () => {
  assert.ok(/export async function ensureVisitorId/.test(libVisitor), 'ensureVisitorId 必须是 async（同步拿不到首访那枚）');
  assert.ok(/if \(prior && !fresh\) return prior;/.test(libVisitor), '已有的标识须原样复用（跨会话稳定＝「同一个人」的依据）');
  assert.ok(/if \(!r\.ok\) return null;/.test(libVisitor) && /catch \(e\) \{\s*return null;/.test(libVisitor),
    '★换不到标识必须返回 null 而不是 throw —— 读数页不许因为标识服务挂了而变错误态');
  // 本地编一个发出去，后端会 400（analytics.js:169-175），白跑一趟还让人以为「我没有题」
  assert.equal(/Math\.random\(\)/.test(libVisitor), false, '不许本地随机造 visitor_id');
  assert.equal(/\breturn ['"]v_/.test(libVisitor), false, '不许本地硬编一个 visitor_id 前缀返回');
});

test('⑨ 切换键的样式是本页自己的，且带 focus-visible 与 reduced-motion', () => {
  // ★不许 import whereoff.css 借 .wo-view：那组类**全库零 CSS**（实测 dist 里也没有），
  //   WhereOffPage 上那两个键今天就是裸浏览器默认按钮。照抄＝把已验证的缺陷搬家。
  assert.equal(/import\s+['"][^'"]*whereoff\.css/.test(page), false, '不许 import whereoff.css');
  assert.equal(/import\s+['"][^'"]*charts\.css/.test(page), false,
    '不许 import charts.css（该表 2026-09-29 因可达性判定被整份 shake 出生产产物）');
  assert.ok(/\.resolve-view:focus-visible\s*\{[^}]*outline:/.test(css), '切换键缺 focus-visible 轮廓');
  // reduced-motion：a11y 闸只查整站 css 有没有这个词，查不出哪条规则漏网
  const rm = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
  assert.ok(/\.resolve-view\s*\{[^}]*transition:\s*none/.test(rm),
    '切换键的过渡必须在 reduced-motion 块里被关掉（漏一条就等于对那一个元素失效）');
  // 选中态不能只靠颜色
  assert.ok(/\.resolve-view\.is-on\s*\{[^}]*font-weight:\s*600/.test(css),
    '选中态须有非颜色通道（色弱也要分得出当前在哪个桶）');
});
