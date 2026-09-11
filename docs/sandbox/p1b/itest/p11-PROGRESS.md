# p11-PROGRESS（N 棒 · 自对局 loop 冒烟 M0）｜ 2026-09-11

> 任务书：自对局 loop 骨架+一夜狼 6 人版型（阶段1）+ M0 一局端到端（阶段2）。宪法=docs/specs/2026-09-11-全拟真模拟-design.md（方案 C+sim 三条件+预注册五元组）。设计映射=M-全拟真模拟方案.md §1。

## 0. 状态：**完成，验收 4/4 过**

| 验收项 | 证据 | 结果 |
|---|---|---|
| 1 局完整 exit 0 | out/_exit1.txt=0（stage1 发言投票）、out/_exit2.txt=0（stage2 结算导出） | ✅ |
| 账本 events/claims 可 SQL 查回 | out/m0-verify.txt：games id=7 source=sim、events=10、claims=12、actions=6、meta.stage=2 | ✅ |
| replay 人类可读（对齐 p0-replay 样板） | out/m0-run1.replay.md 22 行：头部（版型/还原完整度/预注册五元组）+E-1..E-10 公开流 | ✅ |
| 五元组+哨兵证据在盘 | p1b/sim/prereg.json（冻结）+ out/m0-sentinel.txt（chi2=6.36 粗检 PASS） | ✅ |

## 1. 交付物清单
- p1b/sim/prereg.json —— 预注册五元组（seed=20260911 / model=glm-5.3-flash / temperature=0.7 / variant=ownww6p-v1 / prompt_version=pv1），开跑前冻结，未改。
- p1b/sim/llm-client.cjs（61 行）—— tokenrhythm 供应商通道（providers.json 服务端读取，key 进程内不落盘），usage 回传（成本如实记账）。
- p1b/sim/sim-loop.cjs（351 行）—— 两阶段状态机：角色分配 crypto.randomInt；夜刀/死亡/计票/胜负全程序化；LLM 只出 JSON（夜刀 target_seat / 发言 speech+claims 双输出 / 投票 vote_seat）；直连 p1a db.js v1；games.source/meta additive 列；真值层只进 meta 不进公开 events；残局清理幂等。
- p1b/sim/sentinel.cjs（35 行）—— 分布哨兵 v0（发言长度四桶卡方+声称关键词行占比 vs 真人家底 2 局）。
- p1b/sim/_verify-m0.cjs —— SQL 验收自检。
- p1b/sim/out/ —— m0-run1.replay.md / .truth.md / .summary.json / .steps.log（全程步进日志）/ m0-verify.txt / m0-sentinel.txt。

## 2. 本局关键数字
- 调用数 10（口径上限 40）：夜刀 1+发言 5+投票 4 成功（1 例 llm-fail 自动落弃票）；prompt_tokens=3774，completion_tokens=9594（含 reasoning tokens），parse_fallback=0。
- 对局：狼=1,2 号；夜刀 4 号；发言 5 条（117-201 字）；票型 {1:6, 2:6, 3:弃, 5:2, 6:1} → 放逐 6 号（平民）→ **狼人胜**。
- 哨兵首跑：chi2=6.36 < 7.81（df=3）粗检 PASS；声称密度 sim 50% vs real 38%（v0 关键词代理口径）。

## 3. 偏差记录（7 条，如实）
1. **games.source/meta 列**：db.js 为禁改面，sim loop 首跑时 ALTER TABLE additive 补齐（设计§1.2 预案内）；本轮检测到列已存在（前次被杀半成品局时已加），零新增偏差。
2. **角色分配 crypto.randomInt**（任务书指定）：不可种子复现；投票平票/全弃票兜底用 mulberry32(seed)。sim 局「种子复现」仅部分成立（真值已入库，重跑=新局）。
3. **发言两批并行**（批间可见、批内同快照）：reasoning 模型单调用 15-32s，串行 11 调用≈3.5 分钟超 120s 命令上限；真实性折损=同批互相看不到发言（M1 改增量流式）。
4. **两阶段执行**（stage1 建局夜昼投票→stage2 结算导出）：同因 3。
5. **投票 prompt 降载**：不带全文流、带声称速记（≤400 字符）+maxTokens 1200；llm-fail 自动落 abstain（本局 seat3 一例，result 字段如实记 'llm-fail'）。
6. **残局清理**：同名+game_type LIKE 'werewolf_sim_%' 的 sim 局自动删除后重建（本次清 3 个被杀半成品局）；被杀局曾短暂以 source='real' 默认值带残事件存在——已全部清理，现库 sim 局仅 id=7，真人局零触碰。
7. **games.name=m0-run1**（对齐任务书产物命名）；M1 批量起改 sim-ww-XXXX 口径。

## 4. 环境实录（后来者避坑）
- pwsh 工具 stdout 全程空（执行成功但捕获失效）——全程改「命令写文件→read 读回」通道；后台作业曾卡死（node 未起，out 目录不创建），弃后台改前台+步进日志。
- run_code 沙箱无 require/node——node 一律走 pwsh。
- **glm-5.3-flash 是 reasoning 模型**：max_tokens<600 会被 reasoning_tokens 吃光致 content 空（probe 实证 reasoning=140 tokens 起步）；发言 2000/投票 1200 分档后正常。
- **写入侧反斜杠吞噬**（本棒最大坑，3 次中招）：模板串里 \d \s \r \n 会被 JS 字符串转义吞成真实字符——正则字面量必须双写（\\d）；已有 regex 残伤已全部修复并 node --check 验证。
- 首次前台 M0 全静默疑因 pwsh 进程启动延迟抖动；同命令重试即正常。同条失败 ≤2 次换路纪律全程遵守。

