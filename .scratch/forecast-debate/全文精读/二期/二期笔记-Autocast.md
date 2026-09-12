# 二期笔记 · Autocast（Zou et al. 2022）· 微步B14

> 论文：Forecasting Future World Events with Neural Networks（Autocast 数据集论文，arXiv:2206.15474 **v2**；Andy Zou/Tristan Xiao/Ryan Jia… Owain Evans/Dan Hendrycks，UC Berkeley+Oxford，NeurIPS 2022 D&B）——**队长令+B14-15 搜索双确认 id**。
> 获取：pwsh 抓 HTML（245.9KB）→ txt 71,835 B/1,645 行。缓存=cache/_cache-Autocast-2206.15474.html/.txt（行号锚）。
> 说明：本篇为 LLM forecasting 领域奠基数据集论文；预算内做框架级精读（结果细节表未逐格抄，引用前回读）。

## 【事实层】（四问体例）

### ①测了什么
- **Autocast 数据集**：从三公共预测平台（**Metaculus/Good Judgment Open/Infer**）收集全部可获预测题；覆盖政治/经济/社会/科技等多样主题+变化时间视距；三答案类型=**T/F、数值、MCQ**（Table 1：Tesla 全自动驾驶 T/F、Putin 支持率数值、最高法院空缺席位 MCQ）。
- 每题含：题面+起止日期+答案（已结算）+**人群预测时间序列**（Fig.1）——人群逐日演化曲线是数据集独有资产。
- 附**按日期组织的大型新闻语料**（供检索/上下文，严格历史对齐）。
- 基线模型：FiD Temporal（GPT-2 逐日预测，Fig.4）+retrieval 增强变体；**时间切分 train/test**（随机切分泄漏未来，L320）。

### ②没测什么/局限
- 预算内未逐格核：GPT-3 vs crowd 的具体 Brier 差距表（附录 A）；label noise/结算口径细节。
- 时代局限（2022）：模型=GPT-2/3 级，无现代 RLHF 模型；此缺口正是后续 Halawi/FB 系列的出发点（B11 Pitfalls 亦以其为批判起点之一）。

### ③规模与域
- 三平台全量收集（题量数千级——精确总数在 §3.1 表，未逐格抄）；地域覆盖 500+ 城市/六大洲（Fig.3）；人群时间序列+新闻语料双资产。

### ④开源可复用
- 【已核】Autocast 数据集公开（autocast 题库+人群序列+新闻语料）——后续所有 LLM forecasting 基准（Halawi/FB）的数据谱系源头；本笔记四问中复用价值最高的一项=**人群预测时间序列**（可作我们判词路聚合的「人群演化」对照结构）。

## 【结论层】（三态）
- 【已核】2022 年结论「LLM accuracy 与 calibration 远低于强人类基线」（摘要）——2026 复测语境下该结论已被 AIA/BLF 反转（I 文档 AIA=专家平价、BLF ABI 71.0 贴 70.9）：**Autocast=「人类仍占优」时代的基线锚点**，引用其结论必须带时间戳。
- 【已核】三答案类型设计（T/F/数值/MCQ）+人群序列+新闻语料=后续基准（FB 双题源、FBSim 双题族）的设计母版。

## 与本项目的差异表
| 维度 | Autocast 2206.15474 | 本项目 |
|---|---|---|
| 题源 | 三平台收集（被动） | sim 自生成（主动）——**免疫 B11 题源偏斜的路线** |
| 人群序列 | 逐日 crowd 时间序列（独有资产） | 三路判词时间序列=同类资产，账本已记 |
| 计分 | Brier/MAPE（T/F+数值） | Brier/BI/CRPS |
| 可复用 | 人群演化曲线对照结构+时间切分纪律 | 直接借 |

## 发散思考（【引申·未验证】）
- 【引申】Autocast 人群时间序列→FBSim「多 seed 经验频率结算」→我们「多轨迹簇分布结算」：三者是「人群/世界/轨迹分布」同构的三次实现——我们结算应记**逐日判词分布演化**（不只终点值），这是 Autocast 式资产在 sim 域的等价物。
- 【引申】从 Autocast（2022 人类占优）→FB（2024 追近）→AIA/BLF（2025-26 平价）→本文集中 2026 反转/竞品：四年文献线本身就是 T1 判定的证据时间线——二期笔记群已覆盖全链。

## 存疑与待验证
1. 精确题量/分类分布/GPT-3 vs crowd Brier 表未逐格抄（预算内框架级）——引用数字前回读。
2. NeurIPS 2022 D&B 口径：abs 页 arXiv 版权行未标 venue（外部常识，引用时核官方页）。
3. v2 与 v1 差异未核。

（Autocast 笔记完 · 2026-09-12 · 微步B14 · 锚=cache/_cache-Autocast-2206.15474.txt 1645 行）