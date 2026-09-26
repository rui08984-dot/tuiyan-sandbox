# 结算收据 · 09-27 例行结算（★37 条补结 ＋ ★到期口径真缺陷修复）

> 批次：09-27 例行批 ｜ 本地日期 **2026-09-27**（Asia/Shanghai）｜ 通道：例行（无需拍板）
> 结论：到期 56 条 ⇒ resolved **37**／pending 12／fail 7；已解 **1661 → 1698**
> ★本批同时修掉一个**静默饿死 31 条题**的到期口径缺陷（详见 §2）。

## §0 命名口径说明（如实登记，不自行抹平）

本机真实时间为 **2026-09-27T00:46+08:00**（＝UTC 2026-09-26T16:46Z）。
读数件由脚本按 **UTC 日期**自动命名，故本批产物名含 **`20260926`**，而收据与看板按**本地日期 09-27** 记。
两者指同一次运行。★不为了「名字好看」去改脚本命名规则——那属另一件事，须版本递进。

## §1 到期面

| 项 | 值 |
|---|---|
| 未解总数 | 331 |
| 到期选中 | **56**（唯一真值请求 56，台账重复合并 0）|
| 判出 | **37** |
| pending | 12（预筛 0）|
| fail | 7（cta 3 ＋ elexon 4，均 HTTP 403 地域封禁，已裁环境事实）|
| 未到期跳过 | 251 |

## §2 ★到期口径真缺陷（`dueOf` 认不出字段 ⇒ 31 条题静默饿死）

### 2.1 病象

`corpus-resolve-daemon.cjs` 的 `dueOf()` 只认 `r.date` / `r.period` / `r.month` / `r.week_end`（github）/
`r.end`（npm）五个字段。而另外三个 kind 的证据里**各有真实日期字段**，只是名字对不上：

| kind | 证据里的字段 | resolver | 修前 |
|---|---|---|---|
| `oddsapi_h2h` | `resolve.commence_utc` | **有**（corpus-resolve.cjs:401）| undatable 20 |
| `crossref_week_total` | `resolve.week_start` | **有**（:254）| undatable 6 |
| `nvd_cve_week_count` | `resolve.week_start` | **有**（:262）| undatable 5 |

⇒ 三者一律落 `undatable` ⇒ **daemon 永不选中 ⇒ 明明有 resolver 也永不结算**，且**无任何告警**。

### 2.2 为何 09-22 没人发现（★本批最值得记的一条）

09-22 结算收据 §1「今日已到期 34 条 · 按 kind：**oddsapi_h2h 10**／…」——
那个到期面是用 **`matures_at <= 今天`** 统计的，**不是** daemon 真正的选取口径 `dueOf()`。
两个口径不一致 ⇒ 收据**看起来**这 10 条赔率题在正常到期面里，**实际上 daemon 一次都没选中过它们**。
（复现：按 `matures_at<=2026-09-22` 重算＝31 条，含 oddsapi 10；按 `dueOf` 算则它们全在 undatable。）

⇒ **教训**：到期面有两个口径时，报表必须标明用的是哪个，否则收据会为「没被处理的题」背书。

### 2.3 修法（口径不是自拟，是从 resolver 自身的门反推）

- crossref / nvd：两支 resolver 同款
  `const end = plusDays(r.week_start, 6); if (end >= shToday()) return pending`
  ⇒ 窗口末日＝`week_start+6`，数据自 **`week_start+7`** 起可取。
- oddsapi：真值端点 `/v4/sports/<lg>/scores/?daysFrom=3` 是 **3 日滚动窗** ⇒ **开赛日次日**起仍可取。

改动：`dueOf()` 增两行分支（`week_start+7d` / `commence_utc+1d`），另加 `--report-due-out=<path>`
（照 `odds-questions.cjs --report-dir` 先例：报告不许默认写仓库）与 `require.main === module` 守卫
（原 `main()` 无条件执行 ⇒ require 本件也会追加写 `resolve-daemon.log`，打红 `e2-combo-precheck.test.cjs:109`）。

**修后实测：`无法定到期 53 → 22`**（救回 31 条）。

### 2.4 仍属 undatable 的 22 条（**如实登记，不硬凑**）

| kind | 条 | 为何不修 |
|---|---|---|
| `eurostat_demo_pjan_annual` | 8 | 年频＋Eurostat 发布滞后；`matures_at` 指向 2028，**未到期**，不急 |
| `delphi_fluview_ili` / `_num_ili` | 9 | 需 **MMWR epiweek→日期**日历。铁律「禁凭记忆编日历」⇒ **不折算**，须先登记 CDC 公开日历页 |
| `eurostat_live_tertiary_attain` | 3 | 教育学历 lag 12 个月；`matures_at` 2027，**未到期** |
| `bom_weekend_top10_gross` | 2 | 需 BoxOfficeMojo 发布日历；同「禁凭记忆编日历」 |

⇒ 其中**已过期仅 1 条**（id=1465，delphi epiweek 202630），其余全在未到期区间。**不因「想让它跑」而破日历纪律。**

