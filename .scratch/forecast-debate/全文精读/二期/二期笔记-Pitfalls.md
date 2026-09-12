# 二期笔记 · Pitfalls in Evaluating LM Forecasters · 微步B11

> 论文：Pitfalls in Evaluating Language Model Forecasters（arXiv:2506.00723，**v1**；Paleka/Goel/Geiping/Tramèr，ETH Zurich 系——A0-3 Confident 同团队；ICML 2025）
> 获取：pwsh 抓 abs（41.1KB）+HTML（258.7KB）→ txt 70,761 B/1,347 行。缓存=cache/_abs-Pitfalls-2506.00723.html + _cache-Pitfalls-2506.00723.html/.txt（行号锚）。
> **性质=评测方法学批判纲领文**（非新系统）：两大挑战七 issue＋优化陷阱——对本项目评测管线是「体检清单」级文件。

## 【事实层】（四问体例）

### ①测了什么
- 【已核】系统性分析+先前工作具体实例，七大 issue 分两挑战：
- **挑战 1 信任评测结果**：①**逻辑泄漏**（backtesting 选题隐含未来知识：2021 年问「Queen Elizabeth 能活到 100 岁」在 2023 年回测即泄漏答案；news 回溯生成题有存活偏差——倒闭公司不再被报道→「Q3 营收」类合法题消失）②**检索日期限制不可靠**（"jan 6" 限 2020 前仍返回美政治结果；Nobel「Nihon Hidankyo」限 2025-01~09 泄漏 10 月获奖；检索引擎排序算法本身含未来知识）③**cutoff 日期不可靠**（GPT-4o-2024-08 自称 cutoff 2023-10，jailbreak 后说出 11 月事件；cutoff 定义各家不一；system prompt 可能含新信息）。
- 实证：**Halawi 2024 至少 3.8% 题逻辑泄漏；Tao et al. 2025 ≥10% trivial**（回测窗内即 resolve）；Dai et al. 2025 news 生成题 **>90% 过度具体**（「Detroit 20400 街区垃圾桶尸体」例——事前不会被问的题）。
- **挑战 2 外推到真实世界**：④**Piggybacking**（LLM 可复制市场/人群概率→「LLM vs 人类」比较循环论证；FB 用人群为 gold standard 受此影响）⑤**Betting gaming**（最大化夺冠概率≠最好预测：2024 大选是相关潜变量——真实报告者报 P(·|共和党)/P(·|民主党) 两套，博弈者直接假设单一结局；**winner's curse**：多模型基准的第一名往往是被高估的幸运偏倚者；2022 竞赛冠军原话「deliberately structure my answers to maximize my probability of winning」）⑥**分布偏斜**（FB 重度偏 Security & Defense；Polymarket 偏加密/体育；Manifold 偏个人题；非市场源只几种模板=ACLED 冲突增量）⑦**指标缺陷四条**：calibration 罚有用预测（conclave 100 红衣主教例——基率预测者完美校准但无用）；accuracy 非 strictly proper；**Brier 跨基率不可比**（期望 Brier=b(1−b)：50/50 题与 5% 稀有题混合基准会选择「区分常见题」而非「稀有事技能」）；label noise 使计分非严格 proper（附录 D：常数标签噪声下 clamping 概率可比真值 log score 更好；Paleka 2024 报 Perplexity 结算 1-5% 错误率）。

### ②没测什么/④优化陷阱（§4，txt L557-576）
- 【已核】**backtesting 作训练目标的新泄漏**：时序切分下优化有序事件→模型记住 e_i 已发生→不再是「从原 cutoff 预测 e_{i+1}」——**按日期排序也不够**；需要「惩罚记忆化」机制（未解决，open problem）。
- 【已核】 §5：公开基准的首要用途是排名用户（Hardt 2025）；无证据表明这些 issue 降低性能声明但「难排除被利用」；建议=自建未 resolve 题+借鉴金融交易文献（风险调整收益）+理想=预测市场实盘盈利评估。
- ③规模与域：本文为分析文无自有数据集；引用基准=Halawi/Tao/Dai/Paleka 2024/FB/ACX-Metaculus 竞赛。

