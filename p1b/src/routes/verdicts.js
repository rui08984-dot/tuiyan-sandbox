'use strict';
/**
 * p1b/src/routes/verdicts.js —— 多路判词路由（第十棒 W2）：
 *   POST /api/games/:id/predictions/:pid/verdicts → 3 路生成+全量逐行落库（不只存聚合值）。
 *
 * 3 路 = 同 provider（tokenrhythm）× 3 prompt 变体 × 温度多样性（0.2/0.7/1.0）：
 *   v1_evidence  T=0.2  证据聚合视角（合法角色：信息聚合）
 *   v2_skeptical T=0.7  怀疑派视角（发散候选，G-合并 R-b：高温=发散原料非预测信号）
 *   v3_baserate  T=1.0  基率视角（合法角色：基率检索）
 * provider 维度留空待第二把 key 扩展 3×N（表结构已兼容）。
 *
 * 铁律落点（契约设计，写死）：
 *   ①LLM 只产出文本（多路推理=合法四角色之一）；②implied_prob 必须由 extractImpliedProb
 *   按固定输出格式（末行 P=0.xx）正则机械抽取——LLM 不直接给数（项目两次负结果均死于
 *   LLM 直接输出数字）；③抽取失败 → implied_prob=NULL 如实落库（verdict_text 全量保留，
 *   消融时剔除该行），绝不编数；④单路失败不落库不编造，errors 数组如实标注。
 */
const { db, llm } = require('../deps');
const predictions = require('../db/predictionsStore');
const vstore = require('../db/verdictsStore');
const { chatText } = require('../lib/llmChat');
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404 } = require('./games');
const { httpError, requireInt } = require('../util');

/** 3 路预注册配置（变体×温度配对=任务书降级版；provider 维度留空待补） */
const ROUTES = [
  { variant: 'v1_evidence', temperature: 0.2 },
  { variant: 'v2_skeptical', temperature: 0.7 },
  { variant: 'v3_baserate', temperature: 1.0 },
];

const VARIANT_ANGLE = {
  v1_evidence: '证据聚合视角：基于已给出的判定标准与已知事实链，评估该判定为真的可能性，逐条列出支持与反对证据。',
  v2_skeptical: '怀疑派视角：假设该判定可能不成立，找出反例、信息缺口与替代解释，再给出倾向。',
  v3_baserate: '基率视角：忽略个案细节，从同类局型的历史基率出发评估该判定为真的可能性。',
};

const OUTPUT_FORMAT_RULE = '输出要求：正文分析不超过150字；最后一行必须严格是「P=0.xx」格式（0到1之间的小数，例如 P=0.65）。';

/** system 首行恒挂边界（思路非答案/参考铁律同源） */
const SYSTEM_HEAD = '你是多路判词实验装置中的一路（合法角色：多路推理）。你的输出仅作复盘参考，不接入现场研判。';

function buildSystemPrompt(variant) {
  return SYSTEM_HEAD + VARIANT_ANGLE[variant] + OUTPUT_FORMAT_RULE;
}

function buildUserPrompt(prediction, game) {
  return [
    '判定标准：「' + prediction.statement + '」',
    '落注信息：第 ' + prediction.day + ' 天落注；局类型 ' + (game && game.game_type ? game.game_type : 'unknown') + '。',
    '请按你的视角输出分析，并在最后一行给出 P=0.xx。',
  ].join('\n');
}

/**
 * implied_prob 机械抽取（契约：末行 P=0.xx；禁 LLM 自由给数）。
 * 只认 [0,1] 小数（P=1 / P=0 合法；P=1.5 / P=65% 不认）；从后往前找首个含 P= 之行。
 * @returns {number|null} 抓不到或越界 → null（不编数）
 */
function extractImpliedProb(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/(^|[^A-Za-z0-9])P\s*=\s*([01](?:\.\d+)?)\s*$/i);
    if (m) {
      const v = parseFloat(m[2]);
      return (v >= 0 && v <= 1) ? v : null;
    }
  }
  return null;
}

/** MOCK 判词（确定性模板，零网络；三路可区分且末行带 P= 供抽取链路烟测） */
function buildMockVerdict(variant, temperature, statement) {
  const mockProb = { v1_evidence: '0.25', v2_skeptical: '0.50', v3_baserate: '0.75' }[variant] || '0.50';
  const brief = String(statement || '').slice(0, 40);
  return '[MOCK ' + variant + ' T=' + temperature + '] 判词（零网络模板）：就「' + brief
    + '」按本路视角给出复盘参考倾向（思路非答案，仅供消融管线烟测）。\nP=' + mockProb;
}

function register(app, ctx) {
  vstore.ensureVerdictsTable(db.getConnection()); // additive 私有表（register 内 ensure，oracleCast 先例）

  app.post('/api/games/:id/predictions/:pid/verdicts', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    const game = getGameOr404(gameId);
    const pid = requireInt('prediction id', req.params.pid, 1);
    const pred = predictions.getPrediction(pid);
    if (!pred || pred.game_id !== gameId) {
      throw httpError(404, '预测记录不存在或不属于该局: ' + pid);
    }
    const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
    const mode = llm.resolveMode(options); // mockMode/无 key → MOCK（零网络，与 extract/advise/oracle 同链）
    const saved = [];
    const errors = [];
    for (const route of ROUTES) {
      try {
        let text;
        if (mode === 'MOCK') {
          text = buildMockVerdict(route.variant, route.temperature, pred.statement);
        } else {
          text = await chatText(
            [{ role: 'system', content: buildSystemPrompt(route.variant) }, { role: 'user', content: buildUserPrompt(pred, game) }],
            Object.assign({}, options, { temperature: route.temperature })
          );
        }
        const prob = extractImpliedProb(text); // 机械抽取：数字只从文本正则来
        const row = vstore.saveVerdict({
          predictionId: pid,
          promptVariant: route.variant,
          temperature: route.temperature,
          verdictText: text,
          impliedProb: prob,
        });
        saved.push({
          id: row.id,
          prompt_variant: row.prompt_variant,
          temperature: row.temperature,
          implied_prob: row.implied_prob,
          extracted: prob !== null,
          created_at: row.created_at,
        });
      } catch (e) {
        // 单路失败不落库不编造（消融数据干净优先）；如实标注
        errors.push({ prompt_variant: route.variant, temperature: route.temperature, error: String((e && e.message) ? e.message : e) });
      }
    }
    return {
      prediction_id: pid,
      mode: mode === 'MOCK' ? 'mock' : 'live',
      saved: saved,
      errors: errors,
      note: 'LLM 只产出文本；implied_prob 由末行「P=0.xx」固定格式正则机械抽取，抽取失败落 NULL 不编数',
      l0_gate: predictions.l0Gate(),
    };
  });
}

module.exports = { register, ROUTES, extractImpliedProb, buildMockVerdict, buildSystemPrompt, buildUserPrompt };
