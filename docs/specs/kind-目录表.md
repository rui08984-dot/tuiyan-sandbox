# kind 目录表（系统认识哪些题）

> **自动生成，勿手改**——`node p1b/scripts/kind-table.cjs`（任务 6 批次 3 / B1-2）。
> 来源：冻结契约表 `p1b/sim/out/g2-contract-frozen-r4.json`（sha256 `007b41188807…`，由 `g2-contract-verify.cjs` 保证与源码一致）＋ 账本 `p1a-terminal/data/p1a.db`（只读）＋ resolver 源码 `p1b/scripts/corpus-resolve.cjs`。
> 生成时点：2026-09-14T15:09:16.914Z｜kind 共 **52** 个（有账本行 51／仅契约 1）｜覆盖账本题 **1485**（已解 813）。

**怎么读这一页**：
- **取数源**＝账本实际出现的 URL 主机（回退：resolver 源码内联域名）。
- **必需参数 / 组**＝契约（`g2-contract-frozen-r4.json`）对该 kind 的 resolve 参数要求；组内为「至少一个」。
- **真值锚**＝该 kind 的 `resolve.kind` 指向本表 resolver，结算按**同源**重取 → 真值（与必需参数同一契约；日期型 kind 另有 `date_derivations` 派生规则）。
- **引擎**＝该 kind 在账本里落到的层与**读侧**引擎（引擎缺陷如实标注「未注册/需注记可解析」，不宣称能力）。
- **层:题数**＝账本层分布；**已解**＝`outcome ∈ {true,false}`。
- **源码位**＝resolver 在 `corpus-resolve.cjs` 的**当前**行位（契约表里的 `src` 是冻结时的旧行位，文件增长后会漂移，故只作对照）。

