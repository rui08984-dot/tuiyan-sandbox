# 命题 A 全量跑批 · 关机交接与续跑指令（2026-09-14 晚）

## 一、当前断点（关机零损失）
- **state 文件**：`E:\music player\.scratch\forecast-debate\prereg-a\run-state-full1.json`（done=9 条件，retry_pending=1 持久化）
- **已落库**：`preregA-full1%` 行（关机前实际数见下）
- **硬闸**：调用 ≤2300／费用 ≤¥25（编排器内建，续跑自动生效）

## 二、明天开机续跑命令（一条，管理员不需要）
```
cd /d "E:\music player"
node p1b\scripts\prereg-a-run.cjs --limit=120 --tag=full1 --run-prefix=preregA-full1- --max-calls=2300 --max-cost=25
```
- state 自动跳过已完成条件（done=9＋今晚增量）
- **建议后台/长时运行**：本机直开 cmd 跑（不依赖任何代理回合），或用 `start /b`
- ⚠ 若提示脚本不存在：跑批脚本曾临时改名 `prereg-a-run.cjs.active`——**先改回** `prereg-a-run.cjs`（`ren p1b\scripts\prereg-a-run.cjs.active prereg-a-run.cjs`）

## 三、跑完后的计分与判定
1. `node p1b\scripts\prereg-a-bootstrap.cjs --run-prefix=preregA-full1- --limit=120`（--run-prefix 防呆闸已内置；配对键=prediction_id×prompt_variant×temperature×model）
2. 判据（PREREG sha `5d6907d1…` 冻结）：`ΔBrier≥0.02 且 bootstrap 95% CI 下界>0`；**A vs C 也须达标才可宣称矛盾特征增量**
3. L1/L6 分层分区报（禁混算）；报告头挂「dry 信号 Δ=0.0156 先验偏负」

## 四、已知环境坑（明晚续跑会再遇到）
1. **DSH 作业宿主不稳定**：harness 后台 job 跑批几分钟即被宿主崩杀（exit 4294967295）⇒ **绕法已验证**：PowerShell 直开 cmd 跑（不经 harness job）最稳；或 WMI `Win32_Process.Create` 启动（脱离 Job 树）
2. **harness 会自动重拉失败 job** ⇒ 今晚出现多实例竞态（万幸零重复行）；续跑时若见多个 node`prereg-a-run` 进程，保留一个杀其余（`taskkill /PID x /F`，job runner 报错无害）
3. **跑批脚本曾临时改名**（`.active`）用于阻断 harness 重拉——续跑前确认文件名正确
4. **WAL 审计**：`p1a.db` 写后主文件 mtime/size 不变，零写审计看 `-wal`＋readonly 读回行数

## 五、关机前已完成（今晚战果）
- 烟测 ✅（169 行／解析率 100%／三臂差异实证 A−B=57、A−C=0 等长／双窗 +98 字符 10/10）
- 口径 B 四微步 ✅（契约表 22 规则→g2-report 接线→补列 254 行→R4.3 文档化；① 1058→1312 门 PASS 不翻转）
- UI 重构三步 ✅（新 bundle `index-DiR6YDKR.js`，重启服务＋强刷可见）
- P4 Manifold 对表方案 ✅（3 真实样例，CPI/CO2 强同构）
- 全量发射 ✅（已落 27+ 行，断点保护）

（交接完 · 明天开机后按 §二 续跑）
