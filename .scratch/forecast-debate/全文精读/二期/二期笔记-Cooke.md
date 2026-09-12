# 二期笔记 · Cooke 2026（Wisdom/Madness of Crowds）· 微步A4

> 论文：Wisdom/Madness of Crowds and Perils of Point Forecasts（Roger M. Cooke 单作，RFF；Decision Analysis（INFORMS），Articles in Advance pp.1-19，DOI 10.1287/deca.2025.0437；Received 2025-07-08 / Accepted 2026-02-20）
> **获取状态：全文已获取（合法）**——作者官网 PDF（rogermcooke.net/rogermcooke_files/WOC DA 2026.pdf，2.6MB）经查为 **CC BY 4.0 Open Access**（正文 Open Access Statement 逐字在 L32-36：© The Author(s) under CC BY 4.0）；Unpaywall 的 closed 状态过时。全文 65,538 chars/1,267 行（pypdf 提取，公式有损但正文数字完整）。
> 缓存：cache/_cache-Cooke-WOC-DA-2026.pdf + _cache-Cooke-WOC-DA-2026.txt（行号锚）＋ cache/_pdf2txt.py（可复用 PDF 提取脚本，pypdf 优先）。**非 arXiv 件降权纪律本轮不触发**。
> 专家数据与 SEJ 应用公开：rogermcooke.net（数据）/cooke-aspinall.net（应用）。

## 【事实层】

### 数据基座（§1，txt L91-111, 159-174）
- **107 个 SEJ（structured expert judgment）panels**：有可溯源发表、无共同专家（互相独立）；平均每 panel **11 名 vetted 专家**，对领域内不确定变量给 5/50/95 分位＋平均 14 个领域内 **calibration variables**（真值事后可知）。
- 本研究选 **40 panels**（≥10 专家且 ≥10 calibration 变量）→ **586 个带真值预测变量、698 专家、10,189 条专家预测**；互补集 67 studies（842 变量）专用于 panel 规模效应。
- 谱系锚：performance-weighted 组合优于 equal-weight（in-sample Colson & Cooke 2018；out-of-sample Eggstaff et al. 2014、Colson & Cooke 2017）；专家绩效持久（Cooke et al. 2021）——**即 Cooke classical model / Performance-Based Weights（PCM）**。

### 计分（§2，txt L206-272）
- **MAPE**：APE=|(f−r)/r|；非负量上严重低预测最多罚 1（f=0）而过度预测无界（引 Morley et al. 2018「Underprediction is … less heavily penalized than overprediction」）；WOC panel MAPE ≤ 专家 panel MAPE（Jensen 不等式，|·|凸），但每 panel 平均差仅 **0.009**——WOC 的 MAPE 优势微乎其微。
- **SA（Statistical Accuracy）**：真值落入专家 4 个 interquantile 区间（5%/45%/45%/5%）的相对频率对理论频率的**卡方拟合优度 p 值**（Cooke classical model 校准计分；低=统计失准）。

### 肥尾机制（§3-§4，txt L273-434）
- 直觉实验：均匀分布倒数=Pareto(1)（tail index 1，均值无限）；薄尾 running average 收敛，肥尾**不收敛（dissipative）**——大数定律仅对有限方差成立（附录 B）；「历史均值可能无预测力，样本均值/相关/协方差可能不收敛」。
- **专家误差实证**：10,189 条专家绝对百分比误差的 running average 极肥尾不收敛（Fig.3 右，对数轴）；586 WOC MAPEs 的 obesity index（4-tuple bootstrap，10,000 样本）**显著大于 Pareto(1)**（Sym MAPE 略低但仍显著大于 Pareto(1)）；互补集 842 MAPEs 肥度低于 586 但仍> Pareto(1)。
- **「sum resembles max」（subexponential 定义特征）**：40 个 WOC panel MAPE 总和 928,834.49，最大者=SETE_CIDADES（葡萄牙火山）877,202.18、次大 Topaz 49,777.81——剔除两个火山研究总和塌到 1,854.51；但 13/40 火山研究 MAPE rank 均值 23.46，Mann-Whitney 不能区分——**肥尾是全局分布性质，非领域性质**。
- panel size 增加 obesity（10-19 vs ≥20 专家区分需 50,000 4-tuples）；WOC MAPE 对 panel size 的 rank correlation 弱增。

