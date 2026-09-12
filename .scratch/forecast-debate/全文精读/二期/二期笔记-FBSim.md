# 二期笔记 · ForecastBench-Sim · 微步A2

> 论文：ForecastBench-Sim: A Simulated-World Forecasting Benchmark（arXiv:2606.18686，**v1** 唯一版本，2026-06-17；abs 页 2026-09-12 实抓确认）
> 作者：Jaeho Lee / Nick Merrill / Ezra Karger（Forecasting Research Institute；Lee 通信作者 brown.edu；Karger=FB 原论文一作）。体量：workshop paper（ICML 2026「Forecasting as a New Frontier of Intelligence」workshop spotlight，I 文档 §三.1 口径）。
> 获取路径：abs 页（web_fetch）→ arxiv.org/html/2606.18686v1 → pwsh Invoke-WebRequest raw HTML 128,228 B → _extract-html.cjs 抽 txt 37,048 B/792 行（配方=微步A1 沉淀，本篇公式少但全程沿用）。
> 缓存：cache/_cache-FBSim-2606.18686v1.html + _cache-FBSim-2606.18686v1.txt（**行号锚=此 txt**）。NNN 编号按 A 梯队顺序本篇应占 002，但本篇正文无重公式，md 版省略（txt+html 为准）；若后续需 md 版再补爬。
> 恢令四重点：①Freeciv rollout 即时结算机制 ②任意时距与反事实题构造 ③匿名人类 pilot 设计 ④与我们 sim 工厂可比性（④主要在落地点/引申节）。

## 【事实层】

### 即时结算机制（恢复令重点①；§2.1，txt L200-204）
- 基底：Freeciv（开源回合制策略，仿文明系列）game rollouts，建在 **CivRealm 基建**（Qi et al., 2024）之上（L188）。
- 流程原文：每 world=多文明演化（城市/科技/领土/国库/外交/冲突）；**固定快照 turn 60**，更晚 turn 对预测者隐藏；future 在 scoring 前生成但预测时不可见（L202）。结算=继续跑模拟，分数对着模拟产生的隐藏未来算（L177, 188）。
- 输入面：**world report**（结构化文本+表格+历史+地图/报告证据），模型与人类共用同一报告——刻意避开外部 web search 的检索混淆（L204）。
- 题量组成（Table 1，L206-231）：Binary 4,655 题（模板10/世界11，H1-H7）；Continuous 2,310（6/11，H1-H7）；H0 binary 562（10/11）；H0 continuous 165（3/11）。
- 主 run 规模（§4，L257）：binary 4,655×**30 模型**；continuous 2,310×**31 模型**；curated 完整覆盖子集=9 模型。

### 任意时距与反事实题构造（恢复令重点②；§2.2+§3，txt L233-253）
- 视界定义原文：H1-H7=turn 60 后每 30-turn 增量（turn 90→270，约典型对局后半）（L237）；H0=快照状态本身=**理解检查非预测题**（L237, 541）。
- matched 对设计：同 report 出配对题——binary 问「t 回合 X 国库是否超阈值」，continuous 问「X 国库届时值本身」（L235）。
- 连续题引出 5 分位：p10/p25/p50/p75/p90（L237）。
- **三 regime 分类（§3 核心表，L245-251）**：
  1. Unconditional：$P(Y)$，固定 report；=现实基准的最近类比（L247）。
  2. Observational conditional：$P(Y\mid X)$，从模拟世界**语料**的自然变异中采样共现；**尚未进发布 artifact**（L251）。
  3. Interventional：$P(Y\mid\mathrm{do}(X))$——**copy savegame → 施加干预 → rollout 修改世界 → 对干预世界结局计分**；现实基准无法做（只实现一个历史），模拟器把因果题变成可计分题：每个分支产生独立 ground truth（L245, 249）。
