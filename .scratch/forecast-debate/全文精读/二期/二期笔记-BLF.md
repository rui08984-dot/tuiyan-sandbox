# 二期笔记 · BLF（Bayesian Linguistic Forecaster）· 微步A1

> 论文：Agentic Forecasting using Sequential Bayesian Updating of Linguistic Beliefs（arXiv:2604.18576，**v4**，2026-04；abs 页 2026-09-12 实抓确认 v1-v4，v4 新增附录 J/K）
> 机构口径：作者自述 SOTA；当前 ForecastBench 人类对照 SF 中位 ABI=70.9 的最接近者（71.0）。
> 获取路径：abs 页（pwsh+web_fetch）→ arxiv.org/html/2604.18576v4 → batch_extract.py 抽 md（公式丢失弃用）→ **pwsh Invoke-WebRequest 下 raw HTML 1.24MB → _extract-html.cjs 抽 txt 保 alttext 公式（230KB/7631 行，31 处 LaTeX 在位）**。
> 缓存：cache/001_BLF-2604.18576v4.md（182.7K chars，公式丢失仅存档）＋ cache/_cache-BLF-2604.18576v4.html（1.24MB）＋ cache/_cache-BLF-2604.18576v4.txt（230.7KB，**本笔记行号锚=此 txt**）。
> 三层纪律照 INDEX：【事实层】原文逐字+行号锚 /【结论层】三态标注 /【数学层】公式编号+变量+适用条件；【引申·未验证】为本棒发散。

## 【事实层】

### 数据与评测设置（txt L550-661）
- 问题定义原文式：估计 $P(Y(r)=1\mid\text{data}(\leq f))$，f=forecast date，r=resolution date（L555-558）。数据集题 $P(Y(r_i)>v\mid\text{data}(\leq f))$，r_i=f+h_i，v=y(f) 当前参考值（L582-584）。
- 两基准：AIBQ2=Metaculus AI Benchmark Tournament Q2 2025 的 113 二值题（L571-573）；FB 两 tranche A=2025-10-26 / B=2025-11-09，各 100 market+100 dataset，400 唯一题，200 market→200 事件、200 dataset→591 事件，**合计 791 结算事件**（L605-613）。
- tranche 三准则：①晚于全部基座 LLM 知识截止 ②最大化已结算题数 ③最大化与公开提交结果的配对重叠（L614-618）。
- 反泄漏四层防御原文枚举：①search engine date filtering ②LLM-based leak classifier on results ③data tool date clamping ④URL blocking for resolution sources；post-hoc audit **1.5% 未检出泄漏率**（L641-648）。
- 对照外部队=2026-04-15 FB 榜 top5；全方法市场题都用 crowd 信号；两个基线：Crowd+emp（无 LLM）与 ZS+crowd+emp（Gemini-3.1-Pro 零样本+先验，无工具）（L653-661）。
- 基座主用 Gemini-3.1-Pro，搜索 Brave（L678-681）。

### 指标口径（A.2，txt L1610-1735）
- BI 原文式：$\text{BI}=100\times(1-\sqrt{\overline{\text{BS}}})$，$\overline{\text{BS}}=\frac{1}{N}\sum_i(p_i-o_i)^2$；**平方根在平均之后应用，不是逐题**（L1663-1664 原话 "Note the square root is applied after averaging, not per question"）；always-0.5 得 50；BI 是 mean BS 的单调变换故排名等价（L1666-1667）。
- BS 全文 ×100 报（0.25→25，L1653-1654）；MS=Metaculus Baseline Score $=100\log_2(p_o/\pi_0)$，π₀=0.5，尾部错误惩罚比 Brier 重（L1617-1645）。
- ABS 难度调整：$\text{ABS}_i=\text{BS}_i-\gamma_i$；市场题 $\gamma_i=(m_i-o_i)^2$（m=市场价），数据集题 γ=全方法估的固定效应（L1671-1679）。
- **ABI（2026-03 起 FB 官方指标）**：$\text{ABI}=100\times(1-\sqrt{\max(0,\overline{\text{ABS}})})$；重标定使 always-0.5=0.25；ABS_i 可为负、mean 可<0，max(0,·) 钳制保良定义（实践惰性）；**BI 不严格 proper 但样本增大趋 proper**（L1704-1734）。


