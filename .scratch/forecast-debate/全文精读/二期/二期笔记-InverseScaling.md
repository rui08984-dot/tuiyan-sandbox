# 二期笔记 · Is Capability a Liability?（反向缩放）· 微步A3

> 论文：Is Capability a Liability? More Capable Language Models Make Worse Forecasts When It Matters Most（arXiv:2605.22672，**v2**；I 文档口径一致）
> 作者：Nick Merrill / Jaeho Lee / Ezra Karger（FRI）——**与 A2 ForecastBench-Sim 同团队**（三作者全重合）；本文 §2.1 原话「We develop FBSim in a concurrent submission (Anonymous, 2026)」=互为 concurrent；A2 的 Fig.12（treasury p10 欠覆盖 ~50%） companion analysis 即本文——**A2 引用闭环确认**。
> 获取路径：pwsh 抓 abs（42.6KB）+HTML v2（750.8KB）→ _extract-html.cjs txt 132,617 B/2,884 行（正文紧凑 L240-405，附录 A-L）。
> 缓存：cache/_abs-Inverse-2605.22672.html + _cache-Inverse-2605.22672v2.html + _cache-Inverse-2605.22672v2.txt（行号锚）。

## 【事实层】

### 计分规则定义（Preliminaries，txt L289-295）
- 三计分规则：**Brier** $(p-y)^2$（单阈值）；**CRPS** $\text{CRPS}(F,y)=\int(F(z)-\mathbb{1}[z\geq y])^2dz$（实值，Gneiting et al. 2007；=Brier 对全阈值轴积分）；**pinball loss**（CRPS 的分位数分量）。分布预测=5 分位（p10/25/50/75/90），CRPS 由分段线性 CDF 计算。
- **核心数学关系原话**：「Brier scores a forecast at a single chosen threshold; CRPS sweeps Brier across the full outcome axis, so the upper-tail region of the integral picks up costs that any single salient-threshold Brier evaluation does not」（L291）——**Brier@显著阈值 ⊂ CRPS，漏掉上尾积分区**。
- 能力度量=ECI（Epoch Capabilities Index，Ho et al. 2025），模型跨 ECI 114-155；Spearman ρ 符号调整（ρ>0 正向缩放，ρ<0 反向）。
- 推理钳制：机制实验 reasoning_effort="minimal"（对假设保守；reasoning-on 子集反向更强 −0.56 vs −0.42，附录 F）。
- 识别策略三件（L293-295）：provider fixed effects（App E）＋within-lineage 复现（OpenAI N=10，p=.008）＋within-family 2×2（§4）。

### FBSim 反向缩放（§2，txt L297-317）
- pooled 六模板 CRPS×ECI：**H1 ρ=+0.67 → H7 ρ=−0.42** [−0.72,−0.02]，N=28；对 leave-one-provider-out 与 one-model-per-lineage collapse 稳健。
- **disruptable 模板划分**（预注册判据：decline 是否为底层世界快照的 modal outcome，在查看任何 per-template 相关前计算）：4/6 模板 disruptable（treasury/territory/population/city count），2 个结构受保护（technology count 人为棘轮；overall score 有界复合）；H7 上 4 个 disruptable 全负、2 个非 disruptable 全正——sign exchangeability 下此精确 4-2 划分概率 **1/64=0.016**。
- **per-quantile pinball 分解**（Fig.2）：p90 从 ρ=+0.78（H1，p<0.001）摆到 **ρ=−0.57（H7，p=0.002）**；p10 平——「更强模型不是更不会想象崩溃；其上尾上移追踪外推轨迹而下尾锚定；轨迹断裂时抬高的 p90 远离结局，pinball 惩罚主导 CRPS」。
- 机制命名（§9）：**competence-driven overcommitment（能力驱动的过度承诺）而非错误**——p90 在真达上尾的 cell 上更准，在更常见的平庸 cell 上付出代价。

### 机制隔离（§3-§4，txt L319-335）
- 合成 SIR：50 系列指数增长→干预→峰值回落；60 步上升相作历史，预测至 210 步。CRPS 反向缩放 **ρ=−0.62** [−0.83,−0.26]，p<0.001，N=27。
- **线性对照（同 crash 结构）**：ρ=+0.61 [+0.30,+0.82]，N=30；SIR 与线性 CI 不重叠——**反转可统计区分于一般 crash 效应**；永久性 regime change 的 crash 也不触发（附录 J）→**触发器=超线性增长×regime change 组合**。
- 机制可见性：更强模型检测指数趋势并更激进外推→上尾随轨迹上移→干预命中时抬高上尾远离 post-crash 结局、误差随 h 超线性增长；线性系列外推误差有界，常规能力优势保持。
- **Llama-3.1 2×2**（{70B,405B}×{base,instruct}，100 SIR+100 线性配对，h∈{16,90,210}，Wilcoxon signed-rank on CRPS ratios）：h=210 crash regime 上 scale 与 post-training 各自显著放大 CRPS 且**复合**（interaction p_W<.0001）；post-training 损伤随 scale 传播（70B=尾部效应放过典型 crash 系列；405B=主导中心趋势）；≥10× 膨胀 crash 系列比例 **41%（70B）→63%（405B）**；线性对照两规模皆 null（反号 interaction p_W=.029）。

