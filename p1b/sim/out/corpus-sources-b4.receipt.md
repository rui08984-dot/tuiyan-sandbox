# corpus-sources-b4 · 语料源再扩量收据（2026-09-13）

> 脚本：`p1b/scripts/corpus-sources-b4.cjs`（仅经此脚本写库；默认 dry-run，`--confirm` 落库）
> 收据：`p1b/sim/out/corpus-sources-b4.out`（报告）/ `.rows.json`（420 条全量行）
> 探针：`p1b/sim/out/b4-probe.json`、`b4-probe2.json`、`b4-probe3.json`；抽检：`b4-resolvecheck.json`

## 1. 落库结果（read-only 复核，非脚本自报）
- 本批 **inserted=420 / skipped=0 / duplicate_skipped=0**
- 全库 predictions **1503 → 1923**（+420）
- 分相：**backfill 217 ｜ forward 203**
- 质量门：基率带越界 **0**；slug 重复 **0**；prob 范围 **[0.3000, 0.7273]** ⊂ (0.15,0.85)
- 写入口字段（★2026-09-13 踩坑）：`checklist_hash='v2'` **420/420**、`public_exposure=0` **420/420**（驼峰入参生效，无 inserted=0 静默失败）
- resolve：URL+field 齐备 **420/420**（缺失 0）；evidence_json 非空 420/420；distinct engine **121**

## 2. 同源扩量（10 源，389 条）
| 源 key | game_type | 条数 | bf/fw | 扩量方式 |
|---|---|---|---|---|
| aq2 | corpus:airqual | 128 | 64/64 | 8 城 × 8 污染物（新增 pm2_5/ozone/no2/so2/co/dust/uv_index） |
| ec2 | corpus:power2 | 64 | 32/32 | Energy-Charts 6 国（FR/NL/ES/IT/AT/BE）× 4 类发电 |
| wx2 | corpus:wxb4 | 60 | 30/30 | 8 城 × 4 变量（TMAX/TMIN/降水小时/阵风，ERA5） |
| wiki2 | corpus:wikipv | 18 | 12/6 | 6 新词条 |
| bis2 | corpus:bis | 16 | 8/8 | BIS 有效汇率 4 新币种（GB/KR/IN/BR） |
| tide2 | corpus:tide2 | 15 | 5/10 | NOAA 潮汐 5 新站 |
| cr2 | corpus:crypto | 15 | 5/10 | Binance vision 5 新币对 |
| fx2 | corpus:fx | 12 | 8/4 | Frankfurter 4 新币对（GBP/AUD/CAD/CHF） |
| ghcn2 | corpus:ghcn2 | 8 | 4/4 | NCEI GHCN 4 新站 |
| npm2 | corpus:npmdl | 8 | 4/4 | npm 4 新包 |

## 3. 新域出题（8 域，55 条；均先 1 次 fetch 验真值锚）
| 新域 | game_type | 条数 | 真值锚（实测 http=200） |
|---|---|---|---|
| 12 人口（deferred 17 攻克） | corpus:population | 24 | Eurostat 直连 JSON-stat `demo_pjan?age=TOTAL&sex=T`（8 国 × 2015~2025） |
| 19 票房（deferred 19 攻克） | corpus:boxoffice | 4 | BoxOfficeMojo `/weekend/by-year/{year}/` HTML 单页含全年周末 Top10 Gross |
| 21 河流流量 | corpus:river | 10 | USGS NWIS dv 00060（5 站） |
| 22 海表温度 | corpus:sst | 8 | Open-Meteo marine hourly.sea_surface_temperature（4 点） |
| 23 太阳活动（SSN/F10.7） | corpus:astro2 | 6 | NOAA SWPC observed-solar-cycle-indices.json（月值，1749 起） |
| 24 大气 CO2 | corpus:co2 | 4 | NOAA GML co2_daily_mlo.csv（冒纳罗亚日值） |
| 25 近地天体 | corpus:neo | 4 | JPL CNEOS CAD（dist<0.05 AU 月计数） |
| 26 科学计量 OpenAlex | corpus:openalex | 4 | OpenAlex works meta.count（仅 backfill：计数随索引回填变动） |
| 4 公卫扩量 | corpus:flu2 | 12 | Delphi Epidata fluview 多区域（NY 因样本不足 n=20 被跳过；CA/TX/FL 出题） |

