# p15-PROGRESS · 批次1-M1+M2 · A1 三件套收口（施工棒）

日期：2026-09-12 ｜ 执行：施工棒（p15） ｜ 状态：**M1 验收通过（1536ec6/7bf650b），M2 完成，停等验收**

## M2 · apply 回填+tautology 置位+档案更正（2026-09-12）

### 1. backfill --apply（90 条 evidence 回填）
- apply 前 dry-run1：STATS={games:30,scanned:90,changed:90,unchanged:0,missing:0}（预期 90 精确命中）
- --apply：事务提交「已提交事务 UPDATE evidence_json（仅 DIFF 行）」，STATS 同上
- apply 后只读复核：rows=90 evidence_empty=0 evidence_filled=90（M1 时 90/90 空 → 0/90）
- **抽验 3 条人工核对（game=8）**：pred#1[L6 本局狼人阵营胜利]→event#38 system「游戏结束：狼人阵营胜利（放逐的 2 号是平民，狼人 1、5 号存活）」；pred#2[L1 本局首夜平安]→event#30 day/death「天亮了。公布夜 1 死亡：3 号死亡」；pred#3[L6 放逐投票≥3 票]→event#37 dusk/death「计票：{"2":3}。2 号被放逐出局」——三件均与该局结算事件精确对应，无跨局悬空
- **幂等复跑 dry-run2**：STATS={games:30,scanned:90,changed:0,unchanged:90,missing:0}——changed=0 符合幂等预期（90 行全 SAME）

### 2. tautology 置位
- SQL 原文：UPDATE predictions SET tautology=1 WHERE layer='L1' AND statement LIKE '本局首夜平安%'
- 复核：update_changes=30，置位后 count=30（库内 tautology=1 总数 30 / =0 总数 60，90 行全覆盖）；l0Gate 双口径不动（批次 2 做）

### 3. p12-PROGRESS 档案更正（追加注记，原文未动）
- L27 追加【更正 2026-09-12】：evidence_json「引用结算事件 id」系失实→90/90 空实况+M2 回填对齐
- L38 追加【更正 2026-09-12】：270 调用 263 落库（v1 86/v2 89/v3 88），7 次单路失败零日志（judge-errors.log 已于 p13 补建）；路数<3 时写回取算术平均非 median
- L45 追加 A5【更正补录 2026-09-12】：L1 median 写回 Brier=0.5970（_redteamA-recalc.cjs 复算口径可复跑；重言式题上判词为反向信息，占位 0.25 的 2.4 倍）

### 4. 测试与 commit
- node --test 全量 156/156 全绿（full-run.out 已刷新）
- commit③ hash 见 git log「批次1-M2：90 条 evidence 回填 apply+tautology 置位 30+p12 档案更正（A2/A5）」

### 边界
- 禁跑 judge-runner（重跑属 PREREG 后）✓；禁改 verdicts.js ✓；8787 零接触 ✓；临时脚本 _m2-tautology.cjs 已删
- M2 的库写入仅两处：90 条 evidence_json 回填 + 30 条 tautology 置位（均队长指令原文口径）

## M1 · A1 三件套代码+dry-run（已验收 1536ec6+7bf650b）

## 改动清单（commit①=2d99a13 批次0.5；commit②=1536ec6 批次1-M1）

| # | 文件 | 改动 |
|---|---|---|
| 1 | p1b/scripts/sim-titles.cjs | 写端修复：insertPrediction 补 evidence: t.evidence（一行级+注释注明 p13/p15 修复）——根因=L33-36 漏传致库中 evidence_json 空 90/90 |
| 2 | p1b/src/routes/verdicts.js | per-path 注入（B1(a) 信息差）：loadEvidence（evidence_json→events id+game_id 双条件查防跨局悬空，每条「事件 #id（day N/type）：raw_text」截 200 字，空/悬空→「（本条无证据引用，仅题面陈述）」；块头恒标「账本事件引用（全量账本记录，非结算前信息）」——R-A 读数口径）｜loadBaseline（同 game_type 同 layer 已 resolve true 占比，**LOO 排除本条**；n<10→rate=null 如实标「基率样本不足」；L1 重言层与未分类层一律返回 null 不注入）｜buildUserPrompt 分流：v1=题面+证据块、v2=纯题面、v3=题面+基率背景行「账本历史统计（同类局型 n=X，true 占比 Y），仅作背景参考」（禁更新指令措辞，Schoenegger）｜buildMockVerdict 同步：v1 含证据行、v3 含基率行、三路末行 P=0.xx 契约之上加「Range: A%-B%」（mock=P±0.10）｜OUTPUT_FORMAT_RULE 增区间行要求（角度词与温度配对不动）｜新增导出 loadEvidence/loadBaseline/formatBaselineLine/EVIDENCE_HEAD/NO_EVIDENCE_LINE |
| 3 | p1b/src/db/predictionsStore.js | additive 迁移：SCHEMA+AUDIT_COLUMNS 加 tautology INTEGER DEFAULT 0（照七列先例）；rowToPrediction 读回；导出 updateTautology(id, flag∈{0,1}，非法抛错，不存在→null)；头注释补语义。**本微步未 UPDATE 任何库数据（M2 做置位）** |
| 4 | p1b/scripts/backfill-evidence.cjs | 新脚本：按 sim-titles 同逻辑对 gid 8-37 重算三题 evidence；默认 dry-run 逐条打印 prediction_id/现值/新值；--apply 单事务仅 UPDATE 现值≠新值行（幂等可重放）；本微步只跑 dry-run |
| 5 | p1b/test/verdicts.test.cjs | 新增 5 用例（per-path 注入 ×5，见下） |
| 6 | p1b/test/predictions-audit.test.cjs | 新增 2 用例：tautology 默认 0/updateTautology 置 1 读回/非法值/不存在 id；旧库 DROP→ensure 补列旧行 tautology=0 |
| 7 | p1b/test/full-run.out | Tee-Object 全量落盘更新（156/156） |
| 8 | .scratch/forecast-debate/backfill-dryrun-20260912.out | dry-run 全量输出留档（93 行） |

