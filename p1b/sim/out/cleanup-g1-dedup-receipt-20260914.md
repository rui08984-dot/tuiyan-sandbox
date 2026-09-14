# 局 1 重复参谋卡清理收据（2026-09-14 · 用户拍板「清理」）

## 一句话

清除 `game_id=1`（早期「集成验证局」）因 **bug-27**（同日重复天结算）产生的重复/残留参谋卡行：
**hypotheses 7→3、contradictions 3→1**；保留的全是**真实 LLM 卡**，账本事实（predictions/verdicts）**零改动**。

## 一 · 快照（清理前，WAL-aware）

| 项 | 值 |
|---|---|
| 快照文件 | `.scratch/backup/p1a-pre-g1dedup-20260914044634.db` |
| sha256 | `5d82043dad82f838d32d26922abe1e16e57cd54b42a064e2771f6f970516ae97` |
| 清理前行数 | hypotheses **10**（其中局1 = **7**）｜contradictions **3**（全属局1） |
| 回滚 | `cp .scratch/backup/p1a-pre-g1dedup-20260914044634.db p1a-terminal/data/p1a.db`（先停 8787） |

## 二 · 清理规则（脚本 `p1b/scripts/cleanup-g1-dedup.cjs`，默认 dry-run）

**只动 `game_id=1`**，三条规则：

1. **去重**：hypotheses 按 `(game_id, day, content)`；contradictions 按 `(game_id, claim_a, claim_b, action_a, action_b, conflict_desc)`。
2. **保留更丰富者**（**不是 id 最小者**）：无辜解释条数多 → 优先；同为 mock 则保 id 小。
3. **mock 罐头假设在存在真实卡时一并清理**（收紧判据：内容命中 mock 指纹 **且** 同局存在非 mock 假设）。

## 三 · ★为什么规则 2/3 是必需的（自查修正，重要）

初版脚本按「保 id 最小」＝**保首条**。实跑副本后发现**方向反了**：

| 行 | 内容 | 判定 |
|---|---|---|
| con#1/#2 | 无辜解释逐字等于 `llm.js` 的 `INNOCENT_POOL`（「女巫可能毒错人…」「信息差…」） | **MOCK 罐头** |
| con#3 | 三条解释均自定义，含「假跳女巫…真女巫可能恰在 5、12 其中之一」推理 | **真实 LLM** |

若按 id 保首，会**留下 mock、删掉真实的**——恰好把最有价值的一条清掉。
同理 hypotheses：#1/#2 是 mock 的「1、2 号悍跳狼」，而本局**真实 claims** 是 1号/8号 声称、
真矛盾是 **5号 vs 12号 都认女巫**——mock 描述与证据**完全不符**，属重复结算带出的残留。
故规则 2/3 保证**保留与证据吻合的真实卡**。

## 四 · 执行结果

| 项 | 前 | 后 |
|---|---|---|
| hypotheses（局1） | 7 | **3**（#5/#6/#7，全为真实 LLM 卡） |
| contradictions（局1） | 3 | **1**（#3，真实卡） |
| hypotheses（全库） | 10 | **6** |
| contradictions（全库） | 3 | **1** |
| **predictions** | 1935 | **1935（不变）** |
| **verdicts** | 3662 | **3662（不变）** |
| integrity_check | ok | **ok** |

删除明细：hyp #1/#2（mock 罐头，被真实卡取代）＋ #3/#4（与 #1/#2 重复）；con #1/#2（重复且为 mock，保 #3）。

**先在副本验证，再对生产库执行**（副本终态与生产一致）。

## 五 · 边界与声明

1. **只动派生视图**：参谋卡（hypotheses/contradictions）是**派生数据**，非账本事实；故不违反「账本不可变」（该铁律约束的是 predictions/events/claims 等账本链）。
2. **账本零改动**：predictions 1935 / verdicts 3662 前后一致，可复核。
3. **根因已修**：bug-27 已在代码侧修复（`p1b/src/routes/advise.js` 同日覆盖守卫 + 回归测试），**本清理不会复发**。
4. **未做**：未回填、未改任何账本行；未动其他局（局 2 无重复，未触碰）。

---

（清理收据完 · 2026-09-14 · 用户拍板 · 快照+脚本+收据三件套齐）
