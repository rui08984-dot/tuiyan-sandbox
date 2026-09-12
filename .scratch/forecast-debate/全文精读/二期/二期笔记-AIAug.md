# 二期笔记 · AI-Augmented Predictions（Schoenegger）· 微步B10

> 论文：AI-Augmented Predictions: LLM Assistants Improve Human Forecasting Accuracy（arXiv:2402.07862，**v2**；Schoenegger et al.——J6 Silicon Crowd 同团队）
> 获取：pwsh 抓 abs+HTML v2（304KB）→ txt 95,532 B/1,652 行。缓存=cache/_cache-AIAug-2402.07862v2.html/.txt（行号锚）。
> **实验设计=对我们「人机协作判词」最直接的 preregistered 范本**（OSF 预注册 d9rhx；UPenn IRB 854515）。

## 【事实层】
- 三臂 RCT：Treatment（superforecasting prompt=超预测者人设+10 戒律：triage/拆解子问题/内外视平衡/证据更新平衡/多级怀疑等，GPT-4-Turbo T=0.8）/ Treatment(Noise)（**故意过自信+基率忽视指南**）/ Control（弱模型无数值预测不讨论）。Prolific 招募 1,152→**991 分析样本**；6 道实值题（DJIA/地中海难民/比特币算力/全球航班/ArXiv AI 论文数/USD-RUB）+3 道技能题。
- 主结果（Table 4/ANOVA）：误差分 Control **0.89** / Treatment **0.68** / **Treatment(Noise) 0.64**；one-way ANOVA F(2,988)=34.58，p<.001——**两个 LLM 条件都显著改善，noise 助手点估计改善最大**。
- OLS（Table 5，N=991）：Treatment β=−0.21（p<.001）、Treatment(Noise) β=−0.25（p<.001）；**High Skill 交互项 β=0.00（p=.951）**——技能无调节，低技能者获益同等。
- 聚合层：LLM 增强未降低聚合准确率（假设 3 无效）；难易题无差异（混合效应模型 Table 6）。
- **预注册偏离披露**：winsorisation 5% 应用于全组而非仅对照组（原文声明，L223）。
- **探索性修正**：剔除 Q3 离群题后 superforecasting 变体优势显现（noise 的表面优势系 Q3 驱动，L597-599）——「this does not mean that this pattern will continue in the face of potentially more capable AI」。

## 【结论层】（三态）
- 【已核】LLM 助手显著提升人类预测准确率且**建议质量（super vs noise）在聚合指标上差异不显著**（Q3 剔除后方向才分化）——建议的结构化价值≠内容质量价值。
- 【已核】技能无调节：LLM 增强拉平（而非放大）人类技能差距（对比文献「less skilled benefit more」一致）。
- 【已核】诚实范例：预注册偏离逐条声明+探索性/验证性分析明确标注。

## 与本项目的差异表
| 维度 | AIAug 2402.07862v2 | 本项目 |
|---|---|---|
| 协作方向 | LLM 辅助**人类**预测 | 判词路辅助/独立于人类（未来人机混合可借） |
| 助手质量操纵 | super vs noise prompt（同底座） | 温度三路+证据通道差——**prompt 质量操纵可加第四路对照** |
| 结算 | 实值误差分（percentage error） | Brier/BI——口径不同 |
| 范式价值 | preregistered RCT+偏离披露+探索/验证分离 | 直接借作人机混合臂模板 |

## 发散思考（【引申·未验证】）
- 【引申】noise 助手≈有益的「扰动源」：与 FBSim placebo（null 措辞 0.165 vs 真 0.360）合并解读——人类从 LLM 协作中的获益可能主要来自**外部视角的结构化提问**（10 戒律=认知脚手架）而非数值建议质量。我们玄学对照臂若做成「仪式化结构化提问界面」（恒挂娱乐参考），其效用机制可能同类——但这恰是「娱乐参考」与「研判」的边界所在：结构化提问可入研判，玄学内容不可。
- 【引申】10 戒律 prompt 是现成的判词路 system prompt 素材（第 4 条证据更新平衡=K5 extremization 的人类版）——可作三路判词之外的「超预测者路」prompt 底稿。

## 存疑与待验证
1. 6 题全为实值题（percentage error 计分）与二值概率判词的可比性未验证。
2. Q3 离群题具体影响未抄全（剔除后效应量数字未抓）。
3. v1→v2 变更未核。
4. 预注册 OSF 链接带 view_only 参数，全文预注册文档未核。

（AIAug 笔记完 · 2026-09-12 · 微步B10 · 锚=cache/_cache-AIAug-2402.07862v2.txt 1652 行）