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
| `p1b/web/dist` | 最新 bundle index-BiMu1AXn.js（2026-09-13 重建；旧 BRXPntAZ 已被 vite 清除） |

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
| `docs/specs/历史回测引擎-规格D2-20260913.md` **§11 修订节（2026-09-13 · 专家会批次 2）** | #3 影子题面库＋authorizer 硬验收（A2a–A2d＋故障注入；敏感名显式枚举；物理分库设触发条件）｜ #4 K2 统计容差 `max(0.01,1.96·sd/√n)` ｜ #5 K3 置换操作化（配对置换/N=1000/p<0.01/基线臂豁免）｜ #15 resolution-ECE 操作化（Murphy＋等宽 10 桶＋bin 计数＋双标注＋bootstrap CI）｜ #16 §4 部分池化（HB，先预注册）＋「首批有结论单元 ≤N_unit」｜ §8.2 `metric_version`/`backtest_batch` 升必须。**原条款未删** |

### 专家研讨会（20260913 深夜 · 红队两路+查阅两路+头脑风暴+交叉对抗 · 详目见研究档案索引）
| 件 | 说明 |
|---|---|
| `.scratch/forecast-debate/研讨会-20260913/00-专家会纪要与裁决.md` | **会议入口与主持人裁决**：四议题结论+统一修复清单 22 条（阻塞 5/高 5/中 9/低 3）+前五方案生存判定+5 争议点裁决+执行排程七批 |
| 同目录六件产出 | 红队A-方案审查（**A20 不可逆级**：D2 回测题落库矛盾+G2 零排除）/红队B-科学性审查（**B-H1 门零质量指标**/B-H2 ②采信链循环）/查阅A-外部对标（**命题 A 空位维持+时间窗挤压**）/查阅B-盘上实证/头脑风暴（25→8→5）/交叉对抗-合议纪要 |
| **核心定性** | G2-R4=**过程能力门**（不含预测质量读数，对外表述恒挂限定语）；命题 A 定性「限时抢跑」（先补 3.0 消融 PREREG 再跑首报）；施工线注意：阻塞级 5 条（落库位置/写端补列/影子库/K2/K3）须在任何 D2 相关施工前完成 |

### G2 口径修订 R4.3 与契约表 date_derivation（2026-09-14）
| 件 | 说明 |
|---|---|
| p1b/sim/out/g2-contract-frozen-r4.json | **契约表扩展**：顶层 date_derivations **22 kind** 到期日换算规则＋previous_sha256；sha256 bafd3d389a91…→**007b41188807…dbaa260dbf**（contracts 34/aliases 25 原字段零改动；依据 docs/specs/决策brief-月度年度resolve.date口径-20260914.md §5，用户批口径 B） |
| design **§4.2.4 修订 R4.3** | **① 池入池判定扩展**：resolve.date 或 date_derivation 换算 effective_date（到期＝数据发布日，保守近似）；backfill 172 行维持排除（PREREG 锚＝statement 标记，非 phase 键）；规则表锚 SSQ 日/二/四·DLT 一/三/六·BOM 年内第 NN 个周日（仅 2026 年段，跨年需新锚） |
| p1b/scripts/g2-report.cjs（+66 行 additive） | date_derivation 接线＋逐 kind 披露（换算入池 427/failed=0）；backfill 排除标签改名 backfill_no_forwardLooking |
| 存量化补列（微步 3） | 254 行前瞻 matures_at=effective_date（1058→1312 non-null；写前快照 sha 5a72ef3f…，integrity ok）；读数不变 |
| 读数 | ① 1058→**1312**｜③ 长 33→**197**（短 439/中 147）｜④ **1120**（覆盖 1312/1312）｜**门 PASS 不翻转**｜测试 226 绿｜收据 p1b/sim/out/g2-report-r4-dd-gated.out|.json |

### 双链统一（用户 20260914 裁定 · 模型配置＝唯一真源 providers.json + 全链路可观测性）
| 件 | 说明 |
|---|---|
| `docs/specs/双链统一-验收收据-20260914.md` | **验收收据**（commit 709059d）：根因更正（实测推翻「judge 走 env 绑死」——env 全未设置、verdicts.js:381 早已读 providers.json）+ 两条真实缺陷（可观测性缺口／cards.model 过期覆盖）+ 四条验收标准对照 + 遗留边界 |
| `p1b/src/llmOptions.js` `describeEffective()` | 全链唯一事实源（mode/provider/base_url/model/key_source；env 兜底 stderr 披露）；与 p1a llm.js resolveMode 同口径 |
| `GET /api/providers/effective` | 脱敏实时读数（无缓存）；UI「实际生效」面板数据源 |
| `verdicts.resolved_model`（additive 加列） | 事实层，与声明层 `model`（配对键，禁改）分离；生产库已迁移（快照 sha256 `33210a1f…`，3662 行不变/integrity ok/旧行 NULL） |
| 缺陷修复 | `providersStore` cards.model 留空覆盖 → 留空跟随抽取模型（**UI 切模型不生效的真根因**） |
| 证据 | 测试 226→**230 全绿**；探针 4 场景 + E2E（`resolved_model: e2e-model-A → e2e-model-B`）+ Playwright 浏览器实测（临时端口 8799，8787 零接触）；截图 `p1b/sim/out/ui-refactor/settings-effective-*.png` |

