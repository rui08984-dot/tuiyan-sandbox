# p10-PROGRESS · 第十棒 W1：预测卡 L0 基建（②类校准线首件）

日期：2026-09-11 ｜ 状态：**W1 完成，停等 W2 恢复令** ｜ 环境：中断 1 次已续完（读盘核实后续作）

## W1 交付清单（全部在盘）
- 新增 `p1b/src/db/predictionsStore.js`：私有表 predictions（CREATE TABLE IF NOT EXISTS additive，零碰 p1a 既有表）
  - 列：id / game_id(NOT NULL FK) / day / source_type CHECK IN('验证点','预测卡') / statement / assigned_prob REAL CHECK[0,1] 可空 / evidence_json / created_at / resolved_at / outcome CHECK IN('true','false','ambiguous') 可空 / resolve_note
  - 索引：idx_predictions_game(game_id,id DESC)；partial idx_predictions_open(outcome IS NULL)；**partial UNIQUE idx_predictions_cp_dedupe(game_id,day,statement) WHERE source_type='验证点'**（重复结算幂等）
- 新增 `p1b/src/routes/predictions.js`：4 条 API + l0_gate 字段
- 编辑 `p1b/src/routes/advise.js` 4 处：require + werewolf/botc 两分支钩子 + convertCheckpoints 包装；卡新增 additive 字段 cp_predictions={ok,inserted,skipped[,error]}，转换失败不炸卡（回存失败同思路）
- 编辑 `p1b/src/server.js`：**单行原子编辑**（oracleCast 行后加 require('./routes/predictions').register(app, ctx)）
- 新增 `p1b/test/predictions.test.cjs`：18 用例

## API 契约（任务书 W1-2 逐条对齐）
- POST /api/games/:id/predictions 落注：statement+prob；**prob 必须 0-1 数值**，口语「大概率」/字符串 → 400（错误信息提示调用方澄清后传数值）；source_type 缺省预测卡；day 缺省=账本最新天；evidence 事件 id 数组（≤10，逐一验存在且属本局，悬空 400 不留悬空引用）
- GET /api/games/:id/predictions 分页：?limit(≤100)&offset → {items,total,limit,offset,l0_gate}
- POST /api/predictions/:id/resolve：outcome true|false|ambiguous；**ambiguous 必附 note**（歧义不硬判，C-L0 判据：判定标准歧义争议率<5%）；已 resolve → 409 账本不可变（纠错另开修正记录）；resolve API 即真值回填通道（测试 :memory:+固定 outcome 注入；生产打局后手动 POST，不做录像导入 YAGNI）
- GET /api/predictions/unresolved：outcome IS NULL 分页清单
- l0_gate={gate,games,records,resolved,unresolved,review_unlocked=(games≥30∧records≥200)}：只读统计**零评分**；review_unlocked=false 时 UI 数字只配「参考」禁「预测」字样

## 验证点自动落卡口径（队长核实版）
- convertCheckpointsToPredictions({gameId,day,card})：statement=cp.text；assigned_prob=cp.prob 数值否则 **NULL**（p1a 引擎 checkpoint={text,resolves} 只读、无概率字段；W2 判词 implied_prob 另落 verdicts 表）；evidence=cp.resolves 指向假设的 support_events∪oppose_events **并集去重前 3**（id 已过 p1a postValidate 白名单）；resolves 无有效命中 → skip 不落脏卡；UNIQUE 冲突 → skip 幂等
- 机制：天结算 advise（werewolf+botc 两分支）生成卡时自动转——照 C 方案 1「账本每日自动出题」

## 测试证据（本回合实测，非转述）
- 施工前基线：node --test = **113/113 全绿**（实测）
- 施工后全量：node --test = **131/131 全绿**（113+18，fail 0，基线不破）
- 修复记录 1 条：listWhere 用 .get.apply(null,…) 使 better-sqlite3 原生绑定 thisArg=null → GET 类接口 500；改为 statement 自身为 thisArg 后全绿
- 新用例覆盖：落注 201 / 口语 400 / 越界 400 / statement 缺 400 / day 非法 400 / 404 / evidence 合法+悬空 400 / 分页 limit-offset-total 倒序 / resolve true / 重复 409 / ambiguous 无 note 400+带 note 200 / 非法 outcome+不存在+非整数 / unresolved+l0_gate / 验证点 advise 链路落卡（含 cp_predictions 统计）/ 重复结算幂等 / converter 单元口径（并集前3=[101,102,103]；oppose-only=[201]；越界 skip；prob 0.55 透传；二次 inserted=0 skipped=4）

## 设计决策与偏差记录
1. assigned_prob 对验证点行**可空**（任务书 schema 未注明）——p1a checkpoint 无概率字段，硬造数值=水晶球；手动预测卡 POST 强制数值。W2 消融用 verdicts.implied_prob，不依赖本列。
2. evidence_json 为任务书外 additive 列——W1-3 要求「带 top-3 证据事件 id 引用」所需。
3. resolve 重复回填 409——任务书未规定，取 L0 账本不可变语义。
4. ensure 表放 routes register 内（oracleCast p9 先例）→ server.js 单行原子编辑约束达成。

