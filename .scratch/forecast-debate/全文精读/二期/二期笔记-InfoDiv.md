# 二期笔记 · Information Diversity（Satopää NIPS 2014）· 微步B7

> 论文：Modeling Probability Forecasts via Information Diversity（arXiv:1406.2148，**v5**；Satopää, Baron, Foster, Mellers, Tetlock, Ungar，NIPS 2014）
> 获取路径：pwsh 抓 abs+HTML v5（284KB）→ _extract-html.cjs txt 70,676 B/1,390 行（公式完整）。
> 缓存：cache/_abs-1406.2148.html + _cache-InfoDiv-1406.2148v5.html + _cache-InfoDiv-1406.2148v5.txt（行号锚）。
> **与 K5 的关系（本笔记主轴）**：本文=K5（1501.06943）的**原始 NIPS 会议版**——K5 笔记 F51/F52/F54/F55 四式在本文全部找到母式；精读策略=对照找版本差异与 K5 未覆盖增量，不重复 K5 已核内容。

## 【事实层】

### 与 K5 四式的母式对照（逐字核验）
| K5 编号 | 本文母式 | 位置 | 差异 |
|---|---|---|---|
| F51 偏信息模型 Cov=\|B∩B′\| | §3.2 L524, 554：$\text{Cov}(X_{B_i},X_{B_j})=\|B_i\cap B_j\|$ | 逐字同 | K5 为转写；本文含 Gaussian 粒子池完整动机（Broomell-Budescu 2009 interpreted signal 渐近 Gaussian，L493-505） |
| F52 α~Cauchy(x₀,γ)，x₀≥1 | **Prop 4.2**（L706-714）：law of extremization ratio α 是 Cauchy(x₀,γ)；x₀=1 当且仅当 δ_i 全相等；否则 P(α>1)严格>1/2 | 逐字同 | 本文多「小扰动方向极端化更可能改进」的概率论证 |
| F54 闭式 x₀=N/(1+(N−1)λ)·√((1−δ)/(1−δ′)) | §4.4 L785：对称信息下 $x_0=\frac{N}{1+(N-1)\lambda}\sqrt{\frac{1-\delta}{1-\delta'}}$ | 逐字同 | 本文给 coherent 约束式(8)（δ∈[0,1] 且 λδ∈[(N−δ⁻¹)/(N−1),1]） |
| F55 γ=N/((N−1)λ+1) | **Prop 5.1(i)**（L866）：非随机量 $\alpha=\gamma\sqrt{1-\delta}/\sqrt{1-\delta\gamma}$，$\gamma=\frac{N}{(N-1)\lambda+1}$ | 同源 | 本文多 (ii) 只要 p_i 不全等就极端化、(iii) 可离开个体预测凸包 |

### K5 未覆盖增量（本笔记核心价值）

1. **δ_i 的边际行为**（式(7) p_i=Φ(X_Bi/√(1−δ_i))＋边际密度 m(p|δ)，L643-658）：δ=1/2→p 均匀分布；δ→0→收敛到无信息点 1/2（「withdraws from the problem」）；δ→1→两端 0/1 原子各 1/2。信息量决定预测分布形状——**三路判词的分布形状可直接用 δ 解读**。
2. **聚合器谱系定理（定性）**（§4.3，L756-759）：最优聚合器随信息重叠从完全到零做平滑变换 **averaging（低极端化）→voting（高极端化）**——「predictions from forecasters working in close collaboration can be averaged while predictions from strategically accessing disjoint sources should be aggregated via more extreme techniques such as voting」。
3. **extremization 需求的实践方向表**（L808-811）：随**专家数、专长、人类多样性 ↑**；随**协作、资源共享、问题难度 ↑** 而↓——六个可操作方向。
4. **δ′（总量）与 λ（多样性）是分离的两个决定因素**（§4.4 Fig.3 曲线分析，L797-808）：固定 δ′ 的曲线上，向低 λ 端移动同时增大多样性与 x₀——「both information diversity and the total amount of information used are important yet separate determinants」。
5. **coherence=关联多面体**（Prop 3.3，L627-638）：Σ22 可实现 iff 属于 COR(N)={xx′: x∈{0,1}^N} 凸包（2^N 顶点，dim=(N+1 choose 2)）——**不是任意协方差矩阵都是合法信息结构**（我们估 λ̂ 时的可行性约束）。
6. **oracular aggregator**（Prop 4.1，L677-682）：全信息条件期望=oracle forecaster（B′=∪B_i），作为极端化分析参考点——「no aggregator can improve upon it」。
7. **GJP 实证（§5.3）**：第二年 super-forecasters 44 人×123 事件（每事件 17-34 预测，均值 24.2）；p=0/1 截断到 0.001/0.999；**Table 1**：BS p̄ 0.132 / p_log 0.128 / p_probit 0.128 / **p″_cs 0.123（最优：REL 0.020 最低+RES 0.049 最高）**——p″_cs 在单事件、无训练集条件下胜出。
8. **GJP super-forecasters 需极少或无极端化**（§6 L1016-1018）——「average forecast of a team of super-forecasters often requires very little or no extremizing」因信息高度重叠（λ→1 时 x₀→1）；**与 K5 F56 Murphy 分解原文式同文**（BS=REL−RES+UNC 完整式 L929-934，K5 F56 的出处即此）。
9. **排名竞争可能破坏真值披露**（L896）：「depending on the reward structure, such a competition for rank may eliminate the truth-revelation property of proper scoring rules」——Brier 榜单竞赛=激励扭曲来源。

## 【结论层】（三态）

- 【已核】本文=K5 母本：F51/F52/F54/F55 四式在本文逐字/同源定位成功（见对照表）；K5 读的 1501.06943 是本文的扩展版（含 GJP 完整实证与推导附录）。**二期书单与 K5 的重复风险解除——本文价值在 9 条 K5 未覆盖增量**。
- 【已核】p″_cs（revealed aggregator，对称信息版）在 GJP super-forecaster 数据上 BS=0.123 最优（vs 均值 0.132/log 0.128/probit 0.128），REL 最低+RES 最高——极端化聚合的第一次模型化胜利。
- 【已核】super-forecasters 团队均值几乎不需极端化（λ→1）；**extremization 幅度是信息结构的诊断量而非普适修正**——与 GJP 旧知「extremize 幅度取决于池多样性」完全相容。
- 【引申·未验证】我们三路判词（同底座同 prompt 族只差温度）≈完全信息重叠（λ≈1）情形——按本文定理 **logit 平均几乎不需极端化**；γ̂=3/((3−1)λ̂+1) 中若 λ̂ 实测接近 1 则 γ̂≈1.22，极端化幅度应很小；判词路间若有信息差（不同证据通道）λ̂ 下降才需要更强极端化——**λ̂ 实测是决定极端化幅度的第一优先量**（K5 已立项，本文给理论权重）。

## 与本项目的差异表（接入总差异表）

| 维度 | InfoDiv 1406.2148v5 | 本项目 |
|---|---|---|
| 模型 | Gaussian 偏信息粒子池（COR(N) coherence） | 无信息结构模型——λ̂ 实测即本文 δ/λ 的经验版 |
| 聚合 | p″_cs（probit 空间极端化，可出凸包） | logit 聚合+收缩（BLF）/PCM/γ̂（K5）——**p″_cs 与 K5 γ̂ 同族可并入回放** |
| 校准变量 | GJP super-forecasters 44×123 | 三路判词×账本结局 |
| 关键警示 | 排名竞赛破坏真值披露（Brier 榜单竞赛激励扭曲） | 判词路排行榜同样扭曲——三路判词须盲评 |
| 可复用 | δ_i 分布形状诊断、聚合器谱系（averaging↔voting）、extremization 方向表、COR(N) 约束 | 直接借 |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】「averaging↔voting 谱系」对狼人杀的映射：好人侧判词共享同一证据流（讨论+投票公开信息）→λ 高→averaging 即可；若有判词路接入私密通道（夜间事件私有解读）→λ 降→该路应被更强极端化对待——**判词路的 λ 应按证据通道分别估**而非全局单一 λ̂。
- 【引申】δ_i 边际行为给出判词质量诊断：若某路判词长期集中于 0.5 附近（δ≈0 型「withdraw」），聚合权重应降（PCM 的 SA 权重天然实现）；m(p|δ) 分布形状拟合可作为判词路体检的免费统计量。
- 【引申】排名竞赛破坏真值披露：判词排行榜若公开各路 Brier 并奖励，会诱发策略性报告——三路判词绩效评估应保持盲态（事后测量 vs 事中激励分离）。

## 存疑与待验证

1. 本文与 1501.06943 的版本链未逐字比对（1501.06943 疑为本文+实证扩展）；K5 笔记维持有效，本笔记不重复其内容。
2. 式(9)（general revealed aggregator）未抄全（对称版式(10)已抄）；引用 general 版前回读。
3. §2 三框架综述（interpreted signal/measurement error/empirical）只扫标题——measurement error framework=averaging 的理论出处（L731-738 引用关系已记），细节未读。
4. GJP 数据细节（事件类型/时间窗）未全抄。
5. 附录 A（proofs）/B（δ,λ 的 MLE 估计）未读——λ̂ 实测落地前须回读附录 B 的 MLE 细节。

（InfoDiv 笔记完 · 2026-09-12 · 微步B7 · 锚=cache/_cache-InfoDiv-1406.2148v5.txt 1390 行）
