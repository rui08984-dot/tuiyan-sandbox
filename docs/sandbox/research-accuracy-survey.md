# AI 盲测准确性网调：5 问调研报告

- 调研日期：2026-09-07
- 检索渠道：web_search（当前引擎 bing）+ 本地 SearXNG(:18080) + arXiv/ar5iv/Wikipedia/GitHub 原文直抓（Invoke-WebRequest）
- 背景：回应"AI 盲测（LLM 只看狼人杀对局公开记录猜狼人）每切片命中 1-2 狼位（约 30-40%）是否偏低、别人是否更准"的质疑。

## TL;DR

1. 公开 LLM 社交推理文献测的是**阵营/对局胜率**，没有任何论文报告"每切片命中 1-2 狼位"类身份命中率；现有公开数字全部表明 LLM 在此类任务上并不"非常准"。
2. 人类顶尖玩家的身份判断正确率**无任何公开统计**，全是 anecdote。
3. 玄学预测最严格的对照实验（占星双盲、塔罗真实/随机对照）结果均为"不高于随机"；六爻/梅花易数无同行评审实验。
4. 提升 LLM 推理的通用手段有可靠增益数字（self-consistency GSM8K +17.9%、SimToM 心智理论基准 +29.5% 等），但验证域是数学/常识/心智理论基准，**没有一项在"从发言猜身份"任务上验证**。
5. 狼人杀圈"某人特别准"无统计检验；圈内已有幸存者偏差自发讨论；hot-hand 统计检验史提供了可借鉴的检验范式。

## Q1 LLM 狼人杀/Avalon/BOTC 公开项目的身份推理命中率

**结论：存在多个公开项目与论文，但指标是"胜率"而非"身份命中率"；"每切片命中 1-2 狼位"这一指标在公开文献中未找到任何实测数字。**

| 项目 | 关键数字 | 条件 | 来源 |
|---|---|---|---|
| Werewolf Arena（Google DeepMind, 2024） | 自对弈双方胜率 40–60%（除 GPT-3.5 外基本均衡）；**无信息交换时村民方胜率仅 1.2%**；预言家完美情报下村民 100% | 8 人局 LLM 自对弈评估框架 | arXiv:2407.13943 |
| AvalonBench（2023） | ChatGPT 好人方胜率 **22.2%**（规则机器人当好人 38.2%）；坏人方 66.7% vs 61.8%，论文称"明显 capability gap" | ChatGPT-3.5 / Llama2 vs 规则 bot | arXiv:2310.05036 |
| 清华系 7-LLM 狼人杀（2023） | 免微调框架、7 个 LLM 对局、发现涌现策略行为；**逐模型胜率表本轮未能取到具体数值**（arXiv 无 HTML、知乎转述 403） | Werewolf 多 agent 对局 | arXiv:2309.04658 |
| ReCon（ICLR 2024 / ACL Findings 2024） | 声称显著提升反欺骗能力；**项目页与 README 未给可直接引用的胜率数字** | Avalon，免微调 | arXiv:2310.01320；ACL 2024.findings-acl.591 |
| WereWolf-Plus（2025） | sheriff 机制 + 经验池带来相对提升；绝对命中率未取到 | DSGBench 狼人杀扩展 | arXiv:2506.12841 |
| botc-bench（GitHub） | 最多 15 个 AI agent（Claude/GPT/Gemini）玩 Blood on the Clocktower；**README 无命中率数字** | 自动化欺骗/检测基准 | github.com/NomadsandVagabonds/botc-bench |

- 与本盲测最可比的公开数字：AvalonBench 显示 LLM 在需要身份推理的好人方只有 22.2% 胜率，**显著低于**规则基线（38.2%）；Werewolf Arena 显示 LLM 无信息交换时几乎必输（村民方 1.2%）。
- **"别人能做到非常准"在公开文献中找不到支持**：没有任何论文报告"公开记录猜狼人"类任务的高准确率实测。

## Q2 人类顶尖玩家（JY/囚徒/毕游侠等）身份判断正确率