### 语言信念状态编码（恢复令重点①；§3+C.1+C.2，txt L725-749, 2152-2289）
- 信念状态四件套（C.1 原文枚举 L2157-2175）：①概率估计 $p\in[0,1]$ ②置信级 low/medium/high ③正反证据自然语言摘要 ④下一步要查的开放问题。
- 单次生成同时出动作与信念：$(a_t,b_t)=\text{LLM}(m_{t-1})$（L731, 2228）；**实现细节=updated_belief 作为 tool call 参数里的结构化 JSON 字段**，含 $b_t.p$ 与 update_reasoning 字符串（LLM 解释信念为何变，如 "page contradicts initial assessment"），作者称要求 articulate 更新理由「促进连贯概率更新」（L2229-2240）。
- 消息历史非马尔可夫：$m_{t-1}=(q,a_{1:t-1},o_{0:t-1},b_{0:t-1})$（L2215-2216）；更新是确定性拼接 $m_t=m_{t-1}\oplus(a_t,o_t,b_t)$，KV-caching 友好（Gemini/OpenAI 自动前缀缓存，Anthropic 需显式 cache_control）（L2248-2265）。
- 循环上限 $T_{max}=10$ 步；submit 工具内把概率**钳位到 [0.05,0.95]** 限定自信犯错的最坏 Brier 损失，全部校准分析都在钳位值上做（L760-764）；到步强制提交返回 $b_T.p$（L843-848）。
- 对照架构：NoBel（纯文本累积，context 可爆注意力）与 Batch（先并行搜索后统一推理）；BLF=逐步「推理→动作」交替（ReAct 式迭代）（L739-749）。
- **作者诚实自注（重要）**：流程「像 POMDP 序贯贝叶斯更新」但**不是任何技术意义上的贝叶斯推断**——更新规则是 LLM 前向传播，无显式似然、无边际化、无正式后验；结构化信念槽是「工作记忆脚手架，约束更新的形式而非语义」；动作选自全历史，信念不是马尔可夫充分的（L2271-2289）。

### 层级多试验聚合（恢复令重点②；§3+C.9，txt L863-896, 2882-2994）
- K=5 独立试验/题（L865）；两方案：①算术平均 $\hat{p}=\frac{1}{K}\sum_k p_k$ ②logit 空间均值+数据依赖先验收缩 $\hat{p}=\sigma(\alpha\cdot\frac{1}{K}\sum_k\text{logit}(p_k))$（L867-869）。
- 层级贝叶斯模型（C.9 式 7-9）：似然 $y_{qk}\mid\theta\sim\mathcal{N}(\theta_q,\sigma_q^2)$（y=logit(p)，σ²=试验 logit 样本方差）；先验 $\theta_q\sim\mathcal{N}(\mu_q,\tau^2)$，$\mu_q=\text{logit}(\pi_q)$，π_q=crowd（市场题）或经验基率（数据集题），都没有则 π=0.5；后验均值 $m_q=\alpha_q\bar{y}_q+(1-\alpha_q)\mu_q$，$\alpha_q=\frac{K\tau^2}{K\tau^2+\sigma_q^2}$。
- 启发式估计器（式 11，D.7 中略优）：$\alpha_q=\max(f,\,1-c\cdot s_q)$，s_q=试验 logit 样本 std，f=下限、c=收缩速度，(f,c) 全局共享；f=1 关收缩，f=0 全收缩；f>0 时 mildly degenerate（c 在 floor binding 时无效果）（L2963-2981）。
- τ² 估计：弃边际似然最大化，用 **LOO-CV**（作者称更简单更稳健）（L2953-2955）。
- 与 James-Stein 两点不同：JS 收缩向单一全局均值，这里向 per-question 中心 μ_q；本设定可对 log-scoring 优化（过自信错误灾难性惩罚）而非限 MSE（L2983-2994）。
- LLM 聚合（AIA 式，喂 5 试验推理轨迹给聚合 LLM 还可自搜索）**劣于简单算术平均**（L893-896, 2996-3003）。

