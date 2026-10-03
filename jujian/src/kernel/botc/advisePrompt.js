'use strict';
/**
 * p1b/src/botc/advisePrompt.js —— BOTC 局参谋卡 prompt 剧本上下文注入（B3 棒）。
 *
 * 背景（BRIEFS B3）：runBotcAdvise → llm.generateCards 的 prompt 由 p1a llm.js 内部
 * 组装（CARDS_SYSTEM_PROMPT 模块常量 + normalizeDayData 白名单字段），而 p1a-terminal
 * 禁改、dayData 塞自定义字段会被白名单丢弃 → 注入通道选 llm.js 明示的扩展点
 * options.fetchImpl（llm.js「options.fetchImpl 可注入，测试零真实网络」）：
 *   - buildBotcPromptContext(script)：纯函数，从 roles.js 数据层生成本局剧本上下文
 *     文本（角色清单/说书人裁量警示/剧本特有机制/假设区生成要求）；
 *   - withBotcPromptContext(options, text)：把 options.fetchImpl 包装为「请求体增强」
 *     fetch——chatCompletion 每次尝试都从 messages 重建 body（JSON 字符串），包装层
 *     解析 body 后把上下文追加到 system 消息尾部再转发；幂等（带标记防重复）；
 *     非 JSON body 或解析失败原样透传（防御式，不改请求语义）。
 * werewolf 局路径零改动：仅 runBotcAdvise（BOTC 分支）调用本模块；MOCK 模式不产生
 * prompt（llm.js mockRespond 不走 fetch），包装层自然成为 no-op。
 */
const roles = require('./roles');

const BOTC_CONTEXT_MARK = '【BOTC 剧本上下文·注入】';

const SCRIPT_NAMES = {
  tb: '暗流涌动（Trouble Brewing，入门本）',
  bmr: '血月升起（Bad Moon Rising）',
  snv: '煽动叛乱（Sects & Violets）',
};

/** 剧本特有机制提示（拍板口径：提示级，不做机制模拟；BRIEFS B3） */
const SCRIPT_MECHANISM = {
  tb: '【剧本特有机制】入门本：恶魔唯一（小恶魔）、无特殊死亡规则，说书人裁量空间最小——研判以常规昼夜信息为主。',
  bmr: '【剧本特有机制】夜死不公布：夜晚死亡不公布角色与死因，且本剧本恶魔存在一晚多杀——「谁死了/没死」携带的信息量显著低于入门本，勿把存活当作好人倾向的硬依据。',
  snv: '【剧本特有机制】疯狂（Madness）机制在场：说书人可要求某玩家公开坚信某事为真、违背即受罚——该玩家的相关发言是受迫表达，发言立场与其真实认知可能系统性背离。',
};

/** 说书人裁量警示（摸底 §5：一等不确定性来源；与 CARDS_SYSTEM_PROMPT 的 RD1 状态类无辜解释对齐） */
const STORYTELLER_WARNING = [
  '【说书人裁量警示·一等不确定性来源】',
  '本局存在说书人自由裁量：玩家处于醉酒/中毒状态时获得的信息为假，是规则内的合法假信息；',
  '说书人本人也会对玩家说谎。因此「声称与事实不符」不必然是撒谎或恶意行为：',
  '矛盾区的无辜解释必须优先覆盖状态类原因（醉酒/中毒→合法假信息），',
  '假设区不得仅凭「信息为假」给玩家定罪，须把它当作与恶意谎言平级的一等不确定性来源。',
].join('\n');

/** 假设区生成要求（BRIEFS B3：假设引用本局实际角色能力；矛盾区沿用 B2 的 RB1-RB5 pairs） */
const HYPOTHESIS_REQUIREMENT = [
  '【假设区生成要求】',
  '每套假设的论证必须引用本局剧本里真实存在的能力/机制（使用下方角色清单的原文关键词），',
  '例如「3号自称洗衣妇，但其后续发言从未对齐洗衣妇的能力信息（见角色清单）」式论证；',
  '禁止引用本剧本角色清单之外的角色或能力参与推理。矛盾区沿用输入的代码比对器矛盾对',
  '（RB1-RB5 规则产出，pair_id 原样沿用），只需补充无辜解释与欠定度，不另造矛盾对。',
].join('\n');

/** 角色清单段：按团队分组（镇民/外来者/爪牙/恶魔/旅行者），每行「中文名（团队）：能力摘要」 */
function buildRoleListSection(script) {
  const groups = {};
  for (const r of roles.getRolesByEdition(script)) {
    const team = roles.teamZh(r.team);
    (groups[team] = groups[team] || []).push(roles.roleBriefZh(r));
  }
  const order = ['镇民', '外来者', '爪牙', '恶魔', '旅行者'];
  const lines = [];
  for (const team of order) {
    if (groups[team] && groups[team].length) lines.push(team + '（' + groups[team].length + '）：' + groups[team].join('；'));
  }
  for (const team of Object.keys(groups)) {
    if (!order.includes(team) && groups[team].length) lines.push(team + '：' + groups[team].join('；'));
  }
  return lines.join('\n');
}

/**
 * 生成本局 BOTC 剧本上下文文本（runBotcAdvise 注入参谋卡 prompt 用）。
 * @param {string} script tb|bmr|snv（非法剧本 → 空串 = 不注入）
 * @returns {string} 以 BOTC_CONTEXT_MARK 开头的多行文本
 */
function buildBotcPromptContext(script) {
  if (!roles.SCRIPTS.includes(script)) return '';
  return [
    BOTC_CONTEXT_MARK + '本局剧本：' + (SCRIPT_NAMES[script] || script)
      + '。以下内容只针对血染钟楼（BOTC）局研判，优先级高于通用狼人杀直觉。',
    '【本局剧本角色清单】（名字（团队）：能力中文摘要——判词前先弄清每个角色是干嘛的）',
    buildRoleListSection(script),
    STORYTELLER_WARNING,
    SCRIPT_MECHANISM[script] || '',
    HYPOTHESIS_REQUIREMENT,
  ].filter(Boolean).join('\n');
}

/**
 * 把 BOTC 剧本上下文注入 llm.generateCards 的请求：包装 options.fetchImpl（缺省全局
 * fetch），在发出的 system 消息尾部追加 contextText。幂等：已带标记的消息不重复追加。
 */
function withBotcPromptContext(options, contextText) {
  options = options || {};
  if (!contextText) return options;
  const inner = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!inner) return options; // 无传输层：交由 llm.js 按其自身语义落 mock/报错
  const fetchImpl = async function botcPromptAugmentedFetch(url, init) {
    let forwarded = init;
    try {
      const body = JSON.parse(init && init.body);
      const sys = body && Array.isArray(body.messages) && body.messages[0];
      if (sys && sys.role === 'system' && typeof sys.content === 'string'
        && sys.content.indexOf(BOTC_CONTEXT_MARK) === -1) {
        sys.content = sys.content + '\n\n' + contextText;
        forwarded = Object.assign({}, init, { body: JSON.stringify(body) });
      }
    } catch (e) { /* 非 JSON body：原样透传 */ }
    return inner(url, forwarded);
  };
  return Object.assign({}, options, { fetchImpl });
}

module.exports = { BOTC_CONTEXT_MARK, buildBotcPromptContext, withBotcPromptContext };
