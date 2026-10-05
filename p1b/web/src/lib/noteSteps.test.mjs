/**
 * 记一笔页步进指示闸（2026-09-30 · 创始人实测「我在填在这一步但是页面不会变」）
 *
 * 【病象：不是 bug，是缺一个指示】
 *   那一屏**没有 bug**：选 kind 触发的 `phase: idle → freq → done` 一直跑得好好的。
 *   缺的是「走到哪一步了」这句话——页面上没有任何一处说得出来。
 *   于是用户看着"没反应的页面"猜，而不是看着指示知道自己站在哪。
 *
 * 【本闸怎么验：禁新依赖（不许 jsdom / Testing Library）】
 *   判定与文案抽进纯函数 lib/noteSteps.ts（与 noteWait / noteProb / noteLookup 同款做法），
 *   前 7 条**真 import 纯函数**跑行为；后 3 条只证明它**插上了**（插线是插线，行为是行为）。
 *   ★渲染级的那一条走 esbuild + react-dom/server（都已在盘上，零新依赖），
 *     真把 NotePage 渲染成 HTML 再查 data-* 属性——它比源码断言强，
 *     因为源码断言分不出"写了 data 属性"和"真的挂在了那个节点上"。
 *
 * 【三条不许破的线，各有各的闸】
 *   ① assigned_prob 只有一个来源 ⇒ ⑦ 步进指示里不许出现任何读数的**值**（rate/n/percent）
 *   ② 第二步是读数不是建议 ⇒ ④ 禁词（与 firstRun.ts 的 FORBID_WORDS 同一条纪律）
 *   ③ 拒收门不许降级 ⇒ ⑧ 指示器是"读的"不是"判的"：submitGuard 只被读，放行权不动
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stepsViewOf, STEP_ORDER } from './noteSteps.ts';
import { waitWhatOf } from './noteWait.ts';
import { submitGuard } from './noteProb.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), 'utf8');
const page = read('../pages/NotePage.tsx');
const css = read('../styles/note.css');
const stepsSrc = read('noteSteps.ts');

/** 一份"什么都有了"的输入，逐项覆盖用（每个用例只改自己关心的那几项）。 */
const FULL = {
  statement: '2026-09-30 伦敦日降水量超过 20mm 吗？',
  kind: 'imera_precipitation_daily',
  phase: 'done',
  myProb: '62',
  lookup: {
    known: true, kind: 'imera_precipitation_daily', layer: 'L3', engine: 'e', totalN: 41,
    base: { n: 41, hit: 12, rate: 0.2927, enough: true, note: '' },
    reason: '', hint: '',
  },
  busy: false,
};
const at = (over) => stepsViewOf({ ...FULL, ...over });

/** 与 firstRun.ts 的 FORBID_WORDS 同一条纪律（那边是 test 内私有的，这里独立复刻一份，
    免得本文件去 import 另一个 test 文件——那会把两个闸的失败混成一条）。 */
const FORBID_WORDS = ['推荐', '建议', '应该先', '优先', '擅长', '倾向', '你准', '可靠'];

test('① 三步齐全、顺序固定、序号 1..3（页面上的 ①②③ 与此同源）', () => {
  const v = at({});
  assert.equal(v.steps.length, 3, '应为三步，实得 ' + v.steps.length);
  assert.deepEqual(v.steps.map((s) => s.id), STEP_ORDER, '三步的顺序变了');
  assert.deepEqual(v.steps.map((s) => s.n), [1, 2, 3], '序号必须是 1..3');
  for (const s of v.steps) {
    assert.ok(s.label && s.label.trim(), s.id + ' 缺标签（空白标签在页面上就是一个空圆点）');
    assert.ok(s.note && s.note.trim().length > 0, s.id + ' 这一步没有话：空白＝用户以为坏了');
    assert.ok(['todo', 'now', 'done', 'blocked'].includes(s.state), s.id + ' 非法状态 ' + s.state);
  }
});

