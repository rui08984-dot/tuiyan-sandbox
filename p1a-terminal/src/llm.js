'use strict';
/**
 * p1a-terminal/src/llm.js — P1a C 路：LLM 适配层（DeepSeek）
 * 契约依据：docs/sandbox/p1a/schema-contract-v0.md §1/§2/§3/§5；design.md §14.2（红队 RD1/PD1）
 *
 * 【双模式机制】resolveMode(options)：
 *   1) options.mockMode === true/false 时强制指定；
 *   2) 否则 options.apiKey || process.env.DEEPSEEK_API_KEY 存在 → LIVE_MODE
 *      （POST {baseUrl}/chat/completions，model 默认 deepseek-chat；key 只走 env/内存，
 *      绝不写入任何文件 = 契约 §5 env-only）；
 *   3) 无 key → MOCK_MODE：内置确定性 mock 响应，覆盖正常抽取/名单外 seat 丢弃/
 *      无辜解释非空过滤/JSON 损坏重试/自洽校验负例，零网络零依赖，测试不烧 token。
 *   测试注入：options.baseUrl / options.fetchImpl / options.model / options.apiKey
 *   可整体注入（见 test/llm.test.cjs T6），LIVE 全链路可测且不发真实网络请求。
 *
 * 【返回形状】契约 §3 主体 + 附加字段（additive，不破坏 D 路消费）：
 *   extractEvent  → {event, claims, action, warnings, meta:{mode,attempts}}
 *   generateCards → {contradictions, hypotheses, checkpoints, warnings, meta:{mode,attempts}}
 *   warnings[] 是所有「丢弃/删除/废案」动作的留痕（seat 不在名单、RD1 空无辜解释、
 *   悬空 pair_id、废案假设等），B 路 CLI 回显确认流直接展示（契约§3「丢弃该条并提示用户」）。
 *
 * 【RD1 两层归属】代码比对器（A 路）只出字面冲突对；欠定度与无辜解释归本层（LLM 侧），
 *   innocent_explanations 为空 → 该矛盾对整对删除 + 警告，绝不允许空数组流向 D 路
 *   （归代码层会把毒/醉合法谎言当硬冲突系统性冤枉好人，§9.3 实证）。
 * 【自洽校验（机械，本层执行）】① stance 标 good_believe 的座位不得进 suspect_ranking
 *   Top3（LY昼2 脱节修复）；② 输出 pair_id 必须存在于代码比对器输入；③ checkpoint.resolves
 *   下标在假设过滤后重映射，悬空即删。
 *
 * 【模块格式】CommonJS。注意：p1a-terminal/package.json（A 路所有）不要设 "type":"module"，
 *   否则本文件与 test/*.cjs 的 require 链断裂。
 */

// 多服务商支持：任何 OpenAI 兼容端点（DeepSeek/Kimi/GLM/通义/OpenRouter/硅基流动/本地 Ollama 等）
// env 优先级：LLM_BASE_URL / LLM_MODEL / LLM_API_KEY（通用）> DEEPSEEK_API_KEY（DeepSeek 专用兼容）
// Ollama 示例：LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen3:8b
const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const MAX_JSON_RETRIES = 2;        // 契约§3：失败重试 ≤2 次（共 3 次尝试）
const SELF_CONSISTENCY_TOP_N = 3;  // 嫌疑排序 Top 区定义

// 契约 §1/§2 枚举（强校验唯一来源，禁止散落魔法字符串）
const EVENT_TYPES = ['statement', 'vote', 'death', 'claim', 'action_reveal', 'system'];
const PHASES = ['night', 'day', 'dusk'];
const PREDICATES = ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'];
const ACTIONS = ['vote', 'abstain', 'kill_target', 'poison_target', 'protect_target', 'check_target', 'self_explode'];
const ACTIONS_NEED_TARGET = ['vote', 'kill_target', 'poison_target', 'protect_target', 'check_target'];
const UNDERDETERMINATION_LEVELS = ['high', 'mid', 'low'];
const TENDENCY_LEVELS = ['strong', 'mid', 'weak'];
const STANCE_VALUES = ['wolf_suspect', 'good_believe', 'neutral', 'unknown'];

/* ------------------------------------------------------------------
 * Prompt ①：抽取（extractEvent 用）
 * 设计要点：seat 名单硬约束（名单外不输出，防编造）；predicate 七枚举；
 * 复合句拆分示例内嵌（一条输入 → 0..n claims）；raw_text 禁改写。
 * ------------------------------------------------------------------ */
const EXTRACT_SYSTEM_PROMPT = [
  '你是「推演沙盘」的记录员（extractor）。任务：把用户速记的一句自然语言，抽取为结构化 JSON。',
  '只输出一个 JSON 对象：不要 markdown 代码块，不要解释文字。',
  '【铁律】',
  '1. subject_seat 必须是「在册座位名单」中的号码；名单外的座位一律不输出该条 claim（不得编造）。',
  '2. predicate 只能取这七个枚举之一：is_wolf, is_good, is_role, claims_role, voted, did_action, said。',
  '3. event.type 只能取：statement, vote, death, claim, action_reveal, system；event.phase 只能取：night, day, dusk。',
  '4. action 只能取：vote, abstain, kill_target, poison_target, protect_target, check_target, self_explode；本条输入没有行动时 action=null。其中 vote/kill_target/poison_target/protect_target/check_target 需要合法 target_seat，abstain/self_explode 的 target_seat 为 null。',
  '5. event.raw_text 必须原样保留用户原话，禁止改写、翻译、摘要。',
  '6. 一条输入可产出 1 个 event + 0..n 条 claims + 0..1 个 action：复合句要拆干净（例：「3号跳预言家查杀5号」= claims_role(预言家) + is_wolf(查杀) 两条），但不得脑补原话里没有的信息。',
  '【输出 JSON 格式】',
  '{"event":{"day":整数,"phase":"night|day|dusk","type":"...","raw_text":"用户原话"},"claims":[{"subject_seat":整数,"predicate":"...","object":"角色名/动作名/自由命题"}],"action":{"action":"...","target_seat":整数或null,"result":"简述"}或null}'
].join('\n');

