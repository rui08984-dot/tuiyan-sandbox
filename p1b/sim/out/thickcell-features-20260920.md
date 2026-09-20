# 厚格四臂 · 特征可得性审计（2026-09-18）

> 生成器 `p1b/scripts/thickcell-features.cjs`｜池口径**复用** `thickcell-replay.buildPool()`（同一实现）｜**零账本写／零 LLM／零网络**。
> ★本件的 feasible／insufficient／blocked 门槛 **60%** 是**实现前置的操作化门槛，不是判据**（判据在 PREREG §3）。

**池**（PREREG §1 规则派生）＝ **653** 题（域 ∈ {openmeteo, dbnomics} ∧ 层 ∈ {L2,L3} ∧ 已解 ∧ 可计分）。

## §1 特征覆盖率

| 特征 | 覆盖 | 占比 |
|---|---|---|
| resolve.kind（题类型） | 653/653 | 100.0% |
| resolve.lat/lon（站点坐标＝城市气候协变量代理） | 574/653 | 87.9% |
| resolve.date（日序→可派生月序） | 574/653 | 87.9% |
| resolve.period（月/期键） | 32/653 | 4.9% |
| resolve.threshold（题面阈值） | 540/653 | 82.7% |
| baseRate 对象 | 538/653 | 82.4% |
| baseRate 含 n 与 k（格基率＋样本量） | 538/653 | 82.4% |
| forecast 带数值（**已发布高频观测**；MOS 所需） | 17/653 | 2.6% |
| resolve.series（dbnomics 序列 ID） | 46/653 | 7.0% |
| meta.phase（forward/backfill） | 508/653 | 77.8% |

## §2 四臂实现前置判定

| 臂 | 约束特征（最弱一环） | 覆盖 | 判定 | 备注 |
|---|---|---|---|---|
| kNN 基率（§4） | baseRate 含 n 与 k（格基率＋样本量） | 82.4% | ✅ **可做** | ★PREREG §4 原文的「**(可用的)滞后值**」维：**账本不存序列值** ⇒ 该维**缺席**（须显式声明） |
| MOS 统计订正（§4，附加 4 城一致 ≥3/4） | forecast 带数值（**已发布高频观测**；MOS 所需） | 2.6% | ⚠ 前提不足 | ★所用**已发布高频观测**（`forecast` 数值）覆盖率极低 ⇒ 见下判定 |
| Granger 滞后（§4，不产因果图） | resolve.series（dbnomics 序列 ID） | 7.0% | ⚠ 前提不足 | ★★**根本缺口**：VAR 需要**同源序列的历史值**，而账本**只存基率汇总（p/n/k）与阈值，不存序列** ⇒ 零覆盖 |
| nowcast（§4；P1/P2/P3） | meta.phase（forward/backfill） | 77.8% | ✅ **可做** | ★P2「空窗层」＝真值未发布且桥接窗口非空 ⇒ 需**先测覆盖率**（PREREG §9④ 已登记未测） |

## §2.5 ★账本**根本不存在**的字段（**不是覆盖率低，是「一条都没有」**）

> 这张表与 §1 分开列：覆盖率表里写 `0.0%` 会被误读成「罕见」，而真相是「**该数据从未入库**」——
> 前者可等数据长出来，**后者只能改采集/联网关**。

| 缺失项 | 消费者 | 为什么取不到 |
|---|---|---|
| **同源序列的历史值（VAR 滞后项 / kNN 滞后维所需）** | granger_lag（VAR 滞后选择）／knn（PREREG §4 的「可用的滞后值」维） | 账本 evidence 只存**基率汇总**（`baseRate{p,n,k}`）与**阈值**，**不存序列本身**；resolve 只存取数参数（provider/dataset/series/period/threshold）。⇒ 任何需要「序列里前 k 期数值」的读数**无法在账本内复算**，只能**联网重取数**。 |
| **已发布高频观测（MOS 订正输入）** | mos | `forecast` 字段仅 **2.8%** 覆盖（且只出现在带 cutoff 快照的题上）⇒ 不足以支撑 MOS 的订正对照。 |

## §3 resolve.kind 分布（池内）

| kind | n | 层 | 域 |
|---|---|---|---|
| openmeteo_air_daily_mean | 128 | {"L3":128} | {"openmeteo":128} |
| openmeteo_daily_max | 113 | {"L3":113} | {"openmeteo":113} |
| openmeteo_wx_daily | 60 | {"L3":60} | {"openmeteo":60} |
| openmeteo_air_pm2_5_daily_mean | 42 | {"L3":42} | {"openmeteo":42} |
| openmeteo_air_ozone_daily_mean | 42 | {"L3":42} | {"openmeteo":42} |
| dbnomics_series_value | 32 | {"L2":32} | {"dbnomics":32} |
| openmeteo_archive_daily_wind_speed_10m_max | 32 | {"L3":32} | {"openmeteo":32} |
| openmeteo_archive_daily_sunshine_duration | 32 | {"L3":32} | {"openmeteo":32} |
| openmeteo_archive_daily_precipitation_sum | 28 | {"L3":28} | {"openmeteo":28} |
| dbnomics_wb_commodity_annual | 24 | {"L2":24} | {"dbnomics":24} |
| openmeteo_forecast_daily_wind_speed_10m_max | 24 | {"L3":24} | {"openmeteo":24} |
| openmeteo_forecast_daily_sunshine_duration | 24 | {"L3":24} | {"openmeteo":24} |
| openmeteo_forecast_daily_precipitation_sum | 21 | {"L3":21} | {"openmeteo":21} |
| openmeteo_air_pm10_daily_mean | 20 | {"L3":20} | {"openmeteo":20} |
| dbnomics_bis_monthly_mean | 14 | {"L2":14} | {"dbnomics":14} |
| dbnomics_eurostat_unemployment_monthly | 9 | {"L2":9} | {"dbnomics":9} |
| openmeteo_marine_sst_daily | 8 | {"L3":8} | {"openmeteo":8} |

（审计件完 · 2026-09-18 · 零账本写／零 LLM／零网络）
