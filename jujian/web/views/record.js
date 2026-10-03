/* 局鉴 · web/views/record.js —— 对局录入
 * --------------------------------------------------------------------------
 * 饭桌上用的那一屏，所以设计目标是**三下之内记一条**：
 *   选席位 → 点宏（跳身份/查杀/金水）→ 确认
 * 宏不走 AI（它是结构化的，本来就不该过模型）；自由文本才走。
 *
 * ★录错了怎么办：每条都带「撤回」。
 *   撤回是软删 —— 行永远在库里，只是从视图消失，因为「你当时记成了什么」
 *   本身是复盘的事实。撤回之后改写一律 409，界面把这句说清楚而不是转圈。
 */

import { h, hero, toast, emptyState } from '../app.js';
import { games, rec, edit } from '../api.js';

const PRED_ZH = {
  is_wolf: '查杀', is_good: '发好人', is_role: '是某角色', claims_role: '跳身份',
  voted: '说投了', did_action: '说做了某动作', said: '说过（未解析成角色）',
  is_demon: '是恶魔', is_minion: '是爪牙', status_drunk: '是醉酒', status_poisoned: '是中毒',
};
const PHASE_ZH = { night: '夜', day: '昼', dusk: '黄昏' };

export async function renderRecord(ctx, { gameId }) {
  if (!gameId) {
    const list = await games.list();
    if (!list.games.length) {
      return [hero('录入', '先把一局建起来。'),
        h('div', { class: 'note' }, '还没有局。'),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          h('a', { class: 'btn btn-primary', href: '#/' }, '去建局'))];
    }
    return [hero('录入', '选一局继续录。'),
      h('div', { class: 'card' }, ...list.games.map((g) => h('div', { class: 'rowitem' },
        h('div', {}, h('div', { class: 't' }, `#${g.id}　${g.name}`),
          h('div', { class: 'm' }, `${g.game_type} · 第 ${g.max_day || 0} 天 · 事件 ${g.event_count}`)),
        h('div', { class: 'r' }, h('a', { class: 'btn btn-sm btn-primary', href: '#/record/' + g.id }, '录')))))]
      .flat();
  }

  // ★games.get 返回 { game, players }，要解包（见 review.js 同一处的说明）
  // ★games.get 返回 { game, players } —— 局信息在 game 里，席位在**顶层**。
  //   第一版只解了一半（把 game 解出来，却仍读 game.players），
  //   于是 seats 是 undefined，下一行 seats.length 直接炸。
  //   渲染测试就是为抓这个而写的。
  const [{ game, players: seats }, state] = await Promise.all([games.get(gameId), games.state(gameId)]);
  const box = h('div');
  box.appendChild(hero(game.name,
    `#${gameId} · ${game.game_type}${game.script ? ' · 剧本 ' + game.script : ''} · ${seats.length} 人`
    + ` · 已录 ${state.events.length} 条事件 / ${state.claims.length} 条声称`));

  box.appendChild(macroPanel(gameId, seats, game));
  box.appendChild(freeTextPanel(gameId, seats));
  box.appendChild(statementTable(gameId, state));
  return box;
}

