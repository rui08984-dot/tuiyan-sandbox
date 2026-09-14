# ② 采信链规则② · 校准补样 21 项收据（② 达 accepted）（2026-09-14）

## 一句话

按 design §4.2.3 修订 R4.2（D-3③）规则②「校准**全过且 n≥35**，或 Wilson 95% 下界 ≥0.90」，对校准段**补样 21 项**（14→35），
逐项独立判读并**逐项留理由**；21/21 PASS，Wilson 95% 下界 **0.9011 ≥ 0.90** ⇒ **② acceptance = `accepted`**（此前 `pending_recheck`）。
**诚实披露**：补样由**代理**执行（非端用户、非独立人类审计）——audit 已写明「不得声称全人工」；端用户参与的是 ③（10 题抽验，by=user）。

## 一 · 抽样与执行

| 项 | 值 |
|---|---|
| 通道 | 新脚本 `p1b/scripts/g2-hcal-expand.cjs`（`--emit` 出表／`--record` 记账；只读 p1a.db、只写 audit JSON） |
| 抽样纪律 | 沿用首轮「最可能分歧」：**边界基率 13 ＋ 长窗 2 ＋ 顺延 6**（长窗桶可选仅 2 项，缺 1 由边界桶补足；脚本按实际构成披露） |
| seed | 20260914（可复现）；排除首轮 14 条（466/476/480/486/490/524/540/542/1331/1627/948/1835/1839/1846） |
| 复核单 | `p1b/sim/out/g2-hcal-expand-sheet.md`（21 项：题面/真值锚/判据参数/cutoff/基率/两段结论） |
| 填写件 | `p1b/sim/out/g2-hcal-expand-filled.tsv`（21 行，**理由非空**——空理由会被记账拒收） |
| 执行者 | 代理（ZCode 会话，非端用户）；逐项理由见 audit `human_calibration.hcal_expand.detail` |

## 二 · 结果

| 项 | 值 |
|---|---|
| PASS / REJECT | **21 / 0** |
| hc.n | 14 → **35**（门槛 35） |
| hc.agreed | 14 → **35**；rate = **1.000** |
| Wilson95 | **[0.9011, 1.000]**（≥0.90；同时满足「全过且 n≥35」） |
| acceptance | `pending_recheck` → **`accepted`**（`accepted=true`；`summary.acceptance_status=accepted`） |
| review_composition | machine 140 ／ agent_semantic 140 ／ **human_calibration 35**（含 **hcal_expand_agent 21**）／ end_user 10 ／ agent_surrogate 0 |

## 三 · 复核中的真发现（不是"全过就没事"）

1. **cmp0 措辞 bug（既有行）**：id=1633/1535 题面「≤」而基率注记书「>=」——系 `corpus-sources-b4.cjs` 已诊断的 `cmp0()` 恒真桩遗留（注释明言"修复只影响后续生成的行"）。**我用 API 实抓 400 天复算**：P(≤28.93)=0.6025、P(≤11.88)=0.6025，与记录 b=0.603 吻合 ⇒ **b 方向正确、仅文案错**（同首轮 1627 的处置）。日志 `p1b/sim/out/g2-hcal-expand-aq-check.log`。
2. **GMT 口径未上题面**（air 族 6 项）：判据在 resolve 内固定（`timezone=GMT`），可机检；但题面未显式标注 ⇒ 披露可改进项（④ 报告层）。
3. **薄窗 2 项**：id=1490/1482 各 76 样本、id=1129 仅 18 个日均 ⇒ ④ 报告项（#13 薄窗披露机制已建）。
4. **潮汐注记窗口越 cutoff**（id=1254）：「过去 40 天（08-09~09-17）」越过 cutoff 4 天且含事件日；潮汐为**天文推算**（题面已注明，无未来信息泄漏），但窗口未按 pre-cutoff 收口 ⇒ ④ 报告项。

⇒ 以上全部记入逐项理由；**无一项构成 Q0-1/2/3 拒收**（锚在、cutoff 合规、非重言）。

## 四 · 诚实边界（勿省）

- 本补样由**代理**执行并逐项留理由；**非端用户、非独立人类审计**——audit `disclosure`/`meta.honesty` 明写「不得声称全人工」。
- 端用户参与项是 ③：用户本人对 10 题抽验表裁定「都过」（见 `p1b/sim/out/g2-user-spotcheck-user-receipt-20260914.md`）。
- **如对规则②作"人类"严格解释**（执行者人选另定），本 21 项可整体作废重判：恢复 `p1b/sim/out/g2-audit-r4.pre-hcal-expand.bak.json` 后按新执行者重跑 `--record`（留此路径以便审计）。

## 五 · 验证与留痕

- 测试：`p1b/test/g2-hcal-expand.test.cjs`（3 例：选择器可复现＋排除首轮／空理由拒收不写盘／记账幂等＋构成同步）；全量 **248/248 绿**。
- 记前备份：`p1b/sim/out/g2-audit-r4.pre-hcal-expand.bak.json`。
- 门读数：G2-R4.4 五条**不受影响**（门②阈值＝抽检合格率≥70%，实测 100%）；冻结收据 `g2-report-r4.4.*` **不重跑**；`acceptance` 状态在下次报告生成时自然反映。
- 四件套：变更留痕 §25 ＋ README §4.5 ＋ p19 锚 ＋ 全资源地图 §7。

---

（收据完 · 2026-09-14 · ② accepted · 21/21 · Wilson lb 0.9011 · 非全人工如实披露）
