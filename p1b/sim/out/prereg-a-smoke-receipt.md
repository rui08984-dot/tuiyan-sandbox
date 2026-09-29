# prereg-A 烟测收据（10 题烟测 · 续跑完成）

- 日期：2026-09-13 · 执行：子代理（批次4第三步续跑，断点第 2 题）
- 命令：`node p1b/scripts/prereg-a-run.cjs --limit=10 --tag=smoke --json=.scratch/forecast-debate/prereg-a/smoke-run-out.json`（后台作业 pwsh-17）
- PREREG：sha12=**5d6907d1910a**（与冻结件一致，未改动）
- 断点续跑实证：skipped_done=6（第 1 题 pid=91 全部条件自动跳过）

## 一、四问回答

### ① 成功率
- **条件级（HTTP）：60/60 = 100%**（全部 status=200；state 计数 status 200=60）
- **trial 级（LLM 调用）**：本轮 54 条件 × 3 = 162 次尝试 → **151 次成功落库，11 次失败（6.8%）**（路由 errors 通道返回，HTTP 仍 200）
- 无整条件归零：最差条件 92|cutoff|C 保留 1/3 样本；无 MOCK 回退（脚本保险未触发，mode=REAL）
- DB 只读复核：verdicts 表 `run_id LIKE 'preregA%'` 共 **169 行**（18 旧 + 151 新）；6 个 run_id 行数 27–29 不等（行数=真实成功调用数，非固定 3/条件：A-cutoff 29 / A-full 27 / B-cutoff 29 / B-full 29 / C-cutoff 27 / C-full 28）；model 全部 tokenrhythm/glm-5.3-flash

### ② 实测单次费用 vs 外推 ¥0.0090
- 实测（本轮 usage 回执 151/151 次全带）：prompt 74,758 + completion 197,429 = **272,187 tokens** → @¥3/M = **¥0.8166** → **¥0.00541/次**
- vs 外推 ¥0.0090 → **偏差 -39.9%（超出 ±30%，解释如下）**：
  1. CPC=0.009 是记账用保守外推（按 3 次/条件固定计）；实际 completion 占 72.5% tokens，均摊后单次更低
  2. 11 次 trial 失败未产生计费调用，但记账仍按 3 次/条件计 → 记账系统性高估
- 方向=记账高估（**硬闸安全侧**）。全烟测费用：记账 ¥1.62/180 次；实测口径 ≈ ¥0.92（第 1 题 usage 未入本轮统计，按同单价外推 ≈¥0.10）
- 记账口径余量：calls 180/2200（8.2%）、cost ¥1.62/¥25（6.5%）

### ③ 三臂 prompt 差异（离线重建抽样，零 LLM，pid=92 cutoff 窗）
- **A 臂** len=1321，含真实 d 段：`账本机械矛盾特征（W1-W6 版型无关检测器，纯代码计算零 LLM）：矛盾对数：0；涉及席位：无；类型分布：无`
- **B 臂** len=1264，d 段整体退回（尾部直接接「账本机械统计」三段）→ **A−B=57 字符**
- **C 臂** len=1321，含等长 sham 占位：`账本机械矛盾特征（占位·消融 sham 臂，无真实特征信息）：占位占位占位…` → **A−C=0（等长达成）**
- 10 题全部符合该模式：distinct 集合 cutoff={1321,1264}、full={1419,1362}

### ④ 双窗证据差异（cutoff vs full）
- 事件数：cutoff **8** vs full **10**（full 含 dusk 计票/终局）；claims 两窗均 13
- 证据长度：A/C 1321→1419（**+98**）、B 1264→1362（**+98**），10/10 题一致；第 1 题（旧 runner）亦 1321→1419 ✓ **双窗差异复现成功**

## 二、额外发现（2 条注记，供全量拍板）

1. **pid 91 state 证据长为测量伪影，非污染**：git 8e7e98c 版 runner 在 applyArm **之前**测 evidence_len（恒按 A 模式计长）→ state 里 pid 91 三臂全记 1321/1419；但 applyArm 在 inject 之前 → **臂开关实际生效**。旁证：pid 91 三臂判词分布不同（A-cutoff [0.02,0.78,0.58] vs B [0.02,0.9,0.58] vs C [0.01,0.8,0.58]）。17:47:28 未提交编辑已把 armOpts 纳入测量（92–100 记录正确）。可选：清 91 的 6 键重跑 ≈18 次 ≈¥0.16 换 state 自洽（非必需）
2. **trial 失败率 6.8%**（11/162）：全量 120 题 × 360 调用按此率 ≈24 次失败，部分条件样本将 <3 行——计分侧按实际行数取均值即可；若要补齐需在 runner 加轻量重试（**改 runner 需队长批准，PREREG 不动**）

## 三、判定

**通过 ✅**——管线/断点续跑/硬闸/防 MOCK/双窗差异/三臂差异 六项全实证。
建议：可放行全量 `--limit=120`（记账外推 ¥19.44/2160 次，实测口径 ≈¥11–12，均在硬闸 2200/¥25 内但调用闸余量仅 1.8%——若担心 trial 失败补跑拥挤，可全量时同步上调 max-calls，需队长拍板）。

---
产物：state=`.scratch/forecast-debate/prereg-a/run-state-smoke.json`（stop=complete）· JSON=`.scratch/forecast-debate/prereg-a/smoke-run-out.json` · 抽样件=`.scratch/forecast-debate/prereg-a/smoke-arm-sample.cjs`（node --check 通过）· 只读校验件=`smoke-verify.cjs`/`smoke-prob-check.cjs`
