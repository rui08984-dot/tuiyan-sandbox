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

---

# M2 · 数据与口径件（2026-09-12 · M1 验收通过后执行）

## 1. l0Gate 双口径（p1b/src/db/predictionsStore.js）

- 新增 `records_valid`（tautology=0 计数）与既有 `records`（总账）双字段并列输出；**review_unlocked 判定改用 records_valid**（重言灌水不解锁门禁）；gate 文案加「重言式题（tautology=1）不计入门禁」。
- 测试 +1 用例（predictions-audit.test.cjs）：置重言后总账不变/有效口径 −1/文案断言/review_unlocked 仍布尔。

## 2. 模板 v2 --write 落库（R-B 初始语料，事务）

- **sim-templates-v2.cjs 守卫升级**：`--write` 单参数仍 REFUSE（退出码 2，已实测）；必须 `--write --confirm` 显式确认模式（队长授权解除 S1「永不承担落库」守卫，头注释同步改写；dry-run readonly 路径原样保留，Q0-2 自检 PASS 30/30 复核）。
- **落库口径**：12 模板×30 局（gid 8-37）；statement 前缀 `[cutoff=C2·发言结束后/计票前（R-B 主判据时点）]`；**evidence_json=C2 锚前事件 id**（与 R-A 结算证据严格区分）；layer/engine=模板建议值（v2 清单 walkthrough）；checklist_hash=**v2**；X 指派=gid%6+1（与干跑 Q0-3 验证数据同口径）；resolve 程序真值全回填（结算锚写 resolve_note）。
- **落库量（如实记账）**：WRITE_STATS={games:30, templates:12, inserted:**360**, skippedDup:0, ambiguous:0, trueN:206, falseN:154}——高于任务书预期 250-350 上缘（12 型×30 局无重复无 ambiguous 全落）。
- **抽验（game=8，3 条明细）**：evidence=8 条全为 cutoff 前公开事件（夜幕/夜死公告/发言×5/「发言结束」锚 ev#36）；dusk 计票 ev#37 与 system 终局 ev#38 **未混入**（与 R-A 结算证据严格区分 ✓）；statement 前缀/checklist_hash/layer 全符合。
- **l0_gate 双口径复核**：records=450（90 旧+360 新）、**records_valid=420**（450−30 重言 L1）、resolved=450/unresolved=0、**review_unlocked=true**（games=30 ∧ records_valid=420≥200——**门禁状态翻转，重跑条件达成**；报表脚本探索性文案为硬编码属后续批次口径，本批不改）。

## 3. PREREG-RB v1 草案（.scratch/forecast-debate/PREREG-RB-v1-待确认.md，**不冻结**）

- 数据与分组：12 题型×30 局=360 条 cutoff-safe 题；对照锚=**分题型基率下限 b(1−b)**（程序结算真值常数预测器）；R-A 结算证据臂为历史参照不进计分。
- 判据：逐题型逐路 Brier vs b(1−b)，噪声条款 ±0.06；**合并条款=跨 ≥3 不相关题型方向一致**（对齐 T1 跨域要求）；**L1 carve-out=0.5**（L1 题型 impute 用 0.5 不用基率——规则可复算型基率是程序产物无对照信息）；TOST d=0.5；ambiguous 剔除如实计数（实测=0）。
- 四要素追平（sha256 冻结时算+runId 通道+stop-rule≤2+archive-rb-pre）；endpoint=单路 Brier、median 只记账、γ̂ 不得版；多重比较声明（12 型×3 路=36 比较明示探索性+方向预注册）。
- **状态=待确认草案，不冻结**——R-B 判词跑批（360×3 live）待队长批准后执行。

## 4. 测试与 commit

- node --test **158/158 全绿**（157+l0Gate 双口径用例；full-run.out 已刷新）
- commit hash 见 git log「批次2-M2：l0Gate 双口径+模板 v2 落库 360+PREREG-RB v1 草案」（=9aa1a53）

---

# R-B 执行 · PREREG-RB v1 已冻结（2026-09-12 深夜）

## 冻结与撤回留痕

- **冻结 commit 锚=09706e3**「PREREG-RB v1 冻结+hash 记档（ca1b5cdb）」；hash=ca1b5cdbddfc7a3333b827fb453972e5f0c063cfe3f20e089bcc3b91752ed2bb（node 原字节口径排除 hash 行，复算自洽已验证；pwsh Set-Content 中转禁用——p16 M1 教训沿用）。文件名后缀「-待确认」为历史遗留，状态以文件头「已冻结」为准。
- **archive-rb-pre**：R-A 产 verdicts 268 行全列导出 → .scratch/forecast-debate/verdicts-archive-rb-pre-20260912.json（复核回读=268）；run_id 分布全 NULL（R-A 跑批时通道未建，历史事实）。**不清表**：R-B 判词落同一 verdicts 表，批次隔离由 runId 列承担（M1 通道）；R-A 268 行零触碰。

## 烟测记录（2 题×3 路 live，5/6 行实证）

- 烟测题=pred#91（T1）/pred#92（T2）；run_id=ca1b5cdbddfc、model=tokenrhythm/glm-5.3-flash 全部落行。
- **四维度人审（5 行实证）**：①v1 引用 cutoff 前事件 ✓（v#269「事件#30 明确记载：夜1死亡公布为3号」）②结算内容零泄漏 ✓（无「计票：{」「游戏结束」「被放逐出局」原始结算文本；v3 文本「计票前」为 cutoff 口径描述非泄漏）③Range 区间行+末行 P=0.xx 契约 ✓（Range: 2%-8%/70%-88%/52%-64%/60%-84%/20%-45%）④v2 零证据零基率 ✓、v3@L6 含基率背景行 ✓（「n=269 中该判定为真占 58%」——口径注记：v3 注入基率=全账本同型池（混 R-A 结算真值），与判据对照基率（模板型 30 局）不同源，计分报告注明）。
- 第 6 行（v3@92）被单命令 120s 上限截断未落库——同链同构（v3@91 已实证），全量跑批幂等自动补齐（补齐后于计分节复核）。
- 烟测裁定：**通过**（工程无故障）。

## 全量跑批

- 后台作业（pwsh-12）启动：judge-runner 全量（选题 450=R-A 90 幂等跳过仅重算写回+v2 360 生成×3 路）；预计 3-6 小时；errors 落 judge-errors.log；stop-rule=一次跑完禁择优、工程重跑 ≤2 次。
- token 成本记账：烟测 6+全量 ~1074 ≈ **1080 调用**（与任务书预估一致，如实记账）。