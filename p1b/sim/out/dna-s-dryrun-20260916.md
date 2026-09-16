# DNA S 维试标 · 分布披露（2026-09-16）

> **本件为**分布披露，非判据**；判据须 E1 PREREG 冻结后（12 §3 弃权条款为准）**
> 规则源：12-PREREG-E1-DNA加列S维-v1.md §1（已冻结 sha 1875382deddd6a5b…）；窗口来源：账本结局序列回退档（P0 范围；源侧快照重建留 E1）。
> 诚实边界：回退档结局可达时点晚于 cutoff，存在 look-ahead 风险 ⇒ 本件不冒充 E1 主口径读数。

## 标签分布
- 平稳：548
- 漂移：190
- 不可判：676
- 先验:恒平稳：378
- 剔除_L1：180

## 列联表（标签 × layer × domain × 系列；前 40 行）
| 标签 | 层 | 域 | 系列 | n |
|---|---|---|---|---|
| 先验:恒平稳 | L6 | werewolf_sim | (对局) | 270 |
| 平稳 | L3 | openmeteo | openmeteo_air_daily_mean | 128 |
| 漂移 | L2 | dbnomics | dbnomics_series_value | 99 |
| 先验:恒平稳 | L5 | cwl | (认证源) | 70 |
| 平稳 | L3 | openmeteo | openmeteo_forecast_daily_max | 70 |
| 平稳 | L3 | openmeteo | openmeteo_wx_daily | 60 |
| 平稳 | L2 | energycharts | energycharts_daily_mean | 60 |
| 平稳 | L3 | openmeteo | openmeteo_daily_max | 48 |
| 漂移 | L3 | openmeteo | openmeteo_daily_max | 45 |
| 先验:恒平稳 | L5 | dlt | (认证源) | 38 |
| 平稳 | L2 | wikimedia | wikimedia_pageviews | 37 |
| 不可判 | L2 | binance | binance_daily_close | 36 |
| 不可判 | L3 | openmeteo | openmeteo_air_pm10_daily_mean | 35 |
| 不可判 | L2 | frankfurter | frankfurter_rate_range | 30 |
| 不可判 | L2 | npm | npm_downloads_window | 30 |
| 不可判 | L2 | dbnomics | dbnomics_bis_monthly_mean | 28 |
| 不可判 | L3 | ghcn | ghcn_daily_tmax | 26 |
| 漂移 | L2 | dbnomics | dbnomics_wb_commodity_annual | 24 |
| 平稳 | L2 | noaa | noaa_tide_daily_max | 24 |
| 不可判 | L3 | openmeteo | openmeteo_forecast_daily_wind_speed_10m_max | 24 |
| 不可判 | L3 | openmeteo | openmeteo_forecast_daily_sunshine_duration | 24 |
| 不可判 | L2 | eurostat | eurostat_demo_pjan_annual | 24 |
| 平稳 | L3 | openmeteo | openmeteo_air_ozone_daily_mean | 23 |
| 平稳 | L3 | openmeteo | openmeteo_air_pm2_5_daily_mean | 22 |
| 不可判 | L2 | elexon | elexon_fuelhh_daily_mean | 21 |
| 不可判 | L3 | openmeteo | openmeteo_forecast_daily_precipitation_sum | 21 |
| 不可判 | L3 | openmeteo | openmeteo_daily_max | 20 |
| 不可判 | L2 | dbnomics | dbnomics_series_value | 20 |
| 不可判 | L2 | energycharts | energycharts_public_power_daily_mean | 20 |
| 不可判 | L3 | openmeteo | openmeteo_air_pm2_5_daily_mean | 18 |
| 不可判 | L3 | openmeteo | openmeteo_air_ozone_daily_mean | 18 |
| 不可判 | L2 | noaa | noaa_tide_daily_max | 18 |
| 不可判 | L2 | kraken | kraken_daily_close | 18 |
| 不可判 | L2 | wikimedia | wikimedia_pageviews | 16 |
| 不可判 | L3 | openmeteo | openmeteo_archive_daily_wind_speed_10m_max | 16 |
| 平稳 | L3 | openmeteo | openmeteo_archive_daily_wind_speed_10m_max | 16 |
| 不可判 | L3 | openmeteo | openmeteo_archive_daily_sunshine_duration | 16 |
| 平稳 | L3 | openmeteo | openmeteo_archive_daily_sunshine_duration | 16 |
| 不可判 | L3 | usgs | usgs_nwis_daily_discharge | 16 |
| 不可判 | L2 | github | github_weekly_commits | 15 |

## 集中度预检（漂移标签）
- L2/dbnomics：123（64.7%）
- L3/openmeteo：62（32.6%）
- L2/energycharts：5（2.6%）

（零写库 · 无旁路表 · 只读 dry-run · 无旁路表、无 DDL、无任何写库路径（旁路表留 E1；本件源码无写库参数））