### 层级 Platt 校准（恢复令重点③；C.11，txt L3005-3047）
- 基础 Platt（式 12）：$\hat{p}_{cal}=\sigma(a\cdot\text{logit}(\hat{p})+b)$，a/b 在 held-out 数据上最小化 log loss 拟合；**LOO-CV 防小样本过拟合**——每题用其余全部题拟合再应用到该题，校准模型永不看见被校准题（L3011-3020）。
- 部署态：新无标注题用全 backtesting 集（A∪B n=400）训练的校准模型；LOO 估计即近似此 regime（每折 n−1 训练）（L3021-3025）。
- 层级 Platt（式 13，FB 9 异构源）：$\hat{p}_{cal}=\sigma(a\cdot\text{logit}(\hat{p})+b+\delta_s)$——共享斜率 a+截距 b+**per-source 偏移 δ_s**；拟合在 NLL 加 L2 正则 $\lambda\sum_s\delta_s^2$，**λ=1.0 固定默认**（一个数量级内对指标不敏感，未做 λ 外层 LOO）（L3027-3043）。
- δ_s 的解释原文：吸收跨题型系统性误校准（"the model tends to be overconfident on polymarket questions but underconfident on dbnomics"）（L3044-3047）。
- 何时最有用：零样本+经验先验开启时——全局 Platt 会把偏态基率源的极端预测过度收缩，层级校准保住它们（L908-913）。

### ABI 计分口径（恢复令重点④；摘要关键句 txt L511-532 逐字）
- 原句逐字：**"BLF is the only one of these method whose difficulty-adjusted Brier Index (ABI=71.0, see Tab. 11) is close to the human superforecaster median (ABI=70.9) reported on the ForecastBench leaderboard."**
- 脚注逐字：**"The two numbers are computed on different question sets and time periods, so they are not strictly comparable."**（与 I 文档口径完全一致，且补全了 ABI=71.0 出处=Tab. 11）
- ABI 用的是难度调整（ABS 均值开方），与主表 BI（未调整）**是两套口径**——Tab. 11 为 ABI 全表。

### 结果关键数字（§4+D.1，txt L920-969, 3395-3438）
- Table 1（FB A∪B，BI）：BLF Market 83.8 / Data 62.7 / All 73.3；Cassi 82.0/59.6/70.8（Overall Δ=−2.4*）；GPT-5 ZS 80.4/60.1/70.2（−3.0*）；Grok 79.5/61.4/70.5（−1.4 ns，p=0.51）；Foresight 81.0/57.6/69.3（−5.6***）；无 LLM 基线 crowd+emp 81.5/58.3/69.9。
- **BLF 是唯一统计显著胜 LLM-free 基线的方法**：Overall +3.4**，Data 子集 +4.5***；Market +2.3 ns（n=200 统计功效低）；外部四方法无一胜基线 Overall（L965-969, 3430-3438）。
- 题目难度占性能方差 **62%**（混合效应模型，G.1；L948-949）。
- 显著性口径：paired bootstrap 5000 重采样，难度调整后配对比较（G.2）。

### 消融与聚合选择（§4+D.7，txt L1164-1212, 3940-3974）
- 消融矩阵：三组件（belief state/收缩聚合/层级校准）×5 基座（Pro-3.1/Flash-3.1/Sonnet-4.6/GPT-5/Kimi-K2.5），两 regime c=0/c=1（有无 crowd 锚），对照强序贯搜索基线（似 AIA）（L1164-1179）。
- Kimi K2.5 增益最大：NoBel 64.4→BLF 70.2（c=0，+5.8）；65.8→72.0（c=1，+6.2）；层级校准是 Kimi 上最大单一组件贡献（uncalibrated NoBel 差距 ~12，仅 hier-cal 就收掉大半），belief+shrink 再加 ~6 BI；BLF+Kimi 接近 BLF+Pro 且输入 token 便宜 ~5 倍、开源权重（L1181-1198）。
- Sonnet/GPT-5 提升不显著（NoBel 基线相近的前提下）（L1199-1201）；**市场题收益大于数据集题**（数据集题常一次工具调用就够）（L1205-1212）。
- 信念演化实例：单题 5 试验起始 p₀=0.5 快速发散，试验间 σ=0.20（概率空间），均值 0.57 比多数单试验更接近真值——多试验聚合的直接动机（L1265-1269）。
- **D.7 收缩选择结论**：FB 上两估计器 LOO 全部坍缩到「无收缩」——启发式一致选 α≡1（跨试验 logit-σ 中位 0.27 太小），Bayes 式 766/791 折选 τ=1.5→α≈0.99；AIBQ2 上两者都识别出收缩有益（logit-σ 中位 0.50≈FB 两倍）：heur (f,c)=(0,0.5) 112/113 折、Bayes τ=0.45 91/113 折，中位 σ 处 α=0.75 vs 0.80（L3960-3974）。
- Bayes 式在小样本付出轻微 out-of-sample 噪声代价（把「无收缩」放在有限 τ 上）（L3982-3984）。

