# 任务 4「开放接题最小闭环」核验收据（2026-09-14）

## 一句话

实施计划任务 4 原写「待建」——**实为已于 2026-09-13 落地**（`p1b/src/routes/intake.js` 343 行 + 接题页 + 3 个 e2e ＋ `server.js:76` 已接线；计划所引路线图表述陈旧）。
本轮做的是**验收**：42 例接题单测全绿＋三个 e2e 重跑（**36/0、15/0、15/0**）；顺带修掉 e2e 里 **2 处陈旧断言**（把已接线的 L2/L5 引擎误标 FAIL）。**无产品缺陷。**

## 一 · 已存在物核验（全部盘上可核）

| 件 | 事实 |
|---|---|
| 路由 | `p1b/src/routes/intake.js`：`POST /api/intake/classify`（Q0 拒收门三问→拒收落账；决策树 L5→L6→L1→L3→L2；unknown 出口；L4 后置叠加）＋ `GET /api/intake/rejects`（分布含 0 计数）＋ `GET /api/intake/questions`（只读列表） |
| 表 | `intake_rejects` / `intake_questions`（additive 私有表）＋ 只读视图 `predictions_r4`（unknown 路径，D-8.1） |
| 引擎路由 | `ENGINE_TABLE`＋`resolveGate`：L2→stat_baseline+wilson（built）、L5→certified_dist（built）、L1/L3/L4/L6/unknown=classify-only；**概率只在 gate=scored 后出现**（未达标恒 null） |
| UI | `p1b/web/src/pages/intake/IntakePage.tsx`（232 行）；当前 dist bundle `index-CY83Hug0.js` 含接题页 |
| 单测 | `intake.test.cjs`(297 行)＋`intake-ledger.test.cjs`(112)＋`intake-engines.test.cjs`(315)：**42 例全绿**（含在全量 248/248 内） |
| e2e | `intake-e2e.cjs`（classify→拒收落账→仪表→路由位→关服直读）｜`intake-ledger-e2e.cjs`（D-8.1 视图＋g2-report 护栏）｜`intake-ui-e2e.cjs`（8791 隔离端口＋UI 列表）——三者均临时库、零碰 8787/生产库 |

## 二 · 本轮重跑读数

| e2e | 读数 | 关键验证 |
|---|---|---|
| `intake-e2e` | **36 PASS / 0 FAIL**（修前 28/2） | 拒收门四原因枚举；分布之和=总数；**路由位**：L1=proc_calc／L2=stat_baseline+wilson(built)／L3=+aci／L5=certified_dist(built)／L6=structural／unknown=none；**predicts=false ∧ prob=null**（无引擎入参 ⇒ gate≠scored，概率不得出现）；关服后只读直读落盘 |
| `intake-ledger-e2e` | 15 / 0 | intake_questions 落盘 ＋ `predictions_r4` 视图可见 ＋ g2-report 默认/`--include-intake` 主读数一致（D-8.1 护栏） |
| `intake-ui-e2e` | 15 / 0 | 静态 dist 含接题页；真实提交→分类返回；拒收分布（含 0）；只读列表（文案禁「预测」） |

## 三 · 本轮修的两处（都是 e2e 脚本陈旧断言，非产品）

`p1b/scripts/intake-e2e.cjs` 第 4 节原断言 `engine_plan.built===false`（写作时 L2/L5 引擎未接线）——
阶段 4 接线后 L2/L5 的 built 已为 true ⇒ 原断言把**正确行为**标成 FAIL（修前收据 28/2）。
已修为**逐层期望**（L2/L5 built=true；L1/L3/L6/unknown false），并新增「无入参 ⇒ predicts=false 且 prob=null」断言；
范围外表述同步收窄（L2/L5 引擎本体已接线；仍缺 L6 本体与入账层）。

## 四 · 真实剩余（范围外，非遗漏）

1. **unknown/L4 入账层**：`predictions.layer` CHECK 不放宽，入账待与 **F4 真值分库**合并为同一次计划内账本迁移（design §8 D-8.1 已写）。
2. **L6 引擎本体**未建（表里 classify-only）——按路线图属阶段 4 后续。
3. **外部题并入统一账本的域容器规则**未定义（禁沿用隐式 `corpus:*` 模式）——已显式留白。
4. 生产库 `intake_rejects`/`intake_questions` 均 **0 行**：尚无外部真实提交（是"还没人用"，不是坏）。

## 五 · 结论

**任务 4 ✅ 验收通过**——「开放接题最小闭环」= 分类（拒收门+六层决策树+unknown 出口）→ 拒收/入档 → 分层引擎路由 → 概率仅在 scored 出，
四段全在盘上且 e2e 可复跑。这也是任务 5「通俗说明·怎么用」的骨架（用户操作路径：接题页 → 填题面+六层问答 → 提交 → 看分类/拒收分布/接题库）。

## 六 · 对计划的更正

- `docs/plans/2026-09-14-通往最终目标-分步实施计划.md` 任务 4 由「新建」改为「**已存在（09-13）· 本轮验收**」；
- 更正来源：计划引用路线图「阶段 3 待补出口件」的 **2026-09-13 前**表述；实际同日已随序 0-4 落地（server.js:76 有注释可查）。

---

（收据完 · 2026-09-14 · 任务 4 验收通过 · e2e 36/0 + 15/0 + 15/0 · 全量 248/248）
