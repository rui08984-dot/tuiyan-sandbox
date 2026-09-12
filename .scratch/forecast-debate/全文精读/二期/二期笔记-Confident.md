# 二期笔记 · Confident at the moment of action · 微步A0-3

> 论文：Confident at the moment of action: belief miscalibration in LLM play under hidden information（arXiv:2608.24691，**v1**）
> 获取路径：pwsh 抓 abs（42.4KB）+HTML（139.4KB）→ _extract-html.cjs txt 73,000 B/1,667 行。
> 缓存：cache/_abs-Confident-2608.24691.html + _cache-Confident-2608.24691.html + _cache-Confident-2608.24691.txt（行号锚）。
> **三篇竞品中方法学最强者：有预注册+有 Brier 结算+复现批次**——两问答案与 MafiaScope/Auditing 相反，详见结论层。

## 【事实层】

### moment-of-action 口径（恢复令特核①；§1，txt L229-237）
- 定义原文：测「行动时刻的置信校准」需要两件多数评测不提供的东西：①a moment where the model states a belief about something not directly observable ②**a distinct action taken at the same operational point, elicited independently of the stated belief**——信念质量在**行动选择的位点**评估，信念-行动对应**分开**分析，两者各自对照可独立恢复的事实（L231-237）。
- 与 QA/游戏基准的本质区别：QA 里信念=被评输出本身（两刻合并）；游戏基准有行动但无隐藏状态信念引出（L239-247）。本文设置里两者**可分离观测**。
- **与我们「落注时点判词」的对应**：我们的判词=研判/落注时点显式概率+证据摘要（分离引出），本文=同结构化响应内嵌走法+信念分布（joint elicitation）——**引出架构本身在 §5 被列为 open question**（joint 可能交互污染 vs split 有重测噪声，且引 MafiaScope 34.8% 重问翻转：L1040-1042 原文「re-probing a frozen state has itself been shown to flip an answer 34.8% of the time in an unrelated instrument [15]」——[15]=MafiaScope，两文互引闭环，与我们 L1 挂账同源数字）。

### Regent Chess 设置（§3，txt L422-517）
- 变体规则：royal status 可在棋子间**秘密迁移**（Crown Shift——第 4 回合起可用、每次用后 15 moves 冷却、静默执行不耗回合）；胜利目标=吃掉对手**当前 Regent**（非固定王）；其余标准国际象棋（L435-444）。
- **内生 vs 外生隐藏状态（本文与狼人杀/MafiaScope 的本质差异）**：Crown Shift 的隐藏事实由被试 agent **自己创造且可反复修改**——「隐藏一个你形成且能改的意图」≠「隐藏一张你被发定的牌」（L411-418, 1087-1100）；这是 coverage gap 类测量能成立的前提（L1097-1100）。
- 真值机制：每次 Crown Shift 内部日志（对局中对双方与被测 agent 不可见），赛后可重放恢复任意 ply 的真 Regent——**「score a stated belief against a fact, not a proxy」**（L448-453）。
- 引出（L455-471）：每回合单结构化响应=走法+对手活子中 Regent 位置的 **top-k (square, probability) 列表+显式残余质量**；prompt 显式命名双方颜色（消歧修复对某些 seat 影响大）；top-k 引出局限自注（模型没列格≠没考虑，coverage 解读须带此 caveat）。
- 对手：固定确定性启发式（Tier-1 中难度）、不建模 LLM 信念、**源码可见**——座间比较与「oracle-vs-public 可解性上界」（§6）的前提（L473-481）。

### 计分协议（§3 Scoring，txt L483-502）
- 双人群分开不混：**capture-only**（吃子时刻该格声明概率 vs 是否真 Regent；构造性暴露偏差人群自注：被吃⇔可被吃⇔与真王反相关）＋**every-ply**（每个良构 ply 每个被命名候选格 vs 真值；富 10×、无吃时暴露偏差）（L484-492）。
- 基线=**population-matched uniform prior**（1/对手活子数，逐 ply 重算非常数）；**Brier score + paired bootstrap CI**（比较曲线同事件索引重采样）（L493-496）。
- **pre-shift 窗口排除**（board-ply<8）：规则保证原王仍是 Regent 至第 4 回合——读过规则即获结构性免费优势，公平比较必须排除（L497-502）。

