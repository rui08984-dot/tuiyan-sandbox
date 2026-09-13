# 推演沙盘 · 文档总索引（未来对接入口）

> **本文=全项目文档的导航入口**，新会话/新伙伴从这里进。
> 生成 2026-09-12 晚 ｜ 维护规则：**新增文档必须在此登记**；文档改名/归档必须同步本表。
> **权威层级（冲突时的优先序）**：①各 PREREG 冻结件 → ②设计文档（design）→ ③路线图 → ④交接/日结 → ⑤进度锚（PROGRESS）。

---

## 0 · 先读这三份（零上下文入门）

| 顺序 | 文档 | 作用 |
|---|---|---|
| 1 | `.scratch/handoff/推演沙盘-交接-20260913-晚.md` | **唯一入口**（含 §6.5 优先级重排，最要害） |
| 2 | `docs/specs/推演沙盘-终极路线图-20260913.md` | 阶段 0-5 全图 + 当前位置 |
| 3 | `docs/sandbox/HANDOFF-2026-09-08.md` | 权威全量（项目前因后果、铁律、禁改清单） |

---

## 1 · 设计文档（docs/specs/）

| 文档 | 管什么 | 状态 |
|---|---|---|
| `推演沙盘-终极路线图-20260913.md` | **阶段 0-5 总图**（权威路径） | ✅ 2026-09-12 状态回写 |
| `2026-09-07-推演沙盘-design.md` | 项目总纲 v3.2（历史） | 冻结 |
| `2026-09-11-全拟真模拟-design.md` | sim 工厂宪法（方案 C 混合双源） | 已批 |
| `2026-09-11-万物可预测性审计器-design.md` | **六层分类 + G2 门禁**（含 §4.1 修订 R3） | 已批，G2 未过 |
| `万物分类清单-v1.md` / `-v2.md` | 打印版判据清单（v2 含 backfill 注记） | **v2 冻结**（改动须升 v3） |
| `2026-09-12-多日局模拟-design.md` | 多日局 5 批拆单（含 §8 降级状态） | 🔨 降为并行线 |
| `sim-templates-v2-题源设计.md` | 12 条模板题源（R-B 实验依据） | 冻结，多日局需重标定 |

## 2 · 施工计划与勘察

| 文档 | 管什么 | 状态 |
|---|---|---|
| `语料库历史回填-加速计划-20260912.md` | backfill 批（含 §3.5 融合架构） | ✅ 152 条已入库 |
| `前瞻多点铺量-冲刺计划-20260912.md` | forward 批 + 10-15 天节奏 | 🔨 112 条已入库，二轮在跑 |
| `语料库扩展-公开数据源勘察-20260913.md` | 七源勘察 + §十一 backfill 模式 + §十二 落地成果 | ✅ 含大乐透勘误 |
| `变更留痕索引-20260912.md` | **改过哪些原文档**（8 份清单） | ✅ 维护中 |

## 3 · 交接与进度锚

| 位置 | 内容 |
|---|---|
| `.scratch/handoff/` | 交接链（晚版入口 → 日结 → 更早） |
| `docs/sandbox/p0-replay/` | **真人局弹药库**（replay/truth/slots/QC）+ M2 相关 |
| `docs/sandbox/p1b/itest/` | 进度锚 p7~p20-PROGRESS.md |
| `.scratch/forecast-debate/` | 研究档案（D-裁决/G-合并/ACR/PREREG/论文精读） |

## 4 · 代码地图（关键文件）

| 类别 | 文件 |
|---|---|
| **语料管线** | `p1b/scripts/corpus-backfill.cjs`（152 条）/ `corpus-forward.cjs`（112 条）/ `corpus-resolve.cjs`（resolver） |
| **矛盾检测** | `p1b/src/detectors/werewolf-contradictions.js`（444 行，版型无关）/ `p1b/src/botc/contradictions.js`（本体，**禁改**） |
| **场景适配器** | `p1b/src/adapters/avalon.js`（681 行，五方法契约） |
| **审计仪表盘** | `p1b/src/routes/audit.js` + `p1b/web/src/pages/audit/AuditPage.tsx` |
| **账本 API** | `p1a-terminal/src/db.js`（**只读复用**）/ `p1b/src/db/predictionsStore.js` |
| **sim 工厂** | `p1b/sim/sim-loop.cjs`（414 行，多日局 B1 骨架） |