**未找到公开数据。**
- 赛事层面只有战绩记录（WPL 历届冠军名单），无"身份判断正确率"统计。
- 内容层面全是复盘视频与心得（B站 JY 相关复盘、"狼人杀复盘小尼Nate"等），无统计口径。
- 自述数字不可验证：贴吧 9 年玩家自称"站边正确率高达 99%"，无任何数据支撑。

## Q3 玄学方法（梅花易数/六爻/塔罗/占星）预测实证

**结论：最严格的两个对照实验结果均为"不高于随机"；六爻/梅花易数未找到同行评审实验。**
- 占星：Carlson (1985)《A double-blind test of astrology》，Nature 318:419–425。28 名占星家（实验流程由占星界参与制定以保证公平）将 100+ 名（116 名）受试者的星盘与 CPI 心理档案匹配；占星家无论第一还是第二选择都无法显著高于随机；Wikipedia 转述结论"natal astrology performed no better than chance"。原文 PDF 公开。另有 ISAR 立场再分析（"Support for Astrology from the Carlson Double-blind Experiment"）主张存在支持信号——属争议方，主流科学结论仍是不高于随机。
- 塔罗：Ivtzan & French（伦敦大学 Anomalistic Psychology 系，2004）《Testing the Validity of Tarot Cards: Can We Distinguish Between a Real and a Control Reading?》——真实解读（自选牌）vs 随机对照解读；**参与者无法区分真实与随机解读**（结果转述见来源）。
- 六爻/梅花易数：未找到同行评审的严格实验；仅有民间自测（知乎 2026-05：梅花/六爻/大六壬/邵子神数同测福彩 3D，非对照设计）与术数圈内方法对比文。
- 超心理总背景：Storm 等元分析显示无 psi 证据；Bem (2011) 预知实验的大规模重复失败（Mühmenthaler et al. 2022《The Future Failed》）。

## Q4 提升 LLM 社交推理准确率的已知手段与实测增益

| 手段 | 论文 | 实测增益 |
|---|---|---|
| Self-consistency（多次采样投票） | arXiv:2203.11171 | GSM8K +17.9%、SVAMP +11.0%、AQuA +12.2%、StrategyQA +6.4%、ARC-c +3.9%（绝对提升，摘要原文核实） |
| Multi-agent debate | arXiv:2305.14325（ICML 2024） | 6 个基准一致优于单 agent；增益随 agent 数/辩论轮数单调上升，>4 轮后收益递减（正文核实） |
| 过程监督验证器（PRM） | arXiv:2305.20050 | MATH 代表子集 best-of-N 解出 78%，显著优于结果监督 |
| 视角采择 SimToM | arXiv:2311.10227（ACL 2024） | BigTOM 假信念子集：GPT-3.5-Turbo 绝对准确率 +29.5%（vs 0-shot）/ +14.2%（vs 0-shot CoT）——最贴近"社交推理"的增益数字 |
| 更长思考（long CoT / o1 类） | — | **未找到**在社交推理/狼人杀类任务上的公开实测数字 |

- 注意：上述增益全部来自数学/常识/心智理论基准，**没有一项在狼人杀式"从发言猜身份"任务上验证**——不能直接推断能把这个盲测从 30-40% 显著拉高。

## Q5 狼人杀圈「某人特别准」的统计检验 / 幸存者偏差

**未找到任何正式统计检验。** 相关佐证：
- 圈内已有自发的幸存者偏差讨论：B站 UP"狼人杀忽悠陈师傅"系列视频 1.7 节专门讲"幸存者偏差：存活玩家对局势的过度乐观解读"。
- 玩家社区对随机基线有朴素认识：知乎网杀技巧文指出"投骰子都有 50% 的站边率"。
- 自述"99% 正确率"（贴吧）无数据验证，属典型 anecdote。
- 方法论类比（可借鉴的检验范式）：hot-hand fallacy 检验史——Gilovich, Vallone & Tversky (1985) 用序列统计证明篮球"手热"仅为随机感知，Miller & Sanjurjo (2018) 修正序列选择偏差后发现小幅真实效应。要检验"某主播神判"，需要预注册的逐局记录 + 二项/序列检验；公开渠道没有这样的狼人杀数据。

## 来源列表

