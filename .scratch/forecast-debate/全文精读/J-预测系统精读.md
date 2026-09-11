# J-预测系统精读（J 棒 · 全文精读笔记 · 长活微步制）

> 纪律：证据三态【已核】=本人自全文原文抄录；【转述】=转引未亲核；【待验证】=存疑。每回合精读 1-2 篇全文追加于此，回报一行后停等恢复令。
> 微步进度：回合1 AIA ✅ ｜ 回合2 Lu ✅ ｜ 回合3 ForecastBench ✅ ｜ 回合4（2026-09-11）Prophet Arena ✅（四篇收官）
> ⚠️ 写入纪律（2026-09-11 事故沉淀）：本文件只准 edit 追加（old_string=当前尾锚点），write 全量替换/读全文再写回一律禁用；每次追加后立即读回验证行数。回合2→4 间曾出现外部旧快照回滚（队长查盘 165 行 vs 实际 378 行），读写两侧都要「落盘即验证」。

---

## 论文 1：AIA Forecaster: Technical Report（arXiv:2511.07678v1）【回合1】

### ① 元数据
- arXiv id: 2511.07678，仅 v1，2025-11-10 提交【已核】
- 作者: Rohan Alur*、Bradly C. Stadie*（*同等贡献）、Daniel Kang、Ryan Chen、Matt McManus、Michael Rickert、Tyler Lee、Michael Federici、Richard Zhu、Dennis Fogerty、Hayley Williamson、Nina Lozinski、Aaron Linsky、Jasjeet S. Sekhon；通讯 aialabs@bwater.com【已核】
- 机构: **Bridgewater AIA Labs**（New York；通讯邮箱 bwater.com 域 = Bridgewater Associates 关联实验室）【已核·原文摘录】
- venue: arXiv 技术报告（未见同行评审信息）；基座模型默认 OpenAI o3【已核】

### ② 全文获取路径
1. arxiv.org/abs/2511.07678 → 确认仅 v1、2025-11-10【已核】
2. arxiv.org/html/2511.07678v1 官方 HTML → 200 OK【已核】
3. web_fetch 截断 100KB → 换 pwsh Invoke-WebRequest 全量下载 400,443 B → 自写 _extract-html.cjs（本目录，可复用）转文本 109,711 B / 2,152 行，公式以 $alttext$ 保留【已核】
4. 全文可得 ✅（正文 §1-8 + 附录 A-G 全公式全 prompt 均读到）；References 段未逐条精读【已核】

### ③ 核心贡献（3 句）
1. 自称首个「可验证达到专家级」的 LLM 预测系统，三件套 = agentic 自适应搜索（高质量新闻语料）+ supervisor 仲裁 agent（识别分歧→补搜索→高置信才改判）+ Platt scaling 校准；ForecastBench 上与 superforecasters 统计不可区分（0.1076 vs 0.1110，配对 p=0.15）。
2. 提出更难的 MarketLiquid 基准（1610 题，流动性预测市场）：单系统跑输市场共识（0.1258 vs 0.1106），但「LLM+市场价格」的凸组合集成优于任一单独（0.106 vs 0.111），证明 LLM 预测对市场价格有多样化增益（diversifying）。
3. 方法论三连：①搜索质量决定预测质量——此前文献「搜索无用」的结论源于弱搜索+市场价格掩盖效应；②单次运行极不稳定，10 路集成是刚需，agentic supervisor 显著优于简单平均与非 agentic LLM 聚合；③首次推导 Platt scaling = 广义 log-odds extremization 的数学等价，固定参数 a=√3 即可大幅修正 LLM 向 0.5 对冲（hedging）的偏差。

### ④ 公式清单（逐条自原文抄录）
【已核】

P1 预测算子（§3.1）：
    π : (q, E) → p
- q = 二元问题；E = 检索证据集（新闻文章等）；p ∈ [0,1] = 事件发生概率。
- 多步迭代版（agentic search 条件化）：π : q → E1 → E2 → … → En → p

P2 完整管线（§3.2）：
    π_i : q → E1 → E2 → … → En → (R_i, p_i)     （i = 1..M，M=10）
    Supervisor : (R_1, R_2, …, R_M) → E_supervisor → p_final
- R_i = 第 i 个 agent 的推理轨迹（reasoning trace）；E_supervisor = supervisor 追加的澄清性搜索；p_final = 调停后再 Platt scaling 的最终概率。

P3 Brier 分数（§4.1）：
    单题 BS = (p − o)^2，p∈[0,1] 预测，o∈{0,1} 真实结果
    集合 BS = (1/n) Σ_{i=1..n} (p_i − o_i)^2
- 严格 proper scoring rule（引 Gneiting & Raftery 2007）；恒猜 0.5 → 0.25；0 完美。

P4 集成的 Jensen 论证（§7.1, Eq.1）：
    ℓ(E[P|Q=q], E[O|Q=q]) < E[ℓ(P,O) | Q=q]   ∀q
- Q∈𝒬 问题、P∈[0,1] 预测、O∈{0,1} 结果，ℓ(P,O)=(O−P)^2；ℓ 强凸 ⇒ 平均预测的 Brier 严格优于单次预测的期望 Brier ⇒ 集成非可选（引 Breiman 1996 同理）。

P5 Log-odds extremization（§7.3, Eq.2；引 Baron et al. 2014）：
    log(p̂/(1−p̂)) = (d/n) Σ_{i=1..n} log(p_i/(1−p_i))
- p̂ = extremized 聚合概率（sigmoid 反解还原）；p_i = 各单路预测；d = 极化系数，Neyman & Roughgarden (2022) 建议固定 d=√3。

P6 Platt = 广义 log-odds extremization（附录 G.2, Eq.3–10）——全文最可复用的公式段：
  (a) 无偏移恒等式：p^a/(p^a+(1−p)^a) = 1/(1+((1−p)/p)^a) = 1/(1+exp(−a·log(p/(1−p)))) = sigmoid(a·log(p/(1−p)))
  (b) 带偏移 d：d·p^a/(d·p^a+(1−p)^a) = sigmoid(a·log(p/(1−p)) + log d)
  (c) 主结论：Eq.2 的 extremized p̂ = 对「几何均值」做 Platt（参数 a，d=1）：
      p̂ = (Π p_i^{1/n})^a / [ (Π p_i^{1/n})^a + (Π (1−p_i)^{1/n})^a ]
- 变量：a = 斜率/极化参数；d = 偏移参数（在 sigmoid 内表现为 log d 项）。
- 实用含义：极化「算术均值」=直接对均值做 Platt；log-odds 路线=等价于先几何均值再 Platt。两条路只差均值类型（算术 vs 几何）。论文选算术均值+Platt，因为要保留 supervisor 改判环节（Eq.2 那类按 k 路聚合的 extremization 与 supervisor 不兼容）。

P7 单纯形回归集成（§5.3）：
- 二变量 simplex 约束回归：o ~ convex组合(市场价, LLM预测)，最小化 Brier（ℓ2）；回归系数=各信息源相对信息量的代理；95% CI 用 1000 次 bootstrap；集成性能用 leave-one-out 估计。目标不是最优集成而是可解释系数。

### ⑤ 方法实现细节（能抄多细抄多细）
【已核·全文】
- **架构（§3.2+§7.1）**: M=10 个独立 forecaster agent（原文「we adopt 10 forecasts per question as a conservative standard」）→ 各自独立 agentic search → 各出 (R_i, p_i) → supervisor 读全部 R_i 找歧义/分歧 → 产出 N 条补充搜索查询（典型：查 base rate、fact-check 某断言）并执行 → 生成更新预测 + 更新方向置信度（high/medium/low）→ **仅 high 置信采纳改判替换简单均值，medium/low 丢弃回退均值** → 对最终均值做 Platt scaling（a=√3, d=1 固定不学习，防基准过拟合）。
- **搜索（§5.1）**: 两个匿名工业级搜索商 Search-A（自然语言问答型）/ Search-B（agentic AI 集成型）+ 内部高质量新闻语料；agent 全权决定是否搜/搜什么/迭代条件化。非 agentic 消融管线 = 研究者固定「先让 LLM 生成 3 条查询 → 结果作上下文」（Halawi/Karger/Tao 同款）。
- **市场价格隔离**: 不提供价格时**黑名单所有主流预测市场域名**，禁止 agent 自行检索到价格（§5.1 footnote 11）。
- **基座选择（附录 B）**: 默认 o3（pretraining cutoff 2023-10，早于全部基准事件，免 lookahead）。Sonnet 4 可靠 cutoff 2025-01 与 MarketLiquid 起点 2025-01-01 贴脸，被点名有污染风险；OSS-120b 名义 0.1076 第一，但 judge 实测 17.09% 查询泄漏预知、波及 57% 题目 → 判「海市蜃楼」弃用；Opus 4 太慢弃用。
- **Foreknowledge 判官（§5.2+附录 D）**: LLM-as-judge 对每条搜索响应+引用段判定是否暗示 cutoff 后的知识；判官自己也有搜索工具可核查。JSON schema：{has_foreknowledge, confidence_level(high/med/low), evidence_quotes[], evidence_explanation, legitimate_reasoning, key_indicators[], overall_assessment}。人工审计 n=502：TP 16(3.2%)/FP 65(12.9%)/TN 412(82.1%)/FN 9(1.8%) → 高召回低精度设计：未标记可信，标记数当过估。全量 N=4411 响应 flag 236(5.35%)，估真偏知率 ≈1.65%（附录 E 表17：TP≈47=precision×flags，FN≈26=由 recall 反推）。
- **Robustness（§5.2 表6）**: ①Filtered=删所有 flag 题（约 80% 误删，故意保守）→ 0.1161 vs 基线 0.1159（+0.17%）；②Worst-case=flag≥5 题一律按 0.5 记（Brier 0.25）→ 0.1166（+0.55%）。注：本节实验不含 consistency 分析与 Platt（隔离变量）。
- **MarketLiquid 构造（附录 F）**: 「某公共预测市场平台」（未点名）；结算窗口 2025-04-02~05-23；过滤：开市≥1周 & 总成交≥5000 contracts → 322 市场；每市场 5 个 as-of 时点 → 1610 题。as-of 伪代码：距 close>91 天→[1,7,30,60,90]天；>30→[1,7,14,21,diff]；>7→[1,3,5,7,diff]；否则无效。只向 LLM 披露挂盘 close 日而非实际结算日（footnote 6）。题目改写 prompt 原文抄录：「title+rules → 输出单个自然语言 yes/no 问句，尽量贴 title，只输出问题」。
- **不确定性量化（附录 A）**: pairwise p = 题级 Brier 差值重定心到 0 → 10000 次 bootstrap → 设计成能检出「每题都小优 1%」的均匀小优势（比各自独立 CI 功效高）。声明：该程序不含 LLM 输出随机性，后者由 §7 的 50 路/题 superpopulation bootstrap 单独量化。
- **集成规模曲线（§7.1 图3）**: 1→5 路急剧下降，5→15 路缓降 → 采 10 路。50 路/题超总体 bootstrap 重采样（非重跑基准）。
- **未披露（诚实记录）**: forecaster agent 系统 prompt 全文、supervisor 完整 prompt、每 agent 搜索次数上限、温度等采样参数、新闻语料清单、搜索查询格式——论文均未给出，无代码/数据链接。【已核：全文检索无】

### ⑥ 实验数字表（全部自原文表格抄录【已核】）
表A 主结果（Brier，越低越好）:
| Forecaster | FB-Market(76) | FB-7-21(498) | FB-8-14(602) | MarketLiquid(1610) |
|---|---|---|---|---|
| 市场价 | 0.0965 | × | × | 0.1106 |
| 公众调查(每题中位) | 0.1035 | 0.1451 | 0.1510 | × |
| Superforecasters(每题中位) | **0.0740** | **0.1110** | **0.1152** | × |
| ForecastBench SOTA | 0.107 | 0.133 | 0.145 | × |
| OpenAI o3 | 0.1096 | 0.1221 | 0.1262 | 0.1324 |
| **AIA Forecaster** | **0.0753** | **0.1076** | **0.1099** | 0.1258 |
- 配对 p（vs 各表最强）：AIA vs SF：FB-Market 0.433 / FB-7-21 0.152 / FB-8-14 0.095 → 统计不可区分；MarketLiquid AIA vs Market p=0.057（AIA 更差、边缘）。
- SF 每题中位 0.1110 优于均值 0.1123；公众中位 0.1450 优于均值 0.1586（中位>均值的实证）。SF 平均 8 人/题（最少 3），公众平均 49 人/题（最少 40）。

表B 搜索消融（FB-7-21，无 supervisor 无校准）: None 0.1230 / Search-B non-agentic 0.12168 / Search-B agentic 0.11824 / Search-A non-agentic 0.11738 / Search-A agentic 0.1140。→ 最弱搜索≈无搜索（解释 Karger/Schoenegger「搜索无用」）；Search-A agentic 比无搜索好 7.3%。

