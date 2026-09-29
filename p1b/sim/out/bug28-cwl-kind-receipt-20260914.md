# bug-28 收据：cwl「蓝球为奇数」题 kind 误写 ⇒ 会错判 false（2026-09-14）

## 一句话

**v1 写入器把两 combo 的 kind 硬编码成同一个**，导致 3 行「蓝球为奇数」题带着 `kind=cwl_ssq_red_contains` + `ball=null` 入库；
解析器在该形态下 `indexOf(null)` **恒 -1 ⇒ 恒判 false**。**已确认 0 污染（3 行全部未 resolve）**，已修三处：代码护栏 / 写入器 / 数据。

## 一 · 病象与根因

| 项 | 内容 |
|---|---|
| 病象行 | `id=732`（2026106）、`id=734`（2026107）、`id=736`（2026108）——题面均是「双色球第 N 期**蓝球为奇数**」 |
| 实际 kind | `cwl_ssq_red_contains`（**红球**包含某球）＋ `ball: null` |
| 后果 | 解析器 `cwl_ssq_red_contains` 执行 `d.red.split(',').indexOf(null)` → **恒 -1 → 恒判 `false`**；上游一旦跑批即把**错误真值**写进账本 |
| 根因 | `p1b/scripts/corpus-forward.cjs:295`（v1 写入器）**硬编码** `kind: 'cwl_ssq_red_contains'`，仅按 combo 切 `ball`/`blue_odd`，**没切 kind** |

**对照（同库其他批次是对的）**：`corpus-forward-b2.cjs:168` / `corpus-forward-oct.cjs:294` 均按 combo 分流 kind
（`red07→cwl_ssq_red_contains(+ball)`；`blueodd→cwl_ssq_blue_odd`）——**同一 bug 只存在于 v1 写入器**，后续批次已自然规避。

## 二 · 污染核查（**关键：未发生**）

| 检查 | 结果 |
|---|---|
| 3 行的 `outcome` | 全部 `NULL`（**未 resolve**） |
| 3 行的 `resolved_at` / `resolve_note` | 全部 `NULL` |
| 全库 `resolve_note LIKE '%含 null%'` | **0 行**（即没有任何行被此路径判过） |

⇒ **零污染**。时序巧合：这 3 行的事件日 9/13–9/17，跑批尚未跑到它们；且 2026106 期虽已开奖，
但**在护栏加上之前，没人跑过 `--confirm`**。

> 顺带核实：若真按错路径判 id=732，会得 `false`；而其真值（2026106 blue=14，14 为偶数 ⇒「蓝球为奇数」= false）
> **恰好也是 false**——**这纯属巧合**（蓝球奇数概率本就 50%）。**不能因此认为"没修也没事"**：
> id=734/736 的期号若开出奇数蓝球，就会写成错误的 false。

## 三 · 修复（三处，缺一不可）

| # | 层 | 改动 |
|---|---|---|
| ① | **解析器护栏**（`p1b/scripts/corpus-resolve.cjs`） | `cwl_ssq_red_contains` 在 `ball` 为空时**拒判**：返回 `{reject: ...}`，**绝不产出 outcome**。新增 `rejected` 计数进 summary（可观测，防静默） |
| ② | **写入器**（`p1b/scripts/corpus-forward.cjs`） | kind 改为**按 combo 分流**（照 b2/oct 正确形态）：`blueodd→cwl_ssq_blue_odd`；`red07→cwl_ssq_red_contains(+ball:'07')` |
| ③ | **数据**（`p1b/scripts/fix-bug28-cwl-kind.cjs`） | 3 行的 `resolve` 改写为 `{kind:'cwl_ssq_blue_odd', issue}`（与题面一致，与其余 28 行同构） |

**修复前后（生产库实测）**：

| 项 | 前 | 后 |
|---|---|---|
| `cwl_ssq_blue_odd` 行 | 28 | **31** |
| `cwl_ssq_red_contains` 行 | 42（**含 3 行 ball=null**） | **39（ball=null = 0）** |
| `predictions` / `verdicts` | 1935 / 3662 | **1935 / 3662（不变）** |
| `integrity_check` | ok | **ok** |

**修后自证**（dry-run 复跑）：

```
[dry] would resolve id=732 -> false | cwl 官方 2026106 期 red=06,11,13,14,22,30 blue=14（blue 为奇数，机检）
pending id=734 cwl_ssq_blue_odd — 第 2026107 期未开奖
pending id=736 cwl_ssq_blue_odd — 第 2026108 期未开奖
```

⇒ id=732 现在走**正确路径**（读 blue 判奇偶），note 里带出真实开奖 `blue=14`，结论 `false` 与手算一致；
734/736 正确等待开奖（不再可能被误判）。

## 四 · 顺带修的可用性问题

`corpus-resolve.cjs` 原先**硬编码生产库路径**（`db.init()` 无参），既无法对临时库做回归测试，
也违反项目已有纪律「**db/路径参数须显式传，禁依赖默认值**」（见 commit `8e7e98c` 留痕）。
已补 `--db <path>`（additive，缺省行为不变）。

## 五 · 验证与留痕

- **回归测试 2 例**（`p1b/test/corpus-resolve-guard.test.cjs`）：缺 ball ⇒ REJECT 且**不产出 would resolve**；正确 kind 不受影响。
- **全量测试 242 → 244 全绿**。
- 快照：`.scratch/backup/p1a-pre-b28-20260914050218.db`（sha256 `5c9ce5af1e3787a7…`）。
- 先在**副本**验证、再对生产执行；账本事实（predictions/verdicts）零改动。
- 登记 `.dshwolf/buglog.json` bug-28。

## 六 · 教训（可复用）

1. **同一字段的多个变体，写入必须按变体分流，禁硬编码**——本项目已因同类问题吃过一次（F16 命名漂移），这是第二例。
2. **解析器的"默认值兜底"是危险的**：`indexOf(null)` 不报错、只恒假 → 静默错判。**宁可拒判，不可默认**。
3. **多 combo/多分支的场景，测试应覆盖每个分支的 kind 分流**（本轮补的测试即锁此点）。

---

（bug-28 收据完 · 2026-09-14 · 零污染 · 三处修复 · 244/244 绿）
