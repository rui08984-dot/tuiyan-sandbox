# 出题：一道配得上账本的题

> 本件只讲**怎么把一条断言变成账本里的一行**。判据本体在
> `docs/specs/万物分类清单-v2.md:6`（拒收门三问），可执行判定在 `p1b/scripts/anchor-gate.cjs`。
> 本件是它们的**读法**，不新增判据。

## 0. 一行账本由什么组成

一行 = **题面 + 冻结时点 + 判据 + 概率 + 真值锚 + 到期日**。少任何一样，它就进不了账本
（或进了也永远结算不了）。可执行样例见 `p1b/scripts/calendar-questions.cjs:170`–`p1b/scripts/calendar-questions.cjs:200`
（该处 `row` 对象的每个字段就是下面六项）。

| 组成 | 落在哪 | 反例（缺了会怎样） |
|---|---|---|
| 题面 `statement` | 一个能判真假的问句 | 「经济会怎样」——不是断言，无 outcome |
| 冻结时点 `meta.cutoff` | `p1b/scripts/calendar-questions.cjs:190` | 没 cutoff ⇒ Q0-2 **抽不出** ⇒ 记 `unverifiable` |
| 判据 `resolve` | kind / 阈值 / 比较方向 / 字段 | 没阈值 ⇒ 事后可调 ⇒ 等于没冻结 |
| 概率 `prob` / `baseRate` | 历史经验频率，非编造 | 编一个 0.5 ⇒ 基率是假的，读数全废 |
| 真值锚 `resolve.url_template` + `field` | 机械可解析的公开源 | 没有 ⇒ 判 `not_reachable`（注册 ≠ 可达） |
| 到期日 | 由证据**现推**，见 `dueof.md` | 推不出 ⇒ 永不进结算队列 |

## 1. 拒收门三问（先过这关，再谈层归属）

来源：`docs/specs/万物分类清单-v2.md:6`–`docs/specs/万物分类清单-v2.md:9`；
可执行判定 `p1b/scripts/anchor-gate.cjs:6`、`p1b/scripts/anchor-gate.cjs:7`、`p1b/scripts/anchor-gate.cjs:8`。

### Q0-1 真值锚够不够？（否则 `no_anchor`）

**通俗版**：等到期那天，**有没有一个不需要我、也不需要 LLM 的第三方页面上，有一个数能一比一判定真假？**

判定式（`p1b/scripts/anchor-gate.cjs:17` 的投影声明）：`resolve.kind` 在**现役 RESOLVERS** 中
∧（该解析器**自建 URL** ∨ spec 提供 `url`/`url_template`）∨ 显式 certifiedSource 声明（L5 语义）。

★ **注册 ≠ 可达**。kind 在解析器表里登记过，但如果 spec 没给 URL 而解析器又要 URL，
判 `not_reachable`——这批题在网络上**永远取不到数**。出题时自己核对：URL 模板我填了吗？

### Q0-2 cutoff 有没有泄漏？（否则 `leak`）

**通俗版**：我冻结判据的那一刻，**事件的答案是不是已经公开了？**

判定式（`p1b/scripts/anchor-gate.cjs:23`）：
- **forward 题**：cutoff **早于**事件日即可；
- **backfill 题**：cutoff **必须严格早于**事件日（v2 注记要求＝前一日）；
- 两条都**抽不出 cutoff** ⇒ `unverifiable`（单列，**禁静默当通过**：「我没观测到」≠「不存在」）。

**事件窗口起点**由 `eventWindowStart` 推（`p1b/scripts/anchor-gate.cjs:105`），取的是
**窗口的起点**而不是终点——周窗题用起、赔率题用开赛日、期号题用期首。

★ **本仓踩过的坑，逐字记在 `p1b/scripts/calendar-questions.cjs:88`**：
- v1「下一个即将发布的期」：`cutoff=09-21` 落在期窗内 ⇒ **leak**；
- v2「期已结束但数据未发布」：`month=2026-08, cutoff=09-21` ⇒ **仍 leak**（cutoff 晚于期起点）；
- v3 才对：**目标期必须整体晚于 cutoff**（期尚未开始）。

⇒ **出题时先问自己：目标期开始了吗？** 开始了就大概率 leak。

### Q0-3 结果会不会变？（否则 `tautology`）

