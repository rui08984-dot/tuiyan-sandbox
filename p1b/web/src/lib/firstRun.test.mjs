/**
 * firstRun.test.mjs —— 首访一分钟的闸（SPEC-first-run-ux）
 *
 * 【这个文件量的是行为，不是魔数】
 *   本项目禁新依赖 ⇒ 没有 jsdom / Testing Library，.tsx 渲染测不了
 *   （NotePage 头注 lib/noteProb 那段已把这条纪律写死）。所以：
 *     · **判定与文案**全部在 lib/firstRun.ts（纯函数）⇒ 这里直接 import 执行，喂夹具看输出；
 *     · **接线**（哪一页真的调了它、渲染在哪、守卫还在不在）用真实块边界切源码
 *       （按标签/函数名切，不按固定字符窗口切——固定窗口是量魔数，代码一变长就够不到）。
 *
 * 【两条不许被绕过的不变量，本文件各有一组正反锁】
 *   ① 引导**只指路不判断**：GUIDE_STEPS 与三个回声的文案全表过 FORBID_WORDS，必须零命中。
 *   ② n<30 纪律：R3 的最后半句「1 道题不构成结论——记满 5 道再来比」在 n=1 时逐字出现，
 *     且**任何 n 都必带一句纪律句**（n≥30 换内容，不换"有"）。
 *
 * 【★每条带循环的断言都有一条同级的「循环确实执行了 N 次」前置断言】
 *   判别法：把被测对象清空，本文件必须变红；不变红就是空跑绿灯。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EMPTY_LEAD, FIRST_COMPARE_N, GUIDE_STEPS, MIN_TRUST_N,
  deviationEcho, discipline, firstNoteEcho, guideStepFor, homeHeadline, ownershipLine,
  personalState, readGuideOff, settleEcho, showLedgerHero, stepShift, thinTail, writeGuideOff,
} from './firstRun.ts';

const dir = dirname(fileURLToPath(import.meta.url));
/** 本文件在 lib/ 下：页面与壳层在 ../，服务端在 ../../ */
const 读 = (...p) => readFileSync(join(dir, ...p), 'utf8');
const home = 读('..', 'pages', 'HomePage.tsx');
const note = 读('..', 'pages', 'NotePage.tsx');
const resolve = 读('..', 'pages', 'ResolvePage.tsx');
const whereoff = 读('..', 'pages', 'WhereOffPage.tsx');
const app = 读('..', 'App.tsx');
const firstRunTsx = 读('..', 'pages', 'FirstRun.tsx');
const disclosure = 读('..', '..', '..', 'src', 'routes', 'disclosure.js');

/** 引导与回声里**不许出现**的词：这批词正是「判断」的形状（推荐 ＋ 倾向 ＋ 能力断言）。 */
const FORBID_WORDS = ['推荐', '建议', '应该先', '优先', '擅长', '倾向', '你准', '可靠'];
/** 铁律②：用户读到的文案里禁「预测」二字（dist 有禁词扫描闸） */
const FORBID_WORD = '预测';
/** 反向锁用：n 太小的时候**绝对不许**出现的倾向性结论 */
const VERDICT_WORDS = ['乐观', '悲观', '倾向', '擅长', '系统性', '你偏', '可靠', '准确', '擅长领域'];

/** 取两个标签之间的真实块（不是固定字符窗口） */
function 块(src, 开, 闭) {
  const a = src.indexOf(开);
  const b = src.indexOf(闭, a + 1);
  assert.ok(a >= 0 && b > a, '块边界没找到：' + 开);
  return src.slice(a, b);
}

/* ══════════════ ① 引导：只指路，不判断 ══════════════ */

test('① 4 步引导逐条过禁词表，且那 4 条真路由都在 App 里', () => {
  // ★前置：循环确实执行了 4 次（把 GUIDE_STEPS 清空，本条会红在下一句而不是"通过"）
  assert.equal(GUIDE_STEPS.length, 4, '引导必须是 4 步（入口页那三张动作卡 ＋ 概览）');
  const 查过 = [];
  for (const s of GUIDE_STEPS) {
    查过.push(s.path);
    for (const w of FORBID_WORDS) {
      assert.equal(s.how.includes(w), false, '第 ' + s.n + ' 步含禁词「' + w + '」：' + s.how);
      assert.equal(s.title.includes(w), false, '第 ' + s.n + ' 步标题含禁词「' + w + '」：' + s.title);
    }
    assert.equal(s.how.includes(FORBID_WORD), false, '第 ' + s.n + ' 步含铁律②禁词');
    assert.ok(s.how.trim().length > 8, '第 ' + s.n + ' 步的话太空：' + s.how);
    // ★「指路」是可机检的：每一步都必须说清**这一页怎么用**（含键名或动作动词）
    assert.match(s.how, /点|写|选|填|回答|报|看|线|格/, '第 ' + s.n + ' 步不像"指路"：' + s.how);
  }
  assert.equal(查过.length, GUIDE_STEPS.length, '前置：循环没有跑满 4 次');
  assert.equal(new Set(查过).size, 4, '4 步不许指向同一页');
  // 指的路必须在 App.tsx 里真挂上，否则引导把人送去死链
  for (const p of 查过) {
    assert.ok(app.includes('path="' + p + '"'), '引导指的 ' + p + ' 在 App.tsx 里没有这条路由');
  }
});