表C 市场价×搜索交叉（FB-Market 子集）: 无搜索 0.116 → +价格 0.103（+11.2%）；agentic 搜索 0.085 → +价格 0.075（+11.8%）；纯市场价 0.096。→ 价格关闭无搜索与 agentic 差距的 ~42%（0.013/0.031）。Karger SOTA 0.109 反而不如直接抄价格 0.096。

表D supervisor 消融（FB-7-21，10 路）: Agentic 0.1125（top@3=33.9%, worst@3=4.6%, outperform=3.8%）/ Non-agentic（Halawi 式 LLM 直聚合）0.1168（top@3 仅 7.8%）/ Best-of-k 0.1191（by design 永不超越候选；7.2% 恰选最差 3）/ 无聚合 0.1199。

表E 统计校正（FB-7-21）: Platt 固定√3 0.1076 / Platt ID(LOO 学习) 0.1071 / Platt OOD(Halawi 集训练) 0.1104 / log-odds extrem(d=√3) 0.1085 / Isotonic ID 0.1097 / OLS 0.1119(→0.1125) / 无 0.1140。Platt 全场最佳。
- 收益机制：0.497→0.381 修正单题 Brier −0.102；0.995→0.999 仅 −2.4e-5 ⇒ 校正只在「方向已对、自信不足」区间有肉（0.2-0.4 ∪ 0.6-0.8 区间贡献最大降幅，图5）。
- Platt 系数扫描（图6）：AIA 用 √3≈1.73 打赢 SF 用其最优系数 1.72 的成绩；AIA 自身最优 2.27（弃用防过拟合）。
- 管线消融链（数字互洽推断【待验证·推断】）: 搜索+均值 0.1140（表3/表9/表11 None 一致）→ +agentic supervisor 0.1125（表10）→ +Platt 0.1076（表11/表2 终值）。

表F 基座模型（MarketLiquid，无 supervisor）: GPT-4o 0.1485 / Gemini 2.5 Pro 0.1456 / GPT-5 0.1412 / Qwen-32b 0.1404 / o3 0.1242 / Sonnet 4 0.1195(污染嫌疑) / OSS-120b 0.1076(17.09% 泄漏波及 57% → 弃)。

表G 实时市场（2025-08-15~21 每晚 ~1500 活跃市场抽样 250/夜，禁价格）: 已结算 n=64：有搜索 0.1002 / 无搜索 0.3609（3.6×，无搜索连 0.25 机械基线都不如）/ 市场共识 0.1111；未结算 n=1750（对市场价计分）：有搜索 0.0522 / 无搜索 0.0910。

表H 单纯形集成（§5.3）: FB-Market：AIA 系数 0.87[0.42,1.00]、市场 0.14[0.00,0.58]，LOO 集成 0.079（劣于 AIA 单独 0.075 → 市场价无叠加信息）；MarketLiquid：AIA 0.33[0.12,0.47]、市场 0.67[0.53,0.80]，LOO 集成 0.106（优于市场 0.111 与 AIA 0.126 → 多样化增益成立）。

### ⑦ 对本项目落地点（对局账本=特征源+多路判词聚合+校准线）
（项目语境：LLM 四角色=聚合/基率/多路/校准；已有 pitfall「LLM 直接出数字两次死亡」；L0 门禁 n≥30 局∧200 条前只记不评）
1. **AIA 架构 = 本项目已裁定「多路判词聚合+校准」路线的工业化完整版**，四角色全部对上：10 路独立 agent=多路推理；supervisor 查 base rate/fact-check=基率检索+信息聚合；Platt=校准。可直接抄的三件：
   - **a. 先机械平均再校准，禁止 LLM 直读判词加权**：多路判词先简单均值（median/trimmed 同级），Halawi 式「LLM 读全部判词出聚合数」实测 top@3 仅 7.8%、Brier 反劣化（0.1168 vs 均值 0.1140）——这正是本项目「LLM 出逻辑不出数字」铁律的论文级实证【已核】。
   - **b. supervisor只输出「补充查询+high/med/low 改判置信」**：若上 supervisor，输出不是新数字；改判仅 high 置信生效，失败回退均值。L0 只记不评期可先记 R_i 轨迹与分歧度（10 路极差/方差），攒够 200 条回测 supervisor 增益。
   - **c. Platt 系数 √3 直接抄**：无需训练数据；L0 期双轨记账——原始判词与 Platt(a=√3) 后判词各记一列，resolve 后直接对比。**注意论文自警：校正只在原始方向正确时有肉，方向错则放大损失——先保证判词质量再上校准。**
2. **对局账本=特征源有论文背书**：市场价格本身是强特征（无搜索 LLM +价格即 +11.2%）→ 对应本项目「账本历史 resolve 数据/基率」就是我们自己的「市场价格」：判词 prompt 喂机械算出的历史基率统计（非 LLM 编造）。
3. **评测口径（进 L1 时）**: 抄附录 A 题级差值 bootstrap 10000 次 p 值法做显著性；抄 §5.2 判官思路做「复盘泄漏检测」（resolve 结果不得进评测期判词上下文——与「200 条前只记不评」同构，再加一层 judge 审计）。

### ⑧ 发散联想（全部【未经验证猜想】）
1. 【未经验证猜想】**玄学第 4 路的合法位置**：论文证明「跑输共识的信息源仍可有正多样化增益」（MarketLiquid 集成 0.106 < 市场 0.111）。梅花/玄学判词的合法角色不是「预测信号」而是「与 LLM 判词低相关的多样化源」——其权重由 simplex 回归如实给出（大概率≈0）。可拿 L0 账本数据直接跑 simplex 回归验证玄学路正增益，让数据说话。这给铁律①一条**可翻案的量化通道**（即便翻身也守 UI「娱乐参考」铁律，不进研判）。
2. 【未经验证猜想】**参谋卡=「找分歧点→补证据」而非历史案例检索**：best-of-k（从 k 张判词选最像的一张）by design 永不超越候选且 7.2% 选中最差 3 → 参谋卡若做成「检索最相似历史局」就是 best-of-k 的变体，天生上限。正确形态照 agentic supervisor：找当前判词的分歧点→定向补证据→high 置信才改口。
3. 【未经验证猜想】**对局账本「夜巡」模式**：仿 MarketNightly 每晚对活跃事件抽样出判词入库，n 积累从「等 resolve」变「滚动记新局」，200 条门槛更快达成，且天然构成 live 前瞻记录（论文用夜更自证无 foreknowledge，我们同理可自证）。
4. 【未经验证猜想】**Platt 系数随路数增长**：论文单一 √3，但均值路数越多越向 0.5 收缩，所需 extremization 越强。猜想 d 应随 n 增长（n=1→d≈1；n=10→√3；n=50→>2）。论文未研究 n–d 关系，可当我们 3 路（0.2/0.7/1.0 温度）配置的消融点——3 路均值的方差比 10 路大，可能 d<√3 更优。
5. 【未经验证猜想】**「基率-only 永久消融臂」**：Karger SOTA 0.109 不如直接抄价格 0.096；AIA 0.075 才跑赢。任何判词系统上线评测须先回答「直接记历史基率会不会分更高」——把基率-only 臂设为永久对照组，防 LLM 判词只是基率的噪声版。

### ⑨ 存疑与可疑处（red-team）
1. **Bridgewater 出品，广告嫌疑**：全球最大对冲基金的 AI 实验室自评自家系统；「first work that verifiably achieves expert-level」系自封。不可复算：搜索商匿名（Search-A/B）、新闻语料私有、核心 prompt 未公开、无代码/数据链接【已核：论文无】。0.0753 vs 0.0740 的「平价」建立在不可复现的私有管线上。
2. **SF 基线可能偏弱**：SF 平均仅 8 人/题（最少 3）——Tetlock 团队常态是几十人组队+多轮讨论更新；8 人中位是否代表 SF 真实战力存疑。且 SF 数据是 Karger 2024 论文发布时的静态数字，AIA 运行时点自选（2025-08），时间不同步。
3. **数字小对不上**：①表1 FB-7-21 resolution range 写「7/28/2024–12/31/2050」，正文却说「resolve between July 2024 and June 2025」——footnote 5/6 的挂盘日 vs 实际结算日区分可解释但表内未标注，易误读；②§5.1 正文「0.11435 to 0.1230」vs 表3「0.1140/0.1230」——0.11435 四舍五入应为 0.1144，小数位不一致【已核：原文两处并存】。
4. **MarketLiquid 有效样本量存疑**：名义 1610 题实为 322 市场×5 时点，同市场 5 时点高度相关，p 值可能低估不确定性；平台未点名；仅 6 周结算窗口（2025-04~05）。
5. **Live 头条的限定**：「3.6×」来自 n=64 已结算市场（极小样本）；1750 题的 0.0522 vs 0.0910 是「对市场价计分」——论文自认 perfect forecaster 也不会得 0，该指标只证明「有搜索的输出更贴近市场价（信息含量）」，不证明「更准」。引用此节须带限定。
6. **选择性审计嫌疑**：OSS-120b 因 17.09% 泄漏被弃，但未给去泄漏后修正分；Sonnet 4（0.1195，名义第二）论文自认 cutoff 贴脸「complicates interpretation」，却未对它做同样的泄漏审计——为何只审 OSS-120b？基座表 F 的排名因此不完全可信。
7. **Platt 与 supervisor 的叠加口径**：表10（0.1125）与表11（0.1076）是否同一管线叠加（supervisor→Platt）需从数字互洽反推，论文未明说每表是否含校准——消融表之间的可比性有含糊处【待验证】。

---

*回合1完（2026-09-11 15:35）：AIA Forecaster（2511.07678v1）全文精读毕。*
---

## 论文 2：Evaluating LLMs on Real-World Forecasting Against Expert Forecasters（arXiv:2507.04562v3）【回合2】

### ① 元数据
- arXiv id: 2507.04562，v1 2025-07-06 提交，本精读为最新 v3【已核】
- 作者: **Janna Lu（单作者，独立研究者）**；Emergent Ventures 资助；致谢 Tyler Cowen、Eugene Cheah、Claude、o3 审阅——无机构挂名【已核】
- venue: arXiv 预印本；v1→v3 变更注记：原称专家为 superforecasters，因 Good Judgment Inc. 商标改名「expert forecasters」（脚注1）——**本文专家=Metaculus 顶级锦标赛 forecaster，≠ GJ superforecasters**【已核】

### ② 全文获取路径
1. arxiv.org/abs/2507.04562 → 确认 v1/v2/v3，v3 为最新【已核】
2. 队长下发 batch_extract.py（D:\agent1super\scripts）首次实战：**python 命令是 WindowsApps stub（EXIT 9009 假成功），须用 py 启动器**（Python 3.13.3）【已核·踩坑记录】
3. py batch_extract.py https://arxiv.org/html/2507.04562v3 → cache/001_arxiv.org.md（61,600 chars / 469 行，trafilatura 提取，表格全保留）【已核】
4. 同批顺带缓存 ForecastBench：arxiv.org/html/2409.19839 → cache/002_arxiv.org.md（127,407 chars）供后续回合精读【已核】
5. 提取质量：结构/表格/附录 prompt 全文完好；**Brier 公式与变量名被 trafilatura 剥掉**（公式系 MathML/图片），自上下文+标准式重建并标注【已核·重建】；全文可得 ✅

### ③ 核心贡献（3 句）
1. 12 个前沿模型 × 464 道 Metaculus 真题（334 主集 + 130 防泄漏 hold-out），对比 Metaculus 付费 10 名顶级 forecaster（157/41 题）：o3 直接预测 0.1352 已超人类 crowd 基线（Halawi 0.149，异题集），但声称仍「显著落后」专家（0.0225——**该数口径存疑，见⑨1**）。
2. 工程配方：AskNews 新闻管线（30 篇/题、回溯 open 前 60 天、Llama-3.1-72B 压摘要、backtest 模式保无泄漏）+ 每题 5 次独立重复取均值/中位双集成降噪 + 「先区间后最可能值」输出格式优于直接报数。
3. 两个反直觉发现：①叙事/剧本（fiction-jailbreak 式）prompt 全线变差（o3 0.1985 vs 直接 0.1352，Claude 叙事下对 80% 事件只报 50% 极端低自信）；②全模型政治类比经济类好（结构性领域差），2025 OpenAI 系 healthcare/biology 突出；线性外推 LLM 将于 2027-05 前达 SF 水平（仅作路标）。

### ④ 公式清单
【已核·重建】本文为实证评测文，无推导公式，仅 Brier 定义：
- P1（§4）: BS = (1/N) Σ_{i=1..N} (p_i − o_i)²；p=模型预测，o∈{1=yes, 0=no}；0 完美、1 全反、恒猜 50% → 0.25、>0.25 劣于随机。原文公式被提取器剥落，按正文「mean squared error」+变量定义重建（与 2511.07678 P3 同形）。
- P2 教学数值例（§4 正文）：预报 90% 下雨：下了 (0.1)²=0.01 / 没下 (0.9)²=0.81，各半平均 0.455；改报 60% → 0.26；过自信惩罚机制示例。

