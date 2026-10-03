'use strict';
/**
 * p1b/src/botc/extractPrompt.js —— BOTC 局抽取 prompt 上下文注入（B7 棒）。
 *
 * 背景（B5 抽取重测报告 §8 建议获批，拍板=方案 1a「注入 4 专属谓词」）：
 * B5 实测 BOTC 专属谓词产出 0/29——状态声称 6 条全丢、阵营声称靠 is_wolf/is_role 硬塞
 * 且行为不一致（is_role(恶魔) 触发 splitBotcClaims 400 整批拒入）。修复分四层：
 *   L1 请求侧注入（本模块）：system 尾部追加抽取上下文——①本局剧本角色清单（中文名+team）
 *      ②4 专属谓词语义与示例 ③反例两条（阵营词≠角色名禁入 is_role；转述指控归属进 object）；
 *      user payload 插【发言席位】行（修第一人称归属黑洞，B5 实测 4/6 状态样本 0 claims）。
 *   L2 响应侧载体（本模块）：模型按注入输出 is_demon 等专属谓词，但 p1a llm.js
 *      validateExtractShape 只认 7 枚举且 p1a-terminal 禁改 → 包装层在响应侧把 4 专属
 *      谓词声明无损翻译为 said 载体（谓词进 __BOTC[<pred>]<object> 前缀体、原 object 保留），
 *      使其通过 p1a 校验。
 *   L3 出卡还原（routes/events.js extract 调 mapBotcCarriersBack）：载体还原为专属谓词
 *      出确认卡；自然硬塞（is_role/is_wolf + 阵营词精确匹配）按 claims.js BOTC_WORD_MAP
 *      还原；零声称时机械复查（原话含阵营/状态关键词但 0 claims → 警告留痕）。
 *   L4 入账护栏（claims.js splitBotcClaims，B7）：确认入账时词修复 + 不可解析降级 said，
 *      不再 400 拒整批；越剧本仍 400（真实录入错误须人工确认）。
 * 通道：同 B3 advisePrompt.js——包装 options.fetchImpl（llm.js 明示扩展点），werewolf 局
 * 零注入（仅 events/extract 的 botc 分支包装）；MOCK 模式不走 fetch = no-op。
 */
const roles = require('./roles');

/** system 注入标记（幂等：已带标记不重复追加） */
const BOTC_EXTRACT_MARK = '【BOTC 抽取上下文·注入】';
/** user payload 席位行标记（幂等同上） */
const BOTC_SEAT_MARK = '【发言席位】';
/** L2 载体前缀：__BOTC[<predicate>]<object>（仅 extract 内部瞬时态，出卡前由 L3 还原）。
 *  纯 ASCII：B5 复测实证 0x2700 区同形字符经传输层易损（⟦⟧ 同形不同码位导致还原失配）。 */
const BOTC_CARRIER_PREFIX = '__BOTC[';
/** L2/L3 载体可承载的专属谓词白名单 */
const BOTC_CARRIER_PREDICATES = ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned'];

const SCRIPT_NAMES = {
  tb: '暗流涌动（Trouble Brewing）',
  bmr: '血月升起（Bad Moon Rising）',
  snv: '煽动叛乱（Sects & Violets）',
};

/** 角色清单（中文名+team 紧凑分组；抽取只需认名字，能力摘要不进——控 token） */
function buildRoleNameSection(script) {
  const groups = {};
  for (const r of roles.getRolesByEdition(script)) {
    const t = roles.teamZh(r.team);
    (groups[t] = groups[t] || []).push(roles.roleNameZh(r));
  }
  const order = ['镇民', '外来者', '爪牙', '恶魔', '旅行者'];
  return order.filter((t) => groups[t])
    .map((t) => t + '（' + groups[t].length + '）：' + groups[t].join('、'))
    .join('\n');
}

/**
 * 生成本局 BOTC 抽取上下文文本（L1；events/extract 的 botc 分支注入）。
 * @param {string} script tb|bmr|snv（非法剧本 → 空串 = 不注入）
 */