- 现有干预试点两种：政府切换为 Republic（9 curated 模型 mean intervention gain 全正 +0.029~+0.057）；国库 +500 gold（+0.013~+0.062）（L249）。
- **placebo 措辞对照（Opus 4.5 Republic 试点）**：null-conditional 措辞 Brier 0.165 vs 0.169 基线几乎不变；真 Republic conditional 升到 0.360 → 模型响应不是条件措辞本身所致（L249, 711-713）。
- 尾风险样本：treasury 连续模板 actuals 低于模型自报 p10 的份额随视界升至 **~50%（H6-H7；名义 10%）**（L253, 719）；该例改写自 companion anonymous analysis=**「Is capability a liability?」（即 A3 待读件 2605.22672，参考文献 L287-292 确认 Anonymous 2026 对应关系）**。

### 计分协议（§2.3，txt L239-241）
- Binary=Brier；Continuous=**CRPS（由 5 分位计算）**，按 family 固定值域归一：cities 40 / technologies 60 / treasury 2000——三连续模板可平均而不改单题计分规则；**值域=人类试点 bin 边**（模型与人同尺度）（L241）。
- H0 分数单独报告不入前瞻分（L241, 541）。


### 验证结果（§4+附录 D，txt L255-267, 613-691）
- 9 curated 模型跨距：H1-H7 binary Brier **0.220（GPT-5.1）~0.313（Gemini 2.5 Flash）**；normalized CRPS **0.283（o3）~0.590（Gemini 2.5 Pro）**——Brier 跨 ~40%，CRPS 跨一倍（L257）。
- **跨基准相关**：FB-Sim binary Brier vs ForecastBench Dataset Brier Spearman ρ=+0.43（p=0.018，N=30 重叠模型）；vs Epoch Capabilities Index |ρ|=0.48（p=0.007）（L257）。逐视界（Table 3，L625-685）：H1 最强（Brier×ECI +0.634***；Brier×FB-Dataset +0.630***），中期 H3-H5 减弱（H5 0.172 ns），H6-H7 回升（+0.361*~+0.477**）——**视界 U 形**。
- 视界难度结构：Brier 0.205（H1）→0.264（H7）中途 H5 峰 0.287；CRPS 0.134（H1）→0.639（H7）单调升 **4.8×**（L261）。
- **H0 理解检查（附录 B，L539-603）**：9 curated 全部 H0 binary Brier<0.032（最好 GPT-5 mini 0.0002）、H0 nCRPS<0.024（多数 0.0000）→ 前瞻误差非读报告失败所致（L263）。逐模型：Gemini 3 Pro H0 binary 0.0319 最差；GPT-5 0.0035；Claude Sonnet 4.5 0.0142（L551-603）。
- binary 与 continuous 排名不同序（L259, 699-700：「related but not identical」）。
- 模板×视界难度异质：technologies 可预测性好于其他模板（L701）。

### 匿名人类 pilot 设计（恢复令重点③；§4+附录 C，txt L265, 605-611）
- 设计：**10 参与者×24 连续题×5 bin 分配=240 个预测**；2 个世界报告；模板=city/tech/treasury @ H1/H3/H4/H6；5 bin 边=CRPS 归一值域（人与模型同尺度）（L607）。
- 匿名化原文枚举：去除 raw survey identifiers、timestamps、demographics、consent fields、free-text comments、mouse/click events（L607）。
- 结果数字：个人 mean normalized CRPS **0.171**；**crowd mean 0.154**；**uniform-bin 基线 0.152**——crowd 聚合相对个人有帮助，但**没有明确跑赢无知基线**（L609）。
- 作者定性原话：「consistent with the study being small, general-population, and cognitively demanding; it motivates a larger and more carefully powered human baseline rather than supporting a strong human-vs-model claim」——定位=可行性检查非模型对比（L265, 609）。
- Figure 5 附注：人类 24 题 2 世界 vs 模型 proxy 用同模板/视界族的大题集——**非配对头对头**（L611）。

