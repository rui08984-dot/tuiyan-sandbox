# p16-PROGRESS · 批次 2 门禁与流程口径（施工棒）

日期：2026-09-12 ｜ 执行：施工棒（p16） ｜ 状态：**M1 完成停等验收**（M2 待 M1 验收后开工）

前置：R-A 已验收（268/270，判据计分在 p15；commit 链 2d99a13→1536ec6→7bf650b→572088b→3144452→a1f7f1d→c65d66a）。

## M1 · 清单与机制件

### 1. 万物分类清单 v2 冻结（docs/specs/万物分类清单-v2.md 新建，v1 全文保留不动）
- **Q0-3**（拒收门第三问）：「结果是否随实例变化？恒定即拒收（reason=tautology）」——S1 B3①落地；一夜狼「首夜平安」类命题 v2 起源头拒收（v1 期 30 条已 tautology=1 标记隔离，账本不删）。
- **L3 第 2 问二元化**（S1 B6）：衰减比 ≥1.5 倍或公开文献载明时界→「是」；无数据→「未知」降 L2；**预注册阈值 1.5，可被首批数据校准**。
- 走通示例改写为 v2 口径（气温题 Q0-3+L3 文献时界口径重走）+新增 tautology 拒收反例；checklist_hash=**v2**；版本与修订节记 v2 依据。

### 2. design 防线合并（docs/specs/2026-09-11-万物可预测性审计器-design.md §6.1 后追加注记，原文不改）
- **【合并更正 2026-09-12】**：§6.1 第 2 条（每期单一题型招募窗口）与第 5 条（单一 layer 月占比≤60%）合并为**「窗口类型×layer 配额联动表」**单一规则——窗口=行、layer 配额=列；给出天气/统计类窗口（L2+L5 主粮，L6≤30%）与对局结构类窗口（L6≤60% 延续 Goodhart 上限）两行示例；重言排除（Q0-3）不入配额统计；检测仍为两个月报，不再分别独立生效（S1 B3②「单窗口开 L1 时其占比上限即为该窗口配额，不再矛盾」）。

### 3. verdicts runId 通道（R-A 后解冻件，additive）
- **routes/verdicts.js**：POST body 可选 `runId`/`model` 透传 saveVerdict（p13 版写端已支持两列；缺省 NULL=旧调用方兼容）；响应 saved[] 带 run_id/model 回显。
- **judge-runner.cjs**：inject body 带 `runId`（=PREREG-判词重跑-v1.md 冻结 sha256 **前 12 位**，动态计算、排除 `> sha256` 行口径与文件协议一致，文件缺失如实 'prereg-missing'）+ `model='tokenrhythm/glm-5.3-flash'`；--limit 烟测参数沿用 R-A 版。
- **verdicts.test.cjs** +1 用例：POST 带 runId/model → 落库读回+响应回显；缺省 → NULL（旧调用方兼容）。
- **冻结 hash 事实链（如实记录）**：批次 1.5 落盘的 e2609e68（pwsh 口径）不可复算（R-A 回合 _ra-hash2.cjs 反向破解未命中即证据）；R-A 冻结 commit a1f7f1d 记档权威值 **f232e2a546890fab…**；本回合曾误把工作区（被回退污染的 e2609e68 版）改写为又一个 pwsh 口径值 f2d8fb3b，已用 `git checkout --` 恢复 HEAD 权威版并 node 口径复算**精确命中 f232e2a5**（judge-runner runId 动态计算自动=f232e2a54689）。教训=hash 计算禁止 pwsh Set-Content 中转（BOM/CRLF 污染），统一 node 原字节口径。

### 4. 哨兵熔断（p1b/sim/batch-runner.cjs，S1 A4 修法）
- runSentinel 写报告后读回文本：`/WARN/` 命中 → `prog.sentinelWarns=(prog.sentinelWarns||0)+1` 否则清零；**连续 ≥2 → stepLog('STOP: sentinel WARN ×2 — 人工复核门')+saveProg+return**（与 token/llm-fail 熔断同级同形态）；哨兵本体不动（其诚实边界声明完善）。

### 测试与纪律
- node --test **157/157 全绿**（基线 156+1 透传用例；full-run.out 已刷新）
- R-A 产 verdicts 268 行零触碰（本批未跑 judge-runner 全量/未写库）；8787 零接触；禁改件（p12/J/G/INDEX/S2/sim-titles.cjs/predictionsStore.js）未动
- 工作区其他 M/?? 文件（G-合并/S2/INDEX/J/PREREAD/二期 等）=队长亲笔与其他棒产物，未 add 未改