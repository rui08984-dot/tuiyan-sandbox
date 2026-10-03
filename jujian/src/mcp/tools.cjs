'use strict';
/**
 * 局鉴 · src/mcp/tools.cjs —— 对外工具表（8 条：5 读 3 只提案）
 *
 * ══ 一条铁律，写在这份文件的最上面 ═══════════════════════════════════════
 *   **这个 server 不能替任何人往对局账本里写一个字。**
 *
 *   理由不是谨慎，是产品的根：局鉴的全部价值是「矛盾清单里每一条都能回查到
 *   原始发言、每一条都说得出也可能不是矛盾的理由」。这个价值完全建立在
 *   「账本里那句是谁说的」可信之上。
 *   ⇒ 一条由模型生成的、没人核对过的声称混进账本，
 *     矛盾检测就在编造上推理了，而它的输出看起来和有据可查的一模一样。
 *
 *   ⇒ 三条写意图工具（record_claim / record_speech / review_day）
 *     **只返回落库草案**，一个字节都不写。人确认后自己走 CLI 或网页。
 *     这与「它不替你下结论」是同一句话的两种说法。
 *
 * ── 每条工具的 description 为什么这么长 ────────────────────────────────────
 *   模型的输出会照抄 description。少写一句「不能做什么」，
 *   模型就会替你圆过去。所以每条都写全三段：
 *   **怎么读 · 不能做什么 · 越界时返回什么**。
 */

const store = require('../db/store');
const { buildMacroCard, MACRO_KINDS } = require('../llm/macros');
const { listAdapters } = require('../http/adapters');

const PROTOCOL_VERSION = '2026-07-28';
const SERVER_ID = 'jujian';

/** 三条写意图工具共用的一段声明——把它们「不写」这件事说清楚。 */
const NO_WRITE = [
  '',
  '⚠ **只读预览。这条工具永远不会真的写入对局账本。**',
  '   它把你要写的东西整理成一份草案返回，账本一个字节都不动。',
  '   **这不是失败，也绝不是重试信号 —— 任何情况下都不要重试本工具。**',
  '   要真写入：由人自己确认后走 `jujian <局号> …` 命令行或网页。',
].join('\n');

// ── 五条读工具 ────────────────────────────────────────────────────────────

const LIST_GAMES = {
  name: 'jujian_list_games',
  title: '复盘 · 列出全部局',
  readOnly: true,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  desc: [
    '列出本机上局鉴的全部对局，含事件数、声称数、矛盾数与参谋卡数。',
    '',
    '怎么读：`games` 是一个数组，每行含 `id`（后面所有工具都用它指局）、`name`、',
    '`game_type`、`player_count`、`event_count`、`max_day`。',
    '',
    '不能做什么：',
    '  · **不判断哪一局更值得看**：排序只按 id 倒序，不代表任何质量判断。',
    '  · **不读出用户名或邮箱**：席位默认叫「N号」，除非本人改过。',
    '',
    '越界时返回什么：本工具无参数，不会越界。',
    '  若 `games` 是空数组 ⇒ 这台机器上还没有局，用 jujian_record_claim 起草一份建局流程。',
  ].join('\n'),
  run() {
    return {
      content: [{ type: 'text', text: humanGames(store.listGames()) }],
      structuredContent: { tool: 'jujian_list_games', games: store.listGames() },
    };
  },
};