## 4. resolve 抽检（新 kind 各抽 1 条 backfill，真取真值与 truthPreview 对照）
`p1b/scripts/_b4-resolvecheck.cjs` → `b4-resolvecheck.json`，**8/8 MATCH**：
usgs_nwis_daily_discharge(2900 vs th3690=false✓) ｜ noaa_gml_co2_daily(430.15 vs 428.72=true✓) ｜
openmeteo_marine_sst_daily(20.196 vs 14.28=true✓) ｜ jpl_cad_monthly_count(96 vs 97=false✓) ｜
swpc_solar_cycle_monthly(125.9 vs 25=true✓) ｜ eurostat_demo_pjan_annual(**83,155,031 人** vs 82,314,906=true✓，德国 2021) ｜
bom_weekend_top10_gross($434,736,853 vs 98,801,587=true✓，2026W31 为 Spider-Man 开画破纪录周末 +207.4%) ｜
delphi_fluview_ili(4118 vs 5963=false✓)

## 5. 放弃 / 未能出题的域（本轮新增或维持）
| 域 | 判定 | 实测理由 |
|---|---|---|
| 2 准点率 | **维持放弃** | nasstatus.faa.gov/api/airport-status-information 200 但**仅当前快照**（Update_Time=Sun Sep 13 07:00:38 2026 GMT），无历史 → 既无 ≥30 期基率、事后也不可复核，违反 Q0-1，故**不出 L3 描述题**（比出弱锚卡更保守）；soa.smext.faa.gov 直连 fetch failed |
| 航运/港口吞吐 | 新增放弃 | 未找到免 key 机检源：MarineTraffic/Baltic/UNCTAD 均需 key 或年粒度 |
| 空间天气 Kp 指数 | 探到但不出题 | SWPC 3h 端点仅 58 行(~7 天)、1m 端点 358 行(~6 小时) → 无 ≥30 历史；改出月值 SSN/F10.7（corpus:astro2） |
| 14 拥堵 / 16 粮食产量 | 维持放弃 | 与既有结论一致，本轮未再碰 |
| NVD / MLB / Crossref 扩量 | 探到但本轮不扩 | 均 200 可用（NVD total=1944、MLB 15 场 130 分、Crossref 302846），但 NVD 无 key 限速 5req/30s、MLB 需逐日拉 → 成本收益不值，留给下批 |

## 6. 本轮新增踩坑（供后续棒）
1. **Eurostat demo_pjan 直接求和会 4× 膨胀**：age 维同时含 TOTAL 与逐岁、sex 维含 T/M/F；必须显式加 `&age=TOTAL&sex=T`（size 从 [1,1,103,3,1,N] 缩到 [1,1,1,1,1,N]），否则德国 2021 会写成 3.3 亿。
2. Eurostat 直连 `sinceTimePeriod=` 生效、`time=` 可重复；**`time=a-b` 区间写法报 400**。
3. SWPC 太阳活动须走 `json/solar-cycle/...`，`products/solar-cycle/...` 是 404。
4. 形如 `{date}` 在 url_template 里出现两次是常态，写 resolver/校验脚本时必须**全局替换**（`split/join`）；单次 `replace` 只替第一处，本棒抽检脚本首轮即因此误报 2 条 FETCH-FAIL。
5. USGS/NWIS 单日窄区间偶发返回 HTML 反爬页 → resolve 失败重试即可；非源不可用。
6. BoxOfficeMojo `/weekend/by-year/{year}/` 单页含全年周末（1 请求 = 52 期），比逐周抓 `/weekend/{id}/` 便宜 50 倍；HTML 但表格结构稳定（`<tr>` 内含 `/weekend/YYYYWnn/` 链接 + 首个 `$金额` 即 Top 10 Gross）。
7. JPL CAD 的 `cd` 是 `2026-Aug-01 19:34` 英文月缩写格式，不能按 `slice(0,7)` 切年月。
8. DB 列名是 `assigned_prob`（不是 prob）、`checklist_hash`（DB 侧蛇形，写入口入参是驼峰）——写只读统计脚本前先 `PRAGMA table_info`。

## 7. 未覆盖 / 边界（如实说）
- forward 的真值**尚未发生**，本棒只验证 resolve 路径可达与结构正确，未验证未来真值能否取到（这是 forward 的定义）。
- OpenAlex 仅出 backfill：周计数会随后续索引回填持续变动，前瞻题无稳定真值。
- 非中文源单位为 ppm/°F/ft³/s/sfu，statement 内已注明，未做单位换算。
- cutoff 由脚本按「事件前一自然日 23:59:59+08:00」或「落库时点」生成，严格早于事件由键选择逻辑保证（backfill 键一律取已完整结束的期），未逐条人工复核。
- 本批只做了 8 个新 kind 的 resolve 抽检；其余沿 b3 已验证 kind 未重复抽检。
