# 查阅A · 外部对标（推演沙盘项目专家研讨会 · 2026-09-13）

> 执行者：查阅 A 棒（外部对标查阅）。任务=四路联网调研，为研讨会提供外部坐标。
> 证据三态沿用 A 棒纪律：【已核】=本轮 WebFetch 实抓原文页（arXiv abs 页 / GitHub README）；【转述】=搜索引擎工具引文摘要，正文未实抓；【待验证】=不当证据用。每条带 URL 与信息时点。
> 工具边界实录（本轮实测）：WebSearch 约 1/4 调用超时或被内容过滤（Kalshi 收购查询两连败后换词才通）；PDF 不抓；metaculus.com 主域未直抓（A 棒已知 403 陷阱，本轮未试）；help.metaculus.com DNS 解析失败；Semantic Scholar 未试。
> 覆盖面声明：以英文文献/平台为主，狼人杀产品侧补了中文检索；公司内部未公开的工作天然不可见。**「未找到」≠「不存在」**，§2 的空位结论以本轮检索范围为准。

---

## §0 调研范围与时点声明

- **检索时点**：2026-09-13（当日全部搜索与实抓）。
- **四路范围**：①预测平台机制对标（Metaculus / Good Judgment Open / ForecastBench / Polymarket / Kalshi / Manifold）；②LLM 预测文献 2025-2026（基准、一致性/矛盾信号、ACI）；③狼人杀/Avalon 对局 AI 与场外参谋竞品；④可借鉴方法与工具（校准报表规范 / 平台 API / conformal 库）。
- **与本地已有调研的关系**：A-学术调研.md（三回合 6 问）、I-T1复测-2026.md（ForecastBench 口径三变、BLF/AIA 平价线）、G-合并.md §7/§8（三文三口径对照、ECE 下界纪律）已覆盖「LLM vs 人类预测力实测」与「conformal 方法谱系」；本报告**不重复**其已核结论，只补其空白：平台机制设计、命题 A 空位、对局产品形态、工程工具链。
- **服务对象**：施工路径 12 项之后怎么走更好（§4 每条注明接入点）。

---

## §1 预测平台对标表（2026-09 时点）

### 1.0 对标总表

