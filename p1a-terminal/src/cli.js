'use strict';
/**
 * P1a「AI 推演沙盘」CLI 交互层 —— B 路
 * 契约: docs/sandbox/p1a/schema-contract-v0.md（§1 表 / §2 事件类型 / §3 LLM 契约）
 * 设计: docs/specs/2026-09-07-推演沙盘-design.md §14（v3.2 终端版）
 *
 * 用法:
 *   node src/cli.js new <局名> <类型> <人数>      # 类型 werewolf|botc|script
 *   node src/cli.js add <局id> <自然语言记录>     # LLM 抽取→回显卡片→逐字段确认→confirmed_by_user=1 入库
 *   node src/cli.js day <局id> <天数>            # 天结算→LLM 参谋卡→机械自洽校验→渲染
 *   node src/cli.js list <局id>
 *   node src/cli.js export <局id>                # JSON 到 stdout（可 > 文件）
 *   node src/cli.js edit c<claimId>|a<actionId> <新值>   # 红队 YD5 修正
 *   node src/cli.js retract c<claimId>|a<actionId>       # 红队 YD5 软删
 *
 * 零第三方依赖，纯 process.argv 路由。退出码: 0=成功 1=错误 2=用户放弃/输入流结束。
 *
 * ── 接口期望（A/C/D 路集成对照；mock 版见 ./_mock_db.js）─────────
 * B→A  src/db.js 须导出:
 *   createGame(name, game_type, player_count) -> {id}
 *   getGame(id) / getPlayers(gameId) / seatExists(gameId, seat) -> bool
 *   addEvent({game_id,day,phase,type,actor_seat,raw_text}) -> {id,seq}
 *   addClaim({event_id,seat,subject_seat,predicate,object,extracted_by,confirmed_by_user}) -> {id}
 *   addAction({event_id,seat,action,target_seat,result}) -> {id}
 *   getClaim(id) / getAction(id) -> 行|null
 *   updateClaimObject(id, object) -> 行（confirmed_by_user 置 1）
 *   updateAction(id, {target_seat?|result?}) -> 行
 *   retractClaim(id) / retractAction(id) -> bool（软删；需 A 路补 retracted 列，契约 v0→v1）
 *   recentClaimsBySeat(gameId, seat, limit=2) -> [{id,day,phase,predicate,object,subject_seat}]
 *   loadGameState(gameId, uptoDay) -> {game,players,events,claims,actions}|null（未撤回）
 *   exportGame(gameId) -> loadGameState 结果 + meta
 *   saveAdvisorCard(gameId, day, card) -> 计数（RD1 innocent_explanations 非空强校验）
 * B→C  src/llm.js 须导出（兼容 advisor/generateCards 与 extract/extractEvent 双命名）:
 *   extract({text, players}) -> {event:{day,phase,type,raw_text},
 *     claims:[{subject_seat,predicate,object}], action:{action,target_seat,result}|null}
 *   advisor({game,players,day,events,claims,actions}) -> {contradictions:[{pair_id,
 *     underdetermination,innocent_explanations[>=1],claim_a?,claim_b?,action_a?,action_b?}],
 *     hypotheses:[{content,stance,support_events,oppose_events,tendency}],
 *     checkpoints:[{text,resolves:[hypothesis_idx]}]}
 * B→D  src/cards.js 可选导出 renderAdvisor(card,{game,day}) -> string|{text}；
 *   缺失或异常自动降级本文件内置纯文本渲染（不阻塞交付）。
 *
 * dev 直跑（A/C 路集成前）: P1A_USE_MOCK=1 node src/cli.js ...
 */

const USAGE = [
  'P1a 推演沙盘 CLI（B 路）',
  '  new     new <局名> <类型> <人数>            类型: werewolf|botc|script',
  '  add     add <局id> <自然语言记录>           LLM 抽取→回显确认→confirmed_by_user=1 入库',
  '  day     day <局id> <天数>                   天结算→参谋卡（矛盾/假设/验证点）',
  '  list    list <局id>',
  '  export  export <局id>                       JSON 输出到 stdout',
  '  edit    edit c<claimId>|a<actionId> <新值>  修正（YD5）',
  '  retract retract c<claimId>|a<actionId>      软删（YD5）',
].join('\n');