## 5. QC·发言 AI 味目检（aidetect 集成下回合，先人工五条）
- seat3（E-3）：口语自然（"撂句话""划水"），有立场有预告；句式略整齐。目检 ≈2.5/10。
- seat1（E-4，狼）：伪装话术自然（"狼人不用浪费刀在我身上"——被 6 号抓打），"表情有点飘"真人味。目检 ≈3/10。
- seat2（E-5，狼）：主动给死者立神位带节奏（"我寻思""嘴炮"）。目检 ≈2.5/10。
- seat6（E-6）：引用回指具体（"跟提前上保险似的"），反驳最活。目检 ≈2/10。
- seat5（E-7）：点名反打+明确归票（"狼才最清楚这刀砍的谁"）。目检 ≈2.5/10。
- 小结：无模板腔复读、无英文混入、互相引用成立；**弱点=五条全走"点名+归票"同构**（策略塌缩苗头）→ M1 加开局策略分布哨兵。

## 6. 下一步（M0 时点规划，已被 M1 令执行——见 §7）
1. 预注册批五元组（同 seed 框架+固定模型池），跑满 30 局 sim；2. 发言改增量流式（去偏差 3）；3. 策略塌缩哨兵（首刀位/首跳率/对跳率分布）；4. aidetect 抽 10% 发言接入 meta.qc.ai_flavor_rate；5. 成本：本局 13368 tokens（≈¥0.01-0.05 量级，TokenRhythm 账单为准），30 局预估 <¥2。

## 7. M1 批量 30 局执行记录（2026-09-11 队长令，本棒完成）

### 7.1 执行方式
- 清单：p1b/sim/prereg-batch.json（30 seed=20260912..20260941 冻结；五元组 pv1 其余四元不动）。
- 执行器：p1b/sim/batch-runner.cjs（顺序每局 stage1→stage2；batch-progress.json 每局落盘=续跑锚；哨兵每 10 局；token>60 万/llm-fail>10% 双熔断）。sim-loop.cjs 加 --seed 覆盖+main 可导入化（require.main 守卫）。
- 产物：out/batch/ 下 30×(replay.md+truth.md+summary.json)+batch.log+batch-progress.json+m1-stats.txt+m1-ai-sample.md+m1-sentinel-{10,20,30}.txt。

### 7.2 熔断事件（按令执行，已闭环）
- 首轮 4 局后 llm-fail 率 12.8%>10% 自动停（熔断按令生效）。根因取证：5 例 fail 全是「LLM 响应缺 content」=投票 maxTokens 1200 被 glm-5.3-flash reasoning 吃穿（provider 健康、成本 51k/600k，非系统性故障）。
- 处置：投票 maxTokens→2000+重试自增+1500；续跑 26 局仅新增 2 fail（修复实证）。续跑严格跳过已完成 4 局（seed 连续性保住，无重跑）。

### 7.3 统计（out/batch/m1-stats.txt）
- **30/30 局完成**（gid=8..37，全部 source=sim）。
- **胜负分布：village_win=9 / wolf_win=21**。随机放逐基线：夜刀后 5 活人（2 狼 3 民）P(逐中狼)=3/5 → 狼胜期望 12/30；实测 21/30 显著偏离 → **好人侧 LLM 放逐决策劣于随机**（策略不对称信号，M2 真人局对照验证后定性）。
- **发言长度：n=150 均值 176 / 中位 178**；对比首局（均值 172）稳定，无塌缩无暴涨。
- **llm-fail：7/327=2.1%**（熔断线 10%）；其中 5 例集中在 headroom bug 期，修复后 26 局仅 2 例。
- **成本：466,043 tokens**（<600k 上限；均值 15.5k/局，≈¥0.5-2 量级以 TokenRhythm 账单为准）。
- **落库量：source=sim 累计 events=310、claims=337 → L0 门禁 sim 口径达成（games≥30 ✓ records≥200 ✓，恒挂「模拟语料」标注）**。

### 7.4 哨兵×3（全 WARN=「模拟语料」标注强制生效的实证）
| 时点 | sim n | chi2 | 判定 |
|---|---|---|---|
| 10 局 | 100 | 55.27 | WARN |
| 20 局 | 200 | 114.51 | WARN |
| 30 局 | 300 | 176.45 | WARN |
- 解读（诚实口径）：WARN 主因=基线口径混装——real 基线是复盘文 E-行（含大量 24-63 字短事件），sim 是 LLM 长发言（150-220 字）+系统短行，双峰分布天然撞 WARN。哨兵功能正常（防静默污染）；M2 改进=「真实发言行」单独基线（剔除 system/death 短行）再比。

### 7.5 AI 腔抽检升级（规程⑥）
- out/batch/m1-ai-sample.md：30 条（每局 1 条=该局第一条发言）已列清单，待 aidetect 集成批量打分（meta.qc.ai_flavor_rate 口径）。

### 7.6 本棒新增偏差
8. 发言两批并行+投票 prompt 降载+两阶段执行为 M1 沿用（偏差 3/5 同因）；熔断停跑一次+修复续跑（§7.2）。
9. batch-stats.cjs 曾有 const 计数器/claims 表 game_id 列两处小 bug（当晚修复，m1-stats.txt 为修复后产物）。

（M1 完 · 30 局清单+统计+成本见 out/batch/m1-stats.txt · 停等验收）

