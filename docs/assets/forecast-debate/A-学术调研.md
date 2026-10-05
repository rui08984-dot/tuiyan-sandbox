# A-学术调研（A 棒）· 预测科学三回合微步
> 执行者：A-学术调研（重派版）· 节奏：每回合 2 问（搜索→实抓→本文件追加→一行回报→停等队长恢复令）
> **【终态】三回合 6 问全部完成；文末含「终态整理」（①待验证汇总 ②给 D 的 5 方案引用索引）。A 棒停笔，待 D 裁决引用。**
> 证据三态：【已核】=本轮 URL 实抓原文；【转述】=搜索引擎引文口径/二手页未实抓正文；【待验证】=记忆直觉，不当证据用。
> 交叉引用：B-泼冷水.md（P1-P6 / T1-T4 / F1-F5）、C-创新.md；冲突标「冲突」。
> 工具边界实录（本棒实测，后续回合沿用）：web_fetch **不支持 application/pdf**（Mellers 2014 PDF 直抓失败）；en.wikipedia / en.m.wikipedia / wikiwand / grokipedia 直抓失败或空；pnas.org 403；metaculus.com / goodjudgment.com 403（已知陷阱）。实抓可靠域：arxiv.org、alphaxiv.org、aiimpacts.org、sciencedaily.com、plato.stanford.edu。

---

## 回合 1 · 问题 1：复杂系统/混沌——可预测性边界各杀什么、没杀什么

### 1.1 实抓证据
1. 【已核】**天气确定性预报极限 ≈ 2 周**（Zhang & Emanuel 等，Journal of the Atmospheric Sciences 2019；ScienceDaily 报道页实抓）：
   - Emanuel 原话："Edward Lorenz proved that one cannot predict the weather beyond some time horizon, even in principle"；"Our research shows that this weather predictability horizon is around two weeks, remarkably close to Lorenz's estimate."
   - 实验：近乎完美初始条件 + 两个真实天气事件（北欧寒潮、中国致洪降雨），模式合理准确预报到 ~2 周。
   - 现状与上限：中纬度日常可靠预报 9–10 天；技术进步未来数十年可再 +4–5 天（≈14 天贴顶）。
   - URL: https://www.sciencedaily.com/releases/2019/04/190415154722.htm
2. 【已核】**混沌的哲学边界**（Stanford Encyclopedia of Philosophy "Chaos" 条目实抓）：
   - 混沌系统="确定性的、非线性的、非周期的"（Lorenz 1963）；SDIC（初值敏感依赖）限制可预测性。
   - 关键区分：确定性=本体论属性，可预测性=认识论属性；Popper 曾以"不可预测⇒非决定论"论证，SEP 明确指出这是范畴混淆。
   - Batterman：不可预测性对混沌**既不必要也不充分**——不能拿"预测失败"反推"系统混沌"，也不能拿"系统混沌"当一切预测失败的万能解释。
   - URL: https://plato.stanford.edu/entries/chaos/
3. 【已核】**不可约（本体）随机性的物理锚点**（Hensen et al. 2015, "Experimental loophole-free violation of a Bell inequality using entangled electron spins separated by 1.3 km", Nature 526, 682；arXiv:1508.05949 摘要页实抓）：
   - event-ready 方案；245 次 trial，CHSH S=2.42±0.20（局域实在论上限 S≤2），p=0.039；结论"rules out large classes of local realist theories, and paves the way for … randomness certification"。
   - 含义：测量结局层面存在**原理上不可预报**的随机性（非工程缺陷）；这是设备无关量子随机数认证的物理基础。
   - URL: https://arxiv.org/abs/1508.05949
4. 【转述】Lorenz 1969 多尺度流：误差自小尺度上串（upscale）致可预报性有限（ECMWF elibrary PDF 搜索引文口径；PDF 未直抓）。Lorenz 1963《Deterministic Nonperiodic Flow》为 SDIC 原始文献（SEP 已核其引用，原文未抓）。
5. 【转述】自反性链条（搜索引文口径，正文未实抓；回合 3 问题 5 补实抓）：
   - Popper 1957《历史决定论的贫困》命名 **Oedipus Effect**=reflexive predictions 的效应（philarchive 存档 + Springer《Self-fulfilling Prophecy in Practical and Automated Prediction》J Bus Ethics 2022, doi:10.1007/s10677-022-10359-9 引文口径；该文专论自动化预测的自反问题）。
   - Merton 1948 自我实现预言：最初为假的信念改变行为致其成真（二手科普口径）。
   - Soros 反身性：市场情绪自我强化直至不可持续（Wikipedia "Reflexivity (social theory)" 引文口径）。
