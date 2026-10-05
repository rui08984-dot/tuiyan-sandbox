# K-公式精读（K 棒 · 数学/公式层 · 长活微步制）

> 概率校准与聚合公式全文精读账本。证据三态：【已核】=本次全文原文读到并抄录；【转述】=二手/记忆资料；【待验证】=未完成核实；【推算】=由已核公式推导。纪律：每回合精读 1-2 篇全文→追加本文件→回报队长→停等恢复令。

## 回合进度总账

| 回合 | 论文 | 状态 |
|---|---|---|
| 1 | Angelopoulos & Bates, A Gentle Introduction to Conformal Prediction and Distribution-Free UQ, arXiv:2107.07511v6 | ✅ 完成（本回合） |
| 2 | Gibbs & Candès, Adaptive Conformal Inference Under Distribution Shift, **arXiv:2106.00170v3**（任务书 2106.00144 有误已勘误）+ Guo et al., On Calibration of Modern Neural Networks, arXiv:1706.04599v2 | ✅ 完成 |
| 3 | Noh et al., Multi-LLM ACI, arXiv:2602.01285 + Satopää et al., Modeling Probability Forecasts via Information Diversity, arXiv:1501.06943v1（含 Murphy Brier 分解原文式）| ✅ 完成 |
| 4（收官） | Kumar, Liang, Ma, Verified Uncertainty Calibration, arXiv:1909.10155（ICML 2019）| ✅ 完成 |
| 书单留档（YAGNI 未读） | opinion pool 公理（Genest-Zidek 1986）；Satopää IJF 2014 logit 版（无 arXiv）；Murphy 1973 原文；2608.28482 Proper Scoring Rules Shape LLM Forecasting；1406.2148 / 1506.06405（Satopää 姊妹篇）；2111.03153（Neyman-Roughgarden d=√3） | 队长令留书单 |

---

# 回合 1：arXiv:2107.07511v6 — conformal prediction 综述

## ① 元数据
- 标题：A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification
- 作者：Anastasios N. Angelopoulos（UC Berkeley）、Stephen Bates（MIT；现 UNC）
- arXiv:2107.07511，v1 2021-07-15 → 最新 **v6 2022-12-07**（abs 页实测 6 版历史）【已核】
- 正式发表：SIAM Review 65(4):713-754, 2023【转述·卷期页码本次未从页面直接验证】
- 精读覆盖：§1 全、§2.1-2.4、§3 全（3.1/3.2/3.3）、§4.4/4.5/4.6、§6 全、附录 A.1.1-A.1.2、附录 C/D。未细读：§4.1-4.3（group/class-conditional/risk control 主体）、§5 案例章、§7 史话、附录 B 例题【如实标注】

## ② 全文获取路径
- arxiv.org/abs/2107.07511 → HEAD 200（45.9KB），确认 v6【已核】
- arxiv.org/html/2107.07511 → 200（826KB，v6 官方 HTML）【已核】
- 按队长爬虫武库补充令调 batch_extract.py：首次 EXIT=9009——根因：Get-Command python 命中 WindowsApps Store 存根（C:\Users\crx\AppData\Local\Microsoft\WindowsApps\python.exe），非真解释器；换 **C:\Windows\py.exe** 后 EXIT=0【已核】
- 产出归档：.scratch/forecast-debate/全文精读/cache/K-2107.07511v6-batchextract.md（127,721 chars，trafilatura 提取）【已核】
- 精读提取缓存：.scratch/forecast-debate/全文精读/_cache-K-2107.07511.html（826KB）→ _extract-html.cjs → _cache-K-2107.07511.txt（169KB / 3685 行，公式以 $LaTeX$ alttext 完整保留，定理/公式逐条可核）【已核】
- ar5iv 备用路径未启用（官方 HTML 一次成功）【如实标注】

## ③ 核心贡献（3 句）
1. 给出「任意模型的任意启发式不确定性 → 有限样本严格预测集」的通用配方：共形分数 s(x,y) + 校准集调整分位数 ⌈(n+1)(1−α)⌉/n + 阈值化，覆盖保证与模型好坏、数据分布完全无关（只要可交换）。
2. 提供可直接部署的打分函数库（softmax 1−p、APS 累计概率、CQR 分位回归、标量不确定性、Bayes 后验密度），并给出适配性评估指标（SSC/FSC）与「实现正确性自检」的覆盖波动解析式（Beta / Beta-binomial）。
3. 把框架扩展到协变量偏移（加权 conformal 似然比重加权分位数）、时序漂移（折扣权重 + 定理 4 的 TV 距离覆盖损失上界 + 有效样本量警告）、full conformal（置换检验解释）与分布无关风险控制（LTT + Hoeffding/HB p 值 + FWER 校正）。

## ④ 公式清单（逐条抄录；节号/变量/条件随注）

通用记号：校准集 $(X_i,Y_i)_{i=1}^n$，分数 $s_i=s(X_i,Y_i)$，$\alpha$=目标误盖率，$l=\lfloor(n+1)\alpha\rfloor$（附录 C/D 用）。除标注外均为【已核】原文抄录。

**F1 边际覆盖双边界（Eq.1, §1）**
$1-\alpha \le \mathbb{P}(Y_{\rm test}\in\mathcal{C}(X_{\rm test})) \le 1-\alpha+\frac{1}{n+1}$
条件：校准/测试 i.i.d.（可弱化为可交换）；上界另需分数连续（Theorem D.2）。

**F2 分类共形分数（§1）**
$s_i = 1-\hat{f}(X_i)_{Y_i}$（1 减真类 softmax；模型越错分数越高）。

**F3 调整分位数（§1 步 3，全文通用）**
$\hat{q} = \mathrm{Quantile}(s_1,\ldots,s_n\;;\; \lceil(n+1)(1-\alpha)\rceil/n)$
论文原码（Figure 2，缩进伪代码）：
    q_level = np.ceil((n+1)*(1-alpha))/n
    qhat = np.quantile(cal_scores, q_level, method='higher')
注：Figure 3/5 用旧参数名 interpolation='higher'；numpy≥1.22 用 method=。

**F4 预测集（Eq.2）**
$\mathcal{C}(X_{\rm test})=\{y: s(X_{\rm test},y)\le\hat{q}\}$

**F5 Theorem 1（Vovk-Gammerman-Saunders, §1）**
$P(Y_{\rm test}\in\mathcal{C}(X_{\rm test}))\ge 1-\alpha$。i.i.d. 即可，分数函数任意（可以完全没信息）。

**F6 APS 自适应预测集（Eq.3/4/5, §2.1）**
oracle 集：$\{\pi_1(x),\ldots,\pi_k(x)\}$，$k=\sup\{k':\sum_{j=1}^{k'}\hat{f}(x)_{\pi_j(x)}<1-\alpha\}+1$（$\pi$=softmax 降序排列）。
分数：$s(x,y)=\sum_{j=1}^{k}\hat{f}(x)_{\pi_j(x)}$，其中 $y=\pi_k(x)$（累计 softmax 到真类为止）。
集（防零大小）：$\mathcal{C}(x)=\{\pi_1(x),\ldots,\pi_k(x)\}$，$k=\sup\{k':\sum_{j=1}^{k'}\hat{f}(x)_{\pi_j(x)}<\hat{q}\}+1$。
代码（Figure 3，缩进）：
    cal_pi = cal_smx.argsort(1)[:,::-1]; cal_srt = np.take_along_axis(cal_smx,cal_pi,axis=1).cumsum(axis=1)
    cal_scores = np.take_along_axis(cal_srt,cal_pi.argsort(axis=1),axis=1)[range(n),cal_labels]
    qhat = np.quantile(cal_scores, np.ceil((n+1)*(1-alpha))/n, interpolation='higher')

**F7 CQR 共形化分位回归（Eq.6/7, §2.2）**
分数：$s(x,y)=\max\{\hat{t}_{\alpha/2}(x)-y,\ y-\hat{t}_{1-\alpha/2}(x)\}$
区间：$\mathcal{C}(x)=[\hat{t}_{\alpha/2}(x)-\hat{q},\ \hat{t}_{1-\alpha/2}(x)+\hat{q}]$
（$\hat{t}_\gamma$=分位回归拟合的 $\gamma$ 分位；共形化只把区间整体扩 $\hat{q}$。原码：np.maximum(cal_labels-model_upper(cal_X), model_lower(cal_X)-cal_labels)）。

**F8 pinball 损失（Eq.8, §2.2）**
$L_\gamma(\hat{t}_\gamma,y)=(y-\hat{t}_\gamma)\,\gamma\,\mathbb{1}\{y>\hat{t}_\gamma\}+(\hat{t}_\gamma-y)(1-\gamma)\,\mathbb{1}\{y\le\hat{t}_\gamma\}$
$\gamma=0.5$ 退化为 $|\hat{t}_\gamma-y|/2$（条件中位数）。

**F9 标量不确定性共形化（Eq.9/10/11, §2.3）**
分数：$s(x,y)=|y-\hat{f}(x)|/u(x)$，$u(x)$=任意「越大越不确定」标量：$\hat{\sigma}(x)$、残差模型 $\hat{r}(x)$、ensemble 方差、MC-dropout 方差、输入扰动敏感度等（论文列 5 种）。
蕴含：$\mathbb{P}[|Y_{\rm test}-\hat{f}(X_{\rm test})|\le u(X_{\rm test})\hat{q}]\ge 1-\alpha$（Eq.10）。
区间：$\mathcal{C}(x)=\hat{f}(x)\pm u(x)\hat{q}$（Eq.11；对称；作者提醒 $\hat{\sigma}$ 与真分位数无必然比例，更推 CQR）。

**F10 Bayes 共形化（Eq.12/13/14, §2.4）**
Bayes oracle（假设全对时最优）：$S(x)=\{y:\hat{f}(y|x)>t\}$，$t$ 使 $\int_{S(x)}\hat{f}(y|x)dy=1-\alpha$。
分数：$s(x,y)=-\hat{f}(y|x)$（后验预测密度取负）。
集：$\mathcal{C}(x)=\{y:\hat{f}(y|x)>-\hat{q}\}$（后验密度 superlevel 集）。
性质：一定技术假设下，在所有 1−α 覆盖的预测集中 Bayes 风险最小（平均集大小最小；Neyman-Pearson 式论证）。

**F11 条件覆盖与其度量（Eq.15 + FSC/SSC, §3.1）**
条件覆盖：$\mathbb{P}[Y_{\rm test}\in\mathcal{C}(X_{\rm test})\mid X_{\rm test}]\ge 1-\alpha$——一般情形不可达（Vovk [14]），只能逼近。
FSC 指标：按离散特征分组 $\mathcal{I}_g$，取 $\min_g \frac{1}{|\mathcal{I}_g|}\sum_{i\in\mathcal{I}_g}\mathbb{1}\{Y_i^{\rm val}\in\mathcal{C}(X_i^{\rm val})\}$（组内覆盖的最小值）。
SSC 指标：把 $|\mathcal{C}(x)|$ 分箱 $B_1,\ldots,B_G$，同式取 $\min_g$ 箱内覆盖。通用、无需先验选特征。

**F12 覆盖的解析分布（Eq.16, §3.2, Vovk）**
$$\mathbb{P}(Y_{\rm test}\in\mathcal{C}(X_{\rm test})\mid\{(X_i,Y_i)\}_{i=1}^n)\sim\mathrm{Beta}(n+1-l,\ l),\qquad l=\lfloor(n+1)\alpha\rfloor$$
条件覆盖率（校准集固定、验证集无限）是随机变量；收敛速率 $O(n^{-1/2})$。

**F13 校准集大小需求表（Table 1, §3.2; α=0.1, δ=0.1）**
要求 coverage $\in[1-\alpha-\epsilon,\,1-\alpha+\epsilon]$ 以概率 $1-\delta$ 成立所需 $n(\epsilon)$：ε=0.1→22；0.05→102；0.01→2491；0.005→9812；0.001→244390。经验法则：n≈1000。【已核表内数字；其他 α/δ 组合未核】

