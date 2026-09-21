# 结算收据 · 09-21（四十一）批 · 到期题例行结算（★0 写入 · 环境限制如实报告）

> 批次：（四十一）批 ｜ 日期：2026-09-21 ｜ 通道：例行（无需拍板）
> 结论：**到期 30 条 ⇒ resolved 0 ／ pending 3 ／ fail 27**；**生产库零写入**（演练即 0 条 ⇒ 无需生产写入步骤）

## §1 到期面

| 项 | 值 |
|---|---|
| 未解总数 | 344 |
| 今日已到期 | **30** |
| 按 kind | oddsapi_h2h 10／dlt_draw_result 8／cta 3／binance 3／elexon 2／nvd 1／crossref 1／(无 kind) 2 |

## §2 safe-mutation 五步

| 步骤 | 执行 | 结果 |
|---|---|---|
| ① 写前指纹 | 六表 SQL 级 sha16（非文件 sha——WAL 盲见证） | predictions 1994/910d76cc、verdicts 5156/d18ba875、truth_vault 1992/059ee737；**已解 1650** |
| ② 两份快照 | VACUUM INTO ×2（baseline＋drill） | sha16 **60c96100ef4ad72a**（两份逐位相同） |
| ③ 副本演练 | `--db=.scratch/p36/drill-work.db`（★等号形式） | resolved=0／pending=3／fail=13；**实打网 14** |
| ④ 生产写入 | **未执行**（演练即 0 条 ⇒ 无写入内容） | — |
| ⑤ 零翻转 | 演练库 vs 快照三表比对 | predictions／verdicts／truth_vault **逐位相同** ✓ |

## §3 失败明细（★环境限制，非代码缺陷）

| kind | 条数 | 原因 | 性质 |
|---|---|---|---|
| `dlt_draw_result` | 8 | **HTTP 567** | 老问题（历史已知，非本次新增） |
| `cta_daily_total_rides` | 3 | **HTTP 403** | 本机 IP 被拦；★实测**加 UA 无效**（Mozilla/5.0 与 curl/8.0 均 403） |
| `elexon_fuelhh_daily_mean` | 2 | **HTTP 403** | 同上 |
| `binance_daily_close` | 3 | **pending（正常）** | UTC 日尚未收盘 ⇒ 预筛正确判 pending，**非失败** |
| 其余（oddsapi/nvd/crossref 等） | — | 未到期或已结 | — |

**代理排查记录**（如实）：演练首跑设 `HTTPS_PROXY=http://127.0.0.1:7897` ⇒ 全域 fetch-fail（代理未运行 ⇒ 走死代理）。
撤掉代理后重跑 ⇒ eurostat/frankfurter/dlt **直连 200**，仅 binance/cta/elexon 不通。
★结论：**本机直连可用，勿设代理**（与既有记忆「node fetch 不走系统代理但 curl 两条链路都通」一致）。

## §4 影响评估（★不影响任何门）

| 域 | 未解 | 最老到期 | 分域读数 | 是否影响放行门 |
|---|---|---|---|---|
| dlt | 38 | 09-14 | L5/dlt n=0 可出结论=false | **否** |
| cta | 3 | 09-14 | L2/cta n=4 可出结论=false | **否** |
| elexon | 4 | 09-20 | L2/elexon n=0 可出结论=false | **否** |

⇒ 三个被拦域**均远低于 n≥30 线**，且不参与第 4 期放行门（门已在（三十四）批达成）。

## §5 与既有批次的关系

- （三十一）批（09-21 早）到期 48 ⇒ resolved 1／pending 10／fail 13，已解 1630→1631
- （三十二）（三十三）批：frankfurter 缺陷修复＋补结 19 条 ⇒ 已解 1646→1650
- **本批**：到期 30 ⇒ resolved **0**（可结的已在上述批次结完；剩余全被环境拦）
- ⇒ **收敛判据**：到期面**不再自然收敛**（被拦域每日新增到期但永久不可结）——**这是已知边界**，处置须拍板（见 §6）

## §6 待拍板（新增 1 项）

**★被拦域（dlt 567／cta 403／elexon 403）的处置**：
- 现象：三域合计未解 45 条，**每日新增到期但永久不可结**（环境层拦截，代码无法解决）
- 影响：不触任何门；但**每日结算会持续报 fail**（噪声）
- 备选：**A**＝维持现状（每日 fail，如实记录）／**B**＝标记为「环境阻塞」单独归类（改结算统计口径，须版本递进）／**C**＝出题器暂停这三域（防继续堆积不可结题）
- **不擅自处置**（改口径/停出题均须拍板）

## §7 产物

- 指纹 `.scratch/p36/fingerprint-before.json`
- 快照 `.scratch/p36/snap-baseline.db`／`snap-drill.db`（sha16 60c96100ef4ad72a）
- 演练库 `.scratch/p36/drill-work.db`
- 日志 `p1b/sim/out/resolve-daemon.log`（本轮 round#1 行）

## §8 测试

**528/528 pass / 0 fail**（本批零代码改动 ⇒ 无新增测试；跑全量确认无回归）
