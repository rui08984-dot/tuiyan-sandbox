# P4 · 窗口口径对齐方案（我方 cutoff/full 双窗 ↔ Metaculus question timeline）

> **状态声明**：本轮 Metaculus 数据面 **0 条**（403，见 PROBE-RECEIPT.md），因此本方案中 Metaculus 一侧的时间轴语义
> **全部来自公开文档与既往用法的转述**，**未做字段级实测**；凡未实测项一律标 **[待实测]**。落地前必须以真实响应校正。

## 一、我方双窗（已实测，来自本项目口径）
| 窗 | 定义 | 实测来源 |
|---|---|---|
| **cutoff 窗** | 题的**数据可见性边界**：基率/阈值只允许用**严格早于 cutoff** 的数据算 | 细则 B：forward 题 cutoff=created_at；backfill 题 cutoff=matures_at−1 天 |
| **full 窗** | 结算观测窗：事件发生→真值可取，用于结算与评分 | evidence[0].cutoff / created_at → resolved_at |

## 二、Metaculus 时间轴（[待实测] 文档语义）
open_time（开注） → close_time / scheduled_close_time（停注/冻结） → scheduled_resolution_time（预计裁决）
→ actual_resolution_time（实际裁决），并带 resolution（裁决值）与 aggregations（社区分布随时间的 history）。

## 三、映射规则（**先声明后执行**；两种读法二选一，不得事后挑）
| 我方 | Metaculus | 规则 |
|---|---|---|
| **cutoff 窗** | **close_time**（推荐）或 open_time（备选） | 选定一个锚点后**全程一致**；推荐 close_time，因其代表社区共识的最终态 |
| full 窗 | open_time → actual_resolution_time | 仅作覆盖区间声明，不参与基率计算 |
| 真值 / outcome | resolution | 两者**不同源**：我方=机械锚（HTTP 取值），Metaculus=官方/社区裁决 |
| 我方 base rate（外生） | aggregations 在 close_time 时刻的社区概率 | 仅用于**对表比较**，不得回填进我方账本 |

## 四、不可映射项（必须写进披露，不得静默）
1. **语义错位**：Metaculus 的 close＝「停止下注」；我方 cutoff＝「数据可见性边界」。二者不是同一概念，映射是**近似**。
2. **对象错位**：社区概率＝**另一群预测者的共识（预测）**，不是真值；我方 base rate 是**历史频率**。ρ 高只说明「两者无矛盾」。
3. **题型错位**：我方是数值阈值二值化题（P(X ≥ th)）；Metaculus 常见多档/连续题 ⇒ 需先归约为二值，**归约规则须预注册**。
4. **时间粒度错位**：我方 cutoff 精确到秒且带「当日数据排除」规则；Metaculus close 是墙钟时刻（UTC）⇒ 需显式时区与边界处理。
5. **裁决时滞**：Metaculus 的 actual_resolution_time 可能远晚于事件日；我方以事件日+锚可取值判定。

## 五、落地前核验清单（拿到 token 后必做，顺序执行）
1. 确认 posts/questions 的真实字段名与时区（open/close/scheduled_resolution/actual_resolution）。
2. 确认 aggregations 结构：取哪个子键（recency_weighted / unweighted）？history 的时间粒度与末点含义？
3. 用**同一道题**同时印证 close_time 与 community 概率末点，验证「close 时刻概率」可稳定取到。
4. 完成后再按 §三 的选定锚点，对同型题批量对齐。

（窗口对齐方案完 · 2026-09-13）
