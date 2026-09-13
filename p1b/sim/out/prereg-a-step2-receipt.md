# PREREG-命题A-3.0消融 · 第二步收据（跑前四件实现件）
生成 2026-09-13 ｜ PREREG：.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md（sha256 5d6907d1…，**本回合未改**）｜ 零写 p1a.db

## §8 四件逐条勾选

**[x] ① C 臂「等 token 空特征对照」开关**
- 件：p1b/src/routes/verdicts.js —— env \`P1B_EVIDENCE_V3_MODE\` ∈ {on,off,sham}（或 opts.contradictionsMode）；**缺省/非法＝off（＝现有行为，零行为变化）**。
- sham 实现：renderShamBlock() 以中性占位按真实 d 段**行数与总长度对齐**；内容无数字/无规则名/无明细/无席位。
- 单测：p1b/test/verdicts.test.cjs「loadEvidence 臂模式 sham（C 臂）」——行数相等、长度差 0%、无真实信息；off 与缺省逐字节一致；env sham 生效；contradictions:false 优先（2.0 形状）。
- **等长实测**（合成 2 对 W2/W4）：on_len=129 ／ sham_len=129 ／ diff_pct=0.0000 ／ on_lines=4 ／ sham_lines=4 ／ sham 含数字=false。

**[x] ② cutoff/full 双窗跑批参数显式落盘**
- 件：p1b/scripts/prereg-a-windows.cjs（常量 + 视图构造 + assertSingleWindow 禁止合并）。
- 口径与 p1b/scripts/acr-run-llm.cjs L46-55 **逐字节同规则**：cutoff＝排除 dusk（投票/计票/终局）；full＝全量（≈生产 see-all）。
- 自检：合成 3 事件（night/day/dusk）→ cutoff=2 ／ full=3 ／ dusk_excluded=1；assertSingleWindow('merged') 抛错。
- 依据：acr-二期报告（漂移由事件窗决定：cutoff 0.0875 PASS vs full 0.6485 FAIL）。

**[x] ③ 配对 bootstrap 脚本**
- 件：p1b/scripts/prereg-a-bootstrap.cjs（配对键 prediction_id×prompt_variant×temperature×model；B=1000；seed=987654321；Δ=Brier(baseline)−Brier(treatment)；Murphy 10 等宽桶；**源库 readonly**）。
- **dry 自检（存量 R-B/R-C，零 LLM）**：n_pairs=1070 ｜ Brier_treatment=0.22087 / Brier_baseline=0.23644 / Δ=0.01557 ｜ 95% CI=[0.00811,0.02835]，下界>0=true ｜ Murphy(treatment) rel=0.00296 res=0.02793 unc=0.24482；Murphy(baseline) rel=0.01011 res=0.01988 unc=0.24482。
- 输出：p1b/sim/out/prereg-a-bootstrap-dry.json（件内声明：dry 自检 ≠ 3.0 消融结果）。

**[x] ④ 跑前归档与快照**
- 件：p1b/scripts/prereg-a-archive.cjs（源库 readonly；verdicts 归档 sim 域含 run_id/model；**在线备份 API**；快照 **{readonly:true} 复验**）。
- 归档：.scratch/forecast-debate/prereg-a/verdicts-archive-preregA-20260913.json（1,044,366 B ／ sha256 4db8045fcedab37a…；sim 域 2420 行；by_run_id NULL 268 / ca1b5cdbddfc 1080 / f4f760aa50e1 1072）。
- 快照：.scratch/forecast-debate/prereg-a/p1a-snapshot-preregA-20260913.db（5,902,336 B ／ sha256 5f30f52f8ae80345…；readonly 复开 ok；integrity_check=ok；verdicts 2420 / predictions 1923）。
- manifest：.scratch/forecast-debate/prereg-a/manifest-preregA-20260913.json（两件 sha256，**复算 match=True**）。

## 测试与语法
- \`node --test\`：tests **224** / pass **224** / fail **0**（基线 222 ⇒ 新增 2 条，**无回归**）。
- \`node --check\`：verdicts.js ／ prereg-a-windows.cjs ／ prereg-a-bootstrap.cjs ／ prereg-a-archive.cjs 全 **EXIT=0**。

## 边界
- **零写 p1a.db**（源库 mtime 17:10 未变；④ 只新增归档/快照文件）；无 INSERT/UPDATE；**未调 LLM/网络**；未碰 key/8787/botc/checklist_hash；PREREG 冻结件未改（sha256 仍 5d6907d1…）。

## 一句话结论：现在能否开跑
**可以开跑（四件齐备，PREREG §8 清零）**。预计 LLM 调用数与费用（ACR 二期口径：¥1.01 / 112 次 ≈ **¥0.0090/次**，~2.7k tokens/次）：
- **全量**：450 题 × 3 路 × 3 臂（A/B/C）× 2 窗 = **8,100 次 ≈ ¥73**
- **达标最小（≥120 配对题）**：120 × 3 × 3 × 2 = **2,160 次 ≈ ¥19.5**
- 若每点重复采样 K=3 ⇒ ×3（全量 ≈ ¥219 ／ 最小 ≈ ¥58.5）
- 本回合**未实际调用任何 LLM**；费用为外推量级，实际以跑批计费为准。

（收据完 · 2026-09-13 · 批次 4 第二步）