### 定位与局限（§5-§7，txt L269-283）
- 作者三条主贡献自述（L283）：①固定 report 上的无条件 binary+分布预测 ②配对干预 rollout 的可计分因果条件题 ③破坏性结局的密采样（支持即时结算尾风险分析）。
- 未来工作（L271-275）：**多 seed rollout N 次对经验事件频率结算**（把单次噪声实现换成接近模拟器真生成概率的目标——「only possible because the world is simulated」）；顺序预测（多快照更新）；反事实一致性检查（同目标多条件措辞验证概率公理，引 Paleka 2025b）；其他基底（Concordia 社会模拟/流行病 ABM 尾风险材料）。
- 局限原文枚举（L279）：非真实世界替代品；Freeciv 简化 stylized；report 格式影响双方；人类仅 pilot；**条件/因果 artifact 是 demonstration 非满功率干预基准**；固定规则集+**规则式 AI 对手**（无自适应人类样对手，技能迁移存疑）。

## 【结论层】（三态）

- 【已核】作者声称：模拟基底可补真实世界基准三大结构性限制（结算慢/尾事件稀/反事实不可计分），且 FB-Sim 排名与 FB Dataset、ECI 相关（ρ=+0.43/+0.48）——workshop paper 自我定位为「可复用评测基底」非最终排名（L283）。
- 【已核】干预 regime 的 intervention gain 9 模型全正 + placebo 对照成立——因果条件题在模拟世界可计分且模型响应非措辞伪影（demonstration 级，作者自认未满功率）。
- 【已核】H0 理解层与前瞻层分离：读报告不是瓶颈（H0 Brier<0.032 vs 前瞻 0.220-0.313）。
- 【已核】人类 pilot crowd（0.154）未明确胜 uniform 基线（0.152）——作者如实自报，本棒标【已核】；对「AI 已达人群水平」叙事是小样本警示信号（不外推）。
- 【转述】与 2605.22672 的关系：FB-Sim 提供 substrate，反缩放论文提供「强模型尾风险更差」的分析——同一题族两文互补（本文 L253/717-719 自引 Anonymous 2026）。

## 【数学层】公式编号清单

本篇为 workshop 论文，正文无编号公式；定量结构全在计分协议与相关系数：

| 项 | 内容 | 变量/条件 | 出处 |
|---|---|---|---|
| S1 | Brier score（binary） | BS=(p−o)²；H1-H7 前瞻 | §2.3 L241；引 Brier 1950 |
| S2 | CRPS（continuous，5 分位诱导） | 分位 p10/25/50/75/90；按 family 归一：cities 40/techs 60/treasury 2000 | §2.3 L241；引 Gneiting-Raftery 2007 |
| S3 | 归一化对齐约束 | CRPS 值域=人类试点 bin 边（模型与人类同尺度前提） | §2.3 L241＋附录 C L607 |
| R1 | 三 regime 记号 | $P(Y)$ / $P(Y\mid X)$ / $P(Y\mid\mathrm{do}(X))$，同一 proper scoring rules 跨 regime | §3 L245 |
| R2 | 视界映射 | H_k=turn 60+30k（k=1..7 → turn 90..270） | §2.2 L237 |
| C1 | Spearman 相关（跨基准效度） | ρ=+0.43 (p=.018, N=30) vs FB-Dataset；\|ρ\|=0.48 (p=.007, N=31) vs ECI；H1 最强 +0.630/+0.634 | §4 L257＋Table 3 |
| T1 | 尾风险欠覆盖量 | P(actual<自报 p10) 名义 10% → 实测 treasury 模板 H6-H7 ~50% | §3 L253＋Fig.12 |
| P1 | placebo 三臂 | null-conditional 0.165 / baseline 0.169 / 真 conditional 0.360（Opus 4.5） | §3 L249＋Fig.11 |

## 本项目落地点（sim 工厂可比性=恢复令重点④；照 M-全拟真模拟方案/p13 sim 工厂挂钩）

