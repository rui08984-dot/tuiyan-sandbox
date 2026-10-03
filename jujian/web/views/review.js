/* 局鉴 · web/views/review.js —— ★复盘台（产品的正脸）
 * --------------------------------------------------------------------------
 * 这一屏的全部设计围绕一件事：**矛盾清单里每一条都必须能被追问。**
 *
 * 因此每条矛盾渲染成四段，一段都不能省：
 *   ① 冲突描述  —— 哪两句打架（唯一真源是代码比对器，不是模型）
 *   ② 欠定度    —— 证据有多硬。high 也不等于结论，只是几乎无解释空间
 *   ③ 无辜解释  —— ★「也可能不是矛盾」的理由。缺这条的矛盾根本不该显示
 *   ④ 回查入口  —— 点开看原文，自己判断
 *
 * ★这一屏**不给**的东西，刻意不给：
 *   · 嫌疑排序 —— 预注册盲测证伪过（有局里结构化账本输给人工）
 *   · 「谁是狼」—— 见上
 *   · 评分/通过率 —— 一个复盘台给评分，是在假装它有它没有的能力
 */

import { h, hero, toast, emptyState } from '../app.js';
import { games, review, awaitTask } from '../api.js';

const UD_ZH = { high: '几乎无解释空间', mid: '有几种解释', low: '很欠定' };

export async function renderReview(ctx, { gameId }) {
  if (!gameId) {
    const list = await games.list();
    if (!list.games.length) {
      return [hero('复盘', '局录得越多，这里才有东西可说。'),
        h('div', { class: 'note' }, '还没有局。'),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          h('a', { class: 'btn btn-primary', href: '#/' }, '去建局'))];
    }
    return [hero('复盘', '选一局看它的矛盾清单。'),
      h('div', { class: 'card' }, ...list.games.map((g) => h('div', { class: 'rowitem' },
        h('div', {}, h('div', { class: 't' }, `#${g.id}　${g.name}`),
          h('div', { class: 'm' }, `${g.game_type} · 第 ${g.max_day || 0} 天 · 事件 ${g.event_count}`)),
        h('div', { class: 'r' }, h('a', { class: 'btn btn-sm btn-primary', href: '#/review/' + g.id }, '看')))))]
      .flat();
  }

  // ★games.get 返回的是 { game, players } 一层包装，不是局本身。
  //   直接读 game.name 会得到 undefined —— 而且页面不会报错，只是标题空着。
  const { game } = await games.get(gameId);
  const state = await games.state(gameId);
  const cards = await review.cards(gameId).catch(() => ({ cards: [] }));

  const box = h('div');
  box.appendChild(hero(game.name,
    `#${gameId} · ${game.game_type} · 已录 ${state.events.length} 条事件 / ${state.claims.length} 条声称`));

  box.appendChild(advisePanel(gameId, state, cards));
  for (const c of cards.cards || []) box.appendChild(dayCard(gameId, c, state));
  return box;
}

// ── 天结算 ──────────────────────────────────────────────────────────────
function advisePanel(gameId, state, cards) {
  const dayState = { day: Math.max(1, state.events.reduce((m, e) => Math.max(m, e.day), 0)) };
  const dayEl = h('input', { type: 'number', value: String(dayState.day), min: '1', max: '99', style: { width: '90px' } });
  dayEl.addEventListener('input', () => { dayState.day = Number(dayEl.value) || 1; });
  const out = h('div');
  const btn = h('button', { class: 'btn btn-primary' }, '天结算');
  btn.addEventListener('click', async () => {
    if (!state.events.length) { toast('一条发言都还没有，结算出来的卡是空的'); return; }
    btn.disabled = true;
    out.replaceChildren(h('div', { style: { marginTop: '10px' } }, h('span', { class: 'spin' }), ' 算矛盾、收假设…'));
    try {
      const { task_id } = await review.advise(gameId, dayState.day);
      const t = await awaitTask(task_id);
      if (t.status === 'failed') throw new Error(t.error || '天结算失败');
      toast(`第 ${dayState.day} 天结算完成：矛盾 ${(t.card.contradictions || []).length} 条`);
      location.hash = location.hash;
    } catch (e) {
      out.replaceChildren(h('div', { class: 'note note-warn', style: { marginTop: '10px' } }, e.message));
    } finally { btn.disabled = false; }
  });

  const archived = (cards.cards || []).length;
  return h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '天结算'),
      h('span', { class: 'n' }, archived ? `已存档 ${archived} 天` : '还没结算过')),
    h('div', { class: 'row', style: { alignItems: 'flex-end' } },
      h('div', { class: 'field', style: { flex: '0 1 130px' } }, h('label', {}, '算第几天'), dayEl),
      h('div', { style: { flex: '0 0 auto' } }, btn)),
    out);
}