---


## 4.5 · 本会话施工产物（2026-09-12/13 · 全部盘上可核）

### 语料管线（4 个脚本）
| 脚本 | 条数 | 说明 |
|---|---|---|
| `p1b/scripts/corpus-backfill.cjs` | 152 | 历史回填（天气/汇率/彩票） |
| `p1b/scripts/corpus-forward.cjs` | 112 | 前瞻一批（跨洲 14 城） |
| `p1b/scripts/corpus-forward-b2.cjs` | 136 | 前瞻二轮（补 10/11 月） |
| `p1b/scripts/corpus-forward-oct.cjs` | 69 | 10 月 realtime 补量 |
| `p1b/scripts/corpus-sources-b3.cjs` | 99 | 7 新源双出题 |
| `p1b/scripts/corpus-sources-b4.cjs` | **420** | **再扩量**（10 同源扩量 + 8 新域出题 + 攻下 deferred 域 17 人口 / 19 票房） |
| `p1b/scripts/corpus-resolve.cjs` | — | resolver（14 kind） |
| `p1b/scripts/corpus-resolve-daemon.cjs` | 465 行 | **自动 resolve 调度**（--once/--loop/--due-only） |

### 检测与适配
| 文件 | 说明 |
|---|---|
| `p1b/src/detectors/werewolf-contradictions.js` | **矛盾检测层**（444 行，W1-W6 版型无关，ACR 结果落地） |
| `p1b/src/adapters/avalon.js` | **阿瓦隆适配器**（681 行，五方法契约） |

### UI（3 件）
| 文件 | 说明 |
|---|---|
| `p1b/src/routes/audit.js` + `AuditPage.tsx` | **审计页三层递进**（p20+p22：状态卡/分层卡/折叠明细） |
| `p1b/src/routes/adapters.js` + `lib/useGameTypes.ts` | **游戏类型后端驱动**（p21，加游戏只改后端） |
| `p1b/web/dist` | 最新 bundle index-BRXPntAZ.js |

### 真人局入库
| 件 | 说明 |
|---|---|
| `p1b/scripts/m2-ingest-ep789.cjs` | **第 7/8/9 局入库**（n_real 8→11，泄漏自检 0） |
| `docs/sandbox/p0-replay/M2-入库报告-第7-8-9局.md` | 入库报告 |
| `docs/sandbox/p0-replay/M2-终审清单-第7-8-9局.md` | 三局终审清单 |

### 数据源普查
| 件 | 说明 |
|---|---|
| `p1b/sim/out/sources-wide-probe.out` (35.7KB) | **广域普查探测**（20 域 / 200+ URL 实测 / 16 域可用 / 143 条原始证据） |
| `p1b/sim/out/sources-wide-batch.out` (10.7KB) | **广域普查出题**（✅ 463 条入库 / 15 域 / backfill 280 + forward 183） |
| `p1b/sim/out/sources-wide-probe.jsonl` | 143 条原始证据 |
| `p1b/sim/out/corpus-sources-b4.out` | **再扩量出题**（✅ 420 条入库 = backfill 217 + forward 203 / band 越界 0 / slug 重复 0 / 全库 1503→1923） |
| `p1b/sim/out/corpus-sources-b4.receipt.md` | 再扩量收据（19 个 game_type 分域表 + resolve 抽检 8/8 MATCH + 放弃清单 + 新增踩坑 8 条） |
| `p1b/sim/out/b4-probe{,2,3}.json` · `b4-resolvecheck.json` | 新域探针证据（3 轮 · 40+ URL 实测）与 resolve 抽检证据 |

### 关键文档
| 件 | 说明 |
|---|---|
| `docs/specs/讨论汇总与实施路线-20260913.md` | **本会话讨论全记录**（用户 7 观点 + 队长 6 建议） |
| `docs/specs/前瞻多点铺量-冲刺计划-20260912.md` | forward 批动机与规格（含 §7 G2 断档分析） |
| `docs/specs/语料库历史回填-加速计划-20260912.md` | backfill 批 + §3.5 融合架构 |
| `docs/specs/待办队列与派单排程-20260912.md` | 任务队列 |
| `docs/sandbox/p1b/itest/p19~p22-PROGRESS.md` | 进度锚（含工具纪律 §十二/十三） |

