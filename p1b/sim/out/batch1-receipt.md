# 批次1 收据 · 门卫生写库窗口（2026-09-13）

范围＝专家会统一清单 **#2 / #17(a,b,c) / #1+P2 / #8**。全部结论以盘上文件与实跑输出为准。

## 一、开工基线（协议：重跑 g2-report ＋ 积压计数）
| 项 | 写前基线 | 写后 |
|---|---|---|
| 门总判定 | PASS | PASS |
| ① 合格题 | 1046（resolved 623；realtime 517 / backfill 529） | 1046（同） |
| ② 抽检 | 100.0%（105/105） | 100.0%（105/105） |
| ③ horizon | PASS（短 419 / 中 77 / 长 21） | PASS（同） |
| ④ 最难档 | 916（rt 455 / bf 461；外生覆盖 1046/1046） | 916（同） |
| 门域 / 账本 | — | 1923 / 1923（回测排除 0；非 R4 行域 0） |
| 积压（未结算且已过到期日） | **8** | 8（本批不碰结算） |

- 积压 8 条明细：matures_at 全为 2026-06-25，id = 1761,1765,1769,1785,1787,1789,1791,1793。
- 与队长开工前实测（PASS／1046／100%／③PASS／916／积压 8）**逐项一致**。
- 收据：p1b/sim/out/g2-report-batch1-baseline.{out,json}（写前）、g2-report-batch1-final.{out,json}（写后）。

## 二、改动清单
### #2 写端补两列＋校验（与 #17b 白名单同一次改动）
| 文件 | 改动 |
|---|---|
| p1b/src/db/predictionsStore.js | ①F16 改**真白名单**：AUDIT_KEYS（9 键）∪ CORE_INSERT_KEYS（6 键），未知键**抛错**（原实现只拦 7 个下划线名，未知键静默落空）；②新增可写键 g2Regime/maturesAt（#2）与 metricVersion/backtestBatch（#1）；③INSERT 补 g2_regime/matures_at/metric_version/backtest_batch 四列；④新增 deriveMaturesAt + isIsoDate/lastDayOfMonth/epiweekEnd/isoWeekSunday 并导出；⑤**批次显式性守卫**：声明 g2Regime 者必须显式给 maturesAt（日期或 null），省略即抛错；⑥DDL 与 AUDIT_COLUMNS 同步补两列；⑦rowToPrediction 回读四列 |
| 11 个批量写端 | corpus-ingest / -b2 / corpus-backfill / corpus-forward / -b2 / -oct / corpus-sources-b3 / -b4（8 个）：写 g2Regime:'R4' ＋ maturesAt: deriveMaturesAt(resolve, meta)；sim-titles / sim-templates-v2 / ablation（3 个）：写 g2Regime:'R4' ＋ **显式 maturesAt: null**（botc 无日历到期日；若强给日期会把 450 行拉进 ①/③ 从而改读数——故意不做） |

### #17a public_exposure 回填
- 879 行 NULL → 0：L2 398 / L3 399 / L5 82；ev kind = wide_backfill 280、wide_forward 183、forward_batch_b2 136、forward_batch 112、oct_forward 69、b3_backfill 52、b3_forward 47。
- 写后 dist = {0: 1923}，NULL = 0。

### #17c baseline_brier 废弃
- design §4.2.2 新增 **B7** 废弃登记（裁决＝废弃，非补齐）；g2-report 审计列文案改「已废弃」。

### #1＋P2 门卫生
- g2-report.cjs ① 加 NOT_BACKTEST 排除子句 = (metric_version IS NULL AND backtest_batch IS NULL)，**schema 自适应**（列缺失时降级 1=1 并告警，不硬崩）。
- 新增「门域外行数」告警行：回测排除 / 不在 R4 行域 / 合计域外。

### #8 ④ 等价带
- 报告与 JSON 文案统一为 b(1-b)>=0.21（等价于基率 [0.30, 0.70]）；**判据本体不变**。

## 三、快照与写库收据
- **写前快照（VACUUM INTO）**：.scratch/backup/p1a-pre-batch1-20260913091042.db · 3,936,256 B · integrity ok · predictions 1923
  **sha256 FEBB763567943DB57A6A42337CEF4778DD74FB50E5BD9BD079D2ABB567FCCA18**
- 写库脚本：p1b/scripts/batch1-write-window.cjs（默认 dry-run；--confirm 事务；支持 --db=<快照> 复演）
- **dry（对照写前快照，真·写前态）**：p1b/sim/out/batch1-write.dry.out
  → missing_cols=[metric_version,backtest_batch]；exposure_null_to_0=**879**（L2 398 / L3 399 / L5 82）
- **confirm（实况库真写）**：p1b/sim/out/batch1-write.confirm.out
  → updated_rows=**879**；missing_cols_after=[]；exposure_null_after=**0**；dist={0:1923}；integrity=ok；predictions=1923
- confirm.err / 各 .err 均为空（关键命令一律落 err 文件，未用 2>$null 吞错）。

## 四、验证（全部本轮新跑）
| 验证 | 命令/脚本 | 结果 |
|---|---|---|
| g2 读数不退化 | g2-report --audit p1b/sim/out/g2-audit-r4.json | PASS；①1046；②100%；③PASS；④916；域外 0 |
| **回测排除子句端到端生效** | _b1-g2-backtest-e2e.cjs ＋ g2-report --db 临时库 | 账本 3 → 门域 **2**；输出「[!] 门域外告警: 回测排除 **1** 行」；① 值 2（回测行已出池） |
| 写端白名单/两列行为 | _b1-store-verify.cjs（:memory:） | **21/21 PASS**（未知键抛错／下划线抛错／13 核心键不误伤／四列落列／显式 maturesAt 守卫） |
| matures_at 反推一致性 | _b1-matures-audit.cjs（只读） | stored_nonnull 1046，**match 1046 / mismatch 0**（反推逐条复现存值） |
| 单测 | cd p1b && node --test | **222 pass / 0 fail**（基线 221；+1 为并行棒新增的 intake 路由测试，非本棒改动） |
| 语法 / EOL | node --check（14 文件）；_b1-eol.cjs | 全过；predictionsStore.js 保持统一 **CRLF（519/0）** |

## 五、未做 / 未覆盖（如实）
1. **已产批次的 matures_at 未回填**（#2 只授权「核对」）：核对显示 **395 行**可由 evidence 现推但存量 NULL（dbnomics/cwl/npm/week 等 22 个 kind）；**482 行**不可推（450＝botc 无 resolve；32＝cwl backfill 的 evidence 只存 cutoff、未存 meta.drawDate）。本轮**新写端已修**（corpus 传 q.meta），历史行是否回填留给后续批次裁定。
2. **D2 落库位置 / 影子库 / authorizer（#3、#5）不在本批**：本批只交付 #1 的「一列一子句＋告警」。
3. **g2_regime 值仍为 'R4'**：R4→R4.1 世代递进属 #10（批次3），本批不改行域值以免清空门域。
4. **P2 接题入口预检引擎未实现**：按裁决「P2 与 #1/#2/#8 合并同一写库窗口」，本批只落门卫生两项；预检引擎本体留待其独立条目。
5. 生产库写入期间 **8787 有活服务（PID 71484）**：本批为 additive ALTER ＋ 单列 UPDATE（WAL），未重启、未独占；写后 integrity ok。未做「停服独占」类操作。

（批次1 收据完 · 2026-09-13）