function buildBotcExtractContext(script) {
  if (!roles.SCRIPTS.includes(script)) return '';
  return [
    BOTC_EXTRACT_MARK + '本局是血染钟楼局，剧本：' + (SCRIPT_NAMES[script] || script)
      + '。以下约束优先级高于通用狼人杀直觉。',
    '【本局剧本角色清单】（中文名（团队）——claims_role/is_role 的 object 只能取清单内角色名）',
    buildRoleNameSection(script),
    '【BOTC 专属谓词（本局可用，涉及阵营/状态时优先于通用谓词）】',
    '1. is_demon：声称/指认某人是恶魔。示例：「5号是恶魔」→ {"subject_seat":5,"predicate":"is_demon","object":"5号是恶魔"}',
    '2. is_minion：声称/指认某人是爪牙。示例：「7号看着像爪牙」→ {"subject_seat":7,"predicate":"is_minion","object":"7号看着像爪牙"}',
    '3. status_drunk：声称某人醉酒（含自称）。示例：「我自己都醉了」→ {"subject_seat":发言席位,"predicate":"status_drunk","object":"自称醉酒"}',
    '4. status_poisoned：声称某人中毒（含自称）。示例：「我觉得我被投毒了」→ {"subject_seat":发言席位,"predicate":"status_poisoned","object":"自称被投毒"}',
    '本局没有狼人阵营：不要输出 is_wolf——指认恶魔用 is_demon、指认爪牙用 is_minion。',
    '【反例（禁止）】',
    '1. 「恶魔」「爪牙」是阵营词不是角色名：禁止输出 {"predicate":"is_role","object":"恶魔"} 这类声称——是恶魔用 is_demon、是爪牙用 is_minion。',
    '2. 转述/指控必须保留说话者归属：如「4号反咬1号是红唇女郎」→ object 写「红唇女郎（4号反咬指认）」，不许写成无归属断言。',
  ].join('\n');
}

/** L2：把单条专属谓词 claim 编码为 said 载体（谓词进前缀体，原 object 保留；空 object 也不破形） */
function toCarrier(c) {
  const obj = (c.object === undefined || c.object === null) ? '' : String(c.object).trim();
  return Object.assign({}, c, {
    predicate: 'said',
    object: BOTC_CARRIER_PREFIX + c.predicate + ']' + obj,
  });
}

/** L2 响应侧：模型 content 中 4 专属谓词 → 载体（JSON/围栏解析失败原样透传，交 p1a 重试环） */
function translateContentToCarriers(content) {
  if (typeof content !== 'string'
    || BOTC_CARRIER_PREDICATES.every((p) => content.indexOf(p) === -1)) return content;
  let s = content.trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return content;
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { return content; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.claims)) return content;
  let changed = false;
  obj.claims = obj.claims.map((c) => {
    if (c && typeof c === 'object' && BOTC_CARRIER_PREDICATES.includes(c.predicate)) {
      changed = true;
      return toCarrier(c);
    }
    return c;
  });
  if (!changed) return content;
  return JSON.stringify(obj);
}

/** L2 响应侧壳：res.json() 内容翻译（llm.js 只消费 ok/status/json()）。
 *  注意：原生 fetch Response 的 ok/status 是原型 getter——Object.assign 浅拷贝会丢掉它们
 *  （B7 复测实抓：botc 局 LIVE 全挂「注入 fetchImpl 须返回 {ok,status,json()}」），
 *  故此处显式读取为自有属性后再包装。 */
function augmentResponse(res) {
  if (!res || typeof res.ok !== 'boolean' || typeof res.json !== 'function') return res;
  const ok = res.ok;
  if (!ok) return res; // 非 2xx：原样透传，交 llm.js 走其 HTTP 错误语义
  const status = res.status;
  return {
    ok, status,
    json: async () => {
      const data = await res.json();
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      if (msg && typeof msg.content === 'string') {
        const translated = translateContentToCarriers(msg.content);
        if (translated !== msg.content) msg.content = translated;
      }
      return data;
    },
  };
}

/**
 * L1+L2：包装 options.fetchImpl——请求侧 system 追加上下文、user payload 插【发言席位】行；
 * 响应侧把模型输出的 4 专属谓词翻译为载体（过 p1a 7 枚举校验，L3 出卡前还原）。
 * @param {object} options llm options（apiKey/baseUrl/model/fetchImpl…）
 * @param {string} script  tb|bmr|snv（非法 → 原样返回，零注入）
 * @param {number} speakerSeat 调用方传入的发言席（非正整数 → 不插席位行）
 */
