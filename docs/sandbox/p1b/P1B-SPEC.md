# P1b 网页工作台 · 施工规格 v1.0（2026-09-08 用户两轮对齐后定版）

## 0. 已拍板决策（ask_user_question 两轮六项）

| # | 决策 | 拍板 |
|---|---|---|
| 1 | 推进节奏 | **直接全力 P1b**，跳过终端菜单壳；P1a 终端保留当引擎 |
| 2 | 首版范围 | **最小可用三页**（对局设置/事件录入/参谋卡面板）；玄学页+复盘回放后置 |
| 3 | 使用终端 | **手机竖屏优先**（线下局边玩边录），桌面自适应 |
| 4 | 参谋卡生成 | **后台异步+就绪提醒**（点结算立即返回，约3分钟跑完角标提醒，录入不被阻塞） |
| 5 | 录入快捷宏 | **3 个高频宏**（跳身份/查杀/金水），点按钮弹小表单填席位 |
| 6 | 供应商管理器 | **做进网页设置页**（列表+添加+填 key+切换激活，DSH 截图形态）；配置文件与终端共享，网页改完终端自动生效 |

## 1. 架构

- **后端**：Node + Fastify（复用 p1a-terminal 引擎：src/db.js（契约 v1）/engine.js/llm.js 直接 require，零迁移）；监听 0.0.0.0（局域网手机访问），启动时打印本机访问地址；**key 永不出服务端**（前端只见 provider 的 label/model，key 读写都在 config API 的服务端侧）。
- **前端**：Vite + React + TS，手机竖屏优先响应式（桌面宽屏三栏自适应）。
- **数据库**：共用 data/p1a.db（终端与网页同库，双向可见）。

## 2. 三页定义

### 2.1 对局设置页
- 局列表（历史局+进行中标记）+ 新建局（局名/类型 werewolf|botc/script/人数→自动建席+座位名单编辑：默认「N号」可改真名）
- 局详情：天数推进器（当前第几天）、座位名单、导出 JSON

### 2.2 事件录入页（核心，手机竖屏单手）
- 顶部：局名+第 N 天+当前存活名单横条
- 常驻输入条：自由文本 → AI 拆解 → **待确认卡片**（与终端确认流同规则：高险席位键控+任一修改重显）→ 入账
- 3 宏按钮：跳身份 / 查杀 / 金水 → 弹小表单（席位+角色或对象）→ **直接结构化入账不走 LLM**（宏=确定性高频录入，更快更准）→ 仍出确认卡复核
- 当日事件流（时间线，最新在上，可 edit/retract）

### 2.3 参谋卡面板
- 「天结算」按钮 → 后台任务立即返回 → 角标/横幅「参谋卡生成中…」→ 就绪提醒 → 点开渲染（复用 cards.js 的结构，网页样式化：矛盾区欠定度色标 high=红 mid=黄、假设区双栏对峙、验证点 checklist）
- 历史参谋卡按天存档可回看

### 2.4 设置页（供应商管理器，你截图的形态）
- 供应商列表（预置模板 DeepSeek/Kimi/GLM/通义/硅基流动/OpenRouter/Ollama/自定义）+ 添加/编辑/删除
- 编辑项：名称/Base URL/API Key（密码框）/抽取模型/参谋卡模型
- 激活切换；连接测试按钮（发一条 ping 看通不通）；网页改完终端共享同一 config

## 3. API 契约（REST，Fastify）

- GET /api/games ｜ POST /api/games ｜ GET /api/games/:id ｜ GET /api/games/:id/export
- GET /api/games/:id/state?uptoDay=N
- POST /api/games/:id/events/extract（body: text → 待确认卡，LIVE 抽取）
- POST /api/games/:id/events/confirm（body: 确认后的 event+claims+actions → 入账）
- POST /api/games/:id/claims/:claimId/edit ｜ retract（actions 同构）
- POST /api/games/:id/day/:n/advise → {taskId}（异步启动）｜ GET /api/tasks/:taskId → {status, card?}（轮询）
- GET /api/providers ｜ PUT /api/providers/:key ｜ POST /api/providers/:key/activate ｜ POST /api/providers/:key/test ｜ DELETE /api/providers/:key（P1b-2 实装的契约扩展；删除激活中的供应商时服务端自动回落，2026-09-08 QC 补记）
- 静态托管前端 dist；所有接口仅监听局域网。

## 4. 宏→结构化映射（不走 LLM）

- 跳身份：seat X claims_role role=R（对 seat X 自身）→ 入 claims
- 查杀：seat X claims is_wolf 对 seat Y → 入 claims
- 金水：seat X claims is_good 对 seat Y → 入 claims
- 三宏仍出确认卡（复核席位与对象），confirmed 后入账——与自由文本同一入库路径。

## 5. 施工拆分

- **P1b-1 后端**：Fastify 骨架+上述全部路由+异步任务队列+静态托管（引擎复用 p1a-terminal，接口测试 ≥15 用例）
- **P1b-2 前端框架+设置页**：Vite/React/TS 骨架+路由+供应商管理器页（含连接测试）
- **P1b-3 录入页+宏**：输入条+确认卡组件+3 宏+当日时间线
- **P1b-4 对局设置页+参谋卡面板**：局管理+异步任务提醒+卡片样式化渲染
- **P1b-5 集成实测**：局域网手机访问+全链（手机录入→结算→看卡）+响应式核验

依赖：P1b-1 先出 API 契约（本文件 §3 即初版），2/3/4 依赖契约可两两并行，5 收尾。

## 6. 明确不做（首版）

玄学独立页（参谋卡内已有彩蛋）、复盘回放模式（带真值）、语音输入、多用户/鉴权（局域网可信）、AI 参数界面化高级档（温度/重试——沿用内部默认）、上下文裁剪逻辑。
