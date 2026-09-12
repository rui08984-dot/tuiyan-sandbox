# 二期笔记 · Consistency Checks for LM Forecasters · 微步B12

> 论文：Consistency Checks for Language Model Forecasters（arXiv:**2412.18544**，v2；Paleka*(ETH)/Sudhir*(Warwick)/Alvarez/Bhat/Shen/Wang/Tramèr——**ICLR 2025 Oral**）
> 获取：pwsh 抓 HTML（1.04MB）→ txt 178,138 B/4,976 行。缓存=cache/_cache-Consis-2412.18544.html/.txt（行号锚）。**更正留痕：B12 曾凭记忆错抓 2402.12465（SOM 论文），正确 id 2412.18544 经搜索核实后重抓。**
> 开源：github.com/dpaleka/consistency-forecasting + HF datasets dpaleka/ccflmf（代码+数据全放）。

## 【事实层】（四问体例）

### ①测了什么
- **即时一致性评测框架**（不用等结算）：从基础题生成逻辑相关题元组，测 LLM 预测的逻辑一致性。**9 种检查**（Table 1，L295-356）：Negation F(P)+F(¬P)=1／Paraphrase F(P)=F(Q)／Consequence F(P)≤F(Q)／AndOr F(P)+F(Q)=F(P∨Q)+F(P∧Q)／And、Or（Fréchet 界）／But／Cond F(P)F(Q|P)=F(P∧Q)／CondCond（三事件链式）／ExpEvidence（全概率公式）。
- 两个度量：**arbitrage**（套利视角：违反逻辑=可被套利者赢钱）＋**frequentist**（频率派假设检验，bootstrap 真概率）。
- 数据：市场抓取+NewsAPI 合成两套题（全部晚于所有测试模型训练截止、2024-09 前结算）；另建 **2028 长视距基准 3,000 checks**。

### ②没测什么/局限
- 【已核】作者自注（L637-638）：测试 forecaster 集合有限，趋势不保证代表未来 LLM；部分相关可归因于「更好模型既更一致又更会预测」（与能力共线）。
- 未测：一致性训练（只测 ArbitrageForecaster patching 且**不泛化**到未优化检查，§5）；开放问题=为什么某些检查（Cond/CondCond 条件概率一致性）信号强而 Negation 弱。

### ③关键结果
- 【已核】**一致性与真实 Brier 性能正相关**（全部测试 forecaster；§4 Fig.3-4）：**Cond/CondCond 最强（R>0.9）**——条件概率一致性是预测力最佳即时代理；多检查聚合提升相关性；部分检查负相关无信号（Negation NewsAPI arbitrage −0.36）。
- 【已核】Brier 依赖模型能力与训练截止双因素（L595）——一致性指标的价值=**与截止无关的即时反馈**（长视距题结算前就能评）。
- 【已核】ArbitrageForecaster（patch 优化一致性）：只改进被优化的检查，**不泛化**（§5）——一致性可作弊，作为训练目标危险（呼应 B11 优化陷阱）。

### ④开源可复用
- 【已核】代码（github.com/dpaleka/consistency-forecasting）+数据集（HF dpaleka/ccflmf）+2028 基准 3,000 checks 全放——**直接可跑**。

## 与本项目的差异表
| 维度 | Consistency 2412.18544 | 本项目 |
|---|---|---|
| 评测时机 | **即时**（不等结算）——长视距关键优势 | 结算后 Brier/BI（账本回放） |
| 信号 | Cond/CondCond R>0.9 最强；部分检查无信号 | 判词间一致性（三路分歧）=我们的「一致性」近似 |
| 作弊风险 | ArbitrageForecaster 不泛化=一致性可作弊 | 三路判词互相一致性同样可作弊（一致地错）——**须与结算分开** |
| 可复用 | 9 检查+套利度量+2028 基准全开源 | **Cond/CondCond 式条件一致性检查可加入判词体检**（三路判条件概率一致性） |

## 发散思考（【引申·未验证】）
- 【引申】Cond R>0.9 的启示：条件概率一致性是判词质量最佳即时代理——我们三路判词若对「P(狼|某发言)×P(某发言|剧本事实)」类条件链做一致性检查（DINCO 式归一），可能不需要等结算就能给判词路质量分——与 PCM 的 SA 校准变量互补（即时信号 vs 结算信号）。
- 【引申】「一致性可作弊不泛化」给判词互检一个边界：三路判词互相印证（acquiescence 一致）可能是共同偏置而非正确——**一致性好≠预测好**，与 A0-1 F4（Mafia 无增益）同警示；结算仍是不二金标准。
- 【引申】2028 基准思路=「长视距题现在就发、结算前先比一致性」——我们 L2+ 扩展题库可预留一批远期题做判词路的年度一致性体检。

## 存疑与待验证
1. Table 2 完整相关矩阵只抄了 Negation 行——Cond/CondCond 精确 R 值引用前回读（正文说 R>0.9）。
2. arbitrage 度量的数学定义（附录 C）未逐字读。
3. §5 ArbitrageForecaster 的实验细节未读。
4. ICLR 2025 Oral 口径=Tramèr 主页（已核），论文 PDF 本身无 venue。

（Consistency 笔记完 · 2026-09-12 · 微步B12 · 锚=cache/_cache-Consis-2412.18544.txt 4976 行）