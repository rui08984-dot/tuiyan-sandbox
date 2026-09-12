# PREREAD · 论文精读二期任务清单（长活爬虫棒 · 2026-09-12 建立）

> 来源：I-T1复测-2026.md §5.3「下一年度复测锚点」原文（深读件）＋任务书点名增补＋ INDEX §五 与 G-合并.md §9 书单合并去重。
> 铁律：每篇必爬**全文**（arxiv.org/abs/<id> 确认版本 → arxiv.org/html/<id>v<n> 优先 → ar5iv.labs.arxiv.org/html/<id> → batch_extract.py 兜底，用 C:\Windows\py.exe 调，勿用 WindowsApps python=9009 假成功坑；web_fetch 降为后备）。只看摘要=违规。
> 缓存：全文精读\二期\cache\，命名 NNN_作者-短名-idvN.md（沿用 INDEX 约定，二期内部 NNN 从 001 重新计数；缓存头记录获取通道与版本）。
> 笔记：全文精读\二期\二期笔记-<短名>.md，三层结构照 INDEX：【事实层】原文数字/公式逐字+行号锚 /【结论层】作者声称+三态（已核/转述/待验证）/【数学层】公式编号清单带变量与适用条件；重点=公式与实现细节；发散标【引申·未验证】与原文区分。零改动 J-/K-笔记与 INDEX。
> 微步节奏：1 篇=1 微步（爬全文→落缓存→精读笔记→更新 二期-PROGRESS.md→回报一行→停等恢复令）。

## A0 梯队 · 交叉点 2026-07/08 竞品三篇（队长插队令 2026-09-12，title 级已核 HTTP 200；**最优先**）

> 定位：本项目「LLM 隐信息博弈+显式概率结算」交叉点的直接竞品/related work。精读统一四问：①测了什么（探针/审计口径）②没测什么（显式概率结算统计管线？预注册因果实验？安慰剂对照臂？Brier/ECE/Murphy 结算后校准？）③数据规模与游戏域 ④开源数据可否复用。每篇笔记加「与本项目的差异表」节，直接服务论文 related work 与差异化定位。

| # | 件 | arXiv id | 出处锚 | 精读重点 |
|---|---|---|---|---|
| A0-1 | MafiaScope: Non-Invasive, Time-Resolved Belief Probing for LLM Agents in Social Deduction Games | arXiv:2607.10645 | 队长令（title 级已核） | 无侵入信念探针=时间分辨探针口径 vs 我们的显式报价；狼人杀域 |
| A0-2 | Auditing Belief-Conditioned LLM Agents in Hidden-Information Social Deduction Games | arXiv:2607.10814 | 队长令（title 级已核） | 审计口径=belief-conditioned 行为审计；隐信息域边界 |
| A0-3 | Confident at the moment of action: belief miscalibration in LLM play under hidden information | arXiv:2608.24691 | 队长令（title 级已核） | 行动时刻信念误校准——与 K3/DINCO 校准线最贴；是否做结算后校准 |

## A 梯队 · I 棒 2027 锚点件（I §5.3.5 深读件＋任务书点名；A0 后顺次）

| # | 件 | arXiv id/版本 | 出处锚 | 备注 |
|---|---|---|---|---|
| 1 | BLF（Bayesian Linguistic Forecaster，当前 ForecastBench SOTA） | arXiv:2604.18576，I 文档实抓口径 v4（爬时 abs 页复核最新版） | I §5.3.5「BLF 全文公式与实现」＋§四.1【已核】 | 深读重点：语言信念状态迭代更新、K 试验 logit 空间平均+数据依赖先验收缩、层级 Platt 校准三组件的公式与消融（题目变异占性能方差 62%）；ABI 71.0 vs SF 中位 70.9 已核句 |
| 2 | ForecastBench-Sim（Freeciv rollout 模拟基准） | arXiv:2606.18686（版本爬时复核） | 任务书点名深读；I §三.1【已核】摘要级 | **任务书增补件**（I §5.3 未单列）；任意时距/反事实/稀有结局即时结算、含匿名人类 pilot、ICML 2026 workshop spotlight |
| 3 | 反向缩放《Is Capability a Liability?》 | arXiv:2605.22672，v2（I 文档口径，爬时复核） | 任务书点名；I §三.4【已核】摘要级 | 超线性增长+尾部风险域更强模型分布预测更差、失败集中上尾、单阈值记分测不出该效应、建议连续（无界）记分 |
| 4 | Cooke 2026《Wisdom/Madness of Crowds and Perils of Point Forecasts》 | **非 arXiv**（INFORMS Decision Analysis，出处/获取途径待查） | I §5.3.5 深读件＋§四.6【转述】 | 聚合方法选择是最重要因子、点预报危险；此前 PDF 未抓；属非 arXiv 纪律：找不到全文如实标「未获取」+二手汇编级笔记+降权 |
| 5 | König-Kersting et al. 2026（516 种聚合算法 many-designs 研究） | **非 arXiv**（Innsbruck WP 2026-05，出处待查） | I §5.3.5 深读件＋§四.6【转述】 | 「哪种聚合最优」跨题集本身不可预测；同上非 arXiv 纪律 |

## B 梯队 · 书单留档（INDEX §五 ∪ G-合并.md §9 合并去重；已读重复件剔除）

> 去重说明：G §9 的「Halawi 2402.18563」「Schoenegger 2402.19379」为一期已读件（J5/J6，缓存与笔记在盘）→ 剔除；G §9 的 Schoenegger 与 INDEX §五的「Schoenegger 2402.07862」非同一篇，保留 07862。
> 非 arXiv 老文献纪律（6/7/8 及 A 梯队 4/5）：尽力找合法公开版本；找不到全文如实标注「未获取」，只做二手汇编级笔记并降权标注。

