# p1b/scripts 目录索引（脚本都在干什么）

> **自动生成，勿手改**——`node p1b/scripts/scripts-index.cjs`（任务 6 批次 3 / 命名整理）。
> 生成时点：2026-09-17T07:58:06.824Z｜在役脚本 105 个｜归档件见文末。
> 命名约定：`corpus-*` 取数出题｜`g2-*` 门禁报表｜`stage4-*` 分层真跑｜`prereg-a-*` 命题 A｜**默认 dry-run、写库须 `--confirm`**（项目纪律）。

## 使用者友好面（先看这几个）（4）

| 脚本 | 一句话 | 写库 |
|---|---|---|
| `board.cjs` | 一页看板：门读数 / 采信链 / 五层读数 / 账本计数（任务 6 批次 2 · B1-4） | 只读 |
| `exp-health.cjs` | 跑批体检（任务 6 批次 2 · B1-6） | 只读 |
| `kind-table.cjs` | `resolve.kind` 目录表生成器（任务 6 · 批次 3 / B1-2） | 只读 |
| `scripts-index.cjs` | `p1b/scripts/` 目录索引生成器（任务 6 · 批次 3 / 命名整理） | 只读 |

## 取数出题 corpus-*（12）

| 脚本 | 一句话 | 写库 |
|---|---|---|
| `corpus-backfill.cjs` | 语料历史回填批（corpus-backfill，2026-09-12 施工棒）：用「历史已发生」数据灌一批立即可 resolve 的带真值题。 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-forward-b2.cjs` | 语料前瞻二轮（corpus-forward-b2，2026-09-13 施工棒）「10/11 月前瞻铺量」 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-forward-long2.cjs` | #11 长 horizon 第二来源（≥2 域，摆脱 oct_forward 单批） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-forward-oct.cjs` | corpus-forward-oct：2026-10 单月 realtime 补量（目标 >=35 条） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-forward.cjs` | 语料前瞻批（corpus-forward，2026-09-13 施工棒）「前瞻多点铺量」 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-ingest-b2.cjs` | 语料库第二批落库（2026-09-12 · 主会话亲笔）：Open-Meteo 四城市×四日 L3 16 条 + DBnomics L2 2 条。 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-ingest.cjs` | 语料库首批落库（corpus 棒 2026-09-12）：Top3 非对局题源 → 三条合成局 + 4 条 predictions。 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-resolve-daemon.cjs` | ==== part p1 ==== | 只读 |
| `corpus-resolve.cjs` | 语料库题目机械 resolve（corpus 棒 2026-09-12）：零 LLM，按 evidence_json[0].resolve 参数 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-sources-b3.cjs` | corpus-sources-b3：二轮源普查 + 同源双出题（同一新源同批出 backfill + forward） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-sources-b4.cjs` | corpus-sources-b4：语料源再扩量（同源扩量 + deferred 域攻坚 + 新域探查） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `corpus-thicken.cjs` | **薄域补量**（C 线 · 2026-09-15）。 | **可写库**（`--confirm` 才写；默认 dry-run） |

## 门禁与报表 g2-*（5）

| 脚本 | 一句话 | 写库 |
|---|---|---|
| `g2-audit-build.cjs` | ② 抽检清单 v2 构造器（批次 3 #6）——只读 p1a.db，零写库 | 只读 |
| `g2-contract-verify.cjs` | ② 契约表「源码派生」复现检查（2026-09-14） | 只读 |
| `g2-hcal-expand.cjs` | ② 采信链 规则②「校准全过且 n≥35」的**补样复核通道**（2026-09-14 新增） | 只读 |
| `g2-report.cjs` | G2 能力门月报 -- R4 口径（审计器 design §4.2 修订 R4，2026-09-13 用户拍板选项 A） | 只读 |
| `g2-user-spotcheck.cjs` | ② 采信链第③件「端用户抽验 ≥10 题」的端用户操作通道 | 只读 |

## 分层真跑与计分 stage4-* / judge / rb- / rc-（5）

