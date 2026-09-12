# 二期笔记 · How Proper Scoring Rules Shape LLM Forecasting · 微步B6

> 论文：How Proper Scoring Rules Shape LLM Forecasting（arXiv:2608.28482，HTML 抓取默认最新版；abs 页列 v1/v2）
> 作者：**Benjamin Turtel / Paul Wilczewski / Kris Skotheim（Lightning Rod Labs）＋ Ville A. Satopää（INSEAD）＋ Philip E. Tetlock（Wharton）**——**书单 B15「Turtel 2025」作者同团＋K5 extremization 一作 Satopää＋Tetlock 三重谱系交汇**；本文引用 Turtel et al. (2026) 的 future-as-label setup（即 B15 候选前作）。
> 获取路径：pwsh 抓 abs（41.8KB）+HTML（214.8KB）→ _extract-html.cjs txt 60,804 B/1,605 行。
> 缓存：cache/_abs-PSR-2608.28482.html + _cache-PSR-2608.28482.html + _cache-PSR-2608.28482.txt（行号锚）。

## 【事实层】

### 五计分规则作训练目标（§3.3，txt L265-338）
- 五个 strictly proper scoring rules 作 terminal reward：**log**（式1 $S_{log}=y\log p+(1-y)\log(1-p)$）；**Brier**（式2 取负 $-(p-y)^2$ 训练/常规 Brier 评估）；**spherical**（式3 $\frac{yp+(1-y)(1-p)}{\sqrt{p^2+(1-p)^2}}$）；**Beta(2,8) 与 Beta(8,8)**（式4-5 Buja et al. 2005 beta 家族：$S_{\alpha,\beta}(p,y)=-y\int_p^1(1-q)w_{\alpha,\beta}(q)dq-(1-y)\int_0^p q\,w_{\alpha,\beta}(q)dq$，权重 $w=\frac{q^{\alpha-1}(1-q)^{\beta-1}}{B(\alpha,\beta)}$；**Beta(1,1)≡Brier 常数倍**）。
- 几何差异（Fig.1）：log 与 Beta(2,8) 对低概率区更敏感（重罚错信 0/1），Beta(8,8) 权重集中在 p=0.5 附近，Brier/spherical 平滑——「same truthfulness property, differ in curvature, boundedness, tail behavior, and emphasized regions」。
- 评估件：ECE（B=10 bins，式6）；AUC-ROC（排序不计校准）；**BIN 分解（Satopää et al. 2021）**=bias/information/noise 三分期望 Brier 差（潜在正态模型→估计量非观测量）。

### 训练与数据（§3.4-3.5，txt L370-460）
- **Dr. GRPO**（Liu et al. 2025）：每题 K=8 轨迹采样，组内相对优势 $A_i=S_m(p_i,y)-\frac{1}{K}\sum_j S_m(p_j,y)$（式7）；**不除组内标准差、无 KL 罚**——组均值=状态特定 baseline。
- 无效输出罚分对齐各规则自身尺度（spherical 0 / Brier+beta −1 / log −8）；概率钳位 [0.001,0.999]（log 下界 ≈−6.9，低尾过自信罚得比无钳位轻）。
- 底座 GPT-OSS-120B + rank-32 LoRA；batch 32 / 16,384 max tokens / 200 steps / lr 2e-5 / 8 rollouts。
- 数据：**8,041 例**（2024-07~2026-01 新闻事件二值题，Lightning Rod 专有 SDK），7,076 训练/965 held-out；正例率 27.0%/28.5%；temporal masking（future-as-label，Turtel et al. 2026）；BIN 拟合 4,825 pooled 观测；不确定性=question 级 paired bootstrap 2,000 重采样。

### 结果 Table 2（§4.1，txt L468-531 全表）
| 变体 | Log↑ | Brier↓ | Sig. | ECE↓ | AUC↑ | Avg tokens |
|---|---|---|---|---|---|---|
| Log | **−0.5132** | 0.1653 | *** | **0.0434** | 0.7407 | 454.3 |
| Brier | −0.5185 | **0.1648** | *** | 0.0568 | **0.7511** | 1089.4 |
| Spherical | −0.5273 | 0.1680 | *** | 0.0538 | 0.7353 | 362.8 |
| Beta(2,8) | −0.5223 | 0.1677 | *** | 0.0449 | 0.7372 | 790.4 |
| Beta(8,8) | −0.5536 | 0.1731 | ** | 0.0954 | 0.7366 | 2691.9 |
| Base | −0.5585 | 0.1861 | — | 0.1099 | 0.7248 | 662.6 |
- **Brier-trained 最低观测 Brier（0.1648）+最高 AUC（0.7511）；log-trained 最高 log score（−0.5132）+最低 ECE（0.0434）**——「home-advantage」模式：各变体在自己训练计分上表现最好。
- Beta(8,8) 全面最差（ECE 0.0954、token 2691.9=最长、Missing 0.27%）；token 生成量跨变体差 ~7×（Brier 1089 vs spherical 363）——**reward 影响输出长度/verbosity**。

