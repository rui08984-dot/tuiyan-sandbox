# Metaculus 对表方案（2026-09-14 · P4）

> 依据：专家研讨会交叉对抗合议纪要 §1.4 P4 行 / §3.1 借鉴 #5#6；主持人纪要 §3（P4 生存条件）与 §4（阶段 5 语料源预演）。
> 性质：**只读对表方案**。本方案不写 p1a.db、不改任何代码；对表产物只进报告。

## 一、目的与定性
- 目的：P4＝统一清单 **#13（④ 基率独立性）的大规模执行版**——把我方池内**同型题**的自算外生基率，
  与 Metaculus **社区聚合共识**做相关对表；兼作阶段 5 检索式预测的语料源预演。
- **定性（强制）**：对表对象是**另一群预测者的共识（预测）**，**不是真值**。
  **ρ≥0.5 的含义＝「我方自算基率与独立第三方共识无矛盾」，属烟雾探测器**（若写端灌值或算错，极难与外部共识保持 ρ≥0.5），
  **不构成基率正确性的证明**。
- **话术纪律（硬）**：任何引用**不得**写「与 Metaculus 一致＝正确 / 得到验证」；只可写「**社区共识参考**」，
  且对表结论恒挂「外部共识非真值」限定语。

## 二、前置条件（二选一，须拍板）
| 选项 | 内容 | 状态 |
|---|---|---|
| A 提供 token | Metaculus 免费注册后 API token；本方案按 §四~§六 执行 | **未提供** |
| B kill 备胎 | 不提供 token ⇒ 立即换 **PolyBench**（同判据重试一次；合议纪要 §1.4 行 153 记载 38,666 市场） | 备胎在档 |

