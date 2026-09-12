# 二期笔记 · Auditing Belief-Conditioned LLM Agents · 微步A0-2

> 论文：Auditing Belief-Conditioned LLM Agents in Hidden-Information Social Deduction Games（arXiv:2607.10814，**v1** 唯一版本）
> 获取路径：pwsh 抓 abs（43.6KB）+HTML（235.6KB）→ _extract-html.cjs txt 100,162 B/1,211 行（web_fetch 前一微步 fetch failed 后全程走 pwsh 通道，稳定）。
> 缓存：cache/_abs-Audit2607.10814.html + _cache-Audit-2607.10814.html + _cache-Audit-2607.10814.txt（行号锚）。
> **本篇=三篇竞品中与我们最同构者**：9 人狼人杀、外部信念层、ablation 臂、seed-paired 对比——逐件对照见差异表。

## 【事实层】

### 信息隔离与决策接口（§3，txt L296-351）
- 式(1)：agent 上下文 $x_i^t=f(H_{public}^t,\;H_{i,private}^t,\;S_{visible}^t,\;A_i^t)$（L309）；隔离=**代码级边界而非 prompt 级指令**——引擎是唯一能读全状态的组件，agent 经序列化数据调用（L306-315）。【A0-2b 补强·实现机制】隔离实现=①引擎为唯一全状态组件、agent 经序列化上下文调用（式1的字段即权限边界）②LLM 输出经 parser/canonicalizer/rule validator 管道规范化，canonicalization 兼作泄漏拦截层（Table 1 自报 role/meta/CoT 泄漏 0/0/0）③单元+集成测试 1,138 项验证隔离不变量（§5.5）——三层：架构边界+输出过滤+测试锁。
- 式(2)：结构化动作接口 $A=\{\texttt{speak},\texttt{vote},\texttt{night\_kill\_nominate},\texttt{check},\texttt{save},\texttt{poison},\texttt{hunter\_shoot},...\}$；LLM 自由生成与规则状态转换分离（parser/canonicalizer/rule validator 管道），对畸形输出鲁棒+全部决策可复合记录（L324-332）。
- 事件日志含公开/私密事件、阶段、发言、投票、检查结果与**信念快照**，可从日志重放整局；运行时 agent 只见自己的视图（L338-340）。

### 可审计信念层（§4.1-4.2，txt L356-388）
- $b_i^t(j)$=agent i 对玩家 j 角色的信念；**从结构化事件更新而非原始转录**（事件=公开声称/检查结果/投票/死亡）（L358-360）。
- 双模式：**shadow**（后台维护只作评估诊断不喂 agent）vs **active**（注入 agent 上下文）；信念更新器**不实时读隐藏角色图**——信息安全关键（L362-364）。
- 式(3) 因子化更新：$\Delta_{i,j,r}=w(e)\cdot d(e,r)\cdot c_i(s_e)$——事件基重×对角色 r 的证据方向×来源可信度 $c_i$（人设规则表难维护→因子化）（L371-375）。
- 式(4) 加性变体：$\text{logit}(b_i^{t+1}(j,r))=\text{logit}(b_i^t(j,r))+\Delta_{i,j,r}$——log-odds 更新两优点：重复证据 logit 空间可加且概率保持良定义、（L380-384）；**信念状态递归：当前快照=下一事件先验**（L388）。
- 消费策略（§4.3）：**belief availability ≠ belief authority**——信念可用但不自动凌驾 agent 判断（L392-396）。
- deviation 三分类（§4.4）：harmful deviation（无视一致高置信信念）/justified override/strategic deviation——事后按真值+上下文归因（L400-406）。
- 防御性离线改进循环（§4.5）：批量跑→存日志/决策/信念快照/真值→聚合指标+坏例挖掘→候选策略洞见→**人工评审+版本化后才入下批**；刻意非全自动，候选更新=假设非保证改进；能拒绝自家提案（负发现）（L412-438）。

### 实验设置（§5，txt L440-486）
- 9 人狼人杀：3 狼+1 预言家+1 女巫+1 猎人+3 村民；单模型 deepseek-chat，T=0.6（L446, 480）。
- 臂：A0 无信念消融/A1 active 因子化/A2 仅好人侧信念/A3 仅狼侧信念/ABL-add 加法核消融/C1 gated 消费基线/C2 强消费 prompt/L1 高并发副本（L454-464）。
- **指标（§5.3，L468-472）**：主=阵营胜率；信念质量=top-1/top-2 hit rate（真值揭晓后最高怀疑=真狼比例）+separability（真狼平均狼信念−非狼平均狼信念）+分布熵/flatness；消费=adoption/consistency rate；决策质量=低级错误与高风险动作清单。**【A0-2b 更正】§6.3 L636 实有一个诊断级 Brier=0.160（sidecar 聚合）**——见结论层更正。
- 协议（§5.4-5.5）：1,080 clean frozen games 固定配置；seed-paired；记录 game id/seed/模型/prompt 版本/信念模式/核/并发；单元+集成测试验证不变量（合同 schema/信息隔离/规则一致性）（L476-486）。