### R4.3 → R4.4 版本递进（专家会 #12/#13 · ① 池层域限制 ＋ ② 域维度 ＋ 基率窗口质量）
| 件 | 说明 |
|---|---|
| design **§4.2.5 修订 R4.4** | **#12**：写明「① 池按设计只收 L2/L3」为明文设计决定（防 PREREG-RB/R-C 口径纠缠）；L1/L6 等价锚列为 **R5 议题**；② 分层维度扩为 `layer × horizon × 域`＋单族 >50% 时样本等量降权（披露+加权，不设硬门） |
| `g2-report.cjs`（additive） | **#13**：`parseNoteN` 抽窗口样本量＋Wilson 95% 区间＋薄窗披露（最难档 n<30 = **21** 条；b̂ 上界仍≥0.30 的保守读数 1020/1020）｜**#12**：pool 增 `kind` 域维度＋`top_domains`（单族最大 openmeteo_air 128 = 9.8%，未触发降权） |
| 读数 | ① **1312**／③ PASS／④ **1120**／**门 PASS 不翻转**｜测试 226→**232**｜收据 `p1b/sim/out/g2-report-r4.4.out|.json` |
| 变更留痕 | 变更留痕索引 §17 |
| 勘误 | 交接件 §7 曾称 `g2-report-r4-dd-gated.out` 未落盘——**实为存在**（2026-09-13 18:47），该存疑撤回 |

### 序 6 用户侧作业就绪（G1 实测清单 ＋ ② 端用户抽验通道 · 2026-09-14）
| 件 | 说明 |
|---|---|
| `docs/specs/G1实测清单-20260914.md` | **G1 实测清单**（专家会盲区①指派件）：三判据逐项步骤+判据+记录栏；与端用户抽验 ≥10 题**合并为同一次用户作业会话**；含前置/回报模板/卡点排查。**总计 20–35 分钟** |
| `p1b/scripts/g2-user-spotcheck.cjs` | **② 采信第③件的端用户通道**（此前缺，用户结构上无法完成抽验）：`--emit` 出人可读 10 题表 / `--record` 写回并重算 acceptance。只读库、只写 audit JSON |
| `p1b/sim/out/g2-user-spotcheck-table.md` | 已出好的 10 题抽验表（待用户填 PASS/REJECT） |
| 测试 | `p1b/test/g2-user-spotcheck.test.cjs`（3 例）；全量 **235/235** |
| 变更留痕 | 变更留痕索引 §18 |

### G1 实测（代理代跑 · 2026-09-14）
| 件 | 说明 |
|---|---|
| `docs/specs/G1实测报告-20260914.md` | **G1 三判据实测报告**：①录入 ≤30s **PASS**（中位 21ms）｜③对跳矛盾 **PASS**｜②参谋卡机制层 **PASS**、主观层待用户确认。含「MOCK 抽取器伪影」定性（引擎逻辑正确）与诚实限定 |
| `p1b/sim/out/g1/`（8 件） | 原始证据：录入计时／参谋卡全文／矛盾检出（宏 vs 自由文本 vs 引擎直测）／抽验预核 |
| 抽验 provenance 护栏 | `--by user\|agent`：代理预核 `effective=0`，acceptance 恒 `pending_user_agent_surrogate`，**结构性不可冒充端用户**；`review_composition.end_user` 与 `agent_surrogate_spot_check` 分开计数 |
| 执行方式 | 隔离实例 :8801 ＋ 独立库副本 ＋ MOCK LLM；**生产库/8787 全程零接触** |
| 变更留痕 | 变更留痕索引 §19 |

### 阶段 4「分层预测真跑」首轮（2026-09-14）
| 件 | 说明 |
|---|---|
| `docs/specs/阶段4-分层真跑报告-20260914.md` | **真跑报告**：L2 可计分 **264** 题、Brier(engine)=0.2487 vs 0.5=0.2500、**Δ=−0.0013 CI 含 0 ⇒ 不可声称优于**；L5 **0 可计分**（认证值在文本非结构化源 ＋ 开奖真值未发生，两重原因） |
| `p1b/scripts/stage4-run.cjs` | 只读真跑器（分层报禁跨层池化；配对 bootstrap B=1000/seed 987654321；L5 形态缺口单节披露，不静默降级） |
| 测试 | `p1b/test/stage4-run.test.cjs`（3 例：分层独立／不编数／确定性）；全量 **239/239** |
| 出口 | 阶段 4：架构预留 → **施工中（真跑首轮完成，尚无增量结论）**；下个真问题＝给 L2 配对照臂 |
| 变更留痕 | 变更留痕索引 §20 |

