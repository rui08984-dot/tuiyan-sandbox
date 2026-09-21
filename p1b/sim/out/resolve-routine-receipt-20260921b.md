# 收据 · 2026-09-21（（三十三）批）：frankfurter 4 条顺延题补结 ⇒ **★第 4 期放行门打开**

> 触发：定时任务 `automation-e8fcf0e6`（2026-09-21 22:08）——ECB 发布 09-21 参考汇率后自动执行。
> 边界：结算走 resolver 真网｜零 LLM｜8787 零接触｜safe-mutation 五步全走。

## §1 前置核实（数据已发布）

- **命令**：`fetch('https://api.frankfurter.app/2026-09-19..2026-09-25?from=USD&to=CNY')`
- **结果**：`{"2026-09-18":{"CNY":6.6976},"2026-09-21":{"CNY":6.6954}}` ⇒ **含 09-21** ✅（查询时刻 UTC 14:08）
- **背景**：这 4 条题的 `resolve.date=2026-09-20`（周日，ECB 不发）⇒ resolver 的**顺延**语义取 `>= date` 最早发布日＝09-21；ECB 于 14:00 UTC 发布该值 ⇒ 补结条件成立。

## §2 结算（safe-mutation 五步）

- **① 写前指纹**：predictions 1992/`48ea6b80b214f59f`｜games 88/`0650ef60ace0e385`｜verdicts 5156/`d18ba8758d2601fb`｜events 556｜claims 447｜players 334；MAX(id)=2007；resolved=**1646**。存档 `.scratch/p33/fingerprint-before.json`。
- **② 两份快照**：`snap-baseline.db`／`snap-drill.db`，sha 逐位相同 `9f610226827029fa…`。
- **③ 副本演练**：`--db=.scratch/p33/snap-drill.db --due-only --confirm` ⇒ **resolved=4／pending=3／fail=13**；零翻转＝差异**恰 4 行**（1965-1968）＋五表逐位相同。
- **④ 生产写入**：同命令 `--db=p1a-terminal/data/p1a.db` ⇒ 同数；**日志首行核对 db 路径**＝`p1a-terminal/data/p1a.db` ✅。
- **⑤ 零翻转核对**：行数不变（1992）＋差异**恰 4 行**（1965/1966/1967/1968，字段恰 resolved_at/outcome/resolve_note）＋**非本次结算行变化 0**＋五表逐位相同。
- **已解 1646 → 1650**。明细：

| id | outcome | note |
|---|---|---|
| 1965 | true | Frankfurter 2026-09-21 USD/CNY=6.6954（阈值 <= 6.7394） |
| 1966 | false | Frankfurter 2026-09-21 USD/CNY=6.6954（阈值 >= 6.773） |
| 1967 | true | Frankfurter 2026-09-21 USD/JPY=157.27（阈值 <= 159.09） |
| 1968 | false | Frankfurter 2026-09-21 USD/JPY=157.27（阈值 >= 161.89） |

- **vault-sync**：updated=4 ⇒ **diff 0／ok=true**；predictions 零改动。
- **fail 13**（外部源，非本批引入）：dlt HTTP 567 ×8／cta HTTP 403 ×3／elexon HTTP 403 ×2。

## §3 ★★第 4 期放行门：**已打开**

- **命令**：`stage4-run.cjs --text …20260921c.out --json …20260921c.json`
- **读数**：分域 29 格／**可出结论 10**（原 9）／薄格 19（原 20）
- **关键格 L2/frankfurter**：`scored_n` **29 → 33**（≥ min_n=30）｜Brier **0.2176**｜Δ(vs 0.5) = **−0.0324**｜CI[−0.0792, +0.0153]｜`conclusion_allowed: true`
- **五层**：L1 180/0.0000｜L2 **404**/0.2393｜L3 620/0.2386｜L5 40/0.1357｜L6 270/0.1755
- **★门判据**：蓝图 §2.4 第 4 期放行门＝「可出结论格数 ≥10」⇒ **10 ≥ 10 ⇒ 满足**。
- **诚实边界**：放行门是**三条**并列（≥10 格 ＋ 首份公开校准报告已发布 ＋ 天气前瞻 Δ 连续两季 CI 不含 0）——本批只兑现第一条；另两条未核（见 §5）。

## §4 测试门

- **首跑 2 红**（均为数据标记类，本次写入推进读数所致）：
  1. `e2-combo-precheck.test.cjs` 队列 1548 → **1552**（+4 条补结）
  2. `e2-r1-rules.test.cjs` 保留格 8 → **9**（★L2/frankfurter n=33 过线且 RES CI 下界 0.0145 > 0 ⇒ **有分辨力、未被降档**）
- **修法**：按先例带注更新（注明「读数前进，非口径变更」＋日期＋原因）＋补进应含格名单。
- **复跑**：**494/494 全绿**。
- ★**R1 保留格 vs 阶段 4 集合的分歧变化**：此前 8 vs 9（kraken 被 RES 降档）；现 **9 vs 10**（新增分歧格＝frankfurter，但它是**被保留**而非被降档）⇒ 分歧仍恰在 kraken 一格，冻结规则行为不变。

## §5 未覆盖 / 待办

- **第 4 期另两条放行门未核**：①首份公开校准报告已发布 ②天气前瞻 Δ 连续两季 CI 不含 0。
- 生成器缺陷（`corpus-thicken.cjs:372` 未过滤非发布日）**已登记未修**——本次 4 条是最后一批（全库 30 条仅这 4 条落周末）。
- 其它 kind 的预筛/安全门未逐个审计（承（三十二）批 notCovered）。

## §6 产物索引

- 指纹／快照：`.scratch/p33/`（`fingerprint-before.json`／`snap-baseline.db`／`snap-drill.db`）
- 读数件：`p1b/sim/out/stage4-run-five-layers-20260921c.{out,json}`
- 日志：`p1b/sim/out/resolve-daemon.log`（本批 round#1 行）
- 锚：`docs/sandbox/p1b/itest/p31-frankfurter顺延补结-20260921-PROGRESS.md`

（收据完 · 2026-09-21（三十三）批 · 补结 4 条（1646→1650）· ★第 4 期放行门第一条件达成：可出结论 10 格 · 测试 494/494）