| # | 件 | arXiv id/版本 | 出处 | 备注 |
|---|---|---|---|---|
| 6 | Genest-Zidek opinion pool 公理 | **非 arXiv** 经典综述（Statistical Science，卷期页码属 INDEX §四待验证项） | INDEX §五＋G §9 | opinion pool 公理基础；三层全部降权处理 |
| 7 | Satopää et al. IJF 2014（logit pool） | **非 arXiv**（IJF 30(2)；G 注「无 arXiv，逐式对齐待期刊途径」） | INDEX §五＋G §9 | 与已读 K5（arXiv:1501.06943 extremization）同源谱系但**不同件**，勿混；重心=logit 池化原式逐字对核 |
| 8 | Murphy 1973 原文（Brier 分解） | **非 arXiv**（J. Applied Meteorology 1973） | INDEX §五＋G §9 | K5 F56 已有转写式（BS=REL−RES+UNC），此件用于逐字对核 |
| 9 | Proper Scoring Rules Shape LLM Forecasting | arXiv:2608.28482（版本爬时经 abs 页确认） | INDEX §五＋G §9；标题已核=K-公式精读.md 回合进度总账书单行（队长令 2026-09-12） | 主题=proper scoring rules 对 LLM 预测的塑造；与 K6 记分纪律直接相关 |
| 10 | 待定名论文 | arXiv:1406.2148 | INDEX §五＋G §9 | 同上 |
| 11 | 待定名论文 | arXiv:1506.06405 | INDEX §五＋G §9 | 同上 |
| 12 | 待定名论文 | arXiv:2111.03153 | INDEX §五＋G §9 | 同上 |
| 13 | Schoenegger et al.（另一篇） | arXiv:2402.07862（版本爬时确认） | INDEX §五 | **≠已读 J6 2402.19379**；爬时确认全名（疑为 LLM 预测/人群主题，勿凭记忆断言） |
| 14 | Paleka 2025（**已锁定两候选**，微步B10-11 期间核） | ①arXiv:2506.00723《Pitfalls in evaluating language model forecasters》（2025a，Paleka/Goel/Geiping/Tramèr）②《Consistency Checks for Language Model Forecasters》ICLR 2025 **Oral**（2025b，Paleka/Sudhir/Alvarez/Bhat/Shen/Wang/Tramèr） | 仅 INDEX §五＋BLF/FBSim/Confident 三缓存参考文献交叉锁定 | 「foreknowledge」关键词与 2025b 的 arbitrage 一致性检测（测 forecaster 泄漏/foreknowledge）语义吻合；两篇都值得读，优先 00723 |
| 15 | Turtel 2025（**候选已锁定**，微步B6 发现） | 候选①=Turtel et al. 2026（future-as-label setup 前作，2608.28482 所引）②TMLR 11/2025（openreview bbhdeL8EUX，标题待核，OpenReview 反爬未验） | 仅 INDEX §五＋B6 作者团发现 | 一作 Ben Turtel（Lightning Rod Labs）同团；爬时先核 openreview 标题 |
| 16 | Yan 2024 | 出处只带年份无 id；同上 | 仅 INDEX §五 | 爬时搜定 |；**B10-11 搜定尝试未果（如实标注）**：多轮搜索未锁定「Yan 2024」唯一候选——2024 年 LLM+wisdom of crowds 域候选过多且书单无标题线索，恢复令点名时按 INDEX 原始上下文再查或向队长要补充线索
| 17 | Zou Autocast 2022（Autocast 数据集论文） | 候选 id arXiv:2206.15474【已核】(abs 页存在 v1/v2，2026-09-12 搜索确认) | 仅 INDEX §五 | 爬时 abs 页核实 id 后回填；Autocast=LLM 事件预测数据集；队长令 2026-09-12 确认此候选 id，核实义务不变 |；队长令+B9-14 搜索双确认

## C 附注 · 登记但不入必读（防清单膨胀，恢复令可增补）

- I §四其余【已核】方法件：CPTC（arXiv:2509.02844）/ RCCP（arXiv:2608.10553）/ DINCO（arXiv:2509.25532）——I 文档只抓过关键段未全文精读；如恢复令点名「方法件全文化」可插队到 A/B 之间。
- **ACI 变体扩展（队长令 2026-09-12 增补，出处=K-公式精读.md 回合2）【已核 API 元数据】：①arXiv:2510.15824《ACI through Blackwell Approachability》（2025-10）②arXiv:2412.19318《ACI by Betting》（2024-12）——均与已读 K2（2106.00170v3 ACI 主线）同谱系；全文未读，如恢复令点名可插队；元数据已核≠全文已读。**
- I §5.3 第 1-4 条为榜单/网页观察项（官网榜单 JS 渲染、Changelog、/explore/ 平价图），非论文件，爬虫棒不领——属 2027 复测棒职责。
- I §六待验证清单中与全文相关：FRI substack《Introducing the Brier Index》（fetch failed 史劣）——若爬到 BI 原文可顺带核 BI=100×(1−√mean BS) 公式出处，低优先。

## 进度挂点

- 本清单=二期微步 0 产出。执行顺序：A1→A5，再 B6→B17；每篇一微步，状态记 二期-PROGRESS.md。
- 唯一进度真源：全文精读\二期\二期-PROGRESS.md（已完成/进行中/缓存清单）。

（PREREAD 完 · A 梯队 5 件 + B 梯队 12 件 = 17 件 · 建立 2026-09-12）