### 稳定性数字（§6.1 Table 1，txt L498-530）
- 1,138 测试全过（0 skip）；A1 200 局 **11,724 决策**；llm_error/retry 0/0；rule fallback 28（0.24%）；**role/meta/CoT 经规范化管道泄漏 0/0/0**；context 超限 0；信念快照 82,967 个/曲线点 746,703（A1）。

### 主结果 Table 2（§6.2-6.3，txt L532-642 逐格）
| 臂 | n | good WR | 95%CI | Top-1 | Top-2 | Separation | Consistency |
|---|---|---|---|---|---|---|---|
| A0 无信念 | 200 | 0.205 | ±5.6pp | – | – | – | – |
| A1 active | 200 | 0.390 | ±6.8pp | 0.686 | 0.825 | 0.356 | **0.207** |
| A2 仅好人 | 150 | 0.253 | ±7.0pp | 0.493 | 0.773 | 0.043 | 0.370 |
| A3 仅狼 | 150 | 0.313 | ±7.4pp | 0.899 | 0.899 | 0.803 | 0.092 |
| ABL-add | 120 | 0.333 | ±8.4pp | 0.668 | 0.804 | 0.347 | 0.201 |
| C1 gated | 80 | 0.412 | ±10.8pp | 0.653 | 0.802 | 0.343 | 0.250 |
| C2 强消费 | 80 | 0.362 | ±10.5pp | 0.688 | 0.840 | 0.352 | 0.280 |
| L1 高并发 | 100 | 0.300 | ±9.0pp | 0.706 | 0.825 | 0.359 | 0.284 |
- A0/A1 主对比：0.205→0.390（**paired McNemar χ²=16.4, p<0.001**，seed-paired 200 对）（摘要 L2 区+L534）。
- **三个 guard 结论**：①A2（仅好人信念 0.253）<A3（仅狼信念 0.313）<A1——**只给狼信念反而更助好人侧**，反对 holder-benefit 简单解释；②action-belief consistency 仅 **0.207**（A1）——信念信号可用（Top-1 0.686）但 agent 不怎么照做；③A1 与 L1 并发副本 WR 0.390 vs 0.300——并发是真实混淆源（虽 llm_error 全 0）。
- 女巫毒药（§6.4+Table 3）：毒药尝试 29/200→11/200；**错误毒药 22（76%）→4（36%）**——信念作不可逆高风险动作的风险控制信号（L664-674）。
- 强制消费失败（§6.5）：C1→C2 一致性 0.250→0.280 但 WR 0.412→0.362——信念分布平坦时强令跟随失败；**信念应作 confidence-aware 信号非无条件控制器**（L676-696）。

## 【结论层】（三态）——恢复令两问逐答

**问1：resolve 后显式概率的 Brier/ECE/Murphy 统计管线？——【已核·无】**
- **【A0-2b 更正·诚实留痕】信念本身是 logit 空间概率分布（式 4）且有 746,703 个信念曲线点。初版笔记曾写「全文无 Brier」——§6.3 L636 复核发现原话 "the average Brier score is 0.160"，更正为：有**单一诊断级 sidecar Brier（0.160，混臂混动作聚合，作者自注被狼人已知队友 inflate，good-side-only vote 口径更低、chance≈0.375=3狼/存活人）**，但**仍无**：ECE（任何形式）、Murphy 三分解、逐局概率-结局配对结算管线、校准重映射（该 Brier 是信念质量诊断量，不是 resolve 后预测的结算统计）。原结论方向（无结算统计管线）不变，程度表述收窄。率口径；全文无 Brier、无 ECE、无 Murphy 分解、无 CRPS； belief 分布**从不被当作概率预测来结算**（§5.3 指标清单+§6 全部数字口径核实）。
- 校准概念缺席：无置信-准确校准曲线（MafiaScope F2 有 ECE；本文连诊断级 ECE 都没有）。

## 与本项目的差异表（直接服务论文 related work/差异化定位）

