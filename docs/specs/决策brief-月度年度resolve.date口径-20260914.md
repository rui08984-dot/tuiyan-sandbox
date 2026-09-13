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
