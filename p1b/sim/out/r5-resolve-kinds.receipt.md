# corpus-resolve 新 kind 接入报告（2026-09-13 施工棒）

> 只改 `p1b/scripts/corpus-resolve.cjs`（+ 同文件内必要小函数）；未碰 key / 8787 / p1b/src/botc / checklist_hash；既有 7 个 resolver 逐字未改。
> 收据：`corpus-resolve-b4.dry.out`（dry-run）/ `corpus-resolve-b4.confirm.out`（confirm）/ `r5-node-test.out`（回归）

## 1. 根因确认（以库为准，不止队长列的 16 种）
- 抽取口径已核实：daemon L100-113 在运行时 `src.slice(0, src.indexOf('//RESOLVE-B2'))` 后 `new Function` 内联复用 **corpus-resolve.cjs 的 RESOLVERS**；原文件 RESOLVERS 仅 7 种。
- 库内实测：未结算 corpus 行 **1219**，涉及 **50** 个不同 kind；其中 **45 个 kind 无任何实现**（队长列的 16 种是子集）。
- ⚠ 本棒发现并修掉一个**会让 daemon 静默降级**的陷阱：新代码注释里若出现字面量 `//RESOLVE-B2`，daemon 的 `indexOf` 会提前截断 → 抽取到不完整的模块（resolvers 缺 helper）。已把注释改写为不含该字面量，并验证字面量锚点全文件唯一（第 414 行）。
- 顺带按队长要求把 L97 的混合文案拆开：`无 resolve 参数` 与 `kind 未注册，需实现：<kind>` 现在是两条不同日志，且 summary 新增 `unregistered=` 与 `unregistered-kinds:`。

## 2. 差集清单（45 个新实现 kind → 来源行号）
全部 50 个库内 kind 现均命中，**missing=0**（复核脚本 `_r5-coverage.cjs` 复刻 daemon 抽取机制，`registered_total=59`）：

| kind（库内条数） | 实现位置 |
|---|---|
| openmeteo_air_daily_mean(128) / pm2_5(42) / ozone(42) / pm10(35) / marine_sst(8) | 通用 `_omHourlyMean` @77，别名 @354-358 |
| openmeteo_wx_daily(60) / archive_daily_precipitation_sum(28) / sunshine_duration(32) / wind_speed_10m_max(32) / forecast_daily_*(21/24/24) | 通用 `_omDaily` @92，别名 @359-365 |
| energycharts_daily_mean(64) | @287；energycharts_public_power_daily_mean(35) 别名 @377 |
| wikimedia_pageviews(53) | @270 |
| noaa_tide_daily_max(42) | `_noaaTideDailyHigh` @196，别名 @376 |
| noaa_tide_daily_high(15) | 别名 @375 |
| binance_daily_close(36) | @164 |
| npm_downloads_window(26) | @262 |
| kraken_daily_close(24) | @169 |
| eurostat_demo_pjan_annual(24) | `_eurostatJsonstat` @138，别名 @370 |
| eurostat_live_tertiary_attain(3) / live_unemployment_monthly(6) | 别名 @371-372 |
| dbnomics_wb_commodity_annual(24) | `_dbnPeriod` @111，别名 @368 |
| dbnomics_bis_monthly_mean(28) | `_dbnMonthMean` @122，别名 @369 |
| dbnomics_eurostat_tertiary_attain(6) / unemployment_monthly(9) | 别名 @366-367 |
| ghcn_daily_tmax(23) | @205 |
| frankfurter_rate_range(18) | @186；frankfurter_rate(6) @178 |
| github_weekly_commits(15) | @245 |
| elexon_fuelhh_daily_mean(15) | @279 |
| delphi_fluview_ili(12) | `_delphiFlu` @155，别名 @373 |
| delphi_fluview_num_ili(9) | 别名 @374 |
| usgs_nwis_daily_discharge(10) | @212 |
| mlb_schedule_daily_total_runs(7) | @299 |
| cta_daily_total_rides(7) | @311 |
| swpc_solar_cycle_monthly(6) | @340；noaa_solar_cycle_ssn_monthly(6) 别名 @378 |
| nvd_cve_week_count(5) | @238 |
| crossref_week_total(5) | @230 |
| openalex_works_count(4) | @254 |
| noaa_gml_co2_daily(4) | @221 |
| jpl_cad_monthly_count(4) | @333 |
| bom_weekend_top10_gross(4) | @320 |