6. 【待验证】Goodhart 定律 Strathern 表述 "When a measure becomes a target, it ceases to be a good measure"——Wikipedia/Wikiwand 直抓两连败，原句出处未实抓（B 棒引用口径一致，无冲突）。

### 1.2 判定：三把刀各杀什么、没杀什么（A 棒独立结论）
| 边界 | 杀死 | 没杀死 | 依据 |
|---|---|---|---|
| Lyapunov/SDIC（认识论混沌） | 超视界确定性**点预报**（天气 ~2 周物理贴顶；9–10 天+技术 4–5 天）；个体轨迹精确时序 | 视界内短窗预报（9–10 天业务可靠）；分布/气候态预报；不变量与界；集合概率预报 | 已核 1、2 |
| 本体随机（量子层+系统噪声） | 单例结局的**点预言**（原理层面） | 概率预报（可校验可校准）；统计基率 | 已核 3 |
| 自反性 | **公开**人类系统的通用点预测（预测进因果环：自我实现/自我击败）；大尺度历史预言（Popper：知识增长本身不可预知） | 不公开的内部推断；无代理响应的系统；条件式 if-then 预报 | 转述 5（转述级，回合 3 补） |

### 1.3 与 B/C 交叉
- B P1a（λ、e^(λt)、两周贴顶）与实抓一致，无冲突；A 补数字：现状 9–10 天 + 技术上限 ≈14 天（ScienceDaily）。
- **A 对 B 的新约束**（SEP 实抓）：①混沌≠非决定论——"混沌刀"与"随机刀"必须分开举证；②不可预测≠混沌的判据（Batterman）——失败案例不能自动归因混沌。B 引文表需防"万能刀化"。
- 对 C：Bell 实锚（已核）表明本体随机层的点预言在任何算力下都死——C 的 L0-L5 阶梯若含"逼近单例零误差"台阶应在此设界。

---

## 回合 1 · 问题 2：预测实证传统（EPJ→GJP→Metaculus→ForecastBench）：人类/LLM 实测差距与可训练性

### 2.1 实抓证据
1. 【已核】**ForecastBench**（Karger, Bastani, Chen, Jacobs, Halawi, Zhang & Tetlock；arXiv:2409.19839；ICLR 2025〔任务给定口径〕）：
   - 设计（arXiv 摘要页实抓）：1,000 道动态题；提交时**无已知答案**（防数据泄漏）；200 题随机子集对照 expert forecasters / general public / LLM；公开榜单 forecastbench.org。
   - 摘要结论（实抓原文）："expert forecasters outperform the top-performing LLM ($p$-value <0.001)"。
   - 数字（alphaXiv 转载论文 v5 页实抓）：**superforecasters mean Brier 0.096；general public 0.121；最强 LLM（Claude 3.5 Sonnet+专用提示）0.122**；superforecasters 显著优于最佳 LLM（p<0.001）。
   - 附（实抓图注）：Chatbot Arena 分数与 Brier 正相关——通用能力与预测力相关但非同一物。
   - URL: https://arxiv.org/abs/2409.19839 ； https://www.alphaxiv.org/abs/2409.19839
2. 【已核】**GJP 关键数字**（AI Impacts《Evidence on good forecasting practices from the Good Judgment Project》实抓；转引 Superforecasting p72 与 Tetlock 访谈原话）：
   - 题目设计：合理答案限制在 10%–90%；计分=original Brier。
   - **superforecasters=每年前 2%**，次年组队进精英队。
   - **个体 SF 前两年胜对照组群体智慧 ~60%；GJP 官方聚合胜对照组 78%**（Superforecasting p72 转引）。
   - **GJP 胜 IC 内部预测市场 25–30%**——Tetlock 原话："outperformed a prediction market inside the intelligence community, which was populated with professional analysts who had classified information, by 25 or 30 percent"；该差距≈SF 胜 GJP 自己外部预测市场的差距。
   - GJP 官方预测=聚合+extremize；加权"elitist"（按过往成绩；Tetlock 口径=偏高 IQ/开放性）；extremize 幅度取决于预测者池多样性与水平（→回合 2 问题 3 展开）。
   - 训练：RCT 检验 1 小时训练模块（含概率思维内容）。
   - URL: https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project-an-accompanying-blog-post/
