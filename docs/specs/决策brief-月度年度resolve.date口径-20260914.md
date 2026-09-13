# 决策 brief · 月度/年度题的 `resolve.date` 口径（2026-09-14 · 队长拟，待用户拍板）

> 触发：#11 棒如实上报——月度/年度序列题的 resolve **无 `date` 键**，被 `g2-report` 的 `no_resolve_date` 排除出 ① 池（`交叉对抗-合议纪要.md` §1.4 #12 的姊妹问题）。

## §1 量化影响（我实测，SQL 可复现）
- **427 行**被排除，**全部其余条件已合格**（hash 非空＋非 tautology）＝只差 date 即可入池
- 层分布：**L2 303**（dbnomics_series_value 123／dbnomics_bis_monthly_mean 28／eurostat_demo_pjan_annual 24／dbnomics_wb_commodity_annual 24／swpc 与 noaa_solar 月报 12／eurostat_live 系 9…）＋ **L5 108**（cwl_ssq 70／dlt_draw 38）＋ L3 16（npm_downloads_window 26／github_weekly 15／delphi 21／nvd 5／crossref 5／openalex 4／jpl 4／bom 4 等）
- 若全部纳入：**① 池 1058 → 最多 1485（+40.3%）**
- ⇒ **L2 系综主力域被结构性排除**——这层恰是"万物可预测"里最可算的主力，排除它等于门只对日频题开放

## §2 三个口径（附我的推荐）
**口径 A · 硬塞 date（不推荐）**：给月度/年度题补 `resolve.date`（＝发布日/到期日）
- 优点：零代码改动（写端补字段即可）
- 缺点：**语义混淆**——月度题的"到期"是发布日、不是事件日；`matures_at`/cutoff 判定（细则 B：cutoff=created_at < 事件日）会被发布日稀释，且与日频题的 horizon 计算不可比

**口径 B · 新增 `resolve.period` 键（推荐）**
- 月度题写 `period:'2026-10'`、年度写 `period:'2026'`；`g2-report` 识别 period 并换算到期日（月度＝次月发布日、年度＝次年发布日，换算表在 resolver 侧登记）；cutoff 判定＝`created_at < 周期结束`
- 优点：**保留"周期题"语义**（horizon/到期/cutoff 三者都可正确计算）；不与日频题混淆
- 缺点：改三处（resolver 生成侧＋写端＋g2-report）——但都是小改
- **必须走版本递进（R4.3）**：① 池口径变更 ⇒ design 追加 §4.2.4 ＋ 变更留痕 §15 ＋ 读数重跑披露

**口径 C · 维持现状**
- 代价：427 条（L2 主力＋L5 全部彩票）**永久排除**；① 池只代表日频题 ⇒ "万物门"名不副实

## §3 我的推荐
**口径 B**，分两步：
1. **先探测**（零写库）：抽 20 条无 date 行，看其 `resolve` 里**已有什么周期字段**（`period`/`month`/`year`/`issue`），确定换算表可行性
2. **再实现**（版本递进 R4.3）：resolver 写 period → g2-report 识别 → 读数重跑 → ① 1058→1485 的增量逐条披露

## §4 与专家会 #12 的关系
#12（池构成双修）说「① 池域限制 L2/L3 为设计决定」——口径 B 落地后，L2 主力**才真正在池里**，#12 的"域限制"才有意义（否则是把 L2 排除两次）。

## §5 探测结果（2026-09-14 · 已实测，推翻 §2-B 的一个前提——好消息）

**周期字段已经存在于各 kind 的 resolve 里**，口径 B 不需要"新增键"，而是需要**日期换算规则表**：

| kind（条数） | 已有字段 | 到期日换算规则 |
|---|---|---|
| `dbnomics_series_value`（123） | `period:"2026-09"` | 月度值发布日（次月初） |
| `dbnomics_bis_monthly_mean`（28）／失业月报（9+6） | `month:"2024-05"` | 同上 |
| `swpc/noaa_solar` 月报（12） | `month:"2026-10"` | 次月初 |
| `eurostat_*_annual`（24+24+3） | `year:"2027"` | 年度发布日（**滞后可达 1 年+，horizon 极长**） |
| `npm_downloads_window`（26） | `start`/`end` **日期已齐** | **直接取 end** |
| `github_weekly_commits`（15） | `week_start`/`week_end` | **直接取 week_end** |
| `delphi_fluview`（21） | `epiweek:"202639"` | MMWR 周末 |
| `cwl_ssq`（70）/`dlt_draw`（38） | `issue:"2026106"` | 期号→开奖日（固定开奖时刻表＋锚期反推） |

**实现形态更正**：不是"新增 period 键"，而是**给契约表（`g2-contract-frozen-r4.json`，59 kind）扩展 `date_derivation` 字段**（每 kind 一条换算规则），`g2-report` 读该表算到期日。契约表已有 sha 锚机制，扩展须重新冻结（契约表 sha 变更须在留痕注明原因）。

**cutoff 判定注意**：月度/年度题的 cutoff 仍＝`created_at`（细则 B 不变）——落库时刻必然早于发布日，恒真问题与日频题同构，无新增风险。

**结论**：口径 B 可行性**上调**；实现面＝契约表加 22 条换算规则＋`g2-report` 识别逻辑＋读数重跑披露（① 1058→1485）。**待用户点头后按 R4.3 版本递进实施**。