### G1 材料更正 ＋ bug-27 修复（2026-09-14）
| 件 | 说明 |
|---|---|
| **更正** | G1 报告初版让用户看 `card-full.md`（**MOCK 罐头卡**，非真实 LLM 输出）——已撤回；改用 `p1b/sim/out/g1/card-real.md`（生产库导出的真实卡片，6 条真实假设＋3 条矛盾） |
| `p1b/sim/out/g1/card-real.md` | 真实参谋卡（局 1/局 2）；甄别方法＝mock 有固定指纹（`号悍跳狼的常规局`／`无人悍跳，矛盾源于信息差`／`负例`） |
| **bug-27 修复** | `POST /day/:n/advise` 同日重复结算导致参谋卡重复入库（生产库 game1 实证 7 条假设/3 条同矛盾）。修法＝p1b 侧保存前清当日旧卡（**同日＝覆盖**），**不动禁改面**；测试 240→**241** |
| 待用户拍板 | 局 1 历史脏数据是否清理（早期集成验证局、0 predictions 引用；属账本不可变边界，不擅删） |
| 变更留痕 | 变更留痕索引 §22 |

### bug-28（cwl kind 硬编码）＋ bug-29（Energy-Charts 口径）＋ 积压结清（2026-09-14）
| 件 | 说明 |
|---|---|
| **bug-28** | 3 行「蓝球为奇数」题因 v1 写入器硬编码 kind 带 `ball=null` 入库（`indexOf(null)` 恒 -1 ⇒ **恒判 false** 风险）。三处修：解析器拒判护栏＋写入器按 combo 分流＋数据改写；**零污染**（3 行全未 resolve）；补 `corpus-resolve.cjs --db` 参数；测试 242→**244** |
| 收据 | `p1b/sim/out/bug28-cwl-kind-receipt-20260914.md` |
| **bug-29** | `energycharts_daily_mean` ①UTC 日过滤 ⇒ 均值偏差 **~8%**（fr −8.33%／es −7.96%）②`n<80` 硬阈值 ⇒ 小时粒度 be 4 行**永久卡死**。修为本地日全窗口＋实测步长自适应；**24 条已 resolve 行 0 翻转**（历史数据不回改） |
| 收据 | `p1b/sim/out/bug29-energycharts-receipt-20260914.md` |
| 积压结清 | daemon `--confirm`：**已解 1238→1263**（resolved=25，wouldWrite=0，104s）；14 条过期未结清零；pending 28＝真等时间／fail 5＝上游抖动 |
| 附带收口 | 局 1 重复参谋卡清理已执行（用户拍板；keep-rule＝保非 mock/更丰富者，收据 `p1b/sim/out/cleanup-g1-dedup-receipt-20260914.md`）｜L2 `parseCount` 句式与 g2-report 三正则对齐｜判据② 用户答复「有思路」记入 G1 报告（≠端用户抽验完成，③ 仍 pending） |
| 变更留痕 | 变更留痕索引 §23 |

### ② 端用户抽验记账（用户本人裁定）＋ 实施计划（2026-09-14）
| 件 | 说明 |
|---|---|
| 事件 | **端用户本人**对 10 题一屏表裁定「都过」（带保留原话已原样留痕）→ `--by user` 记账：**10/10 = 100%**（Wilson95 [0.722,1.000]）；`review_composition.end_user` 0→**10**、agent_surrogate 10→**0** |
| acceptance | `pending_user_agent_surrogate` → **`pending_recheck`**（必要条件③ 完成；余 ② 规则②＝人类校准 **14→≥35**） |
| 门读数 | G2-R4.4 五条不受影响（门②阈值＝抽检合格率≥70%，已 100%）；冻结收据不重跑 |
| 收据 | `p1b/sim/out/g2-user-spotcheck-user-receipt-20260914.md`；填写件 `g2-user-spotcheck-filled.user.tsv` |
| 代码 | `g2-user-spotcheck.cjs` +`--note`（核验者备注只追加不覆盖）；测试 244→**245** |
| **实施计划** | `docs/plans/2026-09-14-通往最终目标-分步实施计划.md`（**三幕七任务**：②补检／阶段4增量／命题A终态／开放接题闭环／通俗说明／简化重构／收尾） |
| 变更留痕 | 变更留痕索引 §24 |

### ② 采信链规则② 校准补样 21 项 ⇒ **② accepted**（2026-09-14）
| 件 | 说明 |
|---|---|
| 通道 | 新脚本 `p1b/scripts/g2-hcal-expand.cjs`（emit/record；理由必填防凑数）＋测试 3 例（全量 **248/248**） |
| 抽样 | 「最可能分歧」：边界基率 13 ＋ 长窗 2 ＋ 顺延 6（seed 20260914，排除首轮 14 条） |
| 结果 | **21/21 PASS** ⇒ hc.n **14→35**、Wilson95 **[0.9011,1]** ⇒ acceptance `pending_recheck` → **`accepted`** |
| 复核真发现 | cmp0 措辞 bug（已实抓复算证 b 正确）｜GMT 口径披露项 ×6｜薄窗 ×2｜潮汐窗越 cutoff ×1——全入逐项理由，无 Q0 拒收 |
| 诚实边界 | 补样＝**代理**执行（非端用户/非全人工，audit 明写）；③ 端用户 10 题 by=user；可作废重判路径已留 |
| 收据 | `p1b/sim/out/g2-hcal-expand-receipt-20260914.md`；复核对 `…-sheet.md`／填写件 `…-filled.tsv` |
| 变更留痕 | 变更留痕索引 §25 |