### 实验报告
| 件 | 说明 |
|---|---|
| `.scratch/forecast-debate/acr-二期报告-20260912.md` | **ACR 二期**（cutoff PASS / full FAIL） |
| `.scratch/forecast-debate/acr-一期报告-20260912.md` | ACR 一期（机械层） |

### 红队链（对抗审查 · 2026-09-13 补登记）
| 件 | 说明 |
|---|---|
| `docs/specs/红队R1-框架审查-20260913.md` | **R1 框架审查**（91 行，16 发现 F1-F16；4 条「高」＝F2／F3／F4／F16） |
| `docs/specs/红队R2-复核-20260913.md` | **R2 对抗复核**（175 行：判定 13 成立／3 部分／0 误报 ＋ F2/F3/F4 修法评审 ＋ F16 未真封死） |
| `docs/specs/红队R3-复盘与决策清单-20260913.md`（本目录外） | **R3 复盘（清单式）**：R1/R2 后框架现状 8 项 ＋ 3 题决策清单（D2/F4 时机、命题 A 接线、R4 阈值）＋ 覆盖度声明 |

### 专家会阅读包
| 件 | 说明 |
|---|---|
| `docs/specs/专家会阅读包-文件清单-20260913.md` | **66 条路径全部经 Node statSync 核验命中**＋最短路径/红队链/判据/裁决/PREREG/账本/代码入口分段＋覆盖度声明 |

### 施工路径（最终版）
| 件 | 说明 |
|---|---|
| `docs/specs/施工路径与耗时-最终版-20260913.md` | **施工路径最终版**：R4 门距实测 ＋ 12 项剩余路径（顺序/依赖/耗时/验收）＋ 两项待定口径 ＋ 串行红线 |

### G2 口径修订 R4 与 F16 残留修复（2026-09-13 深夜）

| 件 | 说明 |
|---|---|
| design **§4.2** | **G2 能力门修订 R4**（用户拍板选项 A）：累计≥60 合格题／抽检≥70%／horizon 三层下限／难度分层下限 b(1−b)≥0.21 且 ≥20 条／月节律仅报告 |
| 变更留痕索引 **§6** | R4 判据变更登记（本节即"判据变更→变更留痕索引"一类） |
| commit `3798165` | F16 残留修复：4 个语料脚本 `checklist_hash`→`checklistHash` + 补 `publicExposure:0`（修前这 4 个脚本重跑 inserted=0）＋ oct 脚本首次入库 |
| 在跑 | 语料源再扩量棒（agent 0e84f118）：15 个已用域扩 ≥300 条 ＋ 攻 deferred 域 17/19/2 ＋ 探 ≥10 新域 |

> **入口提示**：唯一入口已推进至 `.scratch/handoff/推演沙盘-交接-20260913-深夜.md`（2026-09-13 03:31，覆盖本文件 §0 所列晚版）。

### 阶段 3 出口件：开放接题最小闭环（2026-09-13）
| 件 | 说明 |
|---|---|
| `p1b/src/routes/intake.js` + `p1b/src/db/intakeStore.js` + `p1b/test/intake.test.cjs` | **对外开放接题**：POST `/api/intake/classify`（拒收门三问 + 六层判定 + `unknown` 出口 + L4 后置叠加 + layer→引擎映射骨架，gate=descriptive 只记账不出数）＋ GET `/api/intake/rejects`（拒收原因分布含 0 计数）；additive 新表 `intake_rejects`（生产库零写，临时库验证）；`万物分类清单-v2.md` 追加 v3 注记（红队 R1-F1/R1-F13 修法）；`node --test` **193 pass**（基线 177 + 16 新） |
| `p1b/src/db/intakeStore.js`（`predictions_r4` 视图 + `intake_questions` 表） + `p1b/scripts/g2-report.cjs`（`--include-intake`） | **D-8.1/D-8.2 落地**（design §8 用户拍板 A）：additive 新表 `intake_questions`（外部题挂载，classify 通过落行）+ 只读归一视图 `predictions_r4`（predictions ∪ intake_questions，origin 区分）；`g2-report --include-intake` 默认**关**，开关只加「含接题层未入账题，非 G2 口径」披露节，**不改变 Q1-Q5/gate 主读数**；F13=**半闭环**（入账层待与 F4 真值分库合并迁移）；`node --test` **198 pass**（基线 193 + 5 新）＋ 端到端 15 PASS |