test('★② phase idle → freq → done：三档各有各的样子，且逐档可机读地不同', () => {
  // 病象就在这三档之间：从"刚选中"到"查完了"，页面上此前**一模一样**。
  const idle = at({ phase: 'idle', lookup: null });
  const freq = at({ phase: 'freq', lookup: null });
  const done = at({});
  const h = (v) => v.steps.find((s) => s.id === 'history');

  // 逐档断言**状态**变了（这才是"页面会动"的实质）
  assert.equal(h(idle).state, 'now', '刚选中：还没发请求，不许说"在等"');
  assert.equal(h(freq).state, 'now', '取数中：这一步正在进行');
  assert.equal(h(done).state, 'done', '查完了：这一步走完');

  // ★idle 与 done 两档的话必须不同——只有状态相同的话才是"页面不会变"
  assert.notEqual(h(idle).note, h(done).note, 'idle 与 done 说同一句话＝用户看不出页面动过');
  assert.notEqual(h(freq).note, h(done).note, 'freq 与 done 说同一句话＝查完了没有提示');

  // 机读的整体签名（at + phase + ready）也必须逐档不同
  const sig = (v) => [v.at, v.phase, v.ready, v.steps.map((s) => s.state).join(',')].join('|');
  const sigs = [idle, freq, done].map(sig);
  assert.equal(new Set(sigs).size, 3, '三档的机读状态必须两两不同，实得：\n' + sigs.join('\n'));
});

test('★③ ★取数失败不许被画成"查完了"（phase 也是 done，所以单看 phase 判不出来）', () => {
  /* 这是本轮刻意加的第四档 blocked 的全部理由：
     NotePage 在取数失败时走 `setLookup(null); setPhase('done')`——phase 与成功时一模一样。
     只分 done/todo 的话，"这次没查到"会被画成"走完了"，而这两件事的下一步完全不同
     （换一栏题源才会重查 vs 可以往下填）。 */
  const failed = at({ phase: 'done', lookup: null });
  const ok = at({});
  const h = (v) => v.steps.find((s) => s.id === 'history');
  assert.equal(h(failed).state, 'blocked', '查不到 ≠ 查完了');
  assert.equal(h(ok).state, 'done', '查到了才是 done（对照组：别把两档都判成 blocked）');
  assert.notEqual(h(failed).note, h(ok).note, '两档的话必须不同');
  assert.ok(/换一个/.test(h(failed).note), 'blocked 必须说清怎么解开（换一栏题源会重查）：' + h(failed).note);
  // blocked 停在原地，不许被算成进度
  assert.equal(failed.at, 2, 'blocked 时"现在在第几步"应停在第 2 步，不许跳过它');
});

test('★④ 禁词：步进指示里不许出现 推荐／建议／擅长／倾向 这类词（第二步是读数不是建议）', () => {
  /* 纪律②：账本给的是「同类题历史频率」这个客观读数（事实），不是"你该怎么想"（判断）。
     混起来，产品就变成"系统替你判断"——而本产品存在的理由恰恰是人自己押。 */
  // 把三步在**所有档位**下的话全收集一遍再查（只查一档＝只查了幸运的那一半）
  const inputs = [];
  for (const kind of ['', 'k1']) {
    for (const phase of ['idle', 'freq', 'done']) {
      for (const lookup of [null, FULL.lookup, { ...FULL.lookup, known: false }, { ...FULL.lookup, base: null }]) {
        for (const myProb of ['', '62', 'abc']) {
          for (const busy of [false, true]) {
            inputs.push({ statement: FULL.statement, kind, phase, myProb, lookup, busy });
          }
        }
      }
    }
  }
  // ★不许空跑：先钉住"这个循环真的跑出了东西"，否则下面那句恒真的 for 什么都能放过
  assert.equal(inputs.length, 2 * 3 * 4 * 3 * 2, '组合数对不上，穷举本身写错了：' + inputs.length);
  assert.ok(inputs.length >= 100, '穷举样本太少，等于没穷举：' + inputs.length);

  const hits = [];
  let 话数 = 0;
  for (const i of inputs) {
    const v = stepsViewOf(i);
    for (const s of v.steps) {
      assert.ok(s.note && s.note.trim(), '空话：' + JSON.stringify(i));   // 同上：先钉住非空
      话数++;
      for (const w of FORBID_WORDS) {
        if (s.note.includes(w)) hits.push(s.id + ' 含禁词「' + w + '」：' + s.note);
      }
    }
    for (const w of FORBID_WORDS) {
      if (v.headline.includes(w)) hits.push('headline 含禁词「' + w + '」：' + v.headline);
    }
  }
  // ★再钉一次计数：证明上面那个双层循环真的逐句查了（不是查了个空数组）
  assert.equal(话数, inputs.length * 3, '逐句检查的次数对不上：' + 话数);
  assert.ok(话数 > 300, '实际检查的话太少：' + 话数);
  assert.deepEqual(hits, [], '步进指示里出现禁词（第二步是读数，不是建议）：\n' + hits.join('\n'));
});

