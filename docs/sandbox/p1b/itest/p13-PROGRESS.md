# p13-PROGRESS · P0 修复 批次0+批次0.5（施工棒 · 微步1）

日期：2026-09-12 ｜ 执行：施工棒（p13） ｜ 状态：**两批完成，停等验收，禁做批次1**

---

## 批次0：git init（完成）

### 改动清单
| 项 | 内容 |
|---|---|
| git init | E:\music player\.git（git 2.55.0.windows.3，此前无仓库） |
| .gitignore | 新建根 .gitignore，任务清单全覆盖（见下） |
| git config | 仅 --local：user.name="DSH Captain" user.email="dsh@local"（全局未动） |
| commit | e9fc345「baseline: L0 收口+三线闭环+评审归档，147/147」 |
| tag | v0.9-l0-baseline |

### .gitignore 覆盖核对
任务清单全命中（git check-ignore 实测）：
- key 保护：p1a-terminal/config/（providers.json）——**双重保险**（p1a-terminal/.gitignore:3 + 根 .gitignore），staged/ls-files 复核 0 命中
- node_modules/、p1b/web/dist/、*.db-wal、*.db-shm
- .scratch/_session_extract/、全文精读/**/cache/、*.zip、assets/bg_video/、botc_acl2026.pdf、.dshwolf/
- 入库侧：.scratch/handoff/ 与 .scratch/forecast-debate/ 的 .md/.cjs 档案已 staged（抽查 G-合并/handoff/全文精读 K 均在）

**追加排除项（超出任务清单，需队长知悉；均为可逆决策，想入库改 .gitignore 即可）：**

| 追加项 | 依据 | 体量 |
|---|---|---|
| /out/、/素材库/、assets/ep01*、assets/covers/、assets/fonts/、*.wav/*.mp3/*.mp4/*.m4a | 媒体大件（最大单文件 571MB mp4），git 不收媒体资产，与 bg_video 同性质 | ~1.5GB |
| /_session_extract/（根） | 与 .scratch/_session_extract/ 同性质的会话原始提取（session.jsonl 15.9MB+36 子会话） | ~44MB |
| .scratch/session-*/、.dsh-session-import/、.dsh-vision-router/ | DSH 运行时会话 jsonl（173.7MB+34.9MB+34.9MB）与视觉路由产物 | ~250MB |
| docs/sandbox/p1b/itest/p7-chrome-profile/ | p7 测试的 Chrome 运行时 profile（Extensions/leveldb） | 25.5MB/314 files |

保留入库：.scratch/qc（3.9MB 质检 DOM 快照）、.agent-teams/archive（0.4MB 团队档案）。

### 批次0 复核证据（本回合新跑）
```
status-porcelain: []            <- 干净
log-count: 1
log: e9fc345 baseline: L0 收口+三线闭环+评审归档，147/147
tag-count: 1  tags: v0.9-l0-baseline
author: DSH Captain dsh@local
tracked-total: 1835
sensitive-tracked (providers.json|chrome-profile|session-*): 0
```
注：mid-flow 发现 untracked「全文精读/二期/cache/」（ignore 规则只盖一级），规则改 全文精读/**/cache/ 后 amend 进 baseline 并重打 tag（本地未共享，安全）；core.autocrlf=false 本地固定。

---

## 批次0.5：重跑前置三件（完成）

### 0.5-1 verdicts 表加 model/run_id（additive 迁移）
**p1b/src/db/verdictsStore.js**（7 处 edit，node --check 通过）：
- 建表 SCHEMA_VERDICTS 增 model TEXT、run_id TEXT（新库直接含）
- 照 predictionsStore.ensurePredictionsTable 先例：VERSION_COLUMNS=['model TEXT','run_id TEXT'] + PRAGMA table_info 检缺列 + 事务内逐条 ALTER（旧行两列 NULL，如实留空不回填）
- rowToVerdict 读回两列（undefined→null）；saveVerdict 写端支持可选 v.model/v.runId（缺省 NULL=旧调用方兼容）；头注释与 @param 同步

**p1b/test/verdicts.test.cjs** 补 2 用例（单跑 verdicts.test.cjs：**10/10 pass**）：
1. 版本戳读写回：saveVerdict 传 model/runId 落库读回 + listVerdictsByPrediction 读模型带出 + 省略时 NULL
2. 迁移模拟：DROP 旧 7 列表重建 → ensureVerdictsTable → PRAGMA 断言两列已补 + 旧行两列 NULL + 迁移后 saveVerdict 可写

### 0.5-2 judge-runner.cjs 修补（5 处 edit，全文 62 行读回核对，node --check 通过；**未实跑**——重跑属后续批次且需预注册）
- L18-21 选题 SQL：SELECT pr.id, pr.game_id FROM predictions pr JOIN games g ON g.id = pr.game_id WHERE g.source = 'sim' AND pr.layer IN ('L1','L6') ORDER BY pr.id —— 语义域过滤（games.source 列由 sim-loop.cjs L74 additive 加出，_counts.cjs/batch-stats.cjs 同款先例），**不硬编码 id 区间**
- L34-45：statusCode 检查后读 r.json().errors 数组，逐条 fs.appendFileSync 到 **p1b/sim/out/judge-errors.log**，JSON 行格式 {ts, pid, prediction_id, variant, error}（errors 元素结构照 routes/verdicts.js L126 实读：{prompt_variant, temperature, error}）
- L49：偶数分支注释「路数<3 时 median 退化为算术平均（2 路=(a+b)/2；0 路 med=null 如实保留 NULL）」
- 头注释补 p13 修补说明；ERR_LOG 常量 + mkdirSync(recursive) 保险

### 0.5-3 旧 assigned_prob 快照（p1b/scripts/snapshot-assigned-prob.cjs 新建，实跑 1 次）
```
SNAPSHOT rows=90 expected=90 -> .scratch/forecast-debate/assigned-prob-snapshot-20260912.json
CHECK row_count=90 OK
```
内容抽验（读回 JSON）：id 1-90 全连续、game_id 8-37（恰为 sim 域，join 过滤当下行为等价、防的是未来增长）、assigned_prob 90/90 非空（0.200-0.900）、resolved 90/90、18.1KB。

### 0.5-4 全量测试（bare 形式：p1b 下 node --test）
```
tests 149   pass 149   fail 0   cancelled 0   skipped 0   fail-marks: 0
```
收据已更新：**p1b/test/full-run.out**（176 行，Tee-Object 全量落盘）。基线 147 → 149（+2 新用例），预期 149+/149+ 达标。

---

## 移交与边界
- **文件库（p1a.db）verdicts 表迁移**未在本回合发生：8787 服务零接触，现有 263 行旧行两列保持 NULL，**下次服务重启时 ensureVerdictsTable 自动 additive 补列**（毫秒级，可空列零风险）。
- judge-runner.cjs 只修未跑；重跑 90x3 属后续批次（须 PREREG hash 先落盘）。
- 批次0.5 改动**未 commit**（批次0 仅要求 baseline commit），工作区 diff 留待验收；涉及文件：p1b/src/db/verdictsStore.js、p1b/test/verdicts.test.cjs、p1b/scripts/judge-runner.cjs、p1b/scripts/snapshot-assigned-prob.cjs（新）、p1b/scripts/_p13-probe.cjs（新，只读探测脚本，sim/_counts.cjs 先例）、p1b/test/full-run.out、.gitignore、快照 JSON。
- 零接触确认：8787 服务 / p1b/web/** / meihua.js / p1a-terminal/src 未改动。
