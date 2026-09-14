# ② 校准补样复核单（21 项 · seed=20260914 · 2026-09-14T06:03:31.827Z）

> 你的任务：逐项判断「**该题的判据是否真的合格**」——对象/日期/阈值明确、有真值锚、cutoff 严格早于事件日、基率非恒真/恒假。
> 与 ② 综合结论一致 → PASS；不同意 → REJECT。**每项必须写一句理由**（空理由会被记账拒收——防凑数）。
> 抽样纪律（与首轮同族）：边界基率 12 ＋ 长窗 3 ＋ 顺延 6，偏向最易出错处（保守方向）。
> 判据（design §4.2.3 R4.2）：校准**全过且 n≥35**（或 Wilson 95% 下界 ≥0.90）为 ② 采信条件之二。

## 1. id=1158（L3 / past / openmeteo_air_ozone_daily_mean）
- 题面：【backfill】东京 2026-09-08 日 臭氧 日均浓度 <= 42.5 μg/m³
- 真值锚：kind=openmeteo_air_ozone_daily_mean
- 判据参数：{"kind":"openmeteo_air_ozone_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=35.68&longitude=139.69&hourly=ozone&timezone=GMT&start_date={date}&end_date={date}","lat":35.68,"lon":139.69,"date":"2026-09-08","threshold"
- cutoff=2026-09-07T23:59:59+08:00 ｜ 事件日/到期=2026-09-08 ｜ 基率 b=0.504
- 基率注记：回填·东京：cutoff 前 115 个 臭氧 日均中 <= 42.5 占 50.4%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 2. id=1753（L2 / past / energycharts_daily_mean）
- 题面：【backfill】西班牙电网 2026-06-25 日「Nuclear」发电均值 >= 5118 MW（Energy-Charts）（cutoff=2026-06-24T23:59:59+08:00，严格早于该日；真值锚=Energy-Charts public_power 该日 15 分钟值均值。历史回填批次，非实时预测）
- 真值锚：kind=energycharts_daily_mean
- 判据参数：{"kind":"energycharts_daily_mean","url_template":"https://api.energy-charts.info/public_power?country=es&start={date}&end={date}","country":"es","type":"Nuclear","date":"2026-06-25","threshold":5118,"cmp":">=","field":"production_types[] 中 name==Nuclear 的 .dat
- cutoff=2026-06-24T23:59:59+08:00 ｜ 事件日/到期=2026-06-25 ｜ 基率 b=0.512
- 基率注记：回填·西班牙 Nuclear：前 121 个日均中 >= 5118 占 51.2%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 3. id=1356（L3 / past / openmeteo_archive_daily_wind_speed_10m_max）
- 题面：【backfill】曼谷 2026-09-10 日最大风速 >= 12.6 km/h（Open-Meteo ERA5）
- 真值锚：kind=openmeteo_archive_daily_wind_speed_10m_max
- 判据参数：{"kind":"openmeteo_archive_daily_wind_speed_10m_max","url_template":"https://archive-api.open-meteo.com/v1/archive?latitude=13.76&longitude=100.5&start_date={date}&end_date={date}&daily=wind_speed_10m_max&timezone=UTC","lat":13.76,"lon":100.5,"date":"2026-09-1
- cutoff=2026-09-09T23:59:59+08:00 ｜ 事件日/到期=2026-09-10 ｜ 基率 b=0.515
- 基率注记：回填·曼谷：cutoff 前 97 天 日最大风速 中 >= 12.6 占 51.5%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 4. id=1198（L3 / short / openmeteo_air_pm2_5_daily_mean）
- 题面：【forward】墨西哥城 2026-09-15 日 PM2.5 日均浓度 <= 23.0 μg/m³
- 真值锚：kind=openmeteo_air_pm2_5_daily_mean
- 判据参数：{"kind":"openmeteo_air_pm2_5_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=19.43&longitude=-99.13&hourly=pm2_5&timezone=GMT&start_date={date}&end_date={date}","lat":19.43,"lon":-99.13,"date":"2026-09-15","threshold"
- cutoff=2026-09-13T02:52:45+08:00 ｜ 事件日/到期=2026-09-15 ｜ 基率 b=0.504
- 基率注记：前瞻·墨西哥城：过去 121 天（2026-05-16~2026-09-13）PM2.5 日均中 <= 23.0 占 50.4%（分位 q=0.5，pre-cutoff）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 5. id=1490（L2 / past / kraken_daily_close）
- 题面：【backfill】Kraken ETH/USD 2026-09-09（UTC 日）日线收盘 >= 1890.06 USD
- 真值锚：kind=kraken_daily_close
- 判据参数：{"kind":"kraken_daily_close","url_template":"https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1440&since={since_ms}","pair":"ETHUSD","date":"2026-09-09","threshold":1890.06,"cmp":">=","field":"body.result.<非 last 的键>[] 中 time 对应 UTC 日的那根的 [4]=close"}
- cutoff=2026-09-08T23:59:59+08:00 ｜ 事件日/到期=2026-09-09 ｜ 基率 b=0.5
- 基率注记：回填·Kraken ETH/USD：cutoff 前 76 个日线收盘中 >= 1890.06 占 50.0%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 6. id=1387（L3 / short / openmeteo_forecast_daily_precipitation_sum）
- 题面：【forward】莫斯科 2026-09-18 日降水量 <= 0.8 mm（Open-Meteo 预报）
- 真值锚：kind=openmeteo_forecast_daily_precipitation_sum
- 判据参数：{"kind":"openmeteo_forecast_daily_precipitation_sum","url_template":"https://api.open-meteo.com/v1/forecast?latitude=55.75&longitude=37.62&daily=precipitation_sum&timezone=UTC&start_date={date}&end_date={date}","lat":55.75,"lon":37.62,"date":"2026-09-18","thre
- cutoff=2026-09-13T02:52:45+08:00 ｜ 事件日/到期=2026-09-18 ｜ 基率 b=0.505
- 基率注记：前瞻·莫斯科：近 99 天（2026-06-05~2026-09-11）日降水量 中 <= 0.8 占 50.5%（分位 q=0.5，pre-cutoff）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 7. id=1370（L3 / past / openmeteo_archive_daily_wind_speed_10m_max）
- 题面：【backfill】开罗 2026-09-10 日最大风速 >= 17.6 km/h（Open-Meteo ERA5）
- 真值锚：kind=openmeteo_archive_daily_wind_speed_10m_max
- 判据参数：{"kind":"openmeteo_archive_daily_wind_speed_10m_max","url_template":"https://archive-api.open-meteo.com/v1/archive?latitude=30.04&longitude=31.24&start_date={date}&end_date={date}&daily=wind_speed_10m_max&timezone=UTC","lat":30.04,"lon":31.24,"date":"2026-09-1
- cutoff=2026-09-09T23:59:59+08:00 ｜ 事件日/到期=2026-09-10 ｜ 基率 b=0.536
- 基率注记：回填·开罗：cutoff 前 97 天 日最大风速 中 >= 17.6 占 53.6%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 8. id=919（L2 / mid / wikimedia_pageviews）
- 题面：【forward】en.wikipedia 「ChatGPT」 2026-09-23 页面浏览量 >= 101315 次（cutoff=落库时点 2026-09-13T01:46:01+08:00，该日尚未发生；真值锚=Wikimedia pageviews API items[].views。前瞻批次，真值未发生）
- 真值锚：kind=wikimedia_pageviews
- 判据参数：{"kind":"wikimedia_pageviews","url_template":"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/ChatGPT/daily/{date}00/{date}00","article":"ChatGPT","date":"2026-09-23","threshold":101315,"cmp":">=","field":"ite
- cutoff=2026-09-13T01:46:01+08:00 ｜ 事件日/到期=2026-09-23 ｜ 基率 b=0.5
- 基率注记：前瞻·ChatGPT：过去 400 天（截至 2026-09-10）398 个日浏览量中 >= 101315 占 50.0%（分位 q=0.5，pre-cutoff）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 9. id=1482（L2 / past / kraken_daily_close）
- 题面：【backfill】Kraken BTC/USD 2026-09-09（UTC 日）日线收盘 >= 64312.90 USD
- 真值锚：kind=kraken_daily_close
- 判据参数：{"kind":"kraken_daily_close","url_template":"https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since={since_ms}","pair":"XBTUSD","date":"2026-09-09","threshold":64312.9,"cmp":">=","field":"body.result.<非 last 的键>[] 中 time 对应 UTC 日的那根的 [4]=close"}
- cutoff=2026-09-08T23:59:59+08:00 ｜ 事件日/到期=2026-09-09 ｜ 基率 b=0.5
- 基率注记：回填·Kraken BTC/USD：cutoff 前 76 个日线收盘中 >= 64312.90 占 50.0%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 10. id=1173（L3 / past / openmeteo_air_ozone_daily_mean）
- 题面：【backfill】悉尼 2026-09-09 日 臭氧 日均浓度 <= 35.3 μg/m³
- 真值锚：kind=openmeteo_air_ozone_daily_mean
- 判据参数：{"kind":"openmeteo_air_ozone_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=-33.87&longitude=151.21&hourly=ozone&timezone=GMT&start_date={date}&end_date={date}","lat":-33.87,"lon":151.21,"date":"2026-09-09","threshol
- cutoff=2026-09-08T23:59:59+08:00 ｜ 事件日/到期=2026-09-09 ｜ 基率 b=0.509
- 基率注记：回填·悉尼：cutoff 前 116 个 臭氧 日均中 <= 35.3 占 50.9%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 11. id=1372（L3 / short / openmeteo_forecast_daily_wind_speed_10m_max）
- 题面：【forward】开罗 2026-09-16 日最大风速 >= 17.7 km/h（Open-Meteo 预报）
- 真值锚：kind=openmeteo_forecast_daily_wind_speed_10m_max
- 判据参数：{"kind":"openmeteo_forecast_daily_wind_speed_10m_max","url_template":"https://api.open-meteo.com/v1/forecast?latitude=30.04&longitude=31.24&daily=wind_speed_10m_max&timezone=UTC&start_date={date}&end_date={date}","lat":30.04,"lon":31.24,"date":"2026-09-16","th
- cutoff=2026-09-13T02:52:45+08:00 ｜ 事件日/到期=2026-09-16 ｜ 基率 b=0.505
- 基率注记：前瞻·开罗：近 99 天（2026-06-05~2026-09-11）日最大风速 中 >= 17.7 占 50.5%（分位 q=0.5，pre-cutoff）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 12. id=1799（L2 / past / binance_daily_close）
- 题面：【backfill】XRP/USDT 2026-07-15（UTC 日）收盘价 >= 2.0909 USDT（cutoff=2026-07-14T23:59:59+08:00，严格早于该 UTC 日；真值锚=Binance klines [4]=close。历史回填批次，非实时预测）
- 真值锚：kind=binance_daily_close
- 判据参数：{"kind":"binance_daily_close","url_template":"https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}","symbol":"XRPUSDT","start_ms":1784073600000,"end_ms":1784159999999,"date":"2026-07-15","th
- cutoff=2026-07-14T23:59:59+08:00 ｜ 事件日/到期=2026-07-15 ｜ 基率 b=0.5
- 基率注记：回填·XRP/USDT：前 440 个日线收盘中 >= 2.0909 占 50.0%（分位 q=0.5）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 13. id=988（L2 / long / binance_daily_close）
- 题面：【forward】BTC/USDT 2026-10-15（UTC 日）收盘价 >= 88839.04 USDT（cutoff=落库时点 2026-09-13T02:12:54+08:00，严格早于该 UTC 日（10 月）；真值锚=Binance klines [4]=close。10 月 realtime 补量批，真值未发生）
- 真值锚：kind=binance_daily_close
- 判据参数：{"kind":"binance_daily_close","url_template":"https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}","symbol":"BTCUSDT","start_ms":1792022400000,"end_ms":1792108799999,"date":"2026-10-15","th
- cutoff=2026-09-13T02:12:54+08:00 ｜ 事件日/到期=2026-10-15 ｜ 基率 b=0.4
- 基率注记：前瞻·BTC/USDT：cutoff 前 900 个日线收盘（2024-03-26~2026-09-11）中 >= 88839.04 占 40.0%（分位 q=0.6，pre-cutoff 现算）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 14. id=985（L3 / long / openmeteo_air_pm10_daily_mean）
- 题面：【forward】圣保罗 2026-10-15 日 PM10 日均浓度 <= 20.6 μg/m³（cutoff=2026-09-13T02:12:54+08:00，严格早于事件日；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。10 月 realtime 补量批，真值未发生）
- 真值锚：kind=openmeteo_air_pm10_daily_mean
- 判据参数：{"kind":"openmeteo_air_pm10_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=-23.55&longitude=-46.63&hourly=pm10&timezone=GMT&start_date={date}&end_date={date}","lat":-23.55,"lon":-46.63,"date":"2026-10-15","threshold"
- cutoff=2026-09-13T02:12:54+08:00 ｜ 事件日/到期=2026-10-15 ｜ 基率 b=0.603
- 基率注记：前瞻·圣保罗：cutoff 前 365 个 PM10 日均（2025-09-13~2026-09-12）中 <= 20.6 占 60.3%（分位 q=0.6，pre-cutoff 现算）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 15. id=1633（L3 / short / openmeteo_air_daily_mean）
- 题面：【forward】墨西哥城 2026-09-16 日 pm2_5 日均浓度 <= 28.9 μg/m³（cutoff=落库时点 2026-09-13T15:10:07+08:00，该日尚未发生；真值锚=Open-Meteo air-quality hourly.pm2_5 该日全小时均值。前瞻批次，真值未发生）
- 真值锚：kind=openmeteo_air_daily_mean
- 判据参数：{"kind":"openmeteo_air_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=19.43&longitude=-99.13&hourly=pm2_5&timezone=GMT&start_date={date}&end_date={date}","lat":19.43,"lon":-99.13,"date":"2026-09-16","threshold":28.93
- cutoff=2026-09-13T15:10:07+08:00 ｜ 事件日/到期=2026-09-16 ｜ 基率 b=0.603
- 基率注记：前瞻·墨西哥城 pm2_5：cutoff 前 400 个日均中 >= 28.9 占 60.3%（分位 q=0.6）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 16. id=1535（L3 / short / openmeteo_air_daily_mean）
- 题面：【forward】伦敦 2026-09-16 日 pm10 日均浓度 <= 11.9 μg/m³（cutoff=落库时点 2026-09-13T15:10:07+08:00，该日尚未发生；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。前瞻批次，真值未发生）
- 真值锚：kind=openmeteo_air_daily_mean
- 判据参数：{"kind":"openmeteo_air_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=51.51&longitude=-0.13&hourly=pm10&timezone=GMT&start_date={date}&end_date={date}","lat":51.51,"lon":-0.13,"date":"2026-09-16","threshold":11.88,"c
- cutoff=2026-09-13T15:10:07+08:00 ｜ 事件日/到期=2026-09-16 ｜ 基率 b=0.603
- 基率注记：前瞻·伦敦 pm10：cutoff 前 400 个日均中 >= 11.9 占 60.3%（分位 q=0.6）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 17. id=1254（L2 / short / noaa_tide_daily_max）
- 题面：【forward】NOAA 西雅图站（9447130） 2026-09-15 当日潮位最高小时值 >= 1.451 m（MSL）
- 真值锚：kind=noaa_tide_daily_max
- 判据参数：{"kind":"noaa_tide_daily_max","url_template":"https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=dsh-probe&begin_date={date_nodash}&end_date={date_nodash}&datum=MSL&station=9447130&time_zone=gmt&units=metric&interval=h&fo
- cutoff=2026-09-13T02:52:45+08:00 ｜ 事件日/到期=2026-09-15 ｜ 基率 b=0.3
- 基率注记：前瞻·西雅图：过去 40 天（2026-08-09~2026-09-17）最高潮位中 >= 1.451 占 30.0%（分位 q=0.7）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 18. id=1722（L3 / short / ghcn_daily_tmax）
- 题面：【forward】NCEI GHCN 洛杉矶（USW00023174） 2026-09-16 日最高气温 >= 77.0 °F（cutoff=落库时点 2026-09-13T15:10:07+08:00，该日尚未发生；真值锚=NCEI daily-summaries TMAX。前瞻批次，真值未发生）
- 真值锚：kind=ghcn_daily_tmax
- 判据参数：{"kind":"ghcn_daily_tmax","url_template":"https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00023174&dataTypes=TMAX&format=json&units=standard&startDate={date}&endDate={date}","station":"USW00023174","date":"2026-09-16","thr
- cutoff=2026-09-13T15:10:07+08:00 ｜ 事件日/到期=2026-09-16 ｜ 基率 b=0.313
- 基率注记：前瞻·洛杉矶 TMAX：前 396 个日均中 >= 77.0 占 31.3%（分位 q=0.7）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 19. id=1129（L2 / past / elexon_fuelhh_daily_mean）
- 题面：【backfill】英国电网 2026-09-11 日「燃气联合循环」发电均值 >= 4392 MW（Elexon FUELHH）
- 真值锚：kind=elexon_fuelhh_daily_mean
- 判据参数：{"kind":"elexon_fuelhh_daily_mean","url_template":"https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH?format=json&settlementDateFrom={date}&settlementDateTo={date_plus1}","fuel":"CCGT","date":"2026-09-11","threshold":4392,"cmp":">=","field":"body.data[] 中 f
- cutoff=2026-09-10T23:59:59+08:00 ｜ 事件日/到期=2026-09-11 ｜ 基率 b=0.611
- 基率注记：回填·UK/燃气联合循环：cutoff 前 18 个日均中 >= 4392 占 61.1%（分位 q=0.4）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 20. id=1177（L3 / short / openmeteo_air_ozone_daily_mean）
- 题面：【forward】悉尼 2026-09-15 日 臭氧 日均浓度 <= 38.7 μg/m³
- 真值锚：kind=openmeteo_air_ozone_daily_mean
- 判据参数：{"kind":"openmeteo_air_ozone_daily_mean","url_template":"https://air-quality-api.open-meteo.com/v1/air-quality?latitude=-33.87&longitude=151.21&hourly=ozone&timezone=GMT&start_date={date}&end_date={date}","lat":-33.87,"lon":151.21,"date":"2026-09-15","threshol
- cutoff=2026-09-13T02:52:45+08:00 ｜ 事件日/到期=2026-09-15 ｜ 基率 b=0.603
- 基率注记：前瞻·悉尼：过去 121 天（2026-05-16~2026-09-13）臭氧 日均中 <= 38.7 占 60.3%（分位 q=0.6，pre-cutoff）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

## 21. id=703（L3 / short / openmeteo_forecast_daily_max）
- 题面：【forward】洛杉矶 2026-09-15 日最高气温 > 31°C（未来 1-3 天，北美）（cutoff=落库时点 2026-09-13T00:47:01+08:00，事件日尚未发生；真值锚=Open-Meteo forecast/archive daily.temperature_2m_max[2026-09-15]。前瞻批次，真值未发生）
- 真值锚：kind=openmeteo_forecast_daily_max
- 判据参数：{"kind":"openmeteo_forecast_daily_max","lat":34.05,"lon":-118.24,"date":"2026-09-15","threshold_c":31,"cmp":">"}
- cutoff=2026-09-13T00:47:01+08:00 ｜ 事件日/到期=2026-09-15 ｜ 基率 b=0.45299999999999996
- 基率注记：前瞻·洛杉矶 09月：2015-2024 archive 同月 300 个日值中 max>31°C 占 45.3%（分位 q=0.5，严格大于口径）
- 机器段：PASS ｜ 代理段：PASS
- 判定: ____  理由: ____

# ── 以下为 .tsv 填写区（勿改 id 列；理由必填）──────────────
# id	verdict	reason
1158		
1753		
1356		
1198		
1490		
1387		
1370		
919		
1482		
1173		
1372		
1799		
988		
985		
1633		
1535		
1254		
1722		
1129		
1177		
703		