test('② guideStepFor 只认那 4 条路径，其余一律 null（不编一步出来）', () => {
  const 案 = [['/', 1], ['/note', 2], ['/resolve', 3], ['/where-off', 4],
    ['/live', null], ['/question/12', null], ['/settings', null], ['', null], ['/note#x', 2]];
  assert.equal(案.length, 9, '前置：夹具数变了，改夹具也要改这条');
  const 跑过 = [];
  for (const [p, want] of 案) {
    const got = guideStepFor(p);
    跑过.push(p);
    const n = got ? got.n : null;
    assert.equal(n, want, '路径 ' + JSON.stringify(p) + ' 应命中第 ' + want + ' 步，实得 ' + n);
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
});

test('③ 步进回绕：从任一步连按 4 次「→」回到原步', () => {
  const 起点 = [];
  for (let i = 0; i < GUIDE_STEPS.length; i++) {
    起点.push(i);
    let j = i;
    for (let k = 0; k < GUIDE_STEPS.length; k++) j = stepShift(j, 1);
    assert.equal(j, i, '第 ' + i + ' 步连按 4 次 → 回到 ' + j);
    assert.equal(stepShift(i, -1), (i + GUIDE_STEPS.length - 1) % GUIDE_STEPS.length,
      '第 ' + i + ' 步的「←」没有回绕到上一步');
  }
  assert.equal(起点.length, GUIDE_STEPS.length, '前置：循环没有跑满 4 次');
  assert.equal(GUIDE_STEPS.length, 4, '引导步数变了');
});

test('④ 本机标记：引导关掉后 readGuideOff 为真，写不进去也不抛错', () => {
  // 隐私模式下 localStorage 写不进去：readGuideOff 不得抛（否则整条常驻条挂掉）
  const before = readGuideOff();
  assert.equal(typeof before, 'boolean', 'readGuideOff 必须返回布尔');
  writeGuideOff();
  const after = readGuideOff();
  assert.equal(typeof after, 'boolean', 'writeGuideOff 之后 readGuideOff 仍须返回布尔');
  // Node 里没有 localStorage ⇒ 写不进去 ⇒ after 仍为 false。这一条锁的是"失败也不炸"，
  // 不是"关掉了"（浏览器里的持久化由 FirstRun.tsx 的 re-render 承担）。
  assert.equal(after, before, '写不进去时 readGuideOff 不许凭空变 true');
  const key = 读('firstRun.ts');
  assert.ok(key.includes('p1b_firstrun_guide_off'), '引导关闭标记的键名必须单点定义');
  assert.ok(/export const GUIDE_OFF_KEY = 'p1b_firstrun_guide_off'/.test(key), '键名漂了');
});

/* ══════════════ ② 归属常驻条 ══════════════ */

test('⑤ 归属条把三个桶的数照打，并说清谁的不是你的', () => {
  const 案 = [
    { c: { mine: 1, corpus: 294, others: 0, total: 295 }, minN: 30 },
    { c: { mine: 0, corpus: 1994, others: 0, total: 1994 }, minN: 30 },
    { c: { mine: 3, corpus: 40, others: 2, total: 45 }, minN: 30 },
    { c: { mine: 40, corpus: 0, others: 0, total: 40 }, minN: 30 },
  ];
  assert.equal(案.length, 4, '前置：夹具数变了');
  const 跑过 = [];
  for (const { c, minN } of 案) {
    const t = ownershipLine(c, minN);
    跑过.push(t);
    // ★★2026-09-29 修：原来只断言「这个数在句子里某处出现」——
    //   独立复核的变异：把 mine 与 corpus 两个**标签**对调（「你的 {corpus} 条、
    //   语料库 {mine} 条」），22 条用例**全绿**。
    //   那正是本 spec 要消灭的撒谎：一句话把 294 条机器题说成是你的。
    //   ⇒ 改成**逐槽**断言：这个数必须出现在**它自己那个桶的标签后面**。
    const SLOT = [
      { k: 'mine', re: (n) => new RegExp('你的\\s*' + n + '\\s*条') },
      { k: 'corpus', re: (n) => new RegExp('语料库\\s*' + n + '\\s*条') },
      { k: 'others', re: (n) => new RegExp('别的使用者(?:的)?\\s*' + n + '\\s*条') },
      { k: 'total', re: (n) => new RegExp('一共\\s*' + n + '\\s*道题') },
    ];
    for (const { k, re } of SLOT) {
      assert.ok(re(String(c[k])).test(t),
        '★桶 ' + k + ' 的数字没落在**它自己那个槽位**上（' + c[k] + '）：' + t);
    }
    assert.ok(t.includes('一条都没删'), '语料库那桶必须说清"一条都没删"：' + t);
    assert.ok(t.includes('只报数，不列行'), '别人的题那桶必须说清"只报数，不列行"：' + t);
    for (const w of FORBID_WORDS) assert.equal(t.includes(w), false, '归属条含禁词「' + w + '」');
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
  // n<30 ⇒ 带限定语；n≥30 ⇒ 不带（不是"通过"，只是不必说）
  assert.ok(ownershipLine({ mine: 0, corpus: 5, others: 0, total: 5 }, 30).includes('只记条数、不给任何比例'),
    'n<30 时必须只记条数不给比例');
  assert.equal(thinTail(5, 30).length > 0, true);
  assert.equal(thinTail(30, 30), '', 'n=30 恰好够门槛，不该再挂那句');
  assert.equal(thinTail(31, 30), '');
});

test('⑥ ★归属条在**任何页面**都可见：挂在壳层 <main> 内、路由容器之外', () => {
  // ★按真实块边界取：<main> … </main>（不是固定字符窗口）
  const main = 块(app, '<main', '</main>');
  assert.ok(main.includes('<OwnershipBar />'), '归属条没挂在壳层 —— 逐页挂就等于"某些页面有"');
  assert.ok(main.includes('<FirstRun />'), '引导条没挂在壳层');
  // ★必须在路由容器**之外**：放容器内会被各页的顺序流与 max-width 牵着走
  assert.equal(main.indexOf('<Routes>') > main.indexOf('<OwnershipBar />'), true,
    '归属条必须排在 <Routes> 之前（页面容器之外）');
  assert.equal(app.includes("from './pages/FirstRun'"), true, 'App.tsx 未导入 FirstRun');
  // 它是**常驻**的：不受路由条件控制（不许出现 isLive 之类的 if 包着它）
  assert.equal(/\{isLive[^}]*<OwnershipBar/.test(app), false, '归属条被路由条件包起来了');
  assert.equal(/\{isLive[^}]*<FirstRun/.test(app), false, '引导条被路由条件包起来了');
});

/* ══════════════ ③ 首页个人态：陌生人第一屏 ══════════════ */

test('⑦ personalState 四种输入各归各的位，「分不开」不许说成「你没有」', () => {
  const 案 = [
    { inp: ['loading', null, null, null], want: 'loading' },
    { inp: ['failed', 'v_1', null, null], want: 'loading' },
    { inp: ['ready', null, { mine: 0, corpus: 294, others: 0, total: 294 }, 0], want: 'unknown' },
    { inp: ['ready', 'v_1', null, 0], want: 'unknown' },
    { inp: ['ready', 'v_1', { mine: 0, corpus: 294, others: 0, total: 294 }, 0], want: 'empty' },
    { inp: ['ready', 'v_1', { mine: 3, corpus: 291, others: 0, total: 294 }, 2], want: 'personal' },
  ];
  assert.equal(案.length, 6, '前置：夹具数变了');
  const 跑过 = [];
  for (const { inp, want } of 案) {
    const got = personalState(...inp);
    跑过.push(want);
    assert.equal(got.kind, want, '输入 ' + JSON.stringify(inp) + ' 应判成 ' + want);
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
  // 「分不开」与「没有」在界面上必须长得不一样
  const unknown = homeHeadline(personalState('ready', null, { mine: 0, corpus: 294, others: 0, total: 294 }, 0));
  const empty = homeHeadline(personalState('ready', 'v_1', { mine: 0, corpus: 294, others: 0, total: 294 }, 0));
  assert.notEqual(unknown, empty, '分不开与没有说的是同一句 ⇒ 用户会以为"我真的没有题"');
  assert.ok(unknown.includes('还没认出你是谁'), 'unknown 态必须说清是没认出，不是没有');
});

test('★⑧ 反向锁：0 题的陌生人面对 294 条账本，主角不是那 294', () => {
  const ps = personalState('ready', 'v_1', { mine: 0, corpus: 294, others: 0, total: 294 }, 0);
  assert.equal(ps.kind, 'empty');
  const head = homeHeadline(ps);
  assert.ok(head.includes('你还没有记过任何一道题'), '空态缺那句「你还没有记过任何一道题」：' + head);
  // ★这一屏的两句文案（开场句 ＋ 标题句）里不许出现账本的任何数字
  for (const t of [head, EMPTY_LEAD]) {
    assert.equal(t.includes('294'), false, '空态文案里出现了账本的数：' + t);
    assert.equal(t.includes('2,994'), false, '空态文案里出现了千分位账本数：' + t);
    assert.equal(/\d/.test(t), false, '空态文案里根本不该有任何数字：' + t);
  }
  // ★那两个大数（欠账数 / 够样本的格数）在空态下压掉
  assert.equal(showLedgerHero(ps), false, '空态仍在拿语料库的大数当主角');
  // ★但 loading 仍然露头：那一刻还不知道他有没有题，压了会让整页在取数回来时重排一次（CLS）
  assert.equal(showLedgerHero(personalState('loading', null, null, null)), true,
    'loading 时压掉账本块 ⇒ 取数回来时整页跳一次');
  assert.equal(showLedgerHero(personalState('ready', null, null, null)), true,
    '分不开归属时不该压掉账本读数（那是在删数据，不是在排主角）');
  // 数据一条没少：有自己题的人看得到账本读数
  const mine = personalState('ready', 'v_1', { mine: 2, corpus: 292, others: 0, total: 294 }, 1);
  assert.equal(showLedgerHero(mine), true, '有自己题的人看不到账本读数了（那是删数据，不是排主角）');
  assert.ok(homeHeadline(mine).includes('2'), '个人态标题没报自己的条数：' + homeHeadline(mine));
});

test('★⑨ 接线：账本那两个大数在空态下真的不渲染（首页源码按真实块边界查）', () => {
  // 判据挂在 showLedgerHero 上，不是一句 if 拍脑袋
  assert.ok(home.includes('showLedgerHero(ps) ? ('), '首页未用 showLedgerHero 判空态');
  // 真分支里含两个大数块；假分支里是"它们去哪了"的替身
  const 真 = 块(home, '{showLedgerHero(ps) ? (', ') : (');
  assert.ok(真.includes('home-debt-num'), '欠账那个大数不在真分支里');
  assert.ok(真.includes('home-stat--hero'), '够样本格数那个大数不在真分支里');
  // 假分支：从「) : (」到后面那条失败态注释（一个真实的块边界，不是固定字符窗口）
  const 假 = 块(home, ') : (', '{/* ★T2：失败态已由上面');
  assert.ok(假.includes('data-testid="home-foreign"'), '空态缺"那些数去哪了"的替身');
  assert.ok(假.includes('一条都没删'), '替身必须说清数据一条没删');
  // ★空态的出口是「记下第一道」
  assert.ok(home.includes('data-testid="home-first-note"'), '首页空态缺「记下第一道」按钮');
  assert.ok(/<NavLink to="\/note" className="btn btn-primary home-mine-cta" data-testid="home-first-note"/.test(home),
    '「记下第一道」必须真的指到 /note');
});

/* ══════════════ ④ R1 记下第一道题 ══════════════ */

test('⑩ firstNoteEcho：报第几道 ＋ 到期日；数不到就 null（绝不写「第 1 道」）', () => {
  const 案 = [
    { n: 1, d: '2026-10-01T00:00:00Z', want: ['第 1 道题', '2026-10-01', '才算落定'] },
    { n: 7, d: '2026-12-31', want: ['第 7 道题', '2026-12-31'] },
    { n: 1, d: null, want: ['第 1 道题', '到期后回来回答一次'] },
    { n: 300, d: '2026-10-02', want: ['第 300 道题'] },
  ];
  assert.equal(案.length, 4, '前置：夹具数变了');
  const 跑过 = [];
  for (const { n, d, want } of 案) {
    const t = firstNoteEcho(n, d);
    跑过.push(t);
    assert.ok(t, 'n=' + n + ' 时回声整块消失');
    for (const w of want) assert.ok(t.includes(w), 'R1 缺「' + w + '」：' + t);
    for (const w of FORBID_WORDS.concat(VERDICT_WORDS)) {
      assert.equal(t.includes(w), false, 'R1 含禁词「' + w + '」：' + t);
    }
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
  // ★取不到数 ⇒ 什么都不说（这是本条最容易骗人的地方：用 1 顶替"不知道"）
  for (const 坏 of [null, undefined, 0, -1, NaN, '1']) {
    assert.equal(firstNoteEcho(坏, '2026-10-01'), null, 'n=' + String(坏) + ' 时仍编出了「第几道」');
  }
});

test('⑪ 接线：NotePage 先把归属记下（R1 的数从哪来），回执里才有那句话', () => {
  assert.ok(note.includes("from '../lib/firstRun'"), 'NotePage 未接 lib/firstRun');
  assert.ok(/event: 'question_created'/.test(note), '未报 question_created ⇒ 后端不会把题记到访客名下');
  assert.ok(/subject_id: c\.id/.test(note), '上报必须带这道题的整数 id（只收 id，不收题面）');
  assert.ok(/j\.counts\.mine/.test(note), '未读 counts.mine ⇒ 回声里的「第 N 道」是编的');
  // 回执那一行由 firstNoteEcho 驱动，且 testId 在
  const receipt = 块(note, 'function Receipt(', 'export function myProbValid');
  assert.ok(receipt.includes('firstNoteEcho(mineN, ledger.matures_at)'), '回执的 R1 不是 firstNoteEcho 驱动的');
  assert.ok(receipt.includes('data-testid="note-echo"'), '回执缺 R1 的 testId');
  // ★没有归属就不许出现那句话：mineN 为 null 时 firstNoteEcho 返回 null（⑩ 已锁）
  assert.ok(/\{firstNote \? \(/.test(receipt), 'R1 必须整块条件渲染，而不是渲染一句空话');
});

/* ══════════════ ⑤ R2 第一次落定 ══════════════ */

test('⑫ settleEcho：第几道 ＋ 失分 ＋ 0.25 基线；没给数/没序数都不编', () => {
  const 案 = [
    { o: { ordinal: 1, prob: 0.6, truth: 1 }, want: ['第 1 道落定的题', '失分 0.160', '0.25', '我在哪儿偏了'] },
    { o: { ordinal: 12, prob: 1, truth: 1 }, want: ['第 12 道落定的题', '失分 0.000'] },
    // ★答 50% 的失分**恰好等于**那条无用基线（0.25）——这句话是回声里唯一的参照物，
    //   两者必须对得上，否则「比基线强/弱」这句话就是空的。
    { o: { ordinal: 3, prob: 0.5, truth: 1 }, want: ['失分 0.250', '0.25'] },
    { o: { ordinal: 1, prob: 0.9, truth: 0 }, want: ['失分 0.810'] },
    { o: { ordinal: null, prob: 0.6, truth: 1 }, want: ['这是你落定的一道题'], not: ['第 '] },
    { o: { ordinal: 1, prob: null, truth: 1 }, want: ['不计失分'], not: ['失分 0'] },
  ];
  assert.equal(案.length, 6, '前置：夹具数变了');
  const 跑过 = [];
  for (const { o, want, not } of 案) {
    const { text, loss } = settleEcho(o);
    跑过.push(text);
    assert.ok(text.startsWith('已落定'), 'R2 缺「已落定」：' + text);
    for (const w of want) assert.ok(text.includes(w), 'R2 缺「' + w + '」：' + text);
    for (const w of not || []) assert.equal(text.includes(w), false, 'R2 不该出现「' + w + '」：' + text);
    // 失分算式 =（你给的数 − 实际)²：与页面上 ① 那段同一个口径
    if (o.prob === null) assert.equal(loss, null, '没给数时 loss 必须是 null，不许拿 0 充数');
    else assert.ok(Math.abs(loss - Math.pow(o.prob - o.truth, 2)) < 1e-12, '失分算式不对：' + loss);
    for (const w of FORBID_WORDS.concat(VERDICT_WORDS)) {
      assert.equal(text.includes(w), false, 'R2 含禁词「' + w + '」：' + text);
    }
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
});

test('★⑬ R2 接线不许踩到归属红线：服务端脱敏 ＋ 页面侧渲染守卫，两道都还在', () => {
  // ① 服务端那道：别人的题在**响应体里**就脱敏（前端不渲染 ≠ 没泄露，F12 能读）
  const 脱敏 = 块(disclosure, 'const isOthers = bucket', '(split[c.c]');
  assert.ok(脱敏.includes('{ ...r, statement: null }'), '服务端不再对别人的题整行脱敏 —— 这是第一道防线');
  // ② 页面侧那道：「待你确认」那一块（含三个写键）在别人的桶里必须整块不渲染
  assert.ok(/bucket !== 'others' \? \(/.test(resolve), 'ResolvePage 的 bucket !== others 渲染守卫被拆了');
  // ③ R2 只加文案与一个链接，没有去取别人的题面
  assert.ok(resolve.includes('settleEcho({'), 'ResolvePage 未接 settleEcho');
  const r2 = 块(resolve, 'const e = settleEcho({', 'void load(vid, true);');
  assert.ok(r2.includes("to: '/question/' + row.id"), 'R2 的链接必须指到这道题自己的详情页');
  assert.equal(/statement|auto_revealed\[/.test(r2), false, 'R2 不许去取题面/别人的行');
  // ④ toast 支持链接，且链接只挂在**这道题**上
  const toast = 块(resolve, '{/* ── 回声：落定结果的即时反馈 ── */}', 'function today()');
  assert.ok(toast.includes('resolve-toast-link'), 'toast 不渲染链接 ⇒ R2 的那个出口是死的');
  assert.ok(/\{t\.link \? <Link to=\{t\.link\.to\}/.test(toast), 'toast 链接没有按每条 toast 自己的目标渲染');
});

/* ══════════════ ⑥ R3 第一次有自己的偏差 ＋ n<30 纪律（★核心）══════════════ */

const R3_ROWS_1 = [{ id: 7, assigned_prob: 0.12, outcome: 'false', resolved_at: '2026-09-28' }];
const R3_ROWS_1_UP = [{ id: 8, assigned_prob: 0.88, outcome: 'true', resolved_at: '2026-09-28' }];

test('★⑭ n=1：R3 出现，纪律半句逐字在，且一个倾向性结论都不给', () => {
  const 案 = [
    { rows: R3_ROWS_1, want: ['你有 1 道已落定的题', '说大了 0.12', '你给 12%，实际 0%'] },
    { rows: R3_ROWS_1_UP, want: ['你有 1 道已落定的题', '说小了 0.12', '你给 88%，实际 100%'] },
    { rows: [...R3_ROWS_1, ...R3_ROWS_1_UP], want: ['你有 2 道已落定的题'] },
  ];
  assert.equal(案.length, 3, '前置：夹具数变了');
  const 跑过 = [];
  for (const { rows, want } of 案) {
    const e = deviationEcho(rows, { minN: 30, resolvedTotal: rows.length });
    assert.ok(e, 'n=1 的已结算题必须出现 R3');
    跑过.push(e.text);
    for (const w of want) assert.ok(e.text.includes(w), 'R3 缺「' + w + '」：' + e.text);
    // ★★纪律核心：这一半句必须逐字在（n=1 时逐字对上 spec）
    assert.ok(e.text.includes(discipline(rows.length, 30)), 'R3 的纪律句不在：' + e.text);
    if (rows.length === 1) {
      assert.ok(e.text.includes('1 道题不构成结论——记满 5 道再来比'),
        '★R3 的最后半句没了：' + e.text);
    }
    assert.ok(e.text.endsWith(discipline(rows.length, 30)), 'R3 必须以纪律句收尾：' + e.text);
    // ★反向锁：n 太小的时候不许给任何倾向性结论
    for (const w of VERDICT_WORDS) {
      assert.equal(e.text.includes(w), false, 'n=1 的 R3 给了倾向性结论「' + w + '」：' + e.text);
    }
    // ★n<30 的「不给比例」：这一句里至多两个 %，且都是**这一道题自己**的两个读数
    //   （你给多少 / 实际多少）。任何聚合比例（占 x%）都不许出现。
    assert.equal(/占\s*\d/.test(e.text), false, 'R3 出现了比例（n<30 只记条数不给比例）：' + e.text);
    assert.ok((e.text.match(/%/g) || []).length <= 2, 'R3 里的百分号超过 2 个（混进了聚合比例）：' + e.text);
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
});

test('⑮ 0/1/5/30/294 五态：纪律句**始终**在，n<30 一律不给比例', () => {
  const 行 = (n) => Array.from({ length: n }, (_, i) => ({
    id: 100 + i, assigned_prob: 0.3 + (i % 3) * 0.2, outcome: i % 2 ? 'true' : 'false', resolved_at: '2026-09-2' + (i % 8),
  }));
  const 案 = [0, 1, 5, 30, 294];
  assert.equal(案.length, 5, '前置：夹具数变了');
  const 跑过 = [];
  for (const n of 案) {
    const e = deviationEcho(行(n), { minN: MIN_TRUST_N, resolvedTotal: n });
    if (n === 0) { assert.equal(e, null, '0 题时 R3 整块不渲染（没有偏差可报）'); 跑过.push('none'); continue; }
    assert.ok(e, 'n=' + n + ' 时 R3 消失');
    跑过.push(e.text);
    assert.ok(e.text.includes('你有 ' + n + ' 道已落定的题'), 'n 报错了：' + e.text);
    // ★「始终」：每一态都必须带一句纪律句（n≥30 换内容，不换"有"）
    assert.ok(e.text.endsWith(discipline(n, MIN_TRUST_N)), 'n=' + n + ' 的纪律句不在：' + e.text);
    assert.ok(/不构成结论|不按人读/.test(e.text), 'n=' + n + ' 没有纪律句：' + e.text);
    if (n < MIN_TRUST_N) {
      assert.equal(/占\s*\d/.test(e.text), false, 'n<30 给了比例：' + e.text);
      assert.ok((e.text.match(/%/g) || []).length <= 2,
        'n<30 的百分号超过 2 个（混进了聚合比例）：' + e.text);
      // ★「只记条数、不给比例」这句在 5≤n<30 那一段是**逐字**的；n<5 时纪律句更强
      //   （「不构成结论」比「只记条数」更严），所以那里不要求这句原话出现——
      //   但两条路径都不许出现聚合比例，上面那两行就是它的可机检形态。
      if (n >= FIRST_COMPARE_N) {
        assert.ok(e.text.includes('只记条数'), 'n<30 没明说只记条数：' + e.text);
      }
    }
    for (const w of FORBID_WORDS) assert.equal(e.text.includes(w), false, 'R3 含禁词「' + w + '」：' + e.text);
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
  // 逐字对 spec 的那半句（n=1）
  assert.equal(discipline(1, 30), '1 道题不构成结论——记满 5 道再来比。');
  assert.equal(discipline(4, 30), '4 道题不构成结论——记满 5 道再来比。');
  assert.ok(discipline(5, 30).includes('5 道题仍然不构成结论'), '5 道起该换一句更狠的：' + discipline(5, 30));
  assert.ok(discipline(30, 30).includes('不按人读'), '过了门槛也不许改成"按人读"：' + discipline(30, 30));
});

test('⑯ 不计分的行不进 R3（判定存疑、没给数、根本没落定）', () => {
  const 案 = [
    { rows: [], want: '空集合' },
    { rows: [{ id: 1, assigned_prob: null, outcome: 'true', resolved_at: '2026-09-01' }], want: '没给数' },
    { rows: [{ id: 2, assigned_prob: 0.6, outcome: 'ambiguous', resolved_at: '2026-09-01' }], want: '判定存疑' },
    { rows: [{ id: 3, assigned_prob: 0.6, outcome: null, resolved_at: '2026-09-01' }], want: '没回填' },
  ];
  assert.equal(案.length, 4, '前置：夹具数变了');
  const 跑过 = [];
  for (const { rows, want } of 案) {
    assert.equal(deviationEcho(rows, { minN: 30, resolvedTotal: rows.length }), null,
      want + ' 的行不该算出 R3（拿 0 充数是最会骗人的那种省略）');
    跑过.push(want);
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
});

test('★⑰ R3 取「最近落定的那一道」，且分母走账本全体口径而不是 50 行切片', () => {
  const rows = [
    { id: 10, assigned_prob: 0.5, outcome: 'true', resolved_at: '2026-09-01' },
    { id: 11, assigned_prob: 0.1, outcome: 'true', resolved_at: '2026-09-30' },
    { id: 12, assigned_prob: 0.9, outcome: 'false', resolved_at: '2026-09-20' },
  ];
  const e = deviationEcho(rows, { minN: 30, resolvedTotal: 87 });
  assert.equal(e.id, 11, 'R3 报的必须是最近落定的那一道（不是第一行，也不是偏差最大的）');
  assert.equal(e.n, 87, '★分母必须用账本全体口径的已落定条数，不是这几行切片的长度');
  assert.ok(e.text.includes('你有 87 道已落定的题'), 'n 没取全体口径：' + e.text);
  // 切片比全体小 ⇒ 认切片；切片不可信（比可算行还小）⇒ 退回数出来的行数
  const e2 = deviationEcho(rows, { minN: 30, resolvedTotal: 2 });
  assert.equal(e2.n, 3, 'resolvedTotal 比可算行还小时不许采信它（那是不自洽的数）');
});

test('⑱ 接线：R3 在「我在哪儿偏了」顶部，且分母取 auto_revealed.mine', () => {
  assert.ok(whereoff.includes("from '../lib/firstRun'"), 'WhereOffPage 未接 lib/firstRun');
  assert.ok(/deviationEcho\(qs\.rows as DevRow\[\], \{ minN: qs\.min_n, resolvedTotal: qs\.auto_revealed\.mine \}\)/.test(whereoff),
    'R3 的判据形状不对：分母必须走 auto_revealed.mine（账本全体口径）');
  assert.ok(whereoff.includes('data-testid="wo-echo"'), 'R3 缺 testId');
  // 位置在**顶部**：回声块在 page-head 之后、在偏差条之前
  const 序 = 块(whereoff, '<header className="page-head">', '{bad ? (');
  assert.ok(序.includes('data-testid="wo-echo"'), 'R3 不在页面顶部');
  assert.equal(whereoff.indexOf('wo-echo') < whereoff.indexOf('whereoff-s1'), true,
    'R3 必须在偏差条之前（顶部）');
  // ★铁律②：这一页的禁词闸（disclosure-phase4-pages ④⑥ 扫的就是这个文件）
  assert.equal((whereoff.match(/预测/g) || []).length, 0, 'WhereOffPage 命中铁律②禁词');
});

/* ══════════════ ⑦ 三处空态都要有可点的下一步 ══════════════ */

test('⑲ 三处空态各有一个可点的出口，且出口指得到真路由', () => {
  const 案 = [
    { 文件: home, id: 'home-first-note', to: '/note', why: '首页 0 题' },
    { 文件: resolve, id: 'resolve-empty-note', to: '/note', why: '待落定·没有你的题' },
    { 文件: whereoff, id: 'whereoff-empty-note', to: '/note', why: '我在哪儿偏了·我的题为空' },
  ];
  assert.equal(案.length, 3, '前置：夹具数变了');
  const 跑过 = [];
  for (const { 文件, id, to, why } of 案) {
    assert.ok(文件.includes('data-testid="' + id + '"'), why + '：空态缺可点出口（' + id + '）');
    const at = 文件.indexOf('data-testid="' + id + '"');
    const 段 = 文件.slice(Math.max(0, at - 200), at);
    assert.ok(段.includes('to="' + to + '"'), why + '：出口没有指到 ' + to);
    assert.ok(app.includes('path="' + to + '"'), why + '：' + to + ' 在 App.tsx 里不是路由');
    跑过.push(why);
  }
  assert.equal(跑过.length, 案.length, '前置：循环没有跑满');
});

/* ══════════════ ⑧ 形态与总闸 ══════════════ */

test('⑳ FirstRun.tsx 在 70 行以内，且两条常驻条都渲染了（不靠注释充数）', () => {
  const 行数 = firstRunTsx.split('\n').filter((l) => l.trim() !== '').length;
  assert.ok(行数 <= 70, 'FirstRun.tsx 有效行数超 70：' + 行数);
  assert.ok(firstRunTsx.includes('export function OwnershipBar'), '缺归属常驻条组件');
  assert.ok(firstRunTsx.includes('export function FirstRun'), '缺引导条组件');
  // 归属条取不到时**照样渲染一行**（常驻条空着＝"没这一行"，那是在骗人）
  assert.ok(/data-state=\{bad \? 'failed'/.test(firstRunTsx), '归属条没有失败态 ⇒ 后端挂了它就整条消失');
  assert.ok(firstRunTsx.includes('读不出来'), '归属条失败时必须说清读不出来，而不是什么都不说');
  // 引导的可关性：`×` 写本机标记后本组件不再渲染
  assert.ok(/writeGuideOff\(\); setOff\(true\);/.test(firstRunTsx), '`×` 没有真正关掉引导');
  assert.ok(/if \(off\) return null;/.test(firstRunTsx), '关掉后仍渲染（没关成）');
});

test('★㉑ 总闸：引导＋三个回声的全部文案，禁词与铁律②一起过一遍', () => {
  const 文案 = [];
  for (const s of GUIDE_STEPS) { 文案.push(s.title, s.how); }
  const 夹具 = [
    () => homeHeadline(personalState('ready', null, null, null)),
    () => homeHeadline(personalState('ready', 'v_1', { mine: 0, corpus: 294, others: 0, total: 294 }, 0)),
    () => homeHeadline(personalState('ready', 'v_1', { mine: 4, corpus: 290, others: 0, total: 294 }, 2)),
    () => ownershipLine({ mine: 1, corpus: 294, others: 0, total: 295 }, 30),
    () => firstNoteEcho(1, '2026-10-01'),
    () => settleEcho({ ordinal: 1, prob: 0.6, truth: 1 }).text,
    () => deviationEcho(R3_ROWS_1, { minN: 30, resolvedTotal: 1 }).text,
    () => deviationEcho(R3_ROWS_1, { minN: 30, resolvedTotal: 29 }).text,
    () => deviationEcho(R3_ROWS_1, { minN: 30, resolvedTotal: 294 }).text,
  ];
  for (const f of 夹具) 文案.push(f());
  文案.push(EMPTY_LEAD);
  // ★前置：循环真的跑满了（2×4 + 9 + 1 = 18 条文案），一条都不能少
  assert.equal(文案.length, 18, '文案收集数不对（' + 文案.length + '），夹具变了要改这条');
  for (const t of 文案) {
    assert.equal(typeof t, 'string', '文案不是字符串');
    assert.ok(t.trim().length > 0, '文案是空白 —— 空白等于没写');
    for (const w of FORBID_WORDS) assert.equal(t.includes(w), false, '文案含推荐/倾向类禁词「' + w + '」：' + t);
    assert.equal(t.includes(FORBID_WORD), false, '文案含铁律②禁词：' + t);
  }
  // 反向锁：把这批文案清空，本条必须变红（上面那句长度断言就是它的哨兵）
  assert.equal(文案.filter((t) => t.trim() === '').length, 0);
});

/* ★变异注入自证留下的一个真洞（2026-09-30）：把 FORBID_WORDS 清空成 [] 时，
 * 上面 ㉑ 与 ① 全绿——因为「禁词表」是**否证式**断言，表空了自然没人被禁。
 * ⇒ 给这张表本身加一道自检：它必须含有本项目的核心那几个词（推荐/建议/擅长/倾向/优先）。
 *   这不是给测试加信心，是把「谁在守这条线」钉死，否则清表即静默失守。 */
test('㉒ 两张禁词表本身不许被清空（否证式断言的自检）', () => {
  // FORBID_WORDS 守「只指路不判断」：推荐 ＋ 倾向 ＋ 能力断言，五条一个都不能少
  for (const w of ['推荐', '建议', '擅长', '倾向', '优先']) {
    assert.ok(FORBID_WORDS.includes(w),
      'FORBID_WORDS 缺核心词「' + w + '」——这张表是「只指路不判断」的唯一执行者');
  }
  // VERDICT_WORDS 守「n 太小不给倾向性结论」：正反两个方向的判断词都要在
  for (const w of ['乐观', '悲观', '倾向', '擅长', '系统性']) {
    assert.ok(VERDICT_WORDS.includes(w), 'VERDICT_WORDS 缺核心词「' + w + '」——反向锁漏了它');
  }
  assert.ok(FORBID_WORDS.length >= 6, 'FORBID_WORDS 被削到 ' + FORBID_WORDS.length + ' 条');
  assert.ok(VERDICT_WORDS.length >= 6, 'VERDICT_WORDS 被削到 ' + VERDICT_WORDS.length + ' 条');
  assert.equal(FORBID_WORD, '预测', '铁律②禁词被换掉了');
  // 哨兵：两张表非空时，「只指路」与「不给结论」这两句才真的在守线
  assert.equal(FORBID_WORDS.includes('推荐'), true);
  assert.equal(VERDICT_WORDS.includes('乐观'), true);
});
