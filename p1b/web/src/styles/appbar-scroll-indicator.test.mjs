import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 顶栏横滚指示条闸（2026-09-30 · SPEC-ci-landing-mobile 模块 3 第 1 条）
 *
 * 病症（实测来源：`p1b6.css` 原第 22-31 行的注释与 SPEC-ci-landing-mobile.md:100-102）：
 *   `.appbar-nav` 自带 `overflow-x: auto`（窄屏 360px 下 5 项放不下，靠它不撑破整页），
 *   同时 `scrollbar-width: none` ＋ `::-webkit-scrollbar { height: 0 }` 把滚动条整个藏掉。
 *   ⇒ 顶栏在手机上仍然溢出，但**溢出这件事没有任何可见痕迹**：
 *     陌生人只看到「待落定」四个字，不知道右边还压着「记一笔／我在哪儿偏了／现场」。
 *   滚动条是这条横路唯一的路标，藏起来等于把路牌也拆了。
 *
 * 本闸钉住的不变量（把「3px 淡色指示条」从一句愿望变成可机检的事实）：
 *   ① 指示条存在：不再有把滚动条归零/隐藏的写法
 *   ② 高度恰为 3px（不是 0，也不是 auto／thin 之类的模糊值）
 *   ③ 滑块有可见底色、轨道透明 ⇒ 「有东西可看」而不是「画了个空壳」
 *   ④ 滑块色走令牌（不写死色值），且该令牌在深色现场模式下被重定义 ⇒ 一套色两处都对
 *   ⑤ 防溢出兜底没被这次改动弄坏（overflow-x: auto 与 min-width: 0 仍在同一条基础规则里）
 *
 * ★解析口径：用**规则解析器**取声明，不按固定字符窗口切源码
 *   （`slice(i, i+N)` 那种窗口量的是魔数不是行为，改个注释长度就误报/漏报）。
 * ★防空跑绿灯：① 先自证解析器**确实找到了目标规则**（条数与关键声明非空），
 *   再逐条判不变量；否则「选择器改名 ⇒ 一条都匹配不到」会安静地全绿。
 */
const here = dirname(fileURLToPath(new URL('./p1b6.css', import.meta.url)));
const css = readFileSync(join(here, 'p1b6.css'), 'utf8');
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

/** 注释替换成等行数空格：保住偏移与换行，又不让注释里的字样冒充声明。 */
function 去注释(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * 极小 CSS 规则解析器：把样式表拆成 {selector, media[], body} 列表。
 * 不用正则去猜块边界 —— 逐字符走大括号，@media/@supports 进栈、规则出栈。
 * （本仓 CSS 不含 content:"{" 这类带大括号的字符串值；真出现时该规则体会被切错。）
 */
function 解析规则(src) {
  const s = 去注释(src);
  const out = [];
  const 媒体栈 = [];
  let buf = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      const sel = buf.trim();
      buf = '';
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        j++;
      }
      const body = s.slice(i + 1, j - 1);
      if (sel.startsWith('@')) {
        if (/^@(media|supports)\b/i.test(sel)) 媒体栈.push(sel);
      } else {
        for (const one of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
          out.push({ selector: one, media: 媒体栈.slice(), body });
        }
      }
      i = j;
      continue;
    }
    if (ch === '}') {
      媒体栈.pop();
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  return out;
}

const 规则 = 解析规则(css);

/** 取某选择器的全部规则（可按是否在媒体查询内筛） */
function 取规则(selector, { 顶层 = null } = {}) {
  return 规则.filter((r) => r.selector === selector && (顶层 === null || (r.media.length === 0) === 顶层));
}

/**
 * 合并一条选择器的声明：文档序在后者覆盖前者（同优先级下 CSS 就是这个语义）。
 * 返回 Map(prop -> value) 与 prop 出现次数 Map(prop -> n)。
 */
function 合并声明(rs) {
  const 值 = new Map();
  const 次数 = new Map();
  for (const r of rs) {
    for (const decl of r.body.split(';')) {
      const c = decl.indexOf(':');
      if (c < 0) continue;
      const prop = decl.slice(0, c).trim();
      const val = decl.slice(c + 1).trim();
      if (!prop) continue;
      值.set(prop, val);
      次数.set(prop, (次数.get(prop) || 0) + 1);
    }
  }
  return { 值, 次数 };
}

