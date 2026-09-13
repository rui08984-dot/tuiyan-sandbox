# #11 长 horizon 第二来源 · 收据（2026-09-13）

## 一、缺口与目标
- G2 ③ 要求「长 horizon(>30 天) ≥10 条且必须 realtime」。**开工基线：长 21 条，全部来自 oct_forward 单批**
  （resolve kind：openmeteo_air_pm10_daily_mean 10 / binance_daily_close 6 / wikimedia_pageviews 5）
  —— 一个批次决定长 horizon 结论（专家会 #11 要求单独开线加第二来源）。
- 本批：另开 **3 域**前瞻题，horizon 全 >30 天，真值锚=**已注册 resolver kind**（corpus-resolve.cjs），
  来源与 oct_forward **不重叠**（oct 用 AQ PM10 / Binance / Wikimedia / npm / GitHub / 彩票）。

## 二、新批构成（12 条，id 1939–1950）
| 域 | resolve kind（已注册） | 标的 | 目标日 | horizon | 历史 n | 阈值 | prob |
|---|---|---|---|---|---|---|---|
| 水文 | usgs_nwis_daily_discharge | 波托马克河 01646500 | 2026-10-20/11-03/11-17 | 37/51/65 天 | 400 | 2520 / 2270 / 2270 ft³/s | 0.50 / 0.60 / 0.60 |
| 水文 | usgs_nwis_daily_discharge | 科罗拉多河 Lees Ferry 09380000 | 同上 | 37/51/65 天 | 399 | 8690 / 8380 / 8380 ft³/s | 0.3008 / 0.406 / 0.406 |
| 大气 | noaa_gml_co2_daily | 冒纳罗亚站（MLO） | 同上 | 37/51/65 天 | 272 | 429.96 / 429.23 / 429.23 ppm | 0.3015 / 0.4007 / 0.4007 |
| 气象 | ghcn_daily_tmax | 纽约中央公园 USW00094728 | 同上 | 37/51/65 天 | 398 | 75 / 79 / 79 °F | 0.402 / 0.3291 / 0.3291 |

- 契约：**g2_regime='R4'** ＋ **matures_at 显式**（deriveMaturesAt） ＋ **public_exposure=0** ＋ **checklistHash='v3'**（12/12 齐）。
- 基率口径：cutoff 前 400 天历史现算（剔除 cutoff 当日及以后）；**注记直接写 baseRateNote 键**并显式带 n。
  n=272–400 全部 ≥100 ⇒ 无「薄样本」标注（阈值由 seed(源|标的|目标日) 稳定挑选 → 重跑恒定）。
- 幂等：statement 前缀【slug】查重（confirm 时 duplicate=0）。

## 三、快照与写库收据
- **写前快照（VACUUM INTO，源库一律 {readonly:true} 打开）**：
  .scratch/backup/p1a-pre-long2-20260913092807.db · 3,944,448 B · integrity ok · predictions 1923
  **sha256 40DDE6352D574688090D90180498EF01D2D154031DBB8CAA2DA469E37BB4F291**
- **readonly 纪律实证**：源库 p1a.db sha256 快照前后**同值** 04132F15C676E4B7F720AF6A66A134CE75CA478FE88CE47ECD47C2B79B12748D ⇒ 未回写头部。
- dry：p1b/sim/out/long2.dry.out（12 条逐条：h=37/51/65d、th、prob、n）
- confirm：p1b/sim/out/long2.confirm.out → inserted 12（id 1939–1950）、duplicate 0、integrity=ok、
  **v3 行=12 且四契约齐=12**；long2.confirm.err / .dry.err 均空（未用 2>$null 吞错）。