### 依赖与多样性操作化（§5，txt L435-552）
- 关键转向原话：「We should be asking about dependence in **experts' forecast errors relative to the realizations**」——无真值时谈「依赖/多样性」是无锚的；有真值才能操作化。
- 四个 (expert×variable) 矩阵/panel：**dens@rls**（真值落在专家分布的分位数）、**HiLo**（真值低于/高于点预报=中位数，±1）、**Tail**（真值是否在专家 90% 带内，±1）、**MAPE**。diversity=panel 内分歧量。
- CO2em 实例（Rennert et al. 2022，10 专家 11 校准变量）：**专家间平均相关 0.65 vs 变量间 −0.069**——专家聚类远强于变量聚类。
- 方差分解（Fig.6）：dens@rls/HiLo/MAPE=变量解释方差>专家（中度专家聚类）；**Tail 反向（专家解释更多）**——「专家中位数放置相对依赖，90% 带捕捉能力相对独立」→找独立性应看 Tail 矩阵；HiLo net agreement 远超随机期望，Tail 接近随机期望（VESUVIO 为负）。

### 规模与多样性对绩效的影响（§6，txt L553-642）
- Table 2（40 studies）：SA 与 HiLo net agreement **−0.26（0.05 显著）**=多样性→高 SA；MAPE 与 nrex +0.19（n.s.）。
- **Table 3（全 107 studies）**：nrex 与 Expert MAPE / WOC MAPE rank correlation **+0.24 / +0.23（0.01 显著）**——**专家越多 MAPE 越差**；nrvb 不显著；**product moment 相关全≈0（方差无穷时 Pearson 趋零——肥尾下必须用 Spearman，方法学警示）**。
- Fig.9：HiLo agreement 在 MAPE 最好 10% 分位最高、随 MAPE 变大递减；Tail agreement 关联弱得多。
- **最佳 SA 专家**：per-panel SA 最佳专家的 SA 与其 MAPE Spearman **−0.45（p=0.002）**——校准最好的专家误差也最小（绩效可识别）。
- **决定性数字（引 Cooke et al. 2021，49 panels/570 calibration 变量/530 专家）**：MAPE **performance-weighted 2.2 / equal-weight 3.8 / WOC（中位数平均）1472.3**；本研究 40 panels 平均 WOC MAPE **23,220.86**；**只选每 panel 最佳 SA 专家 MAPE=6.3**——比 WOC 好 3 个数量级。

## 【结论层】（三态）——恢复令三重点逐答

**①聚合方法选择为主导因子的证据——【已核】**
- §7 原话：「**The method of aggregation is perhaps the most important factor** in wisdom of crowds forecasting」（L686-687）。定量：同一批专家，聚合从「中位数平均」→「等权 CDF 组合」→「绩效加权 CDF 组合」，MAPE **1472.3→3.8→2.2**（49 panels）；「选最佳 SA 专家」6.3 vs WOC 23,220.86（40 panels）。I 文档 §四.6 转述逐字对上。
- 反直觉双效应：crowd size 与 HiLo diversity **对 SA 有利、对 MAPE 有害**（L680-685）——「exactly the opposite of received wisdom on wisdom of crowds」。

**②点预报危险的论证——【已核】**
- 论证链：点预报误差极肥尾（obesity>Pareto(1)，10,189 条实证）→肥尾下样本均值/相关不收敛（dissipative）→WOC 点预报聚合的表观收敛是假象（极端 outlier 频率足以打断任何收敛趋势）→**专家数增加使肥胖加剧而非收敛**（+0.24/+0.23 显著）→点预报聚合结构性不可靠（「regardless of the precise method by which judgments are weighted and aggregated」=与聚合细节无关的结构性失败）。附录 A 证明 WOC 略胜随机选专家（Jensen），但远逊分布聚合。
- 结论措辞：「point forecasts are **perilous** and merit a cautionary advisory」（L705-706）。