| 平台 | 结算规则（settlement） | 校准披露 | 预注册/冻结 | 分层/难度处理 | 与本项目差异 |
|---|---|---|---|---|---|
| **Metaculus** | 每题发布时写定 resolution criteria，写作规范明文要求"criteria 应几乎不留裁量空间"；无法客观结算的题正式归类 **ambiguous / annulled**（非强行结算）【转述：metaculus.com/question-writing、help/question-checklist、API docs 的 ambiguous/annulled 分类】 | FAQ/校准文档公开社区预测的校准曲线与历史 Brier（0.107@2021 为 A 棒已转述口径）；计分=校准+精度（peer score 相对计分，题难度进 peer 分母）【转述】 | 题目创建即公开结算标准（事前公开），但**无冻结哈希/版本化审计流程**【转述+归纳】 | 无先验「可预测性分层」；难度隐含在 peer/relative score 里【转述】 | 本项目 PREREG 三冻结+checklist_hash 选题键比平台公开实践**更硬**；项目六层分类 Metaculus 无对应物 |
| **Good Judgment Open** | 题目带结算说明；Brier 按题生命周期平均计分【转述：gjopen.com 首页/FAQ 快照口径】 | 个人资料页有校准图（业界惯例）【转述】 | 同上：事前公开、无冻结审计【归纳】 | 无分层 taxonomy【归纳】 | 差异同 Metaculus 行 |
| **ForecastBench** | 题源来自各平台+官方结算，收录延迟 50 天保排名稳定；**难度调整 Brier→Brier Index（BI=100×(1−√mean BS)）+双向固定效应分离题目难度与预测者能力**【已核（I 棒 2026-09-11 实抓官网/Changelog，本轮未重抓，口径以 I 棒件为准）】 | 公开三榜单（Tournament/Baseline/Preliminary）实时披露【已核（I 棒）】 | 题集动态免泄漏设计（提交时无已知答案）=「事前性」的基准级实现【已核（A 棒）】 | **难度调整是事后统计估计，不是先验可预测性分类**【已核（I 棒口径+本轮归纳）】 | 最接近项目的「统一账本+难度分层」外部锚，但 BI 是排行榜口径，非结算纪律；项目 g2_regime 分层是按产生机制先验分类，FB 无此物 |
| **Polymarket** | 每市场创建时预定义 resolution rules（来源、截止、歧义标准）；结算走 **UMA Optimistic Oracle**：提案人押 ~750 USDC.e 提交结果 → 2h 挑战窗 → 争议触发 UMA 币持有人投票定案，正确投票者获奖励【转述：docs.polymarket.com/concepts/resolution、OddsShopper、Orochi Network 2025】 | 市场价格即概率披露，**无系统性校准报表**（价格≠校准账本）【转述+归纳】 | 规则事前公开+押金机制=经济激励版的「预注册」；2025 年持续有歧义规则争议（如 "Strategy sells BTC by May 31" 市场）与 oracle 操纵风险讨论【转述：Murmurations substack、Allium blog】 | 无分层【归纳】 | 项目的「预注册+冻结+抽检」是**程序性纪律**，Polymarket 是**博弈性纪律**；两者互补不可互替 |
| **Kalshi** | CFTC 监管的 DCM，每合约有合约规则与指定结算源；争议走监管化申诉【转述：aurum.law 2026 指南、Harvard JOLT】 | 无公开校准报表（交易所不披露）【归纳】 | 合约规则事前公开【归纳】 | 无分层【归纳】 | 2025-11 融资 $1B、估值 $11B（TechCrunch）【转述】——行业进入爆发期，为项目「预测万物」定位提供行业面顺风 |
| **Manifold** | 创作者自定结算、自由建市场；**play-money（Mana 无 cash value），2025-02 起结束 sweepstakes 回归纯 play-money**【转述：cryptoslate review、manifold docs】 | 平台统计页有校准数据但无权威报表【转述】 | 最弱：无制度化预注册【归纳】 | 无分层【归纳】 | ⚠ 检索过程曾出现「Kalshi 收购 Manifold」说法，**专项核实为不实**：无任何收购证据，两家 2025-2026 仍是竞争对手（Kalshi 融资、Manifold 独立运营）【转述：多轮搜索反证】 |

### 1.1 专项一：有没有平台做了「可预测性分层 taxonomy」？

**本轮未找到任何平台级先验分层 taxonomy。** 相关物三件，均为「事后/统计/单项」形态：

1. **ForecastBench 难度调整 Brier / Brier Index + 双向固定效应**【已核（I 棒 2026-09-11 件）】——难度是**事后从数据估的统计量**，不是先验的产生机制分类。
2. **Reciprocal Scoring**（Karger, Bastani, Yueh-Han, Jacobs, Rosenberg, Monrad, Mellers & Tetlock；SSRN 3954498，2021；JDM 2023 刊出版）【转述：SSRN 摘要+Wharton PDF 快照】——处理「不可回答/不可结算问题」的启发式计分法（让预测者互测对方预测），是项目 L5「不可约层」的**结算方法学参照物**，但它是单篇方法论文，不是平台功能。
3. **LEAF 基准**（arXiv:2605.16358，2026-05-09 提交，Tan/Parmar/Goyal/…/Pfister，Google+学界合作）【已核 abs 页】——摘要提到股票域「LLM 在其自信判定为更可预测的标的上表现更好」，是**模型自评可预测性**，非平台分类。

**判定**：项目的六层分类（L1 决定论/L2 系综/L3 短窗混沌/L4 自反/L5 不可约/L6 对抗）按**产生机制先验分层**，截至 2026-09-13 检索范围内无平台或基准实现同构物。注意：学术上「可预测性分类」散见于各域（天气可预报性、经济不可预测性文献），项目独特点在**把分层做成结算与账本的第一公民**，此组合未找到。

