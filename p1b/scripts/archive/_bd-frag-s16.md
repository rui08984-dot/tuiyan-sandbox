## §16 追加 · 2026-09-14：R4.2 → R4.3 版本递进（① 池入池判定扩展——date_derivation 周期题换算；口径 B 四微步收口）

> 留痕规则照旧：原条款不删；本节为追加修订节。**① 阈值与 ②③④ 判据本体一字未改**——改的是 ① 的入池判定实现口径（新增换算路径）与 backfill 排除标签名。

| 项 | 内容 |
|---|---|
| 触发 | 427 行周期题因 resolve 无 date 被 no_resolve_date 排除出 ①（L2 主力域结构性排除）；决策brief-月度年度resolve.date口径-20260914.md §5，用户批口径 B |
| 变更·判据 | design 新增 **§4.2.4 修订 R4.3**：入池＝resolve.date 或契约表 date_derivations[kind] 换算 effective_date（到期＝数据发布日，保守近似）；换算失败计数披露不静默丢；backfill（statement 标记＝PREREG 锚）172 行维持排除（标签改名 backfill_no_forwardLooking） |
| 变更·件 | 微步1 契约表 date_derivations（sha bafd3d38…→**007b41188807…**）｜微步2 g2-report.cjs +66 行 additive 接线｜微步3 254 行前瞻 matures_at 补列（1058→1312 non-null，快照 5a72ef3f…）｜微步4 design §4.2.4＋本节＋README §4.5 |
| 读数前后 | ① 1058→**1312**（+254 前瞻；−1 cutoff）｜③ 短 419→439／中 77→147／**长 33→197**｜④ 928→**1120**（覆盖 1312/1312）｜② 质量读数不变（report_only）｜换算 failed=0｜测试 226/226 |
| 门判定 | 五门全 PASS（gated 复跑；收据 p1b/sim/out/g2-report-r4-dd-gated.out|.json） |
| 索引同步 | design §4.2.4 ＋ 本文件 §16 ＋ README-总索引 §4.5 ＋ p19-PROGRESS 断点节 |

（追加完 · 2026-09-14 · 口径B 微步4）
