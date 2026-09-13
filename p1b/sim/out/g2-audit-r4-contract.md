# ② 抽检 · required-keys 契约 × 抽检样本对照（R4 · 2026-09-13）

> 契约来源：corpus-resolve.cjs 已注册 kind（抽取 52 个）+ 全 R4 行观测键交集；未注册 kind 退回通用判据并标注。
> 用途：复核 machine 段逐题判据；required 为契约键，缺失 为空即契约满足。

## 一 · required-keys 表（逐 kind，共 51 个）
| kind | n(全 R4 池) | required keys |
|---|---|---|
| binance_daily_close | 36 | cmp, date, end_ms, field, kind, start_ms, symbol, threshold, url_template |
| bom_weekend_top10_gross | 4 | cmp, field, kind, threshold, url_template, week |
| crossref_week_total | 5 | cmp, field, kind, threshold, url_template, week_start |
| cta_daily_total_rides | 7 | cmp, date, field, kind, threshold, url |
| cwl_ssq_blue_odd | 28 | issue, kind |
| cwl_ssq_red_contains | 42 | ball, issue, kind |
| dbnomics_bis_monthly_mean | 28 | cmp, field, kind, month, series, threshold, url_template |
| dbnomics_eurostat_tertiary_attain | 6 | cmp, field, kind, series_code, threshold, url_template, year |
| dbnomics_eurostat_unemployment_monthly | 9 | cmp, field, kind, month, series_code, threshold, url_template |
| dbnomics_series_value | 123 | cmp, dataset, kind, period, provider, series, threshold |
| dbnomics_wb_commodity_annual | 24 | cmp, field, kind, series_code, threshold, url_template, year |
| delphi_fluview_ili | 12 | cmp, epiweek, field, kind, region, threshold, url |
| delphi_fluview_num_ili | 9 | cmp, epiweek, field, kind, region, threshold, url_template |
| dlt_draw_result | 38 | issue, kind |
| elexon_fuelhh_daily_mean | 15 | cmp, date, field, fuel, kind, threshold, url_template |
| energycharts_daily_mean | 64 | cmp, country, date, field, kind, threshold, type, url_template |
| energycharts_public_power_daily_mean | 35 | cmp, country, date, field, kind, threshold, type, url_template |
| eurostat_demo_pjan_annual | 24 | cmp, field, geo, kind, threshold, url, year |
| eurostat_live_tertiary_attain | 3 | cmp, field, geo, kind, threshold, url_template, year |
| eurostat_live_unemployment_monthly | 6 | cmp, field, geo, kind, month, threshold, url_template |
| frankfurter_rate | 6 | base, cmp, date, field, kind, quote, threshold, url_template |
| frankfurter_rate_range | 18 | base, cmp, date, date_plus7, field, kind, quote, threshold, url_template |
| ghcn_daily_tmax | 23 | cmp, date, field, kind, station, threshold, url_template |
| github_weekly_commits | 15 | cmp, field, kind, repo, threshold, url, week_end, week_start |
| jpl_cad_monthly_count | 4 | cmp, field, kind, month, threshold, url |
| kraken_daily_close | 24 | cmp, date, field, kind, pair, threshold, url_template |
| mlb_schedule_daily_total_runs | 7 | cmp, date, field, kind, threshold, url_template |
| noaa_gml_co2_daily | 4 | cmp, date, field, kind, threshold, url |
| noaa_solar_cycle_ssn_monthly | 6 | cmp, field, kind, month, threshold, url |
| noaa_tide_daily_high | 15 | cmp, date, field, kind, station, threshold, url_template |
| noaa_tide_daily_max | 42 | cmp, date, field, kind, station, threshold, url_template |
| npm_downloads_window | 26 | cmp, end, field, kind, package, start, threshold, url_template |
| nvd_cve_week_count | 5 | cmp, field, kind, threshold, url_template, week_start |
| openalex_works_count | 4 | cmp, end, field, kind, start, threshold, url |
| openmeteo_air_daily_mean | 128 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_air_ozone_daily_mean | 42 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_air_pm10_daily_mean | 35 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_air_pm2_5_daily_mean | 42 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_archive_daily_precipitation_sum | 28 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_archive_daily_sunshine_duration | 32 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_archive_daily_wind_speed_10m_max | 32 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_daily_max | 113 | cmp, date, kind, lat, lon, threshold_c |
| openmeteo_forecast_daily_max | 98 | cmp, date, kind, lat, lon, threshold_c |
| openmeteo_forecast_daily_precipitation_sum | 21 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_forecast_daily_sunshine_duration | 24 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_forecast_daily_wind_speed_10m_max | 24 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_marine_sst_daily | 8 | cmp, date, field, kind, lat, lon, threshold, url_template |
| openmeteo_wx_daily | 60 | cmp, date, field, kind, lat, lon, threshold, url_template |
| swpc_solar_cycle_monthly | 6 | cmp, field, field_name, kind, month, threshold, url |
| usgs_nwis_daily_discharge | 10 | cmp, date, field, kind, site, threshold, url_template |
| wikimedia_pageviews | 53 | article, cmp, date, field, kind, threshold, url_template |

