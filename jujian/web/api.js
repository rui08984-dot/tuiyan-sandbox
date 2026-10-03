/* 局鉴 · web/api.js —— 21 个端点的薄封装
 * --------------------------------------------------------------------------
 * 只做三件事：拼 URL、带上幂等键、把错误变成一句人话。
 * **不做状态管理、不做缓存、不做重试** —— 那是视图的活。
 *
 * ★幂等键：所有写操作都带。
 *   浏览器会在用户双击、网络抖动、页面刷新时重发同一个请求，
 *   而对局账本不可改 —— 重发一次就多出一条声称。
 *   同一个键重发，服务端只写一次并返回同一个结果。
 */

const TOKEN_KEY = 'jujian_token';

export function token() {
  const q = new URLSearchParams(location.search).get('jujian_token');
  if (q) { localStorage.setItem(TOKEN_KEY, q); history.replaceState(null, '', location.pathname); return q; }
  return localStorage.getItem(TOKEN_KEY) || '';
}

async function req(method, url, body, opts = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotent) headers['Idempotency-Key'] = opts.idempotent;
  const t = token();
  if (t) headers['X-Jujian-Token'] = t;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('连不上服务。它还开着吗？（默认 http://127.0.0.1:8788）');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* 非 JSON 保底 */ }

  if (!res.ok) {
    const msg = (data && data.error) || (res.status === 401
      ? '令牌不对。带 ?jujian_token=<你那串字符> 重新打开一次。'
      : `请求失败（HTTP ${res.status}）`);
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

/** 幂等键：同一秒内的同一操作复用同一个键，跨秒换新的。 */
let _idemClock = '';
let _idemSeq = 0;
export function idemKey(tag) {
  const c = new Date().toISOString().slice(0, 16);   // 分钟级
  if (c !== _idemClock) { _idemClock = c; _idemSeq = 0; }
  return `${tag}-${c.replace(/[^0-9]/g, '')}-${++_idemSeq}`;
}

// ── 局 ────────────────────────────────────────────────────────────────────
export const games = {
  list: () => req('GET', '/api/games'),
  types: () => req('GET', '/api/adapters'),
  create: (o) => req('POST', '/api/games', o, { idempotent: idemKey('newgame') }),
  get: (id) => req('GET', `/api/games/${id}`),
  state: (id, uptoDay) => req('GET', `/api/games/${id}/state`
    + (uptoDay ? `?uptoDay=${encodeURIComponent(uptoDay)}` : '')),
  exportGame: (id) => req('GET', `/api/games/${id}/export`),
  seats: (id, seats) => req('PUT', `/api/games/${id}/seats`, { seats }),
};

// ── 录入 ──────────────────────────────────────────────────────────────────
export const rec = {
  /** 宏 → 待确认卡（不走 AI）。card 直接喂给 confirm。 */
  macro: (id, body) => req('POST', `/api/games/${id}/events/macro`, body),
  /** 自由文本 → 待确认卡（走 AI；MOCK 时自报 MOCK）。 */
  extract: (id, body) => req('POST', `/api/games/${id}/events/extract`, body, { idempotent: idemKey('ext') }),
  confirm: (id, card, extractedBy) => req('POST', `/api/games/${id}/events/confirm`, {
    event: card.event, claims: card.claims || [], actions: card.actions || [],
    extracted_by: extractedBy || 'macro',
  }, { idempotent: idemKey('confirm') }),
};

// ── 改与撤 ────────────────────────────────────────────────────────────────
export const edit = {
  claim: (id, cid, object) => req('POST', `/api/games/${id}/claims/${cid}/edit`, { object }),
  retractClaim: (id, cid) => req('POST', `/api/games/${id}/claims/${cid}/retract`, {}),
  retractAction: (id, aid) => req('POST', `/api/games/${id}/actions/${aid}/retract`, {}),
  retractBotc: (id, cid) => req('POST', `/api/games/${id}/botc-claims/${cid}/retract`, {}),
};

// ── 复盘 ──────────────────────────────────────────────────────────────────
export const review = {
  /** 发起天结算：立刻返回 task_id，后台跑。 */
  advise: (id, day) => req('POST', `/api/games/${id}/day/${day}/advise`, {}, { idempotent: idemKey('advise') }),
  task: (taskId) => req('GET', `/api/tasks/${encodeURIComponent(taskId)}`),
  cards: (id) => req('GET', `/api/games/${id}/cards`),
  card: (id, day) => req('GET', `/api/games/${id}/cards/${day}`),
  botcClaims: (id) => req('GET', `/api/games/${id}/botc-claims`),
};

/** 轮询天结算直到出结果。★有上限，不无限等 —— 前端也不该假装它会永远转。 */
export async function awaitTask(taskId, { tries = 90, gapMs = 400 } = {}) {
  for (let i = 0; i < tries; i++) {
    const t = await review.task(taskId);
    if (t.status !== 'running') return t;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  throw new Error('天结算还没出结果（等了 ' + Math.round(tries * gapMs / 1000) + ' 秒）。它还在后台跑，稍后回来看参谋卡。');
}