3. 【已核·二手访谈级】**EPJ 2005 媒体口径**：HuffPost（Tetlock 访谈）"testing 284 experts … 27,450 predictions … little better than 'a dart-throwing chimpanzee'"；Guardian 专栏同口径（黑猩猩掷镖）。注意："黑猩猩"是 Tetlock 自己的修辞；"狐狸>刺猬"本轮未实抓到原文口径。
4. 【转述】**Mellers et al. 2014 PNAS**（Psychological Strategies for Winning a Geopolitical Forecasting Tournament）：PDF 摘要句（搜索引文口径）"Training, teaming, and tracking … dramatically increased the accuracy of forecasts"；ResearchGate 摘要口径"probability training, team collaboration, and tracking improved both calibration and resolution"。—— web_fetch 不支持 PDF，改善幅度数字【待验证】。
5. 【转述】**Metaculus**（官网 403）：metaculus.com/faq 快照引文口径 "For questions that resolved in 2021, the Metaculus Prediction has a Brier score of 0.107"；Grokipedia 引文口径 "Community forecasts … superior calibration to baselines and, in select domains, to individual domain experts"。
6. 【待验证】媒体常引 "GJP 超情报分析师 24%（第 2 年）"——未找到可实抓口径；与已核"25–30% vs IC 内部预测市场"是**不同基线**，勿混用。

### 2.2 实测差距速览
| 对比 | 数字 | 状态 |
|---|---|---|
| ForecastBench：SF vs 最强 LLM | Brier 0.096 vs 0.122（LLM 相对差 27%） | 【已核】 |
| ForecastBench：最强 LLM vs general public | 0.122 vs 0.121 → 打平/略差 | 【已核】 |
| ForecastBench：SF vs general public | 0.096 vs 0.121（SF 相对好 ~21%） | 【已核】 |
| GJP：个体 SF vs 对照组群体 | ~+60% | 【已核】(转引 p72) |
| GJP：官方聚合 vs 对照组群体 | +78% | 【已核】(转引 p72) |
| GJP vs IC 内部预测市场（涉密分析师参与） | +25–30% | 【已核】(Tetlock 原话) |
| Metaculus 官方聚合 Brier（2021 年结算题） | 0.107 | 【转述】(FAQ 快照口径) |
| EPJ：284 专家 × 27,450 预测 | ≈ dart-throwing chimp | 【转述】(二手访谈) |

### 2.3 可训练性（A 棒小结）
- 选择效应：每年前 2% 选出 SF 并组队（已核）→ 预测力有稳定个体差异且可识别。
- 训练效应：1 小时模块 RCT 存在（已核）；Mellers 2014：训练/组队/追踪三因子改善校准与分辨（转述；幅度待验证）。
- 聚合效应：elitist 加权 + extremizing = GJP 官方配方（已核口径；适用条件→回合 2 问题 3）。
- LLM 侧：最强 LLM≈公众（0.122 vs 0.121），距 SF 相对差 27% 且 p<0.001（已核）；Arena 与 Brier 正相关（已核）→ 通用能力提升会部分外溢，但实测尚未穿越人类专家线。

### 2.4 与 B 交叉（冲突与精化）
- 「冲突-轻微」B 行 171/210 待办"LLM 优于普通公众"：v5 实抓口径 0.122 vs 0.121，**不显著优于**（打平、相对略差）→ 建议降级为"≈公众"。
- 精化 B 行 170"GJP 超情报分析师 30%+"：实抓基线=**IC 内部预测市场**（有涉密专业分析师参与）+25–30%，非"分析师个人中位数"；另两条更强数字可补 B：SF +60% / GJP +78%（vs 对照组群体）。
- 确认 B 行 47 p<0.001：A 独立实抓 arXiv 摘要 ✓，并补 0.096/0.121/0.122。
- 无其他冲突。

---

## 回合 1 待验证清单（下棒优先核）
1. Mellers 2014 训练/组队/追踪的具体改善幅度（PDF 不可抓 → 找 HTML/PMC 版）。
2. Metaculus 聚合优势的独立学术口径（0.107 仅 FAQ 快照口径）。
3. EPJ 预测总数两口径（HuffPost 27,450 vs 记忆 28,361）谁对；Goodhart-Strathern 原句。
4. Buizza & Leutbecher 2015 集合预报 3–4 周（B 引，A 未复核）；Laskar 1989 太阳系 ~5 Myr（B 引，A 未复核）。

---