### L5 认证源「读侧」结构化 —— L5 首次可计分（2026-09-14）
| 件 | 说明 |
|---|---|
| 实现 | 新 `p1b/src/engines/l5_sources.js`：`L5_CERTIFIED_RULES`（kind ＋ **变体判别** → 精确组合数；含大乐透「前区最大号 ≥m」= 1−C(m−1,5)/C(35,5)）＋ `certifiedSourceForRow()`（可直喂引擎）＋ 文本三态交叉核对（矛盾不静默）＋ 退化拒收 |
| 接线 | `stage4-run.cjs` L5 臂：写端结构化优先 → 读侧兜底；来源分类披露节；**L5 口径改写**（vs 0.5 的 Δ＝平凡读数，不构成"更准"宣称） |
| 读数 | L5：108 出数/108、可计分 **30**（↑0）、Brier 0.1338 vs 0.25（**平凡**）；L2：可计分 264→**278**（+daemon 结清），CI 微移不翻转 |
| 真发现 | `dlt_draw_result` kind 过粗（两族分流后矛盾=0）｜回填批历史频率不参与一致性（防误报 24 行） |
| 测试 | `p1b/test/l5-sources.test.cjs` 5 例；全量 248→**253 绿** |
| 收据 | `p1b/sim/out/l5-readside-receipt-20260914.md`；读数件 `stage4-run-l5readside-20260914.out|.json` |
| 变更留痕 | 变更留痕索引 §27 |

### L3 引擎落地（stat_baseline + ACI）—— 第三层可计分（2026-09-14 · 任务 4.5A）
| 件 | 说明 |
|---|---|
| 实现 | 新 `p1b/src/engines/l3_aci.js`：p＝基率（复用 l2_baseline 解析/Wilson）＋ **ACI 外环 γ=0.005** × **0.99^内环 EWMA**（F24/F18），只调预测集与覆盖率披露 |
| 接线 | `stage4-run.cjs` 加 L3 臂＋`[L3 ACI]` 披露节；**L3 口径改写**（Δ CI 刚好不含 0 也只算边缘读数，不得声称优于） |
| 读数 | L3 752 行 → 出数 **706** → **可计分 481**；Brier **0.2391** vs 0.25、Δ=−0.0109、CI[−0.0212,−0.0012]；ACI：α_final=0.17025、覆盖 1.000（名义 0.95） |
| 测试 | `l3-aci.test.cjs` 5 例；全量 261→**266 绿** |
| 收据 | `p1b/sim/out/l3-aci-receipt-20260914.md`；读数件 `stage4-run-l3aci-20260914.out|.json` |
| 变更留痕 | 变更留痕索引 §30 |

### L1 引擎落地（proc_calc 程序复算）—— 第四层可计分（2026-09-14 · 任务 4.5B）
| 件 | 说明 |
|---|---|
| 实现 | 新 `p1b/src/engines/l1_proc.js`：6 条规则族从公开记录算 0/1（首夜平安/票差≤1/无弃票/最高票≥4/day1 声称≥10/最高票唯一）；未收录⇒如实不收 |
| 接线 | `stage4-run.cjs` 加 L1 臂（events/claims 只读加载）＋`[L1 复算正确率]` 披露；**口径**：L1 是复算层，Brier 语义＝计算错误率、不与概率层混比 |
| 读数 | L1 180 行 → 出数 **180** → 可计分 **180**；Brier 0.0000 ⇒ **正确率 1.000（180/180 对账）** |
| 口径修正 | 首夜平安排除黄昏致死｜无弃票用总票数之和（均被实证逮出，修正后全对） |
| 测试 | `l1-proc.test.cjs` 3 例；全量 266→**269 绿** |
| 收据 | `p1b/sim/out/l1-proc-receipt-20260914.md`；读数件 `stage4-run-l3aci-l1-20260914.out|.json` |
| 变更留痕 | 变更留痕索引 §31 |

