# p18-PROGRESS · G1 反馈施工棒：排盘解读 + 卡详情修复 + 审计器仪表盘（微步 M1/M2）

日期：2026-09-13 ｜ 执行：G1 反馈施工棒 ｜ 状态：**M1 完成停等验收**（M2=审计器仪表盘 /audit，待 M1 验收后开工）

> 档名说明（如实）：任务书原指定「p17-PROGRESS.md M1 节」，但 p17 已被并行判词修复 2.0+R-C 线占用（其 M1 完成停等验收中），为不污染他线验收记录，本棒改用 p18——冲突已回报队长裁量。

前置：G1 实测四条反馈；本棒执行其中三条 UI 件（第四条场景适配另派）。8787 服务零接触（用户 bat 自起，dist 已 rebuild，**用户重启 bat 后生效**）。

## M1 · 排盘解读 + 卡详情修复

### 1. POST /api/oracle/interpret（G1 反馈 #1：排盘页起卦后无解读）

- **新端点（扩展走 wrapper）**：`p1b/src/routes/oracleInterpret.js` 新建（oracleCast.js 本体零改动）——body `{id}` 读 oracle_readings 该条 casting，**复用 P8 断语链**（`require('./oracle')` 导出面 ORACLE_SYSTEM_PROMPT/buildUserPrompt/capVerdict + lib/oracle.mockVerdict + lib/llmChat.chatText）：system 首行「娱乐参考，非游戏研判」、断语 ≤120 字（硬截 200）、**mode 三态 mock/live/mock_fallback 同 P8 契约**、LIVE 失败落确定性模板并如实带 llm_error；恒挂 disclaimer「娱乐参考」。
- **写回结构位（P9 预留）**：`p1b/src/db/oracleStore.js` 增补 `updateOracleReadingVerdict(id, verdict)`（UPDATE 同行，幂等不新增行；additive）；`p1b/src/server.js` 单行注册（require+register 同一句，沿 p9 先例）。
- **前端**：`web/src/api.ts` + interpretOracle；`web/src/types.ts` + OracleInterpretResult；`web/src/pages/mystic/MysticPage.tsx` 出卦后自动 interpret 一次（interpSeq ref 防连续起卦串台），断语区 `data-testid=mystic-verdict` 恒挂页面「娱乐参考 · 非游戏研判」横幅下：mode=live 显 LLM 断语；mock/mock_fallback 显模板并如实标注（llm_error 透出）；**interpret 端点不可达 → 纯前端静态白话兜底（卦名+体用五行+动爻一句话，零 LLM 零网络）**；回看抽屉 verdict 落位即显示。mystic.css +6 行断语区样式。

### 2. 卡详情「点了没反应」复现与修复（G1 反馈 #2）

**复现（CDP headless Edge :9229 只读驱动 8787 部署版，p7-drive.mjs 模式；临时驱动即用即删）**，三条根因全实锤：

- **RC1 静默失败（主凶）**：历史卡 chip → useAdvise.openServerCard 无 try/catch，404/网络错被 `void` 丢弃——实测：fetch 注错 404 后点 chip，advisor-card 不变、页面无任何报错、console 零输出（旧 dist）。
- **RC2 管理页详情离屏**：ManagePage 长列表（39 局），点「详情」后 GameDetail 渲染在列表**底部 4560px 处且零滚动**（实测 detail top=4560、viewport 808、scrollY=0）——点完毫无可见变化。
- **RC3 陈旧任务永卡**：localStorage 残留 runningTask（服务重启后任务 404）被轮询静默吞掉，strip 永久「生成中 604s」（实测复现）。

**修复（均 additive）**：

- `web/src/pages/live/useAdvise.ts`：openServerCard 包 try/catch → 失败置 cardsErr 并保留当前视图（不闪空）；轮询 catch 对 **ApiError 404** 清除陈旧任务 + onFailed 如实播报「参谋卡任务已不存在（服务可能重启过），已停止等待」。
- `web/src/pages/live/AdvisorZone.tsx`：cardsErr 两种来源都可见——local=服务端不可达兜底说明（原文案保留）；server=单次打开失败「⚠ 第 N 天存档打开失败：…」（role=alert）。
- `web/src/pages/ManagePage.tsx`：pick(id)+selSeq → 详情块 ref scrollIntoView（首挂仅 LS 恢复选中不滚，保留列表视图）。