/* ------------------------------------------------------------------
 * Prompt ②：天结算参谋卡（generateCards 用）
 * 设计要点（RD1 落实核心）：
 *   a) 角色定位写死在 system 开头：「思路参谋，不是判官」——只产思路发生器三件套
 *      （矛盾点/竞争假设/验证点），永不替玩家定罪，结论留给用户（design.md §14.1 拍板）。
 *   b) RD1 无辜解释层：每个矛盾对必须 ≥1 条 innocent_explanations，并给出五个候选角度
 *      （药剂/状态/信息差/记忆/战术）；给不出就整对删除——「空=校验失败、不得展示」。
 *      这是把 §9.3「毒/醉合法谎言被当硬冲突冤枉好人」的实证教训反推进 prompt。
 *   c) per-player stance：每套假设对每个在册座位给出四值枚举立场 + 可选 suspect_ranking，
 *      并写明机械自洽规则（good_believe 不得进 Top 区）供本层代码强校验（PD1）。
 *   d) 验证点只写「分辨 A/B 需要看什么」，resolves 用假设下标，禁下结论。
 * ------------------------------------------------------------------ */
const CARDS_SYSTEM_PROMPT = [
  '你是「推演沙盘」的天结算参谋。你的定位是【思路参谋，不是判官】：你产出的是供真人复盘用的思路发生器——矛盾点、竞争假设、验证方向三件套；你永远不下「谁是狼」的最终结论，不替任何玩家定罪，结论留给用户自己下。',
  '【RD1 无辜解释层——最高优先级约束】',
  '代码比对器给出的矛盾对只是「字面冲突」，不区分有意撒谎还是无害原因。你必须为每一个矛盾对给出至少 1 条 innocent_explanations（无辜解释），否则该矛盾对视为校验失败、不得出现在输出里。无辜解释候选角度（至少覆盖其一）：',
  '1) 药剂类：女巫毒错人/救错人、守卫守错人——毒与守的合法谎言；',
  '2) 状态类：醉酒、中毒状态下拿到错误信息（如血染钟楼机制）；',
  '3) 信息差：夜晚视角不同、没听到关键发言、信息传递延迟；',
  '4) 记忆类：记错号码、记错夜晚、口误；',
  '5) 战术类：好人主动说谎（悍跳、挡刀、藏身份）、狼人的战术假信息。',
  '宁可整对删除，也绝不输出空 innocent_explanations。',
  '【竞争假设】',
  '1) 生成至少 2 套互相竞争的假设，不追求唯一真相；',
  '2) 每套假设必须带 per-player stance：对在册名单里每个座位给出立场枚举：wolf_suspect / good_believe / neutral / unknown，一个座位都不能漏；',
  '3) stance 对象可附保留键 suspect_ranking（数组，嫌疑从高到低的座位号）。机械自洽规则：被你标为 good_believe 的座位不得进入 suspect_ranking 的前三名（Top 区），违反即废案；',
  '4) support_events / oppose_events 只能引用输入事件中真实存在的 event id。',
  '【验证点】',
  '每个 checkpoint 写「分辨 A/B 假设需要看什么」，resolves 数组填写它所帮助分辨的假设下标（从 0 起），必须指向真实存在的假设下标。',
  '【输出 JSON 格式】',
  '{"contradictions":[{"pair_id":"沿用输入矛盾对的 id","underdetermination":"high|mid|low","innocent_explanations":["至少一条"]}],"hypotheses":[{"content":"假设内容","stance":{"1":"wolf_suspect","2":"good_believe"},"support_events":[事件id],"oppose_events":[事件id],"tendency":"strong|mid|weak"}],"checkpoints":[{"text":"分辨A/B需要看什么","resolves":[0]}]}'
].join('\n');

// MOCK_MODE 无辜解释池：五类角度轮转，保证每个真实矛盾对都有 ≥1 条（RD1）
const INNOCENT_POOL = [
  '女巫可能毒错人/救错人——毒与守是合法谎言（药剂类）',
  '醉酒或中毒状态下拿到错误信息（状态类）',
  '信息差：夜晚视角不同或没听到关键发言（信息差类）',
  '记错号码、记错夜晚或口误（记忆类）',
  '好人主动说谎（悍跳/挡刀/藏身份）或狼人战术假信息（战术类）'
];

/* ------------------------------------------------------------------
 * 通用：模式解析 / JSON 强解析 / DeepSeek 传输 / 重试环
 * ------------------------------------------------------------------ */
function resolveMode(options) {
  options = options || {};
  if (options.mockMode === true) return 'MOCK';
  if (options.mockMode === false) return 'LIVE';
  const key = options.apiKey || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  return key ? 'LIVE' : 'MOCK';
}

function toInt(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

// 剥掉可能的 markdown 代码围栏与前后噪音，取最外层 {...}；解析失败抛错（供重试环收集）
function parseJsonLoose(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('LLM 响应为空');
  let s = raw.trim();
  s = s.replace(/^\x60\x60\x60[a-zA-Z]*\s*/, '').replace(/\x60\x60\x60\s*$/, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) throw new Error('未找到 JSON 对象边界（{...}）');
  s = s.slice(a, b + 1);
  let obj;
  try { obj = JSON.parse(s); } catch (e) { throw new Error('JSON.parse 失败: ' + e.message); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('顶层不是 JSON 对象');
  return obj;
}

// LIVE_MODE 传输：DeepSeek chat/completions（options.fetchImpl 可注入，测试零真实网络）
async function chatCompletion(messages, options) {
  const apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) throw new Error('LIVE_MODE 需要 LLM_API_KEY（或 DEEPSEEK_API_KEY）环境变量（契约§5：env-only，禁止写入任何文件）');
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = baseUrl + '/chat/completions';
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new Error('当前环境无可用 fetch 实现');
  const body = {
    model: options.model || DEFAULT_MODEL,
    messages: messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
    response_format: { type: 'json_object' },
    stream: false
  };
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  });
  if (!res || typeof res.ok !== 'boolean') throw new Error('DeepSeek 响应异常（注入 fetchImpl 须返回 {ok,status,json()}）');
  if (!res.ok) throw new Error('DeepSeek API HTTP ' + res.status);
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek 响应缺少 choices[0].message.content');
  return content;
}

