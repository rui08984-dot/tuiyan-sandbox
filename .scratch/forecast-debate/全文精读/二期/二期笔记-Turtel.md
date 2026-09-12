# 二期笔记 · Turtel 前作候选 · 微步B13（候选锁定级，未全文精读）

> 任务：核验书单 B15「Turtel 2025」身份。结果=**候选锁定但标题待核**（OpenReview 反爬+API 空返回，未获全文）。
> 候选①：**Turtel et al. 2026（future-as-label setup 论文）**——B6 精读时确认：2608.28482 全文两处引用「We follow the future-as-label setup of Turtel et al. (2026)」（temporal masking/leakage-prevention 程序的出处，L257, 446），同团队（Lightning Rod Labs: Turtel/Wilczewski/Skotheim）。**此为 B15 最强候选**：书单「Turtel 2025」与本文 2026 排版年份差异可解释（arXiv 首发 2025 底/期刊 2026）。
> 候选②：TMLR 11/2025 论文（openreview bbhdeL8EUX）——搜索命中「Published in TMLR (11/2025)」+forecasting 语境，但 OpenReview 网页（浏览器验证）与 API（空返回）均未取到标题，**是否 Turtel 作者待核**。
> 定位方法记录：B6 作者发现→web_search（Turtel+Lightning Rod+forecasting）→openreview bbhdeL8EUX 命中→核验失败路径（pdf 端点反爬/API 空）。

## 与 2608.28482 的对照（B6 已核内容汇总）
- future-as-label setup=预测者只见 cutoff t 前证据、结局作标签（temporal masking），训练在已结算事件上离线进行——**与我们 L0 门禁的时序切分完全同构**，且该程序被 Proper Scoring Rules 论文的五 reward 训练直接采用。
- Lightning Rod SDK 数据管线（8,041 例 politics/geopolitics/economics/business/science/sports）——B15 若为该前作，其贡献=问答构造+结算管线本身。

## 与本项目的差异表
| 维度 | Turtel 前作（候选①） | 本项目 |
|---|---|---|
| 贡献 | 新闻事件二值题构造+temporal masking+结算程序 | sim 局生成+判词+账本——同构方法学 |
| 可复用 | future-as-label 程序（已在 B6 记账） | 我们 L0 门禁设计的学术对应物 |

## 发散思考（【引申·未验证】）
- 【引申】B15 若=future-as-label 论文，则书单「Turtel 2025」的本质=我们 L0 门禁+题库构造路线的原始文献引用——与 B6 合并精读可省一轮；恢复令若确认，直接以 B6 笔记为准并补 Turtel et al. 2026 的独立爬取。

## 存疑与待验证
1. 候选①的 arXiv id 未定（Turtel et al. 2026 的 future-as-label 论文独立 id 待查——2608.28482 参考文献表有全名，未抄）。
2. 候选② TMLR bbhdeL8EUX 标题/作者未核（OpenReview 反爬）。
3. 两候选是否同一篇未排除。

（Turtel 笔记完 · 2026-09-12 · 微步B13 · 候选锁定级，未达全文精读标准，如实标注）