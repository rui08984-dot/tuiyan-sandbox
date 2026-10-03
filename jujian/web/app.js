/* 局鉴 · web/app.js —— 应用外壳：路由 ＋ DOM 小工具 ＋ 顶栏
 * --------------------------------------------------------------------------
 * 无框架。理由不是「偏好小」，是这条链路上有三条纪律要用：
 *   ① 幂等键必须**逐次**可控（自动重试会重发，但键必须随语义走）
 *   ② 撤回后一律 409 不许改写 —— 界面必须把「不能改」说清楚，而不是转个圈
 *   ③ 「空清单 ≠ 没人撒谎」—— 空态文案必须能被人审
 * 这三条在一个手写的 ~200 行外壳里最容易守住。
 */

import { games } from './api.js';
import { renderGames } from './views/games.js';
import { renderRecord } from './views/record.js';
import { renderReview } from './views/review.js';
import { renderAbout } from './views/about.js';

// ── DOM 小工具：够用就��，不做框架 ──────────────────────────────────────
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

let _toastTimer = null;
export function toast(msg, ms = 2600) {
  const old = $('.toast');
  if (old) old.remove();
  if (_toastTimer) clearTimeout(_toastTimer);
  document.body.appendChild(h('div', { class: 'toast' }, msg));
  _toastTimer = setTimeout(() => { const t = $('.toast'); if (t) t.remove(); }, ms);
}

/** ★空态的固定写法。「没发现矛盾」≠「这局没人撒谎」——这句话不许省。 */
export function emptyState(big, small, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'big' }, big),
    h('div', {}, small),
    action ? h('div', { style: { marginTop: '16px' } }, action) : null);
}

export function loading(label = '加载中') {
  return h('div', { class: 'empty' }, h('span', { class: 'spin' }), ' ', label);
}

export function hero(title, sub) {
  return h('div', { class: 'hero' },
    h('h1', {}, title),
    h('p', {}, sub),
    h('div', { class: 'disclaim' }, '它不替你下结论 —— 只把互相矛盾的地方摆出来，并且说清每条矛盾也可能不是矛盾。'));
}

// ── 路由 ────────────────────────────────────────────────────────────────
//  格式：#/games、#/record/3、#/review/3?day=2
const ROUTES = [
  { path: /^\/$/,            nav: '/',        run: (g) => renderGames(g) },
  { path: /^\/games$/,       nav: '/',        run: (g) => renderGames(g) },
  { path: /^\/record$/,      nav: '/record',  run: (g) => renderRecord(g, { gameId: null }) },
  { path: /^\/record\/(\d+)$/, nav: '/record', run: (g) => renderRecord(g, { gameId: Number(g[1]) }) },
  { path: /^\/review$/,      nav: '/review',  run: (g) => renderReview(g, { gameId: null }) },
  { path: /^\/review\/(\d+)$/, nav: '/review', run: (g) => renderReview(g, { gameId: Number(g[1]) }) },
  { path: /^\/about$/,       nav: '/about',   run: () => renderAbout() },
];

export function go(hash) { location.hash = hash; }
export function back() { if (history.length > 1) history.back(); else go('/'); }

async function render() {
  const app = $('#app');
  const raw = location.hash || '#/';
  const [, path, query] = raw.match(/^#([^?]*)(?:\?(.*))?$/) || [null, '/', ''];
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  const found = ROUTES.find((r) => r.path.test(path));

  for (const a of document.querySelectorAll('[data-nav]')) {
    if (found && a.dataset.nav === found.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  if (!found) {
    app.replaceChildren(hero('没有这个页面', '地址写错了，或者这个功能还没做。'),
      h('a', { class: 'btn', href: '#/' }, '回局列表'));
    return;
  }
  app.replaceChildren(loading());
  try {
    // ★run 收到的是**正则捕获组数组**，query 单独作第二个参数。
    //   第一版传了 `[path, params]`，于是 `m[1]` 拿到的是 params 而不是捕获组 ——
    //   Number(params) 得 NaN，gameId 变假值，所有带 id 的路由都悄悄退化成列表页。
    //   ★症状极隐蔽：地址栏是 /review/1，页面却是「选一局」，
    //   而路由本身「看起来对」（单独验正则时全过）。
    const groups = found.path.exec(path) || [];
    const node = await found.run(groups, params);
    // 视图可能返回一个节点，也可能返回数组（分屏时更顺手）。
    // 直接 replaceChildren(数组) 会把它当成**单个**节点 → 页面渲染成
    // "[object HTMLDivElement],[object HTMLDivElement]"。
    app.replaceChildren(...(Array.isArray(node) ? node : [node]));
    window.scrollTo(0, 0);
  } catch (e) {
    app.replaceChildren(
      h('div', { class: 'note note-warn' }, h('b', {}, '出了点问题：'), ' ', e.message),
      h('div', { class: 'btn-row', style: { marginTop: '12px' } },
        h('button', { class: 'btn', onClick: () => render() }, '重试'),
        h('a', { class: 'btn', href: '#/' }, '回局列表')));
  }
}

window.addEventListener('hashchange', render);
// 首次进入若带了令牌，api.token() 会顺手存下来并把地址栏擦干净
render();

export { games };