const GAME_TYPES = ['werewolf', 'botc', 'script'];
const PHASES = ['night', 'day', 'dusk'];
const EVENT_TYPES = ['statement', 'vote', 'death', 'claim', 'action_reveal', 'system'];
const PREDICATES = ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'];
const ACTION_KINDS = ['vote', 'abstain', 'kill_target', 'poison_target', 'protect_target', 'check_target', 'self_explode'];
const UNDERD = ['high', 'mid', 'low'];
const TENDENCIES = ['strong', 'mid', 'weak'];

class CliError extends Error {}   // 用户可见错误 → 退出码 1
class AbortFlow extends Error {}  // 用户放弃/输入流结束 → 退出码 2，绝不写库

// ── 输入提示器：测试=队列模式（inputs 数组）；交互=readline ──
function createQueuePrompter(inputs, out) {
  let i = 0;
  return async (question) => {
    out.write(question);
    if (i >= inputs.length) throw new AbortFlow('输入流结束，流程中止（未写库）');
    const line = inputs[i++];
    out.write(line === '' ? '（回车）\n' : line + '\n');
    return line;
  };
}

function createReadlinePrompter(out) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: null, terminal: false });
  let closed = false;
  rl.on('close', () => { closed = true; });
  const prompt = async (question) => {
    out.write(question);
    if (closed) throw new AbortFlow('输入流结束，流程中止（未写库）');
    return await new Promise((resolve, reject) => {
      const onLine = (ans) => { cleanup(); resolve(ans); };
      const onClose = () => { cleanup(); reject(new AbortFlow('输入流结束，流程中止（未写库）')); };
      function cleanup() { rl.removeListener('line', onLine); rl.removeListener('close', onClose); }
      rl.on('line', onLine);
      rl.on('close', onClose);
    });
  };
  prompt.close = () => rl.close();
  return prompt;
}
// ── 抽取结果净化：契约 §3 强校验（枚举/座位），非法项丢弃并留痕 ──
function sanitizeExtraction(ex, players, text) {
  if (!ex || typeof ex !== 'object' || !ex.event) throw new CliError('LLM 抽取缺 event 字段，违反契约 §3');
  const seatSet = new Set(players.map((p) => Number(p.seat)));
  const notices = [];
  const ev = ex.event;
  const day = Number(ev.day);
  if (!Number.isInteger(day) || day < 1) throw new CliError('event.day 非法: ' + JSON.stringify(ev.day) + '（契约 §3）');
  if (!PHASES.includes(ev.phase)) throw new CliError('event.phase 非法: ' + JSON.stringify(ev.phase) + '（契约 §3）');
  if (!EVENT_TYPES.includes(ev.type)) throw new CliError('event.type 非法: ' + JSON.stringify(ev.type) + '（契约 §3）');
  let actor = ev.actor_seat == null ? null : Number(ev.actor_seat);
  if (actor != null && !seatSet.has(actor)) {
    notices.push('行为人席位 ' + ev.actor_seat + ' 不是已存在玩家，已置空');
    actor = null;
  }
  const claims = [];
  for (const c of Array.isArray(ex.claims) ? ex.claims : []) {
    const s = Number(c && c.subject_seat);
    if (!seatSet.has(s)) { notices.push('丢弃声称: subject_seat=' + (c && c.subject_seat) + ' 不是已存在玩家（契约 §3）'); continue; }
    if (!PREDICATES.includes(c.predicate)) { notices.push('丢弃声称: predicate=' + JSON.stringify(c.predicate) + ' 不在枚举'); continue; }
    if (c.object == null || String(c.object).trim() === '') { notices.push('丢弃声称: object 为空'); continue; }
    claims.push({ subject_seat: s, predicate: c.predicate, object: String(c.object) });
  }
  let action = null;
  if (ex.action && typeof ex.action === 'object') {
    const a = ex.action;
    const who = Number(a.seat);
    if (!ACTION_KINDS.includes(a.action)) notices.push('丢弃行动: action=' + JSON.stringify(a.action) + ' 不在枚举');
    else if (!seatSet.has(who)) notices.push('丢弃行动: 行为人 ' + a.seat + ' 不是已存在玩家');
    else {
      let t = a.target_seat == null ? null : Number(a.target_seat);
      if (t != null && !seatSet.has(t)) { notices.push('行动目标 ' + a.target_seat + ' 不是已存在玩家，已置空'); t = null; }
      action = { seat: who, action: a.action, target_seat: t, result: a.result == null ? null : String(a.result) };
    }
  }
  if (actor == null && claims.length) {
    notices.push('事件无行为人（actor_seat 空），' + claims.length + ' 条声称无处归属，全部丢弃');
    claims.length = 0;
  }
  // 契约 §1：raw_text=用户原话不可改写 —— 一律以用户输入为准，忽略 LLM 回传
  return { event: { day, phase: ev.phase, type: ev.type, actor_seat: actor, raw_text: text }, claims, action, notices };
}

