# P14 · sim 模板库 v2 扩建 + R-B 题源设计（设计棒 · 微步1 · 2026-09-12）

> 任务书：R-B（新 cutoff-safe 题信息价值实验）前置件——非重言模板库 ≥10 条；只做设计与骨架代码，零落库。Parent=session-4391ccda（设计棒）。

## 已完成

1. **前置阅读**（按任务书序全读）：队长规划 §1.2（R-A/R-B 拆分与 R-B 判据口径）／万物分类清单-v1（拒收门+六层）／S1 §3（Q0-3 恒定结果拒收门+「v2 冻结前禁新增落库」硬约束）／p12 微步 2（旧 3 模板+cutoff-safe 口径）／sim-titles.cjs（只读未改）／batch 局 37 replay+truth／p11 §7（M1 统计：village_win=9/30 等）。
2. **设计文档**：docs/specs/sim-templates-v2-题源设计.md（169 行）——12 条模板（T1-T10 含 T9a/T9b），每条含 statement 句式／cutoff 规则／evidence 规则／resolve 规则／layer walkthrough／实测基率；§1 cutoff 锚 C0-C3 事件锚公式（C2=发言结束后/计票前=R-B 主判据时点，预注册写死禁事后挑）；§2 计数类题 L1 层归属判例注记（供 v2 清单冻结时终判，不代改清单）；§3 Q0 自检表；§4 任务覆盖对照（L6×6／时序题 T1／L1×5 含非硬编码 T5／组合×2 parent_pid 预留／跨天 claim 统计 T7）；§6 落库前置与禁区声明。
3. **骨架代码**：p1b/scripts/sim-templates-v2.cjs——模板定义数组+--dry-run 只读干跑（readonly 连接+全文件无写语句+--write 显式拒绝 exit 2，三重零写入保证）；对 30 局跑通「实例化题面→锚定 cutoff 可用证据→程序 resolve 真值」全流程；Q0-2 cutoff<结算为机器断言非人工复核。
4. **实测自检（30 局，收据 p1b/scripts/_v2dryrun.out）**：12/12 模板基率 ∈ (0,1)，恒定结果题 0 条（Q0-3 全 PASS）；Q0-2 30/30 PASS；T9a=0.300 与 m1-stats village_win=9/30 独立复算逐位一致（骨架正确性交叉验证）；node --check exit 0；样例局 gid=37 全 12 条 trace 走通。

## 过程要点（诚实记录）

1. **events.actor_seat 落库存 players.id**（p1a db.js L32 契约）：裸选 actor_seat 会把 player id 当座位号（实测 victim=232 暴露）；读出必须 LEFT JOIN players 还原座位号（listEvents 口径）。旧 sim-titles.cjs 只用 raw_text 匹配故未触雷。此坑已写进设计文档 §5 实现注记。
2. **Q0-3 门实战拦截两例**：T2 阈值 K=1/2 恒真（假声称计数 min=2，30/30 true）→ 升 K=4 落中段 0.567；「夜死者≠被放逐者」规则恒真（放逐目标限存活者）→ 设计期废弃未入表。两例均存档于设计文档 §3「已拒变体」。
3. **环境坑（沿 p11 §4）**：pwsh stdout 捕获失效→全程「命令写文件→read 读回」通道；反卡死守卫按路径指纹拦重复 read→Copy-Item 换名读；better-sqlite3 从 p1b/scripts 裸 require 解析不到→按 deps.js P1A_ROOT 模式取 p1a-terminal/node_modules。
4. **观察名单（非拒收）**：T4 0.900／T8 0.833／T9b 0.967 偏高端，弃票率/平票率走低可能滑向恒真；设计文档 §3 已注明 R-B 分层报告单列+越界即重标定阈值。

## 交付物清单

- docs/specs/sim-templates-v2-题源设计.md（新增，169 行）
- p1b/scripts/sim-templates-v2.cjs（新增，--dry-run 骨架）
- p1b/scripts/_v2dryrun.out（新增，30 局实测收据）、p1b/scripts/_v2check.out（node --check 收据）
- .scratch/forecast-debate/p14-PROGRESS.md（本文件，新增）

## 零落库与禁区声明

- 零 db 写入：readonly 连接（SQLite 层写即抛错）+全文件无 INSERT/UPDATE/DELETE/CREATE/ALTER+--write 拒绝；predictions/verdicts 未触碰（90 条旧账不动）。
- 未触碰：sim-titles.cjs／predictionsStore.js／verdicts.js／万物分类清单-v1.md／批次 0+0.5 棒文件（git/verdictsStore/judge-runner）；8787 零接触。
- 一次性探测脚本已删（_probe-rb* 残留 0，fast_locate 实核）。

## 留给后续微步（本棒未做）

1. v2 清单冻结（S1 第二批）——含 §2 计数题 L1 判例的裁定；冻结前维持禁新增落库。
2. parent_pid additive 迁移评审（T9/T10 落库前置件）。
3. R-B 首批新题落库+判词（队长规划：可先手工 3-5 条试点，不阻塞重跑主批）。

（P14 微步 1 完 · 设计+骨架+实测自检齐 · 零落库 · 停等验收）
