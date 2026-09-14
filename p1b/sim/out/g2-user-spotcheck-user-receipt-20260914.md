# ② 采信链 · 端用户抽验记账收据（用户本人裁定）（2026-09-14）

## 一句话

**端用户本人**对 10 题一屏抽验表裁定「都过」（带保留原话：「其实我有点看不懂但是差不多都过」——已**原样**留在 audit 备注），
经 `--by user` 正式记账：**有效题数 10/10 · 一致率 10/10 = 100% · `review_composition.end_user = 10`**。
② 采信链 acceptance 由 `pending_user_agent_surrogate` 推进为 **`pending_recheck`**——
**必要条件③（端用户抽验 ≥10）已满足**；余项是规则②（人类校准 n=14 < 35 且 Wilson 下界 0.7847 < 0.90）。

## 一 · 记账内容

| 项 | 值 |
|---|---|
| 抽验表 | `p1b/sim/out/g1/spotcheck-10-compact.md`（10 题一屏版；seed=20260914；id：1482/1356/1560/1642/1535/1719/1125/632/1536/988） |
| 用户填写件 | `p1b/sim/out/g2-user-spotcheck-filled.user.tsv`（10 行全 PASS） |
| 核验者 provenance | **`by = user`**（端用户本人；代理不得代填） |
| 读数 | effective=**10**/10 ｜ agreed=**10**/10 ｜ rate=**1.0** ｜ Wilson95=[0.722, 1.000] |
| 记账时点 | 2026-09-14T05:5xZ（见 audit `user_spot_check_at`） |
| 写回文件 | `p1b/sim/out/g2-audit-r4.json`（备份：`g2-audit-r4.pre-user-spotcheck.bak.json`） |
| review_composition | machine 140 ／ agent_semantic 140 ／ human_calibration 14 ／ **end_user 10** ／ agent_surrogate_spot_check **0** |

## 二 · 原话留痕（诚实边界，不得删改）

audit 的 `user_spot_check_note` 末段（核验者备注）：

> 用户本人在会话中答复「都过」（原话：『其实我有点看不懂但是差不多都过』，2026-09-14）；据此 10 题全记 PASS。来源表 p1b/sim/out/g1/spotcheck-10-compact.md

⇒ 这是一次**带保留的端用户裁定**：用户明确表示未逐题深究细节，但认可「没有哪一题根本没法判」。
如实留痕，不美化、不删改；后续任何报告引用本项时须带着这句话。

## 三 · acceptance 推进与余项（按 design §4.2.3 修订 R4.2 D-3③）

| 规则 | 内容 | 现状 |
|---|---|---|
| ① 两段 | 机器段 ＋ 代理语义段 | ✅（audit 140/140） |
| ② 人类校准 | **全过且 n≥35**，或 Wilson 95% 下界 ≥0.90 | ❌ **n=14 全过但样本不足**（p̂=1 时 Wilson 下界 0.785；等价需 n≥35） |
| ③ 端用户抽验 | ≥10 题，代理不得代填 | ✅ **本次完成（10/10，by=user）** |

- **前**：`pending_user_agent_surrogate`（③ 未做；代理预核 effective=0）
- **后**：**`pending_recheck`**（③ 已满足；余规则②）
- ⇒ 余项＝**校准样本 14 → ≥35**（补齐 21 项）。补充校准须沿用「**最可能分歧**」抽样纪律（原样本＝8 假阳性＋2 边界＋4 顺延）
  且**逐项给理由**；**禁止**凑数式全过——那正是本门要防的。

## 四 · 门读数影响（不翻转）

- **G2-R4.4 五条门读数不受影响**：门②的阈值＝抽检合格率 ≥70%（实测 100%）；本次推进的是 **② 采信链的 acceptance 子状态**（独立披露项，不属五门）。
- 冻结收据 `p1b/sim/out/g2-report-r4.4.out|.json` **不重跑**（保持冻结快照）；该 acceptanc 状态会在下次报告生成时自然反映。

## 五 · 代码与测试

- `p1b/scripts/g2-user-spotcheck.cjs` 增 **`--note "核验者备注"`**（additive：把限定语/原话追加进 `user_spot_check_note` 的披露，**只追加不覆盖**）——为「带保留的裁定」留痕而立。
- 测试 +1（`p1b/test/g2-user-spotcheck.test.cjs`：备注原文保留 ＋ 标准披露仍在）；全量 **245/245 绿**。

---

（收据完 · 2026-09-14 · ③ 完成（by=user，带保留原话留痕） · 余 ② 规则② × 21 项）