// ── 抽取确认卡（YD5 防穿透：原文+结构化逐条+上下文摘要）──
function renderExtractCard(o) {
  const L = [];
  L.push(`┌── 抽取确认卡（第 ${o.round} 轮）` + '─'.repeat(28));
  L.push(`│ 事件原文: ${o.text}`);
  L.push(`│ 结构化  : 第${o.event.day}天 ${o.event.phase} | ${o.event.type} | 行为人: ${o.event.actor_seat == null ? '（无/系统）' : o.event.actor_seat + '号'}`);
  if (o.claims.length) {
    L.push(`│ 声称 ${o.claims.length} 条:`);
    o.claims.forEach((c, i) => L.push(`│   [${i + 1}] ${o.event.actor_seat == null ? '?' : o.event.actor_seat}号 → ${c.subject_seat}号  ${c.predicate}「${c.object}」`));
  } else {
    L.push('│ 声称: 无');
  }
  L.push(o.action
    ? `│ 行动    : ${o.action.seat}号 ${o.action.action}${o.action.target_seat != null ? ' → ' + o.action.target_seat + '号' : ''}${o.action.result ? '（' + o.action.result + '）' : ''}`
    : '│ 行动    : 无');
  for (const n of o.notices) L.push(`│ ⚠ ${n}`);
  L.push(`│ ── 上下文摘要（${o.event.actor_seat == null ? '-' : o.event.actor_seat}号 此前最近 2 条声称）──`);
  if (o.contextClaims.length) {
    for (const c of o.contextClaims) L.push(`│   · 第${c.day}天${c.phase} ${c.predicate}「${c.object}」(c${c.id})`);
  } else {
    L.push('│   · （暂无历史声称）');
  }
  L.push('└' + '─'.repeat(48));
  return L.join('\n');
}

// ── 高险字段（seat）键控确认：回车=对；整数且席位存在=修正；非法=拒绝重问；q=放弃 ──
async function confirmSeat(prompt, out, seatCtx, fieldLabel, initialSeat) {
  let cur = initialSeat;
  for (;;) {
    out.write('· [字段确认] ' + fieldLabel + '\n');
    const ans = (await prompt('涉及席位: ' + cur + '，正确请回车，否则输入正确席位号: ')).trim();
    if (ans === '') return { seat: cur, changed: false };
    if (ans === 'q') throw new AbortFlow('已放弃本次录入（未写库）');
    const n = Number(ans);
    if (!Number.isInteger(n) || n < 1 || n > seatCtx.maxSeat) {
      out.write('✗ 无效席位「' + ans + '」（需 1-' + seatCtx.maxSeat + ' 的整数），已拒绝，请重新输入\n');
      continue;
    }
    if (!seatCtx.seatExists(n)) {
      out.write('✗ 席位 ' + n + ' 不存在，已拒绝，请重新输入\n');
      continue;
    }
    return { seat: n, changed: n !== cur };
  }
}

function toInt(s, label) {
  const n = Number(String(s == null ? '' : s).trim());
  if (!Number.isInteger(n)) throw new CliError(label + '「' + s + '」必须是整数');
  return n;
}

function parseRecordId(s) {
  const m = /^([ca])(\d+)$/i.exec(String(s == null ? '' : s).trim());
  if (!m) throw new CliError('id「' + s + '」非法：需 c<claimId> 或 a<actionId>，如 c3 / a2');
  return { kind: m[1].toLowerCase(), id: Number(m[2]) };
}