### L6 引擎落地（判词结构聚合）—— 狼人杀/对抗域首批真读数（2026-09-14 · 任务 4.5C）
| 件 | 说明 |
|---|---|
| 实现 | 新 `p1b/src/engines/l6_structural.js`：p＝判词结构聚合（每变体取最新非空 implied_prob → 三变体均值；规则固定可复现） |
| 接线 | `stage4-run.cjs` 加 L6 臂＋**账本先验对照**（assigned_prob，非引擎输出）；L6 口径：判词聚合≠新模型、provenance 披露项明列 |
| 读数 | L6 270 行 → 出数 **270** → 可计分 **270**；Brier **0.1829** vs 0.5（Δ=−0.0671，CI[−0.0847,−0.0494]）；**先验对照 0.1941 ⇒ Δ=−0.0113（点估计）** |
| 意义 | **对局/对抗域（L1+L6）进入分层计分**；**五层齐备**：L1 180／L2 278／L3 481／L5 30／L6 270 |
| 测试 | 五层契约＋L6 不变量；全量 **269/269 绿** |
| 收据 | `p1b/sim/out/l6-structural-receipt-20260914.md`；读数件 `stage4-run-five-layers-20260914.out|.json` |
| 变更留痕 | 变更留痕索引 §32 |

### 2026-09-14 晚 · 结案批次（五层齐备 ＋ 命题 A 结案 ＋ 表达层初稿）
| 件 | 说明 |
|---|---|
| **五层引擎** | L3（`9e25789`）／L1（`9f66ead`）／L6（`7f335df`）⇒ **五层齐备**：L1 180／L2 278／L3 481／L5 30／L6 270；测试 269/269 |
| **命题 A 结案** | 全量 **2153/2160**；主判据 Δ=+0.00272；v1.1 分层（A +0.01438／B −0.02925 方向不一致 ⇒ 以 A 为准）⇒ **止发维持**；报告 §五追加（`a81d18f`） |
| **门读数重跑** | `p1b/sim/out/g2-report-latest-20260914.out|.json`：①②③④ 全 PASS，**② 采信 accepted** |
| **任务 5** | `docs/specs/通俗说明-这套干什么怎么用-v1.md`（**待用户 5 分钟复述验收**） |
| **任务 6 批次 1** | `docs/specs/简化重构方案-v1.md`（B1 清单 6 项；批次 2/3 待开批） |
| **最终交接** | `.scratch/handoff/推演沙盘-交接-20260914-晚-结案.md`（最新唯一入口） |
| **留痕** | 变更留痕索引 §30–§33 |

### 2026-09-14 晚 · 任务 6 批次 3（结构化读数 ＋ kind 目录表 ＋ F4 同批账本操作 ＋ 命名归档）＋ 阶段 5 立项评审
| 件 | 说明 |
|---|---|
| **结构化读数（B1-1）** | 新 `p1b/src/evidence/baseRate.js`＝基率读数**单一真源**（原三解析器 l2_baseline／g2-report／l5_sources 收敛为一份，三处改委托）；新增 `evidence.baseRate = {p,n,k,kind,window,basis,cmp,threshold}`（写端随行落库＝store 写入口物化，覆盖全部语料写手；读端结构化优先＋文本兜底，**旧行零改动**）；**零翻转实测**：stage4-run diff=0、g2-report 仅新增披露节；金样冻结 `p1b/test/fixtures/base-rate-golden.json`（151 条真实注记 × 三读序）＋回放测试 |
| **kind 目录表（B1-2）** | `p1b/scripts/kind-table.cjs` → `docs/specs/kind-目录表.md`（52 kind：取数源＝账本真实 URL 主机／契约必需参数／层分布／引擎／题数已解／源码现位；仅契约与下划线 helper 分列） |
| **F4 同批账本操作** | `p1b/scripts/vault-sync.cjs`：truth_vault 镜像同步 ⇒ **补 12 缺行／对齐 25 陈旧行**，vault 1923→1935 == predictions，对账 missing/orphan/diff **全 0**、integrity ok、predictions 全列 dump sha 前后一致；写前快照 `.scratch/backup/p1a-pre-vaultsync-2026-09-14T15-11-50-344Z.db`（可回滚，剧本实测） |
| **命名整理** | 69 件零活引用探针 `git mv` → `p1b/scripts/archive/`（保历史；有活引用的留置原位）＋ `p1b/scripts/README.md` 目录索引（73 在役脚本按前缀分组；`scripts-index.cjs` 生成） |
| **阶段 5 立项** | `docs/specs/阶段5-检索式预测-立项书-v1.1.md`（评审后修订）＋ `.scratch/forecast-debate/PREREG-检索式预测-v1-骨架.md`（未冻结）＋**独立评审** `docs/specs/阶段5-立项评审-检索式预测-20260914.md`（16 发现／8 必改，已并入 v1.1）；**待用户拍板（含铁律④裁决），拍板前不写检索代码** |
| **测试** | 271 → **284/284 绿** |
| **收据** | `p1b/sim/out/batch3-receipt-20260914.md` |
| **留痕** | 变更留痕索引 §36–§37 |