## 回合 2 · 问题 3：组合预测与校准——聚合方法实证 + Brier 分解

### 3.1 聚合方法：配方与实证
1. 【已核】GJP 官方配方（AI Impacts 实抓，转引 goodjudgment.com/science 与 Tetlock Edge slides）：聚合 + extremize；加权="elitist"——track record 越好、更新越频繁权重越高（Tetlock 口径：偏高 IQ/开放性）；extremize 幅度取决于预测者池的多样性与水平。
2. 【已核】Tetlock（Edge Master Class II 实抓）："锦标赛四大表现驱动=选对人、互动（组队）、训练、'extremizing algorithm' 这套奇怪算法"；细节："给 track record 越来越好的预测者的近期预测更高权重，然后做从历史数据统计估计的 extremizing nudges。"
3. 【转述】extremization 文献链：Ranjan & Gneiting 2010；Satopää et al. 2014（IJF，logit 聚合，摘要口径：组合来自实质不同方法/信息源的预测以提升准确率）；Baron et al. 2014（Decision Analysis，"Two reasons to make aggregated probability forecasts more extreme"）。—— Semantic Scholar API 429 未抓成，extremize 的量化 ΔBrier【待验证】。
4. 【已核】GJP 训练课程正式教"averaging and crowd wisdom principles (Surowiecki 2005)"（aiimpacts 实抓）——聚合作为可训练技能被写入课程。

### 3.2 Brier 分解：校准 × 分辨
5. 【已核】Brier 基线与性质（ForecastBench 全文 §2 实抓）：**0.25 = 无信息预测（恒 0.5）**；Brier 严格 proper → 激励真实报告。
6. 【已核】Tetlock/Mellers 原话定义两成分（Edge 实抓）：校准="说 90% 的事约 90% 发生"；分辨（resolution/discrimination）="给发生的事比不发生的事显著更高概率的技能"；**"Superforecasters are better on both"；Mellers："They are much higher on the most important one, which is discrimination or resolution"** → 分辨是更重要成分。
7. 【已核】GJP 训练课含"calibration 与 resolution 的区别"专题（aiimpacts 实抓）。
8. 【已核】EPJ 时代事实（aiimpacts 转引 p77 实抓）：Tetlock 把 Brier 拆成 Discrimination × Calibration 两轴；**"Formal models"显著优于全部人类专家，简单个案趋势外推也胜过全部人类** → 机械基线（基率/外推）是强基线（B 的 F5 新弹药：连"完美的基率模型分辨为零"之上还有"机械模型整体胜人"）。
9. 【转述】正式分解式 BS = REL − RES + UNC（Murphy 1973《A New Vector Partition of the Probability Score》J. Appl. Meteor. 12:595；SciSpace 摘要口径已核论文与"vector partition"表述；公式本体教科书口径【待验证】）。

### 3.3 适用条件（A 棒归纳）
- 聚合收益依赖：个体信息相对独立 + 池子多样性（extremize 幅度依多样性而定【已核】）；有 track record 反馈闭环才可 elitist 加权【已核】。
- extremize 前提：聚合系统性过度保守；池子同质/高相关时 extremize 会放大共同偏差（Baron 摘要口径【转述】；反例实证未见【待验证】）。
- 校准可单独靠技巧达成（平衡题集恒 50% 即完美校准、零分辨）；分辨=预测力本体【已核 6】。→ 给 D 的接口：任何"校准好"话术必须配分辨证据才算数。

### 3.4 与 B/C 交叉
- B F5/P6 被 6/8 支撑且加强（分辨更重要 + EPJ formal models 胜全部人类）——无冲突，B 可直接引用 8 作新弹药。
- C 方案 3 的 ΔBrier≥0.02 外部锚点见 §4.3。

---

## 回合 2 · 问题 4：LLM 作为预测器实测（Metaculus bot 锦标赛 + ForecastBench 榜单）

