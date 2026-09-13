# 命题 A 消融 · 跑批 harness 缺口登记（2026-09-13 · 批次 4 第三步开工侦察）

## 已做（步骤 1：归档＋快照，p1a.db 全程只读）
- 目录：.scratch/forecast-debate/prereg-a/
- verdicts-archive-preregA-run1-20260913.json —— 1,044,371 B ／ sha256 0894c0ebf212097e9bd7f7bf9d11260e8e4ff160cf53e58c6c048fb45fbd39e8（sim 域 2420 行）
- p1a-snapshot-preregA-run1-20260913.db —— 5,902,336 B ／ sha256 6625ec63c184cbb2c35270423552602023581cc0b1cd48e14d57a963cb36a2ee（readonly 复开 ok、integrity_check=ok、predictions 1935 / verdicts 2420）
- manifest-preregA-run1-20260913.json

## 缺口（**阻塞烟测**）
1. **无窗口开关**：\`POST /api/games/:gid/predictions/:pid/verdicts\` 恒以 \`prediction.evidence\` 组证据块（\`p1b/src/routes/verdicts.js:382 loadEvidence(pred)\`），**无 window 参数**；PREREG §5 的 \`full\` 窗（含计票/终局）**没有代码路径**。\`p1b/scripts/prereg-a-windows.cjs\` 目前只是参数/断言件，**未被任何脚本引用**（grep 全 p1b/scripts 仅命中其自身）。
2. **无三臂编排**：\`p1b/scripts/judge-runner.cjs\` 仅支持 \`--runid=\` / \`--limit=\` / \`--slice=\`，**无 arm/模式开关**；三臂只能靠**三次进程级 env**（\`P1B_EVIDENCE_V3=0\` ／ 默认 on ／ \`P1B_EVIDENCE_V3_MODE=sham\`）+ 三个 run_id 手工编排，且**没有统一的调用数/费用硬闸**（2200 次 / ¥25 的封顶无处落）。
3. 结论：任务书要求的「**3 臂 × 2 窗**烟测（≈180 次）」**当前不可执行**；我不擅自缩范围，也不先烧额度。

## 待队长裁决（三选一）
- **A（推荐）**：先构建 \`p1b/scripts/prereg-a-run.cjs\`（窗口证据覆盖：cutoff=现状 / full=加入该局 dusk 及终局事件；三臂；每条件独立 run_id；调用数与费用硬闸 2200/¥25；断点续跑）。**此步不调 LLM**；完成后按 3 臂×2 窗烟测（≈180 次 ≈¥1.6）。
- **B**：批准「**cutoff 单窗**」烟测（3 臂×1 窗 ≈90 次 ≈¥0.81），仅验真实 LLM 管道/解析率/计费；full 窗后补。⚠ 偏离本次任务书的「3 臂×2 窗」烟测要求，需你明示。
- **C**：只跑 A/B 两臂——**不满足 PREREG §2「三臂缺一不可」**，不推荐。

## 依据（盘上可核）
- PREREG：.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md（sha256 5d6907d1…，§2 三臂 / §5 双窗）
- 真实模式：judge-runner.cjs L31-33（llmMock:false）；providers 在 p1a-terminal/config/providers.json（**未读内容，key 保护**）
