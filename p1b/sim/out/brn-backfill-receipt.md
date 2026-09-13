# baseRateNote 补齐收据（2026-09-13 · 账本缺口 174 条 + cmp0 桩修复）

执行：子代理会话（推演沙盘 / E:\music player）。全部结论以盘上文件与实跑输出为准。

## 一、范围与一处口径更正（实测）
- 任务查询模板（无池过滤）命中 **174** 条：openmeteo_daily_max 113 / dbnomics_series_value 35 / cwl_ssq_red_contains 17 / cwl_ssq_blue_odd 9。**已全部补齐**。
- **更正**：这 174 条中只有 **113 条**落在 ① 合格题池（1046）内（全部 openmeteo_daily_max，有 resolve.date）；另 **61 条**（dbnomics 35 + cwl 26）的 resolve 无 date，被 g2-report 的 no_resolve_date 规则排除出池（该排除共 877 条）。
  ⇒ 准确读法应为「R4 账本内缺 174，其中池内 113」。本棒两者全补。
- **缺口根因 = 写端放了错键**（不是缺数据）：三条生成脚本都算出了基率注记，写库时却存进 evidence[].note：
  - corpus-ingest.cjs:60 / corpus-ingest-b2.cjs:88 → note: q.baseRateNote
  - corpus-backfill.cjs:294 → note: '历史回填批次，非实时预测；' + q.baseRateNote
  g2-report ④ 只解析 baseRateNote ⇒ 这些行无法分级。

## 二、基率反推口径（与生成批同源，重取主源现算）
| kind | n | 口径 | 备注 |
|---|---|---|---|
| openmeteo_daily_max | 113 | 回填 96：archive 2015-01-01..2024-12-31 取 **2015-2023 同月**日值；前瞻 17：取 **2015-2024 全部 9 月日**。hit=P(max cmp 阈值) | 与 corpus-backfill / corpus-ingest-b2 同 URL+窗 |
| dbnomics_series_value | 35 | ECB/EXR/M.USD.EUR.SP00.A：pre=已发布月值 p<period；注记写「截至 YYYY-MM」者收紧（id=452→2026-07） | 与 corpus-backfill / b2 同序列 |
| cwl_ssq_red_contains | 17 | findDrawNotice(issueCount=30)：pre=该期前已开奖期；P(red 含 ball) | 16 回填 + 1 前瞻（组合数 6/33） |
| cwl_ssq_blue_odd | 9 | 同上：P(blue 为奇) | 8 回填 + 1 前瞻（组合数 8/16） |

**三条硬纪律落实**：① 全部窗口严格早于 cutoff（openmeteo 回填只用 2015-2023；dbnomics id=452 因 cutoff=2026-09-01 而剔除 2026-08）；② n<100 的 cwl 26 行全部显式写「样本不足 n=…」；③ 只加 baseRateNote，assigned_prob / outcome / resolved_at 等结论字段一律未动。
**同源复算 = 存档注记（交叉验证）**：174 条中 170 条存量 note 含百分比，重算 **170/170 逐位一致（disagree=0）**；余 4 条为手写前瞻行（无 %），其中 id=452 手写「149/331」≈ 重算 45.0%（=149/331），一致。

## 三、写库与安全
- **写前快照（VACUUM INTO）**：.scratch/backup/p1a-pre-brnbackfill-20260913082428.db · 3,686,400 B · integrity_check=ok · predictions=1923 · **sha256 531DEF3F3A43FD1C44C5F562875251F0415CC8BC700B4BD5334882E42C6B01EE**
- **additive UPDATE**：只向「含该 kind 的 resolve」的那个元素追加 baseRateNote；写入前做双重断言（原字节 JSON 往返等值 + 删掉新键后与原字节等值），174/174 通过。
- **事务写入 174 行** → 写后现场查询：4 kind 缺 baseRateNote 剩余 **0**；integrity_check=ok；predictions=1923 不变。
- 写后 p1a.db sha256（postcheck 时点；库有 8787 活服务，WAL 会漂）**276C19BA8A66CCC592630F8421459A25A15EC4C1E92BA0E7C272205595B36567**