### 4.1 前瞻（免泄漏）实测
1. 【已核】ForecastBench 全文（arXiv HTML v5 实抓）："SOTA 模型（Claude-3.5 Sonnet、GPT-4 Turbo）≈ 无/少经验人群调查的简单 median——即便加新闻检索、提示工程、（市场题上）人类 crowd 输入；并显著劣于 superforecasters 的 median。" 附录 E=LLM ensemble baseline（E.1 Models/E.2 Aggregation methods 结构【已核】；结果数字【待验证】）。
2. 【已核】FRI 榜单翻转（LW「AI Forecasting in 2026: What 11 Analyses Say」实抓，转引 FRI substack）：2024 年 median public forecaster 曾列 #2（仅次 SF）；**2025-10 已跌至 #22 → LLM 已超公众，但仍落后 SF Brier 0.02（GPT-4.5 0.101 vs SF 0.081，FRI 榜单口径）**。
3. 【已核】追赶速率：FRI 2025-10 测得前沿 LLM **0.016 难度调整 Brier/年**；线性外推 LLM–SF 平价 ≈ **2026-11（95%CI 2025-12~2028-01）**。⚠ 口径张力：LW1 帖自身外推 SF 平价=2028-12（Overall）/2034-05（Resolved）——两套外推并存，均【已核】其原文，不确定性留给 D。
4. 【已核】Metaculus AI 锦标赛 head-to-head（LW1 实抓，转引 Metaculus 官方 notebook；Peer score 对 median Pro Forecaster，0=持平）：**Q3 2024 −11.3 → Q4 2024 −8.6 → Q1 2025 −17.7（恶化）**；趋势=新模型>旧模型（Q2 2025 baseline bot 中 o3 领先）；平台盘口转引（"2026 前 AI 超社区"58%、"2030 前 AI 胜 Pro 团队"90%）——转引口径，勿直接当证据。
5. 【已核】Halawi et al. 2402.18563（abs + alphaXiv 实抓；作者 Halawi, Zhang, Chen, Steinhardt）：检索+推理+**集成聚合**三段系统；cutoff 后测试集 **系统 Brier 0.179 vs human crowd 0.149**；摘要口径 "nears the crowd aggregate... in some settings surpasses it"；自认局限：未在所有条件稳定超人类、依赖新闻检索覆盖。
6. 【已核】Lu 2507.04562（abs 实抓；v1 2025-07-06 / v3 2025-08-04）：464 道 Metaculus 题；**"Frontier models achieve Brier scores that ostensibly surpass the human crowd but still significantly underperform a group of experts"**（B 棒行 172 登记项→已核升级）；正文数字 PDF 不可抓【待验证】。
7. 【已核】**AIA Forecaster（arXiv:2511.07678 abs 实抓，2025-11-10）**：三要素=agentic search（高质量新闻源）+ supervisor agent（调和同一事件的分歧预测）+ 统计校准（对抗 LLM 行为偏差）；**ForecastBench 上"performance equal to human superforecasters"，超此前 LLM 基线，自称 SOTA**；另设液态预测市场基准：**AIA 单体 < 市场共识，但 AIA+共识集成 > 共识单体（"demonstrating that our forecaster provides additive information"）**。LW2 评价：AIA report 是防泄漏严谨性做得最好的平价主张。
8. 【已核·元评审】LW2 立场（实抓）：所有"LLM 追平 SF"论文均靠回测（已解题）+信息泄漏，不采信；前瞻口径="**bot 好于公众、逊于最好预测者、与活跃预测者竞争性相当**"；FutureEval/ForecastBench 这类前瞻评测中无 bot 被严格证明=SF。

### 4.2 LLM 校准质量（独立佐证）
9. 【转述】KalshiBench（alphaXiv 相关论文摘要口径，未单独实抓）：5 前沿模型系统性过度自信（ECE 0.120–0.395；>90% 置信时平均错 27%）；仅 1 模型 Brier Skill Score 为正（0.057，勉强胜基率）——与"LLM 需后处理校准"同向。

### 4.3 ⭐ 聚合/多路增量外部锚点（队长点名，供 C 方案 3 ΔBrier≥0.02 判据）
- 【已核】**86% 的 Metaculus Fall 2025 锦标赛冠军 bot 对多个预测做 ensemble/聚合**（LW2 实抓 bot-advice 结论）；FutureEval 官方 baseline bot 每次提交聚合 5 个预测【已核】；"agentic/iterative search 胜 one-shot retrieval"【已核】。
- 【已核】**AIA + 市场共识集成 > 共识单体**（2511.07678 原文口径）——异质信息源集成有正增量的直接实测。
- 【已核】GJP 聚合胜对照群体 78%（个体 SF +60%）+ extremize 官方配方（回合 1 已核）。
- 【待验证】受控消融数字：FB 附录 E ensemble 结果、Halawi 单样本 vs 集成 ΔBrier、Lu 正文聚合对照（PDF 不可抓）。
- **合成口径（给 D）**：实战行为（86% 冠军集成）+ 论文实测（AIA 集成增量、GJP 聚合 78%）一致支持"多路异质集成有正增益"；但"最强单路 vs 多路聚合"的干净公开 ΔBrier 数值未实抓到。C 的 0.02 门槛恰等于：SF−最强 LLM 当前差距（0.02，FRI 口径）≈ 1.25 年前沿改进量（0.016/年）——偏严格但可辩护。

