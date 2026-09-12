# 二期笔记 · MafiaScope · 微步A0-1

> 论文：MafiaScope: Non-Invasive, Time-Resolved Belief Probing for LLM Agents in Social Deduction Games（arXiv:2607.10645，HTML 抓取默认最新版=**v2**；abs 页列 v1/v2）
> 作者：Ilia Karpov（HSE University）。定位：**开源测试床（open testbed）论文**，非 SOTA 榜文。
> 获取路径：abs+HTML 均 pwsh Invoke-WebRequest（web_fetch 本微步 fetch failed 一次，换路 pwsh 成功）→ _extract-html.cjs txt 53,334 B/1,133 行。
> 缓存：cache/_abs-MafiaScope-2607.10645.html + _cache-MafiaScope-2607.10645.html（192KB）+ _cache-MafiaScope-2607.10645.txt（53KB，行号锚）。
> 队长令四问：①测了什么 ②没测什么（显式概率结算统计管线/预注册因果/安慰剂臂/Brier-ECE-Murphy 结算后校准）③数据规模与域 ④开源可否复用；另加「与本项目的差异表」。

## 【事实层】

### 系统架构（§3，txt L231-244）
- 三解耦层=game engine（game.py）+probe engine（introspection.py）+viewer（D3 SPA），以 **append-only JSONL 日志**连接（L233-236）。
- 博弈：经典 Mafia 循环（夜晚刀杀/医生救→白天讨论→公开投票），n 人局，角色 Mafia/Doctor/Villager（L238）；Werewolf 换皮=只换词表，Seer 变体=加私有证据通道——**游戏族是配置面不是引擎 fork**（L242）。

### 探针引擎=核心创新（§4，txt L246-270）
- 无侵入原理原文：「Asking an agent what it believes normally changes what it does next. The probe engine removes this cost」——每次公开发言+私密夜晚动作后，agent 私密回答结构化探针，**答案永不回流游戏**（L248, 159）。
- 探针 YAML DSL 声明；支持条件触发（when: own_turn vs after every message）、探针链接（{prev_<id>} 把先前探针解析答案拼进后续问题）、每探针独立 token 预算（L252-268）。
- 默认六探针：role_beliefs、role_assessment（一阶角色猜测+置信）、suspicion_ranking、planned_action（回合后意图）+二阶/社会地图类（完整模板在 configs/config.yaml）（L268, 995）。
- 成本：每发言后探针使每局 **631 次 LLM 调用**（vs 27 次 game-move）≈24× 流量（L270）。

### 可视化器与反事实回放（§5-§6，txt L272-303）
- viewer 全静态：状态/指标/校准**构建期预计算**、flat files 服务；Impersonate 模式=从单 agent 视角重渲染全界面（L274-295）。
- 反事实回放：**fork-and-replay**——引擎快照每 agent 全上下文，任意步 fork 重跑（L299）；**bifurcation 实验=对选中投票从冻结 pre-action 上下文以 T=1.2 重采样 500 次**，看 utterance 变异对结果的影响（L301）。
- 头条反事实数字：**仅 ~6% fork 翻转胜者**（16 个父节点全 Mafia 胜）（L303）。

### 案例研究五发现（§7，txt L305-319 逐数字）
- 语料：**162 个七人局（109,999 条解析探针答案）两模型族**；headline=pinned 32 局 deepseek-chat（21 EN/11 RU）；复现=30 局 deepseek-chat（不同探针措辞+token 预算）+100 局 gpt-4o-mini；Mafia 胜 31/32 vs 17/30（「findings grade beliefs, not wins」）；95% CI=游戏级 cluster bootstrap（L307）。
- **F1 信念轨迹可测**：villager 侧 round0 74.9% "Unknown"，真 Mafia recall 5.4%→60.9%（round2）→93.5%（round3，chance 29.3-39.5%；Table 2 L1006-1040）；30 局批复现形状（4.3%→61.6%）；gpt-4o-mini 只复现 no-opinion 起始，recall 平台 21-29% 不超随机（L309, 1046）。
- **F2 置信误校准**：置信<80 区间 accuracy 平台 ~45%；自报 80-99 置信实际正确 **54.6%（差 30 点）**；**ECE=0.168**（Guo et al. 2017 分箱置信-准确差）——复现 0.222/0.285；结论原话「Stated confidence is not a probability until recalibrated」（L311）。
- **F3 过预测被怀疑**：social-map 预测「B suspects me」对照 B 同步自评，过计 **1.53×（CI 1.44-1.64）**=聚光灯效应机器版；无罪者 1.84 vs Mafia 1.08；gpt-4o-mini 1.36（L313）。
- **F4 探针-投票耦合**：无罪 agent 日投票落其最新 pre-vote suspicion ranking top1 比例 **64.9%（chance 27.3%，CI [54.7,76.7]）**；post-vote 探针 95.1% 重复刚做动作；简单转录规则（投最被指控者）58.8%；**探针增益只在两个较大语料上与零分离；Mafia voters 无任何增益**（L315, 1060）。
- **F5 探针预算塑形测量**：400-token 预算下 73% role-assessment 答案 mid-JSON 截断（修复回捞 4,118 条）；960-token 截断消失（L317）。
- 时序图读法：~1,500 边事件/局（temporal-graph-network 格式）；top-suspect flip 48.7% vs **冻结上下文重问 flip 34.8%→约 70% 的"摇摆"是采样随机**（L319）。

