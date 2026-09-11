# P12 · 万物审计器 MVP-A · 微步 1 进度（2026-09-11）

## 已完成
1. **账本 7 字段 additive 迁移**（p1b/src/db/predictionsStore.js）：layer/secondary_layer/engine/baseline_brier/public_exposure/checklist_hash/gate——全部可空、零破坏既有列；ensurePredictionsTable 内 PRAGMA 检缺列+事务 ALTER（旧库兼容，锁瞬时）；rowToPrediction 带出七字段；insertPrediction 支持可选审计参数（assertAuditFields 校验：layer/gate 枚举+baseline_brier [0,1]+public_exposure 0/1）；新增 updateAuditFields(id,f) 补录/清空（undefined=不传/null=显式清空/非法抛错）；导出 updateAuditFields/LAYERS/GATES。
2. **测试**：新增 p1b/test/predictions-audit.test.cjs 8 用例（迁移模拟/带字段读回/向后兼容全 NULL/非法枚举×4/CHECK 兜底/updateAuditFields 四态/l0Gate 不受影响/枚举导出）——**8/8 绿**；**node --test 全量 147/147 绿**（139 基线零退化+新增 8），收据 test/full-run.out（TEST_EXIT=0）。**【初报误记更正】**初报「154/154」有误，队长亲测 **147/147** 为准：154 的成因=当时 test/ 目录里 7 个一次性修复脚本（fix-schema×6+diag-schema×1）尚未删除，被 node --test 当测试文件各误计 1 个文件级 pass（147+7=154）；脚本删除后复跑实测 147/147，收据已更新。教训=跑全量前先清目录非测试文件。
3. **分类清单资产化**：docs/specs/万物分类清单-v1.md（73 行，checklist_hash=v1 冻结）——拒收门两问+六层清单（L5→L6→L1→L3→L2→L4 决策序）+落库记录表+走通示例+引擎速查；修订规则=改清单必升版本号不回填旧题。

## 实施过程要点（诚实记录）
- SCHEMA 行级 edit 经历 6 轮修复才绿：根因=（a）cols-v2 构造时 layer/secondary/gate 三行漏 SQL 逗号、baseline/public 两行同样漏（转义管道多层漂移，read 显示层截断一度误导诊断）；（b）修复用 pwsh 正则两次因转义层错位失败。终解=**write 落盘无正则 node 修复脚本 + JSON.stringify 诊断**（node 视角逐行 JSON 才看到真实字符）。教训已验证：本环境对含引号嵌套的代码行，一切 shell 级字符构造不可靠，必须走落盘脚本。
- M1 批量状态核查：sim-replays 目录不存在（M1 未落盘产物），ALTER 仍以事务瞬时执行（实际毫秒级），未超 5s 锁限。
- fix-schema*.cjs 一次性修复脚本已全部删除（清理验证=残留 0）。

## 交付物清单
- p1b/src/db/predictionsStore.js（修改：+7 列 schema+迁移+读模型+insert+updateAuditFields+常量导出）
- p1b/test/predictions-audit.test.cjs（新增 8 用例，8/8 绿）
- p1b/test/full-run.out（全量 **147/147** 收据，已更新）、test/audit-run.out（单文件 8/8 收据）
- docs/specs/万物分类清单-v1.md（判据核心资产，hash=v1）

## 微步 2 · sim 题源接入（2026-09-11 完）

**题源**：M1 批量 30 局（gid 8-37，source=sim，一夜狼版型，events=death60/statement150/system90）。每局 3 条 cutoff-safe 模板题（题面在局开始时即可陈述，与结果解耦防选样泄漏）×30 局 = 90 条：
1. 本局狼人阵营胜利 → 真值=终局 system 事件——layer=L6（对抗四问全过，清单可用）
2. 本局首夜平安（无人死亡） → 真值=夜 1 death 事件有无——layer=L1（决策树边界案例如实记录：一夜狼必有刀→命题恒 false，属规则重言式而非可预测性问题；v1 清单无恒定结果拒收门，本批按 L1/proc_calc 落账；改良建议：v2 清单增 Q0-3 结果是否随实例变化，恒定即拒收）
3. 本局放逐投票最高票数 ≥3 票 → 真值=放逐计票 JSON——layer=L6

**落库**：90 inserted / 0 skipped（幂等防重：同 game_id+statement 查重）；七审计字段全填（gate=descriptive / checklist_hash=v1 / public_exposure=0 / engine=structural 或 proc_calc）；assigned_prob=0.5 均匀基线占位（占位口径：无信息基线，真 3 路判词 implied_prob 下微步接入）；resolve=90 全回填（true 44 / false 46，程序结算真值无歧义）；evidence_json 引用对应结算事件 id。

