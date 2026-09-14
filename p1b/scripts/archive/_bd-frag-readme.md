### G2 口径修订 R4.3 与契约表 date_derivation（2026-09-14）
| 件 | 说明 |
|---|---|
| p1b/sim/out/g2-contract-frozen-r4.json | **契约表扩展**：顶层 date_derivations **22 kind** 到期日换算规则＋previous_sha256；sha256 bafd3d389a91…→**007b41188807…dbaa260dbf**（contracts 34/aliases 25 原字段零改动；依据 docs/specs/决策brief-月度年度resolve.date口径-20260914.md §5，用户批口径 B） |
| design **§4.2.4 修订 R4.3** | **① 池入池判定扩展**：resolve.date 或 date_derivation 换算 effective_date（到期＝数据发布日，保守近似）；backfill 172 行维持排除（PREREG 锚＝statement 标记，非 phase 键）；规则表锚 SSQ 日/二/四·DLT 一/三/六·BOM 年内第 NN 个周日（仅 2026 年段，跨年需新锚） |
| p1b/scripts/g2-report.cjs（+66 行 additive） | date_derivation 接线＋逐 kind 披露（换算入池 427/failed=0）；backfill 排除标签改名 backfill_no_forwardLooking |
| 存量化补列（微步 3） | 254 行前瞻 matures_at=effective_date（1058→1312 non-null；写前快照 sha 5a72ef3f…，integrity ok）；读数不变 |
| 读数 | ① 1058→**1312**｜③ 长 33→**197**（短 439/中 147）｜④ **1120**（覆盖 1312/1312）｜**门 PASS 不翻转**｜测试 226 绿｜收据 p1b/sim/out/g2-report-r4-dd-gated.out|.json |