## 3. dry-run 收据（两轮：修复前 → 修复后）
| 轮次 | 可结算 | true/false | pending | fetch-fail | 失败构成 |
|---|---|---|---|---|---|
| dry #1（首轮） | 490 | 272 / 218 | 670 | **59** | wikimedia 27（HTTP 400+429）、energycharts 32（429） |
| dry #2（修后） | 529 | 285 / 244 | 673 | **17** | github 6（403 限速）、energycharts 6（429 残余）、delphi 5（429） |

首轮暴露两个真问题，均已定位并修（修后 dry 验证）：
1. **wikimedia_pageviews：{date} 必须是「去横线」形式**（模板 `daily/{date}00/{date}00`，占位符插入前已被 `replace(/-/g,'')` 处理过，与 NOAA 潮汐同类陷阱）→ 首轮 27 条 HTTP 400；改为 nodash 后 **27 条全部结算、0 失败**。
2. **429 限速**：Wikimedia / Energy-Charts / Delphi 连发即 429 → 新增 `getJsonRetry`（仅新 kind 使用，退避 1.5/3/4.5s；**不动既有 getJson 与既有 7 种**）→ energycharts 失败 32→6、delphi 5→0。

## 4. confirm 落库（`--confirm`）
- **resolved 534**（outcome **true 286 / false 248**）｜pending 674｜fetch-fail 11｜refused 0
- 全库已结算 predictions：**704 → 1238（+534）**
- 剩余 11 条 fetch-fail 全为限速/瞬时，**未写库**：github_weekly_commits 6（HTTP 403，api.github.com 无 token 限速 60/h，已在 b3 踩坑清单）、energycharts_daily_mean 4（429）、crossref_week_total 1（瞬时）

## 5. 验收项逐条对账（read-only 复核，非脚本自报）
| 验收项 | 结果 |
|---|---|
| 差集清单 kind→有无 resolver→行号 | ✅ 50/50 有 resolver，missing=0（§2 表） |
| **已过目标日未结算：433 → ?** | ✅ 按 evidence.phase 实测 **549 → 15**（-97.3%）；剩余 15 = energycharts 8 + github 6 + crossref 1，全部为限速/瞬时未写 |
| resolved 总数增长 | ✅ +534（704→1238） |
| outcome true/false 分布 | ✅ true 286 / false 248（本棒） |
| **2026-10/11 未发布的行必须仍 pending** | ✅ 全库「已结算且 resolve.date>=2026-10-01 或 resolve.month>=2026-10」= **0 条**；forward 相位未结算数 **502 → 502 未变**（无一条前瞻被误判） |
| 网络失败只跳过不写 | ✅ 11 条 fetch-fail 的 outcome/resolved_at 均仍为 NULL |
| `cd p1b && node --test` 不回归 | ✅ **pass 198 / fail 0 / EXIT=0**（`r5-node-test.out`） |
| 既有 7 种 resolver 逐字不改 | ✅ 未触碰其函数体；本次只新增 + 拆 L97 文案 + summary 增字段 |

### 5b. 按批次（evidence.kind）精确对账 —— 队长口径 433
| 批次 | 结算前未结算 | 结算后未结算 |
|---|---|---|
| wide_backfill | 225 | **1** |
| b4_backfill | 171 | **8** |
| b3_backfill | 37 | **6** |
| **合计** | **433** | **15（-96.5%）** |

（settlement 后仍 pending 的 8 条 b4_backfill = energycharts 与 crossref 限速；6 条 b3_backfill + 1 条 wide_backfill = github 403 限速）

## 6. 未覆盖 / 边界（如实说）
- 旧 7 种 resolver 里 `dbnomics_series_value` 91 条、`cwl_*` 46 条、`dlt_draw_result` 38 条、`openmeteo_daily_max` 13 条仍 pending —— 这些是**既有实现的行为**（观测未发布/期未开奖/archive 未入库），本棒按「不改既有」未动；如需清理需另开棒评估其 pending 判据是否过严。
- 本棒只做机械 resolve（零 LLM）；未改账本不可变守卫，`resolve-refused=0`。
- GitHub 6 条要等 core 限速窗口（60/h）重置后重跑同一脚本即可结清，无需改码。

口径一致性：取值/比较沿用批脚本字段描述（`cmp`+`threshold`），并与 `p1b/sim/out/b4-resolvecheck.json` 的 8/8 MATCH 对齐；未满整日/整周/整月的窗口一律 `pending`（不猜），网络失败只 `fetch-fail` 跳过不写。