## 四、收据（盘上文件）
| 文件 | 内容 |
|---|---|
| p1b/sim/out/brn-backfill.dry.live.out | 首轮 dry-run（实况库·写前）stdout |
| p1b/sim/out/brn-backfill.dry.out | 对写前快照副本重跑 dry-run（含 [report] 行），结果与首轮逐字相同 |
| p1b/sim/out/brn-backfill.dry.report.json | 174 条逐行 before/after + 对账（机器可读） |
| p1b/sim/out/brn-backfill.confirm.out | **实况库真写** stdout：UPDATEd rows=174 / 剩余=0 / integrity ok |
| p1b/sim/out/brn-backfill.confirm.err 与 brn-backfill.dry.err | 均空 |
| p1b/sim/out/brn-sample-table.md | 每 kind 3 条抽样对照表 |
| p1b/scripts/backfill-baserate-note.cjs | 补齐器（dry/confirm；支持 --db / --report） |

**诚实标注**：首轮 confirm 误用 --report <path>（空格），脚本当时只认 --report=<path>，故未落 JSON；实况写库本身已成功（confirm.out 为证）。事后已修参数解析（两种写法都收），并对**写前快照副本**重跑 dry 生成 dry.report.json。快照重跑结果与首轮 dry 逐字相同（174 / 各 kind agree 数 / disagree=0），即等值证明。实况库未再二次写入（8787 有活服务，不动它）。

## 五、实况库验证（_brn-verify-live.cjs：写前快照 vs 实况库）
total=174 / pureAdd=174 / parseable=174 / hardest_b=138 / inPool=113 / bad=0 → **RESULT PASS**
- **pureAdd=174**：实况库每条 evidence_json 删掉新加 baseRateNote 后，与写前快照**逐字节等值** ⇒ 除新键外一字未动。
- **parseable=174**：174 条新注记全部能被 g2-report 的 parseBaseRate 解析出 b。
- 落在 ① 池内的 113 条里，108 条 b(1−b)≥0.21（96 回填 + 12 前瞻）。

## 六、抽样对照表（每 kind 3 条；完整 174 条见 dry.report.json）
| kind | id | cutoff | 样本 n | hit(外生基率) | b(1−b) | 存量注记% | 重算% | 一致 |
|---|---|---|---|---|---|---|---|---|
| openmeteo_daily_max | 451 | 2026-09-12 07:02 | 300 | 0.0100 | 0.0099 | 手写「仅3日」 | 1.0 | n/a |
| openmeteo_daily_max | 455 | 2026-09-12 09:22 | 300 | 0.2000 | 0.1600 | 20.0 | 20.0 | 是 |
| openmeteo_daily_max | 456 | 2026-09-12 09:22 | 300 | 0.2000 | 0.1600 | 20.0 | 20.0 | 是 |
| dbnomics_series_value | 452 | 2026-09-12 07:02 | 331 | 0.4502 | 0.2475 | 手写「149/331」 | 45.0 | n/a |
| dbnomics_series_value | 471 | 2026-09-12 09:22 | 332 | 0.4488 | 0.2474 | 44.9 | 44.9 | 是 |
| dbnomics_series_value | 472 | 2026-09-12 09:22 | 332 | 0.2952 | 0.2081 | 29.5 | 29.5 | 是 |
| cwl_ssq_red_contains | 453 | 2026-09-12 07:02 | n/a（组合数 6/33） | 0.1818 | 0.1487 | 手写组合数 | 18.2 | n/a |
| cwl_ssq_red_contains | 601 | 2026-08-31 | 25 | 0.1600 | 0.1344 | 16.0 | 16.0 | 是 |
| cwl_ssq_red_contains | 602 | 2026-08-26 | 23 | 0.1739 | 0.1437 | 17.4 | 17.4 | 是 |
| cwl_ssq_blue_odd | 454 | 2026-09-12 07:02 | n/a（组合数 8/16） | 0.5000 | 0.2500 | 手写组合数 | 50.0 | n/a |
| cwl_ssq_blue_odd | 617 | 2026-09-05 | 27 | 0.5926 | 0.2414 | 59.3 | 59.3 | 是 |
| cwl_ssq_blue_odd | 618 | 2026-08-31 | 25 | 0.6000 | 0.2400 | 60.0 | 60.0 | 是 |

**人工可核路径（两例）**：
- id=455：GET archive-api.open-meteo.com/v1/archive?latitude=31.23&longitude=121.47&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_max&timezone=Asia/Shanghai → 取 MM=09 的 300 日 → 数 max>30 的 60 日 = 20.0%。
- id=601：GET www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30 → 得 2026076..2026105 → 取 2026101 之前 25 期 → 含 07 的 4 期 = 16.0%。
- cwl 的 n=13..27 全部 <100 ⇒ 注记均含「样本不足 n=…」（硬纪律②）；openmeteo 270-300、dbnomics 331/332 均 ≥100。

