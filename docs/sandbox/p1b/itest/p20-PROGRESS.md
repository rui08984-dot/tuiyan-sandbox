# p20-PROGRESS · 审计页补「预测画面」雏形（待解前瞻 + 分层校准）

日期：2026-09-13 ｜ 执行：p20 施工棒 ｜ 状态：**完成（三项验收门全过）**

> 档名说明（如实）：任务书要求落 `docs/sandbox/p1b/itest/p20-PROGRESS.md`（p19 已被取用，故取 p20）。
> 目标：/audit 页从「只有账本统计（四块）」升级为「系统在预测什么、准不准」的雏形画面；本棒只加**视图**，不动评分语义。

## 一、改动文件（4 个，全部 additive）

| 文件 | 改动 |
|---|---|
| `p1b/src/routes/audit.js` | 47 → 128 行：GET /api/audit/summary **新增 3 个字段**（`layer_calibration` / `pending_forward` / `pending_forward_total`）；纯 SQL 只读 + 只读字符串解析，零 LLM 零网络 |
| `p1b/web/src/types.ts` | 新增 `AuditLayerCalibration` / `AuditPendingForward` 两个接口，`AuditSummary` 补 3 字段 |
| `p1b/web/src/pages/audit/AuditPage.tsx` | 188 → 约 270 行：新增**⑤待解前瞻卡**、**⑥分层校准卡**（+3 个纯格式化小函数）；原有四块零改动 |
| `p1b/web/src/styles/audit.css` | +5 行：`.audit-forward-stmt` 题面列限宽截断（title 挂全文） |