## §3 ★赔率线 10 条真值永久不可得（如实登记，不掩饰）

dueOf 修好后，那 10 场已开赛（09-18～09-20）的赔率题**第一次被 daemon 选中**，结果全部 pending：

```
pending kind=oddsapi_h2h due=2026-09-19 — scores 窗内（近 3 日）未见 82d8b6a0…
```

**根因**：`daysFrom` 是**滚动 3 日窗**，这批球已过 7–9 天 ⇒ 早滑出窗口。
实测 `daysFrom=5/7/10` 一律 **HTTP 422 INVALID_SCORES_DAYS_FROM**（免费层上限 3）。

⇒ **这 10 条永久不可结**（真值端已关闭）。账本不可变 ⇒ **零删除**，按「已知边界」登记，
与既有同类（cta/elexon 地域封禁永久不可结）同一处置。**另 10 条（10-10～10-12 开赛）仍可结**，
dueOf 修复正是为它们保驾。

## §4 safe-mutation 五步

| 步骤 | 执行 | 结果 |
|---|---|---|
| ① 写前指纹 | 六表 SQL 级 sha16 | predictions 1994／**63cbe3270428d3f7**；已解 **1661** |
| ② 两份快照 | `VACUUM INTO` ×2 | sha256 **b320fe5d…**（**逐位相同**）|
| ③ 副本演练 | `--db=.scratch/p38/drill.db`（★等号形式）| wouldWrite **37**（实打网 38）|
| ④ 生产写入 | daemon `--once --due-only --confirm` | resolved **37**（**与演练同数**）|
| ⑤ 零翻转 | 写后 vs 快照 | **仅 `predictions` 变**；其余五表**逐位不变**；行数 1994 不变；**恰 +37**；非法 outcome **0** |

★演练后复核生产库六表指纹**零变化**才进第④步。

## §5 补结明细（37 条）

| kind | 条 | kind | 条 |
|---|---|---|---|
| npm_downloads_window | 7 | crossref_week_total | **4**（★修复新放行）|
| binance_daily_close | 5 | nvd_cve_week_count | **3**（★修复新放行）|
| wikimedia_pageviews | 5 | github_weekly_commits | 3 |
| dlt_draw_result | 4 | frankfurter_rate_range | 3 |
| cwl_ssq_red/blue | 各 1 | mlb_schedule_daily_total_runs | 1 |

★**crossref 4 条 ＋ nvd 3 条共 7 条，是本批修复的直接兑现**——修前它们从未被结算过。

## §6 读数前进

| 层 | 前（09-22）| 后 | 变化 |
|---|---|---|---|
| L1 | 180 / 0.0000 | 180 / 0.0000 | — |
| **L2** | 407 / 0.2384 | **434 / 0.2403** | n +27，Brier +0.0019 |
| L3 | 620 / 0.2386 | 620 / 0.2386 | — |
| **L5** | 48 / 0.1517 | **54 / 0.1578** | n +6 |
| L6 | 270 / 0.1755 | 270 / 0.1755 | — |
| 分域 | 29 格 / 可出 **10** | 29 格 / 可出 **10** | 不变 |

★crossref 域 n 0→2、nvd 域 n 0→2，**但仍 < min_n=30 ⇒ 不出结论**（可计分 ≠ 可判读）。
「可出结论 10 格」不变是**如实结果**，不是没进展——两域从「根本取不到数」变成「有数但太薄」。

## §7 vault 同步

`vault-sync --confirm`：insert 0／update 37 ⇒ **ok=true**（1994==1994、missing/orphan/diff 全 0）。
写前自动快照 `.scratch/backup/p1a-pre-vaultsync-2026-09-26T16-55-11-539Z.db`（integrity=ok）。

## §8 测试门

- 新增 `p1b/test/corpus-resolve-dueof.test.cjs`（**5 例**）：三 kind 不再 undatable／due 逐值对齐 resolver 的门／
  来源标记可观测／**反过度放行**（MMWR epiweek 无日历 ⇒ 仍须 undatable）。
- 修 `p1b/test/odds-questions.test.cjs` 的**时间炸弹**：夹具把开赛日写死 `2026-09-25`，
  而 Q0-2② 用**真实 now** 判定 ⇒ 该日一过测试永久转红（09-27 实测复现：候选 0／past_kickoff=1）。
  改为**相对 now 构造**（now+7d），规则意图一字未改。
- **全量 543 → 548／548 绿**。

## §9 落点

- 读数件 `p1b/sim/out/stage4-run-five-layers-20260926.{json,out}`｜`calibration-report-20260926.{json,md}`
- 改 `p1b/scripts/corpus-resolve-daemon.cjs`（dueOf ＋2 分支／`--report-due-out`／CLI 守卫／导出纯函数）
- 新测试 `p1b/test/corpus-resolve-dueof.test.cjs`｜改 `p1b/test/odds-questions.test.cjs`
- 工作留痕 `.scratch/p38/`（指纹 ×3 ＋ 两份快照 ＋ 演练库）