**通俗版**：换个日期、换个城市，这个答案会不会还是同一个？会 ⇒ 重言式，拒收。

判定式（`p1b/scripts/anchor-gate.cjs:25`）：**基率 ∈ {0, 1}** ⇒ `tautology`。
例：「一夜狼首夜平安（无人死亡）」——规则重言式，不是可判定性问题。

★ **两把尺不许混**。项目出题器另用 **(0.15, 0.85) 红线**（`p1b/scripts/anchor-gate.cjs:40`），
那是**产题口阈**、不是拒收门判据；`p1b/scripts/anchor-gate.cjs:170` 把它**单列为 `inBand`**，
**并列披露、不混判据**。你报「过门」时，两个数要分开写。

## 2. 概率与基率：宁缺不编

`p1b/src/evidence/baseRate.js:29` 的纪律：**未知一律 null，禁编**。

- 文本注记里写「占 X%」「基率=v」，由 `p1b/src/evidence/baseRate.js` 的三套读序解析；
- 新行可直接落结构化字段 `evidence[i].baseRate = { p, n, k, kind, window, basis, cmp, threshold }`
  （`p1b/src/evidence/baseRate.js:21`），其中 **`n` 可以是 null**（未知），
  `kind` 取 `'empirical'`（历史频率）或 `'certified'`（认证值/组合数理论值）；
- 读端**优先结构化**，文本解析退为兜底；**旧行不动**。

★ 概率必须是**真实可算的**。`p1b/scripts/calendar-questions.cjs:178` 的 `prob_source` 字段
就是为此存在的——它把「这个 p 是从哪几条历史观测、哪个 q 分位算出来的」写在题上，
事后可复核。日历出题器的做法是：同 geo 历史观测不足 3 期就**如实跳过、不编**
（`p1b/scripts/calendar-questions.cjs:164`）。

## 3. 阈值从哪来（不许拍脑袋）

日历出题器的标准做法（`p1b/scripts/calendar-questions.cjs:166`–`p1b/scripts/calendar-questions.cjs:169`）：
取同源同量纲的历史观测 → 按 **q = 0.3 / 0.7 两个分位**各出一道 → 阈值＝该分位值。
分位数算不出来 ⇒ 记 drop、跳过（`no_quantile`），**不拿中位数糊弄**。

- 历史观测从**同族镜像 kind** 取（例如 dbnomics 镜像 vs live 直连，同源同量纲）——
  跨源混取会得到不可比的阈值。
- 比较方向（`>=` / `<=`）与阈值**一起冻结在 `resolve` 里**，事后不许改。

## 4. 入库前必跑

```bash
node p1b/cli 门禁 锚点 <候选.json>
```

- 位置参数必填（缺了退 2，见 `p1b/cli/index.cjs:217`）；
- **候选 0 条 ⇒ 退出码 3**（`p1b/scripts/anchor-gate.cjs:209`），不是 0；
- 读法与双口径见 `gate.md`。

★ **分母要分清**。`门禁 锚点` 同时给两个口径（`p1b/scripts/anchor-gate.cjs:214`）：
- **候选口径**：分母＝已通过的候选；
- **严格口径**：分母＝**提议全集**（`candidates` ＋ `drops`）——被丢的提议没有 spec ⇒ 锚不可达，**计入未过**。

## 5. 出题自检清单

- [ ] 题面是一个能判真假的问句，不是「趋势」「会不会」这类无 outcome 的描述。
- [ ] `meta.cutoff` 写了，且**目标期/事件日整体晚于 cutoff**（`p1b/scripts/calendar-questions.cjs:88` 的坑）。
- [ ] `resolve.kind` 在现役 RESOLVERS 里，**且 URL 模板或自建 URL 齐备**（Q0-1）。
- [ ] 阈值有来源（历史分位/官方口径），并写进了 `prob_source` 一类的可复核字段。
- [ ] 概率是**真实可算**的经验频率或认证值，不是拍的；算不出就写 null，不编。
- [ ] 结果会随实例变化（基率不在 {0,1}），且与 (0.15, 0.85) 红线的关系**分开披露**。
- [ ] 到期日能由证据**现推**推出来（推不出就是永久欠账，见 `dueof.md`）。
- [ ] 跑过 `node p1b/cli 门禁 锚点`，且报的是**两个口径**的分母。