// ── 宏录入：三型并排 ──────────────────────────────────────────────────
function macroPanel(gameId, seats, game) {
  const state = { day: 1, phase: 'day', seat: 1, target: 2 };
  const pending = h('div');
  const pickSeat = seatPicker(seats, state, 'seat');

  const dayEl = h('input', { type: 'number', value: '1', min: '1', max: '99', style: { width: '78px' } });
  const phaseEl = h('select', { style: { width: '96px' } },
    h('option', { value: 'day' }, '昼'), h('option', { value: 'night' }, '夜'), h('option', { value: 'dusk' }, '黄昏'));
  dayEl.addEventListener('input', () => { state.day = Number(dayEl.value) || 1; });
  phaseEl.addEventListener('change', () => { state.phase = phaseEl.value; });

  const targetWrap = h('div', { style: { display: 'none' } },
    h('label', {}, '对象席位'), seatPicker(seats, state, 'target'));
  const roleWrap = h('div', {}, h('label', {}, '角色'),
    h('input', { type: 'text', id: 'jj-role', placeholder: '如 预言家 / 女巫 / 猎人' }));

  const macros = [
    { kind: 'claim_role', t: '跳身份', s: '某某说自己是某角色', show: () => { roleWrap.style.display = ''; targetWrap.style.display = 'none'; } },
    { kind: 'check', t: '查杀', s: '某某查杀某某是狼', show: () => { roleWrap.style.display = 'none'; targetWrap.style.display = ''; } },
    { kind: 'good', t: '发金水', s: '某某给某某发好人', show: () => { roleWrap.style.display = 'none'; targetWrap.style.display = ''; } },
  ];
  macros[0].show();

  const card = h('div');
  const doMacro = async (kind) => {
    const role = roleWrap.querySelector('input').value.trim();
    if (kind === 'claim_role' && !role) { toast('先填角色名'); return; }
    try {
      const c = await rec.macro(gameId, {
        kind, seat: state.seat, day: state.day, phase: state.phase,
        ...(kind === 'claim_role' ? { role } : { target_seat: state.target }),
      });
      card.replaceChildren(pendingCard(c, async () => {
        await rec.confirm(gameId, c, 'macro');
        toast('记下了');
        location.hash = location.hash;      // 重渲当前屏
      }));
    } catch (e) { toast(e.message); }
  };

  return h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '宏录入'), h('span', { class: 'n' }, '不走 AI · 三下记一条')),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', {}, '谁在说'), pickSeat),
      h('div', { class: 'field', style: { flex: '0 1 100px' } }, h('label', {}, '第几天'), dayEl),
      h('div', { class: 'field', style: { flex: '0 1 120px' } }, h('label', {}, '时段'), phaseEl)),
    h('div', { class: 'macros' }, ...macros.map((m) =>
      h('button', { class: 'macro', onClick: () => { m.show(); doMacro(m.kind); } },
        h('b', {}, m.t), h('span', {}, m.s)))),
    h('div', { style: { marginTop: 'var(--sp-3)' } }, roleWrap, targetWrap),
    card);
}

function pendingCard(c, onConfirm) {
  return h('div', { class: 'pending' },
    h('div', { class: 'pending-t' }, '待确认 —— 还没进账本'),
    h('div', {}, c.event.raw_text),
    h('div', { style: { marginTop: '6px', fontSize: 'var(--fs-sm)', color: 'var(--fg-mute)' } },
      ...(c.claims || []).map((x) => h('div', {},
        `声称：${x.seat} 号说 ${x.subject_seat} 号 ${PRED_ZH[x.predicate] || x.predicate}：${x.object}`))),
    (c.warnings || []).length
      ? h('div', { class: 'note note-warn', style: { marginTop: '8px' } },
          '注意：', ...c.warnings.map((w) => h('div', {}, '· ' + w)))
      : null,
    h('div', { class: 'btn-row', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn-primary btn-sm', onClick: onConfirm }, '确认入账'),
      h('button', { class: 'btn btn-sm', onClick: () => {} }, '算了')));
}

// ── 自由文本抽取 ────────────────────────────────────────────────────────
function freeTextPanel(gameId, seats) {
  const state = { seat: 1, day: 1 };
  const textEl = h('textarea', { placeholder: '把原话粘进来，一字不改。不要润色、不要概括 —— 抽取器认的是原文。' });
  const out = h('div');
  const btn = h('button', { class: 'btn' }, '拆成结构化声称');
  btn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) { toast('先粘一段原话'); return; }
    btn.disabled = true;
    out.replaceChildren(h('div', { style: { marginTop: '10px' } }, h('span', { class: 'spin' }), ' 拆解中…'));
    try {
      const c = await rec.extract(gameId, { seat: state.seat, text, day: state.day });
      out.replaceChildren(pendingCard(c, async () => {
        await rec.confirm(gameId, c, c.meta && c.meta.mode === 'MOCK' ? 'llm' : 'llm');
        toast('记下了');
        location.hash = location.hash;
      }));
      if (c.meta && c.meta.mode === 'MOCK') {
        out.prepend(h('div', { class: 'note', style: { marginTop: '8px' } },
          'MOCK 模式：没配 API key，这是确定性模板的拆解结果，不是真模型抽的。'));
      }
    } catch (e) {
      out.replaceChildren(h('div', { class: 'note note-warn', style: { marginTop: '8px' } }, e.message));
    } finally { btn.disabled = false; }
  });

  const dayEl = h('input', { type: 'number', value: '1', min: '1', max: '99', style: { width: '78px' } });
  dayEl.addEventListener('input', () => { state.day = Number(dayEl.value) || 1; });

  return h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '自由文本'), h('span', { class: 'n' }, '走 AI')),
    h('div', { class: 'row', style: { marginBottom: 'var(--sp-3)' } },
      h('div', { class: 'field' }, h('label', {}, '谁在说'), seatPicker(seats, state, 'seat')),
      h('div', { class: 'field', style: { flex: '0 1 100px' } }, h('label', {}, '第几天'), dayEl)),
    h('div', { class: 'field' }, textEl),
    btn, out);
}