## 二 · 抽检样本对照（105 条）
| id | kind | 注册 | required keys | 缺失 | machine | strict4 |
|---|---|---|---|---|---|---|
| 466 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 476 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 480 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 486 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 490 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 524 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 540 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 542 | openmeteo_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 632 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 639 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 643 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 666 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 667 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 668 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 685 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 703 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 713 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 718 | openmeteo_forecast_daily_max | REG | cmp, date, kind, lat, lon, threshold_c | — | PASS | - |
| 880 | openmeteo_air_pm10_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 885 | openmeteo_air_pm10_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 893 | binance_daily_close | REG | cmp, date, end_ms, field, kind, start_ms, symbol, threshold, url_template | — | PASS | S4 |
| 900 | binance_daily_close | REG | cmp, date, end_ms, field, kind, start_ms, symbol, threshold, url_template | — | PASS | S4 |
| 919 | wikimedia_pageviews | REG | article, cmp, date, field, kind, threshold, url_template | — | PASS | S4 |
| 948 | frankfurter_rate_range | REG | base, cmp, date, date_plus7, field, kind, quote, threshold, url_template | — | PASS | S4 |
| 981 | openmeteo_air_pm10_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 985 | openmeteo_air_pm10_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 988 | binance_daily_close | REG | cmp, date, end_ms, field, kind, start_ms, symbol, threshold, url_template | — | PASS | S4 |
| 1008 | wikimedia_pageviews | REG | article, cmp, date, field, kind, threshold, url_template | — | PASS | S4 |
| 1090 | cta_daily_total_rides | REG | cmp, date, field, kind, threshold, url | — | PASS | S4 |
| 1109 | ghcn_daily_tmax | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1125 | elexon_fuelhh_daily_mean | REG | cmp, date, field, fuel, kind, threshold, url_template | — | PASS | S4 |
| 1129 | elexon_fuelhh_daily_mean | REG | cmp, date, field, fuel, kind, threshold, url_template | — | PASS | S4 |
| 1137 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1139 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1140 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1158 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1173 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1177 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1180 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1186 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1189 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1192 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1193 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1198 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1201 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1212 | openmeteo_air_pm2_5_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1215 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1220 | openmeteo_air_ozone_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1224 | noaa_tide_daily_max | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1225 | noaa_tide_daily_max | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1246 | noaa_tide_daily_max | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1254 | noaa_tide_daily_max | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1255 | noaa_tide_daily_max | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1274 | openmeteo_forecast_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1286 | openmeteo_archive_daily_precipitation_sum | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1296 | openmeteo_forecast_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1311 | openmeteo_forecast_daily_precipitation_sum | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1331 | openmeteo_forecast_daily_precipitation_sum | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1356 | openmeteo_archive_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1370 | openmeteo_archive_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1372 | openmeteo_forecast_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1387 | openmeteo_forecast_daily_precipitation_sum | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1391 | openmeteo_archive_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1394 | openmeteo_forecast_daily_wind_speed_10m_max | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1421 | openmeteo_forecast_daily_sunshine_duration | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1452 | energycharts_public_power_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1458 | energycharts_public_power_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1482 | kraken_daily_close | REG | cmp, date, field, kind, pair, threshold, url_template | — | PASS | S4 |
| 1485 | kraken_daily_close | REG | cmp, date, field, kind, pair, threshold, url_template | — | PASS | S4 |
| 1490 | kraken_daily_close | REG | cmp, date, field, kind, pair, threshold, url_template | — | PASS | S4 |
| 1493 | kraken_daily_close | REG | cmp, date, field, kind, pair, threshold, url_template | — | PASS | S4 |
| 1535 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1536 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1560 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1578 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1584 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1587 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1590 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1595 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1600 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1612 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1617 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1627 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1631 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1633 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1642 | openmeteo_air_daily_mean | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1654 | openmeteo_wx_daily | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1695 | openmeteo_wx_daily | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1698 | openmeteo_wx_daily | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |
| 1719 | noaa_tide_daily_high | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1722 | ghcn_daily_tmax | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1729 | ghcn_daily_tmax | REG | cmp, date, field, kind, station, threshold, url_template | — | PASS | S4 |
| 1739 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1753 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1755 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1772 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1776 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1780 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1792 | energycharts_daily_mean | REG | cmp, country, date, field, kind, threshold, type, url_template | — | PASS | S4 |
| 1796 | binance_daily_close | REG | cmp, date, end_ms, field, kind, start_ms, symbol, threshold, url_template | — | PASS | S4 |
| 1799 | binance_daily_close | REG | cmp, date, end_ms, field, kind, start_ms, symbol, threshold, url_template | — | PASS | S4 |
| 1835 | frankfurter_rate_range | REG | base, cmp, date, date_plus7, field, kind, quote, threshold, url_template | — | PASS | S4 |
| 1839 | frankfurter_rate_range | REG | base, cmp, date, date_plus7, field, kind, quote, threshold, url_template | — | PASS | S4 |
| 1846 | frankfurter_rate_range | REG | base, cmp, date, date_plus7, field, kind, quote, threshold, url_template | — | PASS | S4 |
| 1882 | openmeteo_marine_sst_daily | REG | cmp, date, field, kind, lat, lon, threshold, url_template | — | PASS | S4 |

## 三 · ④ 覆盖缺口（缺 baseRateNote，不影响 ②）
count=8 ｜ ids=466,476,480,486,490,524,540,542 ｜ kinds=openmeteo_daily_max

（对照表完 · 生成 2026-09-13T07:29:01.371Z）
