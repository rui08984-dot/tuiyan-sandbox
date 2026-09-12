# 二期笔记 · Robust Aggregation of Substitutable Signals · 微步B9

> 论文：Are You Smarter Than a Random Expert? The Robust Aggregation of Substitutable Signals（arXiv:2111.03153，**v2**；理论 CS/机制设计线——与 Satopää 经济学线不同文献族）
> 获取：pwsh 抓 abs+HTML v2（535.7KB）→ _extract-html.cjs txt 89,687 B/1,575 行。缓存=cache/_cache-Subst-2111.03153v2.html/.txt（行号锚）。

## 【事实层】

### 框架与条件（§1-§2，txt L169-500）
- 设定：专家信息结构**对抗性选择**自宽类——无条件下非平凡性能保证不可能（反例：XOR 结构 L196；secret sharing §2.4 L201）。
- **projective substitutes 条件**（§2.5）：信息替代品=学习专家信号的**边际收益递减**——weak substitutes 的加强版。
- 评估基准：**improvement over the prior**；基线=随机选一专家输出其预测（期望近似比 1/k，L205-210）。
- 两 setting：prior-free（只见预测）/known prior（先验已知）。

### 定理（§1.1，txt L216-267）
- **prior-free**：Thm 3.1 平均近似比 ≥(1+√3)²/k≈7.46/k；Thm 3.3 上界 2/k−1/k²；Thm 3.6 k=2 时紧。
- **known prior**：Thm 4.1 对平均做**特定常数因子极端化**（k→∞ 因子→√3 量级）；Thm 4.2 上界 4k/(k+1)²；Thm 4.3 k=2 紧。
- **三句总结**（L259-267）：①projective substitutes 下平均大幅优于随机专家②仅知预测时无可实质改进平均的手段③**已知先验时，适度极端化实质优于平均、且优于任何可能的聚合策略**。
- Figure 2（k=2-7 保证值）：weak subs（随机专家）0.5/0.333/0.25…；proj subs prior-free averaging 0.706/0.520/0.409…；**extremizing（known prior）0.760/0.596/0.488…** 全列最高。

## 【结论层】（三态）
- 【已核】**known prior 下「按特定常数极端化平均」是 minimax 鲁棒最优**（Thm 4.1 正+Thm 4.2 负匹配）——给 λ̂/γ̂ 极端化路线对抗信息结构下的鲁棒性背书（此前只有贝叶斯最优性论证）。
- 【已核】prior-free（不知先验）时极端化无理论依据、平均已是准最优（Thm 3.1/3.3）——**极端化前提=先验/基率可估**：账本基率=先验估计，先有基率记账才有极端化合法性（与 H1 基率泄漏防御「基率先行」互为表里）。
- 【已核】projective substitutes=边际收益递减——三路判词若共享证据通道则近似成立；某路有私有信息（互补）则条件破——**λ̂/替代度实测决定我们是否在定理保护域内**。

## 与本项目的差异表
| 维度 | Substitutes 2111.03153v2 | 本项目 |
|---|---|---|
| 文献族 | 理论 CS/机制设计（minimax 保证） | 经济学线（Bayes 最优）+工程线 |
| 聚合保证 | 对抗信息结构最坏情形近似比 | 无对抗保证（回放实证） |
| 关键结论 | 已知先验→极端化平均鲁棒最优；不知先验→平均准最优 | 账本基率=先验估计先行，γ̂ 极端化合法 |
| 可复用 | projective substitutes 检验思想 | 直接借作 λ̂ 的理论框架 |

## 发散思考（【引申·未验证】）
- 【引申】三篇聚合理论合成决策树：①判词路替代度实测（B7 λ/B9 替代度）②先验可估性（账本基率）→③选聚合：不知先验→平均；知先验+替代→极端化平均（B9 因子→√3 量级，**与 AIA √3 极端化系数惊人呼应**——巧合待查）；强互补→需信息级融合非概率级。
- 【引申】对抗视角对投毒防御（S2 续集 ACR）启示：恶意判词路=对抗专家，weak substitutes 下 1/k 保证=「投毒 k 路之一最多损失 1/k」的鲁棒性来源——trimmed median 鲁棒性可在此框架理论化。

## 存疑与待验证
1. 定理证明细节（§3-4+附录）未逐字读——Thm 4.1 常数因子完整式被公式提取截断，引用前回读。
2. projective substitutes 正式定义（§2.5 L500-641）未逐字读——实测判词路替代度前须回读。
3. XOR/secret sharing 反例构造未读（投毒防御建模有用，L196-202）。

（Substitutes 笔记完 · 2026-09-12 · 微步B9 · 锚=cache/_cache-Subst-2111.03153v2.txt 1575 行）
