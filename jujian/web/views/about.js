/* 局鉴 · web/views/about.js —— 关于
 * --------------------------------------------------------------------------
 * 这屏是产品说明书，也是**承诺书**。
 * 它把「它不做什么」写在前面的位置，因为那些限制是这个产品的边界，
 * 不是需要被辩解的短板。
 */

import { h, hero } from '../app.js';
import { games } from '../api.js';

export async function renderAbout() {
  const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
  const types = await games.types().catch(() => []);

  const box = h('div');
  box.appendChild(hero('局鉴',
    '把一局狼人杀／血染钟楼／阿瓦隆拆成结构化声称，抓出互相矛盾的地方，每条结论都能回查到原始发言。'));

  box.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '它做的三件事')),
    ...[
      ['把你听到的每一句话拆成结构化声称', '谁、在第几天、说了什么、关于谁。打开任意一局看那张表，每行都指着一条原始发言。'],
      ['找出互相矛盾的地方，说清是哪两句打架', '矛盾清单每条都带原文引用，缺一条都出不来。'],
      ['每条矛盾都说得出「也可能不是矛盾」的理由', '说不出无害解释的矛盾，不许入库、不许展示。这是存储层的硬约束，绕不过。'],
    ].map(([t, d]) => h('div', { style: { padding: '8px 0', borderBottom: '1px solid var(--line-soft)' } },
      h('div', { style: { fontWeight: 600 } }, t),
      h('div', { style: { color: 'var(--fg-mute)', fontSize: 'var(--fs-sm)', marginTop: '2px' } }, d)))));

  box.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '它刻意不做的事')),
    ...[
      ['不告诉你谁是狼', '它的实测结论是：机制站得住（矛盾清单引用零虚构、可回查），但「嫌疑排序比人工更准」没被证明 —— 某一局里甚至输给人工。所以它不做这件事，也不给你一个排好序的嫌疑列表。'],
      ['不自动勾「明天该盯什么」', '答案只有你知道。自动勾等于替你下结论。'],
      ['不联网（除非你自己配了 key）', '不配 key 时全部走确定性模板，功能完整可用，只是措辞固定。'],
      ['不把你的对局发到任何地方', '库就在你自己的机器上。它没有任何上传口。'],
    ].map(([t, d]) => h('div', { style: { padding: '8px 0', borderBottom: '1px solid var(--line-soft)' } },
      h('div', { style: { fontWeight: 600 } }, t),
      h('div', { style: { color: 'var(--fg-mute)', fontSize: 'var(--fs-sm)', marginTop: '2px' } }, d)))));

  box.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '支持的对局')),
    h('div', { class: 'rows' }, ...types.map((t) => h('div', { class: 'rowitem' },
      h('div', {}, h('div', { class: 't' }, t.name || t.id),
        h('div', { class: 'm' }, t.source + (t.checklist ? ' · 判据 ' + t.checklist : ''))),
      h('div', { class: 'r' },
        h('span', { class: 'ud ' + (t.ready ? 'ud-high' : 'ud-low') }, t.ready ? '就绪' : '缺件'))))),
    h('div', { class: 'note', style: { marginTop: '12px' } },
      '加一种新游戏 = 往内核适配器目录丢一个文件，前后端一行都不用改。')));

  if (health) {
    box.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-t' }, h('h2', {}, '本机状态')),
      h('table', {}, h('tbody', {},
        kv('版本', 'v' + health.version),
        kv('库', health.db_path),
        kv('AI', health.llm_configured ? (health.llm_mock ? '已配 key（MOCK 模式）' : 'LIVE 模式 —— 只在发起分析时出网') : 'MOCK 模式（零网络，功能完整）'),
        kv('监听', health.exposed ? '★已对外暴露' : '只听本机'),
        kv('已有局', health.games + ' 局')))));
  }

  box.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-t' }, h('h2', {}, '边界')),
    h('div', { class: 'note' },
      '① 默认只听本机。要让同一 Wi-Fi 下的手机连，必须显式设 ',
      h('code', {}, 'JUJIAN_HOST=0.0.0.0'), ' ', h('b', {}, '且'), ' ',
      h('code', {}, 'JUJIAN_SHARED_TOKEN'), ' —— 少一个就拒绝启动。',
      h('div', { style: { marginTop: '8px' } },
        '② API key 只从环境变量读，绝不写入任何文件。'),
      h('div', { style: { marginTop: '8px' } },
        '③ 账本不可变：撤回是软删，行永远在库里；撤回之后不许再改写。'))));

  return box;
}

function kv(k, v) {
  return h('tr', {}, h('td', { style: { width: '90px', color: 'var(--fg-dim)' } }, k), h('td', {}, String(v)));
}