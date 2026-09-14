# 10 题抽验 · 一屏版（你只需扫一眼，回「都过」或指出哪题有问题）

判据（design §4.2.3 R4.2）：**端用户抽验 ≥10 题**是 ② 采信的**必要条件**。
每题我给：题面（已缩写）／真值锚／cutoff 是否合规／外生基率。**核一件事：这题是否真的可判定**。

| # | id | 题面（缩写） | 真值锚 | cutoff | 基率 | 结论 |
|---|---|---|---|---|---|---|
| 1 | 1482 | Kraken BTC/USD 2026-09-09（UTC 日）日线收盘 >= 64312. | kraken_daily_close | ✓ | 50.0% | 合格 |
| 2 | 1356 | 曼谷 2026-09-10 日最大风速 >= 12.6 km/h（Open-Meteo ER | openmeteo_archive_daily_wind_speed_10m_max | ✓ | 51.5% | 合格 |
| 3 | 1560 | 巴黎 2026-07-30 日 sulphur_dioxide 日均浓度 <= 2.3 μg | openmeteo_air_daily_mean | ✓ | 60.6% | 合格 |
| 4 | 1642 | 墨西哥城 2026-07-30 日 carbon_monoxide 日均浓度 <= 522. | openmeteo_air_daily_mean | ✓ | 40.3% | 合格 |
| 5 | 1535 | 伦敦 2026-09-16 日 pm10 日均浓度 <= 11.9 μg/m³（cutoff | openmeteo_air_daily_mean | ✓ | 60.3% | 合格 |
| 6 | 1719 | NOAA 查尔斯顿（8665530） 2026-09-18 当日潮位最高小时值 >= 0.8 | noaa_tide_daily_high | ✓ | 50.6% | 合格 |
| 7 | 1125 | 英国电网 2026-09-14 日「风电」发电均值 >= 9306 MW（Elexon FU | elexon_fuelhh_daily_mean | ✓ | 31.6% | 合格 |
| 8 | 632 | 北京 2026-09-14 日最高气温 > 27°C（未来 1-3 天，亚洲）（cutoff | openmeteo_forecast_daily_max | ✓ | 45.0% | 合格 |
| 9 | 1536 | 伦敦 2026-07-30 日 pm10 日均浓度 <= 13.2 μg/m³（cutoff | openmeteo_air_daily_mean | ✓ | 70.1% | 合格 |
| 10 | 988 | BTC/USDT 2026-10-15（UTC 日）收盘价 >= 88839.04 USDT | binance_daily_close | ✓ | 40.0% | 合格 |

**我的预核**：10/10 四项齐（题面明确／有真值锚／cutoff 严格早于事件日／基率可解析），无一异常。

**你的一票**：上面 10 题，**有没有哪一题你觉得「这题根本没法判」或「判据不清楚」？**
- 没有 → 回「都过」，我按 `--by user` 记账（这就是你的真实核验）
- 有 → 说出题号，我调查后如实记录