const GAME_STATE = {
  name: 'jujian_game_state',
  title: '复盘 · 读整局状态',
  readOnly: true,
  schema: {
    type: 'object',
    properties: {
      game_id: { type: 'integer', description: '局号。★从 jujian_list_games 拿。' },
      upto_day: {
        type: 'integer',
        description: '只回放到第几天为止（≥1）。★复盘「当时看到了什么」就用它：'
          + '不填则回放整局。**填了就等于把 2 号之后的东西藏起来了** —— 那是你的选择，不是默认。',
      },
    },
    required: ['game_id'],
    additionalProperties: false,
  },
  desc: [
    '读一局的事件、声称与行动。声称是局鉴的核心：谁、在第几天、说了什么、关于谁。',
    '',
    '怎么读：',
    '  · `events[]` 按「夜→昼→黄昏」再按 seq 排序，**这个顺序是复盘的时间轴，不要重排**。',
    '  · `claims[]` 每行含 `seat`（谁说的）、`subject_seat`（说的是谁）、`predicate`（说了什么）、',
    '    `object`（对象）。**`predicate` 是本工具的关键**：`is_wolf`=查杀、`is_good`=发好人、',
    '    `claims_role`=跳身份、`said`=说过某句话（解析不出角色时的降级留痕）。',
    '  · `actions[]` 含 `action`（vote/kill_target/check_target…）与 `target_seat`。',
    '  · 撤回的行不在这里（软删），所以**看到的不等于发生过的全部** —— 这一点工具不会替你补。',
    '',
    '不能做什么：',
    '  · **不告诉你谁是狼**：它只复述谁说了什么，不做嫌疑排序。',
    '  · **不判断哪句是真话**：账本记的是「谁说了什么」，不是「谁说的是真的」。',
    '  · **不补缺失**：抽取代词（如「他说昨天那人」）不会被猜成具体席位。',
    '',
    '越界时返回什么：',
    '  · `game_id` 不存在 ⇒ isError ＋ 列出实际存在的局号。',
    '  · `upto_day` <1 ⇒ isError ＋ 说清取值范围。',
  ].join('\n'),
  run(args) {
    const gid = requireId(args.game_id, 'game_id');
    const upto = args.upto_day === undefined ? undefined : requireId(args.upto_day, 'upto_day');
    const state = store.loadGameState(gid, upto);
    if (!state) {
      return errorResult(this.name, '局 ' + gid + ' 不存在',
        '当前存在的局号：' + (store.listGames().map((g) => g.id).join('、') || '（一个都没有）'));
    }
    const txt = [
      '局 ' + gid + '「' + state.game.name + '」' + (upto ? '（回放到第 ' + upto + ' 天）' : '（整局）'),
      '席位：' + state.players.map((p) => p.name).join(' '),
      '',
      '事件 ' + state.events.length + ' 条：',
      ...state.events.map((e) => '  第' + e.day + '天·' + phaseZh(e.phase) + ' #' + e.seq
        + '  ' + (e.actor_seat === null ? '（系统）' : e.actor_seat + '号') + '：' + e.raw_text),
      '',
      '声称 ' + state.claims.length + ' 条：',
      ...state.claims.map((c) => '  #' + c.id + ' 第' + c.day + '天 ' + c.seat + '号说'
        + c.subject_seat + '号 ' + predicateZh(c.predicate) + '：' + c.object),
      '',
      '行动 ' + state.actions.length + ' 条：',
      ...state.actions.map((a) => '  #' + a.id + ' 第' + a.day + '天 ' + a.seat + '号 '
        + actionZh(a.action) + (a.target_seat ? ' → ' + a.target_seat + '号' : '') + (a.result ? '（' + a.result + '）' : '')),
    ].join('\n');
    return { content: [{ type: 'text', text: txt }], structuredContent: { tool: this.name, state: plain(state) } };
  },
};