### 测试与证据

- **后端全量：node --test 167/167 全绿**（0 fail；基线 158 + 本棒 interpret 新测试 8（201 形状/娱乐参考字面/幂等两次 201 同断语不新增行/readings 回读落位/400×4/404/LIVE 缝/mock_fallback 缝）+ 并行线新增 1）。
- **build：`npm.cmd run build`（tsc && vite build）exit 0**，74 modules，dist 新 bundle `index-CatPXW5g.js`（旧 hash D5B55823…→新 CatPXW5g，dist 落新实锤）。
- **端到端回归（新 dist，隔离实例 :8899 + DB 临时副本 + P1B_LLM_MOCK=1，8787 零接触）**：A 断语区出现/头标「娱乐参考（非游戏研判）」/含本卦名（实测「山水蒙」）/抽屉显示已落位断语；B chip 正常链路不回归（advisor-card 渲染）；C chip 404 → 报错行可见（修复前静默）；D 陈旧任务清除+「任务已不存在」横幅可见+LS 已清；E 管理页详情滚入视口。**全部 PASS**。
- 8787 health 复核 OK（llm_mock:false 原样）；临时驱动/DB 副本/Edge profile 已删（Test-Path=False 复核）。

### 纪律与边界

- 未动：p1a-terminal/**、p1b/src/botc/ 五文件、meihua.js、oracleCast.js 本体（lib+routes）、PREREG 两冻结件、p12/p14/p16/p17 已发布节、8787 进程与用户数据（隔离实例用临时副本）。
- 如实备注：用户 G1 测试局 #38/#39 在库 events=0（天结算预检 400 属预期，页面有文案）；其局参谋卡历史为空与「无存档」文案一致，非本 bug。AdvisorCardView 本体未改（条件渲染链路复现无恙，问题在调度层）。

---

## M2 · 审计器仪表盘首屏（待 M1 验收后开工）

（占位：/audit 页四块——①账本分层（predictions 按 layer×checklist_hash 统计+l0Gate 双口径）②分层校准报表（report-layered 口径+R-A/R-B Brier 汇总静态区，标注探索性）③六层分类说明卡（L1-L6 词表+引擎姿态，词汇中立）④哨兵与门禁状态卡；**UI 铁律：全文禁「预测」字样（用「审计/校准参考/分层账本」）；狼人杀专属词零出现（game_type 中立词+六层词汇）；纯展示零 LLM**。词汇依据 PREREG-RB-v1 判据节 + p16 M2 双口径。）

## 语料库首批落库（corpus 棒 2026-09-12 · Top3 非对局题源 · 勘察报告=docs/specs/语料库扩展-公开数据源勘察-20260913.md）

- **三条合成局**（db.createGame，player_count=1 占位席）：#40 corpus:openmeteo / #41 corpus:dbnomics / #42 corpus:cwl。（原注「games 表无 source 列」**系误报，已更正**——见下方更正注记；source 列=sim M0 additive 加出，三局现已 UPDATE source='corpus'。）
- **四条 predictions**（七审计列齐全：checklist_hash=v2+gate=descriptive+public_exposure=0+tautology=0，evidence_json=cutoff 快照含 resolve 参数）：
  - #451 L3/engine=aci prob=0.01「上海 2026-09-14 日最高气温>35°C」cutoff=2026-09-12T15:02:08+08:00（ingest 实抓冻结）；快照=09-14 预报 30.2℃+气候基率（2015-2024 九月 300 天仅 3 天>35℃，Open-Meteo archive 实抓）
  - #452 L2/stat_baseline prob=0.4502「2026-09 月 USD/EUR 月均（ECB/EXR/M.USD.EUR.SP00.A）<1.15」cutoff=2026-09-01T00:00+08:00；快照=历史占比 149/331（截至 2026-07 pre-cutoff 已发布口径；08 月值发布于月后未计入）
  - #453/#454 L5/engine=none prob=0.1818/0.5「双色球 2026106 期红含 07 / 蓝为奇」cutoff=2026-09-13T21:15+08:00 开奖前；快照=组合数学（6/33、8/16）+「2026106 未开奖（最新=2026105@2026-09-10）」核验，零泄漏
- **l0Gate 双口径**：落库前 records=450/records_valid=420/games=30/unresolved=0 → 落库后 454/424/33/4（review_unlocked=true 不变）。
- **幂等+防误触**：statement 带【corpus:slug】前缀 LIKE 防重；corpus-ingest.cjs 默认 dry-run、--confirm 显式写库（dry-run 实测零写入后-confirm 执行）。
- **机械 resolve 骨架** scripts/corpus-resolve.cjs（零 LLM）：按 evidence[0].resolve 分派三源真值锚（openmeteo_daily_max/dbnomics_series_value/cwl_ssq_red_contains+blue_odd），真值未到=pending 跳过、网络失败=跳过不写、已 resolve=拒改；dry-run 实证 4/4 pending（ERA5 未入库/月值未发布/期未开奖），T+1/月末/开奖后 --confirm 回填。
- **测试**：p1b node --test **168/168 全绿**（916ms）。
- **语义**：本批=审计器记账（gate=descriptive），**不进任何校准宣称**。
- **避坑存档**：①SQLite 严格模式拒双引号字符串字面量（LIKE 'corpus:%' 必须单引号或参数化）；②Open-Meteo archive API 对未来日期返回 HTTP 400（≠无数据，resolver 映射为 pending）；③DBnomics 整序列拉取偶发 >15s（FETCH_MS 放宽 30s）；④写文件进 run_code 时内容串用行数组组装，禁裸双引号跨行。


## 更正注记（2026-09-12 验收补刀 · 队长库实核发现）

- **误报更正留痕**：本文件上文「games 表无 source 列（schema 未动）」为**错误结论**。实测 PRAGMA table_info(games)+sqlite_master：source 列存在（sim M0 additive 加出，`source TEXT NOT NULL DEFAULT 'real'`，另有 meta 列），无 CHECK 约束。误报根因=勘察时只读了 db.js 的 CREATE TABLE 建表段就断言整表结构——additive ALTER 列不在建表语句里，**取证方法错误**（应 PRAGMA/实测）。
- **违规与纠正**：三合成局 #40/41/42 落库时吃了 DEFAULT 'real'，违反源分层纪律（corpus 既非 sim 亦非 real，混入 real 会污染 real 域统计）。纠正=事务内 `UPDATE games SET source='corpus' WHERE id IN (40,41,42)`（updated_rows=3，库写入仅此三行）。
- **复核**：UPDATE 后 g40/41/42 source 全='corpus'（全库 source='corpus' 计数=3，未误伤他局）；l0Gate 双口径 UPDATE 前后不变（records=454/records_valid=424/games=33——UPDATE 不触 predictions 计数，符合预期）。
- **纪律沉淀**：凡断言「表无某列/某约束」，必须 PRAGMA table_info+sqlite_master.sql 实测，禁凭建表语句段推断（additive 迁移列不可见）。

---

## M2 执行（2026-09-12 · 断点续作棒）

### 承接说明（前一棒断点）

- 前一棒死于模型服务瞬断（约 7 分钟寿命），后端半成品已在盘；本棒逐件核验后直接采信、未推翻重写：`p1b/src/routes/audit.js` 完整落盘（GET /api/audit/summary：l0Gate 双口径 + layer×checklist_hash 分组 + 组内 tautology 计数 + gate 分组，纯 SQL 只读零 LLM，module.exports={register} 在，**本棒零改动**）；`p1b/test/audit.test.cjs` 已落盘但未实跑；`p1b/src/server.js` L74 注册行在（注释齐）。
- 本棒工作=测试实跑修用例 + 前端 /audit 页四块 + 入口 + build + 本锚。

### 改动清单（1/2 · 测试修复）

- **audit.test.cjs 修用例（audit.js 逻辑合规，只修测试不反向）**：原用例经 HTTP POST 落注时把 layer/checklist_hash/gate 放进 payload——但 predictions 落注契约面只收 statement+prob（审计列不在落注面；分类是元数据，落注后走 `store.updateAuditFields` 补录，p16 M2 先例），且 a5 行缺必填 prob → 400 中断造数（total=4），连锁 5 用例红。
- **修法**：落注面只发 statement+prob（a5 补 prob=0.5）；六条落注后逐条 `updateAuditFields(id,{layer,checklistHash,gate})` 补录并断言生效（r1.layer==='L2' 等）；a5 不补录保 NULL 组语义。单文件 6/6 全绿。

### 改动清单（2/2 · 前端，全部 additive）

- `web/src/types.ts`：+AuditLayerGroup / AuditGateGroup / AuditL0Gate / AuditSummary（形状对齐 routes/audit.js）。
- `web/src/api.ts`：+getAuditSummary()（mock 模式拒绝并提示直连后端，同 getOracle 先例）。
- `web/src/pages/audit/AuditPage.tsx` 新建 + `web/src/styles/audit.css` 新建；`App.tsx` +/audit 路由；`ManagePage.tsx` 头部 +「📊 审计」入口按钮（data-testid=manage-audit-entry）。
- **四块 UI 与 data-testid**：
  ① 账本分层卡 `audit-ledger-card`：layer×checklist_hash 计数表 `audit-ledger-table`（NULL 组标「未分层」）+ l0Gate 双口径 `audit-l0-dual`（总账/有效口径/已回填/待回填/覆盖局数）+ gate 分布 `audit-gate-dist`。
  ② 分层校准汇总区 `audit-calib-card`（静态两行）：`audit-ra-line`「R-A 读数门：Brier 0.0008——达成（结算证据读数）」／`audit-rb-line`「R-B 信息价值：负结果——三路判词≈分题型基率（TOST 等价达成），合并条款未达成」；恒挂 `audit-exploratory`「探索性 · 判据=PREREG 冻结件」+ 两读数禁混宣称注（p16 M2 口径）。
  ③ 六层分类说明卡 `audit-layers-card`：L1-L6 一句话定义+引擎姿态（词表照《万物分类清单 v2》速查表），行 testid=audit-layer-L1…L6（运行时拼接 'audit-layer-'+id）。
  ④ 门禁状态卡 `audit-gate-card`：`audit-gate-status`（review_unlocked 徽标）+ 30 局/200 条进度 + `audit-gate-copy`「只记不评」口径文案（透出后端 l0_gate.gate 原文）。
- **恒挂定位横幅** `audit-banner`「万物审计 · 只记不评」（role=note，不随加载/出错状态消失）。
- **UI 铁律自检**：/audit 页四个源文件 grep 任务书禁词（宣称二字+对局专属词）**零命中**（源码注释亦去字面，防 grep 误伤）；纯展示零 LLM（②区=编译期常量，不发任何模型请求）；任务书示例横幅字面含宣称二字，故以「万物审计 · 只记不评」替代（如实留痕）。

### 测试与构建收据

- **单文件**：`node --test test/audit.test.cjs` → tests 6 / pass 6 / fail 0。
- **全量**：`node --test` → **tests 174 / pass 174 / fail 0**（duration_ms 1012；=基线 167 + audit 新用例 6 + 并行线 1）；收据以 pwsh `*>` 重定向刷新 `p1b/test/full-run.out`（UTF-8 合法，20804 字节/192 行，未用 2>&1 管道）。
- **build**：`cd p1b/web && npm.cmd run build`（tsc && vite build）**exit 0**，76 modules；dist 新 bundle **index-CxGN2ElZ.js**（旧 index-CatPXW5g.js → 新 CxGN2ElZ）+ 新 CSS index-DChJsPOY.css；产物内实抓「万物审计」「只记不评」及 12 个 audit-* testid 字面（audit-layer-* 为运行时拼接属预期）。
- **边界**：8787 服务进程零接触（页面随用户重启 bat 生效）；禁改清单（p1a-terminal/**、botc 五文件、meihua.js、providers.json、PREREG 冻结件、p7-p17 已发布节、audit.js）零触碰。