| 维度 | Auditing 2607.10814 | 本项目（沙盘/三路判词/账本） |
|---|---|---|
| 信念层归属 | **外部代码层**（因子化规则表+logit 更新，非 LLM 生成）——引擎侧维护 | LLM 判词出概率+**确定性代码层聚合/校准**（LLM 四角色纪律同构，但我们的概率来自 LLM 显式报价非规则表） |
| 信念表示 | 角色概率分布（logit 空间）+怀疑排序 | 显式概率+置信+证据摘要（BLF 式半结构） |
| 概率结算 | **无**（hit-rate/separation/consistency 排序口径） | Brier/BI/ABI 记账+CRPS（连续成分）+结算后校准 |
| 校准 | 无诊断无修复 | TS/层级 Platt+K6 debias 管线 |
| 因果/消融 | 8 臂+seed-paired+McNemar（设计最强）但无预注册无安慰剂措辞臂；机制自认未识别 | 预注册判据（per-path）+安慰剂三臂计划+玄学对照臂 |
| 域 | 9 人狼人杀（代码级信息隔离=我们同款铁律） | 狼人杀+多域推演 |
| 改进循环 | 防御性离线循环（batch 挖坏例→人工评审→版本化）——**与我们「S1 评审建议分批修复重跑」同构** | 同构+conformal 外环（K2/ACI） |
| 最大互证 | 「forced consumption 失败=信念应作信号非控制器」与我们「LLM 出逻辑不出数字+账本聚合」互证；A3 助好人侧的反直觉=信息差（B1(a)) 的独立案例 | — |
| 最大差异点 | 他们 belief=规则引擎产物（可解释但人工设计，§8.5 第二局限自认覆盖有限）；belief 从不作为概率结算 | 我们把 LLM 显式概率当预测对象做**结算统计**——这正是他们缺的整层，也悬着我们差异化定位的两问答案 |

## 发散思考（全部【引申·未验证】，与论文原文严格区分）

- 【引申】这篇事实上是「我们账本层的镜像实现」：他们有信念快照+deviation 审计+离线改进循环（=我们的账本+回放+分批修复），独缺「把概率当概率结算」的最后一步——我们论文 related work 可把他们定位为「auditability line」、把 MafiaScope 定位为「probing line」、把自己定位为「settlement/calibration line」填空。
- 【引申】A3（狼侧信念助好人侧 0.313>0.253）可用信息差解释：狼拿到准确信念后行为更激进暴露更多，好人侧读取行为收益>狼行为收益——这是 B1(a) 信息差方案的行为学证据（非论文主张，我的推演）。
- 【引申】consistency 0.207 但 WR 提升——提示信念主要价值不在「被跟随」而在「改变决策分布」或「prompt 结构本身」（他们混淆未除）；我们做信念注入臂时必须加「信念内容 vs 等长中性文本」的安慰剂对照，否则同样无法归因。
- 【引申】他们的 deviation 三分类（harmful/justified/strategic）可直接借进我们账本 schema 作为判词-行为偏离的标签层，配合 LLM 打标（确定性代码层存标签）。

## 存疑与待验证

1. paper-facing release「will host」——开源数据（1,080 局日志/信念快照）当前是否可下载未核实（repo 在但 release 状态待查）；复用前必须实地查 repo。
2. McNemar χ²=16.4 的 b/c 格计数未给全（只给统计量与 p）；WR 差 18.5pp 的 CI 半宽 ±5.6/±6.8pp 是未配对边缘 CI，配对差 CI 未给。
3. belief 更新的 w(e)/d(e,r)/c_i 权重表是人工规则（论文未附全表，在 repo）——复用需回 repo。
4. §8.6 提议的两 controlled arms（分离信念内容与 prompt 结构）作者未做——留给了后续工作（也留给了我们）。
5. L1042 区 Table 1 的「leakage 0/0/0」是 frozen run 自报，非第三方审计。

（Auditing 笔记完 · 2026-09-12 · 微步A0-2 · 锚=cache/_cache-Audit-2607.10814.txt 1211 行）

**问2：预注册因果实验？——【已核·无】**
- **【A0-2b 补强·consistency 0.21 精确口径】**L638 原文：「how often the agent's action **exactly matches the top belief recommendation**」——只算 top 目标精确一致；作者自注**不含**候选集收窄/排序位移/发言谨慎度变化/间接语言与多智能体效应→是信念使用量的**下界**；outcome shift 与低一致性的差距=因果路径未决（「belief may influence behavior without producing exact top-target agreement, and prompt structure or other behavioral changes may also contribute」）；top-1 hit 0.686 的混臂混淆自注=狼人天然知道队友 inflate pooled 值。
- 无预注册声明（预注册/preregistered 全文未出现）；统计规范不弱（seed-paired+McNemar+cluster CI）但属事后分析设计。
- 无安慰剂/零干预措辞臂：C1/C2 是消费强度干预不是 null-conditional placebo（对照 FBSim Fig.11）；**§8.6 作者自认**最重要下一步=「two controlled arms would separate belief content from prompt structure」——机制混淆（信念内容 vs prompt 结构增量）未除，第八局限自认「mechanism behind the win-rate gain is not fully identified」（L790, 794）。
- 因果口径：全文用词谨慎（associated with/co-occurs，非 causal claim）——诚实但即无因果结论。

**四重点速答**：①测=外部 logit 信念层（shadow/active 双模式）+deviation 三分类审计+防御性离线改进循环；②测的重点是「平台可审计性」非预测力；③规模=1,080 局/11,724 决策/82,967 信念快照，9 人狼人杀 deepseek-chat 单模型；④开源=github.com/JJJayden-Yang/ai-werewolf（实现在库，paper-facing release「will host」承诺中——数据集尚未确认可下）。
