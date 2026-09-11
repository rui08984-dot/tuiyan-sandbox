'use strict';
/**
 * p1b/src/routes/oracle.js —— 对局玄学化判词（P2 线 W1，赛后娱乐彩蛋）：
 *   GET /api/games/:id/oracle → { game_id, casting, verdict, disclaimer, mode[, llm_error] }
 *
 * 拍板边界（写死在代码里，不许拆）：
 *   ①形态 = 赛后彩蛋接口，只服务前端可关闭弹层（W2），不是独立页不是参谋卡附注；
 *   ②排盘 = 纯数学：lib/oracle.js 从本局数据确定性派生两数起卦（同局永远同卦，零用户操作）；
 *   ③断语 = LLM：system 首行强制「娱乐参考，非游戏研判」，≤120 字，梅花易数传统方法论只解读体用生克；
 *   ④恒挂 disclaimer「娱乐参考」，绝不接入任何游戏研判功能——「梅花查狼」实验
 *     （docs/sandbox/p2-yijing/oracle-experiment-result.md）已证判词无研判效力。
 *     本接口返回值禁止被参谋/研判类模块引用。
 * mode ∈ mock（MOCK 固定模板，零网络）｜ live（真实 LLM 断语）｜
 *        mock_fallback（LIVE 失败落确定性模板并如实标注 llm_error，不谎报为 LLM 断语）。
 */
const { llm } = require('../deps');
const { deriveCasting, mockVerdict, DISCLAIMER } = require('../lib/oracle');
const { chatText } = require('../lib/llmChat');
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404 } = require('./games');
const { requireInt } = require('../util');

/** system 首行强制娱乐边界（拍板 #3）；只解读体用生克；≤120 字；只输出断语文本 */
const ORACLE_SYSTEM_PROMPT = [
  '娱乐参考，非游戏研判。',
  '你是赛后娱乐环节的梅花易数断语生成器：只依据用户给出的卦象（本卦/互卦/变卦/动爻/体用五行生克），',
  '按梅花易数传统方法论写一句轻松的断语。要求：≤120字；不给出任何游戏策略、身份指认或研判建议；',
  '只输出断语文本本身，不要 JSON、不要前后缀。',
].join('');

/** user prompt：只投喂确定性卦象字段（lib/oracle.js 派生结果），不含任何对局身份/查杀信息 */
function buildUserPrompt(casting) {
  return [
    '本局起卦（梅花易数·先天八卦数两数起卦）：',
    '上卦数A=' + casting.numbers.a + '，下卦数B=' + casting.numbers.b + '，动爻=第' + casting.dongYao + '爻。',
    '本卦：' + casting.benGua.fullName + '（上' + casting.benGua.upper + '下' + casting.benGua.lower + '）',
    '互卦：' + casting.huGua.fullName,
    '变卦：' + casting.bianGua.fullName,
    '体：' + casting.ti.trigram + '（' + casting.ti.wuXing + '），用：' + casting.yong.trigram + '（' + casting.yong.wuXing + '），体用关系：' + casting.tiYongRelation,
    '请按传统体用生克方法论写断语（≤120字）。',
  ].join('\n');
}

/** 防失控截断：prompt 要求 ≤120 字，超长响应硬截 200 字符（前端弹层容量保护） */
function capVerdict(text) {
  return text.length > 200 ? text.slice(0, 200) + '……' : text;
}

function register(app, ctx) {
  app.get('/api/games/:id/oracle', async (req) => {
    const id = requireInt('game id', req.params.id, 1);
    const game = getGameOr404(id);
    const casting = deriveCasting(game); // 纯数学排盘（确定性，同局同卦）
    const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
    const mode = llm.resolveMode(options); // mockMode/无 key → MOCK（零网络，与 extract/advise 同链）
    if (mode === 'MOCK') {
      return { game_id: id, casting, verdict: mockVerdict(casting), disclaimer: DISCLAIMER, mode: 'mock' };
    }
    try {
      const text = await chatText(
        [{ role: 'system', content: ORACLE_SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(casting) }],
        options
      );
      return { game_id: id, casting, verdict: capVerdict(text), disclaimer: DISCLAIMER, mode: 'live' };
    } catch (e) {
      // LIVE 失败不炸彩蛋：落确定性模板并如实标注（mode=mock_fallback + llm_error）
      return {
        game_id: id,
        casting,
        verdict: mockVerdict(casting),
        disclaimer: DISCLAIMER,
        mode: 'mock_fallback',
        llm_error: String((e && e.message) ? e.message : e),
      };
    }
  });
}

module.exports = { register, ORACLE_SYSTEM_PROMPT, buildUserPrompt, capVerdict, DISCLAIMER };