const REVIEW_CARD = {
  name: 'jujian_review_card',
  title: '复盘 · 读参谋卡',
  readOnly: true,
  schema: {
    type: 'object',
    properties: {
      game_id: { type: 'integer', description: '局号。' },
      day: { type: 'integer', description: '第几天（≥1）。★不填则返回全部已存档的天。' },
    },
    required: ['game_id'],
    additionalProperties: false,
  },
  desc: [
    '读天结算的参谋卡：矛盾清单、假设、以及「明天该盯什么」。',
    '',
    '怎么读：矛盾每条含四件，**四件都要念出来**：',
    '  · `conflict_desc` —— 哪两句打架（唯一真源是代码比对器，不是模型）。',
    '  · `underdetermination` —— high/mid/low，**证据有多硬**。high 也不等于结论，只是几乎无解释空间。',
    '  · `innocent_explanations` —— **≥1 条**，「也可能不是矛盾」的理由。这一条是局鉴的地基。',
    '  · `claim_a/claim_b/action_a/action_b` —— 回指具体哪几条，★转述前先回查，别只念描述。',
    '假设含 `content`（当时的怀疑）、`stance`（逐人立场）、`support_events`（依据哪几条发言）。',
    '',
    '不能做什么：',
    '  · **不替你下结论**：矛盾清单是「这两句对不上」，不是「所以 3 号是狼」。',
    '  · **不排序嫌疑**：它不给嫌疑排名，因为它没被证明排得准。',
    '  · **不自动勾明日清单**：只有你知道答案。',
    '',
    '越界时返回什么：',
    '  · 那天没有存档 ⇒ isError ＋ 说清「要先跑 jujian_review_day（由人执行）」。',
    '  · 一条都没有 ⇒ isError ＋ 说清空榜的意思是「还没结算过」，不是「这局没矛盾」。',
  ].join('\n'),
  run(args) {
    const gid = requireId(args.game_id, 'game_id');
    const game = store.getGame(gid);
    if (!game) return errorResult(this.name, '局 ' + gid + ' 不存在', '用 jujian_list_games 看有哪些局。');
    const hypotheses = store.getHypotheses(gid).filter((h) => (args.day === undefined ? true : h.day === args.day));
    const contradictions = store.getContradictions(gid);
    const days = [...new Set(hypotheses.map((h) => h.day))].sort((a, b) => b - a);
    if (!days.length) {
      return errorResult(this.name,
        args.day === undefined ? '这一局还没有任何已存档的参谋卡' : '第 ' + args.day + ' 天没有存档的参谋卡',
        '参谋卡由天结算生成，而**天结算要由人执行**（`jujian ' + gid + ' advise --day=' + (args.day || 1) + '`）。'
        + '本 server 只能起草，不能代跑 —— 因为落库的是分析结果，得有人在场。');
    }
    const buildCards = require('../routes/advise.js').buildCards;
    const cards = buildCards(gid, days);
    const txt = cards.map((c) => [
      '── 第 ' + c.day + ' 天 ──',
      '矛盾 ' + c.contradictions.length + ' 条：',
      ...c.contradictions.map((x) => '  · ' + x.conflict_desc
        + '\n    欠定度 ' + x.underdetermination
        + ' ｜ 无辜解释：' + (x.innocent_explanations || []).join('；')
        + '\n    回指：claim ' + [x.claim_a, x.claim_b].filter(Boolean).join(' vs ')
        + ' / action ' + [x.action_a, x.action_b].filter(Boolean).join(' vs ')),
      '假设 ' + c.hypotheses.length + ' 条：',
      ...c.hypotheses.map((h) => '  · ' + h.content + '（倾向 ' + h.tendency + '）'),
    ].join('\n')).join('\n\n');
    return {
      content: [{ type: 'text', text: txt }],
      structuredContent: { tool: this.name, game_id: gid, cards: plain(cards) },
    };
  },
};

const CONTRADICTIONS = {
  name: 'jujian_contradictions',
  title: '复盘 · 只看矛盾清单',
  readOnly: true,
  schema: {
    type: 'object',
    properties: { game_id: { type: 'integer', description: '局号。' } },
    required: ['game_id'],
    additionalProperties: false,
  },
  desc: [
    '只要矛盾清单，不要假设与其它内容。适合「这局有没有对不上的地方」这种问题。',
    '',
    '怎么读：同 jujian_review_card 的矛盾四件。',
    '',
    '不能做什么：不排序嫌疑、不判断谁是狼、不补「也可能不是矛盾」。',
    '',
    '越界时返回什么：局不存在 ⇒ isError ＋ 列出已有局号。',
  ].join('\n'),
  run(args) {
    const gid = requireId(args.game_id, 'game_id');
    if (!store.getGame(gid)) return errorResult(this.name, '局 ' + gid + ' 不存在', '用 jujian_list_games 看有哪些局。');
    const rows = store.getContradictions(gid);
    // ★末尾的 .join('\n') 不能少：少了它 map() 的结果（数组）会被原样塞进
    //   content[0].text，而 MCP 规范要求 text 是字符串 ——
    //   客户端要么解析失败，要么把 [数组] 直接念给用户听。
    //   零矛盾时走 else 分支（本来就是字符串），所以只有「有矛盾」这一条路径会暴露它。
    const txt = rows.length
      ? rows.map((x) => '· ' + x.conflict_desc + '\n  欠定 ' + x.underdetermination
        + ' ｜ 无辜解释：' + (x.innocent_explanations || []).join('；')).join('\n')
      : '这一局还没有任何已存档的矛盾。★空清单的意思是「还没结算过或没录够发言」，不是「这局没人撒谎」。';
    return { content: [{ type: 'text', text: txt }], structuredContent: { tool: this.name, game_id: gid, contradictions: plain(rows) } };
  },
};