**现状（2026-09-13 实测）**：免 key 通道**全封**（14 个 URL / 5 轮探测：所有 /api/* 端点 403 需鉴权；
/questions/ 与 /static/* 被 Cloudflare 人机挑战拦截）。详见 p1b/sim/out/metaculus-probe/PROBE-RECEIPT.md。
⇒ 按 §六 kill 条款第 1 条，**对表在本轮不可执行**；须先拍板 A 或 B。

## 三、同型题匹配规则（先冻结再匹配）
我方池内同型候选（L2/L3 数值锚）与 Metaculus 对应域：
| 类 | 我方 resolve kind（示例） | Metaculus 对应域 | 匹配键 |
|---|---|---|---|
| 气温阈值 | openmeteo_daily_max / ghcn_daily_tmax / openmeteo_wx_daily | 天气·气温 | 地点 + 日期 + 阈值方向 |
| 大气 CO2 | noaa_gml_co2_daily | 大气·气候 | 站点 + 月份 + 阈值 |
| 发布数值 | dbnomics_series_value / eurostat_* / dbnomics_bis_monthly_mean | 经济数据发布 | 序列 + 期次 + 阈值 |

**匹配规则（五条全中才算一对）**：①域同（天气/大气/经济）；②标的同（同一地点/序列）；
③方向同（我方 cmp '>=' ↔ 社区 P(≥阈值)，**不得反向**）；④时间窗对齐（见 §四）；⑤行域为 g2_regime='R4'。
不匹配即丢弃，**丢弃数（缺失率）必须披露**。

## 四、窗口口径对齐（先声明后执行）
按 p1b/sim/out/metaculus-probe/window-mapping.md：锚点**二选一并在全流程固定**——
- 主锚：**close_time**（社区共识最终态）；备锚：**open_time**。
- 做法：**同一锚点下重算我方基率再比**；两锚点结论若分裂 ⇒ 按 §六 kill 第 3 条（不得择优）。
- 不可映射项（语义错位/对象错位/题型错位/时间粒度/裁决时滞）逐条进披露节。

## 五、判据与统计方法
- 主统计量：**Spearman ρ**（我方外生基率 b 与社区概率 p 的秩相关）。
- 判据：**ρ ≥ 0.5** ⇒ 记为「**无独立反证**」（**不是**正确性证明）。
- 区间：**bootstrap CI**——对「题对」重采样 B=2000，报 95% CI；**CI 下界 ≥ 0.30** 才可对外写「无独立反证」，
  否则只报点估计并标注「不显著」。
- 必报：n（有效对数）、缺失率、ρ 的 p 值（仅参考）、两锚点各自读数。
- **禁止**：跨层比较（层间数字迁移禁令）；用 assigned_prob 代替外生基率；事后挑选锚点或子样本。

## 九、备选源：Manifold Markets（2026-09-13 实测定稿 · 单源聚焦版）

> 定性不变：**社区共识参考，非真值；对表一致 ≠ 正确**。§一~§五 的判据/kill 条款原样搬入 Manifold 语境；
> 收据与 3 条真实样例：p1b/sim/out/metaculus-probe/manifold/（RECEIPT.md）。

### 9.1 可达性与 API 形状（免 key 实测）
- 基址 https://api.manifold.markets：23 请求串行+1.3s 退避，全 200/400，**无 403 / 无 429 / 无 Cloudflare**。
- **关键词→已 resolve 唯一最短路径**：GET /v0/search-markets?term=<kw>&filter=resolved&limit=N（/v0/markets 无 filter/resolved 参数，均 400 Unrecognized key）。
- 单市场 GET /v0/market/[id]（resolution/resolutionTime/resolutionProbability）；概率历史 GET /v0/bets?contractId=[id]（probAfter 序列 → close 时刻社区概率）。
- /v0/markets sort 仅 created-time|updated-time|last-bet-time|last-comment-time；search 不收 sort=resolve-time ⇒ 近期裁决采样：limit≤100 拉回后客户端按 resolutionTime 排。
- resolution 谱：YES/NO/**MKT**（按市场概率裁决，可用但标注自我实现）/**CANCEL**（必剔）/答案 id（MC、DATE）。

### 9.2 窗口与判据（照用）
窗口：按 window-mapping.md §六——**主锚 closeTime**、备锚 createdTime；社区概率=closeTime 前最后一笔 bet 的 probAfter；cutoff 仅我方侧自持（Manifold 无可见性边界概念）。
判据：Spearman **ρ≥0.5＝「无独立反证」**；bootstrap B=2000、95% CI 下界 ≥0.30 才可对外写；n/缺失率/双锚读数必报；禁跨层比较、禁事后择优（§五全条照用）。

### 9.3 样本量（探针 → 正式）
探针 5–10（本棒已落 3 条样例）→ 正式 **N≥25 有效对**。搜索深度实测（filter=resolved，原始命中≠有效对）：
term=CPI 50 命中（44 BINARY）｜term=temperature 50 命中（30 BINARY+19 MC 需归约）｜term=Carbon Dioxide 全量仅 **11**（8 BINARY，含 NOAA 月度 ppm 系列）。
过 §三 五条匹配规则后预计折损，N≥25 以正式轮实测为准。

### 9.4 重叠域评估（诚实）与 kill 条款 2
| 我方池 | Manifold 对应 | 判定 |
|---|---|---|
| 气温阈值 openmeteo_daily_max | 气温市场存在但偏年均温/纪录型；单点日最高温阈值稀少 | 域同·标的异＝**弱重叠**（域级计入，披露标的差异） |
| 经济序列 dbnomics_series_value | CPI 阈值题丰富（YoY+期次+阈值，limit=50 满） | **强重叠** |
| CO2 浓度 noaa_gml_co2_daily | NOAA 月度 ppm 阈值题成系列（2024 年 2/3/5 月全 YES） | 同构强但**深度薄**（全 11 条） |

- Manifold 整体偏政治/加密/流行文化；天气单点阈值类确稀少——按**域级匹配**如实披露，不得放宽规则凑数。
- **kill 条款 2（照用）**：五条规则过滤后有效对 <25 ⇒ 本轮判「重叠不足，不可执行」如实报（CO2 深度薄已实测；气温域归约折损大时风险集中）。

### 9.5 结论（一句话）
**对表可执行**（Manifold 免 key 实证可达，窗口/判据/kill 照用）；**重叠＝CPI 域与 CO2 月度浓度域强同构、气温域弱重叠（域级）**；CO2 深度 11 条是短板 ⇒ 探针 5–10 → 正式 N≥25，不足即 kill-2。

<!--APPEND-->
