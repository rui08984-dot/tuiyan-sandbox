# sim 模板库 v2 · R-B 题源设计（设计棒微步1 · 2026-09-12）

> 定位：判词重跑 R-B（信息价值实验）的前置件——非重言模板库 ≥10 条。本棒只做设计与骨架代码，**零落库**（S1 §3 硬约束：v2 清单冻结前禁新增落库；已有 90 条不动）。
> 依据：队长规划-20260912 §1.2（R-B=只收「cutoff 早于结算」的题+cutoff 时点前的账本证据，resolve 仍在未来）；万物分类清单-v1 拒收门+六层；S1 §3 Q0-3 恒定结果拒收门；p12 微步 2 cutoff-safe 口径（题面在局开始即可陈述，与结果解耦防选样泄漏）。
> 骨架：p1b/scripts/sim-templates-v2.cjs（--dry-run 只读干跑，readonly 连接，全文件无写语句）。本文全部基率为该骨架对 30 局（games 8..37）的实测读数，非估计值。

## 0. 非重言口径与三条自检门

- **非重言=Q0-3 意义**：结果随局变化（实测基率 ∈ (0,1)）。与「语义上是否与 v1 模板重合」无关；旧库 3 模板不动（不回填）。
- **Q0-1 真值锚**：全部取程序结算事件（events 表 death[dusk]/system 终局行 + games.meta.truth 程序写入真值层）——可机检。
- **Q0-2 判据冻结**：cutoff 以事件锚定义（非墙钟），骨架对每局机器断言 cutoff.seq < 结算.seq，30/30 PASS。
- **Q0-3 恒定结果拒收**：12 条模板 30 局实测全部 ∈ (0,1)，恒定结果题 **0 条**（§3 自检表）。

## 1. cutoff 时点精确定义（R-B 判据）

| 锚 | 定义 | 判词可用证据 |
|---|---|---|
| C0 | 局开始（题面陈述即定） | 空（仅题面+版型说明） |
| C1 | 昼1死亡公告事件（type=death, phase=day）之后、首条发言前 | 夜1刀口公告 |
| **C2** | **发言结束公告（最后一条 phase≠dusk 事件）之后、计票事件（type=death, phase=dusk）之前** | 夜死公告+全部 statement+挂载 claims（现库典型=8 events+约10 claims） |
| C3 | 计票事件后、终局公告前（预留，现库无此类题） | +计票 JSON |

- R-B 主判据时点=**C2**：判词可见「发言/声称/白天的投票前事件」（队长规划 §1.2 原口径），计票与胜负不可见；resolve 事件全部晚于 C2。
- C2 是人为边界（同「day1 结束」），按队长规划 §4 预注册写死公式：seq(C2) = max{ seq(e) : e.phase 不为 dusk }，禁事后挑。
- 机器校验：骨架 Q0-2 断言 seq(C2) < seq(计票 death[dusk]) 对 30 局全 PASS（收据 _v2dryrun.out 首段）。

## 2. 模板定义（12 条；layer/engine 为建议值，落库时由审计器按 v2 清单终判）

> **计数类题层归属判例注记**（适用 T3/T4/T5/T7/T9b）：v1 清单 L6 Q1 字面可争（票由对抗决策产生），本设计取口径——计数题真值语义=公开 JSON 上的算术属性（判词端对真值无反馈通道，L6 Q2「对手观测我方预测并调整」对计数真值无可作用通道），故 L6 断、落 L1（proc_calc）。旧库 template3 按 L6 记录不改（不回填）；v2 落库 checklist_hash=v2，由审计器终判，本注记供其复核。

### T1 · 第N天结束前X号存活（L6 · 时序题 · 任务指定类）
- **statement 句式**：本局第 {N} 天结束前，{X} 号存活（X 由生成器 1..6 均匀指派，题面局开始即定、与结果解耦；现语料 N=1，N 参数预留给多日版型）
- **cutoff 规则**：C2（判词时夜死已公告——X 是否夜死者部分可推，放逐未决，真值未定）
- **evidence 规则**：C2 前 events（system×2+death×1+statement×5）+挂载 claims；不可见计票/终局
- **resolve 规则**：真值 = X ∉ {夜死者, 被放逐者}；锚=终局 system 事件（夜死者=dawn death actor_seat、被放逐者=dusk death actor_seat，均经 players JOIN 还原座位号）
- **layer walkthrough**：L6①放逐由对抗投票直接产生②局内对手互相观测发言/归票并实时调整③发言+投票策略空间开放④claims 谓词与 meta.roles 可背离（伪装结构实锤）→四问全绿；Q0-3 实测 X 分列全变化
- **预期基率数量级**：0.57（X 逐局均匀指派口径 30 局实测；X=1..6 分列 0.50/0.57/0.63/0.63/0.70/0.97——6 号位存活率显著偏高，本身即 M2 策略塌缩哨兵素材）