function withBotcExtractContext(options, script, speakerSeat) {
  options = options || {};
  const contextText = buildBotcExtractContext(script);
  const seatLine = (Number.isInteger(speakerSeat) && speakerSeat > 0)
    ? BOTC_SEAT_MARK + '本条发言来自 ' + speakerSeat + ' 号：原话中的「我/自己」都指 '
      + speakerSeat + ' 号，其自称醉酒/中毒等状态声称的 subject_seat 用 ' + speakerSeat + '。'
    : '';
  if (!contextText && !seatLine) return options;
  const inner = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!inner) return options; // 无传输层：交由 llm.js 按其自身语义落 mock/报错
  const fetchImpl = async function botcExtractAugmentedFetch(url, init) {
    let forwarded = init;
    try {
      const body = JSON.parse(init && init.body);
      const msgs = body && Array.isArray(body.messages) ? body.messages : null;
      if (msgs) {
        const sys = msgs[0];
        if (contextText && sys && sys.role === 'system' && typeof sys.content === 'string'
          && sys.content.indexOf(BOTC_EXTRACT_MARK) === -1) {
          sys.content = sys.content + '\n\n' + contextText;
        }
        const user = seatLine ? msgs.find((m) => m && m.role === 'user' && typeof m.content === 'string'
          && m.content.indexOf(BOTC_SEAT_MARK) === -1) : null;
        if (user) {
          const at = user.content.indexOf('【用户原话');
          user.content = at === -1
            ? user.content + '\n' + seatLine
            : user.content.slice(0, at) + seatLine + '\n' + user.content.slice(at);
        }
        forwarded = Object.assign({}, init, { body: JSON.stringify(body) });
      }
    } catch (e) { /* 非 JSON body：原样透传（防御式，不改请求语义） */ }
    return augmentResponse(await inner(url, forwarded));
  };
  return Object.assign({}, options, { fetchImpl });
}

/**
 * L3：extract 出卡前还原——载体声明还原为专属谓词；自然硬塞（is_role/is_wolf/claims_role
 * + 阵营/状态词精确全词匹配，词表取自 claims.js BOTC_WORD_MAP）按 BOTC 语义还原。
 * @param {Array} claims llm.extract 产出的 claims（7 枚举形态）
 * @returns {{claims: Array, warnings: string[]}}
 */
function mapBotcCarriersBack(claims) {
  const claimsMod = require('./claims'); // 惰性 require：词表单一来源（claims.js 无反向依赖，无环）
  const out = [];
  const warnings = [];
  for (let i = 0; i < (claims || []).length; i++) {
    const c = claims[i];
    const obj = String((c && c.object) === undefined || (c && c.object) === null ? '' : c.object);
    if (obj.indexOf(BOTC_CARRIER_PREFIX) === 0) {
      const rest = obj.slice(BOTC_CARRIER_PREFIX.length);
      const sep = rest.indexOf(']');
      const pred = sep === -1 ? '' : rest.slice(0, sep);
      if (BOTC_CARRIER_PREDICATES.includes(pred)) {
        out.push(Object.assign({}, c, { predicate: pred, object: rest.slice(sep + 1).trim() }));
        continue;
      }
    }
    const word = obj.trim();
    const mapped = claimsMod.BOTC_WORD_MAP[word];
    if (mapped && (c.predicate === 'is_role' || c.predicate === 'claims_role' || c.predicate === 'is_wolf')) {
      out.push(Object.assign({}, c, { predicate: mapped, object: word }));
      warnings.push('claims[' + i + ']: ' + c.predicate + '「' + word
        + '」按 BOTC 语义归入 ' + mapped + '（阵营/状态词还原）');
      continue;
    }
    out.push(c);
  }
  return { claims: out, warnings };
}

module.exports = {
  BOTC_EXTRACT_MARK, BOTC_SEAT_MARK, BOTC_CARRIER_PREFIX, BOTC_CARRIER_PREDICATES,
  buildRoleNameSection, buildBotcExtractContext,
  translateContentToCarriers, withBotcExtractContext, mapBotcCarriersBack,
};