### 1.2 专项二：settlement criteria 预注册+冻结流程有没有公开平台做？

- **事前公开**：业界标准（Metaculus 写作规范、Polymarket 每市场规则、Kalshi 合约规则）【转述】。
- **冻结+版本化+审计级流程（本项目 PREREG/checklist_hash 形态）**：**未找到任何平台公开采用**。Polymarket 有押金+争议投票（经济机制替代程序机制）；Metaculus 有 ambiguous/annulled 兜底类目（承认结算失败是常态）【转述+归纳】。
- **判定**：项目的「预注册冻结」作为**个人账本工程纪律**仍属稀缺形态；但话术应表述为「平台公开实践以事前公开+事后兜底为主，无冻结审计流程」，而非「无人做预注册」（后者会被 Polymarket 规则页反驳）。

### 1.3 项目差异化声称在 2026-09 时点是否仍成立？

**「分层+预注册+校准账本」三元组合声称：检索范围内仍成立**（各单项业界皆有近亲，三元同构物未找到）。但两点修正建议（详见 §5）：
1. 「全网空白」应降格为「未找到同构物」——Polymarket 的市场级预定义规则与 ForecastBench 的难度调整分别是预注册与分层的最强近亲，引用时应点名以示知道它们、说清差异。
2. 行业时钟在走快：Kalshi 估值 $11B（2025-11）、Polymarket 规则争议公开化、ForecastBench 口径 2025-10 起三变（I 棒已核）——平台侧对「结算质量」的痛点正在显性化，项目定位踩在风口上，但也意味着窗口期不等人。

---

## §2 LLM 预测文献扫描（2025-2026）

### 2.1 基准与榜单更新（I 棒件之外的增量）

| 基准 | 时点 | 要点 | 状态 |
|---|---|---|---|
| **LEAF**（arXiv:2605.16358） | 2026-05-09 提交 | 首个「living benchmark」：递归检索 agent + 双 agent 交叉验证；任务=未来事件概率/趋势/时序三合一；股票域发现「LLM 在自评更可预测的标的上更好」【已核 abs 页】 | 新基准，未进项目账 |
| **PolyBench**（arXiv:2604.14199） | 2026-04-03 提交 | Polymarket 快照基准：38,666 二元市场+CLOB 订单簿+新闻流（2026-02-06~12 采集）；7 SOTA 模型仅 2 个正收益且「普遍高置信」→ 语言流畅≠概率推理【已核 abs 页】 | 新基准；其「高置信亏损」发现是 LLM 过自信又一证 |
| **QuantSightBench**（arXiv:2604.15859） | 2026-04【转述】 | LLM 定量预测+预测区间；含「置信水平间内部一致性」检验【转述】 | 待验证 |
| **Bench To The Future**（arXiv:2506.21558） | 2025-06【转述】 | Pastcasting：封闭 RetroSearch 环境里预测已结算历史事件，防前瞻泄漏【转述】 | 待验证 |
| **Automating Forecasting Question Generation and Resolution**（arXiv:2601.22444） | 2026-01【转述】 | LLM 自动出题+自动结算，自称 ~96% 无歧义率；直接以 Metaculus 结算实践为对照【转述】 | 待验证；与项目「corpus 出题自动化」同构，值得精读 |
| **ForecastBench 主线** | 2025-10→2026-08 | 三榜单制+Brier Index+题源换血（RAND 退、Kalshi 进）——I 棒 2026-09-11 已核，本轮搜索侧另见 FRI 口径「平价外推 ≈2026 年底（95%CI 2025-12~2028-01）」与 I 棒件一致【转述：forecastingresearch.substack】 | 不重复 I 棒 |
| **How Proper Scoring Rules Shape LLM Forecasting**（arXiv:2608.28482） | 2026-08【转述】 | 五种 proper scoring rule 作奖励信号比较——**已在项目 G-合并 §9 书单留档**，本轮确认其存在与主题 | 项目已知，无新信息 |

