# 结算收据 · 09-22 例行结算（★3 条补结 · 零翻转成立）

> 批次：09-22 例行批 ｜ 日期：2026-09-22 ｜ 通道：例行（无需拍板）
> 结论：到期 34 条 ⇒ resolved **3**／pending 5／fail 5；已解 **1658 → 1661**

## §1 到期面

| 项 | 值 |
|---|---|
| 未解总数 | 336 |
| 今日已到期 | **34** |
| 按 kind | oddsapi_h2h 10／npm 7／elexon 4／cta 3／binance 3／(无kind) 2／nvd 1／mlb 1／cwl 2／crossref 1 |

## §2 safe-mutation 五步

| 步骤 | 执行 | 结果 |
|---|---|---|
| ① 写前指纹 | 六表 SQL 级 sha16 | predictions 1994／**12e723257f4338bf**；已解 **1658** |
| ② 两份快照 | VACUUM INTO ×2 | sha16 **935eee219087d94a**（逐位相同）|
| ③ 副本演练 | `--db=.scratch/p37/drill-work.db`（★等号形式）| **resolved=3** pending=5 fail=5；实打网 7 |
| ④ 生产写入 | daemon `--once --due-only --confirm` | **resolved=3**（与演练同数）|
| ⑤ 零翻转 | 写后 vs 快照 | **四表逐位相同**、行数不变（1994）、**恰 +3** |

## §3 补结明细（3 条，全为 L2 binance）

| id | 标的 | 09-21 收盘 | 阈值 | 结论 |
|---|---|---|---|---|
| 896 | BTCUSDT | 86620.00 | >= 95840.62 | **false** |
| 900 | ETHUSDT | 2776.19 | >= 3255.56 | **false** |
| 904 | SOLUSDT | 118.90 | >= 154.81 | **false** |

★ 三条均为「高于阈值」预测、实际远低于阈值 ⇒ 全 false（判定非恒真）。

## §4 未结明细（pending 5 ／ fail 5）

| kind | 状态 | 原因 |
|---|---|---|
| binance | pending 3 | UTC 日 2026-09-22 尚未收盘（**正常**，非失败）|
| elexon | pending 2 ／ fail 2 | pending＝「2026-09-22 尚未到」；fail＝**HTTP 403**（★已知地域封禁）|
| cta | fail 3 | **HTTP 403**（★已知地域封禁）|

★ cta/elexon 的 403 已在（四十四）批诊断确认为**地域/IP 层封禁**（环境事实，代码无法解决）。

## §5 读数前进

| 指标 | 前 | 后 |
|---|---|---|
| 已解 | 1658 | **1661** |
| L2 scored_n | 404 | **407** |
| L2 Brier | 0.2393 | **0.2384** |
| L1／L3／L5／L6 | 不变 | 不变 |
| 分域 | 29 格／可出结论 10 | **不变** |

## §6 vault 同步

`vault-sync --confirm`：insert 0／update 3 ⇒ **ok=true**（1994==1994、missing/orphan/diff 全 0）
★ 写前自动快照 `.scratch/backup/p1a-pre-vaultsync-2026-09-22T08-43-43-543Z.db`

## §7 测试门

**533/533 pass / 0 fail**
★ 首跑 1 红＝数据标记过期（combo 队列 1560 → **1563**，因本次 +3 推进读数）⇒ 按先例**带注更新**（注明「读数前进，非口径变更」）
★ 同步刷新依赖产物：`e2-combo-precheck-20260922`／`e2-r1-rules-20260922`／`thickcell-features-20260922`

## §8 产物

- 指纹 `.scratch/p37/fingerprint-before.json`
- 快照 `.scratch/p37/snap-baseline.db`／`snap-drill.db`（sha16 935eee219087d94a）
- 演练库 `.scratch/p37/drill-work.db`
- 读数件 `p1b/sim/out/stage4-run-five-layers-20260922.{json,out}`／`calibration-report-20260922.{json,md}`
- 日志 `p1b/sim/out/resolve-daemon.log`（本轮 round#1 行）

## §9 诚实边界

- 到期 34 条中**实际可结仅 3 条**；其余为正常 pending（5）与地域封禁 fail（5），另有未到期的跳过
- cta/elexon 的 fail **不可自愈**（地域封禁）⇒ 每日结算会持续报（已知边界，处置待拍板）
- 本次零代码改动（仅数据标记带注更新）