test('★⑤ ★assigned_prob 只有一个来源：指示器里不许出现读数的**值**', () => {
  /* 纪律①：页面上任何"顺手把 62% 显示出来"的写法都会让显示层长出第二个数来源。
     本文件刻意只判"填没填合法"，不读值——所以把一个极端的 rate 灌进来，
     指示器里也不该冒出这个数。 */
  const wild = {
    ...FULL,
    lookup: { ...FULL.lookup, base: { n: 999, hit: 731, rate: 0.7319, enough: true, note: '' } },
  };
  const v = at({ lookup: wild.lookup });
  const 全话 = [...v.steps.map((s) => s.note), v.headline, v.lacking].join('\n');
  for (const s of ['73', '731', '999', '0.73', '73.19']) {
    assert.equal(全话.includes(s), false,
      '步进指示里出现了读数的值「' + s + '」：' + 全话 + '\n★显示层不许长出第二个数来源。');
  }
  // 对照：判据的**有无**可以说（"读数出来了"），这跟"读数是多少"是两件事
  assert.ok(/读数出来了/.test(v.steps.find((s) => s.id === 'history').note),
    '该说的是"读数出来了"（有无），不是它等于多少');
});

test('⑥ 口径单一真源：与 <Wait> 同源、与 submitGuard 同源（不许另造第二套话）', () => {
  /* 病象的另一半：文案两处各写一遍，迟早有一处忘了改，而用户会看到两个打架的说法。 */
  const freq = at({ phase: 'freq', lookup: null });
  const h = freq.steps.find((s) => s.id === 'history');
  assert.equal(h.note, waitWhatOf({ busy: false, phase: 'freq' }),
    '「在数…」必须直接取 waitWhatOf，不许另写一句');
  const busy = at({ busy: true, phase: 'done' });
  assert.equal(busy.headline, waitWhatOf({ busy: true, phase: 'done' }),
    '登记段必须直接取 waitWhatOf 的提交口径');
  // "还差什么"取 submitGuard 的 why：同一个返回值 ⇒ 指示器与闸不可能各说各话
  for (const over of [
    { statement: '', kind: '', myProb: '' },
    { statement: 'x', kind: '', myProb: '62' },
    { statement: 'x', kind: 'k', myProb: '' },
  ]) {
    const v = at(over);
    const g = submitGuard(over);
    assert.equal(v.lacking, g.ok ? '' : g.why,
      '「还差什么」与 submitGuard 的 why 不是同一句：' + JSON.stringify(over));
    assert.equal(v.ready, g.ok, 'ready 必须就是 submitGuard 的放行结果');
  }
});

test('⑦ 三态的 headline 各不相同、恒非空（顶部那一行是常驻的，不能是空壳）', () => {
  const hs = [
    at({ kind: '', phase: 'idle', lookup: null, myProb: '' }).headline,
    at({ kind: 'k', phase: 'freq', lookup: null, myProb: '' }).headline,
    at({}).headline,
  ];
  // ★先钉住非空，否则"三态互不相同"这条在空串上也能过
  for (const h of hs) assert.ok(h && h.trim(), 'headline 是空的');
  assert.equal(new Set(hs).size, 3, 'headline 必须三态不同，实得：\n' + hs.join('\n'));
  assert.ok(/第 \d 步 \/ 共 3 步/.test(hs[2]), '常态那句须说清"第几步/共几步"：' + hs[2]);
});

