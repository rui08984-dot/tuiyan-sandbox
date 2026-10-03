'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
/**
 * 局鉴 · test/render.test.cjs —— ★四个视图真渲染一遍（最小 DOM 桩）
 *
 * ══ 为什么需要它 ═════════════════════════════════════════════════════════
 *   局鉴的前端**没有构建步骤**，所以没有类型检查、没有打包期报错。
 *   一句 `game.name`（真实字段是 `game.game.name`）不会让任何工具变红 ——
 *   它只会让页面标题**空着**，而页面照常渲染，看起来一切正常。
 *
 *   这类 bug 我已经真踩了两次：
 *     ① `replaceChildren(数组)` ⇒ 整页渲染成 "[object HTMLDivElement]"
 *     ② `games.get()` 返回 `{game, players}`，视图直接读 `.name` ⇒ 标题空着
 *   两次都是「看起来跑起来了，只有把页面渲染出来才看得见」。
 *
 *   ⇒ 用一个最小 DOM 桩把四个视图对着**真服务**渲染一遍，
 *     断言产出的文本里不出现 undefined / [object / NaN。
 *     这不是「快照测试」（那样改一行文案就红），而是**冒烟级**的结构检查。
 */

// ── 最小 DOM 桩 ─────────────────────────────────────────────────────────
class StubNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this._class = '';
    this._text = '';
    this._listeners = {};
  }
  get className() { return this._class; }
  set className(v) { this._class = v; }
  get classList() {
    const self = this;
    return {
      add: (...c) => { c.forEach((x) => { if (!self._class.split(' ').includes(x)) self._class += (self._class ? ' ' : '') + x; }); },
      remove: (c) => { self._class = self._class.split(' ').filter((x) => x && x !== c).join(' '); },
      toggle: (c, on) => { if (on) self.classList.add(c); else self.classList.remove(c); },
      contains: (c) => self._class.split(' ').includes(c),
    };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  removeEventListener() {}
  appendChild(kid) { if (kid === undefined || kid === null) throw new Error('appendChild(undefined)'); this.children.push(kid); return kid; }
  replaceChildren(...kids) { this.children = kids.filter(Boolean); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerText() { return this.textContent; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this.textContent = v; }
  /** 递归摊平成纯文本，供断言用。
   *  ★用鸭子类型（有没有 dump）而不是 instanceof —— 文本节点 StubText 不是
   *   StubNode 的实例，instanceof 会把它当普通对象 String() 掉，
   *   于是整个视图渲染成一串 [object Object]。
   *  ★这坑我踩了一次：第一版跑出来满屏 [object Object]，
   *   一度以为是自己写的 h() 又坏了。教训：先怀疑桩，再怀疑被测对象 ——
   *   因为桩的错误症状和被测对象的 bug 长相一模一样。 */
  dump() {
    return this.children.map((c) => (c && typeof c.dump === 'function' ? c.dump() : String(c))).join('')
      + (this.children.length ? '' : this._text);
  }
}

class StubText {
  constructor(s) { this._text = String(s); }
  get textContent() { return this._text; }
  get innerHTML() { return this._text; }
  dump() { return this._text; }
}

function installDom() {
  const doc = {
    createElement: (t) => new StubNode(t),
    createTextNode: (t) => new StubText(t),
    // ★app.js 在模块顶层就会跑一次 render()，它要拿 #app 那个节点。
    //   桩返回 null 会让模块加载就抛 'Cannot read properties of null'。
    querySelector: () => new StubNode('div'),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: new StubNode('body'),
    head: new StubNode('head'),
  };
  const win = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: '#/', pathname: '/', search: '' },
    history: { replaceState: () => {} },
    scrollTo: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  global.document = doc;
  global.window = win;
  global.location = win.location;
  global.history = win.history;
  global.localStorage = win.localStorage;
  global.Node = StubNode;
  global.scrollTo = () => {};
  return { doc, win };
}

function texts(node) {
  return node instanceof StubNode ? node.dump() : String(node || '');
}

const has = (node, needle) => texts(node).includes(needle);

// 四个视图在模块顶层被 import（它们会缓存），所以要在装好 DOM 桩之后再取。
// 而 node:test 必须在文件开头就拿 —— 模块加载顺序两件事都要满足。