// ── CLI 工厂：deps 注入（测试注入 mock；生产由 main() 装配真实模块）──
function createCli(deps = {}) {
  const db = deps.db;
  const llm = deps.llm;
  const cards = deps.cards || null;
  const out = deps.output || { write: (s) => process.stdout.write(s) };
  const ew = deps.errput || { write: (s) => process.stderr.write(s) };
  if (!db) throw new Error('createCli 缺 deps.db');
  if (!llm) throw new Error('createCli 缺 deps.llm');
  const prompt = deps.inputs ? createQueuePrompter(deps.inputs, out) : createReadlinePrompter(out);
  function cmdNew(rest) {
    const name = rest[0], type = rest[1], countText = rest[2];
    if (!name || !type || !countText) throw new CliError('用法: new <局名> <类型> <人数>（类型 werewolf|botc|script）');
    if (!GAME_TYPES.includes(type)) throw new CliError('类型「' + type + '」非法，仅支持 werewolf|botc|script');
    const playerCount = toInt(countText, '人数');
    const g = db.createGame(name, type, playerCount);
    out.write('✓ 局 ' + g.id + '「' + g.name + '」已创建: ' + g.game_type + ' ' + g.player_count + ' 人（席位 1-' + g.player_count + ' 已就位）\n');
    out.write('  下一步: node src/cli.js add ' + g.id + ' "<自然语言记录>"\n');
    return 0;
  }

  // ── add 确认流（YD5 防穿透）：抽取→回显→逐字段键控→任一修改重显一轮→confirmed_by_user=1 才入库 ──
  async function cmdAdd(rest) {
    const gidText = rest[0];
    const text = rest.slice(1).join(' ').trim();
    if (!gidText || !text) throw new CliError('用法: add <局id> <自然语言记录>');
    const gameId = toInt(gidText, '局id');
    const game = db.getGame(gameId);
    if (!game) throw new CliError('局 ' + gameId + ' 不存在');
    const players = db.getPlayers(gameId);
    const extractFn = typeof llm.extract === 'function' ? llm.extract : llm.extractEvent;
    if (typeof extractFn !== 'function') throw new CliError('src/llm.js 需导出 extract({text,players})（契约 §3）');
    let ex;
    try { ex = await extractFn.call(llm, { text, players }); }
    catch (e) { throw new CliError('LLM 抽取失败: ' + (e && e.message ? e.message : e)); }
    const card = sanitizeExtraction(ex, players, text);
    const seatCtx = { maxSeat: game.player_count, seatExists: (s) => db.seatExists(gameId, s) };
    let round = 0;
    for (;;) {
      round++;
      const ctxClaims = card.event.actor_seat != null ? db.recentClaimsBySeat(gameId, card.event.actor_seat, 2) : [];
      out.write(renderExtractCard({
        round, text, event: card.event, claims: card.claims, action: card.action,
        notices: card.notices, contextClaims: ctxClaims,
      }) + '\n');
      let modified = false;
      if (card.event.actor_seat != null) {
        const r = await confirmSeat(prompt, out, seatCtx, '行为人', card.event.actor_seat);
        if (r.changed) { card.event.actor_seat = r.seat; modified = true; }
      }
      for (const c of card.claims) {
        const r = await confirmSeat(prompt, out, seatCtx, '声称对象（第 ' + (card.claims.indexOf(c) + 1) + ' 条）', c.subject_seat);
        if (r.changed) { c.subject_seat = r.seat; modified = true; }
      }
      if (card.action) {
        const r1 = await confirmSeat(prompt, out, seatCtx, '行动人', card.action.seat);
        if (r1.changed) { card.action.seat = r1.seat; modified = true; }
        if (card.action.target_seat != null) {
          const r2 = await confirmSeat(prompt, out, seatCtx, '行动目标', card.action.target_seat);
          if (r2.changed) { card.action.target_seat = r2.seat; modified = true; }
        }
      }
      if (modified) { out.write('· 检测到席位修改，按 YD5 重新回显一轮\n'); continue; }
      let fin;
      for (;;) {
        fin = (await prompt('全部确认入库？(回车=确认 / r=重新回显 / q=放弃): ')).trim();
        if (fin === '' || fin === 'r' || fin === 'q') break;
        out.write('✗ 无效选择「' + fin + '」，请输入 回车 / r / q\n');
      }
      if (fin === '') break;
      if (fin === 'q') throw new AbortFlow('已放弃本次录入（未写库）');
      // 'r' → 外层循环重新回显
    }
    const evRow = db.addEvent({
      game_id: gameId, day: card.event.day, phase: card.event.phase,
      type: card.event.type, actor_seat: card.event.actor_seat, raw_text: text,
    });
    let nClaim = 0;
    for (const c of card.claims) {
      db.addClaim({
        event_id: evRow.id, seat: card.event.actor_seat, subject_seat: c.subject_seat,
        predicate: c.predicate, object: c.object, extracted_by: 'llm', confirmed_by_user: 1,
      });
      nClaim++;
    }
    let nAction = 0;
    if (card.action) {
      db.addAction({
        event_id: evRow.id, seat: card.action.seat, action: card.action.action,
        target_seat: card.action.target_seat, result: card.action.result,
      });
      nAction = 1;
    }
    out.write('✓ 已入账 事件 e' + evRow.id + '(seq ' + evRow.seq + ') · 声称 ' + nClaim + ' 条 · 行动 ' + nAction + ' 条（confirmed_by_user=1）\n');
    return 0;
  }

  // ── 矛盾对引用的 claim/action id 收集（直接字段 + pair_id 内 cN/aN 记号）──
  function referencedRecordIds(contradiction) {
    const refs = [];
    const push = (kind, v) => {
      if (v == null || v === '') return;
      const n = Number(String(v).replace(/^[ca]/i, ''));
      if (Number.isInteger(n)) refs.push({ kind, id: n });
    };
    push('claim', contradiction.claim_a); push('claim', contradiction.claim_b);
    push('action', contradiction.action_a); push('action', contradiction.action_b);
    const toks = String(contradiction.pair_id == null ? '' : contradiction.pair_id).match(/[ca]\d+/gi) || [];
    for (const tok of toks) push(tok[0].toLowerCase() === 'c' ? 'claim' : 'action', tok);
    return refs;
  }

  // ── 机械自洽校验（契约 §3 末段，LY昼2 脱节回归）：渲染前的门 ──
  function validateAdvisorCard(card, state) {
    const errs = [];
    const claimIds = new Set(state.claims.map((c) => c.id));
    const actionIds = new Set(state.actions.map((a) => a.id));
    const eventIds = new Set(state.events.map((e) => e.id));
    const seatSet = new Set(state.players.map((p) => Number(p.seat)));
    (card.contradictions || []).forEach((c, i) => {
      const label = c.pair_id != null ? String(c.pair_id) : ('#' + (i + 1));
      if (!Array.isArray(c.innocent_explanations) || c.innocent_explanations.length < 1) {
        errs.push('矛盾对 ' + label + ': innocent_explanations 为空（RD1 非空强校验）');
      }
      if (!UNDERD.includes(c.underdetermination)) {
        errs.push('矛盾对 ' + label + ': underdetermination=' + JSON.stringify(c.underdetermination) + ' 不在枚举');
      }
      for (const ref of referencedRecordIds(c)) {
        const ok = ref.kind === 'claim' ? claimIds.has(ref.id) : actionIds.has(ref.id);
        if (!ok) errs.push('矛盾对 ' + label + ': 引用的' + (ref.kind === 'claim' ? '声称' : '行动') + ' ' + ref.kind + '#' + ref.id + ' 不存在于库（契约 §3 自洽）');
      }
    });
    (card.hypotheses || []).forEach((h, i) => {
      const label = '假设H' + (i + 1);
      if (!TENDENCIES.includes(h.tendency)) errs.push(label + ': tendency=' + JSON.stringify(h.tendency) + ' 不在枚举');
      if (typeof h.content !== 'string' || !h.content.trim()) errs.push(label + ': content 为空');
      const goodBelieve = new Set();
      const stance = h.stance && typeof h.stance === 'object' ? h.stance : {};
      for (const k of Object.keys(stance)) {
        if (k === 'suspect_top' || k === 'suspect_ranking') continue; // 嫌疑排序保留键（B/C 双命名），非座位
        const seat = Number(k);
        if (!Number.isInteger(seat) || !seatSet.has(seat)) { errs.push(label + ': stance 引用不存在玩家 ' + k); continue; }
        if (stance[k] === 'good_believe') goodBelieve.add(seat);
      }
      // 嫌疑 Top 区双命名兼容：B 路 suspect_top / C 路 llm.js suspect_ranking
      const top = Array.isArray(stance.suspect_top) ? stance.suspect_top.map(Number)
        : (Array.isArray(stance.suspect_ranking) ? stance.suspect_ranking.map(Number) : []);
      for (const s of top) {
        if (goodBelieve.has(s)) errs.push(label + ': 自洽失败——玩家 ' + s + '号 被标 good_believe 却进入嫌疑 Top（LY昼2 脱节）');
      }
      for (const eid of [].concat(h.support_events || [], h.oppose_events || [])) {
        if (!eventIds.has(Number(eid))) errs.push(label + ': 引用不存在的事件 e' + eid);
      }
    });
    (card.checkpoints || []).forEach((cp, i) => {
      const total = (card.hypotheses || []).length;
      for (const idx of cp.resolves || []) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= total) errs.push('验证点#' + (i + 1) + ': resolves 引用越界假设下标 ' + idx);
      }
    });
    return errs;
  }

  // ── day：天结算 → 参谋卡（思路非答案）──
  async function cmdDay(rest) {
    const gidText = rest[0], dayText = rest[1];
    if (!gidText || dayText == null) throw new CliError('用法: day <局id> <天数>');
    const gameId = toInt(gidText, '局id');
    const day = toInt(dayText, '天数');
    if (day < 1) throw new CliError('天数非法: ' + day);
    const state = db.loadGameState(gameId, day);
    if (!state) throw new CliError('局 ' + gameId + ' 不存在');
    if (!state.events.length) throw new CliError('局 ' + gameId + ' 第 ' + day + ' 天前没有任何事件记录，无法天结算');
    const genFn = typeof llm.advisor === 'function' ? llm.advisor : llm.generateCards;
    if (typeof genFn !== 'function') throw new CliError('src/llm.js 需导出 advisor()/generateCards()（契约 §3）');
    let card;
    try {
      card = await genFn.call(llm, {
        game: state.game, players: state.players, day,
        events: state.events, claims: state.claims, actions: state.actions,
      });
    } catch (e) { throw new CliError('LLM 参谋卡生成失败: ' + (e && e.message ? e.message : e)); }
    if (!card || !Array.isArray(card.contradictions) || !Array.isArray(card.hypotheses)) {
      throw new CliError('LLM 参谋卡缺 contradictions/hypotheses 数组，违反契约 §3');
    }
    const errs = validateAdvisorCard(card, state);
    if (errs.length) {
      ew.write('✗ 参谋卡机械自洽校验失败（' + errs.length + ' 项），不渲染、不回存:\n' + errs.map((e) => '  - ' + e).join('\n') + '\n');
      return 1;
    }
    try { db.saveAdvisorCard(gameId, day, card); }
    catch (e) { out.write('⚠ 参谋卡回存失败（不影响展示）: ' + (e && e.message ? e.message : e) + '\n'); }
    let text = null;
    if (cards && typeof cards.renderAdvisor === 'function') {
      try {
        const r = cards.renderAdvisor(card, { game: state.game, day });
        text = typeof r === 'string' ? r : (r && r.text);
      } catch (e) { out.write('⚠ cards.renderAdvisor 异常，降级纯文本渲染: ' + (e && e.message ? e.message : e) + '\n'); }
    }
    if (!text) text = renderAdvisorFallback(card, state.game, day);
    out.write(text.endsWith('\n') ? text : text + '\n');
    return 0;
  }

  function cmdList(rest) {
    if (!rest[0]) throw new CliError('用法: list <局id>');
    const gameId = toInt(rest[0], '局id');
    const state = db.loadGameState(gameId, Infinity);
    if (!state) throw new CliError('局 ' + gameId + ' 不存在');
    const L = [];
    L.push('局 ' + state.game.id + '「' + state.game.name + '」 ' + state.game.game_type + ' ' + state.game.player_count + ' 人 · 创建于 ' + state.game.created_at);
    L.push('玩家: ' + state.players.map((p) => p.seat + '号').join(' '));
    L.push('事件 ' + state.events.length + ' 条 · 声称 ' + state.claims.length + ' 条 · 行动 ' + state.actions.length + ' 条（未撤回）');
    for (const ev of state.events) {
      const who = ev.actor_seat == null ? '系统' : ev.actor_seat + '号';
      L.push('  e' + ev.id + ' [第' + ev.day + '天/' + ev.phase + '/' + ev.type + '] ' + who + ': ' + ev.raw_text);
      for (const c of state.claims.filter((x) => x.event_id === ev.id)) {
        L.push('      c' + c.id + ' ' + c.seat + '号称→' + c.subject_seat + '号 ' + c.predicate + '「' + c.object + '」' + (c.confirmed_by_user ? ' ✓已确认' : ' ⚠未确认'));
      }
      for (const a of state.actions.filter((x) => x.event_id === ev.id)) {
        L.push('      a' + a.id + ' ' + a.seat + '号 ' + a.action + (a.target_seat != null ? '→' + a.target_seat + '号' : '') + (a.result ? '（' + a.result + '）' : ''));
      }
    }
    out.write(L.join('\n') + '\n');
    return 0;
  }

  function cmdExport(rest) {
    if (!rest[0]) throw new CliError('用法: export <局id>');
    const gameId = toInt(rest[0], '局id');
    const data = typeof db.exportGame === 'function' ? db.exportGame(gameId) : db.loadGameState(gameId, Infinity);
    if (!data) throw new CliError('局 ' + gameId + ' 不存在');
    out.write(JSON.stringify(data, null, 2) + '\n');
    return 0;
  }

  function cmdEdit(rest) {
    const idStr = rest[0];
    const value = rest.slice(1).join(' ').trim();
    if (!idStr || !value) throw new CliError('用法: edit c<claimId>|a<actionId> <新值>');
    const ref = parseRecordId(idStr);
    if (ref.kind === 'c') {
      const row = db.getClaim(ref.id);
      if (!row) throw new CliError('claim c' + ref.id + ' 不存在');
      if (row.retracted) throw new CliError('claim c' + ref.id + ' 已撤回，不能修改');
      const upd = db.updateClaimObject(ref.id, value);
      out.write('✓ 已修正 c' + ref.id + ': object「' + row.object + '」→「' + upd.object + '」（confirmed_by_user=1；事件原文按契约不可改写）\n');
    } else {
      const row = db.getAction(ref.id);
      if (!row) throw new CliError('action a' + ref.id + ' 不存在');
      if (row.retracted) throw new CliError('action a' + ref.id + ' 已撤回，不能修改');
      const isSeat = /^\d+$/.test(value);
      if (isSeat && typeof db.seatExists === 'function' && !db.seatExists(row.game_id, Number(value))) {
        throw new CliError('目标席位 ' + value + ' 不是已存在玩家（局 ' + row.game_id + '）');
      }
      const upd = db.updateAction(ref.id, isSeat ? { target_seat: Number(value) } : { result: value });
      out.write('✓ 已修正 a' + ref.id + ': ' + (isSeat ? 'target_seat→' + upd.target_seat + '号' : 'result→「' + upd.result + '」') + '\n');
    }
    return 0;
  }

  function cmdRetract(rest) {
    if (!rest[0]) throw new CliError('用法: retract c<claimId>|a<actionId>');
    const ref = parseRecordId(rest[0]);
    const ok = ref.kind === 'c' ? db.retractClaim(ref.id) : db.retractAction(ref.id);
    if (!ok) throw new CliError((ref.kind === 'c' ? 'claim ' : 'action ') + rest[0] + ' 不存在');
    out.write('✓ 已软删 ' + rest[0] + '（retracted=1；list/export/day 不再纳入）\n');
    return 0;
  }

  async function route(argv) {
    const cmd = argv[0];
    const rest = argv.slice(1);
    if (!cmd) { ew.write(USAGE + '\n'); return 1; }
    switch (cmd) {
      case 'new': return cmdNew(rest);
      case 'add': return await cmdAdd(rest);
      case 'day': return await cmdDay(rest);
      case 'list': return cmdList(rest);
      case 'export': return cmdExport(rest);
      case 'edit': return cmdEdit(rest);
      case 'retract': return cmdRetract(rest);
      case 'help':
      case '--help':
      case '-h':
        out.write(USAGE + '\n');
        return 0;
      default:
        ew.write('未知命令「' + cmd + '」\n\n' + USAGE + '\n');
        return 1;
    }
  }

  async function run(argv) {
    try {
      return await route(argv);
    } catch (e) {
      if (e instanceof AbortFlow) { ew.write('⏹ ' + e.message + '\n'); return 2; }
      if (e instanceof CliError) { ew.write('✗ ' + e.message + '\n'); return 1; }
      ew.write('✗ 未预期错误: ' + (e && e.stack ? e.stack : String(e)) + '\n');
      return 1;
    } finally {
      if (typeof prompt.close === 'function') prompt.close();
    }
  }

  return { run, validateAdvisorCard, referencedRecordIds };
}

