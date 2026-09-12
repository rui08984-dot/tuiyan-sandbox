# p22-PROGRESS —— 审计页交互改造：数据堆砌 → 三层递进（p1b/web / #/audit）

- 任务书：E:/music player｜「审计页交互改造」棒（父 agent session-41d2037b）
- 用户反馈原话：「审计那边就是列了一堆数据…后面最终出来的时候应该有个交互界面」
- 结论：**验收门 4/4 全过**（node --check ✅ / npm.cmd run build exit 0 ✅ / headless DOM 实测 24 项 PASS ✅ / 铁律词检 0 命中 ✅）
- 实验时间：2026-09-12T17:24（本机）；隔离实例 :8794 + Edge headless CDP :9224；**8787 零接触**

## 1. 改了什么（4 个文件，全部落在允许范围）

| 文件 | 改动 | 行数 |
|---|---|---|
| `p1b/web/src/App.tsx` | appbar-nav 在「管理」后插 `<NavLink to="/audit">审计</NavLink>`（修 bug：/audit 原只能手输网址） | 64（+3） |
| `p1b/web/src/pages/audit/AuditPage.tsx` | 三层递进重构（第一屏状态卡 / 第二屏 L1-L6 可展开卡 / 第三屏明细折叠） | 271 → 353 |
| `p1b/web/src/styles/audit.css` | 追加三层递进样式块（hero / 分层卡 / 折叠） | 64 → 113 行（3118 → 6078 B） |
| `docs/sandbox/p1b/itest/p22-e2e.mjs` 等 | 新增 p22 headless 实测脚本与产物 | 新建 |

