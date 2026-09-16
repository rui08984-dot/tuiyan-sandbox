# 收据 · 结果缓存预检 ＋ E1 主口径 v3（2026-09-17）

> 两件：①蓝图 §2.1#7「结果缓存预检」（P0 最后一件未做的判据件）；②E1 主口径第三次扩展（模板型通用适配器）
> 纪律：零 LLM、零写库、生产库零接触；测试 **426/426 绿**

## 一、结果缓存预检（蓝图 §2.1#7）

| 件 | 说明 |
|---|---|
| `p1b/src/lib/resultCache.js` | 缓存键**单一实现**：`norm(statement)+sha256(evidence_json)+prompt 版本+温度`（蓝图原文逐字）；语义缓存禁令（F3）由键结构天然满足（题面＋证据均入键） |
| `p1b/scripts/result-cache-precheck.cjs` | 预检：历史判词回放 → ①**跨题安全**（同键必须同题）②同题复现披露 ③变体/温度/模型分布 |
| `p1b/test/result-cache.test.cjs` | 3 例：键确定性/归一／键敏感性（evidence/版本/温度/题面）／预检实跑（跨题键=0＋零写库＋禁词 0） |
| `p1b/sim/out/result-cache-precheck-20260916.{json,md}` | 预检件 |

**实跑读数**（4766 行判词）：键 1350 个 ｜ **跨题键 = 0（安全判据通过）** ｜ 同题多输出键 1076（LLM 随机性 ⇒ 预期；**这正是缓存要冻结的对象**）｜ 模拟命中率 71.67%。
**判读**：键充分且跨题安全 ⇒ **缓存实现已解锁**（本体＝存/读/命中路径接入判词跑批，尚未实现——本件是它的上线前置判据）。
**修正记录（如实）**：预检首版把「同题多轮输出不同」误判为「键不足」——真因是**同一题被多轮/多模型判过**（run 级随机性），与跨题串结果是两回事；判据已拆为「安全（跨题）＋披露（同题复现）」两条。

## 二、E1 主口径 v3（模板型通用适配器）

| 件 | 说明 |
|---|---|
| `p1b/src/evidence/seriesKey.js`（扩展） | 通用回退：`url_template` 去占位符即系列身份（编码 provider/dataset/station/geo/symbol 等全部身份字段） |
| `dna-s-source-snapshot.cjs`（扩展） | **模板占位符替换**（`{date}`/`{date_nodash}`/`{..._ms}`/`{date_plusN}` 首个→窗起、其余→窗止）＋**12 个 host 解析器**（dbnomics／noaa_tide／usgs／socrata／csv_gml／ncei／binance／kraken／energycharts／mlb／swpc／eurostat） |
| 快照 | **181 系列 / 156,985 期值**（v2＝125/47k），30 族 |
| 主口径覆盖 | **源快照重建 1054 行**（v2＝828，v1＝587）｜回退账本档 **360**（v2＝586）｜不可判 **239**（v2＝401） |
| 副本演练 v3 | 1792 行写入（1054/360/378）；**零翻转**（report/by_domain identical）；生产库 sha `5ab9322f…` 未变 |

**明确跳过（有据）**：delphi（MMWR 周换算需专门核对，宁可不错）/ jpl（模板无占位符）/ bom（HTML 页）/ crossref·nvd·elexon·openalex（窗口 n<20 ⇒ 按冻结规则永远不可判）。
**失败 18 例（如实登记）**：binance 1＋kraken 3（墙外源，需项目既有 CONNECT 隧道）｜eurostat_live 6（模板只带 `lastTimePeriod` 参数，需专门适配）｜energycharts 6（参数待核对）｜cta 1（403）｜openmeteo 1（瞬时）。

## 三、门与落点

- 测试 **426/426**（＋3 缓存测试）；脚本索引在役 **96**。
- 收据本件；留痕 §69；README §4.5；地图 §37；p19 锚。

（收据完 · 2026-09-17）