### T2 · 被证伪身份断言 ≥K 条（L6 · 伪装结构题）
- **statement 句式**：本局被真值证伪的身份断言（is_wolf/is_good 与结算角色相反，或自称平民实为狼）不少于 {K} 条（K=4）
- **cutoff 规则**：C2（claims 全部落定于发言阶段；判词可读全部声称但不可读真值）
- **evidence 规则**：C2 前 claims 全表（谓词+主语+对象）+发言原文
- **resolve 规则**：claims × meta.roles 逐条复算矛盾数（is_wolf 指认非狼 / is_good 断言非民 / 自称平民实为狼；claims_role 其余对象保守口径不计），≥K → true；锚=终局 system 事件
- **layer walkthrough**：L6 四问同 T1①②③，Q4 直击（声称与真实身份可分离且实测 30/30 局存在 ≥2 条矛盾）→全绿；Q0-3：K=1/2 恒真已拒（min=2），K=4 落中段
- **预期基率数量级**：0.567（30 局实测；假声称计数分布 min2/p25 3/med 4/p75 5/max 7）

### T3 · 票距 ≤1（L1 · 可复算）
- **statement 句式**：本局放逐计票中，最高票与次高票之差不超过 1 票
- **cutoff 规则**：C2（投票未发生，票型真值未定）
- **evidence 规则**：C2 前 statement+claims（归票/反归票线索）
- **resolve 规则**：计票 JSON 降序取 max−secondMax ≤1 → true（无人得票时次高记 0）；锚=计票 dusk death 事件，程序复算零裁量
- **layer walkthrough**：L1①票数分布有限可枚举②计票+seed 破平规则完全程序化③计票 JSON 公开、任何观察者可复算④resolve=proc_calc（无裁判裁量）→四问全绿；L6 按 §2 判例注记断于 Q2
- **预期基率数量级**：0.367（30 局实测 11/19）

### T4 · 无弃票（L1 · 可复算）
- **statement 句式**：本局放逐投票无弃票（全部存活者均投出有效票）
- **cutoff 规则**：C2
- **evidence 规则**：C2 前 statement+claims（llm-fail 弃票在 C2 后才发生，判词端不可见——天然防泄漏）
- **resolve 规则**：计票 JSON 总票数=存活人数（6−夜死者）→ true；锚=计票 dusk death 事件
- **layer walkthrough**：L1 四问同 T3（公开 JSON 算术）；Q0-3 靠 llm-fail 稀疏性（30 局 3 局有弃票）——恒真风险随引擎稳定性下降存在，挂观察名单（§3 注）
- **预期基率数量级**：0.900（27/30；偏高端，信息价值弱于中段题，R-B 分层报告时单列）

### T5 · 最高票数 ≥M（L1 · 可复算 · 任务指定类「≥4 而非 ≥3 硬编码」）
- **statement 句式**：本局放逐投票最高票数不少于 {M} 票（M=4；阈值作为模板参数显式声明，防「对 5 名存活者硬编码 3」——M 随版型存活数重标定）
- **cutoff 规则**：C2
- **evidence 规则**：C2 前 statement+claims
- **resolve 规则**：计票 JSON max ≥ M → true；锚=计票 dusk death 事件
- **layer walkthrough**：L1 四问同 T3；Q0-3 实测率恰为 0.5（区分度最大的一档）
- **预期基率数量级**：0.500（15/30 实测）

### T6 · 首讲者未被放逐（L6 · 时序×对抗）
- **statement 句式**：本局第一条公开发言的玩家未被放逐
- **cutoff 规则**：C2（首讲者已由 statement 事件序定死，放逐未决）
- **evidence 规则**：C2 前 statement（含首讲原文）+claims
- **resolve 规则**：min(seq) statement 事件 actor_seat ≠ 被放逐者 → true；锚=计票 dusk death 事件
- **layer walkthrough**：L6 四问同 T1（放逐结果=对抗真值；首讲者=程序事实，判词不确定性的全部来源在对抗侧）；Q0-3 实测 0.633
- **预期基率数量级**：0.633（19/11 实测）