### 2.2 ⭐ 命题 A 空位核实（本节最关键，如实报告）

> 命题 A =「机械矛盾特征层（对局账本的确定性代码产物）接到 LLM 概率输出，测其 Brier 边际贡献，对局数据域」。
> 检索策略：三轮关键词族（contradiction detection×forecast×calibration / knowledge conflict×calibration / structured features×LLM×Brier），含多次超时重试。

**结论：未找到同构物。命题 A 的空位声称在本轮检索范围内维持。** 找到三个相邻家族，逐一家族报告差异：

**家族一：一致性信号（consistency-as-signal）——全部是内源信号，无外生机械特征。**
1. 【已核】**Calibrating Large Language Models with Sample Consistency**（Lyu, Shridhar, Malaviya, Zhang, Elazar, Tandon, Apidianaki；arXiv:2402.13904，AAAI-25 刊出，~96 引）：置信度来自**多次随机采样的分布一致性**（agreement rate / 语义一致性 / token 级内部一致性），用于判别答案正确性。URL: https://arxiv.org/abs/2402.13904 。差异：信号=模型自身采样方差（内源）；无矛盾特征层；无 Brier 边际贡献分解。
2. 【已核】**When Agents Disagree With Themselves: Behavioral Consistency as an Uncertainty Signal for LLM Agents**（Aman Mehta；arXiv:2602.11619，v1 2026-02-12 / v2 2026-07-15，ICML 2026 workshop）：同一 agent 重复跑的行为轨迹分歧作「免训练黑箱不确定性信号」（8,000 runs，AUROC 0.62-0.78，selective prediction）。URL: https://arxiv.org/abs/2602.11619 。差异：同为内源；无 Brier；无结构化记录特征。
3. 【已核】**What LLM Forecasters Know but Don't Say: Probing Internal Representations for Calibration and Faithfulness**（Sarfati 等；arXiv:2607.08046，2026-07-09）：隐藏状态探针比模型输出更校准，CoT 忠实性存疑（预测在推理开始前已定）。URL: https://arxiv.org/abs/2607.08046 。差异：内源探针路线（需模型白盒）；摘要无 Brier 边际贡献；与项目「LLM 黑盒+机械件外挂」路线正交。**注意其含义**：若其「预测先于推理」结论泛化，则项目高温发散层的边际贡献可能被压缩——对项目 A2 臂（高温臂）是潜在利空信号，建议在消融解读时参考。
4. 【转述·待验证】Improving Uncertainty Calibration via Consistency（OpenReview 在审稿）：扰动下预测稳定性作置信指标。URL: https://openreview.net/pdf?id=ivXe7J6U0k

**家族二：证据矛盾→弃答/校准（QA 域，非预测域）。**
5. 【已核·弱引用】**Trusted Uncertainty in LLMs: A Unified Framework for Confidence Calibration and Risk-Controlled Refusal**（Oehri 等 9 人；arXiv:2509.01455，v1 2025-09-01）：**「证据矛盾、语义弥散、工具不一致」是弃答决策的主导驱动**——这是「矛盾特征作校准信号」思想在 QA 域的最直接公开实现。**⚠ 但 v4 已于 2026-06-11 被 arXiv Admin 撤稿（"unverifiable authorship and affiliation"），只能作弱引用**。URL: https://arxiv.org/abs/2509.01455 。差异：QA/弃答域非事件预测域；无 Brier 边际贡献；撤稿。
6. 【转述】knowledge conflict 文献群（arXiv:2506.06485 知识冲突削弱知识密集任务、2601.09760 工具-记忆冲突、2601.06842 RAG 透明冲突处理、2609.03148 冲突类型 taxonomy）：全部在 RAG/QA 域处理「参数知识 vs 上下文证据」冲突，与「对局记录矛盾特征→预测校准」不同构。URL 逐条见搜索记录；本轮未逐一实抓。

