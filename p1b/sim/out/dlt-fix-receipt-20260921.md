# 修复收据 · 09-21（四十三）批 · dlt 反爬根因修复（★38 条全部未解 → 补结 8 条）

> 批次：（四十三）批 ｜ 日期：2026-09-21 ｜ 依据：`dlt专项诊断-20260921.md`（四十二批）
> 结论：**dlt resolver 显式传 Referer** ⇒ 已到期 8 条**全部补结**；L5/dlt 首次出数（n 0→8）

## §1 修复内容（最小改动）

`p1b/scripts/corpus-resolve.cjs` 的 `dlt_draw_result`：

```diff
- const j = await getJson(u);
+ const j = await getJson(u, { Referer: 'https://static.sporttery.cn/' });
```

**为何是最小改动**：不改 daemon 的全局 `UA_DEFAULT`（那会影响全部 **61** kind，须评估全部站点）。
只改 dlt 一个 resolver 的一次调用 ⇒ 影响面**仅此一个 kind**。

## §2 根因回顾（诊断件结论）

| 请求头 | 结果 |
|---|---|
| curl 默认 / node fetch 默认（无 UA） | **200** ✓ |
| 浏览器 UA（裸） | **567** ✗ |
| **浏览器 UA + Referer** | **200** ✓ |
| 非浏览器 UA | **200** ✓ |

⇒ sporttery 对「浏览器 UA」要求**完整浏览器头上下文**；daemon L74 强制注入浏览器 UA ⇒ 恰好触发反爬。

## §3 safe-mutation 五步

| 步骤 | 执行 | 结果 |
|---|---|---|
| ① 写前指纹 | 六表 SQL 级 sha16 | 与（四十一）批快照**逐位相同**（无第三方写入）|
| ② 两份快照 | 沿用（四十一）批 `snap-baseline.db`／`snap-drill.db`（sha16 60c96100ef4ad72a） | ✓ |
| ③ 副本演练 | `.scratch/p36/drill2.db` | **resolved=8** pending=3 fail=5（★修复前为 resolved=0 fail=13）|
| ④ 生产写入 | daemon `--once --due-only --confirm`（默认库） | **resolved=8**（与演练逐项同数）|
| ⑤ 零翻转 | 写后 vs 快照 | **五表逐位相同**、predictions 行数不变（1994）、恰 8 行变化 |

## §4 补结明细（8 条，全部有真实开奖数据）

| id | 期号 | 结论 | 判据 |
|---|---|---|---|
| 841 | 26105 | false | 后区含 01（实际 09 12）|
| 842 | 26106 | false | 后区含 01（实际 04 06）|
| 843 | 26107 | false | 后区含 01（实际 04 10）|
| 844 | 26108 | **true** | 后区含 01（实际 **01** 04）|
| 857 | 26105 | **true** | 前区最大 ≥ 30（实际 34）|
| 858 | 26106 | false | 前区最大 ≥ 30（实际 28）|
| 859 | 26107 | false | 前区最大 ≥ 30（实际 22）|
| 860 | 26108 | **true** | 前区最大 ≥ 30（实际 35）|

★**双向判定**（true 4／false 4）⇒ 证明判定不是恒真/恒假。

## §5 剩余 dlt 状态

| 项 | 值 |
|---|---|
| dlt 总行 | 38 |
| 已结 | **8** |
| 未结 | 30（**全部未到期**，等开奖）|
| 已到期未结 | **0** ✓ |

⇒ **已到期的 dlt 全部结清**；剩余为正常等待。

## §6 读数前进

| 指标 | 修复前 | 修复后 |
|---|---|---|
| L5 scored_n | 40 | **48** |
| L5 Brier | 0.1357 | **0.1517** |
| **L5/dlt 格** | n=0（不出数） | **n=8** |
| 分域格数 | 29 | 29 |
| 可出结论 | 10 | 10 |

★ L5/dlt n=8 **仍 < 30**（不出结论，符合纪律）；不影响放行门（门已达成）。

## §7 vault 同步

`vault-sync --confirm`：insert 2／update 8 ⇒ **vault ok=true**（1994==1994、missing/orphan/diff 全 0）
★ 写前自动快照 `.scratch/backup/p1a-pre-vaultsync-2026-09-21T15-34-10-641Z.db`

## §8 测试

**532/532 pass / 0 fail**（新增 4 例 `dlt-referer.test.cjs`：①静态锁 Referer ②**对照证明**（实测裸 UA 确为 567——若服务端规则变了此测试会红，提醒复核锁是否仍需要）③行为锁双向 ④最小改动锁）

## §9 ★诚实边界

- 只验证了 dlt **一个**域；**cta/elexon 的 403 未做同深度诊断**（它们是 403 非 567，机制可能不同）
- 567 是否随时间/频次变化**未验证**（本次只测一个时刻）
- Referer 方案依赖 sporttery 的当前规则；若其改规则须重诊
- L5/dlt n=8 仍远低于 30 线 ⇒ **不出结论**（不因"修好了"就放宽判据）

## §10 产物

- 诊断件 `.scratch/p36/dlt专项诊断-20260921.md`
- 收据 `p1b/sim/out/resolve-routine-receipt-20260921c.md`（前批）＋ 本件
- 读数件 `p1b/sim/out/stage4-run-five-layers-20260921d.{json,out}`／`calibration-report-20260921.{json,md}`
- 测试 `p1b/test/dlt-referer.test.cjs`