| 脚本 | 一句话 | 写库 |
|---|---|---|
| `judge-runner.cjs` | 微步 3 批量判词 runner（Q 棒）：90 条 sim 预测 × 3 路走生产 verdicts 端点（幂等保首条）， | 只读 |
| `rb-attribution.cjs` | ───────────────────────────────────────────────────────────────────────────── | 只读 |
| `rb-score.cjs` | 批次 1-RB 计分（PREREG-RB v1 §三，零 LLM，库只读）。 | 只读 |
| `rc-score.cjs` | ───────────────────────────────────────────────────────────────────────────── | 只读 |
| `stage4-run.cjs` | 阶段 4「分层预测真跑」：把**真实账本**喂进 L2/L5 最小引擎并按层计分 | 只读 |

## 命题 A 跑批 prereg-a-*（5）

| 脚本 | 一句话 | 写库 |
|---|---|---|
| `prereg-a-archive.cjs` | PREREG-命题A-3.0消融 · §8-④ 跑前归档与快照（**零 LLM／零网络**） | 只读 |
| `prereg-a-bootstrap.cjs` | PREREG-命题A-3.0消融 · §3/§4 配对 bootstrap（**零 LLM／零网络**；源库 readonly） | 只读 |
| `prereg-a-run.cjs` | PREREG-命题A-3.0消融 · 跑批编排器（批次 4 第三步） | 只读 |
| `prereg-a-sweep.cjs` | 命题 A 全量补齐「扫尾」（2026-09-14） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `prereg-a-windows.cjs` | PREREG-命题A-3.0消融 · §5 双窗参数件（跑批参数显式落盘；**禁止两窗合并**） | 只读 |

## 其余工具（74）

