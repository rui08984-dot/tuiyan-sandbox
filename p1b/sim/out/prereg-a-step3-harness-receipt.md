# 命题 A 消融 · 编排器（批次 4 第三步）交付收据
生成 2026-09-13 ｜ 判据来源 PREREG-命题A-3.0消融-v1.md（sha256 5d6907d1…，**本回合未改**）｜ **本回合零真 LLM 调用**

## 一、编排器 p1b/scripts/prereg-a-run.cjs（node --check EXIT=0）
- **双窗**：真正调用 p1b/scripts/prereg-a-windows.cjs（L56 require，**必须带 .cjs 扩展名**；L69 assertSingleWindow；L77 cutoffView/fullView）；full 窗＝该局全量事件 id 集，经 body.evidenceIds 覆盖证据块（verdicts.js 新增 additive 参数，缺省＝现状，逐字节不变）。
- **三臂**：L40-45 ARM_ENV/applyArm —— A=默认（3.0 真实 d 段）／B=P1B_EVIDENCE_V3=0（2.0）／C=P1B_EVIDENCE_V3_MODE=sham；每次 inject 前设 env、后清 env。
- **run_id**：preregA-run1-{arm}-{window}（与 R-A/R-B/R-C 区分）。
- **硬闸（内建）**：调用数 ≤ --max-calls（默认 2200）、费用 ≤ --max-cost（默认 ¥25，单价 --cost-per-call 默认 ¥0.0090）；**每次 inject 计 3 次调用**（路由 3 路）；到任一上限立即 break 并写 stop_reason + 停点。
- **断点续跑**：状态文件 --state（默认 .scratch/forecast-debate/prereg-a/run-state-{tag}.json）记录已完成 pid|window|arm，重跑自动 skip。

## 二、grep 佐证（编排器真正引用，非各写一套）
- 窗口模块：prereg-a-windows 命中 L8/L56/L69/L77（require + assertSingleWindow + cutoffView/fullView）。
- 三态开关：P1B_EVIDENCE_V3 / P1B_EVIDENCE_V3_MODE 命中 L39/L42/L43/L45（ARM_ENV + applyArm）。

## 三、双窗证据差异实证（DRY，零 LLM）
命令：node p1b/scripts/prereg-a-run.cjs --dry-windows --limit=3 --db=<临时库>
- 条件数：limit=3 → 18（3 题×2 窗×3 臂）；全量（sim L1/L6 checklist v2 共 360 题）→ **2160 条件**（120 题 → 720 条件×3 路 = 2160 次调用，与 A 档口径一致）。
- **证据块长度：cutoff=1321 ｜ full=1419（同题同臂）⇒ 窗差异确实生效**（full 含 dusk 计票/终局事件）。

## 四、MOCK 编排自检（临时库副本，不触生产）
- RUN1 --mock --limit=2 --max-calls=6：conditions=12，completed=**2**，calls=**6/6**，stop=**max_calls @ 91|cutoff|C** → 调用闸按预期切断。
- RUN2 续跑 --max-calls=60（同 state）：skipped_done=**2**，completed=**10**，calls=**36**，stop=**complete**，remaining=0 → **断点续跑可恢复**；cutoff 证据 1321 / full 证据 1419。
- RUN3 费用闸 --max-cost=0.02：第一条件 3×0.0090=0.027>0.02 ⇒ stop=**max_cost @ 91|cutoff|A**，calls=**0** → 费用闸按预期切断。
- 临时库写盘核验（readonly 读回）：**36 行 / 6 个 run_id**，每个 run_id 6 行覆盖 2 个 pid；run_id 集合 = {A,B,C}×{cutoff,full} 且前缀 preregA-run1-。

## 五、生产库零写核验（含一处过程偏差，如实登记）
- 行级核验（readonly 读回生产库）：verdicts **2420**（与跑前快照一致）／predictions **1935**／run_id 分组仍为 {NULL 268, ca1b5cdbddfc 1080, f4f760aa50e1 1072}／**preregA 前缀行 = 0** ⇒ 无本消融行写入。
- ⚠ **过程偏差**：首次 DRY 调用用了 --key=value 形式，而当时 arg() 只解析空格形式 ⇒ db/state 参数回落默认，**该次 DRY 打到生产库路径**；DRY 不 inject（零行写入），但 buildServer 启动执行既有 ensureDDL/WAL，生产库 mtime 由 17:10 变为 17:28（**行级内容零变化**，见上）。
- 已修：arg() 改为同时支持 --key=value 与 --key value；此后 DRY/MOCK 一律 --db=<临时库副本>；下不为例。

## 六、测试与语法
- node --check：prereg-a-run.cjs / verdicts.js 均 EXIT=0。
- node --test：tests **226** / pass **226** / fail **0**（基线 226，**无回归**；verdicts.js 的窗口覆盖改动为 additive）。

## 七、一句话结论：现在能否烟测、预计调用与费用
- **现在可以烟测**——编排器已就绪，双窗（cutoff 1321 / full 1419 实证）、三臂（A/B/C）、调用闸（2200）、费用闸（¥25）、断点续跑均已 MOCK 实证。
- **烟测（10 题）**：10 题 × 2 窗 × 3 臂 = 60 条件 × 3 路 = **180 次调用 ≈ ¥1.62**（计入总闸）。
- **A 档全量**：120 题 → 120×2×3 = 720 条件 × 3 路 = **2160 次 ≈ ¥19.44**（在 2200 次 / ¥25 封顶之内）。
- 真跑命令（待队长下令）：烟测 `node p1b/scripts/prereg-a-run.cjs --limit=10`；A 档 `--limit=120`。

（收据完 · 2026-09-13 · 批次 4 第三步编排器）