// ── 真服务 + 桩 DOM，把视图渲染一遍 ────────────────────────────────────
test('★① 四个视图都能渲染出内容，不含 undefined / [object / NaN', async (t) => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  t.after(() => app.close());

  // 造一局真数据：两个座位都跳预言家 → 必有对跳
  const g = (await app.inject({
    method: 'POST', url: '/api/games',
    payload: { name: '渲染测试局', type: 'werewolf', player_count: 8 },
  })).json();
  const gid = g.game.id;
  for (const [seat, role] of [[3, '预言家'], [6, '预言家']]) {
    const m = (await app.inject({
      method: 'POST', url: `/api/games/${gid}/events/macro`,
      payload: { kind: 'claim_role', seat, role, day: 2 },
    })).json();
    await app.inject({
      method: 'POST', url: `/api/games/${gid}/events/confirm`,
      payload: { event: m.event, claims: m.claims, actions: [], extracted_by: 'macro' },
    });
  }
  // 跑一次天结算，让复盘台有卡可读
  const enq = (await app.inject({ method: 'POST', url: `/api/games/${gid}/day/2/advise`, payload: {} })).json();
  for (let i = 0; i < 60; i++) {
    const t = (await app.inject({ method: 'GET', url: `/api/tasks/${enq.task_id}` })).json();
    if (t.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 30));
  }

  // fetch 指到真 app 上（视图的 api.js 用的就是全局 fetch）
  installDom();
  global.fetch = async (url, opts) => {
    const r = await app.inject({ method: (opts && opts.method) || 'GET', url, payload: opts && opts.body ? JSON.parse(opts.body) : undefined });
    return {
      ok: r.statusCode < 400, status: r.statusCode,
      text: async () => r.body,
    };
  };

  // ★视图是 ES 模块（import/export），require() 加载不了 ⇒ 必须动态 import。
  const views = {
    games: (await import('../web/views/games.js')).renderGames,
    record: (await import('../web/views/record.js')).renderRecord,
    review: (await import('../web/views/review.js')).renderReview,
    about: (await import('../web/views/about.js')).renderAbout,
  };

  for (const [name, fn] of Object.entries(views)) {
    const out = await fn([], { gameId: gid });
    const nodes = Array.isArray(out) ? out : [out];
    for (const node of nodes) {
      assert.ok(node instanceof StubNode,
        `★${name} 视图返回的不是 DOM 节点（是 ${typeof node}）—— 页面会渲染成 "[object ...]"`);
    }
    const text = nodes.map(texts).join('\n');
    assert.ok(text.length > 60, name + ' 渲染内容过短：' + JSON.stringify(text.slice(0, 80)));
    // ★这三条是本用例存在的理由
    if (/\[object /.test(text)) {
      const i = text.indexOf('[object');
      // 断言消息里带上下文 —— 只说「有 [object」等于没定位到，
      // 而这条 bug 我已经踩过一次，第二次必须一眼看出是哪一段。
      process.stderr.write('\n[render-debug] ' + name + ' 的 [object 出现在：'
        + JSON.stringify(text.slice(0, 160)) + '\n');
    }
    assert.doesNotMatch(text, /undefined/, name + ' 渲染出了 "undefined" —— 某个字段读错了层级');
    assert.doesNotMatch(text, /\[object /, name + ' 渲染出了 "[object ...]" —— 节点被当成字符串插进去了');
    assert.doesNotMatch(text, /\bNaN\b/, name + ' 渲染出了 "NaN" —— 某个 id 算错了');
  }
});

test('★② 复盘台渲染出的矛盾必须含四段（描述/欠定/无辜解释/回查）', async (t) => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  t.after(() => app.close());
  const gid = (await app.inject({
    method: 'POST', url: '/api/games',
    payload: { name: '四段局', type: 'werewolf', player_count: 8 },
  })).json().game.id;
  for (const seat of [3, 6]) {
    const m = (await app.inject({
      method: 'POST', url: `/api/games/${gid}/events/macro`,
      payload: { kind: 'claim_role', seat, role: '预言家', day: 1 },
    })).json();
    await app.inject({
      method: 'POST', url: `/api/games/${gid}/events/confirm`,
      payload: { event: m.event, claims: m.claims, actions: [], extracted_by: 'macro' },
    });
  }
  const enq = (await app.inject({ method: 'POST', url: `/api/games/${gid}/day/1/advise`, payload: {} })).json();
  for (let i = 0; i < 60; i++) {
    const t = (await app.inject({ method: 'GET', url: `/api/tasks/${enq.task_id}` })).json();
    if (t.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 30));
  }

  installDom();
  global.fetch = async (url, opts) => {
    const r = await app.inject({ method: (opts && opts.method) || 'GET', url, payload: opts && opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: r.statusCode < 400, status: r.statusCode, text: async () => r.body };
  };
  const out = await (await import('../web/views/review.js')).renderReview([], { gameId: gid });
  const text = texts(Array.isArray(out) ? out[out.length - 1] : out);
  assert.ok(has(out, '四段局'), '★标题应当是局名，不是 undefined —— 说明 game 解包错了');
  for (const [needle, why] of [
    ['对跳', '冲突描述'],
    ['欠定', '欠定度'],
    ['也可能不是矛盾', '无辜解释（★产品的地基）'],
    ['回查原文', '原文回查入口'],
  ]) {
    assert.ok(text.includes(needle), '★复盘台渲染里少了「' + why + '」这一段');
  }
});

test('★③ 局列表要显示局名（这一条专门盯 API 解包那类 bug）', async (t) => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  t.after(() => app.close());
  await app.inject({
    method: 'POST', url: '/api/games',
    payload: { name: '名字必须出现', type: 'werewolf', player_count: 8 },
  });
  installDom();
  global.fetch = async (url, opts) => {
    const r = await app.inject({ method: (opts && opts.method) || 'GET', url, payload: opts && opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: r.statusCode < 400, status: r.statusCode, text: async () => r.body };
  };
  const out = await (await import('../web/views/games.js')).renderGames();
  assert.ok(has(out, '名字必须出现'), '★局列表没显示局名');
});