| 脚本 | 一句话 | 写库 |
|---|---|---|
| `_b1-eol.cjs` | const fs = require('fs'); | 只读 |
| `_b1-g2-backtest-e2e.cjs` | _b1-g2-backtest-e2e：端到端证明 #1 回测排除子句真的生效（临时库，非生产） | 只读 |
| `_b1-matures-audit.cjs` | _b1-matures-audit：#2 对已产批次核对（只读）——每条 R4 行的 matures_at vs 由 evidence 现推 | 只读 |
| `_b1-snapshot.cjs` | const fs = require('fs'); | 只读 |
| `_b1-store-verify.cjs` | _b1-store-verify：#17b 真白名单 + #2 两列的写端行为验证（:memory:，零网络） | 只读 |
| `_b11-resolve-check.cjs` | _b11-resolve-check：12 条新题「真值锚机检可复核」——resolver 存在 + required keys 齐 + 调用返回 pending | 只读 |
| `_bd-anchorprobe.cjs` | 口径B 微步1 锚点探测（零写库）：彩票题面/时间戳找开奖日锚；BOM week 构造法在生成脚本侧另查。只读。 | 只读 |
| `_bd-dateprobe.cjs` | 口径B 微步1 探测（零写库）：抽 resolve 样本看日期键实态。只读打开。 | 只读 |
| `_bd-daterules.json` | "dbnomics_series_value": { "source_key": "period", "granularity": "monthly", "rule": "date = last_day(月 + 1 个月)；输入 YYY… | 只读 |
| `_bd-g2report.bd-bak.cjs` | G2 能力门月报 -- R4 口径（审计器 design §4.2 修订 R4，2026-09-13 用户拍板选项 A） | 只读 |
| `_brn-cmp0-check.cjs` | const fs = require('fs'); | 只读 |
| `_brn-verify-live.cjs` | _brn-verify-live：在【实况库】上证明 174 条是「纯加 baseRateNote」，其余键逐字不动，且新注记可被 g2-report 解析。 | 只读 |
| `_r5-coverage.cjs` | _r5-coverage：复刻 daemon 的抽取机制，核对每个库内 kind 是否有 resolver + 定义行号 | 只读 |
| `_rollback-template.cjs` | 「合并迁移」回滚脚本**模板**。 | 只读 |
| `_sqlite-guard.cjs` | SQLite 连接「写意图」守卫。 | 只读 |
| `ablation.cjs` | 多路判词消融（第十棒 W2，离线统计件，零 LLM）。 | 只读 |
| `acr-inject.cjs` | ───────────────────────────────────────────────────────────────────────────── | 只读 |
| `acr-run-llm.cjs` | ───────────────────────────────────────────────────────────────────────────── | 只读 |
| `acr-run.cjs` | ───────────────────────────────────────────────────────────────────────────── | 只读 |
| `assumption-recalc.cjs` | A1 假设重算器 v0（2026-09-17 · 第 3 期首选票，蓝图 §2.3-1） | 只读 |
| `backfill-base-rate.cjs` | 老行 evidence.baseRate 物化回填（零翻转安全集）。 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `backfill-baserate-note.cjs` | G2 R4 池内缺失 evidence.baseRateNote 的补齐器（additive，只加 key） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `backfill-checklist-hash.cjs` | F16 回填：879 行 checklist_hash 空的题，按 evidence.kind 映射补上 | **可写库**（`--confirm` 才写；默认 dry-run） |
| `backfill-evidence.cjs` | 批次1-M1（p15）· A1 三件套之二：90 条 sim 题证据链回填。 | 只读 |
| `base-rate-golden.cjs` | 基率解析金样冻结器（任务 6 批次 3 / B1-1 前置） | 只读 |
| `batch1-write-window.cjs` | 批次1 门卫生写库窗口： | **可写库**（`--confirm` 才写；默认 dry-run） |
| `calab-run.cjs` | P0-U5 · 校准器离线 A/B 协议（2026-09-16） | 只读 |
| `calibration-report.cjs` | P0-U8 · 分域格校准报告（2026-09-16） | 只读 |
| `cleanup-g1-dedup.cjs` | 清理局 1「集成验证局」的重复参谋卡脏数据（2026-09-14 用户拍板） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `cost-ledger.cjs` | 成本台账（蓝图 §2.2#6；F7 重开判据的数据源 · 2026-09-17） | 只读 |
| `d2-build-questions.cjs` | D2 历史回测引擎 · **出题器**（照 PREREG v1 §3/§5）。 | 只读 |
| `d2-run-backtest.cjs` | D2 历史回测引擎 · **跑批 + A1–A7 验收 + K1–K4 kill_test**。 | 只读 |
| `dna-s-backfill.cjs` | E1 · S 维标签回填（旁路表，INSERT-only）（2026-09-16） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `dna-s-dryrun.cjs` | DNA S 维读侧**试标**（P0-U6 · 2026-09-16） | 只读 |
| `dna-s-judge.cjs` | E1 判据（分层配对 bootstrap）＋ 前置门守卫（2026-09-16） | 只读 |
| `dna-s-source-snapshot.cjs` | E1 主口径 · 源数据侧快照重建（2026-09-16 · P0+） | 只读 |
| `e2-combo-precheck.cjs` | E2 立票前置「组合增益预检套件」（16⑦7A/7B/7C · 2026-09-17） | 只读 |
| `e2-r1-rules.cjs` | E2 · R1 语义重判臂：规则冻结核验 ＋ 错配/降档人口计数（2026-09-17） | 只读 |
| `e2-shadow-score.cjs` | E2 影子评分与组合预检（**未冻结 · 探索性**）（2026-09-16） | 只读 |
| `effective-source-snapshot.cjs` | 阶段 5 开工前置 ⑤：记录并冻结「实际生效源」配置快照。 | 只读 |
| `file-map.cjs` | 项目「文件全图」生成器（用户令 2026-09-14 深夜：项目地图要「目录一样，每个相关文件路径都在，并说是什么」） | 只读 |
| `fix-bug28-cwl-kind.cjs` | 修正 bug-28 遗留脏数据（2026-09-14） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `forecast-calendar.cjs` | P0-U7 · 待验证队列日历（2026-09-16） | 只读 |
| `gd2-0-accept.cjs` | D2 硬门 G-D2-0 三点可执行验收（规格 D2 §3.2） | 只读 |
| `intake-e2e.cjs` | 「开放接题最小闭环」端到端收据（阶段 3 出口件，2026-09-13）。 | 只读 |
| `intake-ledger-e2e.cjs` | D-8.1/D-8.2 端到端收据（design §8，2026-09-13）。 | 只读 |
| `intake-ui-e2e.cjs` | 接题页端到端收据（阶段 3 出口件界面面，2026-09-13）。 | 只读 |
| `lambda-overlap.cjs` | 9 臂先导 λ̂（信息重叠下界）· 2026-09-17 | 只读 |
| `m2-ingest-ep789.cjs` | M2 第7/8/9局（PandaKill S1E6 三局）公开层入库 | 只读 |
| `mdl-retention.cjs` | 18⑥ MDL 两部码留位判据 ＋ 效度回放（2026-09-17） | 只读 |
| `merged-migration.cjs` | 计划内「合并迁移」执行器 | 只读 |
| `metaculus-token-check.cjs` | Metaculus token 接入检查（任务 10 步骤 1 · 2026-09-16） | 只读 |
| `negative-results.cjs` | I2 负结果账本 v0（对内）（2026-09-16 · P0+ · 蓝图 §2.1#8 / 15-I2） | 只读 |
| `odds-probe.cjs` | The Odds API 探活 ＋ 历史可得性实测（2026-09-17） | 只读 |
| `odds-snapshot.cjs` | 体育赔率·前瞻快照采集（2026-09-17） | 只读 |
| `prereg-freeze.cjs` | PREREG 冻结哈希（通用）：口径显式、可复算（2026-09-16） | 只读 |
| `report-layered.cjs` | 微步 3 报表：分层 ECE（下界口径）+逐路 Brier vs 0.5 占位+相关矩阵→λ̂→γ̂。探索性（90<200 只记不评）。 | 只读 |
| `report-murphy.cjs` | 批次 1.5 · Murphy 三分解报表（K F56，零 LLM，库只读）。 | 只读 |
| `result-cache-precheck.cjs` | 结果缓存预检（蓝图 §2.1#7「唯一在建缓存件」· 2026-09-17） | 只读 |
| `result-cache-replay.cjs` | 结果缓存本体·历史重放验证（蓝图 §2.1#7 判据「历史重跑全命中」· 2026-09-17） | 只读 |
| `sim-templates-v2.cjs` | ───────────────────────────────────────────────────────────────────────────── | 只读 |
| `sim-titles.cjs` | 微步 2：sim 题源接入（Q 棒）。每局 3 条 cutoff-safe 模板题→分类→落库→resolve。幂等防重。 | 只读 |
| `snapshot-assigned-prob.cjs` | 旧 assigned_prob 快照（p13 批次0.5）。 | 只读 |
| `sources-wide-probe2.cjs` | 第二期广域普查（P0-任务 9 · 2026-09-16） | 只读 |
| `stage5-forecast-signal.cjs` | 阶段 5 路线 (b)「前瞻数值信号」**冻结实验的可复现脚本**。 | 只读 |
| `stage5-leak-probe.cjs` | 阶段 5 开工前置 ④-A：**泄漏三层探针 + canary 的工程验证**。 | 只读 |
| `stage5-rank-diagnostic.cjs` | 滞后集合 3 档秩检验（Watson）· **逐对件**（2026-09-17） | 只读 |
| `ts-rebacktest.cjs` | 批次 1.5 · TS/Platt 离线回测（零 LLM，库只读）。 | 只读 |
| `u8-columns.cjs` | U8 加列读侧派生：KL 可预报性 / Murphy 三分解 / prequential 累计曲线（2026-09-16 · P0+） | 只读 |
| `ui-pages-probe.cjs` | 四页(live/intake/manage/settings) before/after 截图 + 四断点横向溢出实测。 | 只读 |
| `ui-refactor-evidence.cjs` | UI 重构验收证据（DOM+computed-style ＋ 色彩对比 ＋ 前后对比）。 | 只读 |
| `ui-refactor-probe.cjs` | UI 重构前后对比探针（Playwright/Edge 无头，隔离端口 8791）。 | 只读 |
| `vault-sync.cjs` | truth_vault ↔ predictions 真值列同步器（任务 6 · 批次 3 · **F4 同批账本操作**） | **可写库**（`--confirm` 才写；默认 dry-run） |
| `voi-a.cjs` | PREREG-VoI-a 弱口径离线验证（S2续集-Gemini增量设计.md §③）。 | 只读 |

## 归档区 `archive/`（69 件）

历史一次性探针/修补件（对应各阶段已完成任务；**零活引用**，`git mv` 保历史）。它们**不是**运行依赖；查某件来历：`git log --follow -- p1b/scripts/archive/<name>`。

- `_b1`：`_b1-backlog.cjs`、`_b1-ddl-diag.cjs`、`_b1-fix-ddl-comma.cjs`、`_b1-fix-eol.cjs`、`_b1-kinds-probe.cjs`、`_b1-matures-probe.cjs`、`_b1-patch-ddl.cjs`、`_b1-publicexposure-probe.cjs`、`_b1-regime-probe.cjs`、`_b1-scan-calls.cjs`、`_b1-wire-fix.cjs`、`_b1-wire-oct.cjs`、`_b1-wire-writers.cjs`
- `_b11`：`_b11-games-probe.cjs`、`_b11-kind-meta.cjs`、`_b11-long-dist.cjs`、`_b11-recon.cjs`、`_b11-resolve-samples.cjs`、`_b11-snapshot.cjs`、`_b11-src-probe.cjs`
- `_bd`：`_bd-apply-datederiv.cjs`、`_bd-backfill-matures.cjs`、`_bd-backup-db.cjs`、`_bd-decompose427.cjs`、`_bd-frag-design1.md`、`_bd-frag-design2.md`、`_bd-frag-p19.md`、`_bd-frag-readme.md`、`_bd-frag-s16.md`、`_bd-patch-docs.cjs`、`_bd-patch-g2report.cjs`、`_bd-patch-g2report2.cjs`、`_bd-patch-g2report3.cjs`、`_bd-patch-g2report4.cjs`、`_bd-probe-bf.cjs`、`_bd-verify-docs.cjs`、`_bd-verify-matures.cjs`
- `_brn`：`_brn-analyze.cjs`、`_brn-g2cmp.cjs`、`_brn-postcheck.cjs`、`_brn-snapshot.cjs`
- `_daemon`：`_daemon-probe.cjs`
- `_g2chk.cjs`：`_g2chk.cjs`
- `_p13`：`_p13-probe.cjs`
- `_p4`：`_p4-metaculus-probe.cjs`、`_p4-metaculus-probe2.cjs`、`_p4-metaculus-probe3.cjs`、`_p4-metaculus-probe4.cjs`、`_p4-metaculus-probe5.cjs`
- `_probe`：`_probe-kinds.cjs`
- `_r5`：`_r5-analyze.cjs`、`_r5-batchstats.cjs`、`_r5-eol.cjs`、`_r5-kinds.cjs`、`_r5-pending-stats.cjs`、`_r5-samples.cjs`、`_r5-show.cjs`、`_r5-target.cjs`、`_r5-verify.cjs`
- `_rb`：`_rb-archive.cjs`、`_rb-audit.cjs`、`_rb-fix-runid.cjs`
- `_rc`：`_rc-archive.cjs`、`_rc-clean-dryrun.cjs`、`_rc-clean-oos.cjs`、`_rc-smoke.cjs`、`_rc-smokecheck.cjs`
- `_v2check.out`：`_v2check.out`
- `_v2dryrun.out`：`_v2dryrun.out`

（索引完 · 生成器 `p1b/scripts/scripts-index.cjs` · 与 `docs/specs/kind-目录表.md`、`docs/specs/参数表-人话版-v1.md` 同属使用者友好面）