### 解法清单（各 issue 的 possible solutions 汇总）
- 逻辑泄漏→限制「每种 resolution 都可验证」的题+回溯生成时保真度审查；检索→白名单语料库/TF-IDF 无知识检索（代价=检索质量降）；cutoff→用模型 release date 而非声称 cutoff；piggybacking→检查人群预测可得性；betting→风险调整报告+多期回测换 backtest date；偏斜→synthetic 控制分布；指标→多指标并列（无单一完美指标）。

## 【结论层】（三态）——四问已嵌入事实层，此节=结论与项目警示

- 【已核】中心论点：「monitoring forecasting capabilities is appreciably harder than evaluation of knowledge」——预测评测在 ML 评测全部问题之上还有独有 issue（时序泄漏/外推/优化混淆），社区应对「LLM 达人类水平」声明保持审慎。
- 【已核】winner's curse 对基准排名的威胁：「the top performer is likely overestimated」——**任何多系统排名的第一名解读都要打折扣**（对我们 L0 评审比较同理）。
- 【已核】指标没有完美解：「No commonly used metric is without issues」→多指标并列是唯一防线（与我们 Brier/BI/CRPS 多口径记账同构）。

## 与本项目的差异表（接入总差异表）

| 维度 | Pitfalls 2506.00723 | 本项目管线 |
|---|---|---|
| 性质 | 评测方法学批判纲领（七 issue 清单） | 自建评测管线——**本文=体检清单直接对照** |
| 泄漏防线 | 建议白名单语料/release-date 上界/真值可验证题 | sim 全程无检索=天然免疫②；L0 门禁=时序切分（对照③：门禁应按 release date 重核） |
| 指标 | 四缺陷清单（Brier 跨基率不可比等） | Brier/BI 多口径——**须加基率分层记账**（50/50 与 5% 题分开报） |
| 训练路线 | backtesting 训练=时序混淆 open problem | 未来若微调判词须先解此题（当前不训练=免疫） |
| 对照 | 建议市场实盘为最终检验 | 玄学对照臂+模拟器轨迹=我们的「实盘」等价物 |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】Brier 跨基率不可比（E[BS]=b(1−b)）精确命中我们 H1 判据设计：主判据 v1@L6 对照「旧值 0.3876 与基率下限 0.13」正是基率分层意识——本文给数学式 b(1−b)，PREREG 基率下限 0.13 的推导口径须回核（可能用不同 b 或含难度调整）。
- 【引申】conclave 例对「判词校准崇拜」的反驳：完美校准但零分辨率的判词无用——L1 判据 ECE<0.10 必须与 resolution/信息量并列（呼应 B6 BIN information 轴+BI 记账），防「校准但保守」假优判词。
- 【引申】winner's curse 对多判词路比较：按「跑分选最优路」则第一名大概率幸运偏倚——PREREG「一次跑完禁择优」stop-rule 正是解药（Confident 式预注册纪律），本文给理论背书。
- 【引申】backtesting 训练混淆对 future work（判词微调）是一票否决级警示：任何「用历史对局训练判词路」提案必须先解「惩罚记忆化」——或转 A2 FBSim 式 procedural 生成（每局新世界=记忆无用）。

## 存疑与待验证
1. 附录 A-E 未读（检索泄漏更多例/竞赛形式化/label noise 证明/win-probability tradeoff）——引用附录结论前回读。
2. 「Halawi 3.8%」「Tao 10%」「Dai >90%」判定标准有作者主观成分（原文自注）——引用带 caveat。
3. venue 待核：队长令称 ICML 2025，abs 页未见标注（Consistency Checks 才是 ICLR 2025 Oral，勿混）；v1 唯一版本。

（Pitfalls 笔记完 · 2026-09-12 · 微步B11 · 锚=cache/_cache-Pitfalls-2506.00723.txt 1347 行）