### 预注册（恢复令两问核心；§3，txt L504-517）
- **四条预期在任何模型对局前写下，各带证伪条件，逐字计分不事后改写**：①top 模型不会开局优秀而是流利但误校准②非法走法率随局长上升③信念-行动 gap 存在④追踪准确率与叙事质量的不对称——第四条所需引出格式未建，**记为 not scoreable 而非硬凑**（L504-512, §4.8 L907-919）。
- 前三条=§4.1-4.2/§4.5/§4.6 结果；全部 headline 数字写作前从版本控制分析代码重推导（早前内部检查曾发现一个数字未对后续 bug 修复复验）（L513-517）。
- 另有预注册 stop-rule（S2 确认 gap 后停止花费，L898）与预注册 exposure-matched permutation null=29.2%（§4.6，L869-870）。

## 【结论层】（三态）——恢复令两问逐答

**问1：Brier/ECE/Murphy 结算统计管线？——【已核·有 Brier 无 ECE/Murphy】（三篇唯一有结算者）**
- 【已核】有：Brier score 双人群（capture-only 0.1445 vs uniform 0.0203；every-ply delta +0.059/+0.070）+population-matched uniform 基线（逐 ply 重算）+paired bootstrap CI+reliability diagram（Fig.1）+Brier 比（7.127/7.094 复现一致）——**把引出的概率分布当概率结算，是三篇中唯一**。
- 【已核】没有：ECE 数值（reliability diagram 是图，全文无 ECE 数）、Murphy 三分解、校准重映射（测而不修，ConfTuner/DINCO 只在 related work 引用）、多试验聚合。
- 【已核】结算对象差异：他们结算**隐藏状态信念分布**（对手 Regent 位置，内生可迁移），非外生事件预测——与我们「研判/预测概率结算」同构度低于表面（我们的结算对象=游戏结局/事件，外生性更强）。

**问2：预注册因果实验？——【已核·有，三篇唯一】**
- 四条预期先写+证伪条件+逐字计分（一条 not scoreable 如实记）；预注册复现批次设计（两批不合并先各自计分再比）；预注册 stop-rule（S2）；预注册 permutation null（§4.6）；撤回错误表征留痕（rank-inversion）；headline 数字内部审计重推导。
- 因果强度：仍是行为测量非干预（机制不测试，§6 自述「a plausible mechanism, not one we test」）；但「同模型仅改 deliberation budget」的 S6/S6B 对照是准干预设计。

**与 MafiaScope ECE=0.168 是否同发现族（恢复令特核③）——【已核·同族不同种，互引闭环】**
- 同族：都是「言语置信/自报概率过自信」家族——本文引 ConfidenceBench（15 模型 5 个劣于 calibrated-random）与 RLHF 高置信偏置 [9] 作共同机制层；MafiaScope 测自报置信-准确差（ECE 0.168，角色猜测，探针不回流）。
- 不同种：①对象=MafiaScope 一阶角色信念（外生固定）vs 本文隐藏状态分布（**内生可迁移**，自创自改）②时点=MafiaScope 每发言后探针 vs 本文**行动时刻**（capture-time 条件化）③口径=MafiaScope ECE（分箱置信-准确差）vs 本文 Brier 比均匀基线+命中率（**无 ECE 数**）④分布=MafiaScope 平台型（45% plateau）vs 本文**双峰**（ConfidenceBench 独立佐证 25% floor/80-100% band 双峰）。
- 互引：本文引 MafiaScope 两处（closest prior instrument in kind [15]＋34.8% 重问翻转=split 引出噪声证据）；MafiaScope 未引本文（v2 早于本文 2026-08，时序上不可能）。

**四重点速答**：①测=行动时刻信念校准（Brier 双人群+命中率+覆盖+深度退化）②没测=ECE 数/Murphy/校准修复/多座全电池（自列清单）；有预注册+复现+oracle 上界（方法学最强）③规模=80 局全电池（S1）+4 小样本座（8-24 事件），双供应商，隐藏王位象棋 ④开源=未在正文给出 repo/数据发布声明（§3 只说规则测试套件；release 状态待查）。

## 与本项目的差异表

