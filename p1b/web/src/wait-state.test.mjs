/**
 * 等待态闸（2026-09-28 · T2 / 模块 M5）
 *
 * 用户明确要求「回复的时候要转圈等待什么的」。这条不是审美需求：
 * 本产品最核心的动作是**算数**（数同类题历史样本、跑引擎基率），
 * 那是要等网络往返 + 聚合的。
 *
 * ★核心纪律：**转圈必须带说明文字**。空白 + 一个孤零零的圈 = 用户以为坏了。
 *   本闸的第一条就是防它退化——这是"等待态"存在的**全部理由**，
 *   一旦退化，这条闸比那个圈更该被删。
 *
 * 另三条来自"别晃眼"（频次门：每天用几十次 ⇒ 只允许近乎无感）：
 *   ② <400ms 不显示（真快请求配一圈只会闪到用户）
 *   ③ reduced-motion 下**环停转但文案留着**（文案是信息，不是动效）
 *   ④ 失败必须可重试（只报错不给出口＝把问题推给用户）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), 'utf8');
const W = read('components/Wait.tsx');
const CSS = read('styles/wait.css');

test('① ★转圈必须带说明文字（防退化成孤圈）', () => {
  // what 是必填 prop，且渲染进 .wait-msg
  assert.ok(/what\?:\s*string/.test(W) || /what:\s*string/.test(W),
    'what 应是必填 prop——它就是等待存在的理由');
  assert.ok(W.includes('wait-msg'), '文案须渲染进 .wait-msg');
  assert.ok(W.includes('{what ||'), '文案不得为空时渲染成空');
});

test('② <400ms 不显示任何东西（频次门：别晃眼）', () => {
  assert.ok(W.includes('400'), '须有 400ms 延迟阈值');
  assert.ok(/useState\(false\)/.test(W), '初始须为不显示');
  assert.ok(/shown\s*\?\s*\(/.test(W), '须由 shown 条件渲染，pending 但未到 400ms 时返回 null');
});

test('③ reduced-motion：环停转但文案留着（文案是信息）', () => {
  assert.ok(CSS.includes('prefers-reduced-motion'), '缺 reduced-motion 块');
  assert.ok(/\.wait-ring\s*\{[^}]*animation:\s*none/.test(CSS),
    'reduced-motion 下环须停转');
  // ★停转的是环，不是文案——文案不得一起消失
  const block = CSS.slice(CSS.indexOf('prefers-reduced-motion'));
  assert.equal(/\.wait-msg\s*\{[^}]*display:\s*none/.test(block), false,
    '文案不得在 reduced-motion 下被隐藏——它是信息不是动效');
});

test('④ 失败必须可重试（只报错不给出口＝把问题推给用户）', () => {
  assert.ok(W.includes('wait--error'), '须有失败态');
  assert.ok(W.includes('onRetry'), '须支持重试回调');
  assert.ok(W.includes('重试'), '须渲染重试键');
});

test('⑤ 四个页面都接了（横切，不是逐页各做）', () => {
  const pages = ['NotePage', 'ResolvePage', 'WhereOffPage', 'HomePage'];
  for (const p of pages) {
    const src = read('pages/' + p + '.tsx');
    assert.ok(src.includes('<Wait'), p + ' 未接 <Wait>（等待态须四页统一，不逐页各做）');
  }
});

test('⑥ 等待文案要说清「在等什么」，不许笼统', () => {
  // 每页的文案必须具体到动作，不能全是「加载中」
  const expect = {
    NotePage: '在数同类题的历史样本',
    ResolvePage: '在读账本',
    WhereOffPage: '在算你在哪儿偏了',
    HomePage: '在读账本',
  };
  for (const [p, frag] of Object.entries(expect)) {
    const src = read('pages/' + p + '.tsx');
    assert.ok(src.includes(frag), p + ' 的等待文案须具体（缺「' + frag + '」）');
  }
});

/* ══ 2026-09-28 补：T2 首版踩到的静默失效 ══
 * 病象：Wait.tsx **漏了 `import '../styles/wait.css'`**。
 *   后果链极隐蔽：Vite 不报错、`node --test` 全绿（本文件 ①–⑥ 条查的都是**文件内容**，
 *   样式写在 .css 里当然查得到）⇒ 看起来一切正常，
 *   但浏览器里等待圈是**完全没样式的裸 div**——没有环、没有动画，只有文字。
 *   ★这是「测试全绿但功能是死的」最典型的一种：闸查错了层。
 * 本条改成查**真实的引用关系**，并与构建产物交叉验证。 */
test('⑦ ★组件必须真的 import 自己的样式（漏了不会报错、测试照绿、功能是死的）', () => {
  assert.ok(/import\s+['"][^'"]*wait\.css['"]/.test(W),
    'Wait.tsx 未 import wait.css —— Vite 不报错、测试也全绿，但页面上等待圈没有样式');

  // 交叉验证：样式类名必须真的进了构建产物
  const fs = require('node:fs');
  const distDir = join(dir, '..', 'dist', 'assets');
  if (fs.existsSync(distDir)) {
    const css = fs.readdirSync(distDir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(join(distDir, f), 'utf8'))
      .join('\n');
    for (const cls of ['wait-ring', 'wait-spin', 'wait-msg', 'wait--error', 'wait-slow']) {
      assert.ok(css.includes(cls), '构建产物里找不到 ' + cls + ' —— 样式没被打进去');
    }
  }
});