### 2026-09-15 · 阶段 5 铁律④裁决落盘 ＋ 老行回填（零翻转）＋ 读数件刷新
| 件 | 说明 |
|---|---|
| **阶段 5 裁决** | **信号路线 (a)**＋**铁律④选 (b) 复用「多路」＋实验臂声明（design §2 不改）**；新件 `docs/specs/阶段5-功能映射表与信号源勘察-20260915.md`（功能映射表＋H 先例援引＋29 主机/52 kind 信号源勘察）；PREREG 骨架填要点、**未冻结**；**检索代码未开工** |
| **老行回填** | 新 `p1b/scripts/backfill-base-rate.cjs`：**1271/1485 行**物化（零翻转安全集；排除 203 G2 浮点差＋7 L2 真翻转＋4 不可解析）；**零翻转三证**（副本五层 identical／g2 结构化披露 `0→1128` mismatch=0／生产库写后 identical）＋pureAdd fail=0＋写前快照；测试 `p1b/test/backfill-base-rate.test.cjs` |
| **读数件刷新** | 五层件 09-14 17:25 早于当晚补漏 ⇒ L6 陈旧（0.1829 vs 实测 **0.1755**）；生成 `…-20260915.*`；`board.cjs` 改**自动取最新日期件** |
| **命题 A 收尾** | sweep 补 1 条（pid=128 B/cutoff）；剩 1 条（pid=164 A/cutoff）上游 3×504 停手；verdicts **4766** |
| **自查回滚** | ★ 探针误用非法 runId 写 3 条（4767–4769）⇒ 在线快照＋单事务删除，junk=0／integrity ok |
| **卫生** | `.gitignore` 加「运行产物卫生」块；未跟踪 221→**13** |
| **测试 · 收据 · 留痕** | **285/285 绿**；`p1b/sim/out/receipt-20260915.md`；变更留痕 §38；项目地图 §11 |

### 2026-09-15 · 阶段 5 开工前置 ④⑤ 落地（泄漏探针 ＋ sham/聚合纯函数 ＋ 提示词附件 ＋ 生效源冻结）
| 件 | 说明 |
|---|---|
| **④-A 泄漏三层探针** | `p1b/scripts/stage5-leak-probe.cjs` → `p1b/sim/out/stage5-leak-probe-latest.json`：三层全 PASS、leak=0（工程验证，不看分数） |
| **④-B 聚合规则 / sham** | `p1b/src/retrieval/aggregate.js`（固定规则、**LLM 不出概率**）＋ `p1b/src/retrieval/sham.js`（确定性、±5%）；测试 `p1b/test/stage5-retrieval.test.cjs` |
| **⑤ 生效源冻结** | `p1b/scripts/effective-source-snapshot.cjs`（零 key 自检）→ LLM tokenrhythm/glm-5.3-flash；retrieval 未配置（如实） |
| **PREREG 填实（未冻）** | 谓词逐级计数＋两池指纹（F1 783／F2 627）＋**N_min=256**＋成本公式（失败系数 2.4）＋冻结清单；附件 A 提示词草案 |
| **测试 · 留痕** | 288/288 绿；变更留痕 §39 |

### 2026-09-15 · 阶段 5 检索可行性勘察 —— **路线 (a) 实证否决** ＋ 真值锚缺陷
| 件 | 说明 |
|---|---|
| **勘察件** | `docs/specs/阶段5-检索可行性勘察-20260915.md`（v2；含网络/代理实测、证据产出率、逻辑闭环、「要么空要么泄」论证） |
| **★ 结论** | 路线 (a)「检索式证据」**不可执行**：跨 25 kind 抽 52 题 ⇒ **证据产出率 0/52**；逻辑上**要么空要么泄**；池 100% 是「精确数值点预测」题型 ⇒ 结构性错配 |
| **自查更正** | v1「网络被拦」误判已更正（根因＝node fetch 不走系统代理 `127.0.0.1:2080`） |
| **真值锚缺陷** | `openmeteo_forecast_daily_max` 98 行 `resolved_at` 早于事件日（取预报当真值；实测 3 行翻转） |
| **留痕** | 变更留痕 §40 |

### 2026-09-15 · 真值口径缺陷「丙：排除出池」落地（读取侧排除 · 零账本写）
| 件 | 说明 |
|---|---|
| **判据真源** | 新 `p1b/src/evidence/truthBasis.js`（`NOT_TRUTH_BASIS_DEFECT_SQL()`／`isTruthBasisDefect()`；双条件防误伤） |
| **接入** | `p1b/scripts/g2-report.cjs` ＋ `p1b/scripts/stage4-run.cjs`（含排除计数与指纹披露） |
| **读数变化** | 门不翻转（①1214/④1022 全 PASS）；**L3 账本 752→654、可计分 481→383、Brier 0.2391→0.2404**；余层不变 |
| **测试** | 新 `p1b/test/truth-basis-defect.test.cjs` 4 例；**292/292 绿** |
| **留痕** | 变更留痕 §41 |