| 维度 | Confident 2608.24691 | 本项目（沙盘/三路判词/账本） |
|---|---|---|
| 结算对象 | 隐藏状态信念分布（**内生**：被试自创自改的 Regent 位置） | 游戏结局/事件概率（**外生性更强**）+行为读数 |
| 概率结算 | **有**（Brier 双人群+uniform 基线+bootstrap CI+reliability 图） | 同有（Brier/BI/ABI+CRPS）——**重叠度最高的竞品层** |
| 校准修复 | 无（测而不修） | TS/层级 Platt+K6 debias（修复管线是我们独有层） |
| 预注册 | **有**（四预期+证伪+复现+stop-rule+permutation null）——方法学范本 | PREREG 落盘 hash 计划同构；本文四条预期格式可直接借 |
| 引出架构 | joint（同响应内嵌信念+行动）vs split 未决（引 MafiaScope 34.8% 为 split 噪声证据） | 我们判词=分离引出——**须补 joint vs split 消融**（挂账） |
| 基线 | population-matched uniform（逐 ply 重算） | 基率常数预测器+分层基率下限（H1 基率泄漏防御同思想） |
| 可解性上界 | **oracle-vs-public bound（最可迁移贡献）**：无源码可读对手则无法区分模型失败与任务不可解 | 我们 sim 对手=LLM（非源码可读确定性）→**此上界我们目前不可得**，需固定规则对照臂补 |
| 静态筛查警告 | 单座筛查高估实局 28.4-41.2pp | 我们「烟测 10 条」结论外推须带此 caveat |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】三篇合并=我们 related work 的三线定位已获全文级证据：probing（MafiaScope：测信念内容，探针不回流）/auditability（Auditing：测信念-行动偏离，规则引擎信念）/settlement+calibration（本文：测信念校准，Brier 结算+预注册）——**第四条缝=本文有结算无修复、我们有修复管线+账本聚合；但本文的预注册纪律比我们 PREREG 计划严格（证伪条件+stop-rule+复现设计），须追平否则审稿人会用本文压我们**。
- 【引申】99.3% 赤字集中于高置信事件——对应我们 H1 判据设计：若三路判词在「高置信区」系统性误校准，则基率泄漏防御之外的「置信带分层校准」（按置信分箱分别拟合 Platt）应进批次 1.5 回测清单。
- 【引申】S6/S6B deliberation budget 结果直接打我们「温度档=试验多样性」设计：预算/采样配置单变量移动校准≈跨模型差——三路 T0.2/0.7/1.0 的差异里配置效应与「真信念分歧」不可分，账本须记每次判词的完整采样配置（已在我们记录纪律内，确认为必填字段）。
- 【引申】oracle-vs-public bound 对我们玄学对照臂的意义：梅花查狼实验已证判词无研判效力——同思想即「上界对照」：若连全知 oracle 都不超基率，则模型/判词失败不能归咎模型；我们砂盘的固定规则对照臂（LLM 对手不可读源码）是补 bound 的唯一路。

## 存疑与待验证

1. 开源状态未明：正文无 repo/release URL（与 MafiaScope/Auditing 均不同）；规则附录与 frozen ruleset 的可用性待查。
2. 每座样本量极小（62/14/24/10/8 事件）——五座排序仅两端显著，引用时必须带 Wilson CI 与作者自注的 scope 限制，不可当能力-校准关系证据。
3. 「Brier 0.1445」是 capture-only 人群（暴露偏差自注），不可与我们外生事件结算的 Brier 直接比数值。
4. §4.2 的「早前含窗口分析持平」只给结论未给数字——透明但不可复核。
5. 深度桶 41.0% 处 n=39 欠功效自注；17.7pp difference-in-declines 只在单一 ply 桶可测。
6. 与 A0-1/A0-2 的引用关系已闭环（本文引两者），反向引用不存在（时序）——总差异表按「本文视角」写。

（Confident 笔记完 · 2026-09-12 · 微步A0-3 · 锚=cache/_cache-Confident-2608.24691.txt 1667 行）

### 五座配置与样本量（Table 1，txt L537-660）
- S1=gemini-3.1-flash-lite（无榜单锚，T0.7，4096，**80 局/62 高置信吃子事件——唯一全套校准电池**）；S7=gpt-5-mini（622.59，T=1.0 **API 强制**自注非自由选择，14 事件）；S6-base=gemini-3-flash（1258.32，24 事件）；S6B=同模型 max_tokens 16384（10 事件）；S5=gemini-3.1-pro（1367.40，8 事件）。
- 自注不对称：其余四座只有 capture-time 高置信命中率小样本，非全套电池——每次跨座引用处重复声明不隐没（L530-535）。

