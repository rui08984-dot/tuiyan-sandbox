# p23-P0施工 · 进度锚（2026-09-16）

> **用法**：接手先读本文件；本锚＝任务书，**不读旧会话历史**。
> 纪律：微步回合制（每回合 1-2 个小动作 → 立即更新本锚 → 回报 → 等恢复令）。
> 任务源：`docs/plans/2026-09-16-预测万物v3.1-推进计划.md`（调度层）＋详卡 `.scratch/forecast-debate/研讨会-20260916-预测万物v3/13-P0施工计划-v1.md`（【13】）。

## 已完成（**全部带证据**）

1. **开工基线登记**（测试 373/373 绿 —— `cd p1b && node --test` 实跑；8787 未监听 —— `netstat -ano | grep 8787` 空；stage4 改前金样存档 `p1b/test/fixtures/stage4-golden-20260916.json`，sha256 `fb9aafec…`）
2. **P0-U1 术语真源 12→16**（`p1b/web/src/lib/terms.ts` 追加 bayesPrior/likelihoodEvidence/posteriorAgg/calibrationAci；测试 `p1b/web/src/lib/terms.test.mjs` 追加 3 例）
3. **P0-U2 stage4 贝叶斯语义六档**（`p1b/scripts/stage4-run.cjs`：`bayesSemanticsOf` 纯函数＋分层 brief `bayes_semantics`＋文本每层 +1 行＋JSON `bayes_legend`；测试 `p1b/test/stage4-run.test.cjs` 追加 2 例：金样零 diff／六档逐字）
4. **P0-U3 看板图例**（`p1b/scripts/board.cjs` 图例 6 行＋记账语言短注＋JSON `bayes_legend`；测试 `p1b/test/board-health.test.cjs` 追加断言）
5. **测试 378/378 绿**（373 基线＋5 新例）＋ **收据** `p1b/sim/out/p0-u1u2u3-receipt-20260916.md`（含全部 sha256）
6. **P0-U4 校准挑战者库**（`p1b/src/calibration/{isotonic,betaCalibration,platt,index}.js`；合成金样 4 组 `p1b/test/calibration-arms.test.cjs` 全绿；beta 公式转录核对源 arXiv:2112.10327 式(10)）
7. **P0-U5 离线 A/B 协议**（`p1b/scripts/calab-run.cjs`＋测试 `p1b/test/calab-run.test.cjs` 4 例；正式报告 `p1b/sim/out/calab-report-20260916.{json,md}`：主口径 n=695，ΔBrier=+0.0014 CI[−0.0048,+0.0083] ⇒ **维持恒等（负结果如实）**；**测试 386/386 绿**；收据 `p1b/sim/out/p0-u4u5-receipt-20260916.md`）
8. **P0-U7 日历**（`p1b/scripts/forecast-calendar.cjs`＋测试 4 例；正式件 `p1b/sim/out/forecast-calendar-20260916.{json,md}`：未解 672、桶守恒 OK、双源日桶差异 27 只披露）
9. **P0-U8 校准报告**（`p1b/scripts/calibration-report.cjs`＋测试 4 例；正式件 `p1b/sim/out/calibration-report-20260916.{json,md}`：28 格/7 可结论；限定语块＋防泄漏声明＋口径边界）
10. **U7/U8 页面化＋披露端点**（`p1b/src/routes/disclosure.js`＋server.js 注册；`p1b/web/src/pages/disclosure/{CalendarPage,CalibrationReportPage}.tsx`＋App 路由/导航`日历/校准`宽档；**dist 重建 `index-DIDo2B_H.js`、bundle 禁词扫描=0**；**测试 398/398 绿**；收据 `p1b/sim/out/p0-u7u8-receipt-20260916.md`）
11. **P0-U6 试标**（`p1b/scripts/dna-s-dryrun.cjs`＋测试 4 例；披露件 `p1b/sim/out/dna-s-dryrun-20260916.{json,md}`：平稳548/漂移190/不可判676/先验378/L1剔除180（合计=1972）；列联 70 格、集中度警示 0；Newcombe 金样独立核验 5.6e-17；收据 `p1b/sim/out/p0-u6-receipt-20260916.md`）

## 剩余步骤（编号，可断点续做）