### T7 · 跨天身份声称计数 ≥K（L1 · 跨天 claim 统计题 · 任务指定类）
- **statement 句式**：截至第 {N} 天发言结束，全场累计身份声称（is_wolf/is_good/claims_role 三谓词）不少于 {K} 条（N=1, K=10；N 为跨天口径预留参数，多日版型升 N 即成真跨天题）
- **cutoff 规则**：C2（=第 N 天发言结束公告后；统计窗口闭于判词时点前，统计对象全部可见）
- **evidence 规则**：C2 前 claims 全表计数（claims.seat 为座位号，经 events JOIN 定位本局）
- **resolve 规则**：claims 表三谓词计数 ≥K → true；锚=终局 system 事件；proc_calc 零裁量
- **layer walkthrough**：L1 四问同 T3（计数=公开表算术）；判例注记适用；Q0-3：K=10 落中段（分布 min7/p25 8/med 9/p75 11/max 13）
- **预期基率数量级**：0.400（12/18 实测）

### T8 · 至少一狼得票 ≥1（L6 · 伪装归票题）
- **statement 句式**：本局至少有一名狼人获得至少 1 票
- **cutoff 规则**：C2
- **evidence 规则**：C2 前 statement+claims（好人是否被带偏归票到狼的线索）
- **resolve 规则**：计票 JSON 键集 ∩ meta.truth.wolves 非空 → true；锚=计票 dusk death 事件（真值层 join 可机检）
- **layer walkthrough**：L6 四问同 T1；真值语义含身份（非纯计数），L6 Q1 成立无疑义；Q0-3 实测 0.833（21 局好人至少一票投给狼——与「好人侧决策劣于随机」的 m1 统计同向）
- **预期基率数量级**：0.833（25/5 实测；偏高端挂观察名单）

### T9 组合题 · 放逐者是狼 ∧ 最高票唯一（L6 · parent_pid 预留）
- **配对单题**：T9a「本局被放逐者是狼人」（L6，基率 0.300=9/21，与 m1-stats village_win=9/30 独立复算一致——骨架正确性交叉验证）+ T9b「本局放逐计票最高票唯一（未触发破平）」（L1，基率 0.967）
- **statement 句式**：本局被放逐者是狼人，且其最高票唯一（无破平）
- **cutoff 规则**：C2（同两条单题）
- **evidence 规则**：同 T9a+T9b 并集
- **resolve 规则**：T9a.resolve ∧ T9b.resolve（任一 ambiguous → ambiguous）；锚=终局 system 事件
- **parent_pid 预留**：落库时本条父行引用 T9a/T9b 两单题行 id；predictions 表无该列，additive 迁移（照 p12 七字段先例）随落库微步另行评审——本棒不迁移不写库
- **layer walkthrough**：组合层=主成分 T9a 的 L6 口径；Q0-3：0.300（与单题同分布）
- **预期基率数量级**：0.300

### T10 组合题 · 首讲者存活 ∧ 无弃票（L6 · parent_pid 预留）
- **配对单题**：T6（L6，0.633）∧ T4（L1，0.900）
- **statement 句式**：本局第一条公开发言的玩家未被放逐，且投票无弃票
- **cutoff 规则**：C2
- **evidence 规则**：同 T6+T4 并集
- **resolve 规则**：T6.resolve ∧ T4.resolve；锚=终局 system 事件
- **parent_pid 预留**：同 T9 口径
- **layer walkthrough**：组合层=T6 主成分 L6；Q0-3：0.533（16/14 实测，两成分近独立）
- **预期基率数量级**：0.533

## 3. Q0 自检表（30 局实测，恒定结果题 0 条）

| id | layer | cutoff | n(30局) | true | false | 基率 | Q0-1 锚 | Q0-2 | Q0-3 |
|---|---|---|---|---|---|---|---|---|---|
| T1 | L6 | C2 | 30 | 17 | 13 | 0.567 | 终局 system+夜死/放逐 seat | PASS | PASS |
| T2 | L6 | C2 | 30 | 17 | 13 | 0.567 | claims×meta.roles 复算 | PASS | PASS |
| T3 | L1 | C2 | 30 | 11 | 19 | 0.367 | 计票 JSON | PASS | PASS |
| T4 | L1 | C2 | 30 | 27 | 3 | 0.900 | 计票 JSON 总数 | PASS | PASS |
| T5 | L1 | C2 | 30 | 15 | 15 | 0.500 | 计票 JSON max | PASS | PASS |
| T6 | L6 | C2 | 30 | 19 | 11 | 0.633 | 首 statement×放逐 seat | PASS | PASS |
| T7 | L1 | C2 | 30 | 12 | 18 | 0.400 | claims 计数 | PASS | PASS |
| T8 | L6 | C2 | 30 | 25 | 5 | 0.833 | 计票 JSON×meta.wolves | PASS | PASS |
| T9a | L6 | C2 | 30 | 9 | 21 | 0.300 | meta.roles[放逐者] | PASS | PASS |
| T9b | L1 | C2 | 30 | 29 | 1 | 0.967 | 计票 JSON 唯一 max | PASS | PASS |
| T9 | L6 | C2 | 30 | 9 | 21 | 0.300 | T9a∧T9b | PASS | PASS |
| T10 | L6 | C2 | 30 | 16 | 14 | 0.533 | T6∧T4 | PASS | PASS |