// ── ★一天参谋卡 ─────────────────────────────────────────────────────────
function dayCard(gameId, c, state) {
  const byId = new Map(state.events.map((e) => [e.id, e]));
  const claimById = new Map(state.claims.map((x) => [x.id, x]));

  const contradictions = c.contradictions || [];
  const body = h('div');

  body.appendChild(h('div', { class: 'card-t' }, h('h2', {}, `第 ${c.day} 天`),
    h('span', { class: 'n' }, `${contradictions.length} 条矛盾`)));

  if (!contradictions.length) {
    // ★这句话的措辞是有讲究的，不能简写成「没有矛盾」
    body.appendChild(emptyState('这一天没抓到矛盾',
      '可能是真的没有，也可能是发言还没录够 —— 矛盾是从量里长出来的。别把它读成「这局没人撒谎」。'));
  } else {
    for (const x of contradictions) body.appendChild(clashRow(x, byId, claimById));
  }

  if ((c.hypotheses || []).length) {
    body.appendChild(h('div', { style: { marginTop: 'var(--sp-4)' } },
      h('div', { style: { fontSize: 'var(--fs-sm)', color: 'var(--fg-dim)', marginBottom: '6px' } }, '当时的假设'),
      ...c.hypotheses.map((x) => h('div', { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } },
        h('div', {}, x.content),
        h('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', marginTop: '2px' } },
          '倾向 ' + ({ strong: '强', mid: '中', weak: '弱' }[x.tendency] || x.tendency)
          + (x.support_events && x.support_events.length ? `　依据 ${x.support_events.length} 条发言` : ''))))));
  }

  if ((c.checklist || []).length) {
    body.appendChild(h('div', { class: 'note', style: { marginTop: 'var(--sp-4)' } },
      h('b', {}, '接下来该盯'), h('div', {}, '· 只勾你知道答案的那几件 —— 它不会替你勾。'),
      ...c.checklist.map((k) => h('div', { style: { marginTop: '4px' } }, `· ${k.text || k}`))));
  }

  return h('div', { class: 'card' }, body);
}

// ── ★一条矛盾（四段，一段都不能省）───────────────────────────────────────
function clashRow(x, byId, claimById) {
  const qWrap = h('div');
  let opened = false;

  const refs = [];
  for (const key of ['claim_a', 'claim_b', 'action_a', 'action_b']) {
    const v = x[key];
    if (v === null || v === undefined) continue;
    if (key.startsWith('claim')) {
      const cl = claimById.get(Number(v));
      if (cl) refs.push({ label: '声称 #' + cl.id, kind: 'claim', row: cl });
    } else {
      refs.push({ label: '行动 #' + v, kind: 'action', row: null });
    }
  }

  const btn = h('button', {}, '回查原文（' + refs.length + '）');
  btn.addEventListener('click', () => {
    opened = !opened;
    if (!opened) { qWrap.replaceChildren(); btn.textContent = '回查原文（' + refs.length + '）'; return; }
    qWrap.replaceChildren(...refs.map((r) => {
      const ev = r.row ? byId.get(r.row.event_id) : null;
      const who = r.row ? `${r.row.seat} 号说 ${r.row.subject_seat} 号` : '';
      return h('div', { class: 'quote' },
        h('span', { class: 'eid' }, r.label),
        ev ? `第 ${ev.day} 天 · ${who}：「${ev.raw_text}」` : '（原行动行）');
    }));
    btn.textContent = '收起';
  });

  const ud = x.underdetermination || 'mid';
  return h('div', { class: 'clash' },
    h('div', { class: 'clash-desc' }, x.conflict_desc || '（无描述）'),
    h('div', { class: 'clash-meta' },
      h('span', { class: 'ud ud-' + ud }, '欠定 ' + ud),
      h('span', { style: { color: 'var(--fg-dim)' } }, UD_ZH[ud] || ''),
      (x.generated_by ? h('span', { style: { color: 'var(--fg-dim)' } }, x.generated_by === 'code' ? '代码比对器' : 'AI 补全') : null)),
    // ★无辜解释用冷色而不是警告色：它是免责，不是报错
    h('div', { class: 'innocent' },
      h('div', { class: 'innocent-t' }, '也可能不是矛盾 ——'),
      h('ul', {}, ...(x.innocent_explanations || ['（没有给出。这一条按规则不该出现在这里。）'])
        .map((t) => h('li', {}, t)))),
    refs.length ? h('div', { class: 'proof' }, btn) : null,
    qWrap);
}