'use strict';
/**
 * 局鉴 · scripts/smoke.cjs —— 端到端冒烟：走完一局的主链路
 *
 * 这不是测试（测试在 test/），是**可给人看的**冒烟：
 *   node scripts/smoke.cjs
 * 每步都打印真实请求与响应，让人一眼看懂「局鉴到底在干什么」。
 *
 * 全程内存库 ＋ MOCK 模式 ＋ 零网络。
 *
 * ⚠ 契约以 src/routes/*.js 为准，不以本文为准。本脚本跑不过就是代码坏了或契约变了，
 *   两种都不该靠改脚本绕过——先查清楚。
 */
const server = require('../src/server');

function line(t) { process.stdout.write('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length)) + '\n'); }
function show(label, r, pick) {
  let body;
  try { body = JSON.stringify(pick ? pick(r.json()) : r.json()); } catch (_) { body = r.body; }
  process.stdout.write('  ' + String(label).padEnd(26) + r.statusCode + '  ' + String(body).slice(0, 130) + '\n');
  return r.json();
}

(async () => {
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  const post = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
  const get = (url) => app.inject({ method: 'GET', url });
  /** 宏卡 → 确认卡：宏返回的就是 confirm 要吃的形状，中间不需要转译。 */
  const confirm = (gid, card, extra) => post(`/api/games/${gid}/events/confirm`,
    Object.assign({ event: card.event, claims: card.claims, actions: card.actions || [], extracted_by: 'macro' }, extra || {}));

  line('① 建局：12 人狼人杀，自动建席 1..12');
  const g = await post('/api/games', { name: '周五饭桌局', type: 'werewolf', player_count: 12 });
  show('POST /api/games', g, (j) => ({ id: j.game.id, 席位数: j.players.length }));
  const gid = g.json().game.id;

  line('② 宏录入三连：3号跳预言家 / 3号查杀1号 / 7号给5号发金水');
  const m1 = show('macro claim_role 3', await post(`/api/games/${gid}/events/macro`, { kind: 'claim_role', seat: 3, role: '预言家', day: 1 }), (j) => j);
  const m2 = show('macro check 3→1', await post(`/api/games/${gid}/events/macro`, { kind: 'check', seat: 3, target_seat: 1, day: 1 }), (j) => j);
  const m3 = show('macro good 7→5', await post(`/api/games/${gid}/events/macro`, { kind: 'good', seat: 7, target_seat: 5, day: 1 }), (j) => j);

  line('③ 确认入账：事件 ＋ 声称 全成或全不成');
  show('confirm 3号跳预言家', await confirm(gid, m1), (j) => ({ event_id: j.event_id, claim_ids: j.claim_ids }));
  show('confirm 3号查杀1号', await confirm(gid, m2), (j) => ({ event_id: j.event_id, claim_ids: j.claim_ids }));
  show('confirm 7号发金水', await confirm(gid, m3), (j) => ({ event_id: j.event_id, claim_ids: j.claim_ids }));

  line('④ 对跳：8号也跳预言家 ⇒ 第二天矛盾检测应当抓到');
  const m4 = (await post(`/api/games/${gid}/events/macro`, { kind: 'claim_role', seat: 8, role: '预言家', day: 2 })).json();
  show('macro claim_role 8', await confirm(gid, m4), (j) => ({ event_id: j.event_id, claim_ids: j.claim_ids }));

  line('⑤ 天结算：异步出参谋卡（矛盾 ＋ 假设 ＋ 明日该盯什么）');
  const enq = await post(`/api/games/${gid}/day/2/advise`, {});
  const { task_id } = show('POST day/2/advise', enq, (j) => ({ task_id: j.task_id, status: j.status }));
  let done = null;
  for (let i = 0; i < 60 && !done; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const t = await get('/api/tasks/' + task_id);
    if (t.json().status !== 'running') done = t.json();
  }
  if (!done) { process.stdout.write('  ★参谋卡超时\n'); await app.close(); process.exit(1); }
  process.stdout.write('  任务状态 ' + done.status + (done.error ? '  错误: ' + done.error : '') + '\n');
  const card = done.card || {};
  process.stdout.write('  矛盾 ' + (card.contradictions || []).length + ' 条 / 假设 '
    + (card.hypotheses || []).length + ' 条 / 明日清单 ' + (card.checklist || []).length + ' 项 / 已存档 '
    + (done.card && done.card.saved) + '\n');
  (card.contradictions || []).slice(0, 4).forEach((x) => process.stdout.write(
    '    · ' + String(x.conflict_desc).slice(0, 56) + '　[欠定 ' + x.underdetermination
    + '，无辜解释 ' + (x.innocent_explanations || []).length + ' 条]\n'));
  (card.contradictions || []).slice(0, 1).forEach((x) => {
    if ((x.innocent_explanations || []).length) {
      process.stdout.write('      ↳ 无辜解释示例: ' + x.innocent_explanations[0] + '\n');
    }
  });

  line('⑥ 存档回读：按天列出（读已落库数据，不重算）');
  show('GET cards', await get(`/api/games/${gid}/cards`), (j) => ({ 天数: (j.cards || []).length, 第2天矛盾数: ((j.cards || [])[0] || {}).contradictions ? j.cards[0].contradictions.length : 0 }));

  line('⑦ 撤回纪律：撤回后从视图消失，但行仍在库（账本不可变）');
  const before = (await get(`/api/games/${gid}/state`)).json();
  const cid = before.claims[0].id;
  show('GET state（撤回前）', { statusCode: 200, json: () => before }, (j) => ({ 事件: j.events.length, 声称: j.claims.length }));
  show('POST claims/:id/retract', await post(`/api/games/${gid}/claims/${cid}/retract`, {}), (j) => j);
  show('GET state（撤回后）', await get(`/api/games/${gid}/state`), (j) => ({ 声称: j.claims.length }));
  show('撤回后再改写（应 409）', await post(`/api/games/${gid}/claims/${cid}/edit`, { object: 'x' }), (j) => ({ status: j.status, error: j.error }));

  line('⑧ 导出：整局 JSON（带元信息与计数）');
  show('GET export', await get(`/api/games/${gid}/export`), (j) => j.meta);

  line('⑨ BOTC 分流：阵营/状态走私有表，与通用声称物理隔离');
  const bg = show('POST /api/games botc+tb', await post('/api/games', { name: '血染钟楼局', type: 'botc', player_count: 10, script: 'tb' }), (j) => ({ id: j.game.id, script: j.game.script }));
  const bgid = bg.game.id;
  const bc1 = (await post(`/api/games/${bgid}/events/macro`, { kind: 'claim_role', seat: 2, role: '小恶魔', day: 1 })).json();
  show('confirm 2号跳小恶魔', await confirm(bgid, bc1), (j) => ({ claim_ids: j.claim_ids, botc_claim_ids: j.botc_claim_ids }));

  line('⑩ 护栏①：「恶魔」被当成角色名硬塞 → 修复归入专属谓词，不拒整批');
  const bc2 = (await post(`/api/games/${bgid}/events/macro`, { kind: 'claim_role', seat: 4, role: '恶魔', day: 1 })).json();
  const r10 = (await confirm(bgid, bc2)).json();
  process.stdout.write('  ' + r10.warnings.length + ' 条留痕: ' + JSON.stringify(r10.warnings) + '\n');
  show('  → botc_claims', await get(`/api/games/${bgid}/botc-claims`), (j) => (Array.isArray(j) ? { 行数: j.length } : j));
  show('  → 通用 claims', await get(`/api/games/${bgid}/state`), (j) => ({ 通用声称数: j.claims.length }));

  line('⑪ 护栏③：越剧本声称 → 400（真实录入错误须人工确认，不静默修复）');
  // 角色取「教授」：角色表里它属 bmr 剧本，而本局挂的是 tb —— 能解析但越剧本，正是护栏③的靶子。
  // （第一版我拿「守鸦人」当反例，实测它就在 tb 剧本里，守卫不拒才是对的——是数据错了，不是守卫错了。）
  const bc3 = (await post(`/api/games/${bgid}/events/macro`, { kind: 'claim_role', seat: 5, role: '教授', day: 1 })).json();
  show('confirm 5号跳「教授」', await confirm(bgid, bc3), (j) => ({ error: j.error }));

  line('⑫ 护栏②：角色名解析不出 → 降级 said 留痕，不拒、不丢');
  const bc4 = (await post(`/api/games/${bgid}/events/macro`, { kind: 'claim_role', seat: 6, role: '孙子', day: 1 })).json();
  const r12 = (await confirm(bgid, bc4)).json();
  process.stdout.write('  ' + r12.warnings.length + ' 条留痕: ' + JSON.stringify(r12.warnings) + '\n');
  show('  → 该声称落到哪张表', await get(`/api/games/${bgid}/state`), (j) => {
    const last = (j.claims || [])[j.claims.length - 1] || {};
    return { 谓词: last.predicate, 原词: last.object };
  });

  line('⑬ 幂等：同一个幂等键重发建局 ⇒ 同一局（AI 默认重试不再多建一局）');
  const key = { 'idempotency-key': 'smoke-key-001' };
  const i1 = await post('/api/games', { name: '幂等测试局', type: 'werewolf', player_count: 6 }, key);
  const i2 = await post('/api/games', { name: '幂等测试局', type: 'werewolf', player_count: 6 }, key);
  const ok = i1.json().game.id === i2.json().game.id;
  process.stdout.write('  首次 ' + i1.json().game.id + ' → 重发 ' + i2.json().game.id + '　'
    + (ok ? '✔ 同一局' : '★多建了局') + '\n');

  line('⑭ 令牌门：对外监听却没令牌 ⇒ 拒绝启动（不是警告）');
  try {
    require('../src/server').resolveListenConfig({ JUJIAN_HOST: '0.0.0.0' });
    process.stdout.write('  ★没拦住 —— 闸门失效了\n');
  } catch (e) {
    process.stdout.write('  ✔ 拒绝启动，首行: ' + e.message.split('\n')[0] + '\n');
  }
  const cfg = require('../src/server').resolveListenConfig({ JUJIAN_HOST: '0.0.0.0', JUJIAN_SHARED_TOKEN: 'abc' });
  process.stdout.write('  带令牌则放行: host=' + cfg.host + ' requiresToken=' + cfg.requiresToken + '\n');

  await app.close();
  process.stdout.write('\n冒烟走完。全程内存库 ＋ MOCK 模式 ＋ 零网络。\n');
  if (!ok) process.exit(1);
})().catch((e) => { process.stderr.write('冒烟失败: ' + (e.stack || e.message) + '\n'); process.exit(1); });