const GAME_TYPES = {
  name: 'jujian_game_types',
  title: '复盘 · 支持哪些游戏',
  readOnly: true,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  desc: [
    '列出局鉴支持的对局类型，以及每种的矛盾推理能力是否就绪。',
    '',
    '怎么读：`ready:true` 表示该类型的矛盾推理可用；`ready:false` 时看 `missing`（缺哪几个方法）。',
    '★`contract` 那一栏是「五方法契约齐了几样」——它就是加新游戏时要实现的东西。',
    '',
    '不能做什么：不判断某种玩法「好不好玩」、不建议用哪种。',
    '',
    '越界时返回什么：本工具无参数，不会越界。',
  ].join('\n'),
  run() {
    const list = listAdapters();
    const txt = list.map((a) => a.id + '  ' + a.name + '  ready=' + a.ready
      + (a.contract ? '  contract=' + a.contract : '') + (a.missing ? '  缺：' + a.missing.join(',') : '')).join('\n');
    return { content: [{ type: 'text', text: txt }], structuredContent: { tool: this.name, types: list } };
  },
};

// ── 三条写意图工具（只起草，不写） ─────────────────────────────────────────

const RECORD_CLAIM = {
  name: 'jujian_record_claim',
  title: '录入 · 起草一条结构化声称',
  readOnly: false,
  schema: {
    type: 'object',
    properties: {
      game_id: { type: 'integer', description: '局号。' },
      kind: { type: 'string', enum: MACRO_KINDS, description: 'claim_role=跳身份 / check=查杀 / good=发金水。' },
      seat: { type: 'integer', description: '谁说的（席位号，≥1）。' },
      argument: { type: 'string', description: 'kind=claim_role 时填角色名（如「预言家」）；kind=check/good 时填目标席位号（如「3」）。' },
      day: { type: 'integer', description: '第几天（≥1）。' },
    },
    required: ['game_id', 'kind', 'seat', 'argument'],
    additionalProperties: false,
  },
  desc: [
    '起草一条「某人声称了什么」的录入。**只生成草案，不写账本。**' + NO_WRITE,
    '',
    '怎么读：返回 `write_plan`，里面是这次会写成的那句话与那几条声称。人核对无误后自己录入。',
    '',
    '不能做什么：',
    '  · **不替你确认**：草案里的每一项都可能是模型听错了，必须有人看过。',
    '  · **不判断这个人是不是在演**：它只记「他说了什么」。',
    '  · **不接受自由文本**：`say` 类发言用 jujian_record_speech（那是另一条，且要过抽取）。',
    '',
    '越界时返回什么：',
    '  · `kind` 不在枚举 ⇒ isError ＋ 列出三个合法值。',
    '  · 席位不在该局名单内 ⇒ isError ＋ 说清该局有几人。**这是录入错误，不要绕过去。**',
    '  · 角色名在 BOTC 剧本里不存在 ⇒ isError ＋ 说清它属于哪个剧本（越剧本声称必须人工确认）。',
    '  · 以上都是**用法错**，补齐后可重试 —— 与上面的「永不写入、不要重试」是两回事，别混。',
  ].join('\n'),
  run(args) {
    const gid = requireId(args.game_id, 'game_id');
    const game = store.getGame(gid);
    if (!game) return errorResult(this.name, '局 ' + gid + ' 不存在', '用 jujian_list_games 看有哪些局。');
    const day = args.day === undefined ? 1 : requireId(args.day, 'day');
    const seat = requireId(args.seat, 'seat');
    if (!store.seatExists(gid, seat)) {
      return errorResult(this.name, '席位 ' + seat + ' 不在局 ' + gid + ' 的名单里',
        '这一局有 ' + game.player_count + ' 人（席位 1..' + game.player_count + '）。'
        + '★如果席位本身是对的，多半是局号错了。');
    }
    if (!MACRO_KINDS.includes(args.kind)) {
      return errorResult(this.name, 'kind 必须是 ' + MACRO_KINDS.join(' | '), '收到：' + JSON.stringify(args.kind));
    }
    let body;
    if (args.kind === 'claim_role') {
      body = { kind: args.kind, seat, role: String(args.argument), day };
    } else {
      const target = Number(args.argument);
      if (!Number.isInteger(target) || target < 1) {
        return errorResult(this.name, 'kind=' + args.kind + ' 时 argument 必须是目标席位号（≥1 的整数）',
          '收到：' + JSON.stringify(args.argument));
      }
      if (target === seat) return errorResult(this.name, '查杀/金水的对象不能是自己（seat=' + seat + '）');
      body = { kind: args.kind, seat, target_seat: target, day };
    }
    let card;
    try { card = buildMacroCard(body); }
    catch (e) { return errorResult(this.name, e.message, '这是一条录入错误，补齐后重试。'); }
    // BOTC 剧本越界检查：能解析但不属于本剧本 ⇒ 必须人确认，不静默修复
    if (game.game_type === 'botc' && args.kind === 'claim_role') {
      const roles = require('../kernel/botc/roles');
      const script = store.getGameScript(gid);
      if (!script) {
        return errorResult(this.name, '局 ' + gid + ' 是血染钟楼局但没挂剧本，无法校验角色',
          '挂剧本：建局时加 --script=tb|bmr|snv');
      }
      const role = roles.resolveRole(String(args.argument));
      if (role && !roles.roleInEdition(role, script)) {
        return errorResult(this.name,
          '角色「' + roles.roleNameZh(role) + '」不属于剧本 ' + script,
          '它属于 ' + (role.editions || []).join('/') + '。★越剧本声称是真实的录入错误，必须人工确认，不要静默改成别的。');
      }
    }
    return {
      content: [{ type: 'text', text: humanPlan(card, gid) }],
      structuredContent: {
        tool: this.name, recorded: false, gate_not_confirmed: true,
        verdict: { gate: 'NOT_CONFIRMED', do_not_retry: true },
        write_plan: { game_id: gid, event: card.event, claims: card.claims, kind: args.kind },
        how_to_record: ['jujian ' + gid + ' claim ' + seat + ' ' + args.argument + ' --day=' + day],
      },
    };
  },
};

