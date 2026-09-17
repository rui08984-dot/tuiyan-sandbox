# 负结果账本 v0（对内 · 2026-09-17）

> 四要素：假设／判据（路径＋sha16）／结局／复算入口；缺一即撤（15-I2）；负结果也是产出：本账本只列「跑过并有读数」或「设计层正式拒绝」；不列未跑事项

## 实证类（跑过·有读数）

- **H1 命题 A（多路判词消融信息增益）**：负结果止发：全量 2158/2160，主判据 Δ=+0.00299（CI 含 0、<0.02）；v1.1 分层方向不一致（regime A +0.01438／B −0.02925）⇒ 以 regime A 为准，止发维持
  · 判据 `.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md`（sha16 `3828b920d0aa57fb`）｜证据 `docs/specs/命题A-全量消融判定报告-20260914.md`（sha16 `7e8c09eb1f219bf7`）｜复算：`node p1b/scripts/prereg-a-run.cjs（补漏入口见 .scratch/forecast-debate/prereg-a/PAUSE-RESUME-20260914.md）`
- **H2 R-B 信息价值（证据注入）实验**：负结果：合并条款三路全未达成（TOST 三路≈基率）；归因诊断指出「LLM 判词未充分利用可用信号」（claims 从未注入＋200 字截断）
  · 判据 `.scratch/forecast-debate/PREREG-RB-v1-待确认.md`（sha16 `a6c78a7edd46efeb`）｜证据 `.scratch/forecast-debate/rb-attribution-诊断-20260913.md`（sha16 `20dd6b01d0ef0f87`）｜复算：`node p1b/scripts/rb-score.cjs`
- **H3 R-C 判词修复 2.0（证据呈现方式）**：负结果（模型层结论成立）：v1@T2 +0.092★／T6 +0.067★ 仅 2 型<3 未达成；TOST 三路等价 ⇒ 机械直算接管；局部探索性信号（claims 注入在计数类题起效）留多日局/新场景复核
  · 判据 `.scratch/forecast-debate/PREREG-RC-v1-待确认.md`（sha16 `a560203b099620a6`）｜证据 `p1b/sim/out/rc-full-run.log`（sha16 `98fb4f81476ae0a4`）｜复算：`node p1b/scripts/rc-score.cjs`
- **H4 VoI 开口规则（弱口径）**：负结果：开口子集更差（+0.2965），τ_D 塌窗 3/90 ⇒ VoI 门不建，留文字版三准则
  · 判据 `.scratch/forecast-debate/voi-a-report-20260912.md`（sha16 `7e802839a52191b5`）｜证据 `.scratch/forecast-debate/voi-a-report-20260912.md`（sha16 `7e802839a52191b5`）｜复算：`node p1b/scripts/voi-a.cjs`
- **H5 校准挑战者 beta calibration（离线 A/B 主口径）**：未达非劣：n=695，Δ=+0.0014 CI[−0.0048,+0.0083]、resolution 下降 ⇒ 维持恒等（现役不动）；P0 只出报告，替换动作属 P1
  · 判据 `p1b/sim/out/calab-report-20260916.json`（sha16 `5cb093a4e592d1f7`）｜证据 `p1b/sim/out/calab-report-20260916.json`（sha16 `5cb093a4e592d1f7`）｜复算：`node p1b/scripts/calab-run.cjs`
- **H6 E2 路由 R3a/R3h（误差反馈/在线加权）**：**前置闸否决**（非跑输）：跨引擎重叠人口 = 0 ⇒ R3 双臂不可估；组合预检 ρ̂ 无 ≥10 题引擎对 ⇒ 先不要立票（先跑后立出证据）
  · 判据 `.scratch/forecast-debate/PREREG-E2-路由分配-v1.md`（sha16 `4c6403c5f793530f`）｜证据 `p1b/sim/out/e2-shadow-20260916.json`（sha16 `077688b8b0e1b1ab`）｜复算：`node p1b/scripts/e2-shadow-score.cjs`
- **H7 D2 回测 model 臂（第一版模型）**：K4 如实报无增量（v1 model≡base）：Δ(vs b(1−b))=−0.0067；A1–A7/K1–K4 全 PASS 属**管线验收**非能力宣称
  · 判据 `.scratch/forecast-debate/PREREG-D2-历史回测引擎-v1.md`（sha16 `33d4927d54eec38d`）｜证据 `.scratch/forecast-debate/PREREG-D2-历史回测引擎-v1.1-补充与勘误.md`（sha16 `9b2c2b8518bb67da`）｜复算：`node p1b/scripts/d2-run-backtest.cjs`
