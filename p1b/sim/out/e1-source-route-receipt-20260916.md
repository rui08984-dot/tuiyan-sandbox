# E1 主口径收据（附录）· 源数据侧快照重建落地（2026-09-16 · P0++）

> 棒位：E1 §1「窗口来源主次」的**主口径**实施（补 `e1-receipt-20260916.md` §4「主口径未实现」的欠账）
> 纪律：零 LLM（纯 HTTP 取数＋规则计算）；生产库零接触（标签写入仅在副本演练）；快照落盘保复现

## 1. 新增件

| 文件 | 说明 |
|---|---|
| `p1b/scripts/dna-s-source-snapshot.cjs` | 源侧快照重建：按 kind×lat×lon 归集系列（74 个），一次拉取历史；**两类窗口语义**：季节性（同月历史日，前 10 年 ≈300 日）／尾随（cutoff 前最近 N 日，N≈420）；空气族小时→日均；快照含 source_url 与 fetched_at |
| `p1b/sim/out/dna-s-source-snapshots-20260916.json` | 快照本体：**74/74 系列成功、日值 24k+**、零 key |
| `p1b/scripts/dna-s-backfill.cjs`（改） | 新增 `--route source`（主口径）：读快照＋题面 `threshold/cmp`＋窗尾=题 cutoff ⇒ 两半 k1/n1/k2/n2 → Newcombe → 标签；无快照系列**回退** ledger 档并如实计数；导出纯函数 `labelFromSeries` 供测试 |
| `p1b/test/dna-s-source.test.cjs` | 3 例：纯函数四情形／快照结构（≥50 系列·日值·source_url）／dry-run 主口径命中＋生产库 sha 不变 |

## 2. 实测（生产库只读 dry-run）

- 覆盖统计：**源快照重建 587 行** ｜ 回退账本档 827 行（无快照 kind：dbnomics/eurostat/彩票/地震等 38 类）｜ 先验档 378 行。
- 标签分布（source 路由）：平稳 503 ｜ 漂移 409 ｜ 不可判 502 ｜ 先验:恒平稳 378 —— 与 ledger 档（548/190/676）显著不同，**符合预期**（主口径无 look-ahead、窗口=引擎同窗）。

## 3. 副本演练（`.tmp/_e1src.db`；生产库 sha `5ab9322f…` 未变）

- `--route source --confirm` 写入 **1792 行**；`dna_s_labels.basis_json.窗口来源` 分布：源快照重建 587／回退档 827／先验档 378。
- **零翻转**：stage4 分层读数改前/改后 `identical=true`；`by_domain` `identical=true`；predictions/verdicts 零触碰。

## 4. 过程自查（如实）

- 首跑 10 系列 HTTP 400：真因＝序列参考日取了 `matures_at`（**未来日**）⇒ `end_date` 越界。修复＝窗尾夹到「今天」；修后 74/74 全成功。
- 季节性窗首版漏「按月过滤」（拉成 9 年全日）⇒ 已修（只留 cutoff 所在月历史同日）。
- CJS 顶层 await 报错 ⇒ 包 async main（常规）。

## 5. 剩余（诚实边界）

- 回退档 827 行（非 openmeteo 族）仍走账本序列（含 look-ahead 风险）——**需为各源写取数适配器**（dbnomics/Eurostat/彩票/地震等 38 类）才能全量主口径；本轮只完成天气/空气族（规模最大、销量最高）。
- 判据仍未出：12 §3 双编码门（34 单元）待人工；生产写入仍待门过。

（E1 主口径附录完 · 2026-09-16）
