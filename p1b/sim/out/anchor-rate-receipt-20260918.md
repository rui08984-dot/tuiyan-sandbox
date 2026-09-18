# 收据 · 票 A 步骤 2：**过锚率可测化**（候选留痕 ＋ 严格分母）· 2026-09-18（二十八）批

> 触发：用户令「可以继续吧」（承「全部按推荐」授权）⇒ 执行第 3 期**票 A 步骤 2**——让角色③／I1 的共同前置「**过锚率 ≥80%**」**真正可测**。
> 依据：`docs/sandbox/p1b/itest/p26-第3期开工-过锚率与厚格PREREG-PROGRESS.md`「阻断点」节（该率当前**算不出来**）。
> 边界：**零账本写**｜**默认关**（不传 flag ⇒ 出题器零行为变化）｜不改任何判据／PREREG／阈值语义。

## §1 问题（为什么要做）

角色③情景分支生成器与 I1 日历即题源的前置都是「**过锚率 ≥80%**」，但该率**在盘上算不出来**：

1. p1b 私有表 `intake_rejects`／`intake_questions` **均 0 行**（拒收门在生产从未留痕）；
2. 出题器 `corpus-sources-b4.cjs` 在「阈值不落基率带」等情形直接 `continue`（**被丢提议零留痕**）；
3. 拿现成候选池（`.rows.json`）算出来的率恒为**构造性 100%**——因为池里只有「已通过」的。

⇒ 前置**不是「未测」，而是「按现有仪器测不了」**；不先造通道，任何读数都是编的。

## §2 落地（两件，均 additive）

### 2.1 出题器候选留痕旁路（`p1b/scripts/corpus-sources-b4.cjs`）

- 新增 flag **`--record-candidates=<path>`**；**默认关** ⇒ 不传时**零行为变化**（`recDrop` 立即返回、不建数组、不写文件；落盘由 `if (REC_PATH)` 守卫）。
- 埋点：`emitSeries` 的**每条提议**（forward／backfill 两循环）＋ 系列级（`series_too_short`）＋ 构建器级（`builder_threw`／`no_rows`）。
- 产出形状：`{ candidates: [...产出 spec 的提议...], drops: [{stage, reason, …}], counts: {candidates, drops, proposed_total, drop_by_reason} }`
  · `candidates` 与既有 `.rows.json` 同形状 ⇒ 可直接被 `anchor-gate.cjs` 消费（它已认 `raw.candidates`）。

### 2.2 `anchor-gate.cjs` 增**严格分母**

- 输入含 `drops` ⇒ 额外给：`drops_total`／`drops_by_reason`／`proposed_total`／**`anchor_rate_strict`**（＝通过 ÷ **提议全集**）。
- **无 `drops` ⇒ 不输出 `anchor_rate_strict`**（防把「候选口径」当「严格口径」引用）。
- 语义：被丢的提议**没有 spec ⇒ 锚不可达** ⇒ 计入未过（这正是「生成题过锚率」该问的那一问）。

## §3 读数（首份**真·过锚率**；零账本写／零网络）

生成器实跑一次（`--record-candidates`，**dry-run 不写库**）：

| 口径 | 分母 | 通过 | **过锚率** |
|---|---|---|---|
| 候选口径（含 spec 的提议） | 416 | 410 | 98.56% |
| **严格口径（提议全集）** | **425**（416 ＋ 被丢 9） | 410 | **96.47%** |

**被丢 9 条按原因**：`threshold_not_in_band` **4**｜`insufficient_history` **4**｜`no_rows` **1**。
按 phase（候选口径）：forward 100.0%｜backfill 97.2%。未过全为 `leak` 6 条（＝§88 已登记的 `delphi` cutoff 语义错位，**维持＋披露**）。

## §4 ★口径边界（**引用者必读**：这个数**不能直接开角色③的票**）

| 票 | 前置 | 本读数是否满足 | 说明 |
|---|---|---|---|
| **I1 日历即题源** | 生成题过锚率 ≥80% | **同类可比**（**规则型确定性生成器**），96.47% 远高于 80% | 但 I1 的题源是**日历**、本件测的是**数据序列源**；要正式开票仍应在 **I1 自己的生成器**上跑一次（通道已就位，一条命令） |
| **角色③ 情景分支生成器** | 子题过锚率 ≥80% | ❌ **不可外推** | 角色③ 的提议来自 **LLM 分解**（结构文本），与本件的**规则型**提议**不是同一分布**——LLM 自由提议的落锚率可能**显著更低**。⇒ 仍需一次 **LLM 分解小批**（拆 N 个父题 ⇒ 子题过 Q0 的比率），判据沿用已冻结的 80% |

⇒ **本件交付的是「测量通道 ＋ 一个同类读数」，不是角色③ 的开票依据。** 这一条写死在此，防下一棒误引。

## §5 验证

| 项 | 结果 |
|---|---|
| 全量测试 | **529 → 531/531 绿** |
| 新回归锁 | `anchor-gate.test.cjs` **⑧**（含 drops ⇒ 严格分母；无 drops ⇒ **不得伪造** `anchor_rate_strict`）；`resolve-spec-derive.test.cjs` **⑥**（旁路**默认关**的静态不变量：`recDrop` 立即返回／落盘由 `if (REC_PATH)` 守卫／`REC_PATH` 写盘点恰 1 处） |
| 默认关实跑 | 不传 flag 跑出 `TOTAL=416 … bandViolations=0 slugDupes=0`，**未产留痕文件**（零行为变化） |
| 账本 | **零写**（未 `--confirm`；`.rows.json` 为重生成件，非账本） |

## §6 产物

| 件 | 路径 |
|---|---|
| 候选留痕（新） | `p1b/sim/out/candidate-trace-b4-20260918.json`（提议全集 425） |
| 过锚率读数（新） | `p1b/sim/out/anchor-rate-b4-20260918.{json,md}` |
| 改动 | `p1b/scripts/corpus-sources-b4.cjs`（旁路，默认关）｜`p1b/scripts/anchor-gate.cjs`（严格分母） |
| 测试 | `p1b/test/anchor-gate.test.cjs`（+1）｜`p1b/test/resolve-spec-derive.test.cjs`（+1） |

（收据完 · 2026-09-18（二十八）批 · 过锚率 96.47%（严格口径）· 测试 531/531 · 零账本写 · 角色③ 仍需 LLM 分解小批）
