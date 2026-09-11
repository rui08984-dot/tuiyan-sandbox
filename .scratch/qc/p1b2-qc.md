# P1b-2 前端交付质检报告（p1b/web/）

**质检员**：P1b 独立 QC（只读，未修改任何交付文件）
**日期**：2026-09-08
**被检对象**：p1b/web/ 四 Tab 壳 + 设置页（供应商管理器）+ 三占位页 + mock.ts + app.css
**基准**：docs/sandbox/p1b/P1B-SPEC.md §0拍板#3#6 / §2.4 / §3；vite 代理 8787 定版（2026-09-08）

---

## 总判定：**放行带瑕疵**

交付功能面完整、契约对齐、Key 卫生达标、移动端骨架正确，build/preview/四路由全部运行时实证通过。
瑕疵集中在触控目标尺寸（40/38px < 44px）与三处轻微不一致，均不阻塞放行，供队长裁量是否本轮修。

---

## 检查单

### C1 build 复验 — ✅ 通过
- 本轮实测：`cd p1b/web && npm run build` → **exit 0**（`tsc && vite build`，43 modules，built in 473ms）
- 产物：`dist/index.html 0.47kB`、`dist/assets/index-CPUKPSO8.css 6.72kB`、`dist/assets/index-CLwRH3fD.js 182.54kB`（均已在盘）

### C2 设置页功能面（§2.4） — ✅ 通过（运行时+源码双证）
| §2.4 要求 | 证据 | 判定 |
|---|---|---|
| 供应商列表 | SettingsPage.tsx:131-148 渲染列表；mock DOM 实证 2 张卡片（含 is-active 高亮） | ✅ |
| 模板添加 8 预置 | SettingsPage.tsx:19-28（DeepSeek/Kimi/GLM/通义/硅基流动/OpenRouter/Ollama/自定义）；mock DOM 实测 8 个 chip 按钮全部渲染 + 「＋空白自定义供应商」 | ✅ |
| 编辑：名称/BaseURL/Key密码框/抽取模型/参谋卡模型 | ProviderEditorSheet.tsx:118-192 六字段齐（标识字段为编辑态只读，§2.4 未列、属合理补充） | ✅ |
| 删除（二次确认） | SettingsPage.tsx:235-242 confirm-row（确认删除/取消）；点删除先进确认态再执行 | ✅ |
| 激活切换 | SettingsPage.tsx:66-70,245-251；active 卡显示禁用态「当前使用中」 | ✅ |
| 连接测试行内提示 | SettingsPage.tsx:72-76,228-233 testResult 行内 ok/fail 双色 + 延迟 ms | ✅ |

### C3 Key 卫生 — ✅ 通过
- 前端类型无明文 key 字段（types.ts:163-176 仅 has_api_key + api_key_masked）；api_key_masked 服务端脱敏输出（providersStore.js:60 `'....'+last4`）
- 编辑态 Key 初始为空（ProviderEditorSheet.tsx:52）、`type="password"`（:157）、`autoComplete="new-password"`（:159）
- 留空=不修改：前端发 `api_key: trim() || undefined`（:95），服务端仅非空才覆盖（providersStore.js:92-94）
- 页面文案明示「API Key 只保存在服务端，页面不回显明文」（SettingsPage.tsx:100）

### C4 API 对齐（§3） — ✅ 通过（DELETE 为双侧对齐的契约扩展，已标注）
- GET /api/providers（api.ts:53）、PUT /api/providers/:key（:58，upsert 语义注释明确）、POST …/activate（:62）、POST …/test（:66）——与 §3:49 逐条一致
- **DELETE /api/providers/:key（api.ts:73-75）＝契约扩展**：§3 未列、§2.4 要求可删除；后端已实装（providers.js:30-32）且 api.ts:69-72 有注释声明。**放行，需在契约文档补记**
- 对局/抽取/确认/advise/tasks 各路由与 §3:43-48 一致（api.ts:79-141）

### C5 四 Tab 壳 + 占位页 — ✅ 通过（运行时实证）
- 无头 Edge dump-dom 四路由（#/games #/input #/advisor #/settings）：每路由各自页面渲染、对应 Tab 带 `is-active`+`aria-current="page"`，切换真实可用
- 三占位页均带待填清单：InputPage→「🚧 P1b-3 施工中」（输入条/确认卡/3宏/时间线四条）；GamesPage、AdvisorPage→「🚧 P1b-4 施工中」（局管理/卡片渲染/存档回看）
- HashRouter 选型合理：后端静态托管免 SPA fallback（App.tsx:4 注释）

