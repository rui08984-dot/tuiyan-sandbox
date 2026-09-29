# 例行结算收据 · 2026-09-19（（二十六）批）

> 触发＝交接件（第 19 份）§5 第 6 项「09-19 例行结算」（**例行通道，非拍板项**）；首验 09-18「空 URL 缺陷修复」。
> 规程＝p25 锚（09-18 结算棒）同款：指纹 → 两份快照 → 副本演练 → 生产写入 → 零翻转 → vault-sync → 读数刷新 → 稳定性自证。
> 工作目录 `.scratch/p26/`（复用 `.scratch/p25/` 三件参数化脚本：fingerprint.cjs／snapshot.cjs／diff-rows.cjs）。

## §1 起点盘点（读盘核对）

| 项 | 值 | 证据 |
|---|---|---|
| 工作区／HEAD | 干净／`6f10eed` | `git status --porcelain`／`git log --oneline -1` |
| 8787 | 未监听（netstat 命中 0） | 写库前记档纪律 |
| 写前指纹 | predictions 1992/`14c519537f3eeb03`｜verdicts 5156｜truth_vault 1992｜games 88｜events 556｜claims 447 | `.scratch/p26/fp-before.json` |
| ★与 09-18 写后比对 | **六表 sha 逐位相同** ⇒ 无第三方写入 | vs `.scratch/p25/fp-final.json` 全 MATCH |
| 已解／未解／到期面 | 1553／439／**105**（L2 42｜L3 57｜L5 6） | 同上（due=2026-09-19） |
| 修复层在位 | `resolve-spec-derive.test.cjs` 6/6 绿（修复＝commit `00f77a8`） | 写入前预检 |

到期面按 kind（前位）：openmeteo wind 16／sunshine 16／precip 14／frankfurter 15／ghcn 10／oddsapi 6／kraken 6／dlt 6／noaa_tide 5／npm 4／cta 3／elexon 2／co2 1／mlb 1。

## §2 safe-mutation 五步

1. **写前指纹**：见 §1（`.scratch/p26/fp-before.json`）。
2. **两份在线快照**（`VACUUM INTO`）：`p1a-baseline-resolve-20260919.db`（留存）＋`p1a-drill-resolve-20260919.db`（演练载体）⇒ 两份 sha256 **逐位相同** `3a6df36e67ccec99…`（6,062,080 B／六表行数与源一致／integrity ok）。
3. **副本演练**（`--db=` 等号形式，代理进程启动前设）：**resolved 44／pending 41（含预筛 7）／fail 6／refused 0／口径护栏 8／unsupported 0／实打网 56**；核验副本确被写（resolved 1553→1597）＋**生产未被写**（指纹与写前逐位相同）。
4. **生产写入**（不带 `--db`）：日志首行 `db=E:\music player\p1a-terminal\data\p1a.db` ✓ ⇒ **resolved 44／pending 41／fail 6，与演练逐项同数**。证据：`.scratch/p26/prod-run.out.txt`。
5. **零翻转核对**（`.scratch/p25/diff-rows.cjs`，逐表 PK 自证）：predictions **1992 行不变、恰 44 行不同**（变化字段恰为 `resolved_at`/`outcome`/`resolve_note`）；verdicts／truth_vault／games／events／claims **五表逐位相同**；integrity ok。证据：`.scratch/p26/diff-baseline-vs-prod.json`。

**确定性旁证**：drill vs prod 的差异**仅 resolved_at**（44 行，时刻差）；全部 1597 条已解行 **outcome/resolve_note 0 处不同** ⇒ 写入路径确定性。

## §3 已解 44 条明细（kind 分布）

| kind | 条数 | 备注 |
|---|---|---|
| openmeteo_forecast_daily_wind_speed_10m_max | 8 | L3 |
| openmeteo_forecast_daily_sunshine_duration | 8 | L3 |
| openmeteo_forecast_daily_precipitation_sum | 7 | L3 |
| kraken_daily_close | 6 | L2（★空 URL 修复件） |
| noaa_tide_daily_high | 5 | L2 |
| npm_downloads_window | 4 | L2（★空 URL 修复件） |
| ghcn_daily_tmax | 2 | L3 |
| elexon_fuelhh_daily_mean | 2 | L2 |
| noaa_gml_co2_daily | 1 | L2 |
| mlb_schedule_daily_total_runs | 1 | L2（★空 URL 修复件） |

## §4 ★空 URL 缺陷修复首验（本批核心看点）

- **kraken 6/6、npm 4/4、mlb 1/1 全部正常机检结算**——昨日之前它们是「Failed to parse URL」永久 fail。**本批空 URL 类 fail＝0**。
- **frankfurter**：URL 派生已生效，今日为**正常 pending**（ECB 发布窗口未走完，接口对未来区间 404）⇒ 待窗口走完自然结算（~09-20 起）。
- **dlt HTTP 567：fail 6**（预期内；不在空 URL 处置范围）。
- **★分域格数 8 → 9**：`L2/kraken` 可计分 24→**30**（n≥30 过线）＝修复的直接兑现。**第 4 期放行门（≥10）从「差 2」变「差 1」**（承 p25 更正段预测「kraken 09-19」如期兑现；frankfurter ~09-20／binance 10-01）。

## §5 读数前进（口径零变更）

| 层 | 09-18 | 09-19 | Brier |
|---|---|---|---|
| L1 | 180 | 180 | 0.0000（不变） |
| L2 | 374 | **385** | 0.2418 → **0.2392** |
| L3 | 563 | **589** | 0.2386 → **0.2378** |
| L5 | 38 | 38 | 0.1354（不变） |
| L6 | 270 | 270 | 0.1755（不变） |

