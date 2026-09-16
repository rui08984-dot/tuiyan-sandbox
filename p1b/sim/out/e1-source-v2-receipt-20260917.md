# E1 主口径 v2 收据 · 五族新源适配器（2026-09-17）

> 棒位：E1 主口径扩展（承 `e1-source-route-receipt-20260916.md`）；纪律：零 LLM、零写库、生产库零接触
> 目标：把「38 类不支持的源」中**最大且免 key 的五族**接进来，提升主口径人口

## 1. 新增件

| 文件 | 说明 |
|---|---|
| `p1b/src/evidence/seriesKey.js` | **系列键单一真源**（取数与标签共用）：openmeteo=kind\|lat\|lon；dbnomics=kind\|provider\|dataset\|series；frankfurter=kind\|base\|quote；wikimedia=kind\|article；npm=kind\|package；github=kind\|repo；其余回落 null |
| `p1b/scripts/dna-s-source-snapshot.cjs`（扩展） | 五族适配器（dbnomics v22 observations=1／frankfurter 区间汇率／wikimedia per-article daily／npm 7 日滚动窗／github stats weekly）；**全局限速 250ms＋退避重试 ×3**；`--only`／`--merge`（冷却后补拉，不清空已成功系列）；缺键字段的系列护栏 |
| `p1b/scripts/dna-s-backfill.cjs`（改） | 源查找改用 `seriesKeyOf`（单一真源，防两边键漂移） |
| `p1b/test/dna-s-source.test.cjs`（扩） | ＋②b 系列键六族断言；② 升级为 ≥100 系列＋必备五族＋期值 >3 万 |

## 2. 快照与覆盖（实测）

- **快照**：`dna-s-source-snapshots-20260916.json` —— **125 系列 / 47,088 期值**（v1＝74/24k）；（16 族：openmeteo 全家族＋dbnomics 20＋wikimedia 11＋frankufter 10＋npm 7＋github 3）。
- **主口径人口**：源快照重建 **828 行**（v1＝587）｜回退账本档 **586**（v1＝827）｜先验档 378。
- **标签分布**（source 路由）：平稳 498 ｜ 漂移 515 ｜ 不可判 **401**（v1＝502，新族带来了可计算窗口）。

## 3. 副本演练 v2（`.tmp/_e1src2.db`；生产库 sha `5ab9322f…` 未变）

- `--route source --confirm` 写 **1792 行**；窗口来源分布：源快照重建 828／回退档 586／先验档 378。
- **零翻转**：stage4 `report` 与 `by_domain` 改前/改后 **identical**；predictions/verdicts 零触碰。

## 4. 过程自查（如实）

1. **限流事故**：首轮 127 连发被上游**丢连接**（wikimedia 11 系列全 `fetch failed`，连单独重测也失败；openmeteo 2 系列同批受害）⇒ 处置＝加限速 250ms＋退避×3＋**`--only/--merge` 冷却补拉**；冷却 90s 后补拉 **19/19 成功**（实证「是限流不是代码」）。
2. **缺键护栏**：`frankfurter_rate_range||`（无 base/quote 的行）曾拼出畸形键 ⇒ 系列键分量有空值即降级为 unsupported（不计入失败）。
3. `--only/--merge` 是本次新增的可复用能力：**任何一族被限流都能冷却后单独补拉**，不必全量重跑。

## 5. 剩余（诚实边界）

- 仍未接入的 kind（binance 36／bis 28／wb_commodity 24／ghcn 26／elexon 21／crossref 8／cta 7／usgs 16／noaa 若干等）——其中多族**有免 key 通道但窗口语义需逐族核对**；本批只做「最大五族」。
- 判据仍未出：12 §3 双编码门（34 单元）待人工；生产写入待门过。

（E1 主口径 v2 收据完 · 2026-09-17）