### 4.4 与 B 交叉
- B T1（LLM 连续≥2 周期 Brier 优于专家中位数→触发）：2025-10 口径 LLM 仍落后 SF 0.02、bot 落后 Pro（−17.7）→ **T1 未触发**；但 AIA（2025-11）已在 ForecastBench=SF 平价——T1 复测窗应把 AIA 类系统列入。
- B 行 15"专家仍显著压过最强 LLM（p<0.001）"：FB 论文口径成立【已核】；建议加时间戳注记"差距收窄中（0.02@2025-10，0.016/年）"。
- B 行 172"2507.04562 结果未核仅登记"→ 本轮已核摘要级。
- 无冲突。

---

## 回合 2 待验证清单
1. Satopää 2014 / Baron 2014 extremize 量化 ΔBrier（SS API 429，INFORMS 挡）。
2. FB 附录 E ensemble 结果；Halawi 集成消融；Lu 正文数字（PDF 不可抓，等 HTML/二手）。
3. Murphy 1973 分解式公式本体。
4. Metaculus FAQ 0.107（回合 1 转述）仍待独立口径。

---

## 回合 3 · 问题 5：自反性与效率边界——预测公开改变行为的失效/自我实现场景

### 5.1 实抓证据
1. 【已核】**Merton 1948 自我实现预言定义**（EBSCO Research Starters 页实抓）：Merton 1948 命名并定义——"a false definition of the situation evoking a new behavior which makes the originally false conception come true"（假定义→诱发新行为→假变真）。URL: https://www.ebsco.com/research-starters/social-sciences-and-humanities/self-fulfilling-prophecy
2. 【已核】**Popper 反大尺度预言**（SEP "Karl Popper" §9 实抓）：历史决定论源于"人类最古老的梦想——预言：我们能知道未来为我们准备了什么，并据以调整政策"（Popper 1963: 338 转引）；SEP 实抓其历史主义批判。→ B P2 的 Popper 1957 引文链升级为已核级支点；"Oedipus effect"术语本身仍为【转述】（philarchive/Springer 引文口径；Springer 直抓两败）。
3. 【转述】**McLean & Pontiff 2016**（J. Finance《Does Academic Research Destroy Stock Return Predictability?》；SSRN 摘要搜索引擎引文口径，SSRN 直抓失败）：97 个学术异象变量；样本外组合收益低 26%；**发表后低 58%**。→ 公开发表本身衰减可预测性：私有信号→论文→资本涌入→α 衰减——"效率边界"的定量形态。URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2156623 ；正文衰减分解（统计偏差 vs 套利资本）【待验证】。
4. 【已核】**游戏内自反实证形态**（arXiv:2404.01602《Helmsman of the Masses?》abs 实抓，v2 2024-08-29）：用狼人杀 Sheriff 角色把 LLM 放上"舆论领袖"位，测意见领袖可靠性与**对其他玩家决策的影响力**两指标。→ 预测/推荐进入群体即改变群体信念，自反性不止于市场。
5. 【转述/待验证】Soros 反身性（Wikipedia 引文口径）；Goodhart/Strathern 原句与 Lucas 1976 批判正文（Wikipedia 域直抓两败，无替代口径）。

### 5.2 A 棒归纳（标注=归纳）：杀什么、不杀什么
- **杀死**（三种失效形态）：
  1. 自我实现型：预测被信→行为促成→预测"准"但因果为假（Merton【已核】）；
  2. 自我击败型：预测公开→被预测者规避→预测失效（物理系统不会读预报，人类系统会）；
  3. Goodhart 型：预测/指标成为目标后被掏空——市场定量化身=发表后 58% 衰减【转述】。