### 附录 J：显式贝叶斯更新 vs 语言更新（v4 新增；txt L5912-6332）
- 动机：BLF 是判别式（LLM 直出修订概率）；更正统做法=LLM 估 per-observation 似然再按贝叶斯法则合成（生成式）。
- 式(24)：$\text{logit}\,b_T=\text{logit}\,b_0+\alpha\sum_{t=1}^{T}\lambda_t$，$\lambda_t=\log\frac{p(o_t\mid s=1)}{p(o_t\mid s=0)}$；α=tempering 系数（复合似然指数，条件依赖观测下朴素连乘过计证据，α<1 降权恢复近似校准精度）。
- 式(25) λ 诱导：per-state typicality 打分——对每个假设 s∈{0,1} 让模型按 forward simulation 在 0-10 整数尺度评「若 s 为真 o_t 有多典型」：$\lambda_t=\log\frac{r_t^1+\epsilon}{r_t^0+\epsilon}$，ε=0.5 防 log(0)；**直接单调用问 log-ratio 会产生膨胀+常错号的权重，最优 α*=0（证据净有害）**（L5989-5993）。
- 式(26) 观测摘要：o_t 平均 7571 字符→辅助 LLM 按 (a_t,c) 条件重写为 σ_t 平均 798 字符（11%），似然在 σ_t 上评。
- 条件化三式+两变体：uncond（纠缠动作选择）/acond（条件于动作，动作在比值中相消）/bcond（再加信念摘要 b_{t-1}.h——**把加性更新变成链式分解**：已被旧证据蕴含的信息 λ≈0，治过计的本源）/hcond/hbcond/sbcond/sahbcond。
- J.1 离线回放（n=80 tranche-A，154 事件，基率 0.31，均 4.2 搜索步/24.1 文档；先验=市场价（43/80）或 0.5）：**BLF 语言更新 BS=0.088/ECE=0.083**；最好显式变体 sahbcond/sbcond BS=0.119-0.123；bcond 0.123（α*=0.35）；hcond（原始历史）α*=0 净有害；hbcond（与 BLF 同信息）最好也只 0.128。
- 两结论原文转写：①差距不在上下文（同信息仍输），在**机械标量更新本身**——累积一维 LLR 比不过单遍整体权衡异构依赖证据；②belief summary 是 operative conditioning signal（798 字符蒸馏摘要胜 ~12k 原始历史）——「对 BLF belief-state 设计的独立验证」（L6120-6151, 6159-6162）。
- J.2 在线端到端：FB live n=5 平手（Bayes 0.213 vs BLF 0.204）——结构性原因：有市场先验锚定则无空间；唯一清晰胜例=真不确定题（market 0.43，BS 0.16 vs 0.21）；market 0.04 自信犯错时锚定使 Bayes 更糟（L6292-6303）。
- 无锚 regime（WorldAtlas 对抗题，crowd=0）：BLF 全 5 试验收敛 ~0.91 自信地错，在线 Bayes 更新平滑升至 ~0.63 饱和（Brier 0.40 vs 0.83）——**显式更新=过自信正则器**；其价值在没有强外部先验的 regime（FB 市场题缺席，别处常见）（L6305-6323）。

### 附录 K：VoI 自适应停止（v4 新增，草案非主系统件；txt L6334-6400）
- 式(27) $b_t=p(s=1\mid x_{1:t},c)$；式(28) 期望 Brier 成本 $b(1-\hat{p})^2+(1-b)\hat{p}^2$，最优报告 $\hat{p}^*=b$（Brier 严格 proper）；式(29) 残余损失 $V_{stop}(b)=b(1-b)$（=Ber(b) 方差，b=0.5 时最大 0.25）；式(30) $\text{VOI}=b(1-b)-\mathbb{E}_z[b'(1-b')]$——再搜一次的期望残余 Brier 降幅；有 martingale 性质（作者用它说明继续搜索只值 VOI−成本>0 时才值）。作者定位：analysis+candidate refinement，**不在主系统评测内**（L6340-6345）。

## 【结论层】（三态）