// ── B 路内置降级渲染（cards.js 缺失/异常时兜底，思路非答案）──
function renderAdvisorFallback(card, game, day) {
  const L = [];
  L.push(`════ 参谋卡（思路非答案）· 局${game.id}「${game.name}」· 第 ${day} 天结算 ════`);
  const contras = card.contradictions || [];
  L.push(`【矛盾点】${contras.length} 条`);
  contras.forEach((c, i) => {
    L.push(`  ${i + 1}. [欠定度:${c.underdetermination}] ${c.pair_id == null ? '#' + (i + 1) : c.pair_id}`);
    (c.innocent_explanations || []).forEach((e, j) => L.push(`     无辜解释${j + 1}: ${e}`));
  });
  if (!contras.length) L.push('  （本日无冲突对）');
  const hyps = card.hypotheses || [];
  L.push(`【竞争假设】${hyps.length} 套`);
  hyps.forEach((h, i) => {
    const stance = h.stance && typeof h.stance === 'object' ? h.stance : {};
    const top = Array.isArray(stance.suspect_top) ? stance.suspect_top.join(',') : '-';
    L.push(`  H${i + 1}(${h.tendency}): ${h.content}`);
    L.push(`     stance: ${JSON.stringify(stance)}  嫌疑Top: ${top}`);
    L.push(`     支持: ${(h.support_events || []).map((e) => 'e' + e).join(',') || '-'}  反对: ${(h.oppose_events || []).map((e) => 'e' + e).join(',') || '-'}`);
  });
  const cps = card.checkpoints || [];
  L.push(`【验证点】${cps.length} 条`);
  cps.forEach((cp, i) => {
    const res = (cp.resolves || []).map((x) => 'H' + (Number(x) + 1)).join('/');
    L.push(`  ${i + 1}. ${cp.text}（分辨 ${res || '-'}）`);
  });
  L.push('════ （B 路降级渲染；接入 src/cards.js 后为正式卡片）════');
  return L.join('\n');
}

