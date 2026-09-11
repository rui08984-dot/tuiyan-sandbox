# BOTC 适配线 B2-B5 派单任务书（2026-09-09 夜落盘版）

> 用途：用户 09-09 夜关机，链路在 S1 交付后中断。明天新会话凭本文件零上下文续派。
> 通用铁律：工作目录 E:\music player；禁改 p1a-terminal/**（引擎/契约只读复用）；禁改 p1a-terminal/data/p1a.db 的**既有表结构**（无 DDL、无 schema drift——终端在用）；key 不落任何输出；写文件 tools.write ≤5KB 分块读回；npm 用 npm.cmd；pwsh stdout 可能不回显→重定向文件再读；完成后真跑验证贴证据再回报。

## 已定状态（勿重做）

- **S1 数据层已交付**：docs/sandbox/botc-adapt/data/ 下 roles-zh.json（130 角色归一化：id/name_en/name_zh/team/editions/ability_en/ability_zh/first_night/other_night/reminders/unique_note）、roles-townsquare.json、script-schema.json、validate.cjs（exit 0）、validate-report.md、fetch-report.md。中文覆盖率：译名 99.2%（129/130，唯一缺页=实验角色 mephit）、能力 95.4%。三本规模 TB=27/BMR=30/SNV=30+实验 43，与摸底预期一致。
- **用户三拍板**：三本一起；townsquare 打底+官方 schema 校验+B站 wiki 官方译名；新增 BOTC 专属谓词（is_wolf 保留 werewolf）。
- **设计总纲背书**：§9.5「BOTC 适配首发，官方 schema 是账本地基」；既有调研=docs/sandbox/botc-research-report.md；摸底=docs/sandbox/botc-adapt/botc-摸底报告.md。
- **关键工程约束（S2 设计已定）**：p1a-terminal/src/db.js:97 的 claims 表 CHECK 约束 predicate ∈ 7 枚举，且共享库禁 DDL → **BOTC 新谓词走 p1b 侧扩展存储**：p1b 自建自有表（如 botc_claims，p1b 启动时 CREATE TABLE IF NOT EXISTS，p1b 私有、additive、不碰 p1a 表），API/前端层面呈现新谓词（is_demon/is_minion/status_drunk/status_poisoned/…）， BOTC 局的阵营/状态类声称落 botc_claims，角色类声称仍走主表 claims（claims_role/is_role object=角色名，通用）。werewolf 局路径零改动。

## B2 谓词+比对器（p1b/src，串行第一棒）

任务：p1b/src/botc/ 新模块——
1. roles.js：加载 data/roles-zh.json，按 edition 取角色集/团队结构/唯一角色集合（unique_note 驱动，BOTC 常规角色每局唯一）； ability 中文摘要访问器（S3 用）
2. claims.js：BOTC 局的声称校验+归一化（角色名中英映射→id；阵营/状态谓词→botc_claims 表结构）
3. contradictions.js：剧本数据驱动的对跳/矛盾检测（角色唯一性冲突、阵营互斥、状态矛盾），BOTC 局替代 werewolf 的 R1/R2 路径（p1a engine 的 UNIQUE_ROLES 不认识血染角色）；结果结构与现有 cards 矛盾区同构（conflict_desc/color）
4. 接线：routes/advise.js 的 BOTC 局预处理走新模块；events/extract+confirm 的 BOTC 局声称走 claims.js；建局 POST /api/games 的 botc 类型带 script 字段（tb|bmr|snv）落 games 表已有列或 p1b 自有表
5. 测试：server.test.cjs 增 ≥10 用例（botc 建局挂剧本/角色声称入库/阵营声称落扩展表/对跳检测（两个 seat 声称同唯一角色）/werewolf 局回归零影响），49→59+ 全绿
交付：模块文件+测试输出原文+不碰 p1a 的证明（git 或 diff 说明零改动）。

## B3 判词注入 ∥ B4 前端联动（B2 收口后可并行，落点不同目录）

B3（p1b/src/advise 链）：BOTC 局参谋卡 prompt 注入本局剧本上下文——角色清单（中文名+团队+能力中文摘要）、说书人裁量警示（醉酒/中毒=合法信息为假，作为一等不确定性来源，源自摸底 §5）、BMR/SNV 特有机制提示（夜死不公布/疯狂——按拍板做提示级不做机制模拟）。
B4（p1b/web）：新建局选 botc→选剧本（TB/BMR/SNV）→可选席位-角色映射编辑（数据来自 GET 新路由或静态数据接口）；录入确认卡的谓词选项按剧本切换（BOTC 局出 is_demon/is_minion/状态类选项）；build 零错误。
（两路并行约定：B3 只动 p1b/src/**，B4 只动 p1b/web/**，互不越界。）

## B5 抽取重测（收尾，需真实 LLM）

TB/BMR/SNV 口播样本各 ≥8 条（可从既有对局视频资料转写或手写典型口播，样本落 docs/sandbox/botc-adapt/itest/），跑 LIVE 抽取质量重测：对照狼人杀基线（9/9 结构成功、错误率 33%）；结论写入 botc-抽取重测报告.md（质量表+中位数/P90+可用性判定+prompt 调整建议——只建议不改 prompt，调整由队长定）。

## 派单顺序提醒

B2 → B3 ∥ B4（落点不同可并行）→ B5。每棒收口后先读本文件确认状态再派下一棒。会话再崩溃：按本文件+摸底报告重派，勿试恢复令（跨会话子代理不可 send_message，实测教训）。
