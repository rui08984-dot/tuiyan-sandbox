# PREREG-命题A-3.0消融 · v1.1 增补条款（补漏档位＋敏感性核对）

> **本件为 v1 的增补条款（版本递进 v1 → v1.1），不修改 v1 原件**（`PREREG-命题A-3.0消融-v1.md`，sha256 5d6907d1910a 保持不变）。
> 依据：铁律⑥「预注册冻结后禁改，改动＝版本递进」。本增补**不改变任何判据本体**（主判据/样本/臂/窗口/统计口径全部照 v1）。

## 1. 触发事实（实测，可复现）

| 探测 | 结果 |
|---|---|
| 上游对关思考的响应 | `thinking={type:'disabled'}` 与 `enable_thinking=false` 均 **HTTP 400 `REASONING_REQUIRED`「当前模型必须开启深度思考」** ⇒ **该模型/中转强制深度思考** |
| 默认档单次判词实测 | 思考 token 1245 / 总 1309，单次 **33.5s**（长证据提示词的真实判词路径更慢：补漏实跑实测 **≈7 分钟/条**） |
| `reasoning_effort='low'` | 思考 token **562**（−55%）、单次 **7.8s**（−77%），正常产出可见文本 |
| `reasoning_effort='minimal'/'none'` | 与默认档**无异**（1245/1628 思考 token）⇒ 只有 `low` 有效 |

## 2. 增补条款（只影响补漏段）

1. **生成器档位**：剩余 **370 条补漏条件**（`retry_pending`，每条含 v1_evidence/v2_skeptical/v3_baserate 三变体）以
   **`reasoning_effort='low'`** 生成；已完成的 **1055 行**（regime A）为默认档，**不回改、不重跑**。
   - 实现：`p1b/src/llmOptions.js` 的 `mergeReasoningEffort`（fetch 层请求体合并；env `P1B_LLM_REASONING_EFFORT=low` 显式开启；
     **env 未设时行为零变化**——p1a 禁改面未动一字）。
2. **分层披露义务**：最终判定报告**必须**按生成期分层（regime A＝默认档 1055 行；regime B＝low 档补漏行）分别给读数，
   并注明主判据（条件内配对差）对档位变化的敏感性；**不得**把两 regime 混成单一读数而不披露。
3. **先验约定（防事后挑数）**：若两 regime 的**方向不一致**，**以 regime A（默认档）为唯一主判据**，regime B 只作敏感性附注——
   此约定**先于**补漏数据到达，防"补漏行改判就有反悔空间"。
4. **配对性说明**：补漏以**整条件**为单位（一条条件的 3 变体同档生成）⇒ 条件内配对不受档位影响；档位只改变条件之间的生成器，属可披露的批次效应。

## 3. 版本与留痕

- 版本：**v1 → v1.1**（增补条款；判据本体零变更）。
- 本件路径：`.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.1-补漏档位-addendum.md`
- 续跑日志：`.scratch/forecast-debate/prereg-a/PAUSE-RESUME-20260914.md` §5。
- 代码：`p1b/src/llmOptions.js`（additive）＋测试 `p1b/test/llm-reasoning-effort.test.cjs`（3 例）。

（增补完 · 2026-09-14 · 判据零变更 · 档位变更＋敏感性条款）