### 工具伪影与局限自注（附录 B/C+§9，txt L327, 1042-1058）
- 两工具伪影独立于真实信念改进而抬高轨迹：①**probe chaining 把 agent 自己的先前评估重注入后续问题**（自证循环）②token 预算截断（F5）（L1044）。
- 探针缺失=传输驱动：pinned 语料 13,815/20,199 探针调用返回解析答案，**98.3% 缺失=API transport 错误**（L1048）。
- F3 自注：**F3 度量是两个自报之间的一致性，不是对引擎真值的 ToM**（L1058）——二手自报嵌套。
- §9 自注：自报可能不忠实（引 Turpin et al. 2023）；重问冻结状态 flip 34.8%；headline 只覆盖两模型族一种 elicitation（L327）。

## 【结论层】（三态）——队长令四问逐答

**①测了什么（探针/审计口径）**：
- 【已核】口径=「每发言后私密结构化探针+引擎真值计分」——探针类型：一阶角色猜测（category+confidence 数字）、怀疑排序、社会地图（二阶：谁怀疑谁）、行动意图；计分=一阶准确率 vs 角色 multiset 随机置换 chance、**ECE（Guo 2017 分箱）**、二阶一致性比、投票耦合率；反事实=utterance 重采样 fork（500×T1.2）非世界干预（L248-268, 301）。
- 【已核】测试床性质=测量仪器+可视化器，作者明说案例研究是「model inspection rather than establish new behavioural claims」（L307）。

**②没测什么（我们交叉点的空白=差异化机会）**：
- 【已核】**无显式概率结算统计管线**：探针置信是 0-100 整数自报，未做 logit/概率空间结算、无多试验聚合、无收缩/极端化——全文无「aggregation/extremize/shrinkage」概念。
- 【已核】**无结算后校准重映射**：ECE 只作诊断量测出来（0.168/0.222/0.285），没有 Platt/isotonic/TS 校准修复、没有 Brier/Murphy 三分解、无 CRPS 类连续计分（结论原话自己承认「not a probability until recalibrated」但把它留给未来）。
- 【已核】**无预注册因果实验+无安慰剂对照臂**：case study 自我定位 inspection；bifurcation fork 无 null/placebo 措辞对照（对比 FBSim Fig.11 的三臂设计）。
- 【已核】**无跨模型族系统对比**（只 deepseek-chat×2 批+gpt-4o-mini 复现，Mafia 1.08 vs 无罪 1.84 的角色×模型交互未展开）；无市场/外部 crowd 锚。

**③数据规模与游戏域**：
- 【已核】域=Mafia（经典社交推理，7 人局），Werewolf 换皮=词表层；规模=162 探针局+110k 探针答案+557 录像局+512 反事实 fork（开源件）；模型=deepseek-chat 主+gpt-4o-mini 复现（L307, 323）。

**④开源可否复用**：
- 【已核】**MIT 全开源**：引擎/探针/查看器/数据集，github.com/karpovilia/mafiascope；557 局+512 fork 全部入 manifest（L323）。可直接复用件：YAML 探针 DSL（条件触发/链接/预算）、JSONL 日志协议、fork API、构建期预计算 viewer、cluster bootstrap CI 口径。

## 与本项目的差异表（直接服务论文 related work/差异化定位）