## 七、g2 读数前后对比（node p1b/scripts/g2-report.cjs --audit p1b/sim/out/g2-audit-r4.json）
| 项 | before | after | Δ |
|---|---|---|---|
| 门总判定 | PASS | **PASS** | 0 |
| ① 合格题 | 1046（realtime 517 / backfill 529） | 1046（realtime 517 / backfill 529） | 0 |
| ② 抽检合格率 | 100.0%（105/105） | 100.0%（105/105） | 0 |
| ③ 短 / 中 / 长 | 419 / 77 / 21 | 419 / 77 / 21 | 0 |
| ④ 最难档 | 808（realtime 443 / backfill 365） | **916**（realtime 455 / backfill 461） | **+108** |
| ④ 外生解析覆盖 | 933/1046（89.2%） | **1046/1046（100%）** | +113 |
| ④ by_layer | L3 511 / L2 297 | L3 619 / L2 297 | +108 |
| ⑦ 长∩最难（报告项） | 18/21 | 18/21 | 0 |
| ④ b 解析模式 | pct_share 933 | pct_share 1046 | +113 |
| ① 排除 | no_resolve_date 877 | no_resolve_date 877 | 0 |
| 收据 | g2-report-before-brn.json/.out | g2-report-after-brn.json/.out | — |

**「最难档 +108」= 补齐覆盖，不是口径放宽**（三重证据）：
1. +108 精确等于池内新覆盖 113 条中 b(1−b)≥0.21 的条数（96 回填 + 12 前瞻），无一条来自阈值/判据改动。
2. 这 108 行的 b 是**外生**历史基率（多为气候同月 ≈0.5，回填 96 条 b∈[0.44,0.53]），重算与生成批存档注记逐位一致（disagree=0）⇒ 口径未变，只是此前没被解析。
3. ①③ 与门判定、⑦ 重叠、排除计数（no_resolve_date 877）均不动 ⇒ 池子没被放宽。

## 八、cmp0() 恒真桩修复（p1b/scripts/corpus-sources-b4.cjs）
- 原状：function cmp0() { return true; }（L179）；唯一调用在 AQ 注记方向（L169）：cmp0(th, hit) ? '>=' : '<='，而 AQ 配置 ge:false ⇒ 真实方向应为 <=，恒真桩把它印成 >=（与同句命中率自相矛盾；也正是 g2-audit-r4.json 里 id=1627 校准翻正一案的由来）。
- 修复：emitSeries 把 cmp（L76：ge ? '>=' : '<='）作为第 7 参传给 cfg.note（L84）；L169 改读 cmp0(cmp)；定义 function cmp0(cmp) { return cmp === '>='; }。同步更新 L68 契约注释。
- **只影响后续生成的行**：未改任何既有行文案、未写库（本次补的 174 条属 4 个旧 kind，与此无关）。
- 动态验证 p1b/scripts/_brn-cmp0-check.cjs（从真源码抽出 emitSeries + cmp0 跑合成例）：
  extracted cmp0 def: function cmp0(cmp) { return cmp === '>='; }
  cmp0(">=")=true / cmp0("<=")=false
  ge=false → 全部 dir=<= ；ge=true → 全部 dir=>= ；**RESULT PASS**

## 九、回归与结论
- cd p1b && node --test → **198 pass / 0 fail**（p1b/sim/out/brn-node-test.out），与基线 198 一致。
  留痕：首跑为 199 pass；排查发现多出的 1 条是我自己的探针 _brn-net-test.cjs 命中 Node 的 *-test.cjs 文件名 glob 被当成测试文件，已改名 _brn-net-fetch.cjs，复跑回到 198（0 fail）。
- 一句话结论：**174 条账本缺口的根因是写端把注记落在 note 键；按生成批同源口径重取主源现算并 additive 补丁后 174→0；④ 覆盖 933→1046/1046、最难档 808→916（属补覆盖非放宽）；①③ 与门判定不动、门仍 PASS；cmp0 恒真桩已改为按 ge 方向返回并经动态验证；node --test 198/0 不回归。**

（收据完 · 2026-09-13）