**家族三：结构化特征+LLM 混合预测（体育域，形态最近但信号流向不同）。**
7. 【已核】**From Score Matrices to Football-Aware Match-State Simulation: An Auditable LLM Harness for Exact-Score Reranking**（Shaopeng Liang；arXiv:2608.05030，2026-08-05）：英超 2025-26 前 150 场回放，Dixon-Coles 统计核+LLM 上下文评分混合，V1→V4 四代迭代（Top-1 精确比分 10.0%→14.7%）；明确自称「auditable information harness 定义每个输入字段」。URL: https://arxiv.org/abs/2608.05030 。差异：**信号流向相反**——统计模型出候选、LLM 精化（项目是机械特征→校准 LLM 概率）；有 Brier（0.5870@V1 1X2）但**无特征级边际贡献分解**；无矛盾检测；作者自认探索性+泄漏风险。
8. 【转述】NCAA 篮球多模态基准（Barnett 2025，Uconn 本科论文）与 FIFA 结构化 ML+RAG 混合（academia.edu 预印）：「结构化特征表+LLM」混合形态存在，但为竞赛/学位论文级，无 Brier 边际贡献方法学。

**空位判定小结**：三元组合 =（a）机械矛盾特征提取自结构化对局记录 +（b）作为外生信号接到 LLM 概率输出测 Brier 边际贡献 +（c）隐藏角色社交推理游戏域——三个家族分别占了「一致性信号」「矛盾→弃答」「特征+LLM」各自一格，**无一同时占三格**。附两条诚实边界：①家族一+家族二证明「矛盾/一致性→校准」的思想空间已被活跃探索（QA 域先行），命题 A 的时间窗口存在挤压，落地优先级应高于论文级调研；②本轮未覆盖 Semantic Scholar 全量引文网络与中文期刊，「未找到」的证据力=「多轮定向检索未见」。

### 2.3 ACI（adaptive conformal inference）在 LLM 预测上的应用新进展

- 【已核（I 棒 2026-09-11 件）】CPTC（arXiv:2509.02844 变点感知在线 conformal）、RCCP（arXiv:2608.10553 检索校正 conformal）、DINCO（arXiv:2509.25532 言语置信重校准）——项目 Q4 已核清单，不重复。
- 【转述】本轮增量：①**ECI（Error-quantified Conformal Inference，arXiv:2502.00818）**——把误差幅度（非仅二值覆盖反馈）并入分位数在线更新；②**ASACI（TAAI 2025）**——上下分位数分开监测的非对称区间，适合偏态时序；③**Neural Conformal Control（AAAI 2025）**——非平稳环境神经自适应覆盖。URL: https://arxiv.org/html/2502.00818v1 、https://www.csie.ntu.edu.tw/~htlin/paper/doc/taai25asaci.pdf
- 【转述】**conformal 包裹 LLM 时序基础模型分位数输出**成为 2025-2026 实用化主线（Chronos-2 出 21 档分位数、tsfm.ai 博客演示对其套 conformal 保证覆盖）：「LLM 输出+conformal 后处理」已是工程共识，但**用在事件概率预测（Brier 域）而非时序区间**的公开工作本轮未见新增。
- **判定**：ACI 本身是成熟工具域（项目 F24 外环+F18 内环设计处于共识主线上）；「ACI×LLM 事件预测×对局账本」组合未找到直接同构物。

---

## §3 对局 AI 现状（狼人杀/Avalon 线）

### 3.1 Werewolf Arena / AvalonBench 之后的增量论文

