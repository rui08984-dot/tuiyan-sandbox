# 论文档案索引（INDEX · 2026-09-11 · 精读线 11 篇）

> 三层分类法：【事实层】=自论文原文实抓的数字/表格/公式（可回缓存逐字核对，最硬）；【结论层】=作者声称与推断（采信度按三态：已核/转述/待验证，red-team 修正随注）；【数学层】=公式编号清单（K 线 F 系列 62 条，全部带节号/变量/适用条件）。
> 引用规则：对外引用任何数字必须回【事实层】核对+带题集/口径/日期三要素（J 笔记论文3⑦2 三文三口径对照表）。

## 一、J 线·预测系统谱系（6 篇 → J-预测系统精读.md 93,216B/578 行）

### J1 AIA Forecaster（arXiv:2511.07678v1，2025-11，Bridgewater）
- 笔记：L9-135（回合1）｜全文缓存：cache/_alttext 与 _raw 见 _cache-2511.07678-v1.*
- 【事实】FB-7-21 Brier 0.1076 vs SF 中位 0.1110（p=0.15）；MarketLiquid 单独 0.1258 vs 共识 0.1106、simplex 集成 0.106 胜共识；Halawi 式直读聚合 0.1168 反劣于均值 0.1140
- 【结论】LLM 系统达 SF 平价（作者自述首个规模化专家级）；三要素=agentic search+supervisor+统计校准
- 【数学】Platt=广义 log-odds extremization（附录 G.2 全推导，J 笔记④节）；a=√3 固定
- 【本项目】先机械平均再校准/supervisor 只出查询/Platt 双轨记账——G §1 已收

### J2 Lu, Evaluating LLMs on Real-World Forecasting（arXiv:2507.04562v3，2025-07，独立研究者）
- 笔记：L138-211（回合2）｜缓存：cache/001_Lu-2507.04562v3.md（60.8KB）
- 【事实】12 前沿模型×464 题（334 主+130 hold-out）；o3 直接 0.1352；AskNews 管线 30 篇/题；叙事 prompt o3 0.1985 劣化
- 【结论】前沿 LLM 超人类群众、弱于专家组——**口径警示：专家 0.0225=每题中位 vs o3 0.1352=均值集成不可直比，§5.3 自相矛盾**；引用须降权注记
- 【本项目】叙事 prompt 禁令进 W2 设计；政治>经济领域差

### J3 ForecastBench（arXiv:2409.19839v5，Karger et al.，FRI+Chicago Fed）
- 笔记：L214-300（回合3）｜缓存：cache/002_arxiv.org.md（126.6KB）+ cache/_alttext-2409.19839.txt（141KB，公式数字完整）+ cache/_raw-2409.19839.html（800KB）
- 【事实】SF 0.096/公众 0.121/最强 LLM(Claude-3.5 freeze+scratchpad) 0.122（p<0.001）；组合题 SF 0.076/公众 0.096/GPT-4o 0.130；freeze 增益 0.133→0.107；每晚 0:00 UTC 九源抓题 6,435+617 万组合池；temp=0 官方全基线默认
- 【结论】免泄漏是结构性设计（题集提前 10 天生成、LLM 提前 24h 才拿到）；「检索无用」是非 agentic 时代局限（AIA 已反转）
- 【本项目】freeze→账本基率先行进 prompt；组合题→共现统计；A0 臂（T=0）增补

### J4 Prophet Arena（arXiv:2510.17638v2，2025-10，UChicago 系）
- 笔记：L303-395（回合4）｜缓存：cache/003_ProphetArena-2510.17638v2.md（108.4KB）
- 【事实】Kalshi 1367 事件/72,136 市场；GPT-5(High) Brier 0.184 vs 市场 0.187；o3 ECE 0.030 全场第一；**Sharpe 全员为负（含市场基线 -0.0897）**；ceiling：source/evidence 全员近满分（差 0.12/0.00），差距在 reasoning synthesis（0.95）与 alignment（0.30）
- 【结论】三维评测（Brier+ECE+回报）互不可替代（B.3/B.4 反例）；「检索已到顶，高阶推理才是分水岭」
- 【本项目】resolve 后三列记账；Bi-direction 校准（P(Yes)/P(No) 归一，一行代码级）；self-consistency 同 prompt 投票禁令（Brier 劣化 45%）

