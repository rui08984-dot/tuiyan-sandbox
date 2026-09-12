# 二期笔记 · Combining and Extremizing Real-Valued Forecasts · 微步B8

> 论文：Combining and Extremizing Real-Valued Forecasts（arXiv:1506.06405，**v2**；Satopää——K5/InfoDiv 同作者实值姊妹篇）
> 获取：pwsh 抓 abs+HTML v2（417.8KB）→ _extract-html.cjs txt 79,984 B/1,559 行（公式完整）。缓存=cache/_cache-ExtremVal-1506.06405v2.html/.txt（行号锚）。

## 【事实层】

### 理论核心（§2，txt L256-358）
- **框架**：N 预测者，Y 与 X_j 共享概率空间；reliability=条件无偏 E(Y|X_j)=X_j ↔「预测=某信息集的最优使用」（σ(X_j)⊆F 子 σ-域构造，L266-279）。
- **Theorem 2.1（revealed aggregator X″=E(Y|F″) 三性质）**：①marginal consistency ②reliability ③**Variance Expansion**：Var(X″)≥δ_max（个体最大方差）——最优聚合是「信息收集者」（σ-域递增链），方差**不减**。
- **Theorem 2.2（加权平均三缺陷）**：X_w=Σw_jX_j ①marginally consistent ✓ ②**not reliable**（存在信息不一致时 P[E(Y|X_w)≠X_w]>0——「与任何信息集都不一致」）③lacks resolution ④**not expanding**：Var(X_w)≤δ_max——**under-confident**。
- 哲学区分原话：averaging 减少「measurement error」而非「信息聚合」——philosophically different（L346-347）；**median 等一切中心趋势量同病**（都收缩方差，L228-230, 346）。
- **Ranjan-Gneiting 2010 推广**：他们证二元概率版（可靠概率预报的非平凡加权平均必不可靠且欠自信）；本文推广到任意实值预报。

### extremization 重定义与凸优化（Def 2.3+§3，txt L352-409）
- **Definition 2.3**：实值 extremization=**从 margin mean μ₀（最小置信点）移开**，而非概率版的向 0/1 移开。
- 线性极端化：$\mathcal{X}_k^*=\alpha(\mathbf{w}'\mathbf{X}_k-\mu_0)+\mu_0$；凸优化（式1-2）：minimize Σ[α(w′X_k−μ₀)+μ₀−Y_k]² s.t. w_j≥0, Σw=1, α≥0；解的还原 α*=Σβ_j*，w_j*=β_j*/α*，μ₀*=−β₀*/(1−α*)。

### 仿真与实证（§4-§5，txt L412-710）
- 仿真（Gaussian partial information model=InfoDiv/B7 模型实值版）：No Overlap **α*=5.01** vs High Overlap（ρ=0.12）**α*=1.30**——**极端化幅度与信息重叠反比**（与 InfoDiv 理论一致）；高重叠时低信息专家权重压到 0。
- 实例（UCI 混凝土抗压强度，3 线性回归「预测者」，10-fold CV）：High Overlap 损失 **Best Individual 0.8141 / Median 0.8492 / X̄ 0.8254 / X_w 0.7889 / X* 0.7758 / X″(oracle) 0.6837**——X* 优于全部常规聚合、仅次于 oracle；reliability 图显示 X* 修正欠自信。

## 【结论层】（三态）
- 【已核】「任何非平凡加权平均与任何信息集都不一致」推广到实值（Thm 2.2）——加权平均的理论地位=测量误差缩减器，非信息聚合器。
- 【已核】Variance Expansion（Thm 2.1iii）=最优聚合新性质+欠自信根因（中心趋势量全收缩方差）——**极端化不是启发式补丁而是最优性的必要成分**。
- 【已核】实值 extremization 重定义（Def 2.3：离 μ₀ 移开）+凸优化算法（式 1-2 可直接实现：三参数 α,w,μ₀ 一次求解）。

## 与本项目的差异表
| 维度 | ExtremVal 1506.06405v2 | 本项目 |
|---|---|---|
| 预测类型 | 实值连续量（GDP/混凝土强度） | 二值事件概率（资源/票数若扩展=实值域） |
| extremization | 从 μ₀ 移开的线性变换（凸优化求 α,w） | K5 logit 域 Cauchy 幂（概率域）——**实值版公式直接可用于资源类输出** |
| 理论 | Var Expansion+加权平均次优定理 | 多路平均天然欠自信——聚合设计须防 |
| 可复用 | 凸优化式(1-2)、reliability 图诊断 | L1+ 资源/数值预测扩展的直接算法 |

## 发散思考（【引申·未验证】）
- 【引申】多模拟器轨迹的**资源/票数预测**（实值）聚合直接用本文式(1-2)：N 轨迹加权+α 极端化一次凸优化求出——比 logit 域 Cauchy（仅概率域）更适配实值；与 A2 的 CRPS 记账配对=实值预测完整管线。
- 【引申】Var(X″)≥δ_max 给聚合方差一个诊断检验：聚合后分布方差若小于最强单路=欠自信信号，α 估计目标即修复此点。
- 【引申】「median 也欠自信」警示：三路判词若取中位数同样收缩——多路聚合应偏 logit 均值+极端化而非 median。

## 存疑与待验证
1. 仿真/案例全用 Gaussian 模型+线性预测者——非高斯/非线性场景外推未验证。
2. 表 2/3 完整分量数字未全抄——引用前回读。
3. α 估计的 sample size 敏感性未给全。
4. 与 K5/InfoDiv 的公式交叉引用未逐条比对——三篇谱系图 L1 挂账时合并。

（ExtremVal 笔记完 · 2026-09-12 · 微步B8 · 锚=cache/_cache-ExtremVal-1506.06405v2.txt 1559 行）