| 工作 | 时点 | 要点 | 状态 |
|---|---|---|---|
| **WOLF: Werewolf-based Observations for LLM Deception and Falsehoods**（Agarwal 等 8 人；arXiv:2512.09187） | 2025-12-09（NeurIPS 2025 MTI-LLM workshop spotlight） | LangGraph 状态机跑多 agent 狼人杀；**欺骗产生与检测分离计量**（7,320 句/100 局：狼 31% 回合说谎；同伴检测精度 71-73% 但总准确率 ~52%）；欺骗四分类（omission/distortion/fabrication/misdirection）；纯 AI 互战。URL: https://arxiv.org/abs/2512.09187 【已核 abs 页】 | 新；其「检测精度 71-73%/总准确 52%」与项目 45.1% vs 67.6% 的机械信号实验可对表 |
| **Trust, Lies, and Long Memories**（Suveen Ellawela；arXiv:2604.20582） | 2026-04-22 | 188 局多轮 Avalon+跨局记忆：声誉动态自发涌现（高声誉者入队 +46%）；**推理力越强欺骗越有策略性**（高推理组 75% vs 低 36% 先过任务再破坏）。URL: https://arxiv.org/abs/2604.20582 【已核 abs 页】 | 新；跨局记忆→声誉=项目「跨局账本」的文献先行形态 |
| **ParliamentBench / Can Agents Deceive?**（arXiv:2607.28146） | 2026-07-30 | Secret Hitler 基准——**项目 A 棒 2026-09 前已核**（16 LLM×1600 局、随机 33%/算法 45%、retention<50%），不重复 | 项目已知 |
| **Kaggle Game Arena 进入狼人杀**（kaggle.com/blog/game-arena-werewolf） | 2025-2026【转述】 | Kaggle 宣布社交推理作为其多 agent 博弈基准方向——**大厂入场信号** | 待验证（未实抓博客原文） |
| **Collaboration and Confrontation in Avalon**（EMNLP 2024）、**One Night Ultimate Werewolf**（NeurIPS 2024）、**InMind 框架**（南开/上海AI Lab）【转述】 | 2024-2025 | 对局 AI 评测线持续制度化 | 方向性登记 |
| **Optimizing Persuasive Communication in Social Deduction Games**（ACL 2026 main，aclanthology.org/2026.acl-long.250）【转述】 | 2026 | 四个社交推理基准上说服策略显著超基线 | 待验证 |

### 3.2 「对局外脑/场外参谋」竞品扫描

**未找到面向人类玩家的「实时参谋/预测外脑」消费级产品。** 现存形态三类：
1. **AI 主持/发牌**：Mafia Moderator（App Store）、Wolfia（离线 AI 主持人）【转述：App Store 页快照】。
2. **AI 对手/队友**：AI Wolves（Google Play）、阿里 AgentScope 狼人杀（7 能力 agent 与人同局）、hikariming/AIWolfGame 开源多 agent 系统【转述：商店页/AWS 博客/GitHub】。
3. **工程博客级「复盘」**：AWS 中国博客（LLM 复盘环节提取关键信息）与阿里云开发者文（局末复盘）——**是技术演示不是产品**【转述：aws.amazon.com/cn/blogs/china/using-intelligent-agents-to-play-mafia-game/、cnblogs 阿里云文】。
4. **通用游戏陪伴**：Questie.ai（看屏幕实时陪玩，非狼人杀专用）【转述】。

**判定**：「对局外脑=账本+矛盾检测+参谋卡」的**预测/校准定位**（而非复盘叙事或陪玩）在产品侧未见竞品；但「AI 复盘」作为工程模式已出现在大厂博客，认知先手存在衰减风险。另注意：Kaggle 若落地狼人杀基准，会吸引大量「局内 agent」工作——项目「局外」定位恰好错位竞争，是好事。

---

## §4 可借鉴清单（每条注明「接进项目哪一步」）