分域 **29 格／可出结论 8 → 9**。读数件：`stage4-run-five-layers-20260919.{json,out}`／`u8-columns-20260919.*`／`calibration-report-20260919.{json,md}`。

## §6 稳定性自证（数据前进后重跑 E2 预检两件）

- **R1-A 改层仍 0**（no-op 1462／reassign 0／downgrade 37）。
- **L1×L6 ρ̂=0.011469（n=240）逐位相同**（CI 含 0，不停用不变）。
- **L2×L3 ρ̂≡1 判死不变**（n 937→974）；L2×L3×L5 ρ̂≡1（n=7）。
- **R1-B 保留 8 格不变**（降档 15，涉题 146→155）。
- **★RES 条款首次绑定（新事实，按冻结规则设计生效）**：`L2/kraken` n=30 过样本线，但 30 条 outcome **全 true** ⇒ RES CI 下界 ≤ 0（无分辨力）⇒ R1-B **降档**。⇒ 阶段 4「可出结论 9 格」与 R1-B「保留 8 格」**首次出现集合分歧**（差恰 kraken）。这是 E2 R1 rules v1（sha 前 8 位 `e0331cf8`）冻结条款的正常绑定，**非口径变更**；披露于 `e2-r1-rules-20260919.json`。

## §7 测试与数据标记（3 例红 → 带注更新 → 全绿）

全量首跑 **541 中 3 fail**，全部＝「数据标记/理由断言随合法数据前进过期」类（非回归）：

1. `e2-combo-precheck.test.cjs` 队列 **1455 → 1499**（+44；加注「09-19（二十六）批再结 44 条（含空 URL 修复件首验）」）。
2. `thickcell-replay.test.cjs` 池 **607 → 630**（加注：+23 恰＝今日 L3 openmeteo 三 kind 新解数（wind 8/sunshine 8/precip 7）；kraken 等非厚格注册域不入池；walk-forward 时间前进，非口径变更）。
3. `e2-r1-rules.test.cjs` 降档理由断言由「必须 n<30」扩为「n<30 或 RES 无分辨力」两类（加注：RES 条款 09-19 起首次绑定，L2/kraken；保留格仍 8，与阶段 4 分歧 9 vs 8 已在注中说明）。

⇒ **541/541 pass / 0 fail**。

## §8 过程自查（本批新坑 2 条，第 2 条已修）

- **★坑 1「无输出路径的读数刷新＝只打印不落盘」**：`stage4-run.cjs` 的 `--text/--json` 是**显式输出路径参数**（board.cjs 内注有生成命令），首跑不带参数 ⇒ 只打 stdout、`sim/out` 无 20260919 件 ⇒ `calibration-report` 读到的 stage4 件停在 **09-14** 陈旧版。若据此报「分域格数」会拿到旧值。修法＝照 board.cjs 注明命令带路径重刷（顺序：five-layers → u8 → calibration-report → board）。纪律＝**刷读数后必核产物文件时间戳**（昨日坑「board 读最新真跑件」的姊妹坑：这次是「刷新动作本身没落盘」）。
- **★坑 2「默认输出文件名写死日期 ⇒ 用当天数据覆盖昨日命名件」**（落盘审计时从 git status 抓到）：`thickcell-features.cjs` 的默认输出名**写死 `thickcell-features-20260918.{json,md}`** ⇒ 今天任何一次跑（**含跑测试**，测试无 `--json` 时落默认路径）都在用**今天的池数据**覆写**昨天命名**的留档件（实测：0918 文件名内被写成池 630 的今日内容）。同病：`thickcell-replay.cjs` 的 `thickcell-knn-20260918.json`／`thickcell-replay-selftest-20260918.json` 两处默认名。
  · **处置（已修，零判据/零账本/零读数变化）**：两脚本三处默认名改**运行时 UTC 日期戳**（`new Date().toISOString().slice(0,10)`）；被覆写的 `thickcell-features-20260918.md` 用 `git checkout --` **复原昨日留档**；重跑生成正确命名的 `thickcell-features-20260919.{json,md}`；修后全量 **541/541 绿**。
  · **纪律**：**脚本默认输出名一律运行时日期戳，禁止写死生成日的日期**（与「测试不得写死产物文件名日期」是同一枚硬币的两面：测试写死⇒跨日必红；脚本写死⇒跨日覆写留档）。

## §9 vault-sync 与边界

- vault-sync：dry-run diff=44 ⇒ `--confirm`（自动快照 `.scratch/backup/p1a-pre-vaultsync-2026-09-19T13-39-59-206Z.db` sha256 `fa6efd47f0059bfe…`）⇒ **updated=44**、after **diff 0／ok=true／predictions 零改动=true**；复验 dry-run plan 全 0。
- 边界：账本写入仅例 行结算 44 行（零翻转五步全程留痕）；零 LLM；网络仅 resolver 取数（代理进程启动前设）；8787 零接触；演练载体 drill 快照批后删除（一次性件），baseline 快照留存。

## §10 产物索引

- 指纹/快照/演练/生产/零翻转：`.scratch/p26/fp-before.json`／`p1a-baseline-resolve-20260919.db`／`p1a-drill-resolve-20260919.db`（批后删）／`drill-run.out.txt`／`prod-run.out.txt`／`diff-baseline-vs-prod.json`
- 读数件：`p1b/sim/out/stage4-run-five-layers-20260919.{json,out}`／`u8-columns-20260919.*`／`calibration-report-20260919.{json,md}`／`e2-combo-precheck-20260919.*`／`e2-r1-rules-20260919.*`／`thickcell-features-20260919.{json,md}`／本收据
- 锚：`docs/sandbox/p1b/itest/p27-例行结算-20260919-PROGRESS.md`

（收据完 · 2026-09-19（二十六）批 · 已解 1553→1597 · vault ok · 分域 8→9 · 测试 541/541）