**③与我们 extremization 路线的关系——【已核谱系+引申见下】**
- Cooke PCM=K5 extremization（Satopää 1501.06943）的**姊妹路线**：都拒绝平等对待预测者、都依赖带真值的校准结构。差异：①作用层——PCM 在专家 CDF 层绩效加权（决策层），extremization 在聚合后概率上做 Cauchy 幂修正（数学层）；②质量信号——PCM 用 calibration variables 的 SA（卡方），extremization 用 crowd 多样性/相关 λ；③PCM 有 107 panels 数十年 out-of-sample 验证（Eggstaff 2014），extremization 权重在「多路判词」上我们只能自建。
- **对「LLM 出分布不出点值」铁律的直接背书**：核心结论=即使要的是点预测，也应让预测者量化不确定性、组合分布、再从组合分布提取点——**正是我们「LLM 出逻辑/概率+确定性代码层聚合」的铁律结构**。

## 与本项目的差异表（接入总差异表）

| 维度 | Cooke 2026（SEJ 专家面板） | 本项目（三路判词/账本） |
|---|---|---|
| 预测者 | 人类 vetted 专家（11/panel 均值） | LLM 判词路（T0.2/0.7/1.0）+多模拟器轨迹 |
| 结算对象 | 连续量点预报+分位带（calibration variables） | 二值事件概率+拟扩分布 |
| 校准计分 | SA=卡方 interquantile 命中 p 值 | Brier/ECE；**SA 卡方口径可借作判词路质量分** |
| 组合 | PCM 绩效加权 CDF > 等权 > 点预报平均（1472.3→3.8→2.2） | logit 聚合+先验收缩（BLF）——**PCM 绩效加权=第三条组合路线候选** |
| 关键警示 | 点预报聚合结构性危险；专家数↑多样↑对 MAPE 有害 | 「多路聚合必优于单路」直觉被削弱——路数与质量需消融 |
| 可复用 | SA 卡方口径、obesity index、Tail/HiLo 矩阵依赖分析、全量数据 rogermcooke.net | 直接借 |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】PCM 翻译到三路判词：每路判词=一名「专家」，账本历史=calibration variables，按各路 SA（或退化 Brier 排序）绩效加权组合——BLF 式「logit+收缩」之外的**第二条聚合路线**，两条路线账本回放对打（呼应 König-Kersting 聚合器可插拔纪律）。
- 【引申】WOC 23,220 vs 最佳单专家 6.3 反差警示「多路聚合必好」教条：若某判词路 SA 持续最佳，单路+校准可能优于等权多路——账本应记「最佳单路对照」列。
- 【引申】肥尾警示对误差记分：MAPE/APE 类误差尾部无界且主导均值——我们用 Brier（有界 [0,1]）天然免疫，但引入 MAPE 类指标（资源预测）须先查肥尾；「dissipative」可迁移：判词质量指标的 running average 收敛性检验应入账本回放。

## 存疑与待验证

1. PDF 提取公式有损（pypdf）：附录 B Pareto 矩公式、Jensen 证明、net agreement 引理细节未逐字核——引用公式前回原 PDF。
2. 附录 B 余下（L900-1267）未读完——如需 obesity index 复现细节回读。
3. 「WOC 1472.3 vs PCM 2.2」来自 Cooke et al. 2021 的 49 panels 子集（非本文 40 panels）；跨子集可比性依赖两子集同质。
4. SEJ calibration variables 多为连续量，我们二值事件——SA 卡方口径移植需重设计（二值版=Brier 排序或 log score）。
5. I 文档标「INFORMS Decision Analysis」，PDF 版权页为 Decision Analysis（INFORMS）——2027 复测时顺手勘误。

（Cooke 笔记完 · 2026-09-12 · 微步A4 · 锚=cache/_cache-Cooke-WOC-DA-2026.txt 1267 行，CC BY 4.0 合法全文，未触发降权纪律）