| # | 借鉴物 | 出处（时点） | 接进项目哪一步 |
|---|---|---|---|
| 1 | **Metaculus 公开 API**（/api2/ 端点，公共数据免认证：题目、聚合预测、结算状态；7,000+ 题；官方公告+Mintlify 文档+R/Rust 社区客户端）【转述：metaculus.com/api/、notebooks/15141、metaculus-metaculus.mintlify.app/api/overview】 | 可作**阶段 12「检索式预测立项」的外部语料源**：拉已结算题喂 L2/L3 层练习集，与项目自建 corpus 对表（外部基率对照）；也可作 D2 回测引擎的第二数据域（天气之外的「中等难度」域） |
| 2 | **PolyBench 快照数据集**（38,666 市场+CLOB+新闻，2026-02 快照，arXiv:2604.14199）【已核】 | 同上，作 L4 自反层天然素材（市场价格=别人对预测的预测）；且其「高置信亏损」数据可直接引作 W2 过自信论据 |
| 3 | **MAPIE v1**（2025 v1 发布；已加 adaptive conformal 方法；支持回归/分类/时序区间；2026 增量=LLM-as-Judge 风险控制+可交换性检验；BSD-3，sklearn 1.4+）【已核 GitHub README：github.com/scikit-learn-contrib/MAPIE】 | 接 **W2 校准 API 与 F24/F18 conformal 内外环**：自研内外环若遇工程阻力，MAPIE 的时序 conformal 模块可作参照实现或直接依赖；其「可交换性检验」恰对应 F33「分数归一化平稳」前提的自检件 |
| 4 | **crepes / TorchCP**（crepes：Boström PMLR 2024，轻量标准 conformal；TorchCP：PyTorch 原生，JMLR 2025）【转述】 | 同上备胎位；若项目走 JS/Node 技术栈则两者都不直接可用，但其算法伪码是实现参照 |
| 5 | **校准报表规范四件**：①reliability diagram 必须带各 bin 使用频数（ECMWF 建议）【转述：ecmwf.int elibrary 2003/11401】；②ECE 必与 RBS/Brier 同报（binned ECE 有偏，RBS 是 canonical 校准误差的无偏上界）【转述：metrics-reloaded.dkfz.de/metric-library/expected_calibration_error】；③分箱方案（等宽 vs 等频、bin 数）必须显式声明（binning 偏差-方差权衡）【转述：arXiv:2501.19047 ICLR blog track】；④不稳定可靠性图的替代估计（PNAS 2021）【转述：pmc.ncbi.nlm.nih.gov/articles/PMC7923594/】 | 直接接 **g2-report.cjs 与方案 5 校准仪表盘**：报表模板按「可靠性图+bin 频数+ECE+RBS+分解式 REL−RES+UNC 并列」定版——这与 G-合并 §8.2 的「ECE 只是下界」纪律同向，落成报表字段即工程化 |
| 6 | **Murphy 分解（reliability−resolution+uncertainty）**标准地位确认（QJRMS 2017 综述文指出其为验证标准方法）【转述：rmets.onlinelibrary.wiley.com/doi/10.1002/qj.2985】 | 接方案 5 仪表盘与六臂消融解读：每臂报 Brier 三分量而非单值——「校准好但分辨差」的臂一眼现形（A 棒回合 2 已确立「分辨是更重要成分」，Murphy 分解是它的报表形态） |
| 7 | **Reciprocal Scoring**（Karger 等，SSRN 3954498/2021，JDM 2023 刊出）【转述】 | 接 **L5 不可约层与「不可结算题」的账本处理**：项目 corpus 遇不可客观结算题时，目前的 tautology/deferred 处置可加「reciprocal 类结算」实验选项；同时它是「可预测性分层」方法学的外部先行者，引用时点名 |
| 8 | **WOLF 的欺骗检测指标口径**（产生/检测分离、四分类法、7,320 句粒度）【已核】 | 接 **deepwolf 嫁接（施工项 11 的 L6 命题 A 成果）**：项目矛盾特征层的报表可按其四分类对齐命名（omission/distortion/fabrication/misdirection），使消融结果与文献可比 |
| 9 | **跨局记忆→声誉动态**（arXiv:2604.20582，188 局）【已核】 | 接「对局外脑」跨局账本叙事：文献已实证跨局记忆改变局内博弈，项目账本的跨局基率表是该效应的统计版——给「为什么要跨局记账」提供文献背书 |
| 10 | **Metaculus 结算质量治理**（ambiguous/annulled 类目、admin 抽查、question-writing 规范）【转述】 | 接 **施工项 6（抽检口径）**：项目 ②抽检「只抽过门所依据的 ≥60 条」的建议可参照 Metaculus 的 ambiguous 兜底类目——账本加一列 `settlement_status`（clean/ambiguous/deferred），抽检时分层抽样 |
| 11 | **Brier Index 记账口径**（BI=100×(1−√mean BS)）【已核（I 棒）】 | 已在 I 棒 §5.2 建议列（g2 报表改记 BI）——本轮无翻案，维持 |