test('① 前置：解析器确实找到了 .appbar-nav 的规则（防空跑绿灯）', () => {
  assert.ok(规则.length > 20, `样式表只解析出 ${规则.length} 条规则，解析器多半坏了`);
  const nav = 取规则('.appbar-nav', { 顶层: true });
  assert.ok(nav.length >= 1, '未找到顶层 .appbar-nav 规则（选择器被改名 ⇒ 下面几条会全绿假象）');
  const { 值 } = 合并声明(nav);
  assert.equal(值.get('overflow-x'), 'auto', '前置不成立：.appbar-nav 基础规则里没有 overflow-x: auto');
  assert.ok(值.has('scrollbar-width'), '前置不成立：.appbar-nav 基础规则里没有 scrollbar-width 声明');
  // 指示条那两条 ::-webkit-scrollbar 规则也必须在（否则下面的高度断言是无中生有）
  assert.ok(取规则('.appbar-nav::-webkit-scrollbar').length >= 1, '未找到 .appbar-nav::-webkit-scrollbar 规则');
  assert.ok(取规则('.appbar-nav::-webkit-scrollbar-thumb').length >= 1, '未找到 thumb 规则');
});

test('② 滚动条不再被归零：Firefox 走 thin、WebKit 走 3px', () => {
  const nav = 合并声明(取规则('.appbar-nav', { 顶层: true })).值;
  assert.notEqual(nav.get('scrollbar-width'), 'none', 'scrollbar-width 回到 none ⇒ 指示条又被藏了');
  // Firefox 侧应为 thin（本仓唯一可用的另一档：auto/thin/none 三选一，且没有自定义尺寸的 API）
  assert.equal(nav.get('scrollbar-width'), 'thin', 'Firefox 侧应为 thin');

  const bar = 合并声明(取规则('.appbar-nav::-webkit-scrollbar')).值;
  // 3px 是 spec 的字面要求：不能是 0（=藏）、不能是 auto/thin（=没定量）
  assert.equal(bar.get('height'), '3px', 'WebKit 滚动条高度必须是 3px（spec：3px 淡色指示条）');
  assert.equal(取规则('.appbar-nav::-webkit-scrollbar').filter((r) => r.body.includes('height: 0')).length, 0,
    '.appbar-nav::-webkit-scrollbar 里不得再出现 height: 0');
});

test('③ 滑块有可见底色、轨道透明（是路标，不是空壳）', () => {
  const thumb = 合并声明(取规则('.appbar-nav::-webkit-scrollbar-thumb')).值;
  const track = 合并声明(取规则('.appbar-nav::-webkit-scrollbar-track')).值;
  assert.ok(thumb.has('background'), 'thumb 缺 background ⇒ 画出来是透明的，等于没画');
  assert.notEqual(thumb.get('background'), 'transparent', 'thumb 底色不能是 transparent');
  assert.equal(track.get('background'), 'transparent', '轨道应透明，否则 3px 变成一条实心灰带');
});

test('④ 滑块色走令牌，且该令牌在深色现场模式下被重定义（一套色两处都对）', () => {
  const thumb = 合并声明(取规则('.appbar-nav::-webkit-scrollbar-thumb')).值;
  const bg = thumb.get('background');
  assert.match(bg, /var\(--/, `滑块底色未走令牌（palette-single-source 纪律）：${bg}`);
  const 引用 = [...bg.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
  assert.ok(引用.includes('muted'), `滑块色应挂在 --muted 上（深浅两套都已定义），实际：${引用.join(',') || '无'}`);

  // --muted 必须在 [data-mode="live"] 下被重定义，否则深色现场页上指示条仍取浅色值。
  // ★两个作用域要分别取：`:root` 与 `[data-mode="live"]` 都是顶层规则（不在 @media 内），
  //   少取一个就退化成「undefined === undefined」的空断言。
  // ★键名带 `--` 前缀：合并声明保留原属性名，`get('muted')` 取不到。
  const 令牌规则 = 解析规则(tokens);
  const 浅的 = 合并声明(令牌规则.filter((r) => r.selector === ':root')).值;
  const 深的 = 合并声明(令牌规则.filter((r) => r.selector === '[data-mode="live"]')).值;
  assert.match(浅的.get('--muted') || '', /^#[0-9a-fA-F]{6}$/, 'tokens.css 的 :root 缺 --muted（前置失效）');
  assert.match(深的.get('--muted') || '', /^#[0-9a-fA-F]{6}$/, 'tokens.css 的 [data-mode="live"] 缺 --muted（前置失效）');
  assert.notEqual(深的.get('--muted'), 浅的.get('--muted'),
    '[data-mode="live"] 与 :root 的 --muted 相同 ⇒ 深色页上指示条不会被重新取值');
});

test('⑤ 防溢出兜底没被这次改动弄坏（滚动条与 overflow 在同一条基础规则里）', () => {
  const nav = 合并声明(取规则('.appbar-nav', { 顶层: true })).值;
  assert.equal(nav.get('overflow-x'), 'auto', '.appbar-nav 丢了 overflow-x: auto ⇒ 窄屏会撑破整页');
  assert.equal(nav.get('min-width'), '0', '.appbar-nav 丢了 min-width: 0 ⇒ flex 子项不会收缩到内容以下');
  assert.equal(nav.get('overflow-y'), 'hidden', '.appbar-nav 的纵向溢出应保持 hidden');
});