> **队长令挂账（2026-09-12）**：F1 重问冻结状态 flip 34.8% 一条——我们三路判词（T0.2/0.7/1.0）的采样随机占比将来用同法测量：同上下文冻结重问三路各 N 次，测翻转率基线；若接近 35% 则三路聚合信号空间被压缩、收缩强度应上调（挂账 L1，账本回放期执行）。

| 维度 | MafiaScope | 本项目（沙盘/三路判词/账本） |
|---|---|---|
| 测量对象 | 探针自报（category+0-100 置信）的信念内容与轨迹 | 显式概率报价+置信，进**结算统计管线** |
| 概率处理 | ECE 只诊断不修复；「不是概率直到重校准」原话 | 结算后 TS/层级 Platt 校准（K3/BLF 式）+Brier/BI/ABI 记账 |
| 聚合 | 无（单 agent 单次自报） | K 路判词 logit 聚合+先验收缩（K5/BLF 式） |
| 因果/反事实 | utterance fork 重采样（6% 翻转）无安慰剂臂 | 预注册+安慰剂三臂（FBSim Fig.11 式）+玄学对照臂 |
| 域 | Mafia 7 人局（引擎规则固定） | 狼人杀（LLM 驱动模拟，自适应对手）+多域 |
| 数据 | 557 局 MIT 开源可复用 | 自建（探针缺失/传输错误治理可借 F5/L1048 经验） |
| 共同发现互证 | 自报置信≠概率（ECE 0.168-0.285）；二阶判断过计 1.53× | 与 DINCO（言语置信过自信）、K3 校准线一致→我们「自报置信不直接采信」铁律获 2026-07 独立佐证 |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】「探针永不回流游戏」的无侵入原则与我们「LLM 出逻辑不出数字+账本后处理」是同一条纪律的两个投影——他们防测量改变被测系统，我们防生成端污染数字；论文里的 24× 调用成本给了我们「探针频率 vs 成本」的先例数字（631/27）。
- 【引申】重问冻结状态 flip 34.8% 是对本项目三路判词的免费警示：T0.2/0.7/1.0 三路差异里有多少是采样随机？我们可用同法测「同上下文重问翻转率」，若接近 35% 则三路聚合的信号空间被压缩，收缩强度应上调（与 BLF 式 α_q=Kτ²/(Kτ²+σ²) 的 σ 估计直接挂钩）。
- 【引申】F4 的「探针增益仅在大语料上与零分离+Mafia 无增益」暗示：显式探针在**有隐藏身份动机**的 agent 身上失效——我们狼人杀判词对狼方路线的读数不可信，结算管线应按角色分层（呼应 per-source δ_s）。
- 【引申】probe chaining 自证循环伪影→我们判词若引用上一轮自己的判断做上下文，也会产生同样伪影；判词 prompt 应冻结真值锚点，避免 {prev_*} 式自引用，或至少作为独立条件分支记账。
- 【引申】557 局 MIT 数据可作我们 sim 工厂的**域外验证集**：用我们的结算管线回放他们的探针日志（他们存了原始生成），若我们重校准后 ECE 显著下降即是跨数据集的方法学验证（一篇 related work 的实验级弹药）。

## 存疑与待验证

1. 抓的是 HTML 默认版（疑 v2），v1→v2 差异未核（abs 页版本历史未逐条抓）；引用前若需精确版本须回 abs 页核 v2 changelog。
2. Table 1（与 ChatArena/AutoGen-AGDebugger/Werewolf Arena 等能力对照）只抄了 MafiaScope 列为全✓的结论，对照系统细节未核。
3. 附录 B Table 2 的 chance 口径=「alive-role multiset 随机置换」，细节（置换次数）未抓全。
4. F2 ECE 的 bin 宽与分箱方案正文未给全（引 Guo 2017 但 bin 数未见——L1056 只给 4 个 bin 数字），ECE=0.168 不可与 K6 的等频/等宽口径直接比。
5. 「second-order/coupling probes」的完整模板在 repo configs/config.yaml，论文正文只给示例——复用前须回 repo 核。
6. 本篇与 A0-2（Auditing Belief-Conditioned）/A0-3（Confident at the moment of action）的差异与引用关系待 A0-2/A0-3 精读后回填。

（MafiaScope 笔记完 · 2026-09-12 · 微步A0-1 · 锚=cache/_cache-MafiaScope-2607.10645.txt 1133 行）