### C6 移动端优先 — ⚠️ 通过带瑕疵
- ✅ Tab 栏固定底部：app.css:36-47 `position:fixed; bottom:0` + `padding-bottom: env(safe-area-inset-bottom)`；内容区 :71 预留 `72px+safe-area+12px`；index.html:5 `viewport-fit=cover` 已配（safe-area 生效前提）
- ✅ 16px 输入防 iOS 缩放：app.css:119
- ✅ ≥900px 断面：app.css:311-336 Tab 栏 sticky 置顶、供应商卡片双列（:332）、抽屉居中对话框（:334-335）
- ⚠️ **触控目标 <44px**：`.provider-actions .btn` **min-height:40px**（app.css:244）——卡片上「设为使用中/连接测试/编辑/删除」四个高频按钮全部低于 44px 基线；`.chip` **38px**（:192）。主 `.btn`（:96）与 .tab（:56 54px）达标，唯这两处子类覆盖压低
- 编辑抽屉移动端底部弹层 + safe-area 内边距（app.css:250-269）✅

### C7 代理 8787 + 后端未起兜底 — ✅ 通过（运行时实证）
- vite.config.ts:12 `'/api': { target: 'http://127.0.0.1:8787' }` —— **符合 8787 定版**，注释说明避开 ::1/IPv4 陷阱
- 后端在线窗口实测：preview 代理 /api/providers → 200 真数据（Vite preview.proxy 默认继承 server.proxy，生产同链路成立）
- 后端下线实测：dump-dom 设置页渲染 `banner banner-error`「HTTP 500」+ 重试按钮，**页面壳与 Tab 栏完好、非白屏**；fetch 网络层失败另有可读文案兜底（api.ts:33-35 ApiError(0,'无法连接后端服务…')）+ 渲染层 ErrorBoundary（ErrorBoundary.tsx）
- 注：8787 后端在质检中途自行下线（netstat TIME_WAIT 残留佐证，非 QC 所为）；两个状态都被实测覆盖，反而凑齐了正反两面证据

### C8 视觉对照截图 — ⚠️ 无法验证（视觉通道不可用），结构对照替代
- vision_describe 两次调用均失败：首次退化输出、二次 VISION_TIMEOUT（所有视觉后端超时，按预案不重试）→ **像素级形态对照跳过，如实注明**
- 改走结构对照：§2.4「你截图的形态」四要素——列表✓/添加（模板chips）✓/填key（密码框抽屉）✓/切换激活✓ + 连接测试✓，结构齐备；截图中的差异细节（徽章文案/按钮排布/配色）待视觉通道恢复后可补一轮
- 留档：.scratch/qc/shots/m-settings-down.png（390×844）、d-settings-down.png（1280×800），主色实测 #101008 占 78%（暗色主题渲染非白屏）

### C9 mock 门控 — ✅ 通过（附轻微观察项）
- api.ts:13 `USE_MOCK = env.VITE_USE_MOCK === '1'`；全部 20 个调用点逐条三分支（USE_MOCK ? mockApi : request），mock.ts 仅被 api.ts 引用
- 生产构建实证：dist 内无 `VITE_USE_MOCK` 引用残留（编译期内联）；preview 冒烟页面实际发起真实 /api 请求（500 横幅）而非 mock 数据 → **运行时门控有效、不污染真实调用面**
- 轻微观察：mock 数据（tokenrhythm 等）仍随 prod bundle 打包（静态 import 未被 tree-shake，约数 KB 死代码），功能无影响

---

## 瑕疵与建议清单（供队长裁量，均不阻塞）

| # | 级别 | 项 | 位置 | 建议 |
|---|---|---|---|---|
| 1 | 瑕疵 | 供应商卡片 4 个操作按钮 40px、模板 chips 38px，低于 44px 触控基线 | app.css:244,192 | 提回 44px，或接受（卡片横排 4 按钮的密度权衡） |
| 2 | 瑕疵 | 删除「使用中」供应商语义错位：UI 文案暗示需先切换，后端实际允许删除并自动回落 active | SettingsPage.tsx:237 vs providersStore.js:107-110 | 统一：要么后端拒绝删 active，要么 UI 文案改为「删除后将自动切换到其余供应商」 |
| 3 | 观察 | mock 数据进 prod bundle（死代码） | mock.ts 静态 import | 可改动态 import 或接受（数 KB） |
| 4 | 观察 | api_key_masked 掩码方案前后不一致（mock 前5位，服务端后4位） | mock.ts:50 vs providersStore.js:60 | mock 对齐服务端后4位方案，避免联调时视觉困惑 |
| 5 | 契约 | DELETE /api/providers/:key 为 §3 契约扩展（双侧已对齐） | api.ts:69-75, providers.js:30 | 在 P1B-SPEC §3 补记该路由 |

## 验证方式备注
- 本轮所有「通过」均有当轮新跑证据（build 输出/HTTP 状态码/dump-dom 内容/源码行号）；唯一未覆盖：像素级视觉对照（视觉后端超时）与真机 iOS safe-area 实测（P1b-5 集成实测范围）
- QC 过程产物（截图/DOM 快照）在 .scratch/qc/，未触碰 p1b/ 任何交付文件