- **不杀死**：不公开的推断（无响应通道）；不可行动的预测；把反馈环显式建模的二阶预测；无代理响应的物理系统。
- **对私有小场景（朋友局）三层含义（归纳）**：
  1. 通道层：参谋卡结论只进决策者屏幕、不进公共频道 → 全体玩家响应通道关闭，只剩"决策者自身意图"一条弱通道——自反性大幅弱化但不为零（决策者也是被预测系统的一部分）；
  2. 制度层：玄学判词恒挂「娱乐参考」=防自反的制度设计（阻止用户按判词行动）——与已拍板决策一致，A 补学理根据；
  3. 效率边界层：朋友局无套利者、错误共识可持续 → 私下推断保留价值；对照市场：衰减速度 ∝ 可见度×可操作性（58%=全公开+全可操作+有套利资本的上限场景）。
- 与 B 交叉：B 行 82 直觉"自反性对低关注长尾系统可能过强（待验证）"→ A 机制化：自反强度 ≈ f(响应通道数, 可操作性, 可见度)，支持 B 直觉方向。无冲突。

---

## 回合 3 · 问题 6：社交推理游戏隐藏信息推断的学术实证（belief tracking 上限与失败模式）

### 6.1 实抓证据
1. 【已核】**人类基线上限：Bond & DePaulo 2006**（PubMed 实抓，Psychological Review 113(4)，doi:10.1207/s15327957pspr1003_2）：206 份文档、24,483 名判断者 meta；**实时判谎平均 54%**（谎言仅 47% 抓对、真话 61% 抓对；mean d≈0.40）。→ 无辅助人类从言语/行为线索判隐藏状态 barely above chance，带"判真偏置"。URL: https://pubmed.ncbi.nlm.nih.gov/16859438/
2. 【已核】**LLM 社交推理基准：ParliamentBench**（arXiv:2607.28146 abs 实抓，2026-07-30）：Secret Hitler 开源基准；16 LLM × 1,600 局（AI 互战+对人+对照线上真实局）；**随机基线 33%、简单算法基线 45%**；最强四模型聚类（GPT-5.4/Kimi K2.5/Grok 4.1 Fast/DeepSeek 3.1 Terminus），**最弱模型低于随机**；**多数 LLM 全局维持欺骗人设失败（deception retention <50%）**；三指标含 Role Identification Accuracy（具体值在正文【待验证】）。
3. 【已核】**狼人杀角色估计实测：arXiv:2507.12732**（HTML 全文实抓）：Role Estimation Accuracy（Acc_ij）为显式指标；8 配置 × 30 局；**狼方角色估计准确率仅 ≈0.30**（"low role estimation accuracy (Est∼0.30 for Werewolves)"）；狼方最高胜率出现在用角色估计时（"accurately estimating roles such as seer directly contributes to the win rate"）；**村民方加入角色估计反而更差**（低准确率估计拖累表现，有模型不升反降）。
4. 【已核·定性】Werewolf Arena（arXiv:2407.13943 abs 实抓，2024-07-18）：LLM 社交推理评测框架（bidding 动态发言权+竞技场锦标赛，Gemini/GPT 参战）；摘要结论=各模型策略推理与沟通强弱分明，无数字。
5. 【转述】CICERO（FAIR，Science 2022, doi:10.1126/science.ade9097 摘要引文口径）：Diplomacy 自然语言全博弈 human-level，"performance well above the human average in an online league"；"top 10%"常见口径【待验证】（arXiv/ar5iv 两败）。注意：Diplomacy 无隐藏角色分配，与狼人杀不同构，只作信念建模上限参照。
6. 【转述】AIWolf 线：第 5 届国际 AIWolf 竞赛（INLG 2023）；RL 语言 agent 胜既有 LLM agent（arXiv:2310.18940 摘要口径）——竞赛制度化，但无可引的统一"推断准确率"数字。

### 6.2 ⭐ 给 C 方案 2（deepwolf 嫁接）的外部锚（队长点名，单独标出）
- 【已核】信号质量分层真实存在：随机 33% < 简单算法 45% < 最强 LLM（ParliamentBench）——机械信号可超随机，但 LLM 原生推断不稳定（最弱低于随机）。
- 【已核】**LLM 角色估计实测 ≈0.30（2507.12732）**——belief tracking 远未解决；且方向敏感：估计准→狼方胜率升；估计不准→村民方被拖累。→ C 方案 2 的"有界步长贝叶斯更新（上限防过冲）"与文献教训一致：低质量估计必须限权。
- 【已核】人类线索判谎上限 54%（Bond-DePaulo）——"从发言读身份"的期望增益区间天然窄；deepwolf 机械矛盾信号不走"读脸"路线，是绕开 54% 天花板的正确形态；项目负结果（梅花查狼 45.1% vs 基线 67.6%，项目内事实）恰证"无效信号源挂得越稳越好"。
- 【已核-自洽】C 方案 2 自带 calibrate 闭环（resolve 后真值）与 C 行 98"无真值调参=拟合噪声"自洽；文献侧未发现狼人杀 belief model 免真值调参的成功先例（A 棒未检索到反例，非穷尽证明）。
- 【待验证】ParliamentBench Role Identification Accuracy 具体值、Werewolf Arena 数字、AIWolf 历届准确率（PDF/正文不可抓）。

