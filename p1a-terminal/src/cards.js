'use strict';
/**
 * p1a-terminal/src/cards.js — P1a D 路：参谋卡渲染层（终端纯文本）
 * 契约: docs/sandbox/p1a/schema-contract-v0.md §3（LLM 输出 = 本模块输入格式）
 * 设计: docs/specs/2026-09-07-推演沙盘-design.md §14.1/§14.2（参谋卡=思路发生器三件套）
 *
 * 【输入】
 *   cardData  = llm.generateCards/advisor 的输出（契约 §3）：
 *     { contradictions:[{pair_id, underdetermination:'high'|'mid'|'low',
 *                        innocent_explanations:[≥1], claim_a?, claim_b?, action_a?, action_b?}],
 *       hypotheses:[{content, stance, support_events:[事件id], oppose_events:[事件id],
 *                    tendency:'strong'|'mid'|'weak'}],
 *       checkpoints:[{text, resolves:[hypothesis_idx]}] }   （warnings/meta 等附加字段忽略）
 *   gameInfo  = { name, day, players:[{seat,name}] }；兼容 B 路传参 {game:{name,player_count,...}, day}
 *
 * 【输出】终端友好纯文本（返回 string，不直接写 stdout——输出通道归 B 路 CLI）：
 *   头部横幅「═══ 参谋卡 · 思路非答案 ═══」恒挂（红队 YD5/产品定位：思路非答案）
 *   矛盾区（欠定度符号：high=⚠ mid=· low=空格前缀；逐条「无害解释:」；空列表→「未发现矛盾」）
 *   假设区（≥2 套竞争假设：内容+支持/反对事件+倾向强/中/弱+「思路，非定论」后缀）
 *   验证点区（逐条 +（分辨 H*）标注它 resolve 哪个假设）
 *   玄学彩蛋卡位：require('../../p2-yijing/meihua.js') 相对本文件 resolve（design.md §14.2）；
 *     模块缺失或调用抛错 → 静默跳过彩蛋，不报错不崩。P2 路把 meihua.js 落位到
 *     <工作区根>/p2-yijing/meihua.js 即自动生效（当前该路径无模块 → 彩蛋走降级路径）。
 *     彩蛋口径（娱乐参考恒挂）：起卦数 = day(上卦) × 人数(下卦)，确定性可复现。
 *
 * 【宽度纪律】每行 ≤ 80 字符（按 JS 字符串长度=码元数计，码点迭代不劈代理对）。
 *   超长内容做「换行」而非「截断」——不丢信息，同时满足每行 ≤80 的不变量。
 *   已知限制（v0 口径，契约 v0→v1 可升级）：CJK 显示宽度为 2 列，80 字符中文约占
 *   40 显示列；若需严格 80 显示列需引入 wcwidth 口径，v0 先按字符数执行（验收口径）。
 *
 * 【导出】renderCards(cardData, gameInfo, options?) 主入口；
 *   renderAdvisor(card, {game, day}, options?) 为 B 路适配别名（cli.js「接口期望」B→D：
 *   renderAdvisor(card,{game,day}) -> string|{text}，缺失或异常由 B 路自动降级）；
 *   options.meihua 可注入梅花模块（测试用；传 null 强制走「缺失」降级路径）。
 */

const CARD_WIDTH = 80;

// 欠定度色标（终端无色，用符号；low=空格前缀）
const UNDER_SYMBOL = { high: '⚠', mid: '·', low: ' ' };
const UNDER_LABEL = { high: '高', mid: '中', low: '低' };
// 倾向中文（strong/mid/weak → 强/中/弱）
const TENDENCY_CN = { strong: '强', mid: '中', weak: '弱' };

function isInt(v) { return Number.isInteger(v); }

/* 按码点换行：保证每行字符串长度 ≤ width（for...of 迭代不劈代理对） */
function wrapText(text, width) {
  const w = isInt(width) && width > 0 ? width : CARD_WIDTH;
  const s = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n');
  const out = [];
  const paras = s.split('\n');
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p];
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      if (line.length + ch.length > w) { out.push(line); line = ch; }
      else line += ch;
    }
    if (line !== '') out.push(line);
  }
  return out;
}