### 结果数字（§4，txt L664-919）
- **主发现（4.1，S1）**：原批 **0/22**、复现批 **1/40** 高置信（≥0.5）吃子正确——合并 **1/62（1.6%）**；预注册复现设计非合并：Brier 比 vs matched uniform **7.127（原）/7.094（复现）**，复现 CI [4.298,13.135] 比原批紧 26%；capture-time Brier **0.1445 vs uniform 0.0203**（paired-bootstrap ratio CI 3.8×-15.9×）；**Brier gap 的 99.3%（复现 98.7%）集中于高置信事件**——低置信事件几乎零贡献；reliability diagram（Fig.1，n=394 capture-only 事件）全置信段命中率≈0 仅顶段微正（L670-695）。
- **every-ply（4.2）**：ply≥8 起 S1 信念显著劣于 uniform（delta +0.059/+0.070 两批独立），ply≥14 加深至 +0.098-+0.112——失败不限于行动瞬间但那里最重；**诚实注记**：早前含 pre-shift 窗口的内部分析「与 uniform 持平」，排除规则确定窗口后 gap 才出现，只报修正后口径（L700-715）。
- **五座排序（4.3）**：命中率 S1 1.6% [0.3-8.6] / S7 14.3% / S6-base 29.2% / S6B 40.0% / S5 50.0%（Wilson CI）——点估计单调跨两 lab，**pairwise 显著只在两端（S1 vs S5）**，中段不可分；**同模型内混淆**：S6 vs S6B 同分 1258.32 只差 deliberation budget（4096/16384）差 10.8pp ≈ 跨模型 635.7 分差距的量级——**deliberation 预算单变量移动此指标≈大跨模型能力差**（L717-766）；作者明言不主张「能力预测校准」。
- **常规指标解耦（4.4）**：DeepSeek V4 Flash 关推理模式=100% 合法/0% 截断/28× 便宜/25× 快——但 well-formed belief rate 仅 **3.8%**；「常规基准全胜的配置恰是实测不看棋盘的」——within-model 版中心论证（L783-801）。
- **深度退化（4.5）**：well-formed 85.6%（开局）→47.8%（中）→41.0%（深，n=39 欠功效）；illegal 1.2%→4.5%→20.0%（17×）；对照（无 Crown Shift）也退化 -20.1pp 但 Regent Chess -37.8pp，唯一满功效桶 ply26-50 p=1.6×10⁻⁶；**difference-in-declines=17.7pp**（脚注2 亲辨 17.7 vs 17.9 两个数的口径差）（L803-854）。
- **覆盖率（4.6）**：91 次有 ≥2 候选的吃子中，实际吃格曾被列为候选仅 **26.4%**（vs 预注册 permutation null 29.2%，p=0.218 不可分）——**73.6% 吃子目标是模型从未列过的格**；曾提出后**撤回**的「rank-inversion」表征留痕（24 子集中 17 个单候选，70.8% top-ranked 近同义反复，不作正面证据）（L856-887）。
- **静态筛查高估（4.7）**：S1 自由单座 89.3% vs 实局 60.9%（**28.4pp**）；S2 53.6% vs 12.4%（**41.2pp**，预注册 stop-rule 触发）——单座筛查不能替代局内测量（L889-902）。
- **预注册计分（4.8）**：三条证实+一条 not scoreable 不硬凑（L904-919）。

### §5 局限与 §6 讨论（txt L942-1140）
- S1-only 结果清单明列（every-ply/Brier 比/coverage/深度曲线）；五座排序只支持 capture-time 命中率一窄条（L944-952）。
- **ConfidenceBench 独立佐证**：Gemini 3.1 Flash-Lite 被其评为 15 模型中**最差校准**（大幅领先）；本文自省此 objection 并反驳——一般误校准预测均匀差，实测是 99.3% 集中于高置信事件+五座单调衰减；S1 选择在先（成本）非挑差模型（L954-993）。
- **oracle-vs-public tractability bound（§6，最具迁移价值方法学贡献）**：区分「模型失败」vs「任务不可解」需可计算 ceiling→需源码可读对手；实测 shift target 公共特征可预测（83.1% top-3 vs 37.5% naive）但 shift timing 对固定对手近随机（oracle 全知也几乎无增益）→乘积坍缩→**无预测器（含手写精确参考 tracker）超 uniform**——本文诚实声明任务在该对手下不可解，模型结果只在「校准劣于自身可得信息」意义上成立（L1102-1126）。
- 代表局案例（§6）：S1 声明 70%/20%/0% 三格置信→因普通战术吃了 0% 那格→恰是真 Regent→**模型赢了，赢在信念之外**（L1052-1058）。
- 机制假说仅连接不主张：RLHF 奖励模型高置信偏置（引 [9]）会推送「评估者从不单独检查的时刻的自信错误」；base 模型对照是自然实验（L1074-1085）。
- 无种子不可复现（供应商拒绝固定 seed）→复现=同配置重跑设计，两批方向一致本身即非单次随机伪影的证据；无迁移验证明示（L1001-1013）。