- 【已核】作者声称 SOTA：FB A∪B 三题型 BI 全部第一（对每外部方法点估计全胜），且唯一显著胜 LLM-free 基线；对 Grok 的 Overall 优势不显著（p=0.51）。→ 措辞核对：摘要原话 "achieves state-of-the-art performance on the ForecastBench benchmark"（I 文档已核口径一致）。
- 【已核】ABI 71.0 接近 SF 中位 70.9，作者脚注自认不严格可比（不同题集时段）——**「接近」不是「超过」**，支持 I 棒 T1=未触发判定。
- 【已核】三组件各有贡献但**组件重要性随基座 LLM 与 crowd 锚变化**（Kimi 最大受益、Sonnet/GPT-5 不显著）——「哪件最重要」不可照搬，与 I §四.1 警告一致。
- 【已核】显式贝叶斯（生成式）更新是 qualified negative：校准好于语言更新但精度输；headroom 在无强外部先验 regime（作者自己的定性词）。
- 【转述→已核升级】I 文档 §四.1 的三组件转述逐字对上原文（logit 平均+数据依赖收缩/层级 Platt 防偏态基率源过收缩/信念状态半结构化迭代）；**新增细节=钳位 [0.05,0.95]、LOO-CV 选 τ² 与正则、启发式 α=max(f,1−c·s_q) 略优于 Bayes 式、FB 上最优解其实是无收缩**。
- 【引申·未验证】BI 非严格 proper（A.2 原文自认）→ 按 K6 纪律，分桶/转换类指标都只能当下界参考；ABI 的 max(0,·) 钳制+难度调整依赖历史固定效应 γ_i，对新题集/新方法定义脆弱（作者也承认 γ_i 依赖 FB 数据不能用于 novel datasets）。

## 【数学层】公式编号清单

| 编号 | 公式 | 变量 | 适用条件/出处 |
|---|---|---|---|
| (7) | $y_{qk}\mid\theta\sim\mathcal{N}(\theta_q,\sigma_q^2)$ | y=logit(p_qk)；σ_q²=试验 logit 样本方差 | C.9；K 次试验似然 |
| (8) | $\theta_q\sim\mathcal{N}(\mu_q,\tau^2)$ | μ_q=logit(π_q)；π_q=crowd 或经验基率，无则 0.5 | C.9；τ² 全局超参 |
| (9) | $m_q=\alpha_q\bar{y}_q+(1-\alpha_q)\mu_q$，$\alpha_q=\frac{K\tau^2}{K\tau^2+\sigma_q^2}$ | ȳ=试验 logit 均值 | C.9；线性高斯后验均值 |
| (10) | $\hat{p}_q=\text{sigmoid}(\alpha_q\bar{y}_q+(1-\alpha_q)\mu_q)$ | 同上 | C.9；plugin 预测；σ_q² 小→α≈1 坍缩为 logit 平均 |
| (11) | $\alpha_q=\max(f,1-c\cdot s_q)$ | s_q=试验 logit std；f 下限；c 速度 | C.9；启发式，(f,c) LOO-CV；f=1 关收缩 |
| (12) | $\hat{p}_{cal}=\sigma(a\,\text{logit}(\hat{p})+b)$ | a,b 最小化 held-out log loss | C.11；LOO-CV 防过拟合 |
| (13) | $\hat{p}_{cal}=\sigma(a\,\text{logit}(\hat{p})+b+\delta_s)$ | δ_s=per-source 偏移，L2 正则 λ=1.0 | C.11；FB 9 源异构校准 |
| (24) | $\text{logit}\,b_T=\text{logit}\,b_0+\alpha\sum_t\lambda_t$ | λ_t=log LLR；α=tempering | 附录 J；显式贝叶斯更新 |
| (25) | $\lambda_t=\log\frac{r_t^1+\epsilon}{r_t^0+\epsilon}$ | r∈[0,10] typicality；ε=0.5 | 附录 J；per-state 诱导 |
| (26) | $\sigma_t=\sigma(o_t\mid a_t,c)$ | 7571→798 字符摘要 | 附录 J；观测蒸馏 |
| (27-30) | $V_{stop}=b(1-b)$；$\text{VOI}=b(1-b)-\mathbb{E}_z[b'(1-b')]$ | b=信念；z=新证据 | 附录 K；VoI 停止规则（草案） |
| BI | $100(1-\sqrt{\overline{BS}})$，$\overline{BS}=\frac{1}{N}\sum(p_i-o_i)^2$ | 平方根在平均后 | A.2/§2 |
| ABI | $100(1-\sqrt{\max(0,\overline{ABS})})$，$\text{ABS}_i=\text{BS}_i-\gamma_i$ | γ_i=难度（市场价或固定效应） | A.2；2026-03 起 FB 官方 |

