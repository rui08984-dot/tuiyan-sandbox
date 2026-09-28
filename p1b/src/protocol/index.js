'use strict';
/**
 * p1b/src/protocol/index.js —— 协议层出口（2026-09-29）
 *
 * 三块，职责分得很死：
 *   · intakeSource          —— 只读投影读取器（读冻结件，不 require 它、不执行它）
 *   · intakeProtocol        —— 结构化协议（25 问的 key/题面/取值域/必答/后果/判据来源）
 *   · validateIntakeAnswers —— 机械校验器（纯函数：零网络 · 零 LLM · 零写库）
 *
 * 冻结件 `p1b/src/routes/intake.js` 一个字未动；本层只**读**它并把它的口径摊平成模型能答的形状。
 * 详见 docs/specs/接题问卷协议-v1-20260929.md。
 */

module.exports = {
  source: require('./intakeSource'),
  protocol: require('./intakeProtocol'),
  validator: require('./validateIntakeAnswers'),
};