### 真实世界复现（§5-§6，txt L337-357）
- 三个按 regime change 预选的域：**COVID-19**（60 国日发病，60 天历史，H1-H7=30k 天，**ρ=−0.54** [−0.78,−0.19]，N=30）；**housing**（S&P/Case-Shiller 19 美国都会区，60 月历史至 2005-12，36 月视距 **ρ=−0.67** [−0.82,−0.40]）；**hyperinflation**（12 期恶性通胀/10 国月度 CPI，h∈{12,24,36,48} 月，**ρ=−0.59** [−0.82,−0.25]）；CRPS 按系列尺度归一。
- **未预选自然分布：measles 1928-1962**（Project Tycho，35 疫季全测，质量过滤后 N=1,339 state-seasons/56 州；排除 1963-65 因疫苗许可）：2 周 ρ=+0.64 [+0.33,+0.85] → 8 周过零 → 16 周 **−0.42** [−0.70,−0.03] / 20 周 −0.41——ex-ante 池化（无任何严重度预选）即现正→反向交叉；**CRPS 反转而 Brier 平坦**。p90 摆动 +0.63（2 周）→−0.44（16 周）与 FBSim 同幅。
- **流感阴性对照（预指定触发器验证）**：ILINet 50 系列 ρ=+0.14（p=0.50）；历史流感 1919-1951 爆发年 ρ=+0.22（p=0.64）；爆发性流感 median overshoot 仅 3×，低于 measles 语料最严重爆发——**触发器是超线性增长非疾病数据本身**。
- 最小不确定性线索（"the current trend may or may not continue"）：COVID（−0.60）/hyperinflation（−0.50）不衰减，housing 部分衰减（−0.26，n.s.）。
- 领域命名（§6 单句最低限披露）：measles 长视距衰减 −0.49→−0.39（h12，p=.07）/−0.45→−0.27（h16，p=.21）/−0.50→−0.08（h20，p=.73）——部分救援不完整。

### 领域知识不一致（§7，txt L359-369）
- 命名域跨域不一致（Fig.4）：**COVID-19 反转翻正（−0.49→+0.39）**；housing 大幅衰减（Δρ=+0.86）；measles（Δρ=+0.36）/SIR（+0.24）实质衰减；**hyperinflation 零效果（Δρ=+0.00）**。
- **不是知识缺口**：直接问时模型正确识别恶性通胀危机 **46/48 probes**（附录 I）——「相关先验可从模型自身表征恢复，但先验不可靠转化为校准尾部」。
- **任务中 articulated 案例**：Opus-4-6 预测 1985-89 巴西恶性通胀，写出「hyperinflation could also stabilize (currency reform), adding downside uncertainty. But following the trend…」然后 p50 中位产出最终结果的 **~700 万倍**——regime-change 替代被回忆、权衡、**同一响应内丢弃**。

### 单阈值计分盲区（§8，恢复令重点；txt L371-375）
- **同模型同世界相反判定**：FBSim 原生 binary 题 ρ=**+0.45**（N=27，更强更好，与 FB 先验一致）；matched continuous CRPS H7 ρ=**−0.42**——「Same models, same worlds, opposite verdicts」。
- **排除格式混淆**：从**同一 5 分位连续预测导出** Brier（阈值构造附录 E）：ρ=**+0.50**（p=0.007，N=28）恢复正向——相同输出、不同计分规则、缩放符号反转；成本在上尾积分，CRPS 捕捉而单阈值 Brier 不捕捉。
- 与 Schaeffer et al. 2023（指标制造涌现假象）的关系原话：「a different and arguably more concerning version of the same problem: metric choice does not merely inflate or deflate the trend, **it reverses the sign**」。
- 现有评测点名（全部只报 binary/threshold）：**ForecastBench（Karger 2025）/KalshiBench（Nel 2025）/Halawi 2024/Schoenegger 2024**——在此结构任务上「would not detect the failure」且「would certify that more capable models are better forecasters」。

### 讨论与局限（§9，txt L377-397）
- 建议：概率评测至少报一个分布计分规则（**CRPS 或 log score**）或 **Brier 扫上尾阈值**；单阈值 Brier@常规显著截断不够；若训练目标继续奖励阈值准确，overcommitment 难以规模校正且可能复合。
- 政策相关域重合：流行病干预时点/货币政策尾部通胀/金融风险（VaR、expected shortfall）——恰是「超线性增长+regime change」结构域；LLM 疫情预测将系统误校准上尾。
- 局限自列：只刻画一个结构可识别类（不称唯一/普遍）；三域按已发生 regime change 预选（防 ex-ante 频率声明，measles 锚 ex-ante）；能力多为观测非操纵（2×2 补）；hyperinflation N=12/housing N=19 历史受限=方向性发现；机制解释性（先验为何不转校准尾部）留待单独论文（内部表征 probing）。

## 【结论层】（三态）——恢复令四重点逐答