const RECORD_SPEECH = {
  name: 'jujian_record_speech',
  title: '录入 · 起草一次自由文本抽取',
  readOnly: false,
  schema: {
    type: 'object',
    properties: {
      game_id: { type: 'integer', description: '局号。' },
      seat: { type: 'integer', description: '谁说的（席位号，≥1）。' },
      text: { type: 'string', description: '他的原话，一字不改。★不要替玩家润色或概括 —— 抽取器的输入就是原文。' },
      day: { type: 'integer', description: '第几天（≥1）。' },
    },
    required: ['game_id', 'seat', 'text'],
    additionalProperties: false,
  },
  desc: [
    '把一段原话拆成结构化声称，**产出待确认卡，不写账本**。' + NO_WRITE,
    '',
    '★本工具会**读**这一局已有的发言（抽取需要上下文），但**不写任何一行**。',
    '',
    '怎么读：返回 `claims[]`（拆出来的声称）与 `warnings[]`（降级留痕）。',
    '  ★有 warnings 时**逐条念给用户听**：warnings 的意思是「这一条我没把握，模型降级处理了」，',
    '  它恰恰是最需要人看的地方。',
    '',
    '不能做什么：',
    '  · **不改写原话**：它不润色、不概括、不补全。',
    '  · **不判断真假**：抽出来的是「他声称了什么」，不是「他说的是真的」。',
    '  · **不保证抽全**：漏抽是可能的，所以有确认闸这一步。',
    '',
    '越界时返回什么：',
    '  · 未配 API key ⇒ 走 MOCK 模式，返回体里 `mode:"MOCK"` 如实标注。',
    '    ★转述时必须说清「这是模板结果，不是真模型抽的」—— 冒充是本工具最严重的越界。',
    '  · 空文本 ⇒ isError ＋ 说清要原话。',
  ].join('\n'),
  run(args) {
    const gid = requireId(args.game_id, 'game_id');
    const game = store.getGame(gid);
    if (!game) return errorResult(this.name, '局 ' + gid + ' 不存在', '用 jujian_list_games 看有哪些局。');
    const seat = requireId(args.seat, 'seat');
    if (!store.seatExists(gid, seat)) {
      return errorResult(this.name, '席位 ' + seat + ' 不在局 ' + gid + ' 的名单里',
        '这一局有 ' + game.player_count + ' 人。');
    }
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return errorResult(this.name, 'text 必须是非空字符串', '要的是他的原话。');
    const day = args.day === undefined ? 1 : requireId(args.day, 'day');
    const llm = require('../llm/engine');
    const hasKey = !!(process.env.JUJIAN_LLM_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY);
    // ★readOnly 承诺不许被这一行破掉：这里只跑抽取器，不碰任何写函数。
    const state = store.loadGameState(gid, day);
    let card;
    try {
      card = require('../llm/engine').extractEvent(text, {
        day, seats: state.players.map((p) => p.seat), events: state.events,
        claims: state.claims, actions: state.actions, actor_seat: seat,
      }, { mockMode: !hasKey });
    } catch (e) {
      return errorResult(this.name, '抽取失败：' + e.message, '这是用法或配置问题，可重试。');
    }
    const mode = (card && card.meta && card.meta.mode) || (hasKey ? 'LIVE' : 'MOCK');
    const txt = [
      '模式：' + mode + (mode === 'MOCK' ? '　★这是确定性模板结果，不是真模型抽的' : ''),
      '',
      '原话：' + text,
      '',
      '拆出 ' + ((card && card.claims) || []).length + ' 条声称：',
      ...((card && card.claims) || []).map((c) => '  · ' + seat + '号说' + c.subject_seat + '号 '
        + predicateZh(c.predicate) + '：' + c.object),
      '',
      '★这仍然只是草案：账本一个字节都没动。人核对后再录入。',
    ].join('\n');
    return {
      content: [{ type: 'text', text: txt }],
      structuredContent: {
        tool: this.name, recorded: false, gate_not_confirmed: true, mode: mode,
        verdict: { gate: 'NOT_CONFIRMED', do_not_retry: true },
        draft: { game_id: gid, day, seat, raw_text: text, claims: (card && card.claims) || [], warnings: (card && card.warnings) || [] },
        how_to_record: ['用网页的「确认入账」，或 jujian ' + gid + ' claim … 逐条录'],
      },
    };
  },
};

