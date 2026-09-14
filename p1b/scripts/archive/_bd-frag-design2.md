**D3 · backfill 排除不因补列放行**
- statement 带【backfill】标记的 **172 行维持排除**（标签改名 backfill_no_forwardLooking——它们是历史记账非前瞻预测）；改名不改变排除结局，补列也不放行。
- **细则 B 的 PREREG 锚＝statement 标记，非 evidence phase 键**（427 行实测：phase 键 211 行 ABSENT；bf 行中 phase=backfill 116＋ABSENT 56——按 phase 判会漏 56 行，教训）。

**D4 · 换算规则表锚（可复现；仅适用 2026 年段，跨年需新锚）**
- SSQ＝日/二/四 21:15，锚 2026106=2026-09-13（库内题面 id=453 cutoff 锚定＋id=601/602 cutoff 算术证明；派单表「周一/三/日」有误已实证纠正）：date=2026-09-13+floor(k/3)*7+[0,2,4][k mod 3] 天，k=NNN−106。
- DLT＝一/三/六 21:25，锚 26105=2026-09-14（题面 id=841/842/843 显式记录）：date=2026-09-14+floor(k/3)*7+[0,2,5][k mod 3] 天，k=NNN−105。
- BOM＝年内第 NN 个周日（周末末日），2026 锚 W1 末日=2026-01-04（网页实测 W37=Sep 11-13、W40=Oct 2-4）。月度=次月最后一日；epiweek=MMWR 周六（S1+(N−1)*7，S1=含 1 月 4 日那周的周六）；npm/github/openalex=直取 end/week_end。

**D5 · 读数变化披露（微步 2/3 实测，gated 重跑）**
- ① **1058→1312**（换算 427/427 成功、failed=0；+254 前瞻周期题入池；−172 backfill 维持排除；−1 cutoff_not_before_event）
- ③ 短 419→439／中 77→147／**长 33→197**（发布日口径生效，长中 backfill=0）｜④ 928→**1120**（覆盖 1312/1312）｜② 质量读数不变（report_only）｜**门 PASS 不翻转**｜测试 226/226
- 存量化补列（微步 3）：254 行前瞻 matures_at=effective_date（1058→1312 non-null）；backfill 172 行不补。收据 p1b/sim/out/g2-report-r4-dd-gated.out|.json。

**D6 · 契约表 sha 变更留痕**
- bafd3d389a91… → **007b41188807…dbaa260dbf**（变更原因＝顶层新增 date_derivations 22 kind＋date_derivation_added＋previous_sha256；contracts 34/aliases 25 原字段零改动）。

（本块完 · 2026-09-14 · R4.3）