**①超线性+尾部风险域的失败机制——【已核】**
- 触发器=**超线性增长 × regime change 尾风险的组合**（SIR vs 线性对照 CI 不重叠；永久 crash 不触发；流感 overshoot 3× 不触发）；机制=competence-driven overcommitment（更强模型更精确检测趋势→更激进外推→p90 上移→断裂时 pinball 惩罚主导）；scale 与 post-training 独立且复合（Llama 2×2）。

**②单阈值记分测不出效应的论证——【已核】**
- 论证链三层：①同一模型面板 native binary +0.45 vs matched CRPS −0.42（同世界）②**同一输出导出 Brier +0.50 恢复正号**（排除任务格式混淆——输出相同仅计分不同）③数学=Brier@单阈值是 CRPS 的组成部分，漏上尾积分区——「metric choice reverses the sign」比 Schaeffer 的「manufacture emergence」更严重一级。

**③连续无界记分建议（对我们 Brier 记账口径的直接警示）——【已核】**
- 原文建议：概率评测**至少报一个分布计分规则（CRPS 或 log score）或 Brier 扫上尾阈值**；单阈值 Brier@常规截断不够。
- **对本项目的警示链**：我们的 Brier/BI 记账全在固定 0/1 结算阈值上=单阈值族（BI 虽连续变换仍是单阈值 Brier 的函数）；I §四.8 已警示「扩胜率分布类输出必须警惕」+本文升级为实证：**预测卡 L1+ 一旦升级 5 分位连续分布（A2 落地点），必须同步加 CRPS+per-quantile pinball 分解，否则单阈值 Brier 会在超线性域（连胜/雪崩局）给强判词路发假合格证**；「谁是狼」二值判定无上尾问题（I §四.8 原判断维持），但任何连续值/分布输出（资源/票数/胜率曲线）立即触发本条。

**④与 FB-Sim A2 件的引用闭环——【已核】**
- 同团队（Merrill/Lee/Karger）；本文 §2.1「concurrent submission (Anonymous, 2026)」=FBSim 论文；A2 Fig.12 companion analysis=本文尾风险分析；A2 的 ECI pooled +0.48 与本文 H7 −0.42 同一面板不同池化口径，数值相容。

## 与本项目的差异表（A0 后第四篇，接入总差异表）

| 维度 | InverseScaling 2605.22672v2 | 本项目 |
|---|---|---|
| 结算对象 | 连续时序分布（5 分位） | 二值事件+拟扩分布输出 |
| 计分 | CRPS+pinball（主）+Brier（对照展示符号反转） | Brier/BI/ABI（单阈值族）——**本文正是警示此口径** |
| 缩放分析 | ECI 跨家族+within-lineage+2×2 操纵 | 不做能力缩放，但判词路间能力差同样受计分规则符号影响 |
| 域 | FBSim/SIR/COVID/housing/hyperinflation/measles | 狼人杀+多域（超线性结构=连胜/雪崩局） |
| 可复用方法 | per-quantile pinball 分解+disruptable 预注册判据+sign-exchangeability 检验 | 直接借进我们分布输出记分 |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】狼人杀域超线性结构映射：连胜雪崩（连刀/连票错）即「superlinear growth+regime change」局结构——若做胜率曲线分布预测，本文预测强判词路在「断龙翻转局」p90 系统性过高；可预注册「disruptable 局 vs 稳定局」划分（借其 modal-outcome 判据+1/64 式 sign-exchangeability 检验）。
- 【引申】「先验可恢复但不转化为校准尾部」与 DINCO 暗示性偏差或为同一机制两面——判词 prompt 加 regime-change 强制列举位（「列一个反向场景+其概率」）可能等效 domain naming 的部分救援（COVID 型）或无效（hyperinflation 型），须实验分辨。
- 【引申】CRPS=Brier 全阈值积分→BI 记账零成本增补：从同一 5 分位导出「Brier 扫上尾 3 阈值」即可检测本文效应，不必全积分。
- 【引申】本文与 A2 同团队立场互补（A2 造 instrument，本文用 instrument 发现失效模式）——我们造结算管线（A2 落地点）与用管线发现判词失效（本文式分析）应分两批走。

## 存疑与待验证

1. ECI 为外部观测非操纵（within-family 只有 Llama 一族）；跨家族 ρ 不归因单轴。
2. COVID/housing/hyperinflation 按 regime change 已发生预选——ex-post 频率不可声明；measles 补 ex-ante 但狼人杀局无对应全测空间。
3. 附录 E/F/I-L 未逐字读（provider 固定效应表/reasoning 分层/hyperinflation probes/2×2 细节）——引用附录数字前回读。
4. 对「胜率曲线」输出的适用性未验证：连续时序与二值事件/票数分布不同构，pinball 模板划分判据需改造。
5. FBSim 面板 N=28/27/30 与 A2 的 N=28/30/31（curated vs 全量）差异未逐座核对。

（InverseScaling 笔记完 · 2026-09-12 · 微步A3 · 锚=cache/_cache-Inverse-2605.22672v2.txt 2884 行）