### J5 Halawi, Approaching Human-Level Forecasting（arXiv:2402.18563v1，2024-02，UC Berkeley）
- 笔记：L399-483（回合5）｜缓存：cache/J5-Halawi-2402.18563v1.md（86KB）+ _alttext（126KB）+ _raw（542KB）
- 【事实】73,632 条推理→13,253 条跑赢 crowd 保留；主结果 0.179 vs crowd 0.149（baseline 最好 0.208）；增益分解 IR 0.027 > FT 0.007 > prompt 0.002
- 【结论】自监督微调范式（跑赢基率才教+目标=crowd 平均）；选择性预测开山（三准则+唯一反超 0.240 vs 0.247）；检索时点绝不依赖 resolve date（防泄漏铁律）
- 【本项目】L1+ 期蒸馏路线出处；参谋卡开口规则出处；4:1 crowd:LLM 聚合起步权重

### J6 Schoenegger, Wisdom of the Silicon Crowd（arXiv:2402.19379v6，2024-02，LSE/Cambridge/FRI，双研究预注册）
- 笔记：L487-563（回合6）｜缓存：cache/J6-Schoenegger-2402.19379v6.md（64.1KB）
- 【事实】12 LLM 集成 0.20 vs 925 人类 crowd 0.19（p=0.85，TOST ±0.081 等价）；LLM 均值 57.35% 偏 Yes（实际 45% 正向结算）；喂人类中位 GPT-4 0.17→0.14（+17%）/Claude 0.22→0.15（+28%）但更新后仍劣于机械平均
- 【结论】硅群体智慧预注册证实；acquiescence bias 用 median 中和；**直接平均 > LLM 自行更新**；跨模型异构集成≈人类 crowd
- 【本项目】C′ 消融臂（基率入 prompt vs 聚合层混合 2×2）+ TOST 等价检验进 L1 验收——G §2 已收

## 二、K 线·数学层（6 篇 → K-公式精读.md 70.9KB，F1-F62 公式全带节号/变量/适用条件）