### 6.3 失败模式清单（给 D）
1. 人类：54% 天花板+判真偏置（真 61% vs 谎 47%）【已核】；
2. LLM：角色估计 ~0.30【已核】；欺骗人设 retention <50%【已核】；个体差异极大（最弱<随机）【已核】；
3. 结构：纯言语线索上限低【已核-由 1 佐证】；**估计质量低时"加入估计"比"不用"更差**【已核-2507.12732 村民方】；
4. 无真值闭环的 belief 调参=拟合噪声（C 已知；文献侧无反例发现【归纳】）。

---

## 终态整理（A 棒收尾）

### ① 三回合「待验证」汇总
**物理/哲学层（回合 1）**：Buizza & Leutbecher 2015 集合预报 3–4 周；Laskar 1989 太阳系 ~5 Myr（B 引，A 未复核）；Goodhart-Strathern 原句；Lucas 1976 批判正文；"Oedipus effect"原始出处句。
**预测实证层（回合 1+2）**：Mellers 2014 三因子具体 ΔBrier；EPJ 预测总数两口径（27,450 vs 28,361）；Metaculus 0.107（仅 FAQ 快照口径）；Satopää/Baron extremize 量化收益；FB 附录 E ensemble 结果；Halawi 集成消融；Lu 2507.04562 正文数字；Murphy 1973 REL−RES+UNC 公式本体。
**社交推理层（回合 3）**：ParliamentBench Role Identification Accuracy 具体值；Werewolf Arena 数字；AIWolf 历届准确率；McLean-Pontiff 正文衰减分解；CICERO "top 10%" 口径。

### ② 给 D 的引用索引（按 C-创新 5 方案）
- **方案 1（对局内短时窗事件预测）**：GJP 可测可训可聚合（聚合胜 78%/SF 个体 60%，Brier 计分）【已核】；Brier 0.25=无信息基线+严格 proper【已核】；短窗 vs 超视界（天气两周极限=9–10 天现状+4–5 天技术上限）【已核】；分辨>校准（Mellers："最重要成分"）【已核】→ 支撑"限定域窗的短窗校准"定位。
- **方案 2（deepwolf 嫁接）**：LLM 角色估计 ~0.30【已核】；信号分层 33%/45%【已核】；人类 54% 线索上限【已核】；retention<50%【已核】；有界更新+真值闭环=文献教训正确对齐（§6.2）→ 增益有界、形态正确、必须 resolve 闭环验证。
- **方案 3（多路判词聚合消融）**：86% 冠军 bot 集成【已核】；AIA+共识集成>共识单体（additive information）【已核】；GJP 聚合 78%+extremize 配方与适用条件【已核+转述】；0.02 门槛=SF−最强 LLM 当前差距≈1.25 年前沿改进量（0.016/年）【已核口径】→ 偏严格但可辩护；受控消融数字【待验证】。
- **方案 4（预测卡→训练器）**：1 小时训练 RCT 存在【已核】；Mellers 三因子定性【转述】；GJP 训练课清单（校准/分辨/基率/聚合）【已核】→ 路线成立；L5 的 ΔBrier≥0.05 与文献幅度对不上（文献幅度未核）→ 判据保留、标注证据缺口。
- **方案 5（跨局校准仪表盘/纯统计）**：Murphy 校准×分辨框架（Edge 原话口径）【已核】；EPJ formal models 胜全员=机械件价值【已核】；0.25 基线【已核】→ 纯统计对照组定位正确。
- **横切（全部方案）**：自反性防区（参谋卡私有+判词娱乐化+响应通道理论 §5.2）【已核+归纳】；L0–L5 判据体系与 GJP/FB 度量传统（Brier+resolve 闭环+难度调整）同构【已核口径】。

### ③ A 棒遗留
- 工具边界（见文件头）+ 抓取域表已沉淀跨会话记忆；回合 2 的「口径张力」（FRI 2026-11 vs LW1 2028-12/2034-05 两套外推）原样保留给 D，未做调和。