**l0_gate 状态**：games=30 / records=90 / resolved=90 / unresolved=0 / review_unlocked=false（90<200，只记不评维持，UI 参考铁律不变）。

**测试**：node --test 全量 147/147 绿（139+8 自洽）。过程清扫：临时侦察脚本 recon-sim.cjs 已删（曾致 1 fail）；sim-titles.cjs 落库脚本移至 p1b/scripts/（防 test/ 目录文件级 pass 污染计数——微步 1 教训落地）。库说明：predictions 表建于缺省库（deps 决定，与 sim 局同库同账本），微步 1 七列迁移已在真库生效。

**占位与待办**：assigned_prob=0.5 占位（90 条 Brier 恒 0.25 语义，仅记账演示无校准信息）；微步 3 待令=3 路判词 implied_prob 接入替换占位，并按 layer 分层出校准报表（报表纪律：跨层只比过程指标）。

## 微步 3 · 判词接入+分层校准报表（2026-09-11 完 · Q 棒收官）

**判词生成**：90 条 × 3 路（v1_evidence/T0.2、v2_skeptical/T0.7、v3_baserate/T1.0）走生产 verdicts 端点（app.inject 同生产链路，tokenrhythm live，幂等保首条）=270 次真 LLM 调用，后台 job 约 18 分钟完成。**机械抽取契约 100% 命中**：median 写回 90 / 抽取失败 0（末行 P=0.xx 契约全部合规）；写回后 assigned_prob=median(三路 implied_prob)（0.5 占位被替换）。

**分层校准报表（探索性声明：90<200 只记不评；L6 ECE 为 10 桶下界口径——K F58 分桶恒低估）**：
- 样本：L6=60 / L1=30 / 全部=90
- **L6 ECE=0.2114**（下界口径）：桶[0.4-0.5) n=23 true_rate=0.696；桶[0.5-0.6) n=28 true_rate=0.786——判词系统性**欠自信**（低置信高命中）
- **Brier 对比（第一份「判词 vs 无信息基线」真数据，90 点）**：0.5 占位=**0.2500**；v1_evidence=0.3876（n=86）/v2_skeptical=0.3285（n=89）/v3_baserate=0.3360（n=88）/median 写回=0.3617——**三路判词全部劣于无信息基线**（负结果，与 D-裁决「判词=基率噪声版」风险预言一致：outcome 基率≈49% 而判词中位偏 Yes，acquiescence 方向错配）
- **L1 重言式单列**：n=30 outcome 恒 false，Brier=mean(p²)——占位校准无信息，语义已标注

**3 路相关矩阵 → λ̂ → γ̂（K 棒公式首次跑真数据）**：r(v1~v2)=0.3134 / r(v1~v3)=0.1625 / r(v2~v3)=0.0473 → **λ̂=0.1744 → γ̂=3/(1+2λ̂)=2.2243**——三路多样性真实存在（相关性低），γ̂=2.22 强于 AIA 固定 √3≈1.73。**诚实限定**：在判词整体劣于无信息基线的前提下，γ̂ 只证明「结构参数可估计」，不构成「极端化有效」的证据——先修判词质量（本数据指向：判词需按结果基率再校准，TS 在前纪律的必要性被本数据反向确认）。

**测试**：node --test **147/147 绿**（TEST_EXIT=0）。脚本归档：p1b/scripts/judge-runner.cjs（批量判词）、p1b/scripts/report-layered.cjs（分层报表）、sim-titles.cjs（题源接入）。

---
# P12 终态（万物审计器 MVP-A 全收口 · Q 棒退役）

- 微步 1：账本七字段+迁移+分类清单 v1 冻结 ✓（147/147）
- 微步 2：sim 题源 90 条落库+程序真值 resolve ✓（147/147）
- 微步 3：270 次真判词+median 写回+分层报表+λ̂/γ̂ 首跑 ✓（147/147）
- **审计器 MVP-A 闭环成立**：分类（六层判据）→记账（七审计字段）→判词（3 路生产链）→resolve（程序真值）→分层报表（ECE 下界+Brier 对照+λ̂/γ̂）——全链路零检索代码、探索性声明全程挂载、负结果如实入账（判词劣于无信息基线是审计器抓到的第一个真发现）。
- 后续挂账（不属本棒）：真判词质量改进（基率校准/TS 重拟合）、λ̂/γ̂ 极端化在判词修复后的复测、G2 三过程指标月度窗口、L2/L5 层题型扩充。

（Q 棒退役 · 万物审计器 MVP-A 全收口 · 产线感谢）