// MOCK_MODE 响应：确定性固定输出。_mockCorrupt 注入损坏 JSON 以驱动重试链路。
function mockRespond(kind, state) {
  state.attempt += 1;
  const corrupt = state.corruptAlways || (state.corruptFirst && state.attempt === 1);
  if (corrupt) return '{"event":{"day":';
  return kind === 'extract'
    ? JSON.stringify(buildMockExtract(state.payload))
    : JSON.stringify(buildMockCards(state.payload));
}

// 统一调用环：结构校验失败/解析失败 → 附错误原文重试，≤2 次（契约§3）
async function callLlmJson(kind, messages, payload, options, validateFn, label) {
  const mode = resolveMode(options);
  const state = {
    attempt: 0,
    payload: payload,
    corruptFirst: payload._mockCorrupt === 'first',
    corruptAlways: payload._mockCorrupt === 'always'
  };
  const errors = [];
  let lastRaw = '';
  for (let attempt = 1; attempt <= MAX_JSON_RETRIES + 1; attempt++) {
    let msgs = messages;
    if (attempt > 1) {
      msgs = messages.concat([
        { role: 'assistant', content: lastRaw },
        { role: 'user', content: '你上一次的输出未通过 JSON 强校验，错误如下：\n- ' + errors.join('\n- ') + '\n请重新输出：只输出一个合法 JSON 对象（无 markdown、无解释），修正以上全部问题。' }
      ]);
    }
    let raw;
    try {
      raw = mode === 'MOCK' ? mockRespond(kind, state) : await chatCompletion(msgs, options);
    } catch (e) {
      errors.push('attempt ' + attempt + ' 传输失败: ' + e.message);
      lastRaw = '';
      continue;
    }
    lastRaw = raw;
    try {
      const parsed = parseJsonLoose(raw);
      const data = validateFn(parsed);
      return { data: data, meta: { mode: mode, attempts: attempt } };
    } catch (e) {
      errors.push('attempt ' + attempt + ' 校验失败: ' + e.message);
    }
  }
  throw new Error(label + '：JSON 强解析在 ' + MAX_JSON_RETRIES + ' 次重试后仍失败。\n' + errors.join('\n'));
}

/* ------------------------------------------------------------------
 * 抽取：上下文归一化 + 用户 payload + MOCK 构造器
 * ------------------------------------------------------------------ */
// context 形状（对 B 路宽容）：{seats:[1,2..]或[{seat,name}], day/currentDay, phase/currentPhase,
//   speakerSeat, priorClaims:[字符串或{seat,text}], _mockCorrupt:'first'|'always'（仅测试）}
function normalizeContext(rawText, context) {
  const c = context || {};
  let rawSeats = null;
  if (c.seats !== undefined) rawSeats = c.seats;
  else if (c.playerSeats !== undefined) rawSeats = c.playerSeats;
  else if (Array.isArray(c.players)) rawSeats = c.players;
  let seats = Array.isArray(rawSeats)
    ? rawSeats.map(function (x) { return (x !== null && typeof x === 'object') ? x.seat : x; })
    : [];
  seats = seats.map(Number).filter(function (n) { return Number.isInteger(n) && n > 0; });
  const seatSet = new Set(seats);
  let day = c.day !== undefined ? c.day : c.currentDay;
  if (!Number.isInteger(day)) {
    const m = /第\s*(\d+)\s*天/.exec(String(rawText || ''));
    day = m ? parseInt(m[1], 10) : 1;
  }
  let phase = c.phase !== undefined ? c.phase : c.currentPhase;
  if (PHASES.indexOf(phase) === -1) {
    const t = String(rawText || '');
    phase = /黄昏|傍晚/.test(t) ? 'dusk' : (/夜|晚/.test(t) ? 'night' : 'day');
  }
  return {
    rawText: String(rawText === undefined || rawText === null ? '' : rawText),
    seats: seats,
    seatSet: seatSet,
    day: day,
    phase: phase,
    speakerSeat: c.speakerSeat !== undefined ? c.speakerSeat : (c.actorSeat !== undefined ? c.actorSeat : null),
    priorClaims: Array.isArray(c.priorClaims) ? c.priorClaims : [],
    _mockCorrupt: c._mockCorrupt
  };
}

function buildExtractUserPayload(ctx) {
  const priorText = ctx.priorClaims.length
    ? ctx.priorClaims.map(function (c) {
        if (typeof c === 'string') return c;
        return (c.seat !== undefined && c.seat !== null ? c.seat + '号' : '?') + ': ' + (c.text || c.object || '');
      }).join('；')
    : '（无）';
  return '【在册座位名单】' + (ctx.seats.join(',') || '（空）') +
    '\n【当前时间】第' + ctx.day + '天 ' + ctx.phase +
    '\n【该玩家此前声称摘要】' + priorText +
    '\n【用户原话（待抽取）】' + ctx.rawText +
    '\n请按系统提示只输出一个 JSON 对象。';
}