### 2026-09-15 · 阶段 5 终态：**(d) 暂缓归档**（路线 (a) 实证否决后）
| 件 | 说明 |
|---|---|
| **终态** | 阶段 5 路线 (a) 被端到端实证否决（证据产出率 0/52 ＋ 逻辑上「要么空要么泄」）⇒ **(d) 暂缓归档**（用户「都行继续」＝授权代理择定） |
| **落点** | 路线图阶段 5 加【终态留痕】；勘察件 §七 改「终态裁决」；PREREG **不冻结**（保留为负结果记录） |
| **重开条件** | ① 有「文本可回答的题源」或 ② 走 (b) 前瞻数值信号 —— 均须另立 brief ＋ 用户拍板 |
| **留痕** | 变更留痕 §42 |

### 2026-09-15 · 阶段 5 路线 (b)「前瞻数值信号」**实测达标** ＋ PREREG 冻结 ＋ **两处自查缺陷更正**
| 件 | 说明 |
|---|---|
| **信号源** | `previous-runs-api.open-meteo.com` 的 `temperature_2m_previous_day{1,3}` ＝ 提前 1/3 天**当时实际发布**的预报存档（**无未来函数**，零 LLM） |
| **PREREG** | `.scratch/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.md`（**已冻结**）＋ **勘误/补充 v1.1** `PREREG-阶段5-前瞻数值信号-v1.1-补充与勘误.md` |
| **正式读数** | 池 105 / 配对 **93 对（186 槽）**：base 0.2644 → signal 0.1057，**Δ=0.1587 CI=[0.1221,0.1901]**；lead1 0.1781／lead3 0.1393；四城同向 ⇒ **四判据全 PASS** |
| **★ 自查更正（留痕 §45）** | ① v1 文首 sha256 **口径未声明**且与兄弟件不一致（**不影响读数**）；② 首次「冻结后确认跑」脚本**静默丢城**（上海 2024 分块 HTTP 失败被 `continue` 吞掉 ⇒ 配对 93→72）却记为达标 ⇒ **该读数（Δ=0.1705/72 对）作废为读数、保留为留痕** |
| **修复件** | 脚本 `p1b/scripts/stage5-forecast-signal.cjs`（**硬失败**＋**池指纹硬门**）｜谓词单一真源 `p1b/src/evidence/stage5Pool.js`｜池锁定测试 `p1b/test/stage5-forecast-pool.test.cjs`（4 例）⇒ 测试 **296/296 绿** |
| **结论** | 路线 (b) **达标维持**（判定依据换为冻结口径 93 对）；**判据本体零变更** |
| **留痕** | 变更留痕 §43/§44（原文保留）＋ **§45（更正）** |

### 2026-09-15 晚 · 到期题例行结算 **37 条** ＋ **勘误 D-C（池口径收紧为冻结名册）**
| 件 | 说明 |
|---|---|
| **例行结算（运维）** | 83 条已到期未结 ⇒ 结 **37 条**（L2 21 / L3 16）⇒ 已解 **1263 → 1300**；`vault-sync` 对齐 34 处（`diff 34→0`、`ok=true`） |
| **★ 执行偏差（如实）** | 原计划副本演练 → 生产落地；但 **daemon 无 `--db`**（恒用默认生产库）⇒ `--confirm` **直接打在/生产库**。走的是既有例行通道（同 09-12/13/14），账本不可变守卫生效、37 条全「机检」 |
| **★ 勘误 D-C** | 例行结算使**活谓词池 105→109** ⇒ 池锁定测试报红；核实＝**合法增长非漂移**（剔除后指纹命中锚），但暴露 v1 §3 漏洞：**池写成「谓词」而谓词是活的 ⇒ 样本漂移**，违反 §6「不补样」 |
| **修复** | **冻结名册** `POOL_ROSTER_FROZEN`（105 id 写死）⇒ **实验只跑名册内**；名册外落 `unrostered_ids` 只披露不入配对。重跑核对 **Δ=0.1587 逐位一致** |
| **读数刷新** | 五层 **L2 278→290、L3 383→387**；门 ①1214 ③ ④1022 全 PASS 维持；② 采信 accepted 维持。测试 **296→297/297 绿** |
| **留痕 / 交接** | 变更留痕 **§46/§47**｜勘误件 §2.6｜**交接件 `推演沙盘-交接-20260915-晚.md`**（最新唯一入口） |

### 2026-09-15 晚 · 阶段 4 出口补齐 —— **分域读数**
| 件 | 说明 |
|---|---|
| **落差** | 路线图阶段 4 出口原文要求「**分域**带校准分数」，而此前读数**只有分层**（L1–L6）⇒ 出口未被满足 |
| **域规则** | 照 design §4.2.5 A 轴：「域＝题源 kind 族，前缀归一」⇒ 单一真源 `p1b/src/evidence/domain.js`（`resolve.kind`→`evidence.kind`→`games.game_type`→`(unknown)`） |
| **实现** | `p1b/scripts/stage4-run.cjs` 增 `by_domain`（**additive**：改前/改后五层数字**差异总数 0**） |
| **实测** | **28 格**：n≥30 可出结论 **6 格**（L1·werewolf_sim 180｜L2·dbnomics 79｜L2·energycharts 57｜L3·openmeteo 357｜L5·cwl 30｜L6·werewolf_sim 270），样本不足 **22 格** |
| **★ 关键结论** | ① L3 的 357/387 全在 `openmeteo` 一族（**单族 92%**）⇒ 该层分层读数实际≈单域读数；② 多数域 n<30 ⇒ 现阶段**只有 6 个域能拿数据说话**，属**数据量**问题非口径问题 |
| **测试 / 留痕** | 新 `p1b/test/stage4-domain.test.cjs`（6 例）⇒ **303/303 绿**｜留痕 **§48**｜地图 §18 |