### ⑤ 方法实现细节（能抄多细抄多细）
【已核·全文】
- **新闻管线（§3+§4）**: AskNews（引 Törnquist & Caulk 2024）；每题返回 30 篇相关文章，回溯至问题 open 前 60 天；文章由 Llama-3.1-72B 压成几句摘要；**支持 back-testing：不返回 close 日之后发布的文章**（防泄漏核心机制）。作者实测 AskNews 优于 Perplexity——后者常混入几年前的旧文反而干扰模型（即使传了发布日期）。
- **集成（§4）**: 每题 5 次独立 API 调用（同 prompt、默认温度、模型看不到自己历史预测）→ 报「均值集成」与「中位集成」两种 Brier。OpenAI reasoning 系 reasoning_effort="medium"（默认）。12 模型：GPT-4o / GPT-4o-mini / GPT-4.1 / o4-mini / o3 / o3-pro / Claude-3.5-Sonnet(0620+1022 两版) / Claude-3.6-Sonnet / Qwen3-32B / Qwen3-235B-A22B / DeepSeek-v3-0324 / DeepSeek-R1-0528；全部 cutoff ≤ 2024-07（早于全部题目）。
- **Direct prompt（Appendix C 全文抄录要点）**: ①人设「You are a superforecaster…」+ Brier 两成分讲解（calibration: 概率对应客观频率；resolution: 高概率给真发生的事件）；②输入槽位 {title, resolution_criteria, formatted_articles, background, fine_print, today}；③思维流程：先找 reference class/基率 → 再按最新新闻与当下特殊点调整（警告 over-adjusting）→ 权衡两类错误；④引「Tetlock 十诫」（**实际只列 9 条**，见⑨4），第 1 条就是「triage and reference relevant predictions from humans…such as FiveThirtyEight, Polymarket, and Metaculus」（注意：prompt 鼓励参考人类预测源！）；⑤输出格式锁定："My Prediction: Between XX.XX% and YY.YY%, but ZZ.ZZ% being the most likely. Probability: ZZ.ZZ%."，范围限 0.10–99.90、两位小数、其后不得加字。
- **Narrative prompt（Appendix C 全文抄录要点）**: 剧本设定=Nate Silver 与 Philip Tetlock 对话，场景在 resolve 次日；规则 5「experts only get news up to {date}」；规则 6 强措辞「The models are NEVER wrong on any topic」——作者注：不加此句模型会写出「专家预测错了并叹气」的剧本；规则 7 「yes 回答>50%、no<50%」；剧本 <150 词。
- **题目结构（Appendix A 例题全字段——预注册判据样板）**: Title（单一 yes/no 问句）/ ID / Background / Open Time / Actual Close Time / Scheduled Resolve Time / Actual Resolve Time / Status / Type=binary / **Resolution Criteria**（写死数据源+访问方式+阈值+判定时点，例：「resolves Yes if FSIS 页面状态由 Active 变 Closed，且由 Metaculus 在 9-30 后访问到」）/ Resolution（真值）/ **Fine Print**（排除条款：「No other resolution source will be considered」「拆股/并股不影响本题」）。
- **分类（Appendix C+D）**: Gemini 2.5 Flash 按 7 类打标（Politics & Governance 112 / Economics & Finance 82 / Science & Tech 45 / Sports 32 / Healthcare & Biology 31 / Arts & Rec 16 / Environment & Energy 16）。专家作答子集 157 题分布近似（Politics 65 / Econ 32）。
- **样例答案对照（Appendix B）**: 同一 USDA 召回题：o3 走标准流程——outside view 基率（5 年内 85% 类似召回 3 个月内关闭，median 55 天）→ inside view（量小、保质期将至、无疾病报告）→ 减 7pp 行政延迟、减 3pp 模型不确定性、加回 5pp（题目简单+还有两周）→ 80%（区间 65–90）→ **答对**（resolved yes）；GPT-4o-mini 泛泛而谈「监管谨慎趋势」→ 30% → **答错**。教科书级的「基率+调整」vs「氛围推理」对照。
- **未披露**: 温度具体值（只说 default）、每题成本、新闻摘要与原文哪个进 prompt 的细节（说 fed with articles）、专家的选题机制。【已核：全文检索无】

### ⑥ 实验数字表（自原文表格抄录【已核】）
表A 主集 direct（median ensemble Brier；括号=mean ensemble）:
o3 **0.1352**(0.1362) > o3-pro 0.1386 > GPT-4.1 0.1542 > o4-mini 0.1589 > Deepseek-v3 0.1798 > Claude-3.6 0.1810 > GPT-4o 0.1883 > Qwen3-235B 0.1923 > Claude-3.5 0.1947 > Deepseek-r1 0.1950 > Qwen3-32B 0.2066 > **GPT-4o-mini 0.2743（劣于随机 0.25）**。
参照系（异题集仅示意）：Halawi 人类 crowd 0.149、Karger FB 0.121。
表B 主集 narrative（median）: GPT-4.1 0.1842 / Qwen3-235B 0.1871 / GPT-4o 0.1940 / o4-mini 0.1977 / **o3 0.1985（比 direct 差 0.063）** / o3-pro 0.2033 / Claude-3.6 0.2345 / Deepseek-v3 0.2689 / GPT-4o-mini 0.3047。→ direct 全线优于 narrative。
表C hold-out 130 题: o3-pro 0.1307 / o3 0.1375 / GPT-4.1 0.1575 / o4-mini 0.1626（与主集排名基本一致 → 主集结论稳健）；narrative hold-out: o3 0.1544（叙事差距缩小，作者归因噪声）。
表D 专家（Metaculus 付费 10 人）: 主集 n=157：**Mean Brier 0.1573 / Median Brier 0.0225 / SE 0.0189**；hold-out n=41：Mean 0.1222 / Median 0.0196 / SE 0.0309。
表E 分类分解（主集 direct，摘要）: o3-pro 各类全面领先（econ 0.1437 / health 0.1075 / politics 0.1170）；全模型 politics(0.09–0.35) 优于 economics(0.14–0.34)；2025 OpenAI 系 healthcare 突出（o3 0.1305 / o4-mini 0.1042）。
表F 杂项: DeepSeek 两模型因 API 审查拒答 9 道 China-Taiwan 题；校准图：模型普遍对高概率事件过自信，Qwen3-32B 对实际频率 50% 的事件报近确定；Claude 双子叙事下对 80% 事件报 50%（极端低自信）。

### ⑦ 对本项目落地点（含队长点名：resolution criteria 预注册判据可抄什么）
1. **5 次重复+双集成记账直接抄进账本 schema**：本项目 3 路=3 prompt 变体×温度（0.2/0.7/1.0），本文证明同 prompt 重复 5 次的采样方差本身就要用 mean/median 双记压噪（median 略稳）——账本每局对每路记 {p_mean5, p_median5}（或至少路内 2 次重复），resolve 后对比哪种集成 Brier 更低，为 AIA 式 10 路扩展攒数据。
2. **AskNews backtest 模式=新闻臂现成合规选项**：判词若要喂新闻，AskNews 是已验证的「backtest 不泄漏」管线（30 篇/60 天回溯/摘要压缩）；本项目等价铁律=「新闻在 open 日冻结」，与 L0「只记不评」同构。
3. **输出格式白捡微优化**：「先区间后最可能值」实测略优于直接报数+置信 → 判词卡模板采用 "Between X% and Y%, but Z% most likely. Probability: Z%."，锁 0.10–99.90%（天然防 0/1 满置信，与 L0 歧义不硬判配套）。
4. **叙事/角色扮演 prompt 全面禁用（对 W2 三路变体的直接指导）**：fiction-jailbreak 框架全线变差且诱发极端低自信——三路 prompt 变体只准在「分析框架/证据顺序/基率提示」上做变体，禁止叙事化包装。
5. **【队长点名】Metaculus 题目字段=预注册判据的直接模板**，验证点落卡对齐六字段：①Title 单一 yes/no 问句（无歧义主语+明确时点）；②Resolution Criteria 写死**数据源+访问方式+阈值+判定时点**（例句式：「由 X 在 Y 日期后访问 Z 页面，状态为 A 则 Yes」）；③Fine Print 排除条款（「其他来源一律不计」「拆股并股无关」式负面清单）；④Open/Close/Scheduled Resolve/Actual Resolve 四时间戳分列（挂盘日≠实际结算日，AIA 论文同样踩过这坑）；⑤Status 字段（open/closed/resolved 生命周期）；⑥Resolution 真值回填时留审计链。D-裁决§4 预注册判据清单可按此字段结构重排。
6. **分域记账+小模型统一打标**：politics > economics 是全模型结构性差 → 账本每局打域标签（可用 gemini-flash 级小模型+固定类别枚举），评估分域看防总分掩盖短板。
7. **「十诫进 prompt」可信但要截尾**：本文把 Tetlock 十诫塞进 prompt 是标准操作，注意人类预测源引用条款（FiveThirtyEight/Polymarket/Metaculus）——本项目判词 prompt 可加「参考账本历史基率」条款（对应十诫第 1 条的位置）。

### ⑧ 发散联想（全部【未经验证猜想】）
1. 【未经验证猜想】**专家 0.0225(median) vs 0.1573(mean) 的巨型差=专家「多数近确定正确+少数灾难过自信」的分布形状**——若真，专家同样需要 Platt 校准，而本文没做；我们账本可对「专家式单路高分预言者」与 LLM 路同跑 Platt 双轨，校准可能部分反转「专家优势」叙事（与 AIA 论文图6「SF 加校准才公平」呼应）。
2. 【未经验证猜想】**DeepSeek 拒答 9 题揭示「弃权路」处理问题**：国产模型在敏感域天然弃权 → 多路聚合时弃权路计什么？（重采样/记 0.5/剔除重归一）本文直接当缺失 impute——我们 3 路若含国产模型需预注册弃权处理规则。
3. 【未验证猜想】**prompt 人设的增益可能主要是格式约束而非推理增强**：o3 样例答案的「基率→调整→区间」结构完全来自 prompt 脚手架；可设计 2×2 消融（人设有无×十诫有无）分离「格式收益」与「推理收益」。
4. 【未验证猜想】**「预测→resolve 平均 38 天」+politics 优势 ⇒ 短窗口事件（<40 天）是 LLM 可行域**——与 A 棒「两周极限」锚点吻合；账本入局按「距 resolve 天数」分桶，用本地数据验证。
5. 【未验证猜想】**专家优势=更新频率+小幅更新**（引 Mellers/Karvetski：SF 多做 1% 粒度、更新更频）→ 账本加「同一事件 t1/t2/t3 多次判词」维度量「信息更新弹性」，这可能是 LLM 与专家的真实差距所在（LLM 是单次静态判词）。

### ⑨ 存疑与可疑处（red-team）
1. **中心数字口径错位（重大，动摇其摘要结论）**：摘要/结论宣称专家 0.0225 显著优于 o3 0.1352，但表 8：0.0225 是专家**每题 Brier 的中位数**（Mean 0.1573 同表在列），o3 的 0.1352 是**5 次预测均值集成的 Brier（对题平均）**——中位数(右偏分布) vs 均值、且题集不同（157 vs 334 子集）。同口径应比专家 mean 0.1573 vs o3 在 157 题子集的分（未报告）。若按 mean，专家可能反输 o3；hold-out mean 0.1222 vs o3-pro 0.1307 也在 SE 0.0309 内不显著。全文无 p 值，「significantly underperform」无检验支撑。
2. **§5.3 正文自相矛盾**：「o3 does slightly worse than previously (going from 0.1352 to 0.1307)」——0.1307<0.1352 是**变好**不是变差，且 0.1307 实为 o3-pro 的 hold-out 分（表：o3 是 0.1375）。方向语义与数字引用双错。
3. **主集 334 题新闻在 resolve 后收集**（论文自认），AskNews backtest 只保证不返回 close 后「发布」的文章，resolve 后收集时点的页面快照可能含事后更新——泄漏窗口存在；hold-out 130 题才是干净集，但其上结论只是「排名一致」的间接论证。
4. **专家选择性作答**：只答 47%（157/334），选题机制未说明——若挑有把握的题，分数不可外推全集。
5. **「十诫」只列 9 条**：prompt 写 "the 10 commandments" 然后编号 1–9。
6. **模型 cutoff 表排版错误**：GPT-4.1-2025-04-14 出现两行（第二行疑为 o4-mini 之误），12 模型表实列 12 行但有重名——表格粗糙；narrative hold-out 表又把 Qwen3-235B 写成「Qwen3-2335B」。
7. **对 Karger 引用待核**：正文称 Karger et al. (2025) 测的最新模型是 Claude 3.6 Sonnet——ForecastBench 原论文（2024-09）测的是 Claude 3.5 Sonnet，3.6 系 2025 更新后补测【待验证：需核 2409.19839 各版本】。
8. **单作者+AI 审阅、私有数据**：Metaculus 锦标赛数据不公开管线，独立复算不可行；线性外推「2027-05 前 LLM 达 SF 水平」是无理论的直线延申，仅路标。

---

*回合2完（2026-09-11）：Lu 2507.04562v3 全文精读毕（⑤-⑨补记于回合3开局——缓存覆盖事故中断所致，如实注记）。Prophet Arena（2510.17638v2）已缓存 cache/003 待回合4。*
---