## 四、门读数前后对照（node p1b/scripts/g2-report.cjs --audit p1b/sim/out/g2-audit-r4.json）
| 项 | 写前 | 写后 | Δ | 逐条说明 |
|---|---|---|---|---|
| 门总判定 | PASS | PASS | 0 | 不退化 |
| ① 合格题 | 1046（rt 517 / bf 529） | **1058**（rt 529 / bf 529） | **+12** | 即本批 12 条：cutoff=2026-09-13 < 事件日（37–65 天）、tautology=0、checklist_hash 非空 ⇒ 全部入池 |
| ② 抽检 | 100.0%（105/105） | 100.0%（105/105） | 0 | 不变 |
| ③ 长 horizon | 21 | **33** | **+12** | 本批 horizon=37/51/65 天，全 >30；长中 backfill 仍 **0**（「长必须 realtime」满足） |
| ③ 短 / 中 | 419 / 77 | 419 / 77 | 0 | 本批不产短/中题 |
| ④ 最难档 | 916（rt 455 / bf 461） | **928**（rt 467 / bf 461） | **+12** | 本批 b∈[0.3008, 0.60] ⇒ b(1-b)∈[0.2103, 0.25]，12/12 ≥0.21 |
| ④ 外生解析覆盖 | 1046/1046 | 1058/1058 | +12 | 新注记均含「占 X%」，可解析 |
| ⑦ 长∩最难（报告项） | 18/21（85.7%） | **30/33（90.9%）** | +12 | 新增 12 条同时是长题与最难档（重叠为披露项，不扣减） |
| 门域 / 账本 | 1923 / 1923 | **1935 / 1935** | +12 | 域外仍 0 |
| 积压 | 8 | 8 | 0 | 本批不碰结算 |
> 注：本次输出行首出现「[G2＝过程能力门，不含预测质量读数]」限定语，系**并行棒**按专家会 B4 落地，非本棒改动。

## 五、长 horizon 按来源分布（写后，>30 天，共 33 条）
| 批次（evidence kind） | resolve kind | 来源域 | 条数 | checklist_hash |
|---|---|---|---|---|
| oct_forward | openmeteo_air_pm10_daily_mean | Open-Meteo 空气质量 | 10 | v2 |
| oct_forward | binance_daily_close | Binance 行情 | 6 | v2 |
| oct_forward | wikimedia_pageviews | Wikimedia 浏览 | 5 | v2 |
| **long2_forward（本批）** | **usgs_nwis_daily_discharge** | **USGS 水文** | **6** | **v3** |
| **long2_forward（本批）** | **noaa_gml_co2_daily** | **NOAA GML 大气** | **3** | **v3** |
| **long2_forward（本批）** | **ghcn_daily_tmax** | **NCEI 气象** | **3** | **v3** |
| 合计 | 6 个 resolve kind / 2 个批次 | 6 域 | 33 | — |

**来源集中度变化**：单批占比 100%（21/21）→ **63.6%（21/33）**；最大单来源由「整批」降为 21/33。

## 六、验证（本轮新跑）
| 验证 | 脚本/命令 | 结果 |
|---|---|---|
| **真值锚机检可复核** | _b11-resolve-check.cjs | **12/12 PASS**：resolver 函数存在 + required keys 齐（对照 g2-audit-r4-contract.md 的 3 行契约）+ 实调返回 pending（目标日未到＝正确语义） |
| 四契约齐 | 同上 | g2_regime='R4' / matures_at 非空 / public_exposure=0 / 注记含 n= ⇒ 12/12 |
| 门读数不退化 | g2-report --audit g2-audit-r4.json | ①②③④ 全 PASS；域外 0；长中 backfill 0 |
| 单测 | cd p1b && node --test | **223 pass / 0 fail**（协议基线 222；+1 为并行棒新增 loadEvidence sham 臂测试，非本棒改动） |
| 语法/EOL | node --check；快照 readonly 实证 | 全过；源库 sha 前后同值 |

## 七、仍缺什么（如实）
1. **只加 1 批（12 条）**：满足「第二来源」的形式要求，但**未达多来源均衡**——长 horizon 仍 63.6% 来自 oct_forward。
   要彻底摆脱单批主导，需再开 1–2 批（建议后续把 oct 长题稀释或各来源补到 ≥12 条）。
2. **本批 3 域均为日频源**（靠远日期取得 >30 天 horizon）。**月度/年度序列未纳入**：swpc/noaa_solar 月报、eurostat 年度、
   dbnomics 月度等 kind 的 resolve **没有 date 键**，会被 g2-report 的 no_resolve_date 规则排除出 ① 池 ⇒ 需先与设计确认
   「月度/年度到期日是否写入 resolve.date」（属口径决定，本棒**未擅自加字段**以免制造第二真值源）。
3. **尚无已结算样本**：12 条真值分别在 2026-10-20 / 11-03 / 11-17 之后才可 resolve（resolver 现返回 pending）。
   本棒交付的是「长 horizon realtime 题量」，不含结算后的质量读数。
4. **未触碰** key / 8787 / p1b/src/botc / checklist_hash 既有语义；**未改任何阈值本体**；oct_forward 既有 21 条一字未动。

（#11 收据完 · 2026-09-13）
