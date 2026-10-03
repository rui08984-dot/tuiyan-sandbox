/* 局鉴 · web/views/games.js —— 局列表 ＋ 建局
 * --------------------------------------------------------------------------
 * 这屏要回答的问题只有一个：**我手上这一局，记下来了吗？**
 * 所以它把「局号 / 名字 / 类型 / 天数 / 事件数」摊开，而刻意不显示任何评分或评价。
 */

import { h, hero, toast, emptyState } from '../app.js';
import { games } from '../api.js';

const TYPE_ZH = { werewolf: '狼人杀', botc: '血染钟楼', avalon: '阿瓦隆', script: '剧本' };
const SCRIPT_ZH = { tb: '暗流', bmr: '暗流＋红教堂', snv: '疯狂' };

export async function renderGames() {
  const [list, types] = await Promise.all([games.list(), games.types()]);
  const box = h('div');
  box.appendChild(hero('局', '录下来的每一局都在这儿。点进去继续录，或者看它的复盘。'));

  if (!list.games.length) {
    box.appendChild(emptyState('还没有局',
      '建一局，然后把大家说过的话一条条录进来。',
      h('a', { class: 'btn btn-primary', href: '#/?new=1' }, '建第一局')));
    box.appendChild(newGameForm(types));
    return box;
  }

  const rows = h('div', { class: 'card' });
  for (const g of list.games) {
    rows.appendChild(h('div', { class: 'rowitem' },
      h('div', {},
        h('div', { class: 't' }, `#${g.id}　${g.name}`),
        h('div', { class: 'm' },
          `${TYPE_ZH[g.game_type] || g.game_type} · ${g.player_count} 人 · 第 ${g.max_day || 0} 天 · 事件 ${g.event_count}`
          + (g.script ? ` · 剧本 ${SCRIPT_ZH[g.script] || g.script}` : ''))),
      h('div', { class: 'r' },
        h('a', { class: 'btn btn-sm', href: '#/record/' + g.id }, '录'),
        h('a', { class: 'btn btn-sm btn-primary', href: '#/review/' + g.id }, '复盘'))));
  }
  box.appendChild(rows);

  box.appendChild(h('div', { class: 'card-t', style: { marginTop: '24px' } }, h('h2', {}, '建一局')));
  box.appendChild(newGameForm(types));
  return box;
}

function newGameForm(types) {
  const ready = types.filter((t) => t.ready);
  const nameEl = h('input', { type: 'text', placeholder: '例如：周五饭桌局', maxlength: '60' });
  const typeEl = h('select', {}, ...ready.map((t) =>
    h('option', { value: t.id }, (TYPE_ZH[t.id] || t.name || t.id))));
  const countEl = h('input', { type: 'number', value: '12', min: '4', max: '24' });
  const scriptWrap = h('div', { class: 'field', style: { display: 'none' } },
    h('label', {}, '剧本（血染钟楼必填 —— 没有剧本就没法校验角色）'),
    h('select', {},
      h('option', { value: 'tb' }, '暗流 tb'),
      h('option', { value: 'bmr' }, '暗流＋红教堂 bmr'),
      h('option', { value: 'snv' }, '疯狂 snv')));
  const scriptEl = scriptWrap.querySelector('select');

  typeEl.addEventListener('change', () => {
    scriptWrap.style.display = typeEl.value === 'botc' ? '' : 'none';
  });

  const msg = h('div', { class: 'note', style: { display: 'none' } });
  const submit = h('button', { class: 'btn btn-primary' }, '建局');

  submit.addEventListener('click', async () => {
    msg.style.display = 'none';
    const name = nameEl.value.trim();
    if (!name) { msg.textContent = '给局起个名字。'; msg.style.display = ''; return; }
    const payload = { name, type: typeEl.value, player_count: Number(countEl.value) };
    if (typeEl.value === 'botc') payload.script = scriptEl.value;
    submit.disabled = true;
    try {
      const r = await games.create(payload);
      toast(`建好了：局 #${r.game.id}`);
      location.hash = '#/record/' + r.game.id;
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'note note-warn';
      msg.style.display = '';
      submit.disabled = false;
    }
  });

  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'field', style: { flex: '2 1 220px' } }, h('label', {}, '名字'), nameEl),
      h('div', { class: 'field' }, h('label', {}, '类型'), typeEl),
      h('div', { class: 'field', style: { flex: '0 1 100px' } }, h('label', {}, '人数'), countEl)),
    scriptWrap,
    h('div', { class: 'btn-row' }, submit,
      h('span', { style: { color: 'var(--fg-dim)', fontSize: 'var(--fs-xs)', alignSelf: 'center' } },
        '建局后自动生成 1..N 号席位，之后可以改名字')),
    msg);
}