零触碰：p1a-terminal/**、p1b/src/botc/、meihua.js、p7-p9 产物、8787 服务、providers.json。

## 二、后端新字段（真实样例，来自 p1a.db 快照只读实测）

```json
"layer_calibration": [
  { "layer":"L1","n":180,"resolved":180,"ambiguous":0,"settled":180,"brier":0.211482,"brier_n":180,"base_rate":0.522222,"base_rate_n":180 },
  { "layer":"L2","n":43,"resolved":32,"ambiguous":0,"settled":32,"brier":0.264152,"brier_n":32,"base_rate":0.5,"base_rate_n":32 },
  { "layer":"L3","n":211,"resolved":96,"ambiguous":0,"settled":96,"brier":0.25343,"brier_n":96,"base_rate":0.520833,"base_rate_n":96 },
  { "layer":"L5","n":32,"resolved":24,"ambiguous":0,"settled":24,"brier":0.148837,"brier_n":24,"base_rate":0.208333,"base_rate_n":24 },
  { "layer":"L6","n":270,"resolved":270,"ambiguous":0,"settled":270,"brier":0.194134,"brier_n":270,"base_rate":0.577778,"base_rate_n":270 }
]
```

**口径（写死在路由注释里）**：

- `brier` = 已回填真值（true/false）**且 assigned_prob 非空**的题上的 `(p − y)²` 均值；`brier_n` = 参与算术的题数；**`brier_n=0 → brier=null`（样本不足留空，禁编造数字）**。
- `base_rate` = settled（true/false）题中 outcome=true 占比；`base_rate_n=0 → null`。
- `ambiguous` 单列（歧义恒走 ambiguous 不硬判，既不进 Brier 也不进基率）。
- 本列为「已发生真值上的机械算术」，**不是**对未来的评分；样本不足处一律留空。

`pending_forward`（截断前共 `pending_forward_total` = **112** 条；本字段按 limit 50 返回）：

```json
{ "id":625,"assigned_prob":0.5633,"layer":"L3","gate":"descriptive",
  "event_day":"2026-09-14","target":"上海 2026-09-14 日最高气温 > 27°C（未来 1-3 天，亚洲）",
  "statement":"【forward】上海 2026-09-14 日最高气温 > 27°C（…（cutoff=落库时点 2026-09-13T00:47:01+08:00，事件日尚未发生；真值锚=Open-Meteo forecast/archive daily.temperature_2m_max[2026-09-14]。前瞻批次，真值未发生）" }
```

- 选取：`outcome IS NULL AND statement LIKE '%【forward】%'`（= 未回填真值的前瞻批次；库里 112/112 命中，gate 全為 descriptive）。
- 排序：`event_day` 升序，无日粒度（月频/期号类题）排后；同日按 id 升序。
- `event_day` / `target`：从题面**前瞻标记之后、cutoff 之前**的目标段机械抽取首个 `YYYY-MM-DD`（月频/双色球期号类题无日粒度 → `event_day:null`，`target` 保留目标期文本）。**禁从 cutoff 时点倒推**。

## 三、前端两块（DOM 实测原文）

新增块①「待解前瞻」（`data-testid=audit-forward-card`，标题下副标题）：

> 前瞻批次 · 真值未发生：以下为未回填真值的记录（事件日升序；显示前 50 条 / 共 112 条）。 落注概率与到期日仅作「参考」——真值到达前不可结算、不作任何命中/准确率宣称。

表头 `题面 / 层 / 落注概率 / 到期日`，实渲染 50 行，例：`上海 2026-09-14 日最高气温 > 27°C（未来 1-3 天，亚洲）｜L3｜56.3%｜2026-09-14`。

新增块②「分层校准（账本）」（`data-testid=audit-layer-calib-card`）：

> 分层账本 × 校准参考（只记不评，机械算术）。n=账本条数 ｜ resolved=已回填真值 ｜ 校准参考=已回填真值且概率非空题上的均方误差 ｜ 基率=真值题中为真的占比；样本不足留空

| 层 | n | resolved | 校准参考 | 基率 |
|---|---|---|---|---|
| L1 | 180 | 180 | 0.211 | 52.2%（n=180） |
| L2 | 43 | 32 | 0.264 | 50.0%（n=32） |
| L3 | 211 | 96 | 0.253 | 52.1%（n=96） |
| L5 | 32 | 24 | 0.149 | 20.8%（n=24） |
| L6 | 270 | 270 | 0.194 | 57.8%（n=270） |

**词汇纪律（铁律，实测复核）**：/audit 页 DOM 全文「预测/预报/押注/胜率/猜」命中数 = **0**；层级名沿用「审计/校准参考/分层账本」；每一块数字旁恒挂「参考」纪律文案。

## 四、验收门证据（三项全过）

1. **`node --check src/routes/audit.js` → exit 0**（第一次写盘时 SQL 单引号还出错，报 `missing ) after argument list`；已修 `'true'` 转义，复检 exit 0）。
2. **`npm.cmd run build`（p1b/web，tsc && vite build）→ exit 0**：76 modules transformed，dist 新 bundle `index-BmfHl6RF.js` 279.88 kB（css `index-x0o-VvAe.css`）；本棒按任务书**允许 build**（出画面必需）。
3. **起服务实测**（隔离实例 :8793 + p1a.db 的 VACUUM INTO 只读快照 `p20.db` + `P1B_LLM_MOCK=1`，**8787 零接触**）：`GET /api/audit/summary` HTTP 200，顶层键 = `l0_gate,by_layer_checklist,by_gate,layer_calibration,pending_forward,pending_forward_total,total,generated_at,note`。
4. **回归**：`p1b` 后端全量测试 **173/173 全绿**（含既有 `test/audit.test.cjs` 6/6，空账本/分组/门禁口径均未回归）。
5. **真浏览器端到端**（headless Edge CDP、1280×900 + 390×844）：**24 项断言全 OK，FAILS=0**（脚本 `docs/sandbox/p1b/itest/p20-e2e.mjs`，日志 `p20-e2e-out.txt`）。

### 产物路径

- 截图：`docs/sandbox/p1b/itest/p20-audit-desktop-1280.png`（桌面 456 KB）、`p20-audit-mobile-390.png`（手机 390@2x）
- 页面文本快照（DOM innerText，含两块新增原文）：`docs/sandbox/p1b/itest/p20-audit-dom.txt`
- 接口响应样例：`docs/sandbox/p1b/itest/p20-api-summary.json`（本棒实际响应全文）
- 复跑脚本：`node docs/sandbox/p1b/itest/p20-e2e.mjs`（自建快照+隔离实例+CDP，跑完自动删 Edge profile）

## 五、如实备注（限界与未知）

- **L0 门禁现已解锁**：实测 33 局 / 有效口径 706 / resolved 602 → `review_unlocked=true`，故页面文案仍恒挂「参考」纪律（铁律要求不变），但**后端未据门禁改语义**——本棒不改评分口径，只透出。
- **库里 134 条未 resolve 中 112 条是【forward】**；余 22 条非 forward 未 resolve 题**不在本卡覆盖范围**（任务书只要求 forward 清单），待解总量 UI 未强报（避免与「前瞻批次数」混淆）。
- `brier` 目前有量（brier_n = resolved 全部有概率），故未见 null 分支实数据；null 分支已由代码路径覆盖、未单独造数实测（如实标注）。
- 六层里 **L4 无账本行**（当前库无 L4 题），分层校准表因此 5 行而非 6 行——属数据事实，非漏渲染。
- 本棒**未重启 8787**：新 dist 已落盘，用户 bat 重启后 /audit 即见新画面（沿用 p18 先例）。
- 任务书「禁动 dist 规矩 — 本棒允许 build」已遵循；除 dist 外未改任何构建产物。
