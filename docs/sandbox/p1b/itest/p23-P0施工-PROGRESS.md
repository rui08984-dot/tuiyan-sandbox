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

## 剩余步骤（编号，可断点续做）

- [x] 1. 任务 1（U1/U2/U3）收口：测试绿＋收据＋commit
- [ ] 2. 任务 2（U4/U5）：`p1b/src/calibration/{isotonic,betaCalibration,platt,index}.js` ＋ `p1b/scripts/calab-run.cjs` ＋ 两个测试（820 主口径/450 副口径、题级块 bootstrap、B=1000/seed 987654321）
- [ ] 3. 任务 3（U7/U8）：`p1b/scripts/forecast-calendar.cjs`（spawn 委托 daemon --report-due）＋ `p1b/scripts/calibration-report.cjs`（latestByPattern 只披露）＋ 前端 CalendarPage/CalibrationReportPage（U7/U8 页面化）
- [ ] 4. 任务 4（U6）：`p1b/scripts/dna-s-dryrun.cjs`（只读 dry-run；Newcombe 区间金样；源码 grep 断言无 --confirm/INSERT）
- [ ] 5. 任务 9：`p1b/scripts/sources-wide-probe2.cjs` 广域普查（体育赔率优先）；任务 10：Metaculus token 配置位＋ForecastBench 基线件
- [ ] 6. 任务 5（E1）：`p1b/scripts/dna-s-backfill.cjs`＋旁路表 `dna_s_labels`（读【12】全件，含冻结程序）
- [ ] 7. 任务 6（E2）：`PREREG-E2-路由分配-v1.md`＋影子评分（读【10】§5/【11】§⑧）
- [ ] 8. U9 汇收：共同验收门七项＋收据＋`scripts-index.cjs` 重生成＋归档四件套（留痕/README/锚/地图）
- [ ] 9. 收尾：handoff 交接件＋project-atlas 地图刷新

## 实施过程诚实记录

> 踩过的坑、失败尝试、发现错误时的**更正段**（日期 + 正确口径 + 证据链）。
> 纪律：**原文零改动**，更正一律**末尾追加**。

- 2026-09-16：新建锚时仓库 git 干净、基线 373；U1 完成后 376（+3）、U2/U3 完成后 378（+5）。中间计数无异常。
- 注意（供后续棒）：`bayes_legend` 的 board 版是 stage4 版文本的**同源副本**（【13】U3 原文要求"同源复制"），两处若分叉需同步——已登记入收据 §4。

---

（锚建立于 2026-09-16 · `init_anchor.py` 生成骨架 · 已填实至任务 1 收口）