## 论文 3：ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities（arXiv:2409.19839）【回合3】

### ① 元数据
- arXiv id: 2409.19839（2024-09 提交；**v1–v5 共 5 版，本精读=官方 HTML v5**，HTML 头标记核实）；作者 Ezra Karger、Houtan Bastani、Chen Yueh-Han、Zachary Jacobs、Danny Halawi、Fred Zhang、Philip E. Tetlock 等【已核】
- 机构: **Forecasting Research Institute (FRI)** + Federal Reserve Bank of Chicago（通讯 footnotetext 提及；通讯 forecastbench@forecastingresearch.org）【已核】
- 资助: Open Philanthropy（承诺维护至 2027 年中）；开源代码；IRB 855431【已核】
- 谱系地位: AIA 论文与 Lu 论文共同的基准参照系；AIA 的 Eq.2 extremization、Halawi scratchpad、「搜索无用」争论全部溯源到此文【已核】

### ② 全文获取路径
1. batch_extract.py 抓 arxiv.org/html/2409.19839 → cache/002_arxiv.org.md（129,674 B / 1,561 行）【已核】
2. **trafilatura 缺陷实录**：行内公式数字被剥（组合题 Brier、Arena 相关系数、算力外推全裸）+ 复杂表格列错位（三列 Brier 表错行）→ 补救：Invoke-WebRequest 原始 HTML + 自写 _extract-html.cjs 重建 alttext 版 cache/_alttext-2409.19839.txt（144,530 B / 7,921 行，公式全保留）【已核】
3. 双版本对照读法沉淀：**md 版看结构/表格框架，alttext 版核数字**——后续论文照此双抓【已核·方法论】
4. 表 2 列错位修复：用论文明示口径 overall=(dataset+market)/2 反推列序（SF: dataset 0.118/market 0.074/overall 0.096，与 A 棒锚点 SF 0.096 吻合 ✓）【已核·推断修正】
5. 全文可得 ✅（正文 §1-8 + 附录 A-M 全读；References 未逐条）

### ③ 核心贡献（3 句）
1. 首个动态免泄漏预测基准：每晚 0:00 UTC 自动从 9 源抓题入库（4 市场源 Manifold/Metaculus/Polymarket/RFI + 5 数据集源 ACLED/DBnomics/FRED/Wikipedia/Yahoo Finance = 6,435 标准题 + 617 万组合题池），每两周发 1000 题 LLM 题集（500 标准+500 Boolean 组合）+ 200 题人类题集；只收「提交时无已知答案」的题——**结构性消灭数据泄漏**（静态基准被 cutoff 追上/训练污染/刷榜三大死因全避）。
2. 三方基线（500 公众+39 SF+17 LLM×7 基线）：SF overall 0.096 < 公众 0.121 < 最强 LLM Claude-3.5-Sonnet 0.122（配对 p<0.001）；LLM 靠 freeze values（市场 crowd 冻结价）才勉强追平公众，news 检索反而有害（0.122→0.127）——「非 agentic 检索无用」结论的原始出处（后被 AIA agentic 搜索反转）。
3. 组合题（Boolean AND/OR）=LLM 结构性失败模式：独立性假设下人类界 SF 0.076/公众 0.096 vs GPT-4o 0.130——LLM 不掌握事件间协方差结构；Arena 分数与 Brier 线性相关（r=-0.68, p=0.003），外推 Arena≈1406 或算力 6.49×10^26 FLOP 时 LLM 追平 SF。

### ④ 公式清单
【已核·md 版被剥、alttext 版找回】
P1 Brier（§2）: BS(p,o)=(p−o)²，p=概率预测，o=结果；lower better；0.25=无信息恒猜 50%；strictly proper。
P2 总分合成口径（表 2 notes 原文）: **overall = (mean dataset Brier + mean market Brier) / 2**——两域等权平均；引用 FB 数字必须知道这是双域等权合成而非逐题平均。
P3 未结算市场题临时计分（§3.3）: BS_temp = (forecast − crowd_prev_day)²，crowd_prev_day=平台前一日的群体聚合价；结算后切换为 ground truth。→ 未 resolve 也有中间信号。
P4 缺失预测 impute（§3.3）: 市场题缺答→impute 当日 crowd 值；dataset 题缺答→impute 0.5（全部 horizon）。
P5 组合题独立性界（§5.2）: P(A∧B)|human ≈ P(A)·P(B)——人类未直接作答组合题，按分量独立假设构造人类成绩（**高估人类 Brier=保守界**，真实人类考虑相关性后应更好）。
P6 LLM ensemble 三聚合（§5.1 基线7+附录 E.2）: median / geometric mean / **geometric mean of log odds**（Satopää et al. 2014 extremization 法）：log-odds 几何均值=先逐路 logit 化、几何平均、再 sigmoid 还原——即 AIA 论文 Eq.2 (d=1) 的同族方法【已核：两文互证】。

### ⑤ 方法实现细节（能抄多细抄多细）
【已核·全文（md 版+alttext 版双读）】
- **题库管道（§3.1）**: 每晚 0:00 UTC 自动跑；来源表：Manifold(405 题/81,810 组合)、Metaculus(722/260,281)、Polymarket(915/418,155)、RFI(18/153)｜ACLED(3,220/5,182,590)、DBnomics(52)、FRED(166)、Wikipedia(428)、Yahoo Finance(509)；市场源选高流动性题；数据集源用固定模板生成（例句：「Will the number of protests in Niger increase by at least 10% over this month's value by the resolution date?」）；gpt-4o-mini 做主题分类+低质过滤。
- **题集与防作弊时间学（§3.2）**: 每两周日 0:00 UTC 发 LLM 集 1000 题（每源等量+每类均匀→防过拟合题型）；人类集 200 题（无组合题，专家贵）；dataset 题 8 个 forecast horizon（7天~10年）；组合题=同源两题配对出 Boolean 组合（市场 4 个、dataset 32 个）。**时间设计：题集提前 10 天生成（人类调查要时间），LLM 队伍只提前 24h 收到**——压缩 gaming 窗口，保证人机同信息环境。
- **Resolution（§3.3）**: 市场题未结算→按前一日平台 crowd 价计分；结算→ground truth。dataset 题按最新数据滚动结算（数据会修订）。缺答 impute：市场=crowd、数据集=0.5；强制全题作答（1000 题×24h 使人工手答不可行）。
- **人类基线（§4+附录 I）**: 公众 500 人（Prolific+FB 广告；预筛反作弊：答题过快/同 IP 多份踢出）；每人 1 小时 20 题；每题≥40 份、平均 49 份。SF 39 人、9 天实验：**前半独立预测，中点后组内互看彼此预测+理由并可交流**；可主动加做额外题；每题≥3 份、平均 8 份。两组聚合=每题取 **median**。
- **LLM 7 基线（§5.1）**: ①zero-shot ②scratchpad（Halawi 式：复述扩题→no 理由+强度→yes 理由+强度→聚合 think like superforecaster→初始概率→过自信自检→输出 *p*）③scratchpad+news（Halawi 检索设施：LLM 生成 query→过滤→摘要）④⑤⑥各加 **freeze values**（市场题=建题日 crowd 价、dataset 题=基线值+解释）⑦ensemble=3 模型（GPT-4o/Gemini-1.5-Pro/Claude-3.5-Sonnet，Halawi 集预赛选出）×3 个 **FRI superforecaster 手写 prompt**=9 预测/题。
- **超参数（附录 E.3+J）**: **temperature=0（全部基线）**；zero-shot max 50 tokens；scratchpad max 1300 tokens（实测最大响应 ~1250 后定的）；retrieval 仅限 context>8k 模型；推理 50 workers 多线程。
- **三个 SF 手写 prompt 要点（附录 F 全文抄录）**: F6 主力 15 步——①复述扩题 ②**选 reference class+给明确基率数字**（例：inventor 连任 60%；要求基率尽量具体但不失真）③上调因素（**要求写明百分点变化**）④下调因素（同）⑤其他因素 ⑥聚合+按影响力排序 ⑦**outside-the-box 补脑**（微软 5tn 例：公司不存在/通胀侵蚀/被并购/被拆分——低概率但必须入账）⑧初始概率 ⑨**odds ratio**（快进赌注思维）⑩2-3 个条件命题（**不得逻辑等价于原题**）⑪各条件概率 ⑫全盘 odds ⑬odds→概率 ⑭⑧与⑬双概率对冲终选 ⑮输出 *p*。F7 简化 5 步 odds 版；F8 news 版 10 步（先两轮忽略新闻→初始概率→新闻增/减理由→更新→自检）。
- **ensemble 聚合对比（附录 E.2，Halawi 集）**: median 0.197 / trimmed 0.197 / geo-mean 0.194 / log-odds geo-mean 0.194——几何系并列最佳，median 稍差。
- **榜单（§3.4）**: 每晚更新；可按 market/dataset 与 resolved/unresolved 切分；www.forecastbench.org。

### ⑥ 实验数字表（自原文表格抄录；表 2 列序经口径反推修正【已核·推断修正】）
表1 人类 200 题子集（498 horizons）[dataset(422)/market(76)/overall(498)]:
| 参赛者 | dataset | market | overall | 95% CI | p(vs No.1) |
|---|---|---|---|---|---|
| **SF median** | 0.118 | **0.074** | **0.096** | [0.076,0.116] | – |
| 公众 median | 0.153 | 0.089 | 0.121 | [0.101,0.141] | <0.001 |
| Claude-3.5-Sonnet(freeze+scratchpad) | 0.138 | 0.107 | 0.122 | [0.099,0.146] | <0.001 |
| Claude-3.5-Sonnet(news+freeze) | 0.142 | 0.112 | 0.127 | <0.001 | |
| GPT-4-Turbo(freeze+zero-shot) | 0.162 | 0.095 | 0.128 | <0.001 | |
| **Claude-3.5-Sonnet(无信息+scratchpad)** | 0.138 | **0.133** | 0.136 | <0.001 | ← market 崩：无 crowd 价时 0.107→0.133 |
- A 棒锚点核验：SF 0.096 / 公众 0.121 / 最强 LLM 0.122 全部吻合 ✅【已核】
表2 全集 1000 题（6,389 horizons，LLM only）: Claude-3.5(freeze+scratchpad) 0.123 [0.117,0.129] > GPT-4-Turbo 0.126 > GPT-4o 0.128 > Gemini-1.5-Pro 0.134…排名与 200 题子集一致。
表3 组合题（Table 20，人类按独立性界）: **SF 0.076 / 公众 0.096 / GPT-4o 0.130**；SF−GPT4o 差 **0.054** > GPT4o−GPT4 差 **0.026**（组合题使人机差距翻倍拉大）。
表4 ensemble 聚合（附录 E）: 见⑤；胜者 log-odds geo-mean 0.194。
表5 分项分解（附录 M，Claude-3.5 vs SF）: SF 全域胜除两处——Environment&Energy（Claude 反超 0.015）与 **90-day horizon（Claude 反超 0.021）**；差距最大 Economics&Business 0.090；horizon 差：7d +0.017/30d +0.042/90d −0.021/180d +0.028。
表6 规模外推（图 1）: Arena r=−0.68 (p=0.003)，Arena≈**1406**（CI 1346–1633）追平 SF；训练算力 r=−0.67 (p=0.046)，**6.49×10^26 FLOP**（CI 9.69×10^25–8.65×10^28）。

### ⑦ 对本项目落地点（队长点名四项全覆盖）
1. **【免泄漏机制】结构性优于纪律性**：FB 釜底抽薪=「只收提交时无已知答案的题」+「dataset 题滚动结算+市场题结算前按 crowd 临时计分」——静态题池迟早被新模型 cutoff 追上（本文 §1 三大死因：cutoff 过时/训练污染/刷榜激励）。对应本项目：账本入局只收「resolve 在未来」的局；「200 条只记不评」是纪律版，升级方向是结构版=判词上下文只含 open 日前冻结的信息（Lu 文 hold-out 同构）。
2. **【三方口径对照——G 合并必读】**三文三口径不可直比：①FB v5 人类子集（200 题、498 horizons、双域等权合成）：SF 0.096/公众 0.121/最强 LLM 0.122（2024-09 快照，Claude-3.5 代）；②AIA 引 FB-7-21（498 题、2024-07 快照）：SF 0.1110/AIA 0.1076（2025-11，o3 代+agentic 搜索）；③Lu（464 Metaculus 题）：o3 0.1352/专家 mean 0.1573（median 0.0225 口径存疑）。**引用任何「专家 vs LLM」数字必须带题集+口径+日期三要素**；时间线 2024-09 LLM 落后 → 2025-11 平价 = 追赶斜率的三个锚点。
3. **【resolution criteria 可抄】**：①dataset 题固定模板句式（「Will X 增/达 ≥N% by the resolution date?」+固定数据源）——验证点落卡可用模板化句式保证可机判；②结算前「前一日 crowd 临时计分」=本项目「未 resolve 局按账本群体中位临时记分」的机制原型，L0 期就有中间反馈信号，不必干等 resolve；③impute 规则（缺答按 crowd/0.5）=判词弃权/超时的处理预案。
4. **【榜单更新机制】**：夜更 leaderboard+分域分结算状态切分——对应「账本夜巡+每日中间分」；freeze values 实证「喂冻结群体价」是单一最大信息增量（market 0.133→0.107，差距 26% 收窄）→ 账本冻结基率进判词 prompt 的最强文献背书（与 AIA「+价格 +11.2%」互证）。
5. **组合题教训**：LLM 按独立乱算组合事件（0.130 vs SF 0.076）——对局若涉「A∧B」复合验证点，须把账本共现统计 P(A|B) 显式喂给判词，否则结构性崩。
6. **SF 手写 15 步 prompt 是判词 prompt 的参考母版**：基率→带百分点的上调/下调→outside-the-box 低概率分支→odds ratio→条件命题对冲——本项目 3 路 prompt 变体可从 15 步里拆「基率先行版」「条件对冲版」「标准 scratchpad 版」三路，正好对应变体维度。
7. **temperature=0 是官方基线默认**：FB 全基线 temp=0+max 1300 tokens；我们 3 温度设计文献罕见——保留温度多样性但补一路 temp=0 对照（成本允许时），把「采样多样性 vs prompt 多样性」拆开度量。