## 测试收据（p1b 域 bare：node --test，与 p13 口径一致）

```tests 156  pass 156  fail 0  cancelled 0  skipped 0```（基线 149 → +7：per-path ×5 + tautology ×2，≥156 达标）

新用例名：①loadEvidence 命中/悬空/空三态+200 字截断+R-A 口径护栏 ②buildUserPrompt v1 证据/v2 纯题面/v3 基率行+禁更新指令 ③loadBaseline LOO 排除自身+n<10 样本不足+L1/未分类不注入 ④buildMockVerdict 三路 Range 行+v1 证据行+P= 末行契约不破坏 ⑤POST verdicts（MOCK）v1 落库含证据块+三路 Range+extracted 全真 ⑥⑦tautology 默认 0/置位读回+additive 迁移。

## backfill dry-run 收据（本微步只 dry-run，未 apply）

STATS={"games":30,"scanned":90,"changed":90,"unchanged":0,"missing":0} —— 预期 90 条精确命中。
零写入验证（dry-run 后只读复count）：rows=90 evidence_empty=90（库未动）。
前 20 行样本：

```
MODE=DRY-RUN
[DIFF] game=8 key=win prediction_id=1 现值=[] 新值=[38]
[DIFF] game=8 key=peace prediction_id=2 现值=[] 新值=[30]
[DIFF] game=8 key=votes prediction_id=3 现值=[] 新值=[37]
[DIFF] game=9 key=win prediction_id=4 现值=[] 新值=[48]
[DIFF] game=9 key=peace prediction_id=5 现值=[] 新值=[40]
[DIFF] game=9 key=votes prediction_id=6 现值=[] 新值=[47]
[DIFF] game=10 key=win prediction_id=7 现值=[] 新值=[58]
[DIFF] game=10 key=peace prediction_id=8 现值=[] 新值=[50]
[DIFF] game=10 key=votes prediction_id=9 现值=[] 新值=[57]
[DIFF] game=11 key=win prediction_id=10 现值=[] 新值=[68]
[DIFF] game=11 key=peace prediction_id=11 现值=[] 新值=[60]
[DIFF] game=11 key=votes prediction_id=12 现值=[] 新值=[67]
[DIFF] game=12 key=win prediction_id=13 现值=[] 新值=[78]
[DIFF] game=12 key=peace prediction_id=14 现值=[] 新值=[70]
[DIFF] game=12 key=votes prediction_id=15 现值=[] 新值=[77]
[DIFF] game=13 key=win prediction_id=16 现值=[] 新值=[88]
[DIFF] game=13 key=peace prediction_id=17 现值=[] 新值=[80]
[DIFF] game=13 key=votes prediction_id=18 现值=[] 新值=[87]
[DIFF] game=14 key=win prediction_id=19 现值=[] 新值=[98]
```

## 队长补充处置（M1 验收前增量）

- **actor_seat 语义坑核查（p14 提示）**：M1 两件均不消费 events.actor_seat——backfill-evidence.cjs 三题判定只用 type/day/phase/raw_text（与 sim-titles 同安全路径，p14 L153 自证 raw_text 匹配不触雷）；verdicts.js loadEvidence 查询刻意不含该列。已在此两处加防误用注释（「actor_seat 存 players.id，读座位号须 LEFT JOIN players 还原」），full-run.out 已随注释版重跑刷新（156/156 不变）。

## 边界与移交