const REVIEW_DAY = {
  name: 'jujian_review_day',
  title: '复盘 · 起草一次天结算',
  readOnly: false,
  schema: {
    type: 'object',
    properties: {
      game_id: { type: 'integer', description: '局号。' },
      day: { type: 'integer', description: '第几天（≥1）。' },
    },
    required: ['game_id'],
    additionalProperties: false,
  },
  desc: [
    '起草一次天结算：出矛盾清单并存档。**只返回命令，不代跑。**' + NO_WRITE,
    '',
    '★为什么不代跑：参谋卡会写进账本（矛盾与假设两组行），而且它是对这一局的**结论**。',
    '   结论得有人在场。同一天重跑是覆盖，所以它必须由人决定要不要跑。',
    '',
    '怎么读：返回 `how_to_record`，那是一条可直接粘贴的命令。跑完之后用 jujian_review_card 读结果。',
    '',
    '不能做什么：',
    '  · **不预判谁是狼**：它只整理矛盾，不排序嫌疑。',
    '  · **不代跑**：见上。',
    '',
    '越界时返回什么：',
    '  · 那天一条发言都没有 ⇒ isError ＋ 说清「得先录几句」，**不产出空卡**。',
  ].join('\n'),
  run(args) {
    const gid = requireId(args.game_id, 'game_id');
    const game = store.getGame(gid);
    if (!game) return errorResult(this.name, '局 ' + gid + ' 不存在', '用 jujian_list_games 看有哪些局。');
    const day = args.day === undefined ? 1 : requireId(args.day, 'day');
    const pre = store.loadGameState(gid, day);
    if (!pre.events.length) {
      return errorResult(this.name, '局 ' + gid + ' 第 ' + day + ' 天前没有任何事件记录',
        '一条发言都没有时结算出来的卡是空的 —— 那不是复盘，是空转。先录几句。');
    }
    const cmd = 'jujian ' + gid + ' advise --day=' + day;
    return {
      content: [{ type: 'text', text: [
        '第 ' + day + ' 天共 ' + pre.events.length + ' 条事件、' + pre.claims.length + ' 条声称。',
        '',
        '要人自己跑这一条（它会把参谋卡写进账本）：',
        '  ' + cmd,
        '',
        '跑完用 jujian_review_card 读结果。',
      ].join('\n') }],
      structuredContent: {
        tool: this.name, recorded: false, gate_not_confirmed: true,
        verdict: { gate: 'NOT_CONFIRMED', do_not_retry: true },
        preconditions: { events: pre.events.length, claims: pre.claims.length, has_archived_card: store.getHypotheses(gid).some((h) => h.day === day) },
        how_to_record: [cmd],
      },
    };
  },
};