// MOCK 抽取：按座位分段匹配关键词，产出确定性结果。
// 若原话含名单外座位号，mock 会照常产出该条（模拟真实 LLM 幻觉），由后校验统一丢弃+警告。
function buildMockExtract(p) {
  const t = String(p.rawText || '');
  const matches = [];
  const re = /(\d{1,2})\s*号/g;
  let m;
  while ((m = re.exec(t)) !== null) matches.push({ seat: parseInt(m[1], 10), start: m.index });
  const claims = [];
  for (let i = 0; i < matches.length; i++) {
    const seat = matches[i].seat;
    const seg = t.slice(matches[i].start, i + 1 < matches.length ? matches[i + 1].start : t.length);
    let predicate = 'said';
    let object = seat + '号的发言';
    if (/查杀/.test(seg)) { predicate = 'is_wolf'; object = '查杀'; }
    else if (/金水|好人/.test(seg)) { predicate = 'is_good'; object = '好人'; }
    else if (/预言家/.test(seg)) { predicate = 'claims_role'; object = '预言家'; }
    else if (/女巫/.test(seg)) { predicate = 'claims_role'; object = '女巫'; }
    else if (/猎人/.test(seg)) { predicate = 'claims_role'; object = '猎人'; }
    else if (/守卫/.test(seg)) { predicate = 'claims_role'; object = '守卫'; }
    claims.push({ subject_seat: seat, predicate: predicate, object: object });
  }
  if (claims.length === 0 && p.speakerSeat !== undefined && p.speakerSeat !== null && /我/.test(t)) {
    const roleMatch = t.match(/预言家|女巫|猎人|守卫/);
    claims.push({
      subject_seat: p.speakerSeat,
      predicate: roleMatch ? 'claims_role' : 'said',
      object: roleMatch ? roleMatch[0] : '发言'
    });
  }
  let action = null;
  let am = t.match(/(?:投(?:票|给)?|把)\s*(\d{1,2})\s*号/);
  if (am && /投|票/.test(t)) action = { action: 'vote', target_seat: parseInt(am[1], 10), result: '' };
  else if (/弃票/.test(t)) action = { action: 'abstain', target_seat: null, result: '' };
  else if (/自爆/.test(t)) action = { action: 'self_explode', target_seat: null, result: '' };
  else if ((am = t.match(/毒(?:了)?\s*(\d{1,2})\s*号/))) action = { action: 'poison_target', target_seat: parseInt(am[1], 10), result: '' };
  else if ((am = t.match(/守(?:了)?\s*(\d{1,2})\s*号/))) action = { action: 'protect_target', target_seat: parseInt(am[1], 10), result: '' };
  let type = 'statement';
  if (/法官|天亮|天黑|宣布/.test(t)) type = 'system';
  else if (/出局|死亡|倒牌|毒死|刀死/.test(t)) type = 'death';
  else if (/投票|放逐|投出局/.test(t)) type = 'vote';
  else if (/认毒|认守|自爆|认下/.test(t)) type = 'action_reveal';
  else if (/跳|查杀|金水|好人|预言家|女巫|猎人|声称|报/.test(t)) type = 'claim';
  return { event: { day: p.day, phase: p.phase, type: type, raw_text: p.rawText }, claims: claims, action: action };
}

/* ------------------------------------------------------------------
 * 抽取：结构校验（不过 → 重试）与后校验（逐条丢弃 + warnings）
 * 分层原则：枚举/形状违规可重试修复 → 结构层；seat 是否在册是确定性事实 → 后校验丢弃留痕。
 * ------------------------------------------------------------------ */
function validateExtractShape(obj) {
  const ev = obj.event;
  if (!ev || typeof ev !== 'object') throw new Error('缺少 event 对象');
  if (!Number.isInteger(ev.day) || ev.day < 1) throw new Error('event.day 必须是 ≥1 的整数');
  if (PHASES.indexOf(ev.phase) === -1) throw new Error('event.phase 必须是 night|day|dusk');
  if (EVENT_TYPES.indexOf(ev.type) === -1) throw new Error('event.type 必须是 ' + EVENT_TYPES.join('|'));
  if (typeof ev.raw_text !== 'string' || !ev.raw_text.trim()) throw new Error('event.raw_text 必须是非空字符串');
  if (!Array.isArray(obj.claims)) throw new Error('claims 必须是数组');
  for (let i = 0; i < obj.claims.length; i++) {
    const c = obj.claims[i];
    if (!c || typeof c !== 'object') throw new Error('claims[' + i + '] 不是对象');
    if (!Number.isInteger(c.subject_seat)) throw new Error('claims[' + i + '].subject_seat 必须是整数');
    if (PREDICATES.indexOf(c.predicate) === -1) throw new Error('claims[' + i + '].predicate 必须是 ' + PREDICATES.join('|'));
    if (typeof c.object !== 'string' || !c.object.trim()) throw new Error('claims[' + i + '].object 必须是非空字符串');
  }
  if (obj.action !== null && obj.action !== undefined) {
    const a = obj.action;
    if (typeof a !== 'object' || Array.isArray(a)) throw new Error('action 必须是对象或 null');
    if (ACTIONS.indexOf(a.action) === -1) throw new Error('action.action 必须是 ' + ACTIONS.join('|'));
  }
  return obj;
}

function postValidateExtract(obj, ctx) {
  const warnings = [];
  const ev = obj.event;
  let day = toInt(ev.day);
  if (day === null || day < 1) { warnings.push('event.day 非法（' + ev.day + '），回退为 ' + ctx.day); day = ctx.day; }
  let phase = ev.phase;
  if (PHASES.indexOf(phase) === -1) { warnings.push('event.phase 非法（' + phase + '），回退为 ' + ctx.phase); phase = ctx.phase; }
  let type = ev.type;
  if (EVENT_TYPES.indexOf(type) === -1) { warnings.push('event.type 非法（' + type + '），回退为 statement'); type = 'statement'; }
  const event = { day: day, phase: phase, type: type, raw_text: ctx.rawText };
  if (ev.raw_text !== ctx.rawText) warnings.push('event.raw_text 与用户原话不一致，已按原话回写（契约§1：用户原话不可改写）');
  const claims = [];
  for (let i = 0; i < (obj.claims || []).length; i++) {
    const c = obj.claims[i];
    const seat = toInt(c.subject_seat);
    if (seat === null || !ctx.seatSet.has(seat)) {
      warnings.push('丢弃 claim[' + i + ']：subject_seat=' + c.subject_seat + ' 不在在册座位名单');
      continue;
    }
    if (PREDICATES.indexOf(c.predicate) === -1) { warnings.push('丢弃 claim[' + i + ']：predicate 非枚举（' + c.predicate + '）'); continue; }
    const object = String(c.object).trim();
    if (!object) { warnings.push('丢弃 claim[' + i + ']：object 为空'); continue; }
    claims.push({ subject_seat: seat, predicate: c.predicate, object: object });
  }
  let action = null;
  if (obj.action && typeof obj.action === 'object') {
    const a = obj.action;
    if (ACTIONS.indexOf(a.action) === -1) {
      warnings.push('丢弃 action：action 非枚举（' + a.action + '）');
    } else {
      const t = (a.target_seat === null || a.target_seat === undefined) ? null : toInt(a.target_seat);
      if (ACTIONS_NEED_TARGET.indexOf(a.action) !== -1 && (t === null || !ctx.seatSet.has(t))) {
        warnings.push('丢弃 action：' + a.action + ' 缺少在册 target_seat');
      } else {
        action = { action: a.action, target_seat: t, result: typeof a.result === 'string' ? a.result : '' };
      }
    }
  }
  return { event: event, claims: claims, action: action, warnings: warnings };
}