**未动**：p1a-terminal/**、p1b/src/botc/、p1b/src/routes/audit.js（后端零改）、meihua.js、p7-p9、8787、providers.json。
**保留**：现有 fetch 逻辑（`api.getAuditSummary()` 原样）+ p20 已验收全部 data-testid（audit-page / audit-banner / audit-ledger-card / audit-gate-card / audit-calib-card / audit-forward-card / audit-layer-calib-card / audit-layers-card / audit-layer-L1..L6 / audit-ra-line / audit-rb-line / audit-exploratory 等，实测 6/6 保留）。

## 2. 三层递进结构（实测 DOM）

- **第一屏·一句话状态**（`data-testid=audit-hero`）：三张大号数字卡 —— 「270 在观察 · 未回填真值」「602 已回填 · 真值已到」「已解锁 门禁状态」+ 一句人话总结「账本已解锁，正在观察 270 条前瞻题（已回填 602 条真值）—— 读数可出具，仍只作参考。」+ 数字旁恒挂「参考」+ 折叠的口径细节（总账/有效口径/覆盖局数）。
- **第二屏·分层账本**（`audit-layers-screen` → `audit-layer-grid`）：**六张卡** L1 决定论 / L2 系综 / L3 短窗混沌 / L4 自反（叠加层）/ L5 不可约随机 / L6 对抗；折叠态即显示「题量 / 已解真值 / 校准参考」摘要，点击 `<summary>` 在当前卡内展开该层明细（题量/已解真值/校准参考/基率/层定义/引擎姿态/已判真·假与无法判定计数）。实测：默认 0 张展开 → 点 L6 后 open=1。
- **第三屏·明细表**（`audit-detail-fold`）：默认折叠 `<details>`，内收原五块表（账本分层 / 门禁状态 / 分层校准汇总 / 待解前瞻 / 六层说明），展开后原卡片与表格结构一字未改。

## 3. 验收门实测证据（全部可复现）

**门 1 · node --check**
```
cd docs/sandbox/p1b/itest; node --check p22-e2e.mjs   → CHECK=0
```
（前端 TSX 无手写 JS 产物，语法正确性由门 2 的 tsc 承担。）

**门 2 · npm.cmd run build（p1b/web）**
```
> tsc && vite build
✓ 78 modules transformed.
dist/index.html 0.47 kB │ dist/assets/index-C2KoH4aa.css 32.51 kB │ dist/assets/index-BRXPntAZ.js 284.90 kB
✓ built in 615ms
BUILD_EXIT=0
```
（tsc 无错误即证明 App.tsx / AuditPage.tsx 类型与语法全通。）

**门 3 · headless 实测（`node p22-e2e.mjs`；快照真库 p1a.db → p22.db VACUUM INTO，只读源；隔离 :8794 + Edge headless CDP :9224）**
```
VERDICT COUNT=24  FAIL=0   （E2E_EXIT=0）
PASS 隔离实例就绪
PASS HTTP 200 | status=200
PASS l0_gate 双口径字段齐 | games=34 records=872 records_valid=842 resolved=602 unresolved=270 review_unlocked=true
PASS layer_calibration 非空 | n=5
PASS pending_forward_total>0 | total=248
PASS Edge CDP 就绪
PASS appbar-nav 含审计导航链接 | 现场|#/ , 管理|#/manage , 审计|#/audit , ☯ 排盘|#/mystic
PASS 点击导航后落在 /#/audit 且页面渲染 | #/audit :: true
PASS 第一屏状态卡存在
PASS 第一屏三张数字卡（在观察/已回填/门禁） | 270
PASS 第一屏含一句人话总结 | 账本已解锁，正在观察 270 条前瞻题（已回填 602 条真值）—— 读数可出具，仍只作参考。
PASS 第一屏数字旁挂「参考」
PASS 第二屏六张分层卡 L1-L6 | cards=6
PASS 分层卡 id=L1..L6 | audit-lcard-L1 … audit-lcard-L6
PASS 分层卡默认折叠 | open=0
PASS 点击卡片可展开该层明细（第二屏内折叠） | CLICKED open=1
PASS 展开后显示 题量/已解真值/校准参考/基率 | L6
PASS 折叠态卡片即显示 层名/题量/已解/校准参考 | L6
PASS 第三屏明细默认折叠 | open=false
PASS 第三屏标题含明细清单
PASS p20 已验收的六块卡片全部保留 | 6/6
PASS 展开后落在第三屏折叠区内部
PASS 六层说明行仍在（audit-layer-L1..L6）
PASS 铁律：UI 全文（含展开明细）禁「预测/预报/押注/胜率」0 命中 | hits=[] len=5615
```
产物：`p22-e2e-out.txt`（逐条）、`p22-verdicts.json`（机器可读 24 条）、`p22-api-summary.json`（真库响应）、
`p22-audit-dom-full.txt`（展开全部折叠后的完整 innerText 10197 B）、`p22-audit-desktop-1280.png`、`p22-audit-mobile-390.png`。

**门 4 · 铁律词检（本报告落盘）**
```
DOM 全文词检（含折叠区）：预测=0 预报=0 押注=0 胜率=0
UI 文案用词：审计 / 校准参考 / 分层账本 / 待解前瞻 / 只记不评（替代字样，符合铁律）
纯展示零 LLM：本棒只改前端 3 个文件 + 新增测试脚本，未新增任何模型调用；页面数据仍全部来自 \`GET /api/audit/summary\`（纯 SQL 只读）
## 4. 待办 / 风险 / 未宣称项

- `layer_calibration` 实测只 5 层（L1/L3/L4/L6 + 未分层，见 p22-api-summary.json）——**L2/L5 无账本记录**，第二屏对应卡如实显示「账本暂无该层记录」，未编造数字（设计如此）。
- 未分层/重言隔离计数在第二屏为「账本计数，参考」；不参与门禁口径（门禁口径仍在第三屏 `audit-gate-card` 与 `l0Gate` 双口径）。
- 手机竖屏（390×844）截图已出（`p22-audit-mobile-390.png`）；本机浏览器实测优先（用户既定偏好），未连手机。
- 未被本棒验收：后端 `/api/audit/summary` 未改（无需改）；第二屏展开态的「基率」在无 settled 样本层显示「样本不足」（如实留空）。

## 5. 复现命令

```
cd "E:/music player/p1b/web"            && npm.cmd run build
cd "E:/music player/docs/sandbox/p1b/itest" && node p22-e2e.mjs      # 期望 E2E_EXIT=0 / FAILS=0
cd "E:/music player/docs/sandbox/p1b/itest" && node p22-report.cjs   # 期望 VERDICT COUNT=24 FAIL=0
```
