# 开放接题最小闭环 · 端到端收据（阶段 3 出口件，2026-09-13）

- 执行：`p1b/scripts/intake-e2e.cjs`（app.inject 真 HTTP 语义，零监听端口；P1B_LLM_MOCK=1 零网络）
- 临时库：`C:\Users\crx\AppData\Local\Temp\p1b-intake-e2e-1476-1789366649289.db`
- PASS 生产库零写（临时库 ≠ 默认生产库） — default=E:\music player\p1a-terminal\data\p1a.db

## 1. 分类：真实候选题 → 六层判定 + 引擎位
- 题面：2026-09-12 上海最高气温 > 35°C（cutoff=2026-09-11 20:00，真值锚=气象台官方日最高气温）
- 返回：`{"ok":true,"rejected":false,"layer":"L3","secondary":null,"checklist_hash":"v3","engine":"stat_baseline","calibrator":"aci","gate":"descriptive"}`
- PASS HTTP 200 — status=200
- PASS 合格题 layer=L3 — layer=L3
- PASS engine=stat_baseline（+aci） — {"layer":"L3","engine":"stat_baseline","calibrator":"aci","posture":"classify_only","built":false,"predicts":false,"gate":"descriptive"}
- PASS gate=descriptive（只记账不出数）
- PASS checklist_hash=v3

## 2. 记账：真实候选题过不了拒收门 → intake_rejects 留痕
- 题面：某公司是否会在 2026-09-20 前内部拍板 A 方案（决策过程不公开，第三方无可复核记录）
- 返回：`{"ok":true,"rejected":true,"reason":"no_anchor","reject_id":1,"gate":"descriptive"}`
- PASS HTTP 200（拒收不是失败）
- PASS rejected=true / reason=no_anchor — reason=no_anchor
- PASS 留痕 id 已分配 — reject_id=1
- unknown 出口用例：某自然人 2026-10-01 当天是否穿红色外套（一次性人类选择，无反馈回路、无同类样本池）
- 返回：`{"ok":true,"rejected":false,"layer":"unknown","engine":"none"}`
- PASS unknown 出口：layer=unknown 且非拒收 — layer=unknown

## 3. 仪表可见：GET /api/intake/rejects（拒收原因分布，含 0 计数）
- 返回：`{"ok":true,"total":1,"by_reason":[{"reason":"no_anchor","n":1},{"reason":"leak","n":0},{"reason":"tautology","n":0},{"reason":"other","n":0}]}`
- PASS HTTP 200
- PASS 总拒收 ≥1 — total=1
- PASS no_anchor 可见且 ≥1
- PASS 枚举四原因全列出（含 0 计数）
- PASS 分布之和=总数
- PASS UI 文案禁「预测」字样

## 4. 分层引擎路由（layer→engine 位 + built 现状）
- PASS engine 位 L1=proc_calc — got L1/proc_calc
- PASS engine_plan.built=false（L2/L5 已接线；其余 classify-only）
- PASS engine_plan.predicts=false（本组无引擎入参 ⇒ gate≠scored，概率不得出现）
- PASS engine 位 L2=stat_baseline — got L2/stat_baseline
- PASS engine_plan.built=true（L2/L5 已接线；其余 classify-only）
- PASS engine_plan.predicts=false（本组无引擎入参 ⇒ gate≠scored，概率不得出现）
- PASS engine 位 L3=stat_baseline — got L3/stat_baseline
- PASS engine_plan.built=false（L2/L5 已接线；其余 classify-only）
- PASS engine_plan.predicts=false（本组无引擎入参 ⇒ gate≠scored，概率不得出现）
- PASS engine 位 L5=certified_dist — got L5/certified_dist
- PASS engine_plan.built=true（L2/L5 已接线；其余 classify-only）
- PASS engine_plan.predicts=false（本组无引擎入参 ⇒ gate≠scored，概率不得出现）
- PASS engine 位 L6=structural — got L6/structural
- PASS engine_plan.built=false（L2/L5 已接线；其余 classify-only）
- PASS engine_plan.predicts=false（本组无引擎入参 ⇒ gate≠scored，概率不得出现）
- PASS engine 位 unknown=none — got unknown/none
- PASS engine_plan.built=false（L2/L5 已接线；其余 classify-only）
- PASS engine_plan.predicts=false（本组无引擎入参 ⇒ gate≠scored，概率不得出现）
- 实测：L1 → proc_calc ｜ L2 → stat_baseline+wilson(built) ｜ L3 → stat_baseline+aci ｜ L5 → certified_dist(built) ｜ L6 → structural ｜ unknown → none
- L4=classify-only（engine=none，叠加标注维度，本轮不在决策树内）

## 5. 落盘直读（关服后新只读连接）
- intake_rejects 表在：YES，行数 1
  · #1 reason=no_anchor ｜ 某公司是否会在 2026-09-20 前内部拍板 A 方案（决策过程不公开，第三方无可复核记…
- PASS 表已落盘
- PASS 拒收行已持久化 — rows=1

## 结论
- 断言：PASS 36 / FAIL 0
- 未做（本片范围外）：L4 叠加的可持久化列（predictions.layer CHECK 仍限 L1-L6，unknown/L4 只在接题入口返回，入账留待 F4 同批迁移）；L6 引擎本体；接题题面落 predictions（需 game_id/域容器规则）。
- 生产库 `E:\music player\p1a-terminal\data\p1a.db` 零写：全程只用临时库 `C:\Users\crx\AppData\Local\Temp\p1b-intake-e2e-1476-1789366649289.db`。