/* gameInfo 归一化：兼容 {name,day,players} 与 B 路 {game:{...}, day} 两种传参 */
function normalizeGameInfo(gameInfo) {
  const g = gameInfo && typeof gameInfo === 'object' ? gameInfo : {};
  const game = g.game && typeof g.game === 'object' ? g.game : {};
  const pickName = (v) => (v !== undefined && v !== null && String(v).trim() !== '') ? String(v) : null;
  const name = pickName(g.name) || pickName(game.name) || '未命名局';
  let day = isInt(g.day) ? g.day : parseInt(g.day, 10);
  if (!isInt(day) || day < 1) day = isInt(game.day) ? game.day : parseInt(game.day, 10);
  if (!isInt(day) || day < 1) day = null;
  let players = Array.isArray(g.players) ? g.players : (Array.isArray(game.players) ? game.players : []);
  players = players
    .filter((p) => p !== null && typeof p === 'object')
    .map((p) => ({ seat: p.seat, name: p.name === undefined || p.name === null ? '' : String(p.name) }));
  let playerCount = isInt(g.player_count) ? g.player_count : parseInt(g.player_count, 10);
  if (!isInt(playerCount) || playerCount < 1) {
    playerCount = isInt(game.player_count) ? game.player_count : parseInt(game.player_count, 10);
  }
  if (!isInt(playerCount) || playerCount < 1) playerCount = players.length;
  if (!isInt(playerCount) || playerCount < 1) playerCount = 1;
  return { name: name, day: day, players: players, playerCount: playerCount };
}

/* ------------------------------------------------------------------
 * 矛盾区：欠定度符号 + 无害解释（RD1：逐条「无害解释:」前缀）
 * 空矛盾列表 → 「未发现矛盾」
 * ------------------------------------------------------------------ */
function renderContradictions(card) {
  const list = Array.isArray(card.contradictions) ? card.contradictions : [];
  const L = ['【矛盾点】' + list.length + ' 条（欠定度符号: 高=⚠ 中=· 低=空格）'];
  if (list.length === 0) { L.push('  未发现矛盾'); return L; }
  for (let i = 0; i < list.length; i++) {
    const c = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const level = UNDER_SYMBOL[c.underdetermination] !== undefined ? c.underdetermination : 'low';
    const pid = (c.pair_id !== undefined && c.pair_id !== null && String(c.pair_id).trim() !== '')
      ? String(c.pair_id) : ('#' + (i + 1));
    const refs = []
      .concat([c.claim_a, c.claim_b].filter((v) => v !== undefined && v !== null && v !== '').map((v) => 'c' + v))
      .concat([c.action_a, c.action_b].filter((v) => v !== undefined && v !== null && v !== '').map((v) => 'a' + v));
    L.push(' ' + UNDER_SYMBOL[level] + ' 矛盾' + pid + '（欠定度:' + UNDER_LABEL[level] + '）'
      + (refs.length ? '（引用:' + refs.join(',') + '）' : ''));
    const exps = Array.isArray(c.innocent_explanations) ? c.innocent_explanations : [];
    for (let j = 0; j < exps.length; j++) L.push('   无害解释: ' + exps[j]);
    if (exps.length === 0) L.push('   无害解释: （无——RD1 非空强校验，此对不应流出 C 路）');
  }
  return L;
}

/* ------------------------------------------------------------------
 * 假设区：≥2 套竞争假设 = 内容 + 支持/反对事件 + 倾向（强/中/弱）+「思路，非定论」后缀
 * ------------------------------------------------------------------ */
function renderHypotheses(card) {
  const list = Array.isArray(card.hypotheses) ? card.hypotheses : [];
  const L = ['【竞争假设】' + list.length + ' 套（互相竞争，不追求唯一真相）'];
  if (list.length === 0) { L.push('  （无假设——契约要求 ≥2 套竞争假设，请检查 C 路输出）'); return L; }
  for (let i = 0; i < list.length; i++) {
    const h = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const ten = TENDENCY_CN[h.tendency] || String(h.tendency === undefined || h.tendency === null ? '-' : h.tendency);
    L.push('  假设H' + (i + 1) + '（倾向:' + ten + '）: ' + (h.content === undefined || h.content === null ? '' : String(h.content)));
    const sup = (Array.isArray(h.support_events) ? h.support_events : []).map((e) => 'e' + e).join(',') || '-';
    const opp = (Array.isArray(h.oppose_events) ? h.oppose_events : []).map((e) => 'e' + e).join(',') || '-';
    L.push('     支持事件: ' + sup + ' / 反对事件: ' + opp);
    L.push('     （思路，非定论）');
  }
  return L;
}

/* ------------------------------------------------------------------
 * 验证点区：逐条 +（分辨 H*）标注它 resolve 哪个假设（resolves=假设下标，0 起）
 * 越界/非法下标过滤；全无效显示「-」
 * ------------------------------------------------------------------ */