// ── 工具表与分派 ──────────────────────────────────────────────────────────

const ALL = [LIST_GAMES, GAME_STATE, REVIEW_CARD, CONTRADICTIONS, GAME_TYPES, RECORD_CLAIM, RECORD_SPEECH, REVIEW_DAY];
const BY_NAME = new Map(ALL.map((t) => [t.name, t]));

/** 对外暴露的清单（tools/list 用） */
function listTools() {
  return ALL.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.desc,
    inputSchema: t.schema,
    annotations: {
      // ★诚实标注。写意图工具结构上就写不了，所以 destructiveHint 是 false 而不是默认 true。
      readOnlyHint: t.readOnly,
      destructiveHint: false,
      // 三条写意图工具调两次与调一次的差别是零：它们连子进程都不起。
      idempotentHint: true,   // 两条都可重复调用：读工具纯读，写意图工具连子进程都不起
      openWorldHint: false,
    },
  }));
}

function callTool(name, args) {
  const t = BY_NAME.get(name);
  if (!t) {
    const e = new Error('本 server 没有这个工具：' + name + '。可用：' + ALL.map((x) => x.name).join('、'));
    e.protocolError = true;      // 让协议层回 -32602（唯一用这个码的地方）
    throw e;
  }
  try {
    return t.run(Object.assign({}, args));
  } catch (e) {
    return errorResult(name, '工具内部出错：' + (e && e.message ? e.message : String(e)), '这是局鉴这边的故障，可重试。');
  }
}

// ── 小工具 ────────────────────────────────────────────────────────────────

function requireId(v, name) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 1) {
    const e = new Error(name + ' 必须是 ≥1 的整数，收到：' + JSON.stringify(v));
    e.inputError = true;
    throw e;
  }
  return n;
}

/** node:sqlite 的行是 null 原型对象，JSON.stringify 前先转普通对象。 */
function plain(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k]); return o; }
  return v;
}

function errorResult(tool, msg, hint) {
  return {
    isError: true,
    content: [{ type: 'text', text: msg + (hint ? '\n\n' + hint : '') }],
    structuredContent: { tool, error: msg, hint: hint || null },
  };
}

const PHASE_ZH = { night: '夜', day: '昼', dusk: '黄昏' };
const PRED_ZH = {
  is_wolf: '查杀', is_good: '发好人', is_role: '是某角色', claims_role: '跳身份',
  voted: '说投了', did_action: '说做了某动作', said: '说过（未能解析成角色）',
  is_demon: '是恶魔', is_minion: '是爪牙', status_drunk: '是醉酒', status_poisoned: '是中毒',
};
const ACT_ZH = {
  vote: '投了', abstain: '弃票', kill_target: '刀了', poison_target: '毒了',
  protect_target: '守了', check_target: '验了', self_explode: '自爆',
};
const phaseZh = (p) => PHASE_ZH[p] || p;
const predicateZh = (p) => PRED_ZH[p] || p;
const actionZh = (a) => ACT_ZH[a] || a;

function humanGames(rows) {
  if (!rows.length) return '这台机器上还没有局。用 jujian_record_claim 起草一份建局流程。';
  return rows.map((g) => '#' + g.id + '  ' + g.name + '  ' + g.game_type
    + '  ' + g.player_count + '人  第' + (g.max_day || 0) + '天'
    + '  事件' + g.event_count + '  ' + (g.script ? '剧本=' + g.script : '')).join('\n');
}
function humanPlan(card, gid) {
  return [
    '草案（**未写入**）：',
    '  局 ' + gid + ' 第' + card.event.day + '天·' + phaseZh(card.event.phase) + '：' + card.event.raw_text,
    ...card.claims.map((c) => '  声称：' + c.seat + '号说' + c.subject_seat + '号 ' + predicateZh(c.predicate) + '：' + c.object),
    '',
    '★人核对后自己录。账本现在一个字节都没动。',
  ].join('\n');
}

module.exports = {
  PROTOCOL_VERSION, SERVER_ID,
  ALL, BY_NAME,
  listTools, callTool,
  // 供测试与内部复用
  errorResult, plain,
};