| kind | 取数源 | 必需参数 | 组（至少一） | 层:题数 | 引擎 | 题数 | 已解 | 源码位（现/契约冻结） | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| `openmeteo_air_daily_mean` | air-quality-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:128 | L3 基率+ACI（同上准入） | 128 | 64 | `L90-104（→_omHourlyMean）` | 别名 → `_omHourlyMean`（共享实现） |
| `dbnomics_series_value` | api.db.nomics.world | provider、dataset、series、period、threshold | — | L2:123 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 123 | 32 | `L29-38` | 有 date 派生规则 |
| `openmeteo_daily_max` | archive-api.open-meteo.com | lat、lon、date、threshold_c | — | L3:113 | L3 基率+ACI（同上准入） | 113 | 105 | `L21-28` |  |
| `openmeteo_forecast_daily_max` | archive-api.open-meteo.com | lat、lon、date、cmp、threshold_c | — | L3:98 | L3 基率+ACI（同上准入） | 98 | 98 | `L52-63` |  |
| `energycharts_daily_mean` | api.energy-charts.info | date、country、type、cmp、threshold | url_template 或 url | L2:64 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 64 | 32 | `L309-329` |  |
| `openmeteo_wx_daily` | archive-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:60 | L3 基率+ACI（同上准入） | 60 | 30 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `wikimedia_pageviews` | wikimedia.org | date、article、cmp、threshold | url_template 或 url | L2:53 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 53 | 27 | `L283-291` |  |
| `noaa_tide_daily_max` | api.tidesandcurrents.noaa.gov | date、station、cmp、threshold | url_template 或 url | L2:42 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 42 | 24 | `L209-217（→_noaaTideDailyHigh）` | 别名 → `_noaaTideDailyHigh`（共享实现） |
| `openmeteo_air_ozone_daily_mean` | air-quality-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:42 | L3 基率+ACI（同上准入） | 42 | 24 | `L90-104（→_omHourlyMean）` | 别名 → `_omHourlyMean`（共享实现） |
| `openmeteo_air_pm2_5_daily_mean` | air-quality-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:42 | L3 基率+ACI（同上准入） | 42 | 24 | `L90-104（→_omHourlyMean）` | 别名 → `_omHourlyMean`（共享实现） |
| `cwl_ssq_red_contains` | www.cwl.gov.cn | issue、ball | — | L5:39 | L5 认证源注册表（1 变体；样本命中：中国福利彩票·双色球（33 选 6）） | 39 | 19 | `L43-49` | 有 date 派生规则 |
| `dlt_draw_result` | webapi.sporttery.cn | issue | back_ball 或 front_max_ge | L5:38 | L5 认证源注册表（2 变体；样本命中：中国体育彩票·大乐透（后区 12 选 2）） | 38 | 0 | `L69-88` | 有 date 派生规则 |
| `binance_daily_close` | data-api.binance.vision | date、symbol、cmp、threshold | url_template 或 url | L2:36 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 36 | 11 | `L177-181` |  |
| `energycharts_public_power_daily_mean` | api.energy-charts.info | date、country、type、cmp、threshold | url_template 或 url | L2:35 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 35 | 20 | `L309-329（→energycharts_daily_mean）` | 别名 → `energycharts_daily_mean`（共享实现） |
| `openmeteo_air_pm10_daily_mean` | air-quality-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:35 | L3 基率+ACI（同上准入） | 35 | 10 | `L90-104（→_omHourlyMean）` | 别名 → `_omHourlyMean`（共享实现） |
| `openmeteo_archive_daily_sunshine_duration` | archive-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:32 | L3 基率+ACI（同上准入） | 32 | 32 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `openmeteo_archive_daily_wind_speed_10m_max` | archive-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:32 | L3 基率+ACI（同上准入） | 32 | 32 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `cwl_ssq_blue_odd` | www.cwl.gov.cn | issue | — | L5:31 | L5 认证源注册表（1 变体；样本命中：中国福利彩票·双色球（16 选 1）） | 31 | 11 | `L50-50` | 有 date 派生规则 |
| `dbnomics_bis_monthly_mean` | api.db.nomics.world | series、month、cmp、threshold | url_template 或 url | L2:28 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 28 | 14 | `L135-149（→_dbnMonthMean）` | 别名 → `_dbnMonthMean`（共享实现）；有 date 派生规则 |
| `openmeteo_archive_daily_precipitation_sum` | archive-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:28 | L3 基率+ACI（同上准入） | 28 | 28 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `ghcn_daily_tmax` | www.ncei.noaa.gov | date、station、cmp、threshold | url_template 或 url | L3:26 | L3 基率+ACI（同上准入） | 26 | 13 | `L218-224` |  |
| `npm_downloads_window` | api.npmjs.org | start、end、package、cmp、threshold | url_template 或 url | L2:26 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 26 | 7 | `L275-282` | 有 date 派生规则 |
| `dbnomics_wb_commodity_annual` | api.db.nomics.world | cmp、threshold | url_template 或 url；series 或 series_code；period 或 month 或 year | L2:24 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 24 | 24 | `L124-134（→_dbnPeriod）` | 别名 → `_dbnPeriod`（共享实现）；有 date 派生规则 |
| `eurostat_demo_pjan_annual` | ec.europa.eu | cmp、threshold | url_template 或 url；month 或 year | L2:24 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 24 | 16 | `L151-166（→_eurostatJsonstat）` | 别名 → `_eurostatJsonstat`（共享实现）；有 date 派生规则 |
| `kraken_daily_close` | api.kraken.com | date、pair、cmp、threshold | url_template 或 url | L2:24 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 24 | 15 | `L182-190` |  |
| `openmeteo_forecast_daily_sunshine_duration` | api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:24 | L3 基率+ACI（同上准入） | 24 | 0 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `openmeteo_forecast_daily_wind_speed_10m_max` | api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:24 | L3 基率+ACI（同上准入） | 24 | 0 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `openmeteo_forecast_daily_precipitation_sum` | api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:21 | L3 基率+ACI（同上准入） | 21 | 0 | `L105-122（→_omDaily）` | 别名 → `_omDaily`（共享实现） |
| `frankfurter_rate_range` | api.frankfurter.app | date、date_plus7、base、quote、cmp、threshold | url_template 或 url | L2:18 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 18 | 8 | `L199-207` |  |
| `usgs_nwis_daily_discharge` | waterservices.usgs.gov | date、site、cmp、threshold | url_template 或 url | L3:16 | L3 基率+ACI（同上准入） | 16 | 5 | `L225-233` |  |
| `elexon_fuelhh_daily_mean` | data.elexon.co.uk | date、fuel、cmp、threshold | url_template 或 url | L2:15 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 15 | 9 | `L293-300` |  |
| `github_weekly_commits` | api.github.com | url、week_start、repo、cmp、threshold | — | L2:15 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 15 | 6 | `L258-266` | 有 date 派生规则 |
| `noaa_tide_daily_high` | api.tidesandcurrents.noaa.gov | date、station、cmp、threshold | url_template 或 url | L2:15 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 15 | 5 | `L209-217（→_noaaTideDailyHigh）` | 别名 → `_noaaTideDailyHigh`（共享实现） |
| `delphi_fluview_ili` | api.delphi.cmu.edu | epiweek、cmp、threshold | url_template 或 url | L2:12 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 12 | 6 | `L168-175（→_delphiFlu）` | 别名 → `_delphiFlu`（共享实现）；有 date 派生规则 |
| `dbnomics_eurostat_unemployment_monthly` | api.db.nomics.world | cmp、threshold | url_template 或 url；series 或 series_code；period 或 month 或 year | L2:9 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 9 | 9 | `L124-134（→_dbnPeriod）` | 别名 → `_dbnPeriod`（共享实现）；有 date 派生规则 |
| `delphi_fluview_num_ili` | api.delphi.cmu.edu | epiweek、cmp、threshold | url_template 或 url | L2:9 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 9 | 6 | `L168-175（→_delphiFlu）` | 别名 → `_delphiFlu`（共享实现）；有 date 派生规则 |
| `openmeteo_marine_sst_daily` | marine-api.open-meteo.com | date、cmp、threshold | url_template 或 url | L3:8 | L3 基率+ACI（同上准入） | 8 | 4 | `L90-104（→_omHourlyMean）` | 别名 → `_omHourlyMean`（共享实现） |
| `cta_daily_total_rides` | data.cityofchicago.org | url、date、cmp、threshold | — | L2:7 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 7 | 4 | `L342-350` |  |
| `mlb_schedule_daily_total_runs` | statsapi.mlb.com | date、cmp、threshold | url_template 或 url | L2:7 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 7 | 4 | `L330-341` |  |
| `noaa_gml_co2_daily` | gml.noaa.gov | date、cmp、threshold | url 或 url_template | L3:7 | L3 基率+ACI（同上准入） | 7 | 2 | `L234-241` |  |
| `dbnomics_eurostat_tertiary_attain` | api.db.nomics.world | cmp、threshold | url_template 或 url；series 或 series_code；period 或 month 或 year | L2:6 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 6 | 6 | `L124-134（→_dbnPeriod）` | 别名 → `_dbnPeriod`（共享实现）；有 date 派生规则 |
| `eurostat_live_unemployment_monthly` | ec.europa.eu | cmp、threshold | url_template 或 url；month 或 year | L2:6 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 6 | 0 | `L151-166（→_eurostatJsonstat）` | 别名 → `_eurostatJsonstat`（共享实现）；有 date 派生规则 |
| `frankfurter_rate` | api.frankfurter.app | date、base、quote、cmp、threshold | url_template 或 url | L2:6 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 6 | 6 | `L191-198` |  |
| `noaa_solar_cycle_ssn_monthly` | services.swpc.noaa.gov | url、month、field_name、cmp、threshold | — | L3:6 | L3 基率+ACI（同上准入） | 6 | 4 | `L371-380（→swpc_solar_cycle_monthly）` | 别名 → `swpc_solar_cycle_monthly`（共享实现）；有 date 派生规则 |
| `swpc_solar_cycle_monthly` | services.swpc.noaa.gov | url、month、field_name、cmp、threshold | — | L3:6 | L3 基率+ACI（同上准入） | 6 | 4 | `L371-380` | 有 date 派生规则 |
| `crossref_week_total` | api.crossref.org | week_start、cmp、threshold | url_template 或 url | L2:5 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 5 | 2 | `L243-250` | 有 date 派生规则 |
| `nvd_cve_week_count` | services.nvd.nist.gov | week_start、cmp、threshold | url_template 或 url | L2:5 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 5 | 3 | `L251-257` | 有 date 派生规则 |
| `bom_weekend_top10_gross` | www.boxofficemojo.com | week、cmp、threshold | — | L2:4 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 4 | 2 | `L351-363` | 有 date 派生规则 |
| `jpl_cad_monthly_count` | ssd-api.jpl.nasa.gov | url、month、cmp、threshold | — | L3:4 | L3 基率+ACI（同上准入） | 4 | 2 | `L364-370` | 有 date 派生规则 |
| `openalex_works_count` | api.openalex.org | start、cmp、threshold | url_template 或 url | L2:4 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 4 | 4 | `L267-274` | 有 date 派生规则 |
| `eurostat_live_tertiary_attain` | ec.europa.eu | cmp、threshold | url_template 或 url；month 或 year | L2:3 | L2 基率引擎（Wilson，n≥30 且注记可解析） | 3 | 0 | `L151-166（→_eurostatJsonstat）` | 别名 → `_eurostatJsonstat`（共享实现）；有 date 派生规则 |
| `cwl_ssq_blue_odd_forward` | — | issue | — | — | —（无账本行 / 无引擎位） | 0 | 0 | `L64-64` | **无账本行**（在库契约/实现，未出题） |

**共享 helper 契约**（下划线开头，非独立题源 kind，被上面若干 kind 复用）：`_omHourlyMean`（L77-91）、`_omDaily`（L92-109）、`_dbnPeriod`（L111-121）、`_dbnMonthMean`（L122-136）、`_eurostatJsonstat`（L138-153）、`_delphiFlu`（L155-162）、`_noaaTideDailyHigh`（L196-204）

（本表由脚本生成 · 与 `docs/specs/参数表-人话版-v1.md`、`p1b/scripts/board.cjs` 同属「使用者友好面」 · 一切判据以契约表与 design 为准）