test('★⑧ 接线：NotePage 真把它渲染出来了，且喂的是同一个 phase', () => {
  /* 文本扫描只证明"插上了"，不证明行为——行为在 ①～⑦（真 import 纯函数）。
     ★不许动 assigned_prob：提交那段的 prob 仍必须是 submitGuard 放行的那个值。 */
  assert.ok(/import\s*\{[^}]*stepsViewOf[^}]*\}\s*from\s*'\.\.\/lib\/noteSteps'/.test(page),
    'NotePage 未 import stepsViewOf（纯函数对、页面不接＝白修）');
  assert.ok(page.includes('<NoteSteps'), 'NotePage 未渲染 <NoteSteps>');

  /* ★"同一个 phase"是接线的核心：另造一份 phase（或从别处重新推一遍）
     就会出现"指示器说在第二步、<Wait> 说在数"——两个真相各说各话。
     这里按真实形状断言：调用点必须把本页那个 phase state 原样递进去。 */
  const callAt = page.indexOf('stepsViewOf({');
  assert.ok(callAt > 0, 'NotePage 未调用 stepsViewOf');
  const call = page.slice(callAt, page.indexOf('})', callAt) + 2);
  assert.ok(/(^|[{,\s])phase\s*[},]/.test(call),
    'stepsViewOf 的入参里必须有本页那个 phase（不许另造/重推）：' + call);
  assert.equal(/phase\s*:\s*['"]/.test(call), false,
    'phase 必须是 state 本身，不许写死一个字符串：' + call);

  // 组件只收 view 一个 prop ⇒ 显示层在**类型上**就长不出第二个数来源（纪律①）
  const seg = page.slice(page.indexOf('<NoteSteps'), page.indexOf('<NoteSteps') + 200);
  assert.ok(/view=\{steps\}/.test(seg), '<NoteSteps> 必须只吃 stepsViewOf 的结果：' + seg);
  assert.equal(/base|rate|\bnumber\b/.test(seg), false,
    '不许把读数喂给组件：' + seg);
  assert.ok(page.includes('data-testid="note-steps"') || page.includes("testId=\"note-steps\"")
    || read('../components/NoteSteps.tsx').includes('data-testid={testId}'),
    '步进指示须可被测试定位');
  // ① assigned_prob 的来源没被动过
  const s = page.slice(page.indexOf('const submit'), page.indexOf('const submit') + 1400);
  assert.ok(/submitGuard\(/.test(s), 'submit 里那道闸不许被删');
  assert.ok(/prob:\s*v\.prob/.test(s), '落注的 prob 仍须是 submitGuard 放行的那个值（0-1）');
  assert.equal(/prob:\s*base\??\.rate/.test(page), false, '不许把历史频率当用户的数');
  // ③ 指示器不许变成闸：它只准读 submitGuard 的结果，不许自己判
  const c = read('noteSteps.ts');
  const comp = read('../components/NoteSteps.tsx');
  assert.equal(/disabled=/.test(comp), false, '组件里不许出现 disabled（指示器是纯展示，不参与放行）');
  assert.equal(/onClick|onSubmit/.test(comp), false, '指示器不许有交互（它是"说"，不是"做"）');
  assert.ok(/submitGuard\(/.test(c), '「还差什么」必须取 submitGuard 的 why（同一个真源）');
  assert.equal(/setBusy|api\./.test(c), false, '纯函数里不许有任何副作用（发请求/改 state）');
});

test('★⑨ 渲染级：真把 <NoteSteps> 渲染成 HTML，data-* 挂在节点上（不是只写在源码里）', async () => {
  /* 源码断言分不出"写了 data 属性"和"真挂在了那个节点上"。
     这里走 esbuild + react-dom/server（都已在盘上，零新依赖）真渲染一次。 */
  const require_ = createRequire(import.meta.url);
  const esbuild = require_(join(dir, '..', '..', 'node_modules', 'esbuild'));
  const src = read('../components/NoteSteps.tsx');
  // ★resolveDir 必须是组件自己所在的目录：组件 import 了 '../styles/note.css'，
  //   resolveDir 给错的话 esbuild 报 "Could not resolve"——那是本闸的路径写错，
  //   不是组件的样式 import 写错了。两者症状一样，来源不同。
  const compDir = join(dir, '..', 'components');
  const built = esbuild.buildSync({
    stdin: { contents: src, resolveDir: compDir, loader: 'tsx' },
    bundle: true, format: 'esm', platform: 'node', write: false,
    /* ★必须 jsx:'automatic'：本项目 tsconfig 用的是 "react-jsx"（自动运行时），
       而 esbuild 的 tsx loader 默认是 classic（React.createElement）。
       不显式对齐的话产物里会去找一个作用域外的 `React` —— 报 "React is not defined"，
       那不是组件的错，是这里用错了转译目标。 */
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
    loader: { '.css': 'empty' },
    target: 'es2020',
  });
  // 产物里必须真的有那段 JSX（防"esbuild 静默产出空模块"这种永远绿的测法）
  assert.ok(built.outputFiles[0].text.includes('note-step-state'),
    'esbuild 产物里找不到渲染代码，渲染级断言会永远绿');
  // 走真文件：把产物落到磁盘再 import（Node 对 data: URL 的模块解析不稳）
  const tmp = join(dir, '..', '..', '.noteSteps.render.' + process.pid + '.mjs');
  const { writeFileSync, rmSync } = require_('node:fs');
  writeFileSync(tmp, built.outputFiles[0].text, 'utf8');
  let mod, renderToStaticMarkup, React;
  try {
    mod = await import(/* @vite-ignore */ 'file:///' + tmp.replace(/\\/g, '/'));
    ({ renderToStaticMarkup } = await import('react-dom/server'));
    React = (await import('react')).default;
  } finally {
    rmSync(tmp, { force: true });
  }

  const html = (over) => renderToStaticMarkup(
    React.createElement(mod.NoteSteps, { view: at(over), testId: 'note-steps' }),
  );

  // 三个 phase 各渲染一次
  const idle = html({ phase: 'idle', lookup: null });
  const freq = html({ phase: 'freq', lookup: null });
  const done = html({});

  for (const [名, h] of [['idle', idle], ['freq', freq], ['done', done]]) {
    assert.ok(h && h.length > 200, 名 + ' 渲染结果过短，疑似空壳：' + h);
    assert.ok(h.includes('data-testid="note-steps"'), 名 + ' 渲染结果里没有 data-testid');
    assert.ok(/data-note-at="\d"/.test(h), 名 + ' 缺 data-note-at（机读位置）');
    assert.ok(/data-note-phase="(idle|freq|done)"/.test(h), 名 + ' 缺 data-note-phase');
    assert.ok(/data-note-ready="(yes|no)"/.test(h), 名 + ' 缺 data-note-ready');
    // 三个 step 节点各自带 state
    for (const id of ['kind', 'history', 'judgement']) {
      assert.ok(new RegExp('data-note-step="' + id + '"').test(h), 名 + ' 缺步骤节点 ' + id);
      assert.ok(new RegExp('data-note-step-state="(todo|now|done|blocked)"').test(h), 名 + ' 缺 step state');
    }
  }
  // ★核心断言：idle 与 done 的**渲染结果**必须不同（不止是纯函数返回值不同）
  assert.notEqual(idle, done, '★phase=idle 与 phase=done 渲染出同一份 HTML：' + idle);
  assert.notEqual(freq, done, 'phase=freq 与 phase=done 渲染出同一份 HTML');
  // 三档互不相同
  assert.equal(new Set([idle, freq, done]).size, 3, '三档渲染结果必须互不相同');
  // 失败那档渲染出的是 blocked，不是 done
  const failed = html({ phase: 'done', lookup: null });
  assert.ok(/data-note-step="history"[^>]*data-note-step-state="blocked"/.test(failed) ||
            /data-note-step-state="blocked"[^>]*data-note-step="history"/.test(failed),
    '查不到那档渲染出来必须是 blocked：' + failed);
});

test('⑩ 样式纪律：走 token、不遮挡内容、守 prefers-reduced-motion', () => {
  const seg = css.slice(css.indexOf('.note-steps'), css.indexOf('.note-steps') + 2600);
  assert.ok(seg.length > 200, 'note.css 里没有 .note-steps 规则（指示器没样式＝裸 div）');
  // 不许硬编码色值（发行闸 C1/C3 会照红）
  assert.equal(/#[0-9a-fA-F]{6}\b/.test(seg), false, 'note-steps 里不许硬编码 6 位色值');
  assert.ok(/var\(--/.test(seg), '颜色须走 var(--token)');
  // 不许遮挡内容：绝不能是 fixed/absolute 盖在别人上面
  assert.equal(/position:\s*fixed/.test(seg), false, '步进指示不许 fixed（会盖住内容）');
  assert.equal(/z-index:\s*\d/.test(seg), false, '步进指示不许抬 z-index（会盖住内容）');
  // 动效纪律：reduced-motion 下必须真的停
  const mq = seg.slice(seg.indexOf('prefers-reduced-motion'));
  assert.ok(mq.length > 0, '步进指示的动效没有 prefers-reduced-motion 处理');
  assert.ok(/animation:\s*none/.test(mq), 'reduced-motion 下须 animation: none（不是只缩短时长）');
  // 源码里也不许留假端点串（发行闸 C3）
  assert.equal(/[a-z][a-z0-9+.-]*:\/\/[^\s]*:\d{2,5}/i.test(stepsSrc), false,
    'noteSteps.ts 注释里出现了形似真端点的串（发行闸 C3 会照红）');
});