// ── 席位小片 ────────────────────────────────────────────────────────────
function seatPicker(seats, state, key) {
  const box = h('div', { class: 'seats' });
  for (const p of seats) {
    const el = h('button', { class: 'seat' + (state[key] === p.seat ? ' pick' : ''), onClick: () => {
      state[key] = p.seat;
      for (const c of box.children) c.classList.toggle('pick', Number(c.dataset.seat) === p.seat);
    }, 'data-seat': p.seat, title: p.name }, p.name);
    box.appendChild(el);
  }
  if (!seats.some((p) => p.seat === state[key])) {
    const first = box.querySelector('.seat');
    if (first) { first.classList.add('pick'); state[key] = Number(first.dataset.seat); }
  }
  return box;
}

// ── 已录声称：带撤回 ────────────────────────────────────────────────────
function statementTable(gameId, state) {
  const card = h('div', { class: 'card' },
    h('div', { class: 'card-t' },
      h('h2', {}, '已录的声称'),
      h('span', { class: 'n' }, state.claims.length + ' 条')));

  if (!state.claims.length) {
    card.appendChild(emptyState('一条都还没有', '用上面的宏先记一条 —— 矛盾是从量里长出来的。'));
    return card;
  }
  const tb = h('tbody');
  for (const c of state.claims) {
    tb.appendChild(h('tr', {},
      h('td', { class: 'num' }, c.seat),
      h('td', {}, PRED_ZH[c.predicate] || c.predicate),
      h('td', { class: 'num' }, c.subject_seat),
      h('td', {}, c.object),
      h('td', { class: 'num' }, 'D' + c.day),
      h('td', { style: { width: '1%' } },
        h('button', { class: 'btn btn-sm', onClick: async (e) => {
          e.target.disabled = true;
          try { await edit.retractClaim(gameId, c.id); toast('撤回了（行仍在库里，账本不可变）'); location.hash = location.hash; }
          catch (err) { toast(err.message); e.target.disabled = false; }
        } }, '撤回'))));
  }
  card.appendChild(h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { class: 'num' }, '谁说'), h('th', {}, '说了什么'), h('th', { class: 'num' }, '关于'),
      h('th', {}, '对象'), h('th', { class: 'num' }, '第几天'), h('th', {}))),
    tb));
  card.appendChild(h('div', { class: 'note', style: { marginTop: '12px' } },
    '撤回是**软删**：行永远留在库里，只是从上面这张表消失 —— 因为「你当时记成了什么」本身是复盘的事实。撤回之后不许再改写。'));
  return card;
}