- [x] 1. 任务 1（U1/U2/U3）收口：测试绿＋收据＋commit（`aea5b58`）
- [x] 2. 任务 2（U4/U5）：校准库＋A/B 协议＋报告（386/386 绿；收据见上）
- [x] 3. 任务 3（U7/U8）：日历＋校准报告＋披露端点＋前端两页＋dist 重建（398/398 绿；收据见上）
- [x] 4. 任务 4（U6）：dna-s-dryrun 试标（4/4 绿；收据见上）
- [x] 5. 任务 9＋10：广域普查（13 源实测：8 可达/4 要 key/1 两路失败）＋Metaculus token 检查器（403 实证）＋ForecastBench 基线件（pending 零编数）；收据 `p1b/sim/out/p0-task9-10-receipt-20260916.md`
- [ ] 6. 任务 5（E1）：`p1b/scripts/dna-s-backfill.cjs`＋旁路表 `dna_s_labels`（读【12】全件，含冻结程序）
- [ ] 7. 任务 6（E2）：`PREREG-E2-路由分配-v1.md`＋影子评分（读【10】§5/【11】§⑧）
- [ ] 8. U9 汇收：共同验收门七项＋收据＋`scripts-index.cjs` 重生成＋归档四件套（留痕/README/锚/地图）
- [ ] 9. 收尾：handoff 交接件＋project-atlas 地图刷新

## P0+ 收尾（2026-09-16 四续）

12. **cached_tokens 打点**（`p1b/src/lib/llmChat.js`；测试 3 例）
13. **U8 三列**（`p1b/scripts/u8-columns.cjs`＋件；测试 3 例；与 stage4 逐位一致）
14. **O7 注记＋秩检验 n/a＋负结果指针**（`calibration-report.cjs` 四新节；报告禁词 0）
15. **I2 负结果账本 v0**（`p1b/scripts/negative-results.cjs`；实证 9＋设计 4；四要素运行时校验；测试 3 例）
16. **A6 发布纪律**（`docs/specs/A6-校准报告发布纪律-20260916.md`）
17. **测试 415/415 绿**＋收据 `p1b/sim/out/p0plus-receipt-20260916.md`

## 实施过程诚实记录

> 踩过的坑、失败尝试、发现错误时的**更正段**（日期 + 正确口径 + 证据链）。
> 纪律：**原文零改动**，更正一律**末尾追加**。

- 2026-09-16：新建锚时仓库 git 干净、基线 373；U1 完成后 376（+3）、U2/U3 完成后 378（+5）。中间计数无异常。
- 注意（供后续棒）：`bayes_legend` 的 board 版是 stage4 版文本的**同源副本**（【13】U3 原文要求"同源复制"），两处若分叉需同步——已登记入收据 §4。
- 2026-09-16（U5 施工，两处自查修正）：
  · ① `calab-run.cjs` 初稿把**末窗并入上一窗**（cur<minWindow 时 concat 进 merged 尾窗）——这会在 n=120 这类规模下把 [72,48] 变成 [120]、**吃掉一个评估窗**（测试当场报红：评估题数 0≠48）。改为「末窗保留为独立评估窗」（小窗如实披露），测试例③通过。
  · ② U5 测试例①初稿断言 `identity.brier < 0.25` 属**断言区间写错**（p 均匀分布下 Brier 基线约 0.275 属正常），改为 (0.05, 0.5)；方向判据（Δ<0）实测通过（−0.0109）。
  · ③ 主口径实跑 n=**695**（非【12】勘察期记的 820——722 行域中 27 题引擎 insufficient_data）；差异归因＝数据积累与真值排除口径，已写入收据 §5。

---

（锚建立于 2026-09-16 · `init_anchor.py` 生成骨架 · 已填实至任务 1 收口）

## 【2026-09-16 深夜（六续·更正）· 两处自查与修正（如实登记）】

- **① 反引号事故**：README §4.5 追加批用双引号包 node -e 时，块内反引号被 bash 当作命令替换 ⇒ 两个 md/out 文件被当脚本执行（Git Bash ENOEXEC 回退解释）。**实害**：README 该行路径被吞（一行文本丢失，已补回）；其余行全为 command-not-found／语法错（A7 件在第 20 行语法错处中止），文件本体零改动、零删除、零有效命令执行。**教训：双引号内禁反引号——写文件用单引号 heredoc 或 Read/Edit 工具。**
- **② 测试副作用**：`dna-s-source.test.cjs` 例③ 初版未传 `--out-dir` ⇒ dry-run 计划件写进仓库造成 tracked 件时间戳漂移。已修（加 `--out-dir tmp`）并回滚该件。

（更正完 · 2026-09-16 六续）

## 【2026-09-17 · 终裁 8 项落地（本条为新棒起点）】

- 终裁全批准；E2 冻结（sha `5c354501…`，R3 不启动）；⑤ 裁减执行记录；⑦ 赔率草案；⑧ ForecastBench 填实；`prereg-freeze.cjs` 口径统一（E1 复算 MATCH=true）。
- 剩余：成本台账（待 usage 落盘）｜A1（范围待定）｜38 类源适配器｜E1 人工门＋生产写入｜Metaculus token（均需用户或另立项）。

（p23 锚追加完 · 2026-09-17）