function renderCheckpoints(card) {
  const list = Array.isArray(card.checkpoints) ? card.checkpoints : [];
  const total = Array.isArray(card.hypotheses) ? card.hypotheses.length : 0;
  const L = ['【验证点】' + list.length + ' 条'];
  if (list.length === 0) { L.push('  （无验证点）'); return L; }
  for (let i = 0; i < list.length; i++) {
    const cp = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const res = (Array.isArray(cp.resolves) ? cp.resolves : [])
      .filter((x) => isInt(x) && x >= 0 && x < total)
      .map((x) => 'H' + (x + 1)).join('/') || '-';
    L.push('  ' + (i + 1) + '. ' + (cp.text === undefined || cp.text === null ? '' : String(cp.text)) + '（分辨 ' + res + '）');
  }
  return L;
}

/* ------------------------------------------------------------------
 * 玄学彩蛋卡位（design.md §14.2）：meihua.js 落位 <工作区根>/p2-yijing/meihua.js
 * （相对本文件 ../../p2-yijing/meihua.js）。模块缺失/加载失败/调用抛错 → 一律静默
 * 跳过彩蛋，不报错不崩。渲染明标「娱乐参考」（玄学定位裁决：永不进入研判依据）。
 * 起卦口径（确定性可复现）：数A=天数(上卦)，数B=在册人数(下卦)，走梅花两数起卦法。
 * ------------------------------------------------------------------ */
function loadMeihua() {
  try {
    const path = require('path');
    return require(path.join(__dirname, '..', '..', 'p2-yijing', 'meihua.js'));
  } catch (e) { return null; }
}

function renderEgg(meihua, seed) {
  if (!meihua || typeof meihua.qiGuaByNumbers !== 'function') return null;
  try {
    const r = meihua.qiGuaByNumbers(seed.a, seed.b);
    return [
      '─── 今日卦象（娱乐参考，不构成任何研判依据）───',
      '  起卦: 第' + seed.a + '天(上卦) × ' + seed.b + '人(下卦) → 动爻' + r.dongYao,
      '  本卦: ' + r.benGua.fullName + '（' + r.benGua.name + '）',
      '  互卦: ' + r.huGua.fullName + '（' + r.huGua.name + '）',
      '  变卦: ' + r.bianGua.fullName + '（' + r.bianGua.name + '）',
      '  体用: 体=' + r.ti.trigram + '(' + r.ti.wuXing + ',' + r.ti.position + ') 用='
        + r.yong.trigram + '(' + r.yong.wuXing + ',' + r.yong.position + ') → ' + r.tiYongRelation,
    ];
  } catch (e) { return null; }
}

/* ------------------------------------------------------------------
 * 主入口：renderCards(cardData, gameInfo, options?) -> string
 * options.meihua: 注入梅花模块（测试用）；null 强制「缺失」降级；缺省走真实加载。
 * ------------------------------------------------------------------ */
function renderCards(cardData, gameInfo, options) {
  const card = cardData !== null && typeof cardData === 'object' ? cardData : {};
  const g = normalizeGameInfo(gameInfo);
  const L = [];
  // 头部（红队 YD5/产品定位：「思路非答案」标注恒挂）
  L.push('═══ 参谋卡 · 思路非答案 ═══');
  L.push('局: ' + g.name + '　' + (g.day ? '第 ' + g.day + ' 天结算' : '天数未知'));
  if (g.players.length > 0) {
    L.push('名单: ' + g.players.map((p) => p.seat + '号·' + p.name).join(' '));
  }
  L.push('');
  Array.prototype.push.apply(L, renderContradictions(card));
  L.push('');
  Array.prototype.push.apply(L, renderHypotheses(card));
  L.push('');
  Array.prototype.push.apply(L, renderCheckpoints(card));
  const meihua = (options && typeof options === 'object' && options.meihua !== undefined)
    ? options.meihua : loadMeihua();
  const egg = renderEgg(meihua, { a: g.day || 1, b: g.playerCount });
  if (egg) { L.push(''); Array.prototype.push.apply(L, egg); }
  // 终宽保障：全卡逐行码点换行，任何一行 ≤ CARD_WIDTH 字符
  const lines = [];
  for (const raw of L) Array.prototype.push.apply(lines, wrapText(raw, CARD_WIDTH));
  return lines.join('\n');
}

/* B 路适配别名（cli.js「接口期望」B→D）：renderAdvisor(card,{game,day}) -> string|{text} */
function renderAdvisor(card, ctx, options) {
  const c = ctx !== null && typeof ctx === 'object' ? ctx : {};
  const game = c.game !== null && typeof c.game === 'object' ? c.game : {};
  return renderCards(card, {
    name: c.name !== undefined ? c.name : game.name,
    day: c.day !== undefined ? c.day : game.day,
    players: c.players !== undefined ? c.players : game.players,
    player_count: c.player_count !== undefined ? c.player_count : game.player_count,
  }, options);
}

module.exports = { renderCards, renderAdvisor, wrapText, CARD_WIDTH };