- **M1 禁区全遵守**：未 --apply、未 UPDATE 任何库数据（零写入已实证）、未跑 judge-runner、8787 零接触、未碰 p1b/web/**、meihua.js、p1a-terminal/src、p1b/src/botc/、sim-templates-v2*（6108f49c 在写）。
- **幂等 unchanged 路径未实证**：apply 属 M2，本微步只能实证「changed=90→UPDATE 逻辑在位」与代码级幂等（仅现值≠新值才 UPDATE）；unchanged=0 因库中现值全空，无既有同值样本。
- **R-A 口径护栏已写死**：证据块头恒标「非结算前信息」；v3 措辞恒「仅作背景参考」无更新指令；L1 与未分类层不注入基率；LOO 排除自身。
- 临时探针（_probe-m1.cjs/_fix-line.cjs/_check.err/_run.tmp.out）已清理；dry-run 全量输出留档 .scratch/forecast-debate/backfill-dryrun-20260912.out。
- 施工期插曲（如实记录）：SCHEMA 加列踩「JS 数组逗号 vs SQL 列逗号」两层结构坑 3 次（read 工具行尾显示与实际字节不一致加重了误判），最终用 AUDIT_COLUMNS 先例逐字符对齐修复；测试断言正则手误 1 次经程序化替换修复。根因均为笔误非环境。

---

# 批次 1.5 · TS/Platt 回测+Murphy 报表+PREREG v1（2026-09-12）

前置：M2 验收通过（572088b）。本批次三件全零 LLM、库只读、未动 src/test。

## 1. ts-rebacktest.cjs（LOO 主口径）

- 头部双警告：F33 分数归一化（三路温度 0.2/0.7/1.0 非同尺度，逐路独立拟合为最小归一化处置）+评审边界（结论只做预期管理，不进 PREREG 判据）
- 三路结果（全量层，n=86/89/88）：原始 Brier 0.3876/0.3285/0.3360 → **TS LOO 0.2563/0.2532/0.2537**（T̂ 全顶格 20=强软化；ΔBrier bootstrap CI 全不含 0）→ Platt LOO 0.1877/0.2219/0.2429（Platt 优于 TS：2 参数能纠偏 Yes 的偏移，TS 只缩放）
- **acquiescence 可校回比例（TS 口径）≈0.95**：校准几乎全数回收「判词 vs 最优常数」差距，但回收终点≈常数基率 0.25——**三路无任何超越常数的信号**（p12「判词=基率噪声版」负结果的量化确认）
- L1 重言层单列：Platt LOO=0.0000（重言可完美拟合=非信息）；v3 Platt Newton 发散已修（步长截断 clamp±2）

## 2. report-murphy.cjs（K F56 三分解，0.05×20 桶）

- **20/20 行自检「Brier=REL−RES+UNC+VarW−2CovW 分解✓」**：精确恒等式含桶内方差/协方差项（离散 Murphy 的诚实口径；REL−RES+UNC 对 binned 预测 f̄_j 严格成立，直接 Brier 差=VarW−2CovW）
- 全量：v1 REL=0.2459/RES=0.1076；v2 0.1720/0.0941；v3 0.2022/0.1179；median 0.2348/0.1240；0.5 占位 REL≈0.0001（无信息基线的零校准误差+零分辨率）
- L1/tautology=1 层单列：UNC=0、RES=0、REL=Brier——**A5 的 L1 median Brier=0.5970 正式进报表**（0.5970=REL，重言反向信息量化）
- ECE20 对照行恒挂 F58 下界口径注记

## 3. PREREG-判词重跑-v1.md（待确认版）

- 位置：.scratch/forecast-debate/PREREG-判词重跑-v1.md；sha256=e2609e68b9ded8a08d0509cfc88cd7acfabb8e755a7bf41517074c46132f17e5（排除 `> sha256` 行口径，**自洽复算已验证**）
- 四要素追平 Confident（A0 差异表行动项 1）：①证伪条件逐字计分 ②复现设计=sha256+commit 锚+LCG 种子 987654321+DB 快照 hash ③stop-rule=一次跑完禁择优+失败重跑≤2 次只修工程故障 ④撤回留痕=verdicts JSON 归档+predictions 快照+版本号递进
- 判据：R-A1 v1 全量 Brier≤0.05（FBSim H0<0.03 参考下界；>0.10=工程排查非改判据）；R-A2 L1 acquiescence 双向（锚=重跑前 L1 median 0.5970）；R-A3 v2 复刻 ~0.33 信息真空；v3@L6 ΔBrier ±0.06 噪声条款；TOST d=0.5 双向可发表
- impute 规则（0.5/基率，跑前写死+打标）；endpoint 冻结（单路 Brier，median 只记账，γ̂ 双轨不得版）；多重比较声明（判据族<5 且方向预注册，Šidák 不适用）；ECE/coverage 不进判据（K F13/F22/F58/F61）
- **状态=待确认版**：用户对 R-A/R-B 拆分有否决权，确认后改「已冻结」+commit 锚

## 4. 测试与 commit

- node --test 156/156 全绿（full-run.out 已刷新；1.5 未动 src/test）
- commit④ hash 见 git log「批次1.5：TS/Platt 回测+Murphy 报表+PREREG v1 草案」