- **Q0-2 为机器断言**（非人工复核）：骨架对每局校验 seq(C2)<seq(结算)，30/30 PASS；Q0-1/Q0-3 由 resolve 函数落点与基率表背书。
- **观察名单**（非拒收）：T4 0.900 / T8 0.833 / T9b 0.967 偏高端——引擎弃票率下降或平票率走低可能滑向恒真；R-B 分层报告单列，若语料扩充后越界即触发 Q0-3 拒收重设计（阈值重标定走模板参数，不动清单）。
- **已拒变体存档**：T2 K=1/K=2（恒真，min 假声称=2）；「夜死者≠被放逐者」（规则恒真：放逐目标限存活者）——Q0-3 门的实际拦截图证。

## 4. 任务覆盖面对照

| 任务要求 | 交付 | 状态 |
|---|---|---|
| ≥10 条非重言模板 | 12 条（T1-T10 含 T9a/T9b），全部 Q0-3 PASS | ✓ |
| ≥4 条 L6 对抗题 | T1/T2/T6/T8/T9a/T9 = 6 条 | ✓ |
| 含「第 N 天结束前 X 号存活」类时序题 | T1（N 参数预留多日版型） | ✓ |
| 2 条 L1 可复算题（非恒定、非硬编码） | T3/T4/T5/T7/T9b = 5 条；T5 阈值 M 为显式参数（≥4 而非硬编码 3） | ✓ |
| 1-2 条组合题（parent_pid 预留，配对两条单题） | T9（=T9a∧T9b）+ T10（=T6∧T4）= 2 条 | ✓ |
| 1 条跨天 claim 统计题 | T7（N 参数跨天口径预留，现语料 N=1） | ✓ |
| 每条标注 R-B 判据下 cutoff 时点精确定义 | §1 C0-C3 事件锚公式+逐条 cutoff 规则；30 局机器断言 | ✓ |

## 5. 骨架用法与验证收据

- 文件：p1b/scripts/sim-templates-v2.cjs（只读干跑骨架；模板定义数组+派生量加载+Q0 机器自检+基率表+样例 trace）。
- 用法：`node scripts/sim-templates-v2.cjs --dry-run [--game 37] [--out 文件]`；传 --write 直接退出（exit 2）——零写入由 readonly 连接+无写语句+显式拒绝三重保证。
- 收据（2026-09-12 实测）：node --check exit 0；dry-run games=30，Q0-2 30/30 PASS，12 模板基率全落 (0,1)；T9a=0.300 与 m1-stats village_win=9/30 独立复算逐位一致；样例局 gid=37 trace 全 12 条走通「题面→cutoff 证据清单→resolve 真值」。收据文件：p1b/scripts/_v2dryrun.out。
- 实现注记：events.actor_seat 落库存 players.id（p1a db.js 契约），骨架读出经 `LEFT JOIN players` 还原座位号（照 listEvents 口径）——直接裸选 actor_seat 会把 player id 当座位号（本轮实测踩坑一次已修，旧 sim-titles 因只用 raw_text 匹配未触雷）。

## 6. 落库前置条件与禁区声明（本棒未做、明确留待后续微步）

1. v2 清单冻结（S1 第二批：Q0-3 进清单+L3 二元化）——冻结前禁新增落库，本棒遵守零落库。
2. parent_pid additive 迁移评审（照 p12 七字段先例）——T9/T10 落库的前置件。
3. 层归属终判：§2 判例注记（计数题 L1 口径）需在 v2 清单冻结时一并裁定；本设计不代改清单文件。
4. X/M/K/N 阈值重标定纪律：换版型（人数/天数）时阈值随存活数重标定并在题面生成器显式化，禁沿用 6 人一夜硬编码。
5. 禁改面确认：本棒未触碰 sim-titles.cjs / predictionsStore.js / verdicts.js / 万物分类清单-v1.md / 批次0+0.5 棒文件；8787 零接触。

（sim 模板库 v2 · R-B 题源设计 · 设计棒微步1 · 零落库 · 停等验收）






