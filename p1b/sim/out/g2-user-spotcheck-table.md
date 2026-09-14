# ② 端用户抽验表（10 题 · seed=20260914 · 2026-09-14T04:16:47.527Z）

> 你的任务：逐题判断「**这个题是否真的合格**」（判据是否明确、有真值锚、cutoff 合规）。
> 与机器/代理段结论一致就填 PASS，不同意就填 REJECT。**这一步代理不能代替**——② 采信链的独立性正靠它。
> 填法：把每题下面的 `裁定:` 改成 PASS 或 REJECT（可加备注），另存为 .tsv 后跑 --record。
> 判据（design §4.2.3 R4.2 D-3③）：端用户抽验 ≥10 题是 ② 采信的**必要条件**；未做则状态恒 `pending_user`。

## 1. 题 id=1482（L2 / past / kraken_daily_close）
- 题面：【backfill】Kraken BTC/USD 2026-09-09（UTC 日）日线收盘 >= 64312.90 USD
- 事件日：2026-09-09 ｜ 外生基率 b=0.5
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：Kraken BTC>=64312.90：pair/日/阈值明确，b=0.5
- 综合结论：PASS
- 裁定: ____

## 2. 题 id=1356（L3 / past / openmeteo_archive_daily_wind_speed_10m_max）
- 题面：【backfill】曼谷 2026-09-10 日最大风速 >= 12.6 km/h（Open-Meteo ERA5）
- 事件日：2026-09-10 ｜ 外生基率 b=0.515
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：曼谷风速>=12.6：判据明确，b=0.515
- 综合结论：PASS
- 裁定: ____

## 3. 题 id=1560（L3 / past / openmeteo_air_daily_mean）
- 题面：【backfill】巴黎 2026-07-30 日 sulphur_dioxide 日均浓度 <= 2.3 μg/m³（cutoff=2026-07-29T23:59:59+08:00，严格早于该日；真值锚=Open-Meteo air-quality hourly.sulphur_dioxide 该日全小时均值。历史回填批次，非实时预测）
- 事件日：2026-07-30 ｜ 外生基率 b=0.606
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：巴黎SO2<=2.3：判据明确，b=0.606
- 综合结论：PASS
- 裁定: ____

## 4. 题 id=1642（L3 / past / openmeteo_air_daily_mean）
- 题面：【backfill】墨西哥城 2026-07-30 日 carbon_monoxide 日均浓度 <= 522.5 μg/m³（cutoff=2026-07-29T23:59:59+08:00，严格早于该日；真值锚=Open-Meteo air-quality hourly.carbon_monoxide 该日全小时均值。历史回填批次，非实时预测）
- 事件日：2026-07-30 ｜ 外生基率 b=0.40299999999999997
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：墨西哥城CO<=522.5：判据明确，b=0.403
- 综合结论：PASS
- 裁定: ____

## 5. 题 id=1535（L3 / short / openmeteo_air_daily_mean）
- 题面：【forward】伦敦 2026-09-16 日 pm10 日均浓度 <= 11.9 μg/m³（cutoff=落库时点 2026-09-13T15:10:07+08:00，该日尚未发生；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。前瞻批次，真值未发生）
- 事件日：2026-09-16 ｜ 外生基率 b=0.603
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：伦敦pm10<=11.9：判据明确，b=0.603
- 综合结论：PASS
- 裁定: ____

## 6. 题 id=1719（L2 / short / noaa_tide_daily_high）
- 题面：【forward】NOAA 查尔斯顿（8665530） 2026-09-18 当日潮位最高小时值 >= 0.865 m（MSL）（cutoff=落库时点 2026-09-13T15:10:07+08:00，该日尚未到；潮汐为天文推算，当日即出真值。前瞻批次，真值未发生）
- 事件日：2026-09-18 ｜ 外生基率 b=0.506
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：NOAA查尔斯顿潮位>=0.865：判据明确，b=0.506
- 综合结论：PASS
- 裁定: ____

## 7. 题 id=1125（L2 / short / elexon_fuelhh_daily_mean）
- 题面：【forward】英国电网 2026-09-14 日「风电」发电均值 >= 9306 MW（Elexon FUELHH）
- 事件日：2026-09-14 ｜ 外生基率 b=0.316
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：英国风电均值>=9306MW：fuel/日/阈值明确，b=0.316
- 综合结论：PASS
- 裁定: ____

## 8. 题 id=632（L3 / short / openmeteo_forecast_daily_max）
- 题面：【forward】北京 2026-09-14 日最高气温 > 27°C（未来 1-3 天，亚洲）（cutoff=落库时点 2026-09-13T00:47:01+08:00，事件日尚未发生；真值锚=Open-Meteo forecast/archive daily.temperature_2m_max[2026-09-14]。前瞻批次，真值未发生）
- 事件日：2026-09-14 ｜ 外生基率 b=0.45
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：北京09-14最高温>27：对象/日期/阈值明确，cutoff早于事件，b=0.45在带
- 综合结论：PASS
- 裁定: ____

## 9. 题 id=1536（L3 / past / openmeteo_air_daily_mean）
- 题面：【backfill】伦敦 2026-07-30 日 pm10 日均浓度 <= 13.2 μg/m³（cutoff=2026-07-29T23:59:59+08:00，严格早于该日；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。历史回填批次，非实时预测）
- 事件日：2026-07-30 ｜ 外生基率 b=0.701
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：伦敦pm10<=13.2：判据明确，b=0.701
- 综合结论：PASS
- 裁定: ____

## 10. 题 id=988（L2 / long / binance_daily_close）
- 题面：【forward】BTC/USDT 2026-10-15（UTC 日）收盘价 >= 88839.04 USDT（cutoff=落库时点 2026-09-13T02:12:54+08:00，严格早于该 UTC 日（10 月）；真值锚=Binance klines [4]=close。10 月 realtime 补量批，真值未发生）
- 事件日：2026-10-15 ｜ 外生基率 b=0.4
- 机器段：PASS（frozen-contract（按 resolver 源码取数需求））
- 代理段：PASS：BTC收盘>=88839.04（长）：判据明确，b=0.4
- 综合结论：PASS
- 裁定: ____

# ── 以下为 .tsv 填写区（勿改 id 列）──────────────────
# id	verdict	note
1482		
1356		
1560		
1642		
1535		
1719		
1125		
632		
1536		
988		