## 本项目落地点（照 G-合并 §2 消融总矩阵挂钩）

1. **3 路判词聚合升级有完整配方**：BLF 式(9)-(11) 给出 logit 平均+先验收缩的全部实现细节——α_q=Kτ²/(Kτ²+σ_q²) 或启发式 max(f,1−c·s_q)，LOO-CV 选超参。温度档 T0.2/0.7/1.0 三路判词=天然 K=3 试验；先验 μ_q 可用账本基率（替代 BLF 的 crowd/emp）。
2. **收缩不是默认开（D.7 关键教训）**：跨试验 logit-σ 中位 0.27（FB）时 LOO 自动选无收缩；0.50（AIBQ2）时才收缩到 α≈0.75-0.80。→ 本项目应先测三路判词的跨路 logit-σ 再决定收缩幅度，不能拍脑袋开收缩。
3. **层级 Platt=校准 API 升级路径**（式 13）：共享 a/b+题型 δ_s+L2 λ=1.0；对应本项目按判词路/题型分层拟合；LOO-CV 纪律与 K6 样本复杂度结论（n∝√B/E²）兼容。
4. **钳位 [0.05,0.95] 与校准联动**：钳位在 submit 层做、校准分析在钳位值上做——本项目账本记录应保留钳位前后两列。
5. **信念状态≈账本**（I §四.1 已判）：update_reasoning 字段（要求 LLM 说明信念为何变）是低成本可借的 prompt 结构；bcond 链式分解思想=「新证据的增量信息以既有证据摘要为条件」。
6. **VoI 停止规则（式 27-30）是门后件候选**：VOI=b(1−b)−E[b'(1−b')] 可以用账本回放离线估计——LLM 只出信念，停止决策全在确定性代码层（铁律合法集合内）。BLF 自己没接入主系统，属探索性。
7. **ABI 口径**：I §5.2 建议记账改记 BI/ABI；本文 A.2 给出完整公式与坑（平方根在平均后、ABI 依赖 γ_i 固定效应、BI 非严格 proper）——记账实现时照抄 A.2 逐式。

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】α_q=Kτ²/(Kτ²+σ_q²) 与 K5 已读 F54 闭式 x₀=N/(1+(N−1)λ)·√((1−δ)/(1−δ′)) 是同族（高斯收缩 vs Cauchy 极端化）：若三路判词做 BLF 式收缩后再极端化，两个校正系数会互相作用，方向未验——需在账本回放上先验单用哪个。
- 【引申】D.7 的「跨试验方差决定收缩」给了本项目一个免费诊断量：每题记 3 路判词 logit 方差，方差分布漂移本身就是 regime 切换信号（与 CPTC 变点检测天然衔接）。
- 【引申】附录 J「蒸馏摘要优于原始历史」与 Prophet Arena 的「evidence 近满分、synthesis 才是瓶颈」互证：证据压缩率（7571→798 字符）可能是值得记账的中间量。
- 【引申】VoI 式(30) 若用 mojacast 的多模拟器 rollout，b' 的分布可以直接从轨迹簇经验估计，不必参数化——与 M-全拟真模拟方案可能接口。

## 存疑与待验证

1. Tab. 11（ABI 全表）数字未逐格核对（正文只抓到 ABI=71.0 与 Fig.11/T19 引用）；引用 ABI 全表前需回 html 原文核表格。
2. σ_q 中位数 0.27/0.50（logit 空间）来自 D.7 正文叙述，Table 17/18 逐格数字未抄全。
3. 附录 C.2-C.7（工具细节/策略/先验构造）、C.3 搜索引擎、附录 I 时序工具（DBnomics KNN 绕过 LLM）只扫了标题未逐字读——对本项目有用的 C.7 empirical prior 构造细节待需要时回读。
4. cross-LLM 附录 E 的「为什么 Sonnet/GPT-5 不受益」的作者猜测未读全。
5. batch_extract.py 产物公式全丢（本棒实测 0 条 LaTeX 痕迹）——二期后续爬取一律先走 pwsh 下载 raw HTML+_extract-html.cjs（本笔记获取路径节已记配方）。

（BLF 笔记完 · 2026-09-12 · 微步A1 · 锚=cache/_cache-BLF-2604.18576v4.txt 7631 行）