---

## §5 对四块议题的外部视角建议

**议题一（分层+预注册+校准账本的差异化定位）**
外部坐标显示三个单项各有强近亲：分层≈ForecastBench 难度调整（事后统计版）+Reciprocal Scoring（不可结算版）；预注册≈Polymarket 市场级预定义规则（经济版）；校准账本≈Metaculus FAQ 校准曲线（平台版）。**建议**：研讨会上把「全网空白」改写为「三元组合无同构物，各单项点名近亲后说明差异」——这既是诚实话术，也预先解除最可能的审稿人/杠精反例（Polymarket 规则页 30 秒就能搜到）。

**议题二（命题 A 落地节奏）**
空位维持但思想空间被挤压：QA 域已有「证据矛盾驱动弃答」的公开实现（2509.01455，虽撤稿但方向真实）+一致性信号家族三连发（AAAI-25/ICML26 workshop/2026-07 探针文）。**建议**：命题 A 从「调研确认空位」转入「抢跑落地」——施工项 2（命题 A 接线+证据块 3.0）的优先级应视为有时限的窗口而非普通排期；落地后消融报表建议直接按 WOLF 四分类+Murphy 三分量出，抢「首个在社交推理域做 Brier 边际贡献分解」的表述权。

**议题三（对局外脑产品形态）**
无直接竞品+大厂复盘工程已现身+Kaggle 可能入场。**建议**：不碰「实时参谋」（响应通道=自反性风险，B 棒 §5.2 已论证），把「账本+矛盾检测」的差异化钉死在「预测/校准/预注册」三个词上；若未来开源，WOLF 式可复现基准形态（结构化日志+可分离计量）是社区接受度最高的外壳。

**议题四（12 项之后的施工顺序）**
外部工具链已就位的四件可直接排入：①§4.1/4.2 的 API 语料接入放阶段 12（检索式预测立项）同批，因为 Metaculus 公共 API 免认证、边际成本低；②MAPIE 可交换性检验接 F33 自检（先检验后装 conformal，避免「对非平稳分数硬套区间」）；③g2-report 按 §4.5 报表规范一次成型（可靠性图+bin 频数+ECE+RBS+Murphy 三分量并列），避免二次返工；④L5 层的不可结算题处置方案提前借 Reciprocal Scoring 思想做设计预留（corpus 的 deferred 域正好是实验田）。另：本轮新发现对施工项 11（阶段 4 分层真跑）的一个输入——LLM 内源探针文献（2607.08046）提示高温发散层的增量可能被高估，阶段 4 跑 L3/L6 时建议把 A0/A2 臂结果与该文献对照解读。

---

## 附：本轮检索动作台账（防重复劳动）

- 实抓（WebFetch，均已核）：arXiv abs 页 ×7（2607.08046 / 2602.11619 / 2512.09187 / 2604.20582 / 2605.16358 / 2604.14199 / 2608.05030 / 2509.01455——含撤稿注记）、github.com/scikit-learn-contrib/MAPIE。
- 搜索（WebSearch，引文摘要级）：平台机制×3、命题 A 关键词族×5、ACI×1、狼人杀×4、校准报表×1、Manifold/Kalshi 核实×2、Reciprocal Scoring×1、基准扫描×2；超时 4 次（predictability taxonomy 首轮、狼人杀参谋首轮、Murphy 首轮、命题 A 2608 修复轮），均换词重试成功或改道。
- 已知陷阱沿用：metaculus.com / goodjudgment.com 403 未试；PDF 未抓；Semantic Scholar 未试。
- 本报告仅新增本文件，未改项目任何既有文件。

（查阅 A 棒完 · 2026-09-13 · 命题 A 空位=检索范围内维持，附时间窗警告）