### ⑧ 发散联想（全部【未经验证猜想】）
1. 【未经验证猜想】**freeze values 增益（0.133→0.107）可能是账本基率喂给增益的上界样本**：市场 crowd 是最强基率源，我们的账本群体中位弱于市场价——预注册「判词±冻结基率」对照，实测增益落点。
2. 【未经验证猜想】**SF「9 天中点互看+交流」= GJP 团队化的现代复刻**：我们 3 路判词出 rationale 后加一轮「互相可见+定向改判」（AIA supervisor 的 LLM 版）结构同源；变体=只互看摘要不看全文（防锚定）。
3. 【未经验证猜想】**组合题崩=缺事件相关性先验**：账本共现统计（P(A|B)/P(A) 比值表）可生成「相关性修正卡」——可能是把领域知识注入 LLM 的最大杠杆，且完全机械零 LLM（符合「LLM 出逻辑不出数字」）。
4. 【未经验证猜想】**外推线低估范式切换**：Arena 1406/算力 6.5e26 的线性外推基于无搜索时代快照；AIA（agentic 搜索+supervisor+校准）2025-11 即平价=工程范式跳变先于规模外推——对「预测未来能不能实现」的元启示：**系统设计比模型规模先到线**。
5. 【未经验证猜想】**ACLED 模板题=自有题源工程**：游戏对局数据若可模板化（「下局 X 会 ≥N 吗」）+自动 resolve=本项目的 ACLED——账本题源从「人工记局」升级「模板批量生成」，n 积累速度质变；且模板题自带 resolution criteria（预注册判据天然成立）。

### ⑨ 存疑与可疑处（red-team）
1. **表 2 列错位修复依赖推断**：trafilatura 把三列 Brier 错行，我用 overall=(dataset+market)/2 反推列序——反推自洽（SF 0.096 吻合 A 棒锚点）但仍是推断【已核·推断修正】；正式引用前建议人工核原 PDF。
2. **SF 平均 8 人/题（min 3）**：与 AIA 笔记同款质疑——8 人中位能否代表 SF 实力存疑；且 9 天实验中点后互看+交流可能引入群体锚定，FB 只取 median 未做 extremize（GJP 传统是 extremize 的）——SF 基线可能是「未优化聚合的 SF」。
3. **两表口径分裂**：Table 2（SF 0.096）不含组合题，Table 20（SF 界 0.076）含组合题——「SF 0.096」广为流传但不含 LLM 最弱项；引用须注明。
4. **「检索无用」时代局限**：news 检索有害的结论建立在 Halawi 式非 agentic 管线（固定 3 query→过滤→摘要）上；AIA 已证明 agentic 自适应搜索反转结论——本文该结论是历史坐标不是终审判决。
5. **模型时效**：17 模型全是 2024-05 前 cutoff（最强 Claude-3.5-Sonnet-20240620）；「LLM 落后 SF」有时效边界（AIA 2025-11 平价）。
6. **impute 偏软**：缺答市场题直接抄 crowd=白拿中游分，作者自认 overly-generous——对缺答多的模型的排名可能有水分。
7. **Wikipedia 源结算精度**：428 题依赖 Wikipedia 页面（会被事后编辑）；Elo 类题目结算弱于市场结算的硬性。
8. **SF 互看机制与「median only」**：交流后的预测取中位=群体智慧处理只做了一半（无 extremize/无精英加权）——GJP 官方预测是聚合+extremize+精英加权，FB 的 SF 基线口径偏保守朴素，这会**低估** SF 实力，反而对 LLM 有利——方向性注明。

---

*回合3完（2026-09-11）：ForecastBench（2409.19839v5）全文精读毕（含附录 A-M）。*
---

## 论文 4：LLM-as-a-Prophet: Understanding Predictive Intelligence with Prophet Arena（arXiv:2510.17638v2）【回合4】

### ① 元数据
- arXiv id: 2510.17638v2（2025-10-20 v2；Prophet Arena 官方论文，contact@prophetarena.co）【已核】
- 作者: Qingchuan Yang、Jibang Wu 等（部分工作完成于 University of Chicago；致谢 Alex Gu/Chaplin Huang/Lucien Liu）【已核·trafilatura 剥部分作者名，署名区仅存二人+机构注记】
- venue: arXiv 预印本（正文排版 ICML 风格）；数据源 **Kalshi**（受 CFTC 监管的美国合规预测市场）；数据集 Prophet-Arena-Subset-100 公开在 HuggingFace【已核】
- 谱系地位: 四篇中唯一「分析导向」基准（不为排名，为理解 LLM-as-a-Prophet 范式）；首创市场回报维度+统一 context 隔离设计；与 AIA 形成方法论两极（控制变量 vs 端到端）【已核】

### ② 全文获取路径
1. arXiv API 定位：export.arxiv.org/api/query ti:"Prophet Arena" → 2510.17638v2（唯一命中）【已核】
2. batch_extract.py 抓 arxiv.org/html/2510.17638v2 → cache/003_ProphetArena-2510.17638v2.md（110,294 chars / 1,004 行）【已核】
3. **batch_extract 事故与修复**：脚本每次从 001 重新编号 → Prophet Arena 覆盖了论文2 缓存 → 重命名 003 + 重抓论文2 恢复 001（教训已沉淀：每批抓完立即改名）【已核·踩坑记录】
4. 全文可得 ✅（正文 §1-5 + 附录 A-D 全读；行内公式变量名被 trafilatura 剥（与 Lu 文同款），但本篇公式结构简单、可自上下文无损重建；References 未逐条）

### ③ 核心贡献（3 句）
1. 提出 LLM-as-a-Prophet 范式并建成首个「模块化+多 horizon+市场回报」三维评测基准：1367 个已结算 Kalshi 事件/72,136 市场（每天 20 新事件），管线拆为事件抽取→统一 context 构造→概率预测三段，四项设计差异对照表（Live/概率化/Multi-horizon/模块化/回报维度）胜过 ForecastBench/FutureBench/FutureX/MIRAI。
2. 首创把「预测→赚钱」纳入评测：三维=Brier（绝对质量）+ECE（可靠性）+Average Return（相对市场优势），并给 CRRA 统一下注框架证明三维互不可替代（B.3/B.4：Brier 好可以回报差，校准好在风险厌恶下更有用）——主结果：GPT-5(High) Brier 0.184 略胜市场 0.187，o3 ECE 0.030 全场第一，但 **Sharpe 全员为负（含市场基线）**：按风险中性全押策略谁都亏钱，LLM 只是亏得更少。
3. 机制分析定位真瓶颈：①知识回忆「近似不精确」（日期对不齐）；②仅市场≈市场+新闻（新闻主要降方差非提均值）；③LLM 系统性保守主义（市场近确定仍不敢给极端值）；④**ceiling effect：source/evidence 维度全员近满分区（差 0.12/0.00），差距全在 reasoning synthesis（0.95）与 reasoning-prediction alignment（0.30）**——「检索已到顶，高阶推理才是分水岭」。

### ④ 公式清单
【已核·变量名自上下文重建（trafilatura 剥行内公式），结构无损】
P1 事件级加权 Brier（§3.1.1 Eq.1 + 附录 B.1）: 
    市场级 BS = (1/|M|) Σ_m (p_m − o_m)²（每个 market 二元独立结算，事件内市场可非互斥）
    事件级 = Σ_m w_m (p_m − o_m)²，**权重 w_m = 1/事件内市场数**——防大事件支配聚合，每事件等权。
- 与 FB 的 overall=(dataset+market)/2 口径、Lu 的逐题均值都不同——三基准三种聚合口径。
P2 ECE（§3.1.2 Eq.2 + B.2 Eq.4）: ECE = Σ_b (|B_b|/N) |acc(B_b) − conf(B_b)|，b=概率分箱，acc=箱内经验频率，conf=箱内平均预测概率；实测用 binned 近似（bins 数原文被剥【待查】）。B.3 数学例证明：**校准好≠Brier 好**（预测 (0.9,0.1) 各一题全对 vs 恒 (0.5)——后者 ECE=0 完美校准但 Brier 更差）。
P3 Average Return 与下注策略（§3.1.3）: 单位预算 $1，若 p̂>price 买 1/price 份 Yes（否则买 1/(1−price) 份 No）；结算后回报=持有份数（赢）或 0（输）；Average Return=各市场平均。**风险中性最优**（B.5 证明）。
P4 CRRA 统一下注框架（B.5 Eq.5-7）: u(w)=w^(1−γ)/(1−γ)；γ=0 风险中性→全押一边（主文策略）；γ=1 log 效用→闭式解按 (p̂−price) 比例分配；γ→∞→按自身概率比例投（与市场价无关）。优化：max_{a+b=1} p̂·u(a/price)+(1−p̂)·u(b/(1−price))。
P5 定理 B.4（校准预测者的对称回报）: 完美校准（E[o|p̂]=p̂）+充分性（o⊥price|p̂）+对称分歧（p̂−price 分布关于 0 对称）⇒ E[ret|买Yes]=E[ret|买No]——用迭代期望律+换元积分证明，含义：**校准+对称 ⇒ 买哪边期望一样，优势全来自分歧幅度**。
P6 Edge（A.4）: yes-edge = p̂/price，no-edge = (1−p̂)/(1−price)——LLM 相对市场的置信比。
P7 Sharpe（C.2 Eq.9）: SR = (E[R]−R_f)/σ(R)，R_f=0（不下注=保本）；实测全员为负。
P8 一致性分数（C.4 Eq.10-11）: 逻辑链分数（嵌套结果概率单调性：比特币>$200k 应 ≥ >$220k）+互斥分数（Σp ≤ 1+tolerance）——LLM-judge 自动识别链与互斥集。

### ⑤ 方法实现细节（能抄多细抄多细）
【已核·全文】
- **事件抽取（A.1）**: 每天午夜（UTC）从 Kalshi 拉取 20 个未结算事件；过滤三准则=Popularity（成交量/流动性/波动率）+Diversity（域均衡）+Recurrence（重复格式）；本文截止 2025-10-11 → 1367 已结算事件/72,136 市场。**构成偏差：76% Sports / 8% Entertainment / 7% Politics / 9% Other**（Kalshi 2025-08 时体育占主导；2023 前体育博彩在 Kalshi 不合法）。
- **多 horizon 调度（A.2）**: 每个 event 排一系列结算前预测时点——**halving 调度：每个后续时点放在「当前时点与 close 时间」的正中**（首时点 t₁，gap=close−t₁；t₂=t₁+gap/2……），最后一段设最小间隔防贴脸聚类。LLM 概率与市场价格都是时变的。
- **统一 context（A.2，与 AIA 谱系分歧点）**: 所有模型收到**完全相同**的 context：①GPT-4o（开 web search）搜来的新闻源（标题+摘要+时间戳+URL）②Kalshi 快照（last_price/yes_ask/no_ask→反推 implied probability，含手续费归一化）。设计目的=「隔离推理与校准差异，而非检索差异」；**searcher-agnostic**：搜索员是可插拔模块，换 searcher 不改协议——本文全实验用单 GPT-4o searcher。
- **Market Baseline**: 归一化合约价（Yes 0.8/No 0.1 → 80% Yes）作合成基准预测者——「难度标尺」：LLM 跑赢它=真有预测优势。
- **评测 LLM（A.5）**: 23 个（19 基础+reasoning 变体独立计）：GPT-5(Minimal/Medium/High)/o3/o3-Mini/o4-Mini/GPT-4.1/GPT-4o/Gemini 2.5 Pro/Flash(2 版)/Grok-4/Grok-3-Mini/Claude Sonnet 4/Opus 4.1/Kimi-K2/Llama 4 Maverick/Scout/DeepSeek-V3/R1/Qwen3-235B 等；hybrid 推理模型标 enabled/disabled，梯度型标 minimal/medium/high。
- **机制实验（§4）**: 用 100 事件子集（HuggingFace 公开）。知识内化（C.7）：100 个 cutoff 前 Kalshi 历史事件×三种 prompt（预测无源/预测+源/recall 显式回忆）——区分「记得但不会用」vs「根本没记住」。
- **概率引出消融（C.3，7 变体）**: verbalized（默认/更简/更繁/Grok-4 重写/prompt ensemble）+ **Bi-direction***（同时问 P(Yes) 与 P(No)，校准 p=P(Yes)/(P(Yes)+P(No))，作者自称发明）+ self-consistency（10 次采样投票 unweighted/weighted）。**结果：verbalized 对 prompt 变体极稳（<1σ）；Bi-direction 改善多数模型 ECE（LLM 倾向 Yes 过自信）；self-consistency Brier 大幅劣化（0.238-0.267 vs 0.16-0.20，10 票粒度仅 0.1）**。
- **LLM-as-judge 五维推理评估（C.6）**: source selection/evidence extraction/reasoning synthesis/reasoning-to-prediction alignment/uncertainty recognition，1-5 分；judge=Claude Sonnet 4（temp=0）；**人工盲评 170 条校准：平均绝对差 0.42/4 分，94% 差距<1 分**——judge 可信。
- **scaffolding prompt 消融（C.6.2）**: 结构化推理脚手架 vs 默认 prompt——Brier 差值 −0.019~+0.014 全不显著 ⇒ **推理脚手架不提升预测力（只是格式化已有能力）**；但与 Lu 文「区间输出格式微优」不矛盾（那是输出格式，这是推理模板）。
- **一致性检查（C.4）**: 逻辑链与互斥分数全员 0.99+（最差 Grok-3-Mini 逻辑链 0.901）——概率一致性已是成熟能力。
- **未披露**: 温度（judge temp=0 明示，预测模型温度未明示）、 searcher 的完整 prompt 在 §E.1.1/E.1.2（本文未含 E 节全文？——附录目录列到 D 节+§E 引用，E 节正文未随 HTML 提供或被截【待验证】）；搜索 query 数/频率无细节。