**F14 覆盖正确性检验（Eq.17/18 + Figure 12 码, §3.3）**
$C_j=\frac{1}{n_{\rm val}}\sum_{i=1}^{n_{\rm val}}\mathbb{1}\{Y^{\rm val}_{i,j}\in\mathcal{C}_j(X^{\rm val}_{i,j})\}$，$j=1,\ldots,R$；$\overline{C}=\frac{1}{R}\sum_j C_j\approx 1-\alpha$。
实现（缓存分数 + R 次重划分）：
    scores = get_scores(X,Y)  # 缓存一次
    for r in range(R):
        np.random.shuffle(scores); cal,val = scores[:n],scores[n:]
        qhat = np.quantile(cal, np.ceil((n+1)*(1-alpha)/n), method='higher')
        coverages[r] = (val <= qhat).mean()
偏离超 F15 波动带 → 查实现 bug，不怪分布。

**F15 Beta-binomial 精确波动（Eq.82/83, 附录 C）**
$C_j\sim\frac{1}{n_{\rm val}}\mathrm{Binom}(n_{\rm val},\mu),\ \mu\sim\mathrm{Beta}(n+1-l,l)$（=BetaBinom）。
$\mathbb{E}[\overline{C}]=1-\frac{l}{n+1}$；$\mathrm{sd}(\overline{C})=\sqrt{\frac{l(n+1-l)(n+n_{\rm val}+1)}{n_{\rm val}\,R\,(n+1)^2(n+2)}}=O\big(\frac{1}{\sqrt{R\min(n,n_{\rm val})}}\big)$。

**F16 异常检测的误差控制（Eq.32 + Proposition 3, §4.4）**
目标：$\mathbb{P}(\mathcal{C}(X_{\rm test})=\mathrm{outlier})\le\alpha$（对干净分布的新样本）。
做法：score 只依赖 $x$（无监督），$\hat{q}=\mathrm{quantile}(s_1,\ldots,s_n;\lceil(n+1)(1-\alpha)\rceil/n)$，$s(x)>\hat{q}$ 判 outlier。
Prop.3：i.i.d. 下误差控制成立。等价解释（§4.4 末段原文）：被拒点 = 「与校准数据可交换」零假设下 **p 值 < α** 的点；与经典置换检验同源。

**F17 加权 conformal / 协变量偏移（Eq.33-36 + Theorem 3, §4.5; Tibshirani et al.）**
似然比：$w(x)=\frac{d\mathcal{P}_{\rm test}(x)}{d\mathcal{P}(x)}$。
权重：$p_i^w(x)=\frac{w(X_i)}{\sum_{j=1}^n w(X_j)+w(x)}$，$p_{\rm test}^w(x)=\frac{w(x)}{\sum_j w(X_j)+w(x)}$。
重加权分位数：$\hat{q}(x)=\inf\{s_j:\sum_{i=1}^{j}p_i^w(x)\,\mathbb{1}\{s_i\le s_j\}\ge 1-\alpha\}$（分数已升序）。
集：$\mathcal{C}(x)=\{y:s(x,y)\le\hat{q}(x)\}$。
Theorem 3：$(X_i,Y_i)\sim\mathcal{P}\times\mathcal{P}_{Y|X}$、$(X_{\rm test},Y_{\rm test})\sim\mathcal{P}_{\rm test}\times\mathcal{P}_{Y|X}$ 时覆盖 $\ge 1-\alpha$（Y|X 不变假设）。

**F18 分布漂移下的加权分位（Eq.38/39 + Theorem 4 + Eq.42/43, §4.6; Barber et al.）**
$\hat{q}=\inf\{q:\sum_{i=1}^n\tilde{w}_i\,\mathbb{1}\{s_i\le q\}\ge 1-\alpha\}$，归一化权重 $\tilde{w}_i=\frac{w_i}{w_1+\cdots+w_n+1}$。
Theorem 4：$\mathbb{P}(Y_{\rm test}\in\mathcal{C}(X_{\rm test}))\ge 1-\alpha-2\sum_{i=1}^n\tilde{w}_i\,\epsilon_i$，$\epsilon_i=d_{\rm TV}((X_i,Y_i),(X_{\rm test},Y_{\rm test}))$。
权重调度（Eq.42）：滚动窗 $w_i^{\rm fixed}=\mathbb{1}\{i\ge n-K\}$；指数衰减 $w_i^{\rm decay}=0.99^{\,n-i+1}$。
有效样本量（Eq.43）：$n^{\rm eff}=\frac{\sum_i w_i}{\sum_i w_i^2}$；覆盖方差 $\sim 1/\sqrt{n^{\rm eff}}$——权重过尖方差爆炸。

**F19 full conformal（Eq.53/54 + Theorem 5 + Eq.56, §6.1）**
对每个候选 $y$：在增广数据 $(X_1,Y_1),\ldots,(X_n,Y_n),(X_{n+1},y)$ 上重拟合**对称**算法得 $\hat{f}^y$；算 $s_i^y$。
$\hat{q}^y=\mathrm{Quantile}(s_1^y,\ldots,s_n^y;\lceil(n+1)(1-\alpha)\rceil/n)$；
$\mathcal{C}(X_{\rm test})=\{y:s_{n+1}^y\le\hat{q}^y\}$；Theorem 5：i.i.d.+对称算法 ⇒ 覆盖 $\ge 1-\alpha$（可交换性版本亦成立）。
代价：$|\mathcal{Y}|=K$ 时 $(n+1)\cdot K$ 次模型拟合。解释（Eq.56）：集 = 全部通过「可交换性置换检验」的 $y$——conformal 即假设检验。
折中：cross-conformal / CV+ / Jackknife+（§6.2，少量拟合+全部数据，见 Barber et al.）。

**F20 LTT 风险控制 p 值族（附录 A.1.1）**
super-uniformity（Eq.63）：$\forall t\in[0,1],\ \mathbb{P}_{\mathcal{H}_\lambda}(p_\lambda\le t)\le t$（零假设下 p 值不超过任何 t 的概率 ≤ t）。
Hoeffding p 值（Eq.64，[0,1] 风险，分布无关）：
$p_\lambda^{\rm Hoeffding}=e^{-2n(\alpha-\widehat{R}(\lambda))_+^2}$（$\widehat{R}$=经验风险，$(x)_+=\max(x,0)$）。
Hoeffding-Bentkus p 值（Eq.65/66，更紧）：
$p_\lambda^{\rm HB}=\min\big(\exp\{-n\,h_1(\widehat{R}(\lambda)\wedge\alpha,\alpha)\},\ e\cdot\mathbb{P}(\mathrm{Bin}(n,\alpha)\le\lceil n\widehat{R}(\lambda)\rceil)\big)$，
$h_1(a,b)=a\log\frac{a}{b}+(1-a)\log\frac{1-a}{1-b}$。
多重检验（Eq.67-70）：全 null 时 $\mathrm{FWER}=1-(1-\delta)^{|\Lambda|}\to 1$；Bonferroni $\widehat{\Lambda}=\{\lambda:p_\lambda\le\delta/|\Lambda|\}$；fixed-sequence testing 按先验排序逐一在 δ 水平测、首次接受即停。

**F21 覆盖定理形式化与证明（Theorem D.1/D.2, 附录 D）**
$\hat{q}=\inf\{q:\frac{|\{i:s(X_i,Y_i)\le q\}|}{n}\ge\frac{\lceil(n+1)(1-\alpha)\rceil}{n}\}$。
证明核心三步（原文抄录）：①排序后 $\hat{q}=s_{\lceil(n+1)(1-\alpha)\rceil}$（当 $\alpha\ge\frac{1}{n+1}$；否则 $\hat{q}=\infty$，全集平凡成立）；②事件等价 $\{Y_{\rm test}\in\mathcal{C}\}=\{s_{\rm test}\le\hat{q}\}$；③可交换性 ⇒ $P(s_{\rm test}\le s_k)=\frac{k}{n+1}$ ⇒ $P=\frac{\lceil(n+1)(1-\alpha)\rceil}{n+1}\ge 1-\alpha$。∎
Theorem D.2：分数联合连续 ⇒ $P\le 1-\alpha+\frac{1}{n+1}$（实践中给分数加微随机噪声即可近似满足）。