- **H8 阶段 5 检索式证据（路线 a）**：实证否决：跨 25 kind 抽 52 题真跑 ⇒ 证据产出率 **0/52**；论证「前瞻题要么空、要么泄」⇒ 路线 (a) 归档（(b) 前瞻数值信号另立并已达标）
  · 判据 `.scratch/forecast-debate/PREREG-检索式预测-v1-骨架.md`（sha16 `380798cb28f44d2b`）｜证据 `docs/specs/阶段5-检索可行性勘察-20260915.md`（sha16 `2cde6dfe646f3070`）｜复算：`（勘察件本身为证据；无复算脚本）`
- **H9 ACR 抗投毒（full 窗口径）**：负结果（口径修正）：cutoff 窗 PASS（0.0875/0.0850/0.0422）／full 窗 FAIL 0.6485 ⇒ **漂移由事件窗决定，非投毒本身**——机制结论改写（非能力宣称）
  · 判据 `.scratch/forecast-debate/acr-二期报告-20260912.md`（sha16 `edbc746e752de6e1`）｜证据 `.scratch/forecast-debate/acr-二期报告-20260912.md`（sha16 `edbc746e752de6e1`）｜复算：`node p1b/scripts/acr-run.cjs（机械层）／acr-run-llm.cjs（LLM 层）`
- **H10 E1 · DNA 加列制 S 维（平稳/漂移标签）**：负结果（弃权条款逐字生效）：前置门通过（双编码 34/34＝1.0）⇒ 生产写入 1792 行 ⇒ **ΔCI 含 0（三口径一致**：§3 主口径 Δ=+0.0025 CI[−0.0187,+0.0236]／Brier(assigned_prob) Δ=−0.0000 CI[−0.0201,+0.0188]／原 y 池化 CI[−0.0248,+0.0802]）⇒ **S 维永久降为文档标签、姿态门与路由主张一并放弃、DNA 线终止**；标签已归档为文档件、旁路表/视图已 DROP；禁换维度续命、禁以功效不足复议
  · 判据 `.scratch/forecast-debate/研讨会-20260916-预测万物v3/12-PREREG-E1-DNA加列S维-v1.md`（sha16 `dcb4af80a97b20af`）｜证据 `p1b/sim/out/e1-judge-receipt-20260917.md`（sha16 `9a2fb85441df3a00`）｜复算：`node p1b/scripts/dna-s-backfill.cjs --db <副本> --route source --confirm --no-snapshot（确定性可复现）⇒ node p1b/scripts/dna-s-judge.cjs --db <副本> --gate p1b/sim/out/e1-gate-attestation-20260917.json`

## 设计层拒绝（文献/分析层，非实证）

- **D1 专家网络（多底座集合）**：单底座≠3 成员集合（Krishnamurti 1999 独立性语言不成立）；随 S7 死刑（来源 `.scratch/forecast-debate/研讨会-20260916-预测万物v3/11-拒绝项救援-深度报告.md`，sha16 `95de5d914d6de341`）
- **D2 乘法公式（概率直乘）**：降格收编为 O6＋G2 门④；KL 相对熵替代（来源 `.scratch/forecast-debate/研讨会-20260916-预测万物v3/11-拒绝项救援-深度报告.md`，sha16 `95de5d914d6de341`）
- **D3 因果图/反事实沙盒（对外版）**：因果图死刑；反事实降级为对内假设重算器（A1）；上界探针存活（来源 `.scratch/forecast-debate/研讨会-20260916-预测万物v3/11-拒绝项救援-深度报告.md`，sha16 `95de5d914d6de341`）
- **D4 LLM 多智能体辩论主持**：文献轮空＋同质性（WC2026 四前沿 agent 92% 相同首选；单底座 λ≈1 无信息差）（来源 `.scratch/forecast-debate/研讨会-20260916-预测万物v3/17-AI角色重定位-深度报告.md`，sha16 `73b71408fb44ce33`）

（零 LLM／零写库 · 本件为对内 v0；对外主件属第 4 期）
