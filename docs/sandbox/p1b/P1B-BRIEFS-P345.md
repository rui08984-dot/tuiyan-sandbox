# P1b-3/4/5 派单任务书（预置版，2026-09-08 队长落盘）

> 用途：P1b-1/2/LIVE 三路收口后，按本文件派 P1b-3，build 过后再派 P1b-4（串行），完成后派 P1b-5。
> 已对齐拍板（2026-09-08 用户三问全按推荐）：端口 **8787 定版**（原任务书 39100 作废）；P3→P4 串行；并行线（玄学判词/FPS/单机适配器）P1b 收口后再问优先序。
> 本文件自足：子代理只读此文件 + 指定规格即可开工。会话崩溃时按此文件重派，勿试恢复令（跨会话子代理不可 send_message，实测教训见 .scratch/handoff/推演沙盘-P1b-2026-09-08.md）。
> 通用铁律（每份任务书都隐含）：工作目录 E:\music player；禁改 p1a-terminal/**；禁改 docs/**；key 永不出服务端；完成后必须真跑验证并贴证据再回报。

---

## P1b-3 录入页+3宏（规格 §2.2+§4）

你是推演沙盘 P1b 前端工程师，负责事件录入页（核心页，手机竖屏单手操作）。新会话无历史上下文，任务书自足。

必读：
1. docs/sandbox/p1b/P1B-SPEC.md §2.2（录入页定义）、§4（宏→结构化映射）、§3（API 契约）
2. p1b/web/src/types.ts + src/api.ts + App.tsx（P1b-2 已建四 Tab 壳，你在其上填充「录入」Tab，不推倒重来）
3. p1a-terminal 的确认流规则参考（src/ 内与确认卡相关的模块，网页与终端同规则：高险席位键控+任一修改重显）

交付：
1. 录入页完整实现：
   - 顶部条：局名+第 N 天+当前存活名单横条
   - 常驻输入条：自由文本 → POST /api/games/:id/events/extract → 待确认卡（与终端确认流同规则）→ 确认入账（POST events/confirm）
   - 3 宏按钮：跳身份/查杀/金水 → 弹小表单（席位+角色或对象）→ 前端按 §4 映射直接构造结构化事件出确认卡（不走 LLM）→ confirmed 后同一入库路径
   - 当日事件流时间线（最新在上），每条可 edit/retract（POST claims/:claimId/edit、retract，actions 同构）
2. 手机竖屏优先：输入条常驻底部、宏按钮大触控区、确认卡全屏模态；桌面自适应。

验收：npm run build 零错误；对局数据用 GET /api/games 建/选一局真跑一遍（后端 :8787 起在 p1b/src，由你启动用于联调）；贴构建输出与关键接口响应摘录。不改 p1b/src/**（如发现后端 bug，记录并在回报中列出，勿自行改后端）。

## P1b-4 对局设置页+参谋卡面板（规格 §2.1+§2.3）

你是推演沙盘 P1b 前端工程师，负责对局管理页与参谋卡面板。新会话无历史上下文，任务书自足。

必读：
1. docs/sandbox/p1b/P1B-SPEC.md §2.1（对局设置页）、§2.3（参谋卡面板）、§3（API 契约）
2. p1b/web/src/types.ts + src/api.ts + App.tsx（P1b-2 四 Tab 壳，你填充「对局」「参谋卡」两个 Tab）
3. p1a-terminal 的 cards.js 导出面（参谋卡结构，网页按其结构样式化渲染）

交付：
1. 对局设置页：局列表（历史局+进行中标记）+新建局表单（局名/类型 werewolf|botc|script/人数→自动建席+座位名单编辑：默认「N号」可改真名）；局详情：天数推进器（当前第几天）、座位名单、导出 JSON（GET /api/games/:id/export 下载）
2. 参谋卡面板：「天结算」按钮 → POST /api/games/:id/day/:n/advise 拿 {taskId} 立即返回 → 角标/横幅「参谋卡生成中…」（轮询 GET /api/tasks/:taskId，建议 3s 间隔）→ 就绪提醒 → 点开渲染：矛盾区欠定度色标（high=红 mid=黄）、假设区双栏对峙、验证点 checklist（结构对齐 cards.js 产物）；历史参谋卡按天存档可回看
3. state 渲染用 GET /api/games/:id/state?uptoDay=N
4. 后端已补（2026-09-08，45/45 测试绿）：GET /api/games 列表项含 event_count / max_day 字段，current_day 语义 = max_day||0——历史局/进行中标记与天数推进器直接读这些字段
5. 前任 QC 瑕疵批处理（P1b-2 质检报告 .scratch/qc/p1b2-qc.md，施工时顺带修）：①app.css:244/192 触控目标 .btn=40px/.chip=38px → 提到 ≥44px ②设置页删除「使用中」文案与服务端自动回落行为对齐（providersStore.js 删除激活中供应商会自动回落，UI 文案却说需先切换）③mock.ts 死代码处理（VITE_USE_MOCK 机制保留但评估 tree-shake 或注释说明）④key 掩码方案统一以前端 types.ts has_api_key+masked 形态为准

验收：npm run build 零错误；起后端 :8787 真跑（advise 全链用真实 LLM 一次即可——providers.json 已配，约 3 分钟；若 key 失效则 mock 任务状态验证 UI 链路并如实注明）；贴构建输出与轮询状态迁移摘录。不改 p1b/src/**；后端 bug 只记录回报。

## P1b-5 集成实测（收尾）

你是推演沙盘 P1b 集成测试工程师。前置：P1b-1/2/3/4 全部完成。

任务：
0. 工具情报（队长 2026-09-08 实测）：本机 playwright 浏览器已缓存（%LOCALAPPDATA%\ms-playwright 下有 chromium-1234、chromium_headless_shell-1234、ffmpeg-1011），无需下浏览器——在 p1b/itest/ 自建 package.json 装 playwright npm 包即可，勿动 p1b/web 的依赖清单
1. p1b 后端起服（PORT=8787，0.0.0.0），前端 npm run build 后由后端静态托管（或 vite preview + 代理，以实际架构为准），打印局域网访问地址
2. 自动化全链（playwright，移动端 viewport 390x844 + 移动 UA，模拟手机竖屏）：
   - 建局（8人局，改 2 个真名）→ 录入页自由文本抽取→确认入账 → 3 宏各录一条 → 事件流可见 → 天结算 → 轮询参谋卡就绪 → 打开渲染检查（色标/双栏/checklist）→ 导出 JSON
   - 响应式核验：关键页 390px 与 1280px 两档截图留档 docs/sandbox/p1b/itest/
3. 局域网可达性：确认服务绑 0.0.0.0、本机防火墙对 8787 放行或给出放行命令（netsh advfirewall，需用户执行时明确写出）；用本机 LAN IP（ipconfig 实测）curl 通
4. 真机验收留一份「手机实测指引」docs/sandbox/p1b/itest/手机实测指引.md（同 WiFi 访问 http://<LAN-IP>:8787，三步操作），供用户 optionally 抽查
5. 回报：全链每步通过/失败、截图路径、遗留问题清单。禁止把 key 写入任何输出。

---

## 派单顺序提醒（给接手者）

- P1b-3 与 P1b-4 都改 p1b/web/src，**禁止同时派**（会互相覆盖）——**用户 2026-09-08 颗粒度对齐拍板：串行**（P1b-3 先派，build 通过再派 P1b-4）。
- P1b-5 必须最后。
- 收口后记得问用户并行线优先序（玄学判词/FPS/单机适配器）。