**F22 经典 split conformal p 值（任务书点名；论文未给编号公式——由 F21 秩论证 + §4.4/§6.1 置换检验解释直接读出，本笔记转写并如实标注）**
$$\pi(x,y)=\frac{1+\#\{i: s_i\ge s(x,y)\}}{n+1}$$
性质：$\mathcal{H}_0$（新点与校准集可交换）下 super-uniform（满足 Eq.63）；$\pi\le\alpha$ ⟺ $y\in\mathcal{C}(x)$（与 F3/F4 阈值化等价）。覆盖定理同 F1：边际 $1-\alpha$。
n 小时的实际含义：p 值粒度 = $1/(n+1)$——n=29 时最小非零 p 值 ≈ 0.033，**任何 α<1/(n+1) 的检验自动全通过（q̂=∞ → 全集）**；区间宽度随 n 减小以 $1/\sqrt{n}$ 增宽（F12），n=30 时覆盖波动带约为 $\pm 0.08$（F13 类比），故 L0 门禁期输出只能当参考。

## ⑤ 实现伪代码 / 参考代码

**论文原码（numpy/torch，缩进式；Figure 2/3/5/7/12 全部抄录于 F3/F6/F7/F9/F14）**：核心就一行 np.quantile(scores, np.ceil((n+1)*(1-alpha))/n, method='higher')。
注意：numpy≥1.22 用 method='higher'（旧名 interpolation='higher'，论文两种混用）。

**MAPIE（scikit-learn-contrib/MAPIE，★1589；pip install mapie；Python≥3.9/NumPy≥1.23/sklearn≥1.4）**【已核 README + v1 release notes 原文】
v1（2025 起）类名映射（release notes 原表）：
    MapieRegressor          → SplitConformalRegressor / CrossConformalRegressor / JackknifeAfterBootstrapRegressor
    MapieClassifier         → SplitConformalClassifier / CrossConformalClassifier
    MapieQuantileRegressor  → ConformalizedQuantileRegressor
    MapieTimeSeriesRegressor→ TimeSeriesRegressor
    MapieMultiLabelClassifier → MultiLabelClassificationController
    MapieCalibrator         → TopLabelCalibrator
用法三步（v1 release notes 原文）：fit → .conformalize(X_conf, y_conf) → predict（conformalize 是 v1 关键新步）。
指标：from mapie.metrics.classification import classification_coverage_score（v1 路径）。
2026 新增（README 宣传语【转述·具体函数名未验证】）：LLM-as-Judge 风险控制、可交换性检验（exchangeability tests）、自适应 conformal 方法。
prefit 模式：SplitConformalRegressor(prefit=True)（已拟合模型直接接校准集）。

**npm 侧（接 E-算法工具箱实查结论）**：conformal-js v0.1.0 存在但功能极薄；本项目的 JS 实现建议按 F3/F14 自写（核心 15 行），不引依赖。【转述 E-算法工具箱实查】

## ⑥ 对本项目落地点（预测卡 L0 线）

**a. n≥30 门禁的数学依据（F3/F21/F22）**：q̂ 有限需 $\lceil(n+1)(1-\alpha)\rceil\le n$ ⟺ $n\ge 1/\alpha-1$。α=0.1→n≥9；α=0.05→n≥19。n=30 时最小可用 α=1/31≈0.032（再小则 q̂=∞ 全集）；n=30、α=0.05 时秩=⌈29.45⌉=30，q̂ 恰取最大校准分数（边界保守）。→ L0 早期建议 α=0.1 起步，n≥50 再上 α=0.05。
**b. 「200 条前只记不评」的波动学依据（F12/F13/F15）**：α=0.1 时覆盖波动 ±0.1 需 n≈22、±0.05 需 n≈102——200 条以内一切 coverage/ECE 数字都在噪声带内，门禁数学上成立。ECE 分桶：8 桶×200 条=25 条/桶，只配看趋势；桶级 ±0.05 稳定需桶内 ≥102 条（总 ≥816 条）【推算：由 F13 类比，未直接核】。
**c. 3 路判词聚合（F17/F18 骨架 + Eq.43 警告）**：三路判词各当一路分数源，按历史准确率给 w_i 跑加权分位聚合；n_eff=Σw/Σw² 提醒权重过尖（一路独大）等效样本坍缩→覆盖方差爆炸。但 n=3 太小跑不动 conformal（α=0.1 需 n≥9），3 路聚合现阶段只能加权平均/log-pool（待 opinion pool 回合定）。
**d. 玄学对照臂（F2 + §1 分数讨论 + F11 SSC）**：玄学判词当第 4 路，score 用 1−P(真值)。§1 原文预言：分数无区分度时集是「足够大的随机标签集」——即玄学臂应表现为覆盖达标（≥1−α）但集大小恒定偏大、SSC 无差别。这正是安慰剂基线的定量形态；账本同记 Brier+集大小+SSC。
**e. 实现正确性自检（F14/F15）**：每新增 30 局做一次 R=200 重划分覆盖检验（缓存分数+shuffle，Figure 12 模式），经验覆盖直方图对照 BetaBinom(n_val, n+1−l, l) PMF；偏离超 sd(C̄) 公式带 → 查 bug 而非怪分布。
**f. 失效条件（F18）**：账本天然是时间序列（逐局追加），可交换性不严格成立 → 必须滚动窗或 0.99^(n−i+1) 衰减，或回合 2 读 ACI（Gibbs & Candès）；权重过尖时 n_eff 小、覆盖方差大。Q(何时衰减率失效)：漂移快于 0.99 衰减假设时——回合 2 补。
**g. 玄学铁律合规**：conformal 在本项目只用于不确定性量化+校准诊断+消融对照，不产生任何研判信号；玄学路输出恒挂「娱乐参考·非游戏研判」。

## ⑦ 发散联想（全部为「未经验证猜想」）
1. Beta-binomial 自检器：L0 账本每 30 局把经验覆盖直方图与 BetaBinom PMF 叠图（F14/F15）——比 ECE 分桶更根本：ECE 只管概率口径，覆盖检验管整套流程有没有 bug。
2. CQR 嫁接 LLM 判词：把 LLM 自报置信 c 当 $\hat{t}$，用账本残差 |y−c| 的 ⌈(n+1)(1−α)⌉/n 分位数做「免训练温度缩放」（非参数版 temperature scaling；下回合与 Guo et al. 的 T 缩放对照，二者假设差在哪）。
3. 分歧度缩放：F9 的 u(x) 用「3 路判词方差」——diversity-scaled conformal：路间分歧大→区间自动宽。猜想可行，未验证。
4. 置换检验反用：把玄学臂定义为「理论上无法通过可交换性置换检验的一路」；若实测玄学判词 p 值常 <α 反而说明它与结果分布有可交换结构——作为玄学消融臂的负向判据设计（结论仍只能是娱乐参考，铁律不破）。
5. Hoeffding p 值当「解锁点评」门槛（F20 Eq.64）：p=e^(−2n(α−R̂)_+²) 在 n<200 时几乎不可能 <δ——「200 条前只记不评」可以数学化成这条不等式，避免人为主观。
6. n_eff/n 比值当「3 路权重健康度」指标（Eq.43）：低于阈值报警权重过尖，接账本告警。

## ⑧ 存疑处
1. SIAM Review 65(4):713-754, 2023 卷期页码【转述·待验证】。
2. MAPIE 2026 新增 exchangeability test 的具体函数名未读到【待验证】。
3. §4.1-4.3 与附录 A LTT 主体未精读（对 L0 优先级低，按需补）【如实标注】。
4. F22 经典 conformal p 值公式是本笔记由 F21 秩论证转写的推论，论文无此编号公式——外部引用请引 Gibbs & Candès arXiv:2106.00170 或 Vovk 原书【转写标注】。
5. Table 1 的 n(ε) 数值仅对 α=0.1, δ=0.1 成立；α=0.05 时数值不同【已核表内，其他组合未核】。
6. batch_extract.py 对本论文产出的 md（cache/K-2107.07511v6-batchextract.md）未逐字核对与官方 HTML 一致性（公式在 md 中可能是 Unicode 近似而非 LaTeX）——本笔记公式以 _cache-K-2107.07511.txt 的 alttext LaTeX 为准【已核 txt，md 未核】。

---
（回合 1 完 · 2026-09-11）

---

# 回合 2：arXiv:2106.00170v3 — Gibbs & Candès, Adaptive Conformal Inference（ACI）

## ① 元数据
- 标题：Adaptive Conformal Inference Under Distribution Shift；作者 Isaac Gibbs、Emmanuel Candès（Stanford）
- arXiv:2106.00170，v1 2021-06-01，本次精读 v3（NeurIPS 2021 版）【已核：arXiv API ti 查询返回 2106.00170v3】
- **id 勘误**：任务书给的 2106.00144 实为电力系统 SCUC 论文（eess.SY），错抓缓存已改名 _WRONGID-2106.00144.* 存证【已核】
- 精读覆盖：§2 全（算法+γ 选择+波动率案例）、§3、§4.1-4.2（定理）、§5、§6、§7、附录 A.1；未细读 A.2-A.10 证明主体【如实标注】
- 注：**本文无 AgACI 名称**——AgACI 是后续文献变体，待后续回合查证（本文只有 Eq.3 加权变体）

## ② 全文获取路径
- arxiv.org/html/2106.00170 → 200（576KB，官方 HTML v3）【已核】
- 缓存：_cache-K-2106.00170.html → _extract-html.cjs → _cache-K-2106.00170.txt（85KB/1918 行）【已核】
- 归档：cache/K2-2106.00170-batchextract.md（batch_extract/py.exe）【已核】
- 书单扩展（arXiv API 顺带命中）：2602.01285 Multi-LLM ACI for Reliable LLM Responses（2026-02，与 3 路判词直接相关）；2510.15824 ACI through Blackwell Approachability（2025-10）；2412.19318 ACI by Betting（2024-12）【已核 API 元数据，全文未读】

## ③ 核心贡献（3 句）
1. 把 conformal 的目标误盖率 α 本身变成在线可调参数：α_{t+1}=α_t+γ(α−err_t)，用历史误盖反馈追踪漂移环境下的「本应正确的」α*_t，对任意数据生成过程成立长期频率保证。
2. 证明分布无关的 Prop 4.1（T 期平均误盖率 → α，无需任何假设）+ HMM 环境下的 Thm 4.1（大偏差集中）与 Thm 4.2（单期边际覆盖平方误差 ≤ L(1+γ)/γ·漂移量 + Lγ/2），γ 的最优选择正比于漂移速度的平方根。
3. 与在线学习的 pinball loss 梯度下降精确等价（附录 A.1），score 函数的平稳化（归一化）是覆盖好坏的关键工程件。

## ④ 公式清单

**F23 实现误盖率与最优 α*（§2）**
$M_t(\alpha):=\mathbb{P}(S_t(X_t,Y_t)>\hat{Q}_t(1-\alpha))$；$\alpha^*_t:=\sup\{\beta\in[0,1]:M_t(\beta)\le\alpha\}$。
条件：$\hat{Q}_t$ 连续非降、$\hat{Q}_t(0)=-\infty$、$\hat{Q}_t(1)=\infty$；$\mathbb{P}(S_t=\hat{Q}_t(1-\alpha^*_t))=0$ ⇒ $M_t(\alpha^*_t)=\alpha$（精确边际覆盖）。

**F24 ACI 主更新（Eq.2, §2）**
$\text{err}_t:=\mathbb{1}\{Y_t\notin\hat{C}_t(\alpha_t)\}$，$\hat{C}_t(\alpha_t):=\{y:S_t(X_t,y)\le\hat{Q}_t(1-\alpha_t)\}$
$$\alpha_{t+1}:=\alpha_t+\gamma(\alpha-\text{err}_t),\qquad \gamma>0$$
误盖多（err=1）则 α 增大 → 集变宽；覆盖过保守（err=0）则 α 减小。

**F25 加权反馈变体（Eq.3, §2）**
$$\alpha_{t+1}=\alpha_t+\gamma\Big(\alpha-\sum_{s=1}^{t}w_s\,\text{err}_s\Big),\qquad w_s=\frac{0.95^{\,t-s}}{\sum_{s'}0.95^{\,t-s'}}$$
{w_s} 递增（近期权大）、Σw=1；实测与 Eq.2 轨迹几乎相同、仅更平滑（论文明说二者差异可忽略）。

**F26 γ 选择（§2.1）**
γ 是适应性-稳定性权衡：γ 大→更适应漂移但 α_t 波动大；γ 太小→退化成静态 conformal（α_t≈常数）。
Thm 4.2 的界被 $\gamma\propto\sqrt{|\alpha^*_{t+1}-\alpha^*_t|}$ 优化（∝漂移速度平方根）；论文实验取 γ=0.005（稳定且够灵活的经验值）。

**F27 Lemma 4.1 + Proposition 4.1（分布无关保证, §4.1）**
Lemma 4.1：a.s. 有 $\alpha_t\in[-\gamma,1+\gamma]$（α_t<0 时集=全集⇒err=0⇒α 回升，自锁）。
Prop 4.1（Eq.5）：对一切 $T$，
$$\Big|\frac{1}{T}\sum_{t=1}^{T}\text{err}_t-\alpha\Big|\le\frac{\max\{\alpha_1,1-\alpha_1\}+\gamma}{T\gamma},\qquad \lim_{T\to\infty}\frac{1}{T}\sum_t\text{err}_t\stackrel{a.s.}{=}\alpha$$
**对数据生成分布零假设**——展开递推 $\alpha_{T+1}=\alpha_1+\gamma\sum_t(\alpha-\text{err}_t)$ 直接得。

**F28 Prop 4.1 的近似紧性（§4.1 反例分析）**
固定 $\alpha^*$、分段线性 $M(p)$ 时：$\mathbb{E}[\text{err}_t]-\alpha=c(1-c\gamma)^{t-1}(\alpha_1-\alpha^*)$，$c\in\{\frac{1-\alpha}{1-\alpha^*},\frac{\alpha}{\alpha^*}\}$。
⇒ 平均覆盖偏差 $=\frac{1-(1-c\gamma)^T}{T\gamma}|\alpha_1-\alpha^*|$：与 Eq.5 同形，说明初始化偏差 $|\alpha_1-\alpha^*|$ 最坏时被 $\max\{1-\alpha_1,\alpha_1\}$ 界住——Prop 4.1 是初始化后最坏行为的近似紧刻画。

**F29 HMM 设定（§4.2.1）**
环境马尔科夫链 $A_t$，$\mathbb{P}(S_t(X_t,Y_t)>\hat{Q}(1-p)|A_t=a)=:M(p|a)$；假设 $(\alpha_t,A_t)$ 有唯一平稳分布 π 且 $(\alpha_1,A_1)\sim\pi$（≈跑过初始化期）；$\hat{Q},S$ 不随 t 变（如固定训练/校准集的 split conformal）。

**F30 Theorem 4.1 大偏差界（Eq.6, §4.2.2）**
设谱隙 $1-\eta>0$，$B:=\sup_a|\mathbb{E}[\text{err}_t|A_t=a]-\alpha|$，$\sigma^2_B:=\mathbb{E}[(\mathbb{E}[\text{err}_t|A_t]-\alpha)^2]$：
$$\mathbb{P}\Big(\Big|\frac{1}{T}\sum_t\text{err}_t-\alpha\Big|\ge\epsilon\Big)\le 2e^{-T\epsilon^2/8}+2\exp\Big(-\frac{T(1-\eta)\epsilon^2}{8(1+\eta)\sigma^2_B+20B\epsilon}\Big)$$
第一项=负相关（α_t 依赖历史 err）给出的 i.i.d. Hoeffding 级；第二项=Bernstein 马尔科夫链界（环境停留偏态）。且 $B\le C\big(\gamma+\gamma^{-1}\sup_a\mathbb{E}|\alpha^*_{A_{t+1}}-\alpha^*_{A_t}|\big)$（C≤2 当 Q̂ 完美），$\sigma^2_B\le B^2$——**B 由 γ 与漂移速度共同控制，γ 过小反而放大 γ^{-1} 项**。

**F31 Theorem 4.2 近似边际覆盖（Eq.7, §4.2.3）**
设 $|M(\alpha_2|a)-M(\alpha_1|a)|\le L|\alpha_2-\alpha_1|$（L-Lipschitz）且各态有 $\alpha^*_a$：
$$\mathbb{E}[(M(\alpha_t|A_t)-\alpha)^2]\le\frac{L(1+\gamma)}{\gamma}\,\mathbb{E}|\alpha^*_{A_{t+1}}-\alpha^*_{A_t}|+\frac{L}{2}\gamma$$
最优 $\gamma=\big(2\,\mathbb{E}|\alpha^*_{A_{t+1}}-\alpha^*_{A_t}|\big)^{1/2}$ ⇒ $\mathbb{E}[(\cdot)^2]\le L(\sqrt2+1)\sqrt{\mathbb{E}|\text{漂移}|}$——**单期覆盖误差由漂移速度的平方根控制**；γ 最优值随漂移增大而增大。

**F32 pinball 等价（附录 A.1）**
$\beta_t:=\sup\{\beta:Y_t\in\hat{C}_t(\beta)\}$（含 Y_t 最小集对应分位）；pinball 损失 $\rho_\alpha(u)=\alpha u\,(u>0)$、$-(1-\alpha)u\,(u\le0)$；$\ell(\alpha_t,\beta_t)=\rho_\alpha(\beta_t-\alpha_t)$。
在线梯度下降：$\alpha_t-\gamma\,\partial_\alpha\ell=\alpha_t+\gamma(\alpha-\mathbb{1}\{\alpha_t>\beta_t\})=\alpha_t+\gamma(\alpha-\text{err}_t)$——**ACI 恰是 pinball 损失的 OGD**；regret $\text{Reg}_T=\sum\ell(\alpha_t,\beta_t)-\min_\beta\sum\ell(\beta,\beta_t)$，但作者指出 regret 不表达「追踪移动目标」，故另建 §4 理论。

**F33 score 平稳化警告（§5）**
ACI 的覆盖质量由 $\alpha^*_t$ 的时变幅度决定，而 $\alpha^*_t$ 与 $S_t(X_t,Y_t)$ 的 1−α 分位一一对应 ⇒ **分数须近似平稳**。案例：波动率预测中归一化分数 $S_t=|V_t-\hat\sigma^2_t|/\hat\sigma^2_t$ 覆盖良好，去掉归一化的 $\tilde{S}_t=|V_t-\hat\sigma^2_t|$ 覆盖大幅摆动（可用更大 γ 部分补救）。

## ⑤ 实现伪代码 / 参考代码

ACI 主循环（论文 §2 + §2.2 波动率案例拼装，缩进式）：

    # 初始化
    alpha_t = alpha                      # α1=α（论文实验设定）
    S_hist = []                          # 历史分数
    for t in 1..T:
        S_t = score(x_t, y)              # 任一分数（须平稳化/归一化，F33）
        S_hist.append(已知 y 的历史分数)   # 滚动窗可加衰减
        Q = quantile(S_hist, 1 - alpha_t) # 滚动窗版: inf{x: mean(S_r<=x)>=p}
        C_t = {y: S_t(x_t,y) <= Q}
        # —— 结算后 ——
        err_t = 1 if y_t not in C_t else 0
        alpha_t = alpha_t + gamma * (alpha - err_t)   # Eq.2

- γ=0.005 起步（论文实验值）；漂移大调大（F29/F31 原则）。
- 论文 R 包：AdaptiveConformal（arXiv:2312.00448, CRAN）【已核 API 元数据】；Python 侧 MAPIE 2026 宣传语称新增 adaptive conformal 方法【转述未验证】。
- GARCH 案例的滚动窗 quantile（Eq. in §2.2）：Q̂_t(p)=inf{x: (1/1250)Σ_{r=t-1250}^{t-1} 1{S_r≤x} ≥ p}；局部覆盖诊断 localCov_t=1−(1/500)Σ err_r（±250 窗）。

## ⑥ 对本项目落地点（预测卡 L0 线）

**a. 账本时序性正缺的这一件（与回合 1 F18 衔接）**：F18 是「批内加权分位」（权重管样本新旧），ACI 是「跨期调 α_t」（在线反馈管目标）——二者正交可叠加：内层 Q̂_t 用滚动窗/0.99^衰减分数，外层 α_t 按 Eq.2 每局更新。L0 每局结算天然产生 err_t，零额外成本。
**b. γ 预算**：γ=0.005 起步；α_t∈[−γ,1+γ] 自锁（F27），冷启动期用 Prop 4.1 弱保证（T 期平均收敛），单期别吹「这局 90% 覆盖」（Thm 4.2 只给平方平均）。
**c. 分数归一化强制项（F33）**：3 路判词分数若不归一（各路波动尺度不同），ACI 也救不回覆盖——各路分数先除以该路历史残差尺度（≈F9 的 u(x)）再进账本。
**d. α*_t 轨迹=漂移仪表盘**：Eq.2 的 α_t 就是 α*_t 的在线估计，账本把 α_t 曲线画出来即得「环境漂移速度」免费诊断。
**e. 失效条件**：Y_t 延迟揭示不支持（论文 §7 自认）；score 非平稳且 γ 救不回时失效；平稳性假设在冷启动不成立（用 Prop 4.1 而非 Thm 4.1/4.2）。
**f. 铁律合规**：ACI 只动「区间宽度/覆盖率诊断」，不动研判信号；玄学臂同机制跑自己的 α_t^玄学 作消融。

## ⑦ 发散联想（未经验证猜想）
1. 频域视角：Eq.2 是一阶低通滤波（err 序列 → α_t），γ=通带宽度；「环境漂移频谱超出 1/γ 的成分必然追不上」——可把 L0 账本 err_t 做谱分析来反推合适 γ【未经验证猜想】。
2. 玄学臂自证无信号：让玄学路跑自己的 α_t^玄学——若无信号，其 err_t ~ Bernoulli(α) 噪声，α_t 应在 α±γ 波动带内徘徊不漂移；α_t 持续单调漂移反而是「玄学有结构」的反常信号（结论仍只能是娱乐参考）【未经验证猜想】。
3. Reg_T 当账本指标：记 pinball regret 序列，Reg_T 不增=聚合目标追踪健康【未经验证猜想】。
4. Eq.3 的 0.95 加权与 F18 的 0.99^{n-i+1} 衰减是同族——可统一成一个「衰减率超参」跨层共享【未经验证猜想】。
5. Multi-LLM ACI（2602.01285）疑似把 ACI 用到多 LLM 置信融合——正是 3 路判词聚合的 conformal 化路线，回合 3+ 优先全文【未验证，仅元数据】。

## ⑧ 存疑处
1. AgACI 不在本文（本文只有 Eq.3 加权变体）；AgACI/FACI/SOCI 等后续变体留待查证 Bhatnagar et al. 或 2412.19318【如实标注】。
2. Thm 4.1/4.2 的平稳分布假设（(α_1,A_1)~π）冷启动不成立，L0 初期只能用 Prop 4.1【已核假设原文】。
3. C≤2 常数的具体条件（M(·|a) 二阶 Taylor 展开存在）未抄全证明【未细读 A.7/A.8】。
4. γ=0.005 是波动率/选举案例的经验值，对「游戏对局」尺度是否适配未验证【转述】。

---

# 回合 2（续）：arXiv:1706.04599v2 — Guo, Pleiss, Sun, Weinberger, On Calibration of Modern Neural Networks

## ① 元数据
- ICML 2017；arXiv:1706.04599，本次精读 v2（2017-08-03，含补充材料 S1-S4）【已核 html 页内标记】
- 精读覆盖：§2 定义全、§3、§4.1（histogram/isotonic/BBQ/Platt）、§4.2（matrix/vector/temperature scaling）、§5 结果、附录 S1（ECE 统计意义）、S2（TS 熵推导）；S3/S4 表格图未细读【如实标注】

## ② 全文获取路径
- arxiv.org/html/1706.04599 → 200（328KB 官方 HTML v2）【已核】
- 缓存：_cache-K-1706.04599.txt（64KB/2136 行）+ cache/K2-1706.04599-batchextract.md【已核】

## ③ 核心贡献（3 句）
1. 实证现代深度网络普遍过自信（ECE 4-10%），且失准随容量/BN/少 weight decay 增大；NLL 与 0/1 loss 解耦——网络「以概率建模换命中率」。
2. 给出校准方法谱系：histogram binning → isotonic（其严格推广）→ BBQ（贝叶斯平均）→ Platt（参数）→ matrix/vector scaling → temperature scaling（单参数 Platt 特例）。
3. 温度缩放以单参数 T 在不动 argmax（不伤 accuracy）前提下达到最佳校准，且等于「熵最大化+logit 平衡约束」的唯一解。

## ④ 公式清单

**F34 完美校准（Eq.1）**
$\mathbb{P}(\hat{Y}=Y\mid\hat{P}=p)=p,\ \forall p\in[0,1]$（连续 P̂ 有限样本不可算 → 分桶经验化）。

**F35 箱精度/箱置信 + ECE/MCE（Eq.3/5, §2）**
$B_m$=置信落入 $I_m=((m-1)/M,\,m/M]$ 的样本集；$\text{acc}(B_m)=\frac{1}{|B_m|}\sum_{i\in B_m}\mathbb{1}(\hat{y}_i=y_i)$（无偏一致）；$\text{conf}(B_m)=\frac{1}{|B_m|}\sum_{i\in B_m}\hat{p}_i$。
$$\text{ECE}=\sum_{m=1}^{M}\frac{|B_m|}{n}\,\big|\text{acc}(B_m)-\text{conf}(B_m)\big|,\qquad \text{MCE}=\max_m\big|\text{acc}(B_m)-\text{conf}(B_m)\big|$$
NLL（Eq.6）：$\mathcal{L}=-\sum_i\log\hat{\pi}(y_i|x_i)$；期望意义下 NLL 最小 ⟺ 恢复真条件分布。

**F36 ECE 的 Riemann-Stieltjes 解释（附录 S1）**
$\mathbb{E}_{\hat{P}}|\mathbb{P}(\hat{Y}=Y|\hat{P}=p)-p|=\int_0^1|\cdot|\,dF_{\hat{P}}(p)\approx\sum_{m=1}^{M}|\cdot|\,\mathbb{P}(\hat{P}\in I_m)$——**ECE 是失准积分的 M 项 Riemann-Stieltjes 和**；n 大时 |acc−conf| 逼近逐点真差。这是「分桶数 M 依据」的本文答案；严格的 M/N 误差界不在此文【如实标注，疑为 Kumar et al. 2019，待后续回合核】。

**F37 Histogram binning（Eq.7, §4.1）**
$$\min_{\theta_1,\ldots,\theta_M}\ \sum_{m=1}^{M}\sum_{i=1}^{n}\mathbb{1}(a_m\le\hat{p}_i<a_{m+1})(\theta_m-y_i)^2$$
解=各箱正类频率 θ_m（等宽或等频分箱）。

**F38 Isotonic regression（§4.1）**
同 F37 损失，但**联合优化**箱边界与箱值，约束 $0=a_1\le\cdots\le a_{M+1}=1$、$\theta_1\le\cdots\le\theta_M$（分段常数单调函数 f，$\hat{q}_i=f(\hat{p}_i)$）——histogram binning 的严格推广；多类 one-vs-all 扩展时论文实测会**伤 accuracy**（label shift 副作用）【转述 §5 结论】。

**F39 BBQ 贝叶斯分箱（§4.1）**
$\mathbb{P}(\hat{q}_{te}|\hat{p}_{te},D)=\sum_{s\in\mathcal{S}}\mathbb{P}(\hat{q}_{te}|\hat{p}_{te},S{=}s,D)\,\mathbb{P}(S{=}s|D)$，$\mathbb{P}(S{=}s|D)=\frac{\mathbb{P}(D|S{=}s)}{\sum_{s'}\mathbb{P}(D|S{=}s')}$；θ_m 置 Beta 先验得闭式边际似然——把「每个分箱方案」当模型做 BMA。

**F40 Platt scaling（§4.1）**
$\hat{q}_i=\sigma(az_i+b)$（二分类 logit 过逻辑回归）；a,b 用验证集 NLL 优化，**网络参数冻结**。

**F41 Matrix/Vector scaling（Eq.8, §4.2）**
$\hat{q}_i=\max_k\sigma_{\rm SM}(\mathbf{W}\mathbf{z}_i+\mathbf{b})^{(k)}$，$\hat{y}'_i=\argmax_k(\mathbf{W}\mathbf{z}_i+\mathbf{b})^{(k)}$；W,b 按 NLL 优化；参数量 O(K²)→vector scaling 限 W 为对角（O(K)）。

**F42 Temperature scaling（Eq.9, §4.2）——本项目主力**
$$\hat{q}_i=\max_k\ \sigma_{\rm SM}(\mathbf{z}_i/T)^{(k)},\qquad T>0$$
T>1 软化（升熵）；T→∞ ⇒ 1/K（最大不确定）；T=1 复原；T→0 ⇒ 点质量。**T 不改 argmax ⇒ 不影响 accuracy**（类预测不变）；T 按验证集 NLL 优化（1 参数）。§5 实测：TS 在视觉任务全胜、NLP 打平；**vector scaling 学出的 W 近似常数×I——失准本质低维**。实证规模：验证集 5000（CIFAR）~25000（ImageNet）【转述 §5】。

**F43 TS=熵最大化唯一解（附录 S2 Claim 1 + 证明）**
$$\max_q\ -\sum_{i,k}q(\mathbf{z}_i)^{(k)}\log q(\mathbf{z}_i)^{(k)}\quad \text{s.t.} \quad \sum_k q(\mathbf{z}_i)^{(k)}=1\ \forall i,\qquad \sum_i z_i^{(y_i)}=\sum_{i,k}z_i^{(k)}q(\mathbf{z}_i)^{(k)}$$
（约束=平均真类 logit=平均加权 logit）。Lagrange：$\partial L/\partial q=-nK-\log q+\lambda z+\beta=0$ ⇒ $q(z_i)^{(k)}=e^{\lambda z_i^{(k)}}/\sum_j e^{\lambda z_i^{(j)}}$，**T=1/λ** ∎。

## ⑤ 实现伪代码 / 参考代码

缩进式（TS 主力路径）：

    # 校准（每路判词各自做）
    logits = [log_odds(p_i) for i in val]      # z_i，由判词概率反推
    T = argmin_T NLL(softmax(z_i/T), y_i)      # 1-D 优化（scipy.optimize.minimize_scalar）
    # 部署
    q_i = softmax(z_i / T).max()               # argmax 不变
    # ECE（M=15 等宽桶，论文配置）
    ECE = sum(|B_m|/n * |acc(B_m)-conf(B_m)|)

- sklearn：isotonic regression = sklearn.isotonic.IsotonicRegression(y_min=0, y_max=1, out_of_bounds='clip')；Platt = sklearn.linear_model.LogisticRegression on z。【转述·包名常规用法】
- netcal / calibration 库（PyPI）存在【转述未验证】；MAPIE 的 TopLabelCalibrator（v1 改名）做 top-label 校准【已核 v1 release notes】。
- 失准诊断四件套（论文 §3）：ECE 直方图（reliability diagram）、MCE、NLL-vs-error 训练曲线、capacity/BN/wd 消融。

## ⑥ 对本项目落地点（预测卡 L0 线）

**a. 3 路判词校准主力=TS（F42/F43）**：每路判词 p → logit z=ln(p/(1-p))，按该路历史账本 1-D 优化 T_q，输出 q=σ(z/T_q)；argmax 不变 → 只改置信不改方向，完全符合「LLM 仅校准角色」与「思路非答案」。**样本量**：TS 仅 1 参数、按 NLL 优化，论文未给显式样本量公式【如实标注】；对照其验证集规模（≥5000）与 F13 波动学（±0.05 需 102 条），200 条门禁开 TS 属「可试但波动大」，建议 ≥500 条再定版【推算】。
**b. isotonic 在 200 条规模不推荐**：非参数多自由度+多类 one-vs-all 会伤 accuracy（§5 实测）；等账本 ≥1000 条再评估【转述+推算】。
**c. ECE 分桶定版（F35/F36）**：M=15 等宽桶（论文配置）；200 条=13 条/桶只能看趋势（F13：桶级 ±0.05 需 ~102 条/桶，总 1530 条）【推算】；ECE 是 Riemann-Stieltjes 近似，M 大桶稀→方差涨，M 小→偏差涨，L0 先 M=8。
**d. NLL 与命中率解耦警告（§3）**：判词「说对了」≠「概率对」——账本必须独立记 Brier/NLL 与命中率，防止「命中率好看→概率被忽视」的重演。
**e. 与 conformal 的分工**：TS 校准的是「置信数值口径」（ECE↓），conformal 校准的是「集合覆盖」（coverage↑）——两者正交，L0 全都要：TS 在前（数值可信）→ conformal 在后（覆盖可信）。
**f. 失效条件**：训练/校准/测试须同分布（§4 明设）；分布漂移时 T_q 过期 → 接 ACI 外环或定期重估 T_q。

## ⑦ 发散联想（未经验证猜想）
1. 温度化 opinion pool：对每路 log-odds 先 T_q 缩放再 log-op pool——「校准在前、聚合在后」的标准流水线，回合 3/4 opinion pool 时对照 Satopää extremization（extremization≈T<1 的全局温度！）【未经验证猜想】。
2. BBQ 的 BMA 思想移植 3 路聚合：把「每种聚合方案」当分箱方案做贝叶斯平均，天然含方案不确定性【未经验证猜想】。
3. F43 的「logit 平衡约束」可推广成聚合约束：Σ路 z^(路)·q^(路) = Σ真值 z——聚合权重的熵最大化推导骨架【未经验证猜想】。
4. ECE 分桶 + F22 p 值粒度合并诊断：桶内 acc-conf 差的符号一致性检验（连符号 run test）当「系统性过/欠信」告警【未经验证猜想】。
5. vector scaling≈TS 的实证（失准低维）暗示：3 路判词的联合失准大概率也落在 1-2 维子空间——先试每路单温度，别上矩阵【未经验证猜想】。

## ⑧ 存疑处
1. TS 样本量公式论文未给【已核未找到】；严格 ECE 估计误差界（队长提示的 bins 依据）不在此文，疑为 Kumar et al. 2019 (arXiv:1909.10155)「Verified Uncertainty Calibration」——回合 3 核实【待验证】。
2. 多类 TS 对「路间相关」的判词（同局 3 路看同一盘）是否仍 argmax 不变未验证——TS 逐路独立做，不跨路【推算】。
3. Guo 实测均基于图像/文档分类；「语言概率判词」的 logit 尺度是否可比未验证【如实标注】。
4. BBQ 计算量随方案空间爆炸，200 条规模不可行【推算】。

---
（回合 2 完 · 2026-09-11）

---

# 回合 3：arXiv:2602.01285 — Noh, Lee, Kim, Song, Multi-LLM Adaptive Conformal Inference（MACI）

## ① 元数据
- Multi-LLM Adaptive Conformal Inference for Reliable LLM Responses；Kangjun Noh, Seongchan Lee, Ilmun Kim, Kyungwoo Song
- arXiv:2602.01285，首发 2026-02-01；**arXiv updated 2026-09-11（本回合当天）**，下载为当日最新官方 HTML（815KB）【已核 API+页内】
- 精读覆盖：§3 记号、§4 全（4.1 oracle/4.2 ACI 校准+两定理/4.3 集成）、附录 A.1 Lemma 1、B.1 集成目标、§5.1 协议、§5.3 协变量偏移；§5.2 详细数字表与附录 D/E 未细读【如实标注】

## ② 全文获取路径
- arxiv.org/html/2602.01285 → 200（815KB）【已核】；缓存 _cache-K-2602.01285.txt（130KB/3103 行）+ cache/K3-2602.01285-batchextract.md【已核】
- 配套：Satopää extremization 原始文 arXiv:1501.06943——v2 无官方 HTML 且 ar5iv 空壳，**v1 有官方 HTML**（380KB）成功；v1 标题 Modeling Probability Forecasts via Information Diversity，v2 才改名 Combining Probability Forecasts and Understanding Probability Extremizing through Information Diversity（同文两阶段）【已核】；缓存 _cache-K-1501.06943.txt（83KB/1645 行）+ cache/K3-1501.06943-batchextract.md【已核】

## ③ 核心贡献（3 句）
1. 把「多 LLM 事实性打分 + 组条件 conformal 阈值」做成 MACI：M 个 LLM 各自给 verbalized factuality-score，线性加权集成（权重按「TPR 容许下最小 FPR」优化），再按组（Mondrian）校准 conformity 分数 E_i 的分位数阈值，保证组内有限样本覆盖。
2. 三定理：Thm 1 边际覆盖（含 1/(n+1) 上界）、Thm 2 组条件覆盖、Thm 3 保留率差 ≤ C'·MSE^{β/(β+2)}（margin 条件）——把「集成 MSE 多小」与「过滤效率多好」定量挂钩。
3. 实证 M=3（Llama-3.3-70B / Qwen-2.5-72B / DeepSeek-V3）——与本项目 3 路判词同构；协变量偏移下 MACI-DRE（密度比重采样）修正组间失覆盖。

## ④ 公式清单

**F44 组条件覆盖目标（Eq.1, §3, Mondrian 式）**
grouping g(P,C)→{1..K}，要求 $\mathbb{P}(F_{n,\alpha}(P_{n+1},C_{n+1})\subseteq A_{n+1}\mid g(P_{n+1},C_{n+1})=k)\ge 1-\alpha$ 对每组 k（A_i=真断言集）。

**F45 oracle 过滤规则与精确覆盖随机化（§4.1）**
$p^*(P,c):=\mathbb{P}(y=1\mid P,c)$；按 oracle 分数降序 $\pi_i$，累积乘积 $\Pi_k=\prod_{j=1}^{k}p^*(c_{i,\pi_i(j)})$；
截止 $K^*_i(\tau):=\max\{k:\Pi_k\ge\tau\}$（$\tau$=目标覆盖，保守）；边界随机化 $\gamma_i(\tau)=\frac{\Pi_{K^*}-\tau}{\Pi_{K^*}-\Pi_{K^*+1}}$，$U_i\sim\mathrm{Unif}(0,1)$，$U_i\le\gamma$ 时多保留一名——精确覆盖。

**F46 文档级 conformity 分数 E_i 与 Thm 1/2（§4.2）**
$$E_i=\inf\{\tau: F(\hat{p},\tau,U_i;P_i,C_i)\subseteq A_i\}$$（使保留集全真的最小阈值；Lemma 1：$\{E_i\le\tau\}\iff\{F(\hat{p},\tau)\subseteq A_i\}$）。
Thm 1（可交换）：$\mathbb{P}(F_{n,\alpha}\subseteq A_{n+1})\ge 1-\alpha$；E_i 几乎必然不同时 $\le 1-\alpha+\frac{1}{n+1}$。
组条件：$\hat{Q}^{(k)}_{1-\alpha}=\mathrm{Quantile}(\{E_i:i\in\mathcal{I}_k\},1-\alpha)$；Thm 2：组内覆盖 $\ge 1-\alpha$（各组用自己的 n_k，小组成员保守但有效）。

**F47 Thm 3 保留率差与 MSE（margin 条件, §4.2）**
margin：$\mathbb{P}(|p^*(P,c)-\tau|\le\epsilon)\le\mathfrak{C}\epsilon^\beta$（β=阈值附近分离度）；
$$\Delta=|R(\hat{p},\tau)-R(p^*,\tau)|\le\frac{\mathbb{E}[(\hat{p}-p^*)^2]}{\epsilon^2}+\mathfrak{C}\epsilon^\beta\ \Rightarrow\ \Delta\le\mathfrak{C}'\big(\mathbb{E}[(\hat{p}-p^*)^2]\big)^{\frac{\beta}{\beta+2}}$$
**保留效率由估计 MSE 的 β/(β+2) 次多项式控制**——校准（降 MSE）直接买到过滤效率。

**F48 保留率分解与代理目标（Eq.2/3/4, §4.3）**
保留率 $R(p,\tau):=\mathbb{P}(c\in F_\tau(p;P,C))$；分解
$$R(p,\tau)=\rho\cdot\mathrm{TPR}(p,\tau)+(1-\rho)\cdot\mathrm{FPR}(p,\tau),\qquad \rho:=\mathbb{P}(y=1)$$
TPR 与 FPR 不可同时优化 → 约束 $\mathrm{TPR}\ge 1-\delta$（δ∈(0,1)）下最小化 FPR：
$$p^\star=\argmin_p\ \mathbb{E}[\mathrm{FPR}(p,\tau_{p,\delta})]$$
其中 $\tau_{p,\delta}$=真类分数的 δ 分位。

**F49 多 LLM 集成与经验优化（§4.3 + 附录 B.1）**
集成：$p_{\rm ens}(P,c;w)=\sum_{m=1}^{M}w_m\,p_m(P,c)$（线性加权，w≥0、Σw=1）。
经验版（hold-out $\mathcal{D}_{\rm opt}$，$N_1$=真断言总数）：
$\widehat{\tau}_{p,\delta}=\inf\{t:\frac{1}{N_1}\sum\mathbb{1}\{p(P_\ell,c)\le t\}\ge\delta\}$（真类经验 δ 分位）；
$\widehat{\mathrm{FPR}}_\ell(p,\tau)=\frac{|\{c\in F_\tau: y=0\}|}{1\vee|\{c: y=0\}|}$；
$$w^\star=\argmin_w\ \frac{1}{n_{\rm opt}}\sum_\ell\widehat{\mathrm{FPR}}_\ell(p_{\rm ens}(\cdot;w),\ \widehat{\tau}_{p_{\rm ens},\delta})$$
动机：直接对 oracle 拟合不可行（黑盒+二值标签致过自信），代理目标（控 FPR 保 TPR）实测同步降 MSE。

**F50 MACI-DRE 协变量偏移修正（§5.3, Tibshirani 2019 密度比）**
$r(x)=p_X^{(t)}(x)/p_X^{(s)}(x)$（轻量分类器估测试/校准协变量密度比）→ 按 $\hat{r}$ 重采样校准集 → 原管线上重跑。实测（MedLFQA，80% 目标）：MACI 组覆盖 0.65-0.77（欠/过覆盖并存），DRE 修正到 0.72-0.84 且保留率可比【已核 Table 2】——**与回合 1 F17 加权 conformal 同族思想的工程化**。

## ⑤ 实现伪代码 / 参考代码

缩进式（MACI 主循环骨架，Algorithm 1+2 拼装）：

    # 校准（按组 k）
    for i in calib: E_i = min_tau{ F(p_ens, tau) 全真 }   # 文档级分数
    Qhat_k = quantile({E_i: group=i 的}, 1-alpha)
    # 部署：claim 保留条件 = 组 k 的 F(p_ens, Qhat_k) 过滤
    # 权重离线优化（附录 B.1）
    for w in simplex(3):   # 网格/投影梯度
        loss(w) = mean_l FPR_hat_l(p_ens(.;w), tau_hat(p_ens, delta))

- E_i 的计算=沿 τ 单调性二分（F(τ) 随 τ 增大收缩，保留集全真的最小 τ）。
- 无官方代码库（正文未给出）【如实标注】；组件级替代：MAPIE SplitConformalClassifier（prefit）+ 自写 E_i。

## ⑥ 对本项目落地点（预测卡 L0 线）

**a. 3 路判词权重不用拍脑袋（F49）**：MACI 的 w*=argmin 经验 FPR（TPR≥1−δ 约束）直接照搬——账本上对 (w1,w2,w3) 单纯形网格搜索即可（3 维无维灾）；δ=0.1 起步。W2 的 ablation.cjs 现有「中位聚合 vs 最佳单路」可加此款。
**b. 出卡阈值=组条件 conformal（F44/F46）**：按局类型分组校准 E_i 分位数；组内 n_k 达标才启用组阈值（F13：组内 ±0.05 需 ~102 条），小组退回全局阈值——Mondrian 分组与「200 条前只记不评」自洽。
**c. 「校准→集成→conformal」流水线的理论钩子（F47）**：单路 TS（回合 2 F42）降 MSE → 集成 MSE 更低 → retention/过滤效率按 β/(β+2) 次幂改善——三段式各有定量依据，不是堆砌。
**d. 漂移预案（F50）**：组覆盖异常时上 DRE（密度比重采样），与回合 1 F17/F18、ACI 外环同一工具箱。
**e. 失效条件**：全文假设 exchangeability（§3 明写）；E_i 需要每局结算后的完整标注；M 路分数必须同尺度（verbalized 概率 [0,1] 直接入集成，与 W2 的 implied_prob 口径一致）。
**f. 铁律合规**：MACI 是「过滤+覆盖保证」框架，输出的是保留/不保留与覆盖率，不是研判信号；玄学臂不可进 p_ens（只可做第 4 路消融对照）。

## ⑦ 发散联想（未经验证猜想）
1. MACI 的 E_i（最小全真阈值）思想移植预测卡：「一条预测至少要多高的置信才敢出卡」本身可用 conformal 校准——出卡门槛 E 分数化，账本记 E 轨迹【未经验证猜想】。
2. F49 的代理目标（控 FPR 保 TPR）映射为「控误报保召回」：预测卡侧=「少出废卡、不漏真机会」的显式双约束，权重优化替掉人工调门【未经验证猜想】。
3. 玄学臂可跑 MACI 全流程但 w_玄学=0 固定——「有它在册但零权重」的消融形态，比完全剔除更能暴露其分数与真值的相关结构【未经验证猜想】。
4. Theorem 3 的 β（margin）本身可从账本估：真值分数在阈值附近的密度——β 小说明「难度连续分布」，此时集成收益低，该把力气花在单路校准【未经验证猜想】。

## ⑧ 存疑处
1. arXiv updated 2026-09-11（本回合当天）——论文可能刚更新，本次精读基于当日最新 HTML，版本差异未比稿【如实标注】。
2. Algorithm 1/2 的伪码正文未逐行抄（正文以文字描述为主，伪码框提取有损）——E_i 二分实现细节为我的重构【转写标注】。
3. Appendix E「Modeling Joint Probability」「Conformity Score Variants」未读——与 3 路联合建模相关，后续可补【如实标注】。
4. MACI 假设每组校准集可交换；「局类型」分组后的组内样本量是否够（F13 需 ~102/组）是 L0 的现实约束【推算】。

---

# 回合 3（续）：arXiv:1501.06943v1 — Satopää, Brill, Foster, Ungar — 偏信息框架下的概率极端化

## ① 元数据
- v1 标题：Modeling Probability Forecasts via Information Diversity（2015-01-27）；v2 改名 Combining Probability Forecasts and Understanding Probability Extremizing through Information Diversity【已核 API+页面】
- 作者：Ville A. Satopää（Wharton）、Richard E. Brill、Lyle H. Ungar 等
- 正式版姊妹篇：Satopää et al. 2014 IJF logit 模型（Combining multiple probability predictions using a simple logit model）**无 arXiv 版**，队长点名的 log-odds 公式原始出处待期刊途径；同族 arXiv：1406.2148（信息多样性建模）、1506.06405（实值版）、2111.03153（Neyman & Roughgarden，J 笔记 d=√3 出处）【已核 API 元数据，全文未读】
- 精读覆盖：§3 全（高斯偏信息模型）、§4 全（extremizing 四小节）、§5.1-5.3（revealed aggregator + GJP 实证 + Murphy 分解）；§1-2、附录证明主体未细读【如实标注】

## ② 全文获取路径
- v2：ar5iv 空壳（5.7KB→147B 文本）【已核失败】；**v1 官方 HTML 380KB 成功**【已核】
- 缓存 _cache-K-1501.06943.txt（83KB/1645 行）+ cache/K3-1501.06943-batchextract.md【已核】

## ③ 核心贡献（3 句）
1. 用「信息池高斯白噪声」建模预测者间的信息重叠（δ_i=各自信息量、ρ_ij=重叠量），证明**聚合的最优解不由预测值唯一决定，而由信息结构决定**（例 3.1：同样 2/3 的预测，重叠→2/3、独立→4/5）。
2. 定义 probit 极端化比 α=Φ⁻¹(q)/Φ⁻¹(p)，证明 **Prop 4.1：α ~ Cauchy(x₀,γ) 且 x₀≥1**——非平凡问题上极端化严格更可能有益；compound symmetry 下闭式 **x₀=N/(1+(N−1)λ)·√((1−δ)/(1−δ′))**：路数 N↑、信息量 δ↑、重叠 λ↓ → 更强极端化。
3. 给出可实践的 revealed aggregator p″_cs（Eq.10）及其**非随机极端化系数（Prop 5.1）**，GJP 超预测者实证 BS 0.132→0.123 全胜平均类聚合；文中并给出 **Murphy Brier 三分解完整公式**。

## ④ 公式清单

**F51 高斯偏信息模型与预测生成（§3.2 + Eq.7）**
信息池 S=[0,1] 白噪声，$\mathrm{Cov}(X_B,X_{B'})=|B\cap B'|$；$A:=\{X_S>0\}$（先验 P(A)=1/2）；预测者 i 观测 $B_i$（信息量 $\delta_i=|B_i|$，重叠 $\rho_{ij}=|B_i\cap B_j|$）：
$$p_i=\mathbb{P}(A|\mathcal{F}_i)=\Phi\Big(\frac{X_{B_i}}{\sqrt{1-\delta_i}}\Big)\quad(\text{Eq.7})$$
边际密度 $m(p_i|\delta_i)$：δ=1/2 均匀、δ>1/2 双峰（有信息）、δ→0 收缩到 1/2（无信息退出）。
相干性（Prop 3.3）：$\Sigma_{22}\in\mathrm{COR}(N)=\mathrm{conv}\{xx':x\in\{0,1\}^N\}$（关联多面体，2^N 顶点）。

**F52 probit 极端化比与 Cauchy 定律（§4.2 + Prop 4.1）**
def：q 极端化 p ⟺ Φ⁻¹(q) 同侧更远；$\alpha(q,p):=\Phi^{-1}(q)/\Phi^{-1}(p)$；probit 池 $p_{\rm probit}=\frac{1}{N}\sum_i\Phi^{-1}(p_i)$（对比 log 池 $p_{\rm log}=\frac{1}{N}\sum_i\log\frac{p_i}{1-p_i}$，两者实测几乎同分）。
**Prop 4.1：α 服从 Cauchy(x₀,γ)，位置参数 x₀≥1（各 δ_i 全等时取等号）⇒ $\mathbb{P}(\alpha>1|\Sigma_{22})>1/2$**——「往极端化方向小扰动，改进概率严格大于变差概率」，解释了极端化在真实预测赛中的普遍收益。

**F53 零重叠极端形态（§4.3）**
零重叠（$|B_i\cap B_j|=0$）：oracle $p'=\Phi\Big(\frac{\sum_i X_{B_i}}{\sqrt{1-\sum_i\delta_i}}\Big)$——分子=加权投票、分母=按群体总信息极端化；完全重叠（$B_i=B_j$）→ 无需极端化（平均最优）。**信息重叠 1→0，最优聚合从平均连续变形到投票/极端化**——极端化强度是信息重叠的函数，不是拍脑袋超参。

**F54 compound symmetry 下的极端化系数（Eq.8 + §4.4）**
$|B_i|=\delta$、$|B_i\cap B_j|=\lambda\delta$（λ=重叠比例）；相干条件（Eq.8）：$\lambda\delta\in[\max\{\frac{N-\delta^{-1}}{N-1},0\},1]$；
**极端化比 Cauchy 位置**：$x_0=\frac{N}{1+(N-1)\lambda}\sqrt{\frac{1-\delta}{1-\delta'}}$（$\delta'=|\cup_i B_i|$=群体总信息）——**x₀ 随 N↑、δ↑ 而增，随 λ↑ 而减**；信息总量 δ′ 与信息多样性是极端化的两个独立决定因子（论文明说）。

**F55 revealed aggregator 与闭式极端化系数（Eq.10 + Prop 5.1, §5.2）**
$$p_{cs}''=\Phi\Big(\frac{\frac{1}{(N-1)\lambda+1}\sum_{i=1}^{N}X_{B_i}}{\sqrt{1-\frac{N\delta}{(N-1)\lambda+1}}}\Big),\qquad X_{B_i}=\Phi^{-1}(p_i)\sqrt{1-\delta}$$
**Prop 5.1：**（i）probit 极端化比 $\alpha(p_{cs}'',p_{\rm probit})=\gamma\sqrt{1-\delta}/\sqrt{1-\delta\gamma}$，其中 $\gamma=\frac{N}{(N-1)\lambda+1}$（**非随机闭式——这就是「最优极端化参数」**）；（ii）只要 $p_i$ 不全等就严格极端化；（iii）可越出单点预测凸包。
附录 B：对称信息下 δ、λ 可由历史预测 MLE 估计（更好信息→离 1/2 更远；高重叠→预测相似）。

**F56 Murphy Brier 三分解（§5.2 原文，任务书第三项）**
BS $=\mathrm{REL}-\mathrm{RES}+\mathrm{UNC}$
$$=\frac{1}{K}\sum_{j=1}^{J}n_j(f_j-o_j)^2-\frac{1}{K}\sum_{j=1}^{J}n_j(o_j-\bar{o})^2+\bar{o}(1-\bar{o})$$
变量：K=事件数；聚合器输出离散值 $f_j$（J 个）；$n_j$=输出 f_j 的次数；$o_j$=对应经验频率；$\bar{o}$=总基率。解读：REL 低=校准好；RES 高=有分辨率（自信且有用）；UNC=基率 Brier=不使用预测的最好成绩下限。

**GJP 实证（§5.3）**：44 超预测者×123 事件（23 发生）；p=0/1 截断至 0.001/0.999；Table 1：$\bar{p}$ BS=0.132（REL .026/RES .045）→ $p_{\rm log}$ 0.128 → $p_{\rm probit}$ 0.128 → $p_{cs}''$ **0.123**（REL .020/RES .049）——极端化同时改善校准（REL↓）与分辨率（RES↑）。

**与 J 笔记 P5/P6 的对齐（本笔记完成对齐义务）**
1. J/AIA 的 log-odds extremization（logit 尺度乘 d）与本文 probit 尺度乘 α 是姊妹形式：同构=「均值→线性变换→链接函数反解」；Guo Platt σ(az+b)（回合 2 F40）=同族参数化——**J G.2 的「Platt=广义 extremization」在 probit 侧对应 F55 的 α 缩放**【已核两边公式，尺度差异如实标注：logit vs probit，实测两池打平 0.128】。
2. J 笔记猜想「d 应随 n 增长」**获得理论支撑**：F54 的 x₀∝N/(1+(N−1)λ)——N↑ 极端化应加强；λ↓（路间信息独立）同向。Neyman-Roughgarden 的固定 d=√3 是「无重叠估计时的保守折中」，本文给出按 λ 定 d 的结构化替代【对齐+推论，λ 估计待验证】。

## ⑤ 实现伪代码 / 参考代码

缩进式（F55 revealed aggregator，N 路判词聚合）：

    # 输入: p[1..N] 各路概率, delta=平均信息量(可拟合), lam=重叠比例
    #       (lam 可用 N 路历史判词相关矩阵均值近似——W2 ablation.cjs 已产出相关矩阵)
    x_i = probit(p_i) * sqrt(1 - delta)          # = X_{B_i}
    gamma = N / ((N-1)*lam + 1)
    z = gamma * mean(x_i)                         # 分子：γ 加权投票
    denom = sqrt(1 - N*delta*gamma/N)             # = sqrt(1 - delta*N/((N-1)lam+1)·...) 见 Eq.10
    p_cs = Phi(z / denom)                         # 极端化聚合
    # 另一路径（AIA Eq.2 同款, logit 尺度）: p = sigmoid(d * mean(logit(p_i))), d≈gamma

- probit(p)=scipy.stats.norm.ppf；Phi=norm.cdf。p=0/1 截断 0.001/0.999（论文原设定）。
- δ、λ 的 MLE：附录 B 给了对称信息下的估计式（本文只给了框架，实操可用「预测离 1/2 的平均距离估 δ、两两相关估 λ」的矩估计替代）【转写标注】。

## ⑥ 对本项目落地点（预测卡 L0 线）

**a. 3 路聚合公式定版候选（F55+F49 组合）**：λ̂（三路判词相关矩阵均值，W2 已有）→ γ̂=3/(1+2λ̂) → 两步走：先 MACI 式优化权重 w*（F49），再在聚合分上做 γ 缩放极端化。λ̂≈0（三路真独立）→ γ̂≈3 强极端化；λ̂≈1（同源复读）→ γ̂≈1 不动。**极端化强度从「拍脑袋 √3」变成「账本估计的 λ̂ 的函数」**。
**b. Murphy 分解进账本（F56）**：每 30 局算 REL/RES/UNC 三件套——REL↑ 查校准（TS 没做好）、RES↓ 查信息量（判词没区分度）、对照 UNC 基率判断「聚合到底比瞎猜基率好多少」。ECE 只是 REL 的分桶近似，RES 是账本现有指标缺失的一角。
**c. 与 conformal 的接口**：p_cs″ 或 w* 集成分数直接当 conformal 的分数输入（回合 1 F2/F3）——聚合与校准两层解耦，各用各的定理。
**d. 失效条件**：Gaussian 模型假设（先验 P(A)=1/2、probit 尺度）；单事件无历史时 λ 无法估计（退回 d=√3 折中）；基率极端（ō 接近 0/1）时 UNC 项失真、分解解读要小心。
**e. 铁律合规**：极端化只作用于「科学算法臂」内部聚合；玄学臂恒挂娱乐参考、绝不进聚合输入（可做对照臂记录）。

## ⑦ 发散联想（未经验证猜想）
1. λ̂ 的动态版：把「三路相关矩阵的滚动均值」当 λ_t 喂给 F54 的 x₀ 公式 → 极端化强度随信息结构漂移自动调节，与 ACI 的 α_t 反馈环并联（一个调覆盖、一个调极端度）【未经验证猜想】。
2. Cauchy 重尾警告（F52）：α 的分布重尾意味着「有时最优方向是反极端化（α<1）」——固定 d=√3 会在这些局翻车；账本记录逐局 oracle 方向频率，若 P(α<1) 不可忽略则改用带符号的缩放【未经验证猜想】。
3. F56 的 RES 分解套在 3 路判词上可定位「哪一路贡献分辨率」——按路分解 n_j(f_j−o_j)² 与 n_j(o_j−ō)²【未经验证猜想】。
4. 先验 P(A)=1/2 的模型设定提示：对基率偏离 1/2 的题（游戏对局胜率类），高斯模型要重参数化——把 1/2 换成基率 ō 后 Prop 5.1 的 γ 是否形式不变未验证【未经验证猜想】。
5. MACI F49 的权重优化 + Satopää F55 的 γ 缩放可统一成「先线性后链接」的两参数族（w,γ）联合优化——极端化不再是聚合后的补丁，而是权重空间的维度【未经验证猜想】。

## ⑧ 存疑处
1. 队长点名的 Satopää 2014 IJF log-odds 公式原始文无 arXiv 版，本轮以 1501.06943v1（probit 框架）替代精读；IJF 版与 AIA Eq.2（logit 乘 d）的逐式对齐待期刊途径【如实标注】。
2. Prop 5.1 的 α≥1 是否在相干约束 Eq.8 下恒成立未逐点验证（Cauchy 位置 x₀≥1 是 Prop 4.1 的随机版结论，Prop 5.1 是非随机版，两者关系未细究）【未验证】。
3. δ（单路信息量）在 L0 场景的物理解释（判词离 1/2 的平均距离？）与估计稳定性未验证【未验证】。
4. Murphy 分解此处为离散预测值形式；Murphy 1973 原文的连续/直方图形式与 climatology 基线细节未读原文【如实标注，公式本身已核本文原文】。
5. GJP 实证仅 123 事件单年数据，BS 差 0.009 的显著性未在本文报告【转述】。

---
（回合 3 完 · 2026-09-11）

---

# 回合 4（收官）：arXiv:1909.10155 — Kumar, Liang, Ma, Verified Uncertainty Calibration

## ① 元数据
- Verified Uncertainty Calibration；Ananya Kumar（Stanford）、Percy Liang、Tengyu Ma；ICML 2019
- arXiv:1909.10155，v1 2019-09-23（arXiv updated 2026-09-11，下载当日最新官方 HTML 771KB）【已核 API+页面】
- 精读覆盖：§2 全（CE/MSE/TCE/MCE 定义）、§3 全（Platt 不保校准+分桶低估）、§4 全（scaling-binning+Thm 4.1）、§5 全（plugin/debiased+Thm 5.3/5.4）；附录证明主体与 §6-7 未细读【如实标注】

## ② 全文获取路径
- arxiv.org/html/1909.10155 → 200（771KB）【已核】；缓存 _cache-K-1909.10155.txt（126KB/2298 行）+ cache/K4-1909.10155-batchextract.md【已核】
- **F36 悬案闭环**：回合 2 存疑「ECE 严格误差界疑为 Kumar 2019」——本次全文证实出处正确，但**界的形式与我当时的猜测不同**（不是 O(√(M/N)) 单式，而是 plugin/debiased 两档样本复杂度，见 F60-F62），如实修正【已核】

## ③ 核心贡献（3 句）
1. 证明**分桶评估永远低估真校准误差**（Prop 3.3，Jensen；Example 3.2 给出 binned CE=0 而真 CE≥0.49 的构造），实测 ImageNet VGG16 Platt 后 15 桶测得 ~0.02 而真值至少两倍——文献报告的校准数字普遍偏乐观。
2. 提出 scaling-binning 校准器：先拟合 scaling（O(1/ε²) 样本）再 uniform-mass 分桶离散化，样本复杂度 O(B+1/ε²)（Thm 4.1），且离散化后校准误差可高效验证。
3. 验证理论：**plugin ECE 估计需 n∝O(B/E²) 样本，气象学老 debiased 估计只需 n∝O(√B/E²)**（Thm 5.3/5.4）——分桶数 B 的样本量代价首次被定量刻画；ECE 也有 debias 版（附录 G）。

## ④ 公式清单

**F57 校准误差定义与 MSE 关系（§2, Eq.1/2/3）**
$\text{CE}(f)=\Big(\mathbb{E}[|f(X)-\mathbb{E}[Y\mid f(X)]|^{2}]\Big)^{1/2}$（ℓ₂；ℓ₁ 版=ECE）；MSE $=\mathbb{E}[(f(X)-Y)^2]$，且 **MSE = 校准误差² + sharpness 项**（Murphy 分解的回归版呼应，回合 3 F56）；MSE=0 ⇒ 完全校准但校准≠有用（全 0.5 输出反例）。
多类：TCE（top-label，Eq.2）与 MCE（marginal per-class 加权，Eq.3，w_k=1/k）；top-label 可化归二元（把「对不对」当标签）。

**F58 分桶评估系统性低估（§3, Example 3.2 + Prop 3.3）**
binned 版 $f_{\mathcal{B}}(x)=\mathbb{E}[f(X)\mid f(X)\in I_j]$（Def 3.1）。
**Prop 3.3：$\text{CE}(f_{\mathcal{B}})\le\text{CE}(f)$ 恒成立**（Jensen：桶内误差互相抵消）。
**Example 3.2：对任意分桶方案 𝓑 与连续双射 f，存在分布使 $\text{CE}(f_{\mathcal{B}})=0$ 但 $\text{CE}(f)\ge 0.49$**——桶内一半高估一半低估即可完美骗过分桶评估。
实测（§3.1）：ImageNet VGG16+Platt，15 桶（Guo 配置）测得校准误差 ~0.02，加细分桶后至少翻倍——**「15 桶 ECE 好」不能当校准好的证据，只是下界**。

**F59 scaling-binning 校准器（§4, Thm 4.1）**
三步：①scaling 拟合 $g=\argmin_{g\in\mathcal{G}}\sum_{T_1}(y-g(z))^2$（如 Platt/TS，O(1/ε²) 样本收敛）；②uniform-mass 等频分箱（对 $g(z_i)$ 等频，**等频是 §5 可验证性的前提**）；③离散化 $\hat{g}_{\mathcal{B}}(z)=\hat{\mu}[\beta(g(z))]$（箱均值）。
**Thm 4.1**：正则条件下，$n\ge c\big(B\log B+\frac{\log B}{\epsilon^2}\big)$ 样本时，以概率 ≥1−δ：
$$\text{CE}(\hat{g}_{\mathcal{B}})^2\le 2\min_{g\in\mathcal{G}}\text{CE}(g)^2+\epsilon^2$$
对比：histogram binning 直接分箱需 O(B/ε²)（每箱独立估 Y），scaling-binning 只需 **O(B+1/ε²)**——箱均值 g(z) 方差小，是「用 B 个数只花 1/ε² 样本」的关键。实测：1000 样本×100 箱时校准误差比直方分箱低 35%。

**F60 plugin 与 debiased 估计器（§5, Def 5.1/5.2）**
plugin：$\hat{\mathcal{E}}_{\rm pl}^{2}=\sum_{s}\hat{p}_{s}(s-\hat{y}_{s})^{2}$（$\hat{p}_s$=箱频率、$\hat{y}_s$=箱内均值标签——即 Guo F35 的 ECE² 平方版）。
**debiased（气象学 Sanders/Murphy 老方法，论文的功劳是定量证明它更省样本）**：
$$\hat{\mathcal{E}}_{\rm db}^{2}=\sum_{s}\hat{p}_{s}\Big[(s-\hat{y}_{s})^{2}-\frac{\hat{y}_{s}(1-\hat{y}_{s})}{\hat{p}_{s}\,n-1}\Big]$$
（减去箱内二项噪声的期望贡献 $\hat{y}_s(1-\hat{y}_s)/(\hat{p}_s n)$）。

**F61 样本复杂度定理（Thm 5.3/5.4, §5）——F36 悬案的最终答案**
前提：2-well-balanced（$\mathbb{P}(f(X)=s)\ge\frac{1}{2B}$，等频分箱保证，Lemma 4.3：$n\ge cB\log\frac{B}{\delta}$ 时以概率 1−δ 成立）。
- **Thm 5.3（plugin）**：$n\ge c\frac{B}{\mathcal{E}^{2}}\log\frac{B}{\delta}$ ⇒ $\frac{1}{2}\mathcal{E}^{2}\le\hat{\mathcal{E}}_{\rm pl}^{2}\le\frac{3}{2}\mathcal{E}^{2}$（概率 ≥1−δ）
- **Thm 5.4（debiased）**：$n\ge c\frac{\sqrt{B}}{\mathcal{E}^{2}}\log\frac{B}{\delta}$ ⇒ 同式对 $\hat{\mathcal{E}}_{\rm db}^{2}$ 成立
直观：plugin 每项偏差 ~1/n、跨 B 箱累积成 B/n；debiased 减掉偏差项后方差跨箱相消——**样本需求从 ∝B 降到 ∝√B**。
实测（§5.1）：CIFAR-10 VGG16 边际校准，B=100 时 debiased 明显更贴近真值（n 越小差越大）。

**F62 对回合 2 F36 猜测的修正（如实闭环）**
F36 当时写「严格 ECE 误差界疑为 Kumar 2019 的 O(√(M/N)) 类」——读完原文：**没有单一 O(√(M/N)) 界**；正确结构是（a）分桶 ECE 是真误差的下界（F58）；（b）验证精度由 plugin/debiased 两档样本复杂度刻画（F61，E² 相对误差 1/2 的意义下）；（c）ECE（ℓ₁ 版）的 debias 在附录 G【已核正文，附录 G 未细读】。

## ⑤ 实现伪代码 / 参考代码

缩进式（W2 校准接口可直接落地）：

    # debiased ECE（对任意分桶校准输出）
    for each bin s: p_s, y_s_hat = 箱频率, 箱内均值标签
    E2_db = sum( p_s * ((s - y_s_hat)**2 - y_s_hat*(1-y_s_hat)/(p_s*n - 1)) )
    # scaling-binning 流水线（替换裸 TS）
    T1,T2,T3 = split(data, 3)
    g = fit_platt_or_TS(T1)          # 连续校准
    bins = quantile_bins(g(T2), B)   # 等频！（Thm 5.4 前提）
    ghat = bin_means(g(T3), bins)    # 离散化
    # 验证：E2_db on fresh set；n 需 >= c*sqrt(B)/E2*log(B/delta)

- 无需新依赖：numpy 一行减偏；scipy.stats.binned_statistics 之类可代【转述常规用法】。
- 参考：官方代码 github.com/ananyakumar/Calibration（论文 Reproducibility 节声明）【转述未逐核】。

## ⑥ 对本项目落地点（预测卡 L0 线）

**a. ECE 分桶的三个纪律修正（F58/F60/F61）**：①M=8 桶的 ECE 是**下界**——「ECE 低」只能说不坏，不能说校准好（真值可能两倍）；②改用 **debiased 版**（F60 减偏公式，一行代码）：200 条/M=8 桶时 plugin 的样本预算明显不足（n∝B/E²），debiased 把预算降到 ∝√B≈2.8 桶当量；③等宽桶改**等频桶**（uniform-mass）——等频才满足 2-well-balanced，Thm 5.4 才成立。
**b. 「200 条只记不评」的第三条数学腿（F61）**：要在 ±50% 相对误差内验证校准误差 E²，需 n ≥ c·√B/E²·log(B/δ)——代入 E=0.05（E²=0.0025）、B=8：n ∝ √8/0.0025≈1130×c——**200 条连 debiased 验证都撑不住，门禁再添一证**。
**c. W2 校准流水线定版（回合 2 F42 + 本回合 F59）**：TS（T1 段拟合）→ 等频分箱离散化（T2 段定箱）→ debiased ECE 验证（T3 段）——三段数据各司其职防泄漏；scaling-binning 比「裸 TS 连续输出」多一个好处：**校准误差变得可验证**（连续输出的误差无平滑性假设不可估，§3）。
**d. 玄学臂校准审计（F58）**：玄学臂若报「ECE 低」，同样只是下界——用 debiased 版+细分桶复测，预期其真误差暴露【与安慰剂定位一致】。
**e. 失效条件**：Thm 5.3/5.4 假设 2-well-balanced（极端基率时等频分箱的箱分布仍稳，但 ŷ_s(1−ŷ_s) 在 ŷ_s≈0/1 时减偏项趋零——基率极端题的验证精度另算）；定理是相对误差（±50%），绝对小误差仍难保证。
**f. 铁律合规**：debias 公式只进校准诊断接口，不改变研判信号；UI 数字恒挂「参考」。

## ⑦ 发散联想（未经验证猜想）
1. debiased ECE 的减偏项 ŷ(1−ŷ)/(p̂n) 与 conformal 的 1/(n+1) 有限样本修正是同一族「小样本诚实化」——可统一成 L0 账本的一张「小样本修正表」【未经验证猜想】。
2. F58 的「桶内高估/低估对冲」攻击对应到 3 路判词：某一路若在桶内系统性振荡（半对半错），plugin ECE 会给它发「校准好」的假证——debiased + 细桶是对抗这种「校准欺骗」的最小配置【未经验证猜想】。
3. Thm 4.1 的 O(B+1/ε²) 暗示：L0 早期（n<1000）分箱数 B 应该跟 n 走（B≈n/10 量级）而非固定 8/15——「分箱数随账本增长」动态策略【未经验证猜想】。
4. MSE=CE²+sharpness 与 Murphy REL−RES+UNC 是同一分解的两种坐标（回归式 vs 直方图式）——账本可以只记一对，另一套换算【未经验证猜想】。

## ⑧ 存疑处
1. ECE（ℓ₁ 版）的 debias 细节在附录 G 未细读（正文只说「提出并实测」）【如实标注】。
2. Thm 4.1 的正则条件（有限参数/单射/Lipschitz/一致性/二阶可微）对「verbalized 概率」这类输入是否满足未验证【未验证】。
3. 常数 c 未给出显式值（定理只到 Big-O），200 条门禁的精确达标线是数量级推算【推算标注】。
4. arXiv updated 2026-09-11（本回合当天）——版本差异未比稿【如实标注】。

---
# K 棒收官总账（4 回合 · 2026-09-11）

**五篇全文精读**（全部官方 HTML/arXiv，非摘要）：2107.07511v6（conformal 综述）→ 2106.00170v3（ACI，id 勘误 +26 号）→ 1706.04599v2（校准经典）→ 2602.01285（Multi-LLM ACI 2026）→ 1501.06943v1（extremization 理论）→ 1909.10155（校准验证，本篇）。公式 F1-F62（共 62 条），全部带节号/变量/适用条件/证据三态。

**给 G v1.1 的四件数学件**：①「200 条只记不评」三重数学腿（F13 波动带 / F22 p 值粒度 / F61 样本复杂度）；②W2 校准流水线定版：TS→等频分箱→debiased ECE（F42+F59+F60）；③3 路聚合两件套：MACI 权重单纯形优化（F49）+ Satopää γ̂=3/(1+2λ̂) 极端化（F54/F55）；④账本时序两件套：ACI 外环调 α_t（F24）× 滚动窗内环（F18）。

**铁律贯穿**：全部公式只服务「不确定性量化+校准诊断+消融对照」；玄学恒挂娱乐参考、绝不接研判。

（K 棒退役 · 4 回合完整收官 · 感谢产线协作）