Q1（LLM 社交推理）：
1. https://arxiv.org/abs/2309.04658 —— Exploring LLMs for Communication Games: An Empirical Study on Werewolf（清华系 7-LLM）
2. https://arxiv.org/html/2407.13943v1 —— Werewolf Arena（40-60% 自对弈、无信息村民 1.2%、完美情报 100%）
3. https://arxiv.org/abs/2310.05036 与 https://avalonbench.github.io/ —— AvalonBench（22.2% vs 38.2%、66.7% vs 61.8%）
4. https://arxiv.org/abs/2310.01320 与 https://aclanthology.org/2024.findings-acl.591/ —— ReCon（Avalon 反欺骗）
5. https://arxiv.org/pdf/2506.12841 —— WereWolf-Plus（DSGBench 扩展）
6. https://github.com/NomadsandVagabonds/botc-bench —— BOTC AI 基准
7. https://github.com/xuyuzhuang11/Werewolf —— 清华论文官方代码
8. https://zhuanlan.zhihu.com/p/659899800 —— 清华 7 模型狼人杀中文转述（403，未能直读）
9. https://cuboulder-ds.github.io/CSCI-5423-Final/ —— Werewolf Among Us（163 局人类数据 vs LLM 对比框架）

Q2（人类玩家）：
10. https://zhuanlan.zhihu.com/p/1981358970791817585 —— WPL 历届冠军纪录（无正确率统计）
11. https://tieba.baidu.com/p/6387098923 —— 自述"正确率高达 99%"（无验证）
12. https://www.bilibili.com/video/BV12SNA6PEaw/ —— JY 相关复盘视频（anecdote）

Q3（玄学实证）：
13. http://muller.lbl.gov/papers/Astrology-Carlson.pdf —— Carlson 1985 Nature 原文
14. https://en.wikipedia.org/wiki/Astrology_and_science —— 28 占星家 / 100+ 受试者 / no better than chance
15. https://www.researchgate.net/publication/326786370_Support_for_Astrology_from_the_Carlson_Double-blind_Experiment —— ISAR 再分析（争议方）
16. https://extraordinarybus.wordpress.com/2010/09/21/tarot/ —— Ivtzan & French 塔罗结果（无法区分真实/随机）
17. https://www.researchgate.net/profile/Christopher-French-4/publication/266041454 —— 塔罗实验设计原文
18. https://zhuanlan.zhihu.com/p/2039193836870689416 —— 民间四术数同测 3D（非对照）
19. https://gwern.net/doc/psychology/parapsychology/2022-muhmenthaler.pdf —— Bem 预知大规模重复失败
20. https://en.wikipedia.org/wiki/Parapsychology —— Storm et al. 元分析无 psi 证据

Q4（LLM 增强手段）：
21. https://arxiv.org/abs/2203.11171 —— Self-Consistency（+17.9% 等，摘要原文）
22. https://arxiv.org/abs/2305.14325 与 https://composable-models.github.io/llm_debate/ —— Multiagent Debate
23. https://arxiv.org/abs/2305.20050 —— Let's Verify Step by Step（78% MATH 子集）
24. https://arxiv.org/abs/2311.10227 与 https://aclanthology.org/2024.acl-long.451/ —— SimToM（+29.5% / +14.2%）

Q5（幸存者偏差）：
25. https://en.wikipedia.org/wiki/Hot_hand —— hot hand 检验史（1985 + reanalysis）
26. https://www.bilibili.com/video/BV1szGHzJEtH/ —— 狼人杀圈幸存者偏差讨论
27. https://zhuanlan.zhihu.com/p/15054338559 —— 网杀技巧（"投骰子都有 50% 站边率"）

## 局限与未决

- 知乎（403）、百度贴吧（安全验证）反爬，arXiv 对 2023 年中以前的论文无 HTML：2309.04658 的逐模型胜率表、Carlson 实验精确百分比、塔罗实验原始数据表未能取得一手数字，正文均已如实标注。
- 本地 SearXNG 本轮返回的 sources 为非结构化文本（仅作线索），中文结论主要经 web_search（bing）与原文直抓核实。
- 所有数字均为来源片段直引，未做二次换算或推断。
