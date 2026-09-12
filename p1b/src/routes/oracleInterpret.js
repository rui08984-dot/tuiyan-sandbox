'use strict';
/**
 * p1b/src/routes/oracleInterpret.js —— 独立排盘断语端点（G1 反馈 #1，扩展走 wrapper）：
 *   POST /api/oracle/interpret { id } → 201 { id, method, inputs, casting, verdict,
 *                                            disclaimer, mode[, llm_error], created_at, game_id }
 *
 * oracleCast.js 本体零改动（扩展走 wrapper 铁律）：本文件只做「读档 → 复用 P8 断语链 →
 * 写回 verdict 结构位」的增量编排。断语链复用 routes/oracle.js 导出面（ORACLE_SYSTEM_PROMPT /
 * buildUserPrompt / capVerdict），保证与对局彩蛋同一条 system 首行「娱乐参考，非游戏研判」。
 *
 * 边界铁律（P8 拍板③，写死）：mode 三态 mock/live/mock_fallback 与 P8 契约一致；
 * LIVE 失败落确定性模板并如实标注 llm_error，不谎报为 LLM 断语；断语 ≤120 字（硬截 200）。
 * 写回 = UPDATE 同一行 oracle_readings.verdict（P9 预留结构位），幂等不新增行。
 * 本路由返回值禁止被参谋/研判类模块引用。
 */
const { llm } = require('../deps');
const { mockVerdict, DISCLAIMER } = require('../lib/oracle');
const { chatText } = require('../lib/llmChat');
const { resolveLlmOptions } = require('../llmOptions');
const { ORACLE_SYSTEM_PROMPT, buildUserPrompt, capVerdict } = require('./oracle');
const { getOracleReading, updateOracleReadingVerdict } = require('../db/oracleStore');
const { httpError, requireInt } = require('../util');

function register(app, ctx) {
  app.post('/api/oracle/interpret', async (req, reply) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    if (body.id === undefined || body.id === null || body.id === '') {
      throw httpError(400, 'body.id 必填（oracle_readings 排盘档案主键）');
    }
    const id = requireInt('body.id', body.id, 1);
    const reading = getOracleReading(id);
    if (!reading) throw httpError(404, '排盘档案不存在: ' + id);
    const casting = reading.casting;

    const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
    const mode = llm.resolveMode(options); // mockMode/无 key → MOCK（零网络，与 P8 同链）
    let verdict, modeOut, llmError;
    if (mode === 'MOCK') {
      verdict = mockVerdict(casting); // 固定模板（零网络、确定性）
      modeOut = 'mock';
    } else {
      try {
        verdict = capVerdict(await chatText(
          [{ role: 'system', content: ORACLE_SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(casting) }],
          options
        ));
        modeOut = 'live';
      } catch (e) {
        // LIVE 失败不炸断语：落确定性模板并如实标注（mode=mock_fallback + llm_error）
        verdict = mockVerdict(casting);
        modeOut = 'mock_fallback';
        llmError = String((e && e.message) ? e.message : e);
      }
    }
    updateOracleReadingVerdict(id, verdict); // 幂等写回：UPDATE 同行 verdict 结构位（不新增行）
    reply.code(201); // 201：断语（推断层记录）已生成并落位
    const out = {
      id: id,
      method: reading.method,
      inputs: reading.inputs,
      casting: casting,
      verdict: verdict,
      disclaimer: reading.disclaimer || DISCLAIMER,
      mode: modeOut,
      created_at: reading.created_at,
      game_id: reading.game_id,
    };
    if (llmError) out.llm_error = llmError;
    return out;
  });
}

module.exports = { register, ORACLE_SYSTEM_PROMPT, buildUserPrompt, capVerdict };