### 2026-09-15 晚 · **基率解析缺口修复（版本递进）**
| 件 | 说明 |
|---|---|
| **根因** | ① 解析器数字窗口 `[^0-9%]{0,12}?` **太窄**（「365 个 PM10 日均中」间隔 5 字符落窗口外）⇒ 取不到 n；② 58 行结构化 `baseRate.n=null` ＋ 引擎「结构化优先不回退」⇒ 误触发 n<30 拒出数 |
| **修复** | `baseRate.js` `parseCount` **增第 4 条句式**（旧三条未动 ⇒ 旧取值零变化）｜`l2_baseline.js` **结构化缺 n 时回退文本**（仅 n=null；**p 仍取结构化**） |
| **读数变化** | L2 出数 569→**587**、Brier 0.2521→**0.2494**；L3 出数 608→**654（缺口清零）**、Brier 0.2405→**0.2426**；**L1/L5/L6 identical**；**门读数 ①②③④ 全不变** |
| **分域** | 可出结论 **6 → 7 格**（新增 L2·noaa n=35） |
| **金样版本递进** | 旧金样留档 `base-rate-golden.pre-nfix-20260915.json`；重冻结 diff **精确命中 1 条**（id 875），其余 150 条逐字未变。**测试 303/303 绿** |
| **性质** | **读数口径变更**（如实披露，非纯补漏）；修复不涉编数（n 全部来自注记原文、p 一字未改）。留痕 **§49**｜地图 §19 |

### 2026-09-15 晚 · **D2 历史回测引擎立项并跑通**
| 件 | 说明 |
|---|---|
| **定位更正** | **D2 不在路线图阶段列表内**（红队 R3 决策清单的可选加固项）⇒ 本次为**新增立项** |
| **立项件** | brief `docs/specs/D2立项-brief-v1-20260915.md`｜PREREG v1 **已冻结**（sha `70cf9d17…`）｜v1.1 勘误（四处） |
| **前置** | **G-D2-0 三点验收 PASS**；影子库重建对齐 1935 行；⚠ 隔离是面级＋契约级（非内核级） |
| **四处勘误** | D2-A cutoff 锁死 horizon／D2-B 批题量失控（33,949）／D2-C 漏 HB 条款／**D2-D「极」档与基率域数学互斥** |
| **跑批** | 400 题／4 城／12 月；**A1–A7 ＋ K1–K4 全 PASS**；**泄漏率 0**；全批 Brier 0.2137 vs 0.5 的 0.2500，**Δ=−0.0363** |
| **落地件** | `p1b/scripts/d2-{build-questions,run-backtest}.cjs`｜`p1b/test/d2-backtest.test.cjs`（8 例）⇒ 测试 **311/311 绿** |
| **留痕 / 地图** | **§50**｜地图 §20｜产物 `.scratch/backtest/d2-{questions,report}.json` |
### 2026-09-15 晚 · **薄域补量脚本（C 线）：副本验证完成，生产库未动**
| 件 | 说明 |
|---|---|
| **背景** | 阶段 4 分域读数显示 **21 个域 n<30** ⇒ C 线＝扩语料养厚 |
| **脚本** | `p1b/scripts/corpus-thicken.cjs`（9 个薄域配方；Q0-2/Q0-3 合规、真值锚须有现役 resolver、零 LLM） |
| **幂等** | canonical key（resolve 规范化 JSON 哈希）＋ **每域 30 条硬闸** |
| **副本验证** | 生产库**零接触**；净新增 **99 条**；生产库仍 **1935/1300**、integrity ok |
| **实测增益** | wikimedia 27→**63** ✅｜frankfurter 14→**38** ✅｜npm 7→22／github 6→21／mlb 5→8／crossref 0→3／nvd 0→3（⚠ 仍差）｜**kraken／elexon 配方失效 ❌** |
| **演练拦下** | ① 跨轮堆题（三轮 +99）⇒ 加**每域硬闸**修掉；② kraken/elexon 取数 0 ⇒ **未修，如实标注** |
| **待拍板** | **是否落生产库**（1935 → 2034）：**A** 只落已验证 7 域（推荐）／**B** 先修 kraken+elexon／**C** 暂不落 |
| **留痕 / 地图** | **§51**｜地图 §21｜快照 `.scratch/backup/p1a-pre-thicken-2026-09-15T11-51-28-871Z.db`（sha `137e3068…`） |

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