## 禁区自证
零碰：p1a-terminal/**（只读引用）、p1b/src/botc/ 五文件、p7-p9 产物、meihua.js、p1b/web/**（第九棒施工中）、build/dist 未动、8787 服务未碰（全程 node --test :memory:，未起长驻服务）。

## W2 交付（多路判词件+消融脚本+校准 API · 2026-09-11 完成，停等 W3）
- 新增 `p1b/src/db/verdictsStore.js`：私有表 verdicts（prediction_id FK / prompt_variant CHECK 三枚举 / temperature REAL CHECK[0,1] / verdict_text / implied_prob 可空 / created_at）+ **UNIQUE(prediction_id,prompt_variant,temperature) INSERT OR IGNORE 幂等保首条**（created_at=证据时间戳语义，F 防泄漏）
- 新增 `p1b/src/routes/verdicts.js`：POST /api/games/:id/predictions/:pid/verdicts
  - 3 路=同 provider（tokenrhythm）×3 prompt 变体×温度配对：v1_evidence/T0.2（信息聚合）｜v2_skeptical/T0.7（发散候选）｜v3_baserate/T1.0（基率检索）——provider 维度留空待第二把 key 扩 3×N
  - **implied_prob 机械抽取契约**：LLM 只产出文本（system 强制末行「P=0.xx」格式）；extractImpliedProb 正则抓末行 P=数值，只认 [0,1] 小数（拒 %、越界、缺失→NULL 不编数）；单路失败不落库，errors 如实标注
  - MOCK 零网络（llm.resolveMode 同链）；pid 跨局/不存在 404
- 追加 `p1b/src/routes/predictions.js`：GET /api/predictions/calibration——**ECE+10 等宽桶**（p=1.0 落末桶）+按 source_type 分层（每层 n<30 →「数据不足」宁缺毋滥）+总体 n<30 →「数据不足」；ambiguous 与 assigned_prob NULL（验证点行）剔除；纯统计零 LLM（C 方案 5 对照组）；logit 聚合/层级 Platt 只留挂点注释不实现（无真值不装学习件，YAGNI）
- 新增 `p1b/scripts/ablation.cjs`（离线统计件零 LLM）：--smoke（:memory: 合成 40 点，FK ON→createGame 造真局挂行=队长口径路径 A）｜--db/--limit（真实库，created_at 升序前 N 禁事后选样=F 防泄漏 #2）；输出：各路 Brier+中位聚合+人工 assigned_prob 参照+**ΔBrier（最佳单路−聚合）bootstrap95%CI（iters=1000 确定性 LCG）**+判据分支（n≥200 且 ΔBrier≥0.02 且 CI 不含 0=达成；<0.01=砍回 1 路条款）+一致率（>80% 判伪独立警示）+Pearson 相关矩阵+E 臂预留位
- server.js 追加单行注册 verdicts（W2 回合内单次原子编辑）

### W2 口径对齐（G-合并 §2）
verdicts 表字段=C 臂六臂矩阵原文（pid/prompt_variant/temperature/verdict_text/implied_prob）；R-b 高温=发散原料（v2/v3 路 prompt 写明候选非信号）；E 玄学臂未建（预留位）；n<200 明示探索性（F 防多重比较 #3）。

### W2 测试证据（本回合实测，无管道重定向）
- 全量 node --test = **139/139 全绿 exit 0**（W1 后 131 基线+8 新用例）
- ablation --smoke 实跑 exit 0：n=40 全 3 路齐全；输出 Brier：v1=0.2316/v2=0.1393/v3=0.3678/中位聚合=0.1868/人工参照=0.2500；**ΔBrier=-0.0475 CI[-0.0915,-0.0140]**（合成分布下聚合劣于最佳单路——如实记录不凑数：v1 20% 过自信翻车设计使中位数被平庸路拖累，恰证 C 方案 3 pre-mortem「分歧大时中位数卡 0.5 无分辨率」与「消融必须实跑」）；一致率 46.7%；相关矩阵 v1×v2=0.309/v1×v3=-0.107/v2×v3=-0.425
- 真实库模式未跑（当前 0 条 resolve 点，跑了即空报告；且避免对 8787 共享库做非必要写入——additive DDL 留给服务自身启动时执行）
- 队长验收注记：朴素中位数的翻车形态（烟测 ΔBrier=-0.0475）有已知解法——K 棒 F49/F55 的 λ̂→γ̂ 加权极端化（logit 空间加权聚合）；该线由 G v1.1 串联，非本棒范围

### W2 修复记录（2 条，均读码定位）
1. 漏挂 calibration 路由处理器（store 有函数、server.js 注释提了、routes 没挂）→ GET 404；补挂后过。
2. calibration note 文案「仅记账不评」与标准语「只记不评」不一致 → 对齐。

## W3 集成收口（2026-09-11 完成）

### 闭环方式（如实注明）
pwsh 后台起服进程实测**活不过单条 pwsh 调用**（第一次跨调用被回收：PID 28880 死、连接拒绝——读盘验证后定策）；改为**单条 pwsh 命令内完成 起→测→截图→验命令行杀→复验** 全闭环，exit 0。独立端口 8792（netstat 先探 FREE）+ P1B_DB_PATH=itest/p10-w3.db（全新临时库）+ P1B_LLM_MOCK=1；8787 零接触。

### 端到端执行记录（本回合实跑转录，禁编数）
1. 起服：PID=16332，HEALTH ok=True db=itest/p10-w3.db llm_mock=True
2. 造局落注：POST /api/games → game=1；POST 落注×2 → pred1=1（prob=0.7「A：明天有对跳」）/ pred2=2（prob=0.4「B：3号被查杀」）
3. 3 路判词：POST verdicts×2 → 各 mode=mock saved=3 errors=0（共 6 行）
4. resolve：pred1 outcome=true（resolved_at=2026-09-11 10:04:48）；pred2 outcome=ambiguous+note（歧义留痕不硬判）
5. verdicts 表核查（p10-w3-read-verdicts.cjs）：**rows=6，implied_prob 非 NULL=6**（0.25/0.50/0.75 ×2 pid，MOCK 模板末行 P=0.xx 格式设计）
6. ablation --db 实跑（p10-w3.db）：resolve 点=1 有效 n=1（ambiguous 剔除）缺路剔除=0；Brier v1=0.5625/v2=0.2500/v3=0.0625/中位聚合=0.2500/人工参照=0.0900；ΔBrier=-0.1875 CI[-0.1875,-0.1875]；**判据行=「主判据未到样本量（n≥200 才许下结论）」探索性声明**；一致率 33.3%；相关矩阵 n/a×3（n<3 诚实输出）
7. GET /api/predictions/calibration：**status=「数据不足」n=1**，note=「L0 只记不评：n≥30 才出 ECE 与分桶（C 方案 5）」，l0_gate={games:1,records:2,resolved:2,unresolved:0,review_unlocked:false}

### 证据清单（itest/ 下 6 件）
1. p10-w3-e2e-out.txt（命令输出转录，含 HTTP 步骤与 JSON）
2. p10-w3-calibration.png（6.9KB，headless Edge 截 API JSON 响应页——无预测卡 UI 是 L0 门禁本意，截图方式如实注明，P9 先例）
3. p10-w3-predictions.png（11.8KB，同法截 GET /api/games/1/predictions 分页 JSON）
4. p10-w3-server.log / p10-w3-server.err.log（0B=起服零报错）
5. p10-w3-read-verdicts.cjs（证据核查脚本，沉淀复用；node -e 直 require better-sqlite3 MODULE_NOT_FOUND 坑——better-sqlite3 在 p1a 依赖树，须走 p1b/src/deps 链）
6. p10-w3.db（临时库留档：predictions 2 行+verdicts 6 行）
PNG 目验像素不可行（无图像审查通道），以文件签名+URL 明示+JSON 全文转录替代——如实声明。

### 进程闭环声明
杀前验命令行：`"C:\Program Files\nodejs\node.exe" src/server.js` 匹配 → Stop-Process -Force KILLED 16332；netstat 复验首测 STILL LISTENING 为客户端 TIME_WAIT 残留，**状态明细复验=全 TIME_WAIT 零 LISTENING（端口已释放）**；队长复核 PID DEAD+端口无残留。

### W3 坑与修复
- pwsh 起服进程生命周期=单条调用内（跨调用必被回收）→ 单条命令全闭环
- node -e 从 p1b cwd 解析不到 better-sqlite3 → 走 deps 链证据脚本
- node 子进程输出在复合 pwsh 脚本内被吞（沙箱捕获限制）→ node-only 步骤拆出独立跑

---

## 终态：预测卡 L0 全线收口（W1+W2+W3 全绿）
- 测试：node --test = 139/139（113 基线+18 W1+8 W2），fail 0，队长复测过
- 交付面：predictions 表+4 API+验证点自动落卡（W1）｜verdicts 表+3 路判词+机械抽取+ablation 离线消融+calibration API（W2）｜同 turn 起服端到端闭环+证据 6 件（W3）
- L0 门禁落点：l0_gate 恒挂各 API（review_unlocked=false 时 UI 数字只配「参考」）；calibration n<30「数据不足」；resolve 歧义走 ambiguous；UI 零预测卡界面（只记不评期不建 UI=门禁本意）
- 退役声明：第十棒交付完毕，产线移交，感谢协作。