1. **架构同构对照**：FBSim=「模拟器+固定快照 report+模板出题+继续 rollout 即时结算」——与我们 sim 工厂「多智能体模拟+状态快照+预测卡+继续推演结算」同构；差异点：FBSim 用游戏引擎（Freeciv 规则确定性）+规则式 AI 对手，我们是 LLM 驱动社会模拟（对手=自适应 LLM）——**我们的结算噪声更大，需 FBSim §5 的多 seed rollout 思想补**。
2. **H0 理解检查层可直接抄**：R-A 读数门（重跑拆分实验）=同思想；FBSim 给出量化标尺——读数检查 Brier 应在 <0.03 量级才可判定「读数非瓶颈」，我们 v1_evidence 读数门的合格线可参照此量级预注册。
3. **matched binary/continuous 对**：同状态出「是否超阈值」+「值本身」配对题——预测卡 L0 可加配对题族，binary Brier 与 CRPS 分开记（FBSim 实证两排名不同序 L259/699）。
4. **fork-mutate-rollout 干预分支**：对应我们「B1(a) 信息差」与 M 方案的对照臂设计——FBSim 的 placebo 三臂（null 措辞 0.165/基线 0.169/真干预 0.360）是现成的消融模板，防「条件措辞伪影」。
5. **5 分位连续题+CRPS 归一**：预测卡 L1+ 可从点值升级为 5 分位；归一值域按题族固定，兼容跨族平均与人机同尺度。
6. **人类 pilot 的坑位预警**：10 人 crowd 没跑赢 uniform 基线——若我们做人类对照臂，量级要够（FBSim 自认 underpowered），且普通人群×高认知负担会压低 crowd 质量。
7. **视界设计标尺**：H1-H7 等距 30 turn 且 CRPS 4.8× 单调上升——我们多步推演窗口的难度-视界曲线可同法标定（每档视界单独记分）。

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】FBSim×我们沙盘的最大接口差：FBSim 结算真值来自确定性引擎（同 savegame 继续跑必得同一未来，除非多 seed），我们的 LLM 模拟每条轨迹都是「另一个世界」——我们天然活在 FBSim §5 设想的「多 seed 经验频率结算」世界里，结算应记分布（结算=轨迹簇频率）而非单点，与 wolf 记忆「LLM 出逻辑不出数字+账本」纪律互洽。
- 【引申】干预 gain 的方向性可移植：FBSim 干预=把 X 设为反事实值后世界分支重跑；我们的「玄学对照臂」本质是 do(玄学输入) 的 placebo 结构——Fig.11 三臂设计（真干预/零干预措辞/无干预基线）可直接改造成玄学臂的预注册消融（严格娱乐参考标注下）。
- 【引申】H1 相关最强、H4-H5 相关最弱的 U 形：短视界预测力≈通用能力，中视界依赖题族知识——我们的多步推演若要证明「预测力」而非「能力」，中视界档应加域知识对照题。
- 【引申】FBSim 不给检索工具（刻意隔离检索混淆）——与 BLF（检索为主）构成两端；我们 sim 工厂目前无检索，判断题质量时应自知处于 FBSim 端而非 FB 端，「预测力」外推到真实世界要打折。

## 存疑与待验证

1. 人类 pilot 细节（招募渠道/ bin 边具体数值/报酬）在附录 C 正文被压缩，发布 artifact 细节未核——引用 0.171/0.154/0.152 三个数时注明「10 人小样本 pilot」。
2. Table 2 的 H0 逐模型数与 Figure 6-12 的 leaderboard 细节只抄了文本叙述部分（图内数字不可从 HTML 文本抓取）——引用 Figure 类结论需回 PDF/原图核对。
3. interventional pilot 的「两干预×两措辞」题目量与 power 计算未给出（作者自认 demonstration）——不可当效应量引用。
4. Anonymous (2026)=2605.22672 的对应关系由参考文献条目+「companion anonymous analysis on the same question family」措辞推断【已核·引用关系】，两文题族是否完全同一需 A3 精读时交叉核对。
5. CivRealm（Qi et al., 2024）基建细节未读——若 sim 工厂要复用 Freeciv 路线需另立微步读 CivRealm。

（FBSim 笔记完 · 2026-09-12 · 微步A2 · 锚=cache/_cache-FBSim-2606.18686v1.txt 792 行）