### K1 conformal prediction 综述（arXiv:2107.07511v6，Angelopoulos & Bates）
- 笔记：L15-210（回合1）｜缓存：cache/K-2107.07511v6-batchextract.md（127KB）+ _cache-K-2107.07511.txt（165KB）+ .html（807KB）
- 【数学】F3 调整分位数 ⌈(n+1)(1−α)⌉/n｜F1 覆盖双边界｜F12 覆盖~Beta｜F13 样本量表 ±0.05 需 n≈102｜F18 漂移定理 4+n_eff=Σw/Σw²｜F22 经典 p 值 (#{sᵢ≥s_test}+1)/(n+1)（定理 D.1 秩论证转写，如实标注）
- 【本项目】L0 门禁数学腿；玄学臂 conformal 定量预言（随机分数→集恒大/SSC 无差别）

### K2 ACI 自适应 conformal（arXiv:2106.00170v3，Gibbs & Candès，NeurIPS 2021）
- 笔记：L211-323（回合2）｜缓存：cache/K2-2106.00170-batchextract.md（47.8KB）+ _cache-K-2106.00170.txt（83.5KB）
- ⚠️ id 勘误存证：任务书原给 2106.00144（实为电力 SCUC 论文），错抓缓存改名 cache/K2-WRONGID-2106.00144-实为电力SCUC论文.md + _WRONGID-2106.00144.* 保留
- 【数学】F24 主更新 α_{t+1}=α_t+γ(α−err_t)｜F27 分布无关保证｜F31 最优 γ=√(2·漂移)｜F32 ACI=pinball OGD｜F33 分数须归一化平稳
- 【本项目】账本时序外环（γ=0.005 起步）×滚动窗内环

### K3 校准经典（arXiv:1706.04599v2，Guo et al.）
- 笔记：L324-419（回合2续）｜缓存：cache/K2-1706.04599-batchextract.md（50.5KB）+ _cache-K-1706.04599.txt（62.9KB）
- 【数学】F35 ECE=Σ|Bm|/n·|acc−conf|（M=15 论文配置）｜F36 ECE=Riemann-Stieltjes 近似（bins 依据）｜F38 isotonic=histogram 严格推广但多类伤 acc｜F42 TS 不改 argmax｜F43 TS=熵最大化唯一解 T=1/λ（Lagrange 全推导）
- 【本项目】3 路判词校准主力=逐路 TS（200 条可试/≥500 定版）；isotonic 200 条不推荐

### K4 Multi-LLM ACI（arXiv:2602.01285，2026-02）
- 笔记：L420-510（回合3）｜缓存：cache/K3-2602.01285-batchextract.md（80.6KB）+ _cache-K-2602.01285.txt（126.5KB）
- 【数学】F46 文档级 conformity E_i｜F47 Thm3 保留率差≤C′·MSE^{β/(β+2)}｜F49 集成权重 w*=argmin 经验 FPR（TPR≥1−δ）——**3 路权重不用拍脑袋，账本 3 维单纯形网格**｜F50 MACI-DRE 密度比修正
- 【本项目】M=3 LLM 与 3 路判词同构；「单路 TS 降 MSE→集成→conformal」三段式各有定量钩子

### K5 extremization 理论（arXiv:1501.06943v1，Satopää et al.；v2 无 HTML，v1 官方 HTML 380KB 成功）
- 笔记：L511-606（回合3续）｜缓存：cache/K3-1501.06943-batchextract.md（59.2KB）+ _cache-K-1501.06943.txt（80.8KB）
- 【数学】F51 偏信息模型 Cov=|B∩B′|｜F52 α~Cauchy(x₀,γ) 且 x₀≥1⇒P(α>1)>1/2｜F54 闭式 x₀=N/(1+(N−1)λ)·√((1−δ)/(1−δ′))｜F55 非随机系数 γ=N/((N−1)λ+1)｜F56 Murphy Brier 三分解 BS=REL−RES+UNC 原文式
- 【本项目】λ̂=三路判词相关矩阵均值→γ̂=3/(1+2λ̂)——极端化强度账本估计；AIA √3=无 λ̂ 折中

### K6 Verified Uncertainty Calibration（arXiv:1909.10155，Kumar/Liang/Ma，ICML 2019）
- 笔记：L607-704（回合4 收官）｜缓存：cache/K4-1909.10155-batchextract.md（82.9KB）+ _cache-K-1909.10155.txt（123.3KB）
- 【数学】F58 分桶 ECE 恒低估真 CE（Example 3.2：binned=0 而真≥0.49）｜F60 debiased 减偏式 Ê²_db｜F61 样本复杂度 plugin n∝B/E² vs debiased n∝√B/E²（Thm 5.3/5.4，等频分箱前提）｜F59 scaling-binning O(B+1/ε²)
- 【本项目】**校准 API 解读纪律：分桶 ECE=下界不是合格证**；流水线定版 TS→等频分箱→debias；「200 条」第三数学腿

## 三、工具与脚本（可复用）
- _extract-html.cjs（HTML→txt，公式 alttext 保留 $...$）——J 线主力
- batch_extract.py（D:\agent1super\scripts\）——经 C:\Windows\py.exe 跑（WindowsApps python=9009 假成功坑）
- 全文获取顺序：arxiv.org/abs 确认版本 → arxiv.org/html/<id>v<n> → ar5iv → batch_extract 兜底；web_fetch 不支持 PDF 且 HTML 截断 ~100KB

## 四、待验证清单汇总（red-team 门下）
SIAM Review 卷期页码｜MAPIE exchangeability test 函数名｜Metaculus 聚合 Brier 具体数字｜GJP vs IC 内预测市场转述口径｜MACI 当天 updated 版差异｜Satopää IJF 2014 logit 原文逐式对齐｜FB 表2 列序（推断修正已核，引用前建议核原 PDF）

## 五、书单留档（YAGNI 未读）
Genest-Zidek opinion pool｜Satopää IJF 2014｜Murphy 1973｜2608.28482｜1406.2148/1506.06405/2111.03153｜Schoenegger 2402.07862｜Paleka foreknowledge 2025｜Turtel 2025｜Yan 2024｜Zou Autocast 2022

（INDEX 完 · 精读线 11 篇 · 缓存约 5.5MB 全部在 .scratch/forecast-debate/全文精读/）