### BIN 分解结果（§4.2，txt L541-595）
- BIN=Bias/Information/Noise（Satopää et al. 2021 潜在正态模型；组件和=模型蕴含的相对 base 的 Brier 降幅，与观测差差 1-2pp，明示非观测量）。
- **不同 reward 变体经由不同组合达成相似总体改进**：Beta(2,8)=最大 bias 贡献；**Brier 变体=最大 information 贡献+小噪声贡献**；**log 变体=大正噪声贡献（noise profile 最强，near-unit posterior 概率低于其他全部变体）**；spherical/Beta(8,8)=负噪声贡献抵消 bias/info 增益。
- pairwise 对比（HMC 2000 warmup/4000 post，seed 1）：bias 上 log 与 Beta(2,8) 后验支持最强；information 上 Brier 与 Beta(8,8) 主导；log 噪声 profile 全场最佳。
- 「相似 Brier 改进、相异预测 profile」——**aggregate score 只捕捉学得预测者间变异的一部分**。

## 【结论层】（三态）

- 【已核】**proper scoring rules 作 LLM 训练目标不必可互换**：五规则共享总体真值激励（Gneiting-Raftery 2007），但 Dr. GRPO 有限数据+组相对优化下产生校准/概率使用/BIN profile 不同的模型——「This does not challenge the propriety of the scoring rules. Rather, it shows that their empirical behavior as LLM training objectives can differ under limited data, sampled rollouts, and a fixed optimization procedure」（L612-615）。
- 【已核】home-advantage：各变体在自己训练计分上最佳（Brier-trained 最低 Brier、log-trained 最高 log+最低 ECE）——总体 accuracy 差异小而误差结构差异大。
- 【已核】局限自列：单底座/单数据集/单超参配置/**每 reward 单训练 seed**（共同优化设置对比而非各自调优）；Beta(2,8) 对结局分布可能特别敏感；token 级 compute 不同。
- 【已核】BIN 分解=Satopää et al. 2021（本文合作者即提出者）——bias=系统性水平偏差/information=结果相关信息/noise=非系统变异，三分期望 Brier；与 K6 的 Murphy REL−RES+UNC 同族但模型化（潜在正态）而非经验分箱。

## 与本项目的差异表（接入总差异表）

| 维度 | PSR 2608.28482 | 本项目 |
|---|---|---|
| 计分规则作用层 | **训练目标**（RL reward，塑形模型行为） | **评估/记账**（判词后结算；不训练模型） |
| 计分家族 | log/Brier/spherical/Beta 家族 5 种 | Brier/BI/ABI（+拟扩 CRPS） |
| 误差结构分析 | BIN（模型化，Satopää 2021） | Brier/Murphy 分解计划（经验分箱，K6 口径）——**BIN 是升级候选** |
| 多样性来源 | reward diversity ensemble（不同 reward=互补误差 profile） | 温度三路+多模拟器——**口径多样性是第三种多样性来源（未用）** |
| 相似点 | 二值真实事件+temporal masking 防泄漏+正例率 ~27-28% | 同构（R-A/R-B 拆分同思想） |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】**reward diversity ensemble=集成多样性第三轴**：三路判词现在只有温度多样性+模拟器环境多样性；本文证明 reward/计分口径产生互补误差结构（log 型低噪声 vs Brier 型高信息）——判词 prompt 可实验「告知计分口径」变体（零训练成本的口径多样性；RL 层效应可否迁移到 prompt 层纯猜测，须实验）。
- 【引申】BIN 三分对判词组合的意义：低 bias 高 noise 路（log 型）适合多路聚合（噪声被平均）；高 information 路（Brier 型）适合排序/优先级——**聚合路线选择可与判词路 BIN profile 匹配**（PCM 权重之外的第四建模维度）。
- 【引申】A3（评估层计分反转缩放符号）+本文（训练层计分塑形误差结构）合成「计分口径双层论」：记账升级（L1+ CRPS）与判词 prompt 口径告知实验=两个独立预注册实验轴。
- 【引申】home-advantage 提示评估口径是「训练目标镜像」——FB 用 Brier 评估隐性偏爱 Brier-型预测者；我们 BI 记账同理——**多口径并列记账（log+CRPS+Brier）是免疫手段**。

## 存疑与待验证

1. 每 reward 单训练 seed（作者自列）——reward 间差异可能混入种子噪声；复现须多种子。
2. token 级 compute 不等（Brier 1089 vs spherical 363）——Brier 优势部分或为「想得更长」而非计分本身（未做 token 配平）。
3. GPT-OSS-120B+LoRA+200 steps 有限训练 regime 外推性未知（作者明示）。
4. BIN 是潜在正态估计量非观测量（组件和与观测差差 1-2pp）——引用 BIN 数值带此 caveat。
5. B15「Turtel 2025」身份：本文引用 Turtel et al. (2026) future-as-label 前作——B15 候选=该前作或团队更早论文，爬 B15 时以「Turtel+Lightning Rod Labs+forecasting」检索定 id 回填。
6. 附录 A/B/C 未逐字读——引用附录数字前回读。

（PSR 笔记完 · 2026-09-12 · 微步B6 · 锚=cache/_cache-PSR-2608.28482.txt 1605 行）