/* ------------------------------------------------------------------
 * extractEvent(rawText, context, options) — 契约 §3 抽取主入口
 * 返回 {event:{day,phase,type,raw_text}, claims:[{subject_seat,predicate,object}],
 *       action|null, warnings, meta:{mode,attempts}}
 * ------------------------------------------------------------------ */
async function extractEvent(rawText, context, options) {
  options = options || {};
  const ctx = normalizeContext(rawText, context);
  const messages = [
    { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
    { role: 'user', content: buildExtractUserPayload(ctx) }
  ];
  const payload = {
    rawText: ctx.rawText,
    seats: ctx.seats,
    seatSet: ctx.seatSet,
    day: ctx.day,
    phase: ctx.phase,
    speakerSeat: ctx.speakerSeat,
    _mockCorrupt: ctx._mockCorrupt
  };
  const r = await callLlmJson('extract', messages, payload, options, validateExtractShape, 'extractEvent');
  const result = postValidateExtract(r.data, ctx);
  result.meta = r.meta;
  return result;
}

/* ------------------------------------------------------------------
 * 参谋卡：dayData 归一化 + 结构校验
 * dayData 形状（对 A/B 路宽容）：{day, seats, events:[{id,...}], claims:[{id,...}],
 *   actions:[{id,...}], pairs|conflicts|contradictions:[{pair_id, claim_a, claim_b,
 *   action_a, action_b, conflict_desc}], _mockCorrupt}
 * ------------------------------------------------------------------ */
function normalizeDayData(dayData) {
  const d = dayData || {};
  const seats = (Array.isArray(d.seats) ? d.seats : []).map(Number)
    .filter(function (n) { return Number.isInteger(n) && n > 0; });
  const seatSet = new Set(seats);
  const events = (Array.isArray(d.events) ? d.events : []).map(function (e, i) {
    e = e || {};
    return {
      id: e.id !== undefined ? e.id : (e.seq !== undefined ? e.seq : i + 1),
      day: e.day, phase: e.phase, type: e.type, actor_seat: e.actor_seat, raw_text: e.raw_text
    };
  });
  const eventIds = new Set(events.map(function (e) { return e.id; }));
  const claims = (Array.isArray(d.claims) ? d.claims : []).map(function (c, i) {
    c = c || {};
    return { id: c.id !== undefined ? c.id : i + 1, seat: c.seat, subject_seat: c.subject_seat, predicate: c.predicate, object: c.object };
  });
  const claimIds = new Set(claims.map(function (c) { return c.id; }));
  const actions = (Array.isArray(d.actions) ? d.actions : []).map(function (a, i) {
    a = a || {};
    return { id: a.id !== undefined ? a.id : i + 1, seat: a.seat, action: a.action, target_seat: a.target_seat, result: a.result };
  });
  const actionIds = new Set(actions.map(function (a) { return a.id; }));
  let pairs = d.pairs !== undefined ? d.pairs : (d.conflicts !== undefined ? d.conflicts : (d.contradictions !== undefined ? d.contradictions : []));
  if (!Array.isArray(pairs)) pairs = [];
  pairs = pairs.map(function (p, i) {
    p = p || {};
    return {
      pair_id: String(p.pair_id !== undefined ? p.pair_id : (p.id !== undefined ? p.id : 'pair_' + (i + 1))),
      claim_a: p.claim_a !== undefined ? p.claim_a : null,
      claim_b: p.claim_b !== undefined ? p.claim_b : null,
      action_a: p.action_a !== undefined ? p.action_a : null,
      action_b: p.action_b !== undefined ? p.action_b : null,
      conflict_desc: p.conflict_desc || ''
    };
  });
  return {
    seats: seats, seatSet: seatSet,
    events: events, eventIds: eventIds,
    claims: claims, claimIds: claimIds,
    actions: actions, actionIds: actionIds,
    pairs: pairs,
    day: d.day !== undefined ? d.day : ((events[0] && events[0].day) || 1),
    _mockCorrupt: d._mockCorrupt
  };
}

function validateCardsShape(obj) {
  if (!Array.isArray(obj.contradictions)) throw new Error('contradictions 必须是数组');
  for (let i = 0; i < obj.contradictions.length; i++) {
    const c = obj.contradictions[i];
    if (!c || typeof c !== 'object') throw new Error('contradictions[' + i + '] 不是对象');
    if (typeof c.pair_id !== 'string' || !c.pair_id) throw new Error('contradictions[' + i + '].pair_id 必须是非空字符串');
    if (UNDERDETERMINATION_LEVELS.indexOf(c.underdetermination) === -1) throw new Error('contradictions[' + i + '].underdetermination 必须是 high|mid|low');
    if (!Array.isArray(c.innocent_explanations)) throw new Error('contradictions[' + i + '].innocent_explanations 必须是数组（空数组交由展示层过滤删除）');
    for (let j = 0; j < c.innocent_explanations.length; j++) {
      if (typeof c.innocent_explanations[j] !== 'string') throw new Error('innocent_explanations[' + j + '] 必须是字符串');
    }
  }
  if (!Array.isArray(obj.hypotheses)) throw new Error('hypotheses 必须是数组');
  if (obj.hypotheses.length < 1) throw new Error('hypotheses 至少 1 套（prompt 要求 ≥2 套竞争假设）');
  for (let i = 0; i < obj.hypotheses.length; i++) {
    const h = obj.hypotheses[i];
    if (!h || typeof h !== 'object') throw new Error('hypotheses[' + i + '] 不是对象');
    if (typeof h.content !== 'string' || !h.content.trim()) throw new Error('hypotheses[' + i + '].content 必须是非空字符串');
    if (!h.stance || typeof h.stance !== 'object' || Array.isArray(h.stance)) throw new Error('hypotheses[' + i + '].stance 必须是 per-player 对象');
    if (!Array.isArray(h.support_events) || !Array.isArray(h.oppose_events)) throw new Error('hypotheses[' + i + '] 的 support_events/oppose_events 必须是数组');
    if (TENDENCY_LEVELS.indexOf(h.tendency) === -1) throw new Error('hypotheses[' + i + '].tendency 必须是 strong|mid|weak');
  }
  if (!Array.isArray(obj.checkpoints)) throw new Error('checkpoints 必须是数组');
  for (let i = 0; i < obj.checkpoints.length; i++) {
    const cp = obj.checkpoints[i];
    if (!cp || typeof cp !== 'object') throw new Error('checkpoints[' + i + '] 不是对象');
    if (typeof cp.text !== 'string' || !cp.text.trim()) throw new Error('checkpoints[' + i + '].text 必须是非空字符串');
    if (!Array.isArray(cp.resolves)) throw new Error('checkpoints[' + i + '].resolves 必须是数组');
  }
  return obj;
}

/* ------------------------------------------------------------------
 * MOCK 参谋卡构造器：确定性输出，内置 4 个负例（全部由后校验过滤，供测试断言）：
 *   ① 空无辜解释矛盾对（RD1 过滤） ② 悬空 pair_id GHOST-404（LY昼2 脱节过滤）
 *   ③ good_believe 进嫌疑 Top 区假设（自洽废案） ④ stance 缺座位假设（完整性废案）
 * ------------------------------------------------------------------ */
function buildMockCards(p) {
  const seats = p.seats;
  const contradictions = [];
  for (let i = 0; i < p.pairs.length; i++) {
    contradictions.push({
      pair_id: p.pairs[i].pair_id,
      underdetermination: i % 2 === 0 ? 'high' : 'mid',
      innocent_explanations: [INNOCENT_POOL[i % INNOCENT_POOL.length], INNOCENT_POOL[(i + 2) % INNOCENT_POOL.length]]
    });
  }
  if (p.pairs.length > 0) {
    contradictions.push({ pair_id: p.pairs[0].pair_id, underdetermination: 'low', innocent_explanations: [] });
  }
  contradictions.push({ pair_id: 'GHOST-404', underdetermination: 'low', innocent_explanations: ['悬空引用负例'] });
  const evIds = p.eventIds;
  const sup = evIds.slice(0, 1);
  const opp = evIds.slice(1, 2);
  const suspects = seats.slice(0, Math.max(1, Math.min(2, seats.length)));
  const others = seats.filter(function (s) { return suspects.indexOf(s) === -1; });
  function mkStance(sus, ranking) {
    const s = {};
    for (let i = 0; i < seats.length; i++) {
      s[String(seats[i])] = sus.indexOf(seats[i]) !== -1 ? 'wolf_suspect' : 'good_believe';
    }
    if (ranking) s.suspect_ranking = ranking;
    return s;
  }
  const hypotheses = [
    { content: '假设A：' + suspects.join('、') + ' 号悍跳狼的常规局，真预言家在其余座位中',
      stance: mkStance(suspects, suspects.slice()), support_events: sup, oppose_events: opp, tendency: 'mid' },
    { content: '假设B：无人悍跳，矛盾源于信息差与记错的误判局',
      stance: mkStance([], null), support_events: sup, oppose_events: [], tendency: 'weak' }
  ];
  if (others.length > 0) {
    hypotheses.push({ content: '假设C（自洽负例：好人进嫌疑Top区）',
      stance: mkStance([suspects[0]], [others[0]].concat(suspects)),
      support_events: sup, oppose_events: [], tendency: 'mid' });
  }
  const sD = mkStance([], null);
  delete sD[String(seats[seats.length - 1])];
  hypotheses.push({ content: '假设D（负例：stance 不完整）',
    stance: sD, support_events: [], oppose_events: [], tendency: 'weak' });
  const checkpoints = [
    { text: '明天白天盯 ' + suspects.join('、') + ' 号是否继续补身份，判断悍跳链', resolves: [0] },
    { text: '核对夜里刀口与用药时序，验证信息差是否成立', resolves: [1] },
    { text: '（废案 checkpoint，指向被废假设C）', resolves: [2] }
  ];
  return { contradictions: contradictions, hypotheses: hypotheses, checkpoints: checkpoints };
}

// stance 清洗：per-player 完整性（缺座位=废案）+ 四值枚举（非法值按 unknown 降级）+ 保留 suspect_ranking
function sanitizeStance(rawStance, norm, label, warnings) {
  const stance = {};
  for (let k = 0; k < norm.seats.length; k++) {
    const seat = norm.seats[k];
    const v = rawStance[String(seat)] !== undefined ? rawStance[String(seat)] : rawStance[seat];
    if (v === undefined) {
      warnings.push('废案 ' + label + '：stance 缺少 ' + seat + ' 号（per-player 立场必须完整，PD1）');
      return null;
    }
    if (STANCE_VALUES.indexOf(v) === -1) {
      warnings.push(label + '.stance[' + seat + '] 非枚举值（' + v + '），按 unknown 处理');
      stance[String(seat)] = 'unknown';
    } else {
      stance[String(seat)] = v;
    }
  }
  if (Array.isArray(rawStance.suspect_ranking)) {
    stance.suspect_ranking = rawStance.suspect_ranking.map(Number)
      .filter(function (n) { return Number.isInteger(n); });
  }
  return stance;
}

// event id 白名单过滤：悬空 id 剔除并留痕（不整案废除）
function filterEventIds(arr, idSet, label, warnings) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const id = toInt(arr[i]);
    if (id === null || !idSet.has(id)) {
      warnings.push(label + ' 剔除无效 event id：' + arr[i]);
      continue;
    }
    out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------
 * 参谋卡后校验：RD1 空无辜解释过滤 / 悬空 pair_id 过滤 / 自洽校验 /
 * 假设过滤后 checkpoint.resolves 下标重映射
 * ------------------------------------------------------------------ */
function postValidateCards(obj, norm) {
  const warnings = [];
  const validPairs = new Map();
  for (let i = 0; i < norm.pairs.length; i++) {
    const p = norm.pairs[i];
    const claimRefsOk = [p.claim_a, p.claim_b].every(function (id) { return id === null || norm.claimIds.has(id); });
    const actionRefsOk = [p.action_a, p.action_b].every(function (id) { return id === null || norm.actionIds.has(id); });
    if (claimRefsOk && actionRefsOk) validPairs.set(p.pair_id, p);
    else warnings.push('矛盾对 ' + p.pair_id + ' 引用的 claim/action id 不在库中，整对剔除（LY昼2 脱节回归）');
  }
  const contradictions = [];
  const seen = new Set();
  for (let i = 0; i < obj.contradictions.length; i++) {
    const c = obj.contradictions[i];
    const pair = validPairs.get(c.pair_id);
    if (!pair) { warnings.push('删除矛盾对 ' + c.pair_id + '：pair_id 不存在于代码比对器输出（自洽校验，LY昼2 脱节）'); continue; }
    const ie = c.innocent_explanations.filter(function (x) { return typeof x === 'string' && x.trim(); });
    if (ie.length < 1) { warnings.push('删除矛盾对 ' + c.pair_id + '：innocent_explanations 为空（RD1 非空强校验，该对不得展示）'); continue; }
    if (seen.has(c.pair_id)) { warnings.push('去重：矛盾对 ' + c.pair_id + ' 重复输出，保留首条'); continue; }
    seen.add(c.pair_id);
    contradictions.push({ pair_id: c.pair_id, underdetermination: c.underdetermination, innocent_explanations: ie });
  }
  const kept = [];
  const indexMap = new Map();
  for (let i = 0; i < obj.hypotheses.length; i++) {
    const h = obj.hypotheses[i];
    const label = 'hypotheses[' + i + ']';
    const stance = sanitizeStance(h.stance, norm, label, warnings);
    if (!stance) continue;
    if (norm.seats.length > 0) {
      const ranking = Array.isArray(stance.suspect_ranking) ? stance.suspect_ranking : [];
      const top = ranking.slice(0, SELF_CONSISTENCY_TOP_N);
      const clash = [];
      for (const k of Object.keys(stance)) {
        if (k === 'suspect_ranking') continue;
        if (stance[k] === 'good_believe' && top.indexOf(Number(k)) !== -1) clash.push(k);
      }
      if (clash.length) {
        warnings.push('废案 ' + label + '：good_believe 座位 [' + clash.join(',') + '] 出现在嫌疑排序 Top 区（自洽校验，LY昼2 修复）');
        continue;
      }
    }
    const support = filterEventIds(h.support_events, norm.eventIds, label + '.support_events', warnings);
    const oppose = filterEventIds(h.oppose_events, norm.eventIds, label + '.oppose_events', warnings);
    indexMap.set(i, kept.length);
    kept.push({ content: h.content.trim(), stance: stance, support_events: support, oppose_events: oppose, tendency: h.tendency });
  }
  const checkpoints = [];
  for (let i = 0; i < obj.checkpoints.length; i++) {
    const cp = obj.checkpoints[i];
    const resolves = [];
    let dead = false;
    for (let j = 0; j < cp.resolves.length; j++) {
      const idx = toInt(cp.resolves[j]);
      if (idx === null || !indexMap.has(idx)) { dead = true; break; }
      resolves.push(indexMap.get(idx));
    }
    if (dead || resolves.length === 0) {
      warnings.push('删除 checkpoint[' + i + ']「' + cp.text.slice(0, 12) + '」：resolves 指向不存在或已被废案的假设下标');
      continue;
    }
    checkpoints.push({ text: cp.text.trim(), resolves: resolves });
  }
  return { contradictions: contradictions, hypotheses: kept, checkpoints: checkpoints, warnings: warnings };
}

function buildCardsUserPayload(norm) {
  function slim(arr, keys) {
    return arr.map(function (x) {
      const o = {};
      for (const k of keys) { if (x[k] !== undefined) o[k] = x[k]; }
      return o;
    });
  }
  return '【第' + norm.day + '天结算 | 在册座位】' + (norm.seats.join(',') || '（未提供）') +
    '\n【当日事件 events】' + JSON.stringify(slim(norm.events, ['id', 'day', 'phase', 'type', 'actor_seat', 'raw_text'])) +
    '\n【全量 claims】' + JSON.stringify(slim(norm.claims, ['id', 'seat', 'subject_seat', 'predicate', 'object'])) +
    '\n【全量 actions】' + JSON.stringify(slim(norm.actions, ['id', 'seat', 'action', 'target_seat', 'result'])) +
    '\n【既有矛盾对（代码比对器输出，只含字面冲突；pair_id 必须原样沿用）】' + JSON.stringify(norm.pairs) +
    '\n请按系统提示输出参谋卡 JSON：每个矛盾对必须带至少 1 条无辜解释，假设带完整 per-player stance，只出思路不下结论。';
}

/* ------------------------------------------------------------------
 * generateCards(dayData, options) — 契约 §3 参谋卡主入口
 * 返回 {contradictions, hypotheses, checkpoints, warnings, meta:{mode,attempts}}
 * ------------------------------------------------------------------ */
async function generateCards(dayData, options) {
  options = options || {};
  const norm = normalizeDayData(dayData);
  const messages = [
    { role: 'system', content: CARDS_SYSTEM_PROMPT },
    { role: 'user', content: buildCardsUserPayload(norm) }
  ];
  const payload = {
    seats: norm.seats,
    seatSet: norm.seatSet,
    pairs: norm.pairs,
    eventIds: Array.from(norm.eventIds),
    day: norm.day,
    _mockCorrupt: norm._mockCorrupt
  };
  const r = await callLlmJson('cards', messages, payload, options, validateCardsShape, 'generateCards');
  const result = postValidateCards(r.data, norm);
  result.meta = r.meta;
  return result;
}

/* ------------------------------------------------------------------
 * B 路适配导出（cli.js 头注释「接口期望」B→C 双命名兼容，e2e 集成胶水）：
 *   extract({text,players,day?,phase?,speakerSeat?,priorClaims?,options?})
 *     → extractEvent(text, {seats,...})。契约 §3 抽取输出无 actor_seat，而 B 路
 *       cli 确认流以 event.actor_seat 归属声称（无行为人则全部声称丢弃）——此处推导：
 *       首个声称的 subject_seat 即该条记录的主语（如「1号…查杀8号」→ 1号），
 *       用户可在后续席位键控确认中修正。
 *   advisor({game,players,day,events,claims,actions})
 *     → 先跑 A 路纯代码比对器 engine.findContradictions（契约 §4）得字面冲突对，
 *       再 generateCards；矛盾对回填 claim_a/claim_b/action_a/action_b——
 *       A 路 saveAdvisorCard 要求每条矛盾至少引用一个在库 id（契约 §7.2），
 *       而 generateCards 输出只带 pair_id，缺引用则回存必然失败。
 *   pair_id 采用 'cN'/'aN' 记号连缀（'c6:c7'），与 cli 自洽校验和 A 路存库同规整。
 *   仅做形状桥接，不改 extractEvent/generateCards 本体（llm 单测口径不变）。
 * ------------------------------------------------------------------ */
function seatsOfPlayers(players) {
  return (Array.isArray(players) ? players : [])
    .map(function (p) { return (p !== null && typeof p === 'object') ? p.seat : p; })
    .map(Number)
    .filter(function (n) { return Number.isInteger(n) && n > 0; });
}

function pairRefId(p, i) {
  const parts = [];
  if (p.claim_a !== null && p.claim_a !== undefined) parts.push('c' + p.claim_a);
  if (p.claim_b !== null && p.claim_b !== undefined) parts.push('c' + p.claim_b);
  if (p.action_a !== null && p.action_a !== undefined) parts.push('a' + p.action_a);
  if (p.action_b !== null && p.action_b !== undefined) parts.push('a' + p.action_b);
  return parts.length ? parts.join(':') : 'pair_' + (i + 1);
}

async function extract(input) {
  input = input || {};
  const ctx = {
    seats: seatsOfPlayers(input.players),
    day: input.day,
    phase: input.phase,
    speakerSeat: input.speakerSeat,
    priorClaims: input.priorClaims
  };
  const r = await extractEvent(input.text, ctx, input.options);
  if (r.event.actor_seat === undefined && r.claims.length > 0) {
    r.event.actor_seat = r.claims[0].subject_seat;
  }
  if (r.action && (r.action.seat === undefined || r.action.seat === null) && r.event.actor_seat != null) {
    r.action.seat = r.event.actor_seat; // 行动归属行为人（契约 §3 行动无 seat 字段；确认流可修正）
  }
  return r;
}

async function advisor(input) {
  input = input || {};
  const engine = require('./engine');
  const pairs = engine.findContradictions(input.claims || [], input.actions || [], input.events || [])
    .map(function (p, i) {
      const row = {};
      for (const k in p) row[k] = p[k];
      row.pair_id = pairRefId(p, i);
      return row;
    });
  const card = await generateCards({
    day: input.day,
    seats: seatsOfPlayers(input.players),
    events: input.events || [],
    claims: input.claims || [],
    actions: input.actions || [],
    pairs: pairs
  }, input.options);
  const byId = new Map(pairs.map(function (p) { return [p.pair_id, p]; }));
  card.contradictions = (card.contradictions || []).map(function (c) {
    const src = byId.get(c.pair_id);
    if (!src) return c;
    return Object.assign({}, c, {
      claim_a: src.claim_a, claim_b: src.claim_b,
      action_a: src.action_a, action_b: src.action_b
    });
  });
  return card;
}

module.exports = {
  extractEvent: extractEvent,
  generateCards: generateCards,
  extract: extract,
  advisor: advisor,
  resolveMode: resolveMode,
  EVENT_TYPES: EVENT_TYPES,
  PHASES: PHASES,
  PREDICATES: PREDICATES,
  ACTIONS: ACTIONS,
  UNDERDETERMINATION_LEVELS: UNDERDETERMINATION_LEVELS,
  TENDENCY_LEVELS: TENDENCY_LEVELS,
  STANCE_VALUES: STANCE_VALUES,
  EXTRACT_SYSTEM_PROMPT: EXTRACT_SYSTEM_PROMPT,
  CARDS_SYSTEM_PROMPT: CARDS_SYSTEM_PROMPT,
  _internal: {
    parseJsonLoose: parseJsonLoose,
    normalizeContext: normalizeContext,
    normalizeDayData: normalizeDayData,
    validateExtractShape: validateExtractShape,
    validateCardsShape: validateCardsShape,
    postValidateExtract: postValidateExtract,
    postValidateCards: postValidateCards,
    buildMockExtract: buildMockExtract,
    buildMockCards: buildMockCards
  }
};