### ⑥ 实验数字表（自原文表格抄录【已核】）
表1 主表（Table 2，五代表+市场基线）:
| 模型 | Brier | rank | ECE | rank | Avg Return | rank |
|---|---|---|---|---|---|---|
| GPT-5(High) | **0.184** | ① | 0.042 | ② | **0.943** | ① |
| Grok-4 | 0.189 | ② | 0.043 | ③ | 0.864 | ④ |
| Claude Sonnet 4 | 0.194 | ③ | **0.041** | ① | 0.909 | ② |
| Gemini 2.5 Flash | 0.197 | ④ | 0.067 | ⑤ | 0.883 | ③ |
| Llama-4-Scout | 0.219 | ⑤ | 0.060 | ④ | 0.805 | ⑤ |
| Market Baseline | 0.187 | – | 0.069 | – | 0.899 | – |
→ **三维度排名互不相同**（GPT-5 Brier ①/ECE ②/Return ①；Claude Sonnet ECE ① 但 Brier ③；LLM 校准全胜市场 0.069；但 Return 无一过 1=全亏）。
表2 全表亮点（C.1，24 行）: GPT-5(High) 0.184①/0.187②(GPT-5 默认 Medium)/0.188(Minimal)④——reasoning effort 越高 Brier 越好；**o3 ECE 0.030 全场①**；Claude Opus 4.1 Return 0.982 全场①（最接近保本）；DeepSeek-R1 崩盘 0.303/ECE 0.165（比 Qwen3-235B 的 0.234 还差）；GPT-5 家族高→低 reasoning 的 Return 0.943→0.890→0.869。
表3 Sharpe（C.2）: **全员为负**：o3 −0.0131① > GPT-5 −0.0212 > Gemini 2.5 Pro −0.0230 … Market −0.0897 … Llama-4-Scout −0.1799/Flash-Lite −0.1842 垫底。
表4 elicitation 消融（C.3，Brier/ECE）: GPT-5: Default 0.165/0.020 → VariationA 0.162 → B 0.160 → C 0.159 → Ensemble 0.160 → **Bi-direction 0.158/0.023**；self-consistency unweighted 0.239（劣化 45%）/weighted 0.181。
表5 五维 judge（C.6 扩表）: GPT-5(High) 3.69/3.66/**4.14**/3.97/3.94（均 3.88）；o3 3.81；Gemini 2.5 Pro 3.73；GPT-5(Minimal) 3.61；Claude Sonnet 4 3.41；GPT-4o 2.79；Llama 4 Scout 2.68——**Synthesis 与 Align 两维拉开全部差距**（GPT-5 vs Claude：Synth 4.14 vs 2.93）。
表6 分类重加权稳健性（B.8）: Original(Sports 主导 N=816) 0.179-0.230 → Moderate(Sports 50% N=250) 0.146-0.202 → Full(25% 均衡 N=152) 0.128-0.210；排名不变；**Sports 越少 Brier 越好=体育题最难**（临近结算高噪声竞猜）。
表7 知识回忆（§4.2.1 图4）: Entertainment 回忆最好；Weather/Politics 最差（日期戳细粒度+每日变化指标）；GPT-5(High) 声称记得的全对，Llama 4 Scout/Gemini 2.5 Flash 大量假回忆。

### ⑦ 对本项目落地点
1. **三维评测=账本评估口径升级**：只有 Brier 不够（PA 首创三维论证：Brier/ECE/Return 互不可替代，B.3/B.4 有反例）——账本 resolve 后记三列：Brier + ECE 贡献（分箱）+「对抗基率臂的模拟增益」（见⑧1），L0 期就能跑。
2. **统一 context vs AIA agentic 搜索=谱系两极**：PA 用统一 context（同源同快照）隔离「推理能力」，AIA 用 agentic 搜索当最大杠杆——本项目折中：判词 context 由**机械层统一供给**（账本数据+固定检索管线），判词 LLM 不自主搜索（既符合「LLM 出逻辑不出数字」，又可复现可归因）。
3. **Bi-direction 校准白捡**：同时问 P(Yes) 与 P(No)、取 p=P(Yes)/(P(Yes)+P(No))——C.3 实测改善多数模型 ECE（LLM 倾向 Yes 过自信）；一行代码级改动，3 路判词可全部加反向问（成本×2，或先 L0 离线验证）。
4. **禁采样投票出概率**：self-consistency 10 票 Brier 劣化 45%（粒度 0.1 太粗）——我们「多路聚合」是跨 prompt 变体聚合（语义多样性，设计正确），但永远不要退化成「同 prompt 投票出数」。
5. **reasoning effort 是真实变量**：GPT-5 High>Medium>Minimal Brier 单调改善（0.184→0.187→0.188）且 Return 0.943→0.890→0.869——3 路温度消融之外，provider 支持 reasoning effort 时可加该维度。
6. **ceiling effect 指导 W2 变体维度**：source/evidence 全员近满分（差 0.12/0.00），差距在 synthesis（0.95）与 alignment（0.30）→ 3 路 prompt 变体在「综合与对齐」上做（基率先行 vs 证据先行；显式对齐检查步），别在「证据来源多样性」上做（到顶了）。
7. **构成偏差教训（76% Sports）**：事件构成决定结论普适性——账本按域配额或至少分层评估（FB 均匀抽样同因）；B.8 实测体育题反而最难（临近结算高噪声），别想当然。

### ⑧ 发散联想（全部【未经验证猜想】）
1. 【未经验证猜想】**「Return 维度」迁移为「对抗基率臂增益」**：把买合约换成「按判词 vs 账本基率的偏差方向模拟下注」——直接量化「判词比基率多赚多少」，纯记账零真钱，L0 即可跑；这是「LLM 判词是否有叠加信息」的最直白判据（呼应 AIA simplex 集成）。
2. 【未验证猜想】**定理 B.4 的对称性检验**：若判词与基率的分歧分布对称（不系统性偏一边）+判词校准好 ⇒ 买哪边期望相同，优势全在分歧幅度——可预注册「判词−基率分歧分布」检验：分布偏斜=系统性偏差信号，对称但幅度大=真信息源。
3. 【未验证猜想】**CRRA γ=参谋卡风险档位**：γ=0 全押/γ=1 对数稳健/γ→∞ 按比例——参谋卡输出「γ 档位行动建议」而非单一答案（「思路非答案」铁律的量化形态）。
4. 【未验证猜想】**日期对不齐失败模式 → 时间戳机器对齐**：LLM 事件回忆「近似不精确」（Billboard 例：歌对了日期错）——判词卡的时间/数字一律由账本层以固定格式注入，禁止 LLM 自算日期。
5. 【未验证猜想】**新闻臂=降方差层**：仅市场≈市场+新闻（均值差小方差差大）→ 管线分层：均值信号靠账本基率/冻结价，新闻只用于降方差；D.3 比特币案例提示「源间一致性」可机器度量（多源预测的标准差）作为新闻质量门——坏源集（预测机器人散布 $82k-121k）反而有害。

### ⑨ 存疑与可疑处（red-team）
1. **76% Sports 构成主导**：主表数字被体育题决定；B.8 重加权后 GPT-5 0.179→0.128、市场 0.188→0.149——绝对数字不可移植到其他域，LLM vs 市场的真实差距在非体育域可能更大（也可能更小），构成不透明是最大 caveat。
2. **Sharpe 全员为负的表述风险**：市场基线同样 −0.0897 ⇒ 亏损来自策略+费率+市场有效性联合，不是 LLM 特有；正文头条只说「GPT-5 fails to reach break-even」，引用必须带「连市场基线策略都亏」限定。
3. **统一 context 的单点 searcher**：全实验共享一个 GPT-4o 搜索员——检索质量是全局混杂因子（D.3 证明好坏源集效应巨大）；「模型间隔离」的代价是「检索归因不可分」，与 AIA 的结论域不重叠。
4. **机制实验 n=100**：知识回忆/四条件消融/judge 五维全在 100 事件子集（CI 宽），ceiling effect 方向可信、幅度粗。
5. **行内公式被剥**（trafilatura 同款事故）：变量名自上下文重建【已核·重建】；B.2 bins 数与部分 CI 边界缺失【待查原 PDF】。
6. **附录 E 缺失**：目录列 §E.1.1/E.1.2/E.3.x（searcher/预测/recall prompt 全文）但 HTML 正文未见 E 节——判词与搜索 prompt 全文不可得，仅结构描述【待验证：或未随 HTML 发布】。
7. **judge 校准表的编号混乱**：正文引用 Table 11 处与实际表号错位（小瑕疵）；C.4 一致性表大量并列 0.994 的区分度存疑（可能被 tolerance 参数饱和）。

---

*回合4完（2026-09-11）：Prophet Arena（2510.17638v2）全文精读毕（正文 §1-5 + 附录 A-D 全读；附录 E prompt 未随 HTML 提供，如实标注）。*

---

## 论文 5：Approaching Human-Level Forecasting with Language Models（arXiv:2402.18563v1）【回合5】

### ① 元数据
- arXiv id: 2402.18563，仅 v1，2024-02-28 提交【已核】
- 作者: Danny Halawi、Fred Zhang、Chen Yueh-Han、Jacob Steinhardt（UC Berkeley）；NSF/Simons/C3.ai 资助【已核】
- venue: arXiv 预印本（本文为「接近人类水平」首作）【已核】
- 谱系地位: **LLM forecasting 奠基文献**——AIA 的「非 agentic 检索管线」、ForecastBench 的 scratchpad prompt+Halawi 集预赛选模型、Lu 文的新闻管线全部源于此文；三篇后辈论文共同的母本【已核·三文互证】

### ② 全文获取路径
1. arxiv.org/abs/2402.18563 → 仅 v1【已核】
2. batch_extract.py 抓 arxiv.org/html/2402.18563v1 → cache/J5-Halawi-2402.18563v1.md（88,044 B / 924 行）；**J5- 前缀立即重命名**（回合4 覆盖事故的教训落实，本次零事故）【已核】
3. trafilatura 剥行内数字同款事故（baseline/主表/消融表全裸）→ alttext 版 _alttext-2402.18563.txt（129,432 B / 3,459 行）恢复全部关键数字【已核】
4. **双版本互补新实例**：附录 A.2/A.3 在 alttext 版正文为空、md 版完好——两版互备策略不可偏废【已核】
5. 全文可得 ✅（正文 §1-8 + 附录 A-F 全读；Figure 5/6/15 等 prompt 图以 alttext 抄录要点）

### ③ 核心贡献（3 句）
1. 首个接近人类 crowd 的 LLM 预测系统：三件套=检索（GPT-4 生成 6 条 query（双 prompt 并集+原题）→NewsCatcher+Google News（5 API 评测选出）→GPT-3.5 相关性过滤（只喂标题+前 250 词省成本）→GPT-3.5 摘要→按相关性排序取 top15）+ scratchpad 推理（复述扩题→正反论点→加权聚合→过自信自检+历史基率）+ trimmed mean 集成——测试集 0.179 vs crowd 0.149（baseline 最好 0.208，多数模型≤随机）。
2. **自监督微调新范式（本文最大创新）**：训练集跑 16 配置产出 73,632 条推理，只保留跑赢 crowd 的 13,253 条；防过自信双保险=丢弃偏离 crowd>0.15 的对 + **目标输出=自身预测与 crowd 预测的平均**；微调输入不含 scratchpad 指令（教模型「在给定上下文内化哪种推理」）。消融：FT 贡献 0.007、IR 贡献 0.027、prompt 本身贡献≈0.002（no FT no IR 0.206 ≈ baseline 0.208）。
3. 选择性预测（selective forecasting）开山：按三项自知情准则（crowd 在 0.3-0.7 不确定区/早期检索时点/≥5 篇相关文章）选择性出预报，全三条件 0.240 vs crowd 0.247 显著超越（>2 SE）——回答「LLM 该在什么时候开口」；4:1 crowd 加权组合 0.149→0.146 证明互补。

### ④ 公式清单
【已核·md+alttext 双版本互证】
P1 Brier: BS=(f−o)²，f∈[0,1] 概率预测，o∈{0,1} 结果；strictly proper（真概率 p 时最优报告 p）；无技能基线 0.25。
P2 几何检索调度（§3.2 Eq.1）: 每题的检索时点在 open 与 close 之间**几何递增**分布（理由：题目在 open 后最活跃+许多 close 日期保守地远晚于实际 resolve）；resolve 早于 close 的题剔除过期时点，平均保留 86% 检索日期。**关键防泄漏设计：绝对禁止以 resolve date 定检索时点**（resolve date 与结果相关，用它排时点=泄漏）——本文最被低估的方法论细节。
P3 自定义 Trimmed Mean（E.1）: 输入预测均匀赋权→将「离中位数最远」的预测权重减半→减掉的权重均匀重分配给其余→加权平均（非标准实现；验证集上 5 方法最优，USC 无增益）。
P4 RMS 校准误差（§3.2；正文报 ours .42 vs crowd .38【数字照录，RMS 定义细节见图 3】）。
P5 微调数据筛选规则（§5.1）: 保留条件 = Brier_ours < Brier_crowd ∧ |p_ours − p_crowd| ≤ 0.15；目标输出 p_target = (p_ours + p_crowd)/2。

### ⑤ 方法实现细节（能抄多细抄多细）
【已核·全文】
- **数据集（§3.1+附录 C）**: 5 平台（Metaculus/GJOpen/INFER/Polymarket/Manifold）2015-2024；多选题拆二值；过滤 ill-defined/低流量题；测试集=2023-06-01 后开题（晚于全部模型 2023-11 发布版 cutoff），train/val 在此之前 resolve，跨线题丢弃。
- **检索管线（§4.1+D.1）**: ①GPT-4-Preview-1106 生成 **6 条 query**（两 prompt 各生成：直接扩展式「brief search queries to gather information on Google」+ 子问题分解式「Start off by writing down sub-questions then steer queries」——后者覆盖竞选资金/经济指标/地缘等子考虑），temp=0，query 并集+原题；②5 家历史新闻 API 评测（需支持日期区间=防泄漏硬要求），NewsCatcher 35 分+Google News 39 分入选；③GPT-3.5-Turbo（temp=0）评相关性，**只喂标题+前 250 词**（省成本，E.3 验证高召回）；④GPT-3.5（temp=0.2）摘要；⑤top15 篇按**相关性**排序（非时间性）进推理。
- **推理（§4.2+D.2）**: scratchpad 四组件=复述并扩题→用检索+预训练知识出正反论点→按重要性加权聚合成初始预报→检查过/欠自信+考虑历史基率后修正。base=GPT-4-1106-Preview（候选中一致最低）；15 个 scratchpad 候选取 top3（0.167/0.170/0.174）。
- **微调（§5.1）**: 数据=每题 16 候选（2 种检索配置×(1 optimal+3 按验证集 Brier 反比采样 scratchpad)×2 模型 Claude-2.1+GPT-4-Preview）；73,632 条推理→13,253 条达标；**fine-tune GPT-4-0613（非 1106——OpenAI 不开放 1106 微调）2 epochs（预算约束）**；微调模型推理时 temp=0.5 采样 3 次、无需 scratchpad 指令。
- **集成（§4.3）**: 6 预测=3（base×top3 prompt）+3（fine-tuned×T0.5）；trimmed mean（自定义变体见 P3）。
- **超参扫描方法论（§5.2）**: 分组（1-2 个参数/组）序贯优化，验证集选优；未扫参数对每题随机化（避免混杂）；query 生成用代理指标（平均相关性 3.08/3.09 vs 其他 <3.04；高分文章均分 4.37/4.38）。
- **校准意外之喜（§6.1）**: 系统自然校准好（微调+集成副产物，无专门校准训练），分箱/等渗回归**不再提升**——与 Prophet Arena 的 LLM 过自信+AIA 的 Platt 必要性对比：蒸馏目标里 crowd 平均起了隐式校准作用【已核·推断】。
- **A.2 泄漏测试**: 手动查询 2023-06~09 重大事件（onthisday.com 来源）——GPT-4-1106/GPT-3.5-1106 要么称不知要么幻觉；对照组（cutoff 前 2022 世界杯）全对 ⇒ 无 post-training 泄漏证据。
- **A.3 crowd 聚合机制（五平台五种！）**: Metaculus=加权 median（最近预测权重 2^k 递增）；GJOpen=每 forecaster 最近 40% 预测的均值；INFER=加权均值（track record 加权，细节未公开）；Manifold/Polymarket=常数积做市商价格。另注意 Metaculus 另有「Metaculus prediction」专有算法，本文**未**采用。
- **未披露**: 检索成本、每题 API 调用数上限、摘要字数上限、scratchpad 候选 15 个的生成方式。

### ⑥ 实验数字表（alttext 版恢复【已核】）
表A baseline（§3.4）: GPT-4-1106-Preview **.208**（唯一大幅超随机）vs crowd **.149**；Claude-2 系次之；Llama/Mistral 系≈或劣于随机（.25）。
表B 主结果（§6.1）: **ours .179 vs crowd .149**（差 .03）；accuracy 71.5% vs 77.0%（差 5.5%）；对比 Autocast 时代（Zou 2022 acc 71% vs community；Yan 2024 提升）——本文题更难（crowd acc 更低）仍 acc 更高。
表C 选择性预测（§6.3 表3）:
| 准则 | Ours | Crowd | 覆盖(forecasts/questions) |
|---|---|---|---|
| 全部题 | .179 | .149 | 100%/100% |
| crowd∈[0.3,0.7] | **.238** | .240 | 51%/56% |
| 早期检索时点(1-3) | **.185** | .161 | 66%/100% |
| ≥5 篇相关文章 | **.175** | .143 | 84%/94% |
| 三条件同时 | **.240** | **.247** | 22%/43% |
→ 条件①②下仍输 crowd 但差距收窄；条件③下差距反转但仍输；三条件同时**唯一反超**（>2 SE）。
表D 组合互补（§6.4）: crowd:ours=4:1 加权平均 → .149→**.146**（全测试集）；强项条件下用不加权平均全面超 crowd。
表E 消融（§7）: Full .179 / 换 FT GPT-3.5（13,253 样本）≈微差 / no FT .186（+0.007）/ no FT no IR .206（+0.027，≈baseline .208）⇒ **增益分解：IR≈0.027，FT≈0.007，prompt≈0.002**。
表F 超参（E.1）: scratchpad top3 .167/.170/.174；15 篇+相关性排序 .177；摘要 prompt .193 vs .201；trimmed mean 最优（USC 无增益）。

### ⑦ 对本项目落地点
1. **自监督微调=账本进化路径（L1+ 期）**：「跑赢基率臂才教」蒸馏法可整体迁移——每 resolve 200 条（L0 门禁）后，把判词跑赢基率的局作为微调语料，目标=判词与基率平均（防过自信蒸馏）；两道保险（筛选+目标平均）都抄。本文教训：蒸馏后系统**自然校准好**、分箱/等渗不再提升——若走蒸馏路线，Platt/后校准可省。
2. **几何检索调度=验证点转化时点铁律**：多时点记账的时点选择**绝不依赖 resolve 信息**（resolve date 与结果相关=泄漏）——账本「验证点转 predictions」的转化时点必须只由挂卡/开题时间决定，与结算时间解耦（与 L0「只记不评」同源的防泄漏细节）。
3. **自定义 trimmed mean 直接抄进聚合器**：离中位最远权重减半再分配——比简单均值/中位更抗离群、比 extremize 温和，适合 3 路（扩展 6 路）判词聚合；本文 5 法对比（USC 无增益）省掉试错。
4. **选择性预测=参谋卡「开口规则」**：三准则（基率不确定区 0.3-0.7/早期时点/证据厚度≥5）+「三条件同时才反超」——参谋卡可输出「本次不判/低置信标记」；「思路非答案」铁律的时点版：系统自知何时无优势。
5. **4:1 基率:判词加权起步**：互补性实验最优权重——账本聚合器从 crowd:LLM=4:1 起步（L0 数据后用 simplex 回归调，衔接论文1 笔记 P7）。
6. **检索管线防泄漏硬要求**：新闻 API 必须支持日期区间参数（5 选 2 的第一准则）——本项目新闻臂选型同标准；相关性过滤只喂标题+前 250 词的成本技巧可抄。
7. **双温度采样分工**：base 模型多 prompt（3 个 scratchpad 变体）+ 微调模型单 prompt 低温重复（T0.5×3）——判词多样性的来源可以是「prompt 变体」而非「高温」，温度多样性（0.2/0.7/1.0）只是实现语义多样的一种手段。

### ⑧ 发散联想（全部【未经验证猜想】）
1. 【未经验证猜想】**迭代自蒸馏=账本季度进化**：结论节明示未做的「iterative self-supervision」（fine-tune→再生成→再筛→再 tune）——账本每 resolve 200 条做一轮，判断词逐步内化「什么局听基率、什么局偏离」；上限与风险=蒸馏自嗨（跑赢基率的样本越来越同质），需保留 20% 不蒸馏的原始判词对照。
2. 【未验证猜想】**postdiction 题库生成**：结论节提出「新模型出题考旧模型」——可用后知模型把历史对局改写为「当时看不出答案的预测题」，快速扩充 L0 评测集，绕开真实时间等待；风险=出题偏斜（模型只会出它记得住的题）。
3. 【未验证猜想】**微调目标=向群体先验收缩**：目标与 crowd 平均本质是贝叶斯收缩——我们的版本可改为「与账本基率平均」（基率=固定历史先验，比同期 crowd 更稳定）；两种收缩目标可消融。
4. 【未验证猜想】**证据厚度门**：selective 准则③（≥5 相关文章）→ 账本记「判词引用的账本事件条数」，<N 条自动降权或标低置信——把「证据厚度」从检索域迁移到账本域。
5. 【未验证猜想】**hedge 根因三文互证但都未测 base model**：本文（safety training 假设）、Lu（Claude 叙事极端低自信）、AIA（Platt 修正 hedging）三篇独立指向同一现象，但无一测「无 RLHF 的 base model 预测」对照——若有 base 权重可一锤定音；工程不可行则此猜想停留在「三票一致但无直接证据」状态。

### ⑨ 存疑与可疑处（red-team）
1. **crowd 基线是五平台五种机制的混合体**（A.3）：加权 median/最近 40% 均值/神秘加权/做市商价——「crowd 0.149」非单一口径，跨平台异质性未分层；且直接取平台数（非自算）。
2. **正文时间笔误**：§3.1 一处写「June 1, 2024」而表 2 注与 §1 均为 June 1, 2023——2024 为笔误（v1 于 2024-02 提交时 2024-06 未到）【已核：两处并存】。
3. **无显著性检验**：作者自认 i.i.d. 假设不成立（时序数据 SE 低估）且主差 0.03 未给 p 值——0.179 vs 0.149 的「接近」缺正式检验；仅 selective 条件下有「>2 SE」提法。
4. **选择性准则的多重比较**：三准则从验证集强弱分析挑出（未预注册），测试集上唯一反超的一组恰是挑选过程的产物——有选择效应，外推需谨慎。
5. **微调的隐性循环风险**：筛选阈值（偏离≤0.15）在验证集上调——蒸馏数据有过拟合验证集的小通道；且「目标=crowd 平均」使微调模型半只脚站在 crowd 上（「接近人类」的成色部分来自目标里掺的 crowd——这与 selective 下才反超互相印证）。
6. **双版本互补缺陷再现**：md 版表格全裸、alttext 版 A.2/A.3 正文为空——双版本互备（回合3 沉淀）是必要条件而非可选项。
7. **检索 API 时代局限**：NewsCatcher/Google News（2024，35/39 分）已被 2025 agentic 搜索代际超越——本文检索管线绝对数字不可外推，但「API 必须支持日期区间」防泄漏准则永不过时。

---

*回合5完（2026-09-11）：Halawi et al.（2402.18563v1）全文精读毕（正文 §1-8 + 附录 A-F 全读，md+alttext 双版本互证）。*

---

## 论文 6：Wisdom of the Silicon Crowd（arXiv:2402.19379v6）【回合6】

### ① 元数据
- arXiv id: 2402.19379，v1 2024-02-29，本精读=最新 v6（共 6 版）【已核】
- 作者: Philipp Schoenegger、Indre Tuminauskaite、Peter S. Park、Philip E. Tetlock（LSE/Cambridge/FRI 系）【已核】
- venue: arXiv 预印本；**两研究全部预注册**（OSF sb6mw，exploratory 分析显式标注）【已核】
- 谱系地位: 首个「LLM 集成 vs 人类 tournament crowd」预注册直接对撞 + 首个「人类认知输出喂 LLM」更新行为实验；「wisdom of the silicon crowd」命名出处【已核】

### ② 全文获取路径
1. arxiv.org/abs/2402.19379 → v1-v6，抓 v6【已核】
2. batch_extract.py → cache/J6-Schoenegger-2402.19379v6.md（65,652 B / 495 行，J6- 前缀立即重命名零事故）【已核】
3. 本篇无行内公式剥离事故（数字全为正文文字表述）；**新坑：console 输出过长触发 spill**（§3 Results 段截断到 spill 文件）→ 分段补读解决【已核·踩坑记录】
4. 全文可得 ✅（正文 §1-4 + 附录题表全读）；表 2（每模型 Accuracy 列）数字缺失【已核·表身空壳，待查原 PDF】

### ③ 核心贡献（3 句）
1. Study 1：12 LLM 集成（web 接口查询，7 国模型 7B-1.6T 参数谱：GPT-4/Claude 2/Bard/Falcon-180B/Qwen-7B 等）31 题 1007 条预测 vs 925 人三个月 Metaculus tournament：LLM crowd 0.20 vs 人类 0.19（p=0.850 不可区分；等价检验 d=0.5 界内成立）——预注册证实「wisdom of the silicon crowd」。
2. **acquiescence bias 发现**：LLM 预测中位 60%、均值 57.35 显著高于 50%（t(1006)=86.20），而实际仅 14/31=45% 正向结算——模型系统性偏 Yes；median 聚合竟能中和该偏差（crowd 机制稳健性）。
3. Study 2：把人类中位喂给 GPT-4/Claude 2 → 0.17→0.14（+17%）/ 0.22→0.15（+28%）；区间收窄+更新幅度∝初始偏离（r=0.88/0.87）=合理贝叶斯行为；**但 exploratory 关键发现：LLM 自行更新（0.13/0.14）仍显著劣于「机器+人类直接平均」**——直接平均胜过让 LLM 自己消化参考点。

### ④ 公式清单
【已核·本文行为研究性质，公式少且以文字定义为主】
P1 Brier: mean squared difference（式在原文为图，文字定义完整；0.25=恒猜 50% 基线）。
P2 等价检验（TOST，exploratory）: Cohen's d=0.5 → Brier 等价界 ±0.081；双单侧 t 检验 lower t(60)=2.16 p=0.017 / upper t(60)=−1.78 p=0.040 均显著 ⇒ 「LLM crowd 与人类 crowd 等价」在 ±0.081 界内成立。
P3 Benjamini-Hochberg FDR 校正: p_adj(i) = p(i)·m/i（m=检验数）；Study 2 六检验校正后 [0.006×5, 0.003] 全 <0.05。
P4 ANOVA+Tukey HSD（H3 模型间比较）：F(12,354)=2.64, p=0.002。

### ⑤ 方法实现细节（能抄多细抄多细）
【已核·全文】
- **12 模型异构设计（§2.1 表1）**: GPT-4 / GPT-4(Bing 联网) / Claude 2 / GPT-3.5-Turbo-Instruct / Solar-0-70B(韩) / Llama-2-70B / PaLM 2(Chat-Bison@002) / Coral(Command, 加拿大) / Mistral-7B-Instruct(法) / Bard(PaLM 2) / Falcon-180B(阿联酋) / Qwen-7B-Chat(中国)——有意拉满训练数据/参数量（7B-1.6T）/微调谱系/公司国家多样性；部分联网部分不联网。
- **web 接口查询（非 API）**: 经 OpenAI/Anthropic/Cohere/Google 官方界面+Poe/Huggingface/Modelscope 第三方；保持查询方式恒定+默认参数（温度未知）；每题**48h 内 3 次独立查询**；只答 Yes/No 记 99%/1%（<1% 情形）；技术故障 24h 后重试；审查/内容限制拒答记缺失不重试。
- **长周期模型漂移应对（footnote 2，实时研究工程细节）**: GPT-4-Turbo 发布（11-06）→改查「Classic」；Claude 2.1 上线→不切换继续查 Claude 2；Bard 底层换 Gemini Pro（12-06）→停采该模型。
- **人类基准对齐**: 取平台公开的每题 median；LLM 预测当日末尾收集人类中位（首日开题的收集第二日末，保证人类参与量）——防止 LLM 能感知当前日期带来的异步偏差；**15/31 题在社区预测对人类公开前采集**（人类可见性异质性）。
- **Study 2 within-design**: GPT-4+Claude 2；每模型每题 3 次×（前测/后测）=6 预测；prompt1=十诫+更新文献长 prompt（区分怀疑程度/平衡过欠自信/拆解子问题）；prompt2=干预（告知人类 crowd 中位+要求必要时更新+说明理由）；**输出=概率区间（0-100 两位小数）非点估计**，中点为点估计、两端为上下界；干预用的人类中位收在社区预测公开后 48h（此时人类预测已被 crowd 更新过、更校准）。
- **缺失处理**: 1007 收集 / 109 缺失（9.8%）：Falcon-180B 与 PaLM 2 接口技术故障；Coral(Command) 与 Qwen-7B-Chat 审查拒答（选择性不答）；Bard 换芯停采。
- **预注册纪律**: OSF 预注册三假设×两研究；所有 exploratory 分析显式标注（含等价检验）；致谢披露等价检验曾有 coding error 被外部发现并修正。

### ⑥ 实验数字表（自原文抄录【已核】）
Study 1（31 题，14/31=45% 正向结算）:
- 采集 1007/1116 条（缺失 9.8%）；全体预测中位 60%、均值 57.35（SD 20.93）vs 50%：t(1006)=86.20, p<0.001 → **acquiescence bias（偏 Yes）**。
- H1: LLM crowd M=0.20 (SD 0.12) vs 0.25 基线：t(30)=−2.35, p=0.026（BH 校正后仍显著）——LLM 集成首次显著超无信息基线（GPT-4 单模型此前做不到）。
- H2: vs 人类 crowd M=0.19 (SD 0.19)：t(60)=0.19, p=0.850 → 不可区分；等价检验 ±0.081 界内成立（exploratory）。
- H3: ANOVA F(12,354)=2.64, p=0.002；Tukey HSD 多重比较后**仅 Coral(Command) 显著劣于** Claude 2/GPT-4/人类 crowd；联网（GPT-4 vs GPT-4+Bing）、接入点（Bard vs PaLM2）、微调变体均无显著效应。
- 12 模型中仅 3 个优于模型 median（符合 wisdom of crowds 标准图像）。
Study 2（GPT-4+Claude 2，186 前测+186 后测，零拒答）:
- H1 准确率: GPT-4 **0.17→0.14**（p=0.003，+17%）；Claude 2 **0.22→0.15**（p<0.001，+28%）——人类中位喂入显著提分。
- H2 区间: GPT-4 17.75→14.22（p<0.001）；Claude 2 11.67→8.28（p<0.001）——人值落在 LLM 区间内时显著收窄（合理不确定性更新）。
- H3 更新幅度: 初始偏离与调整量相关 r=0.88 / r=0.87（均 p<0.001）——更新与人形理论一致（Atanasov 2020）。
- BH 校正后六检验 p=[0.006×5, 0.003] 全显著。
- **exploratory 杀手锏**: 更新后预测（GPT-4 0.13 / Claude 2 0.14）**显著劣于「机器前测+人类中位」的直接平均**——LLM 的贝叶斯式自行更新方向对但幅度不及机械平均。

### ⑦ 对本项目落地点
1. **【本篇最大交付】直接平均 > LLM 自行更新**：Study 2 exploratory 证明「把参考点喂给 LLM 让它自己调」劣于「机械 (LLM+参考)/2」——对本项目的直接指令：**基率进判词 prompt 有诱发「自行更新劣化」的风险**（Lu 文证明基率入 prompt +11.2% 是无 supervisor 场景；两文合读的正确形态=判词与基率在机械聚合层混合，或 prompt 内基率仅作背景不作锚点）——W2 需新增消融臂：「基率入 prompt」vs「基率仅聚合层混合」。
2. **median 聚合的又一票**：acquiescence bias（LLM 系统性偏 Yes，均值 57.35%）被 median 聚合中和——3 路判词聚合用 median 的第三个论据（AIA 表9 / Halawi trimmed mean / 本文 acquiescence 中和）。
3. **异构集成的多样性红利**：12 异构模型≈925 人类 crowd——3 路 prompt 变体之外，跨模型集成是增益方向（同构 vs 异构可作消融维度）；本文 H3 顺带证明联网/接入点/微调变体对预测准确率无显著效应。
4. **区间输出=第二信号源**：区间宽度本身是不确定性测量（Study 2 用区间收窄量化置信变化）——判词卡区间格式（Lu 式）的两端点应入库，供「区间宽度 vs 实际准确率」相关性分析。
5. **TOST 等价检验=验收工具箱**：L1 评测的预注册判据除「判词>基率的 p 值」外，应加「判词≈基率的等价界」（d=0.5 界）——直接回答「判词有没有用」而非「能不能拒绝无差别」；预注册+exploratory 分标注的纪律照抄。
6. **系统性偏 Yes 的检测器**：账本可设「全体判词均值 vs 50%」的周检（本文 t(1006)=86.20 的套路）——偏移显著即触发聚合器换 median/加反向校准（BI-direction）。

### ⑧ 发散联想（全部【未经验证猜想】）
1. 【未验证猜想】**「直接平均>LLM 自行更新」与「基率入 prompt +11.2%」的表面矛盾可统一**：Lu 的+11.2% 是「无更新指令的背景信息」，Schoenegger 的劣化是「明确更新指令下的锚定不足」——猜想：基率入 prompt 的效应取决于指令措辞（背景化=正，更新指令=负），可做 2×2 消融（基率有无×更新指令有无）。
2. 【未验证猜想】**acquiescence bias 的根源可能是 RLHF 讨好**：与 hedge（向 0.5 缩，AIA/PA）方向相反的偏差并存——两偏差可能随 prompt 格式切换（区间格式 vs 点估计 vs yes/no）；「格式×偏差方向」映射若成立，判词格式选择即偏差控制手段。
3. 【未验证猜想】**异构度可量化为集成增益预测子**：12 模型相关性矩阵（预测间相关）越低 error-cancellation 越强（Budescu 2015）——账本多 provider 扩展时可先算小样本判词相关矩阵，预测扩容增益再决定投入。
4. 【未验证猜想】**「15/31 题人类不可见 crowd」的分层启示**：人类在可见 crowd 的题上更强——我们的判词全部可见历史基率（=人类的「后 50%」状态），基线比较时应对「判词在基率可见局」的表现单独记账，避免与「无基率时代」文献数字直比。
5. 【未验证猜想】**「LLM 更新幅度∝偏离（r=0.88）」可当判词质量探针**：喂参考点后更新量与初始偏离的相关系数——若某判词路该相关异常低（不听证据或全盘投降），该路可能有系统性问题，可当 3 路健康检查指标。

### ⑨ 存疑与可疑处（red-team）
1. **n=31 题，统计功效低**：SD 0.12-0.19 下等价界 ±0.081 巨宽（相对 0.19 约 ±40%）——「rival human crowd」头条成立但精度粗；31 题也是 Lu 文批评过的噪声区间。
2. **web 接口不可控**：默认参数未知+三起模型静默升级应对（Turbo→Classic/Claude 2.1 不换/Bard 换芯停采）——采集窗口内模型非恒定，可复现性差；对比 Halawi/我们的 API+锁定版本做法。
3. **人类可见性异质**：13/31 题人类可见社区预测（群体信息加成）而 LLM 全程无——比较条件不完全对齐（论文自认 roughly half）。
4. **Study 2 参考点选择性偏优**：干预用的人类中位收在「公开后 48h」（已被 crowd 更新、更校准）——+17%/+28% 部分来自参考质量本身，非「人类认知输出」的普遍价值；推到我们的「喂账本基率」场景时增益预期应打折。
5. **表 2 每模型数字缺失**【待验证】：正文表格骨架在、数字列被剥（本篇唯一待查原 PDF 点）——「仅 Coral 显著差」之外的 12 模型排名无法核对。
6. **缺失非随机**：109 条缺失集中于审查拒答（Coral/Qwen，特定敏感题）——缺失与题内容相关时 median 聚合有偏（敏感题的 LLM crowd 中位基于更少样本）。
7. **等价检验曾有 coding error**：致谢披露该 exploratory 检验被外部发现编码错误后修正——结论可用但稳健性打折（好在预注册/标注纪律诚实）。

---

*回合6完（2026-09-11）：Schoenegger et al.（2402.19379v6）全文精读毕（全文 495 行一次读完+spill 补读 Results）。六篇收官。停等恢复令。*