### D2 历史回测引擎规格（2026-09-13 · 只写文档，不写实现）
| 件 | 说明 |
|---|---|
| `docs/specs/历史回测引擎-规格D2-20260913.md` | **D2 规格 v0（10 节）**：目的/非目的 ｜ cutoff 技术强制（以「回测进程能否 SELECT 到真值」为防作弊复测判据）｜ F4 分库接口（**分库未落地不得开跑**）｜ horizon×layer×难度分层禁混算（难度用外生基线 b(1−b)）｜ 诚实标注恒挂「历史回测·非实时能力」｜ 天气 archive 单源原型验收 A1–A7 ｜ kill_test ｜ 与 R-A/R-B/R-C 关系（**禁改 checklist_hash**）。 |

## 5 · 铁律速查（违反=弃棒）

①玄学恒挂娱乐参考，绝不接研判 ②UI 禁「预测」字样（用审计/校准参考/分层账本）③无真值锚不入账本（Q0-1/2/3 拒收门）④LLM 仅四角色（聚合/基率/多路/校准）⑤key 不出服务端 ⑥预注册冻结后禁改 ⑦账本不可变 ⑧**派单并发上限 2-3 棒** ⑨8787 用户 bat 管理，代理零接触 ⑩微步回合制（先落盘再设计）

## 6 · 当前状态（2026-09-12 晚）

- 阶段 0 ✅ 已完成（games 46 / records 736 / n_real 11）
- 阶段 1 ✅ 已收口（R-C 负结果定版，机械直算接管）
- 阶段 2 🔨 施工中（语料 22→286 条；检测层落地；适配器落地）
- 阶段 3 ⏸ 等 G2（月 resolve≥30 连续 2 月，最快 11 月底）
- **唯一卡用户**：G1 本机实测（重启 bat → /audit 页看新画面）

## 7 · 当前状态（2026-09-13 深夜 更新 · 阶段 3 已转正）

> §6 为 2026-09-12 晚的历史快照，保留不动；本节为最新状态。

- **阶段 0 ✅ / 阶段 1 ✅**（同 §6）
- **阶段 2 ✅ 基本达成**：语料主线大幅超目标 —— 题量 472 → **1923**（合格池 1046）；games 72 → **85**；源 3 → **27+**（15 个可出题域 + 8 个新域）；**F16 命名漂移已修**（checklist_hash 空值 0）
- **阶段 3 ✅ 已转正（2026-09-13）**：G2 能力门按 **§4.2 修订 R4** 五条全 PASS —— ① 合格题 1046／② 抽检 **100.0%（采信 YES）**／③ 长 horizon 21／④ 最难档 808／⑤ 月节律报告项；收据 `p1b/sim/out/g2-report-r4.out`。**L3 检索代码解禁仍须另行评审立项**（终审原文），本转正不构成解禁。
- **阶段 4 🔨 施工中（2026-09-13 起）**：L2 系综／L5 不可约先行；L3 配 ACI；L6 用命题 A 成果（**证据块 3.0 已接线**，可消融）
- **阶段 3 待补出口件**：开放接题最小闭环（拒收门 Q0-1/2/3 ＋ 六层分类入口 ＋ 分层引擎路由 ＋ 拒收日志）**尚未落地**，现状仅 `p1b/src/adapters/avalon.js:478-488` 适配器级原型
- **门之外的真缺口**：④ 覆盖（池内 174 条无 baseRateNote）｜433 条积压（b3/wide/b4 新 kind 无 resolver 实现，取数函数在移植中）｜数据清理（dlt 3 重复局、usgs/ghrel 空局）｜**F4 真值分库三步**（D2 开跑硬门 G-D2-0）
- **唯一卡用户**：G1 本机实测（重启 bat → `/audit` 看三层递进审计页）