// ── 生产装配：真实模块；A/C 路未就绪时给出可操作提示而非堆栈 ──

// 供应商配置（config/providers.json，.gitignore 已忽略）：key 不入 git；env 仍最高优先级
function loadLlmConfig() {
  try {
    const path = require('path').join(__dirname, '..', 'config', 'providers.json');
    const cfg = JSON.parse(require('fs').readFileSync(path, 'utf8'));
    const p = cfg.providers && cfg.providers[cfg.active];
    if (!p || !p.api_key) return null;
    return { apiKey: p.api_key, baseUrl: p.base_url, model: (p.cards && p.cards.model) || p.model || 'deepseek-chat' };
  } catch (e) { return null; }
}
function withLlmOptions(llm, opts) {
  if (!opts) return llm;
  const inject = (fn) => function (input) {
    input = input || {};
    input.options = Object.assign({}, opts, input.options);
    return fn.call(null, input);
  };
  const out = Object.assign({}, llm);
  if (typeof llm.extract === 'function') out.extract = inject(llm.extract);
  if (typeof llm.advisor === 'function') out.advisor = inject(llm.advisor);
  return out;
}

function main(argv) {
  const useMock = process.env.P1A_USE_MOCK === '1';
  let db = null;
  let llm = null;
  let cards = null;
  try {
    db = useMock ? require('./_mock_db.js').createMockDb() : require('../src/db');
  } catch (e) {
    process.stderr.write('✗ 数据层不可用: ' + (e && e.message ? e.message : e) + '\n  （A 路集成前可 P1A_USE_MOCK=1 走 mock）\n');
    return 1;
  }
  try {
    llm = require('../src/llm');
  } catch (e) {
    process.stderr.write('✗ LLM 适配层不可用: ' + (e && e.message ? e.message : e) + '\n  （C 路 src/llm.js 需导出 extract/advisor，契约 §3）\n');
    return 1;
  }
  const hasExtract = llm && (typeof llm.extract === 'function' || typeof llm.extractEvent === 'function');
  const hasGen = llm && (typeof llm.advisor === 'function' || typeof llm.generateCards === 'function');
  if (!hasExtract || !hasGen) {
    process.stderr.write('✗ src/llm.js 需导出 extract()/extractEvent() 与 advisor()/generateCards()（契约 §3）\n');
    return 1;
  }
  try { cards = require('./cards.js'); } catch (e) { cards = null; }
  if (!useMock) llm = withLlmOptions(llm, loadLlmConfig());
  return createCli({ db, llm, cards }).run(argv);
}

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2)))
    .then((code) => { process.exitCode = Number(code) || 0; })
    .catch((e) => {
      process.stderr.write('✗ 未预期错误: ' + (e && e.stack ? e.stack : String(e)) + '\n');
      process.exitCode = 1;
    });
}

module.exports = { createCli, main, sanitizeExtraction, renderAdvisorFallback };
