# 查阅 B · 盘上实证报告（2026-09-13 15:2x–15:5x 快照）

> 角色：推演沙盘专家研讨会「查阅 B 棒」。职责＝不联网，纯用盘上代码＋数据库＋git 历史实证核查项目声称。
> **反编造门**：每个数字带 SQL/命令原文；本件零转引未核数字。

## §0 实证范围声明

- **工作区**：`E:/music player`（git 仓，HEAD 在本会话开始时＝0ff3efa，结束时＝34f98f5）。
- **数据库**：`E:/music player/p1a-terminal/data/p1a.db`，全程 `new DatabaseSync(path, {readOnly:true})`（node:sqlite，node v24.19.0）。**零写库**。
- **进程**：`node p1b/scripts/g2-report.cjs`（其自身声明句柄只读·纯 SQL·零写库，与实码一致：`new DatabaseSync(DB_PATH, { readOnly: true })`，无 --json/--text 参数时不落盘）；`node .scratch/r2/probe-f16.cjs`（R2 同款 `:memory:` 探针，不碰 p1a.db）；`node --test`（9 个测试文件全部 `dbPath: ':memory:'` ＋ `app.inject`，不起真端口，**未触碰 8787**）。
- **git**：只读命令（log/status/show/diff/numstat），零写操作。
- **⚠ 移动靶声明**：本会话进行中，并行②抽检棒连续落了 3 个提交：c948d3d（15:26:55）、**7ee6897（15:30:19，G2 门首达 PASS）**、34f98f5（15:40:45 阶段3转正）。本报告数字以 **2026-09-13 15:40 左右**为界；此前的"门 pending"表述已被 7ee6897 更新为"门 PASS"。
- **禁改声明**：除本报告外零文件写入。

## §1 R4 门距复算表（声称 vs 复现 vs 判定）

行域说明：施工路径 §1 的数字是 **1503 快照**（语料扩量 a48cfba 之前）实测；89fc7fd 之后总题变 1923。

| # | 声称（来源） | 我的复现（SQL/命令原文） | 判定 |
|---|---|---|---|
| 1.1 | 总题数 **1923**（a48cfba） | `SELECT COUNT(*) n FROM predictions` → **1923** | ✅ 一致 |
| 1.2 | tautology **30**（施工路径 §1） | `SELECT COUNT(*) n FROM predictions WHERE tautology <> 0` → **30**；30 条全部无 evidence[].kind（sim 行）且 0 条有 resolve.date（`rd_bykind` 探针）→ **不进 ① 池、不扣任何 R4 数字** | ✅ 一致 |
| 1.3 | 合格池 **1473**＝1503−tautology（施工路径 §1） | 旧公式现值：checklist_hash 空值 0 ⇒ 1923−30＝**1893**；R4 ①（细则 B 口径，g2-report 实跑）＝**1046**。**1473 已过期**（系 1503 快照值；1473 现在恰等于"带 kind 的行数"＝1923−450 sim，属巧合不同集） | ⚠️ **过期，勿再引用** |
| 1.4 | horizon 三层 **617/66/21**（施工路径 §1，按 evidence.resolve.date−created_at） | 同公式现值（全 1923 行，干净分桶，负值单列）：`SELECT rd, substr(created_at,1,10) …` 计算得 **neg 521 / short 427 / mid 77 / long 21**（无 rd 877 行）。**长 21 ≥10 仍满足**；617→948 只是把负值并入短桶的算法差 | ⚠️ 过期但结论不变（长桶 21 稳定） |
| 1.5 | ③ R4 正式读数 短419/中77/长21、长∩最难 18（85.7%）、严格独立长 3（design §4.2.1＋0ff3efa "③PASS"） | 复跑 `node p1b/scripts/g2-report.cjs` → `[③] 短 419 \| 中 77 \| 长 21 \| 未知 0 \| past_or_negative(backfill) 529 \| 长中 backfill 0`；`⑦披露: 长∩最难 18/21 = 85.7%`；`严格读法对照：独立长 3 -> FAIL`（细则 A 读法 PASS，两读法留档与 design §4.2.1 逐字一致） | ✅ 一致 |
| 1.6 | ① **1046**（0ff3efa；design D-2 "合格题池现 1,046"） | g2-report 实跑 → `[①] PASS 值 1046（resolved 198；realtime 517 / backfill 529）`；独立拆分：realtime 517＝cutoff_snapshot 17＋forward_batch 98＋b3_forward 32＋oct_forward 34＋wide_forward 165＋b4_forward 171；backfill 529＝backfill_snapshot 96＋b3_backfill 37＋wide_backfill 225＋b4_backfill 171；by_layer＝**L3 724 / L2 322（仅两层）**；排除项 no_resolve_date 877、cutoff_not_before_event **0**、tautology 0 | ✅ 一致（但见 §2.4 恒真性警告） |
| 1.7 | ② pending（0ff3efa）→ **②100%（7ee6897 "门首达 PASS"）** | 收据在盘 `p1b/sim/out/g2-audit-r4.json`（c948d3d 落盘、7ee6897 重写）：`items n=105, scored=105, ok=105, rate=1.0`；`meta.review_composition＝{machine:105, agent_semantic:105, human_calibration:14, user:0}`；`human_calibration`：**pre_fix 一致率 5/14＝0.357（<90% 不采信）→ 修正 machine 段（改按已注册 kind 契约）后 14/14 ⇒ 恢复采信**；`honesty`：非全人工、端用户 0 题、校准样本偏最易分歧处 | ✅ 数字复现；**证明力警告**见 §6 |
| 1.8 | ④ **808**＝realtime 443＋backfill 365（0ff3efa/design D-1） | g2-report 实跑 → `[④] PASS 值 808（realtime 443 / backfill 365；外生解析覆盖 933/1046；模式 {"pct_share":933}）` | ✅ 一致 |
| 1.9 | 已到期未结算 **262 条**（R2 §2.1 硬伤 3；任务背景沿用） | `SELECT COUNT(DISTINCT p.id) … outcome IS NULL AND json_extract(e.value,'$.resolve.date') < date('now')` → **433**（wide_backfill 225 ＋ **b4_backfill 171** ＋ b3_backfill 37）；matures_at 口径同为 433。**daemon 未结清**（09babe9/a38c33a 自认"积压433"、0ff3efa"新 kind 取数函数"棒在途；corpus-resolve.cjs 未提交 +358 行即此工作）。"结清602->704"指的是 resolved 总数 602→704，不是积压清零 | ❌ **262 已过期，实际 433 未结** |
| 1.10 | checklist_hash 空值 **0**（R2 §3A） | `SELECT COUNT(*) n FROM predictions WHERE checklist_hash IS NULL` → **0**；分组 v2 1681（resolved 462）/ bf1 152（152）/ v1 90（90） | ✅ 一致 |
| 1.11 | public_exposure NULL **879**（R2 N2；223c93c 称补 publicExposure:0） | `SELECT COUNT(*) n FROM predictions WHERE public_exposure IS NULL` → **仍 879**，kind 分布与 R2 N2 逐条相同（wide_backfill 280/wide_forward 183/forward_batch_b2 136/forward_batch 112/**oct_forward 69**/b3_backfill 52/b3_forward 47）。223c93c（15:51 时点核对）只改了 **4 个脚本**（见 §2.3）供未来行使用；**历史 879 行从未回填**。oct 69 行落库于 2026-09-12 18:13（早于 223c93c 提交时间 09-13 14:51），系旧 store 静默丢字段所致，其后仅回填过 checklist_hash。修复后落库的 b4 420 行（09-13 07:12）public_exposure 全部非空 ✅ | ⚠️ N2 数据面**原样未修**（脚本面已修） |
| 1.12 | baseline_brier **0 行**（R2 N1） | `SELECT COUNT(*) n FROM predictions WHERE baseline_brier IS NOT NULL` → **0**（未变）。④ 已按 g2-report 设计改走 evidence.baseRateNote 外生解析（933/1046 可解析） | ✅ 一致（旁路已建） |
| 1.13 | g2_regime＝'R4' 全 **1923** 行（89fc7fd） | `SELECT g2_regime, COUNT(*) n FROM predictions GROUP BY g2_regime` → **R4×1923，无其他值** | ✅ 一致 |
| 1.14 | matures_at 非空 **1046**（89fc7fd） | `SELECT COUNT(*) n FROM predictions WHERE matures_at IS NOT NULL` → **1046**；range 2024-01-01..2026-10-30。**与"有 resolve.date 的行集"完全相同**（两口径都 1046，kind 分布逐条同）；backfill 529 条 **matures_at 全部＝resolve.date（事件日）**（eq 529 / neq 0） | ✅ 一致（恒真性警告见 §2.4） |
| 1.15 | 迁移 21 列＋快照 sha256（a38c33a） | `PRAGMA table_info(predictions)` → **21 列**，末两位 g2_regime/matures_at；DDL 在 `p1b/src/db/predictionsStore.js:60-61`（建表）与 :81-82（additive ALTER）。快照 `.scratch/backup/p1a-pre-R4-20260913071354.db`（3,588,096 B）实测 `sha256sum` → `3d1edec03e3f9ba8…6f12`，与留痕 `docs/sandbox/p1b/itest/p19-PROGRESS.md:332`（sha256 `3d1edec0…`）一致 | ✅ 一致 |

**§1 小结**：R4 五条判据的当前读数全部可独立复现；过期的是施工路径 §1 的 1503 快照数字（1473／617·66·21）与任务背景的"262 积压"（实际 433 且未结清）。

## §2 实现在盘核查

### §2.1 verdicts.js 证据块 3.0 —— 真实在盘 ✅

`p1b/src/routes/verdicts.js`（406 行）逐行核：

- **常量**（:97-103）：`EVIDENCE_VERSION='3.0'`、`EVIDENCE_VERSION_2_0='2.0'`、`EVIDENCE_V3_ENV='P1B_EVIDENCE_V3'`、`V3_OFF_VALUES=['0','off','false','no','disabled','none']`、`CONTRADICTION_DETAIL_MAX=6`。
- **d 段实现**（:184-192）：`if (isContradictionEnabled(opts))` → 查 games.game_type → `resolveContradictionFormat()`（:213-218，botc/blood→botc，wolf/狼人→werewolf，否则 null＝不追加）→ `DET.detectWerewolfContradictions({format, events, claims})`（检测器 `p1b/src/detectors/werewolf-contradictions.js`，`RULES=['W1'..'W6']` :122、`detectWerewolfContradictions` :380、`summarize` :390、module.exports :403——**真实接线**，R1-F10 的"未接线"已消）。
- **开关解析**（:201-206）：`opts.contradictions` 显式布尔优先 → env `P1B_EVIDENCE_V3`（OFF 值关闭）→ 缺省开启。关闭或非狼人域 → 不追加 d 段＝"逐字节退回 2.0"路径在码。
- **渲染**（:225-246）：矛盾对数/涉及席位/类型分布＋明细 ≤6 对（超出如实标"共 N 对"）。
- **导出**（:403-404）：三常量导出供测试/消融复用。
- **测试覆盖**：177 绿中含 `loadEvidence 3.0（命题 A）：d 段矛盾对数/涉及席位/类型分布+明细` 与 `消融开关：contradictions:false 与 env P1B_EVIDENCE_V3=0 逐字节退回 2.0 形状` 两用例（见 §3 输出原文）。
- **PREREG 版本声明：已做、但尚未提交**。位于工作区未提交 diff（`.scratch/forecast-debate/PREREG-判词重跑-v1.md`，M 14+/1−）：新增「八、修订记录（R1-F15 · 2026-09-13 增补：纯版本声明）」，声明 3.0＝2.0 三段逐字节不变＋仅末尾追加 d 段、开关口径、字节级对照声明（flag-off 差异 0；默认开启 450 条纯追加）、新全文 hash `d08ca94a…8c25`。**hash 双复算命中**：① HEAD 版除行 3 外 \n 连接无尾换行 → `f232e2a546890fabe5faf04c769b4628295d447faf0b4e5f577da3ec24eeb319`（与文首声明 f232e2a5…eb319 一致）；② 工作区版排除行 3＋排除末行 hash 行 → `d08ca94a7934f2fd6cdec414772fc6cd38812b9f18f898bcd7292fa8fe188c25`（与声明逐字符一致）。

### §2.2 predictionsStore.js F16 守卫 —— **仍是黑名单，非真白名单** ❌（R3 自己也已如实登记）

`p1b/src/db/predictionsStore.js:142-151` 逐行核：

```js
function assertAuditFields(f) {
  const src = f || {};
  const o = {};
  // F16 修（2026-09-13）：未知 audit 键抛错，防命名漂移静默落空        ← 注释声称
  const KNOWN = ['layer','secondaryLayer','engine','baselineBrier','publicExposure','checklistHash','gate'];
  const SNAKE = { layer:'layer', secondary_layer:'secondaryLayer', engine:'engine', baseline_brier:'baselineBrier', public_exposure:'publicExposure', checklist_hash:'checklistHash', gate:'gate' };
  for (const k of Object.keys(src)) {
    if (KNOWN.indexOf(k) !== -1) continue;
    if (SNAKE[k]) throw new Error('audit 字段命名漂移: …(F16 防复发)');   // ← 只抛 SNAKE 命中
  }
```

既不在 KNOWN 也不在 SNAKE 的键（如 `checkListHash`/`gates`/`baselineBrierX`）两个 if 都不命中 → **静默忽略落 NULL**。`:145` 注释"未知 audit 键抛错"与实现不符；f77da71 commit message（在史，`git log --all` 核得："加白名单校验防复发"）同样名不符实。**内存探针复现**（R2 同款 `node .scratch/r2/probe-f16.cjs`，`:memory:` 不碰生产库）：

```
THROWS   | checklist_hash / baseline_brier / secondary_layer / public_exposure（4 个下划线键）✓
NO-THROW | checklistHash(正确) -> id=1
NO-THROW | checkListHash -> id=2 / checklisthash -> id=3 / gates -> id=4 / baselineBrierX -> id=5
落库检查: s6-s9 全部 {"checklist_hash":null,"gate":null,"baseline_brier":null}   ← 静默丢字段实锤
```

与 R2 §3B 的表逐格一致。**223c93c 之后 store 守卫未改**（改的是 4 个脚本，见下）；R3 决策清单 §1 表格其实已如实登记"守卫 ⚠️ 仍是黑名单非白名单"——本核查确认该状态**至今未变**。

### §2.3 4 个语料脚本 —— 已修 ✅（仅对未来行生效）

`grep -n "checklistHash\|publicExposure" p1b/scripts/{corpus-forward,corpus-forward-b2,corpus-forward-oct,corpus-sources-b3}.cjs` → 四处同一行（:344/:301/:498/:660）：
`layer: r.layer, engine: r.engine, gate: 'descriptive', checklistHash: 'v2', publicExposure: 0,` —— 驼峰＋publicExposure 全部在盘。但历史 879 行 NULL 未回填（§1.11）。

### §2.4 g2-report.cjs —— **已 R4 重写**（施工路径路径 5 的"待按 R4 实现"已过时）＋ 两条证明力警告

- 现版头部自述"R4 口径（design §4.2 修订 R4）…纯 SQL 只读·零写库"，实码 `new DatabaseSync(DB_PATH, { readOnly: true })` 与声称一致。R4 五条＋细则 A/B/C/D 全部实装（复核见 §1.5-1.8）。旧 R3 版从未入过 git（`git log -- p1b/scripts/g2-report.cjs` 唯一提交＝c948d3d，即 R4 版首次入库）；旧版备份在 `.scratch/d2/g2-report.r3.bak.cjs`。
- 当前未提交 diff（6+/2−）只是新增"人类校准结账"展示行，不动判定。
- **警告 1（① 的 cutoff 门构造性近恒真）**：backfill 529 条 `matures_at` 全部＝resolve.date（事件日），细则 B 的 backfill cutoff＝matures_at−1 天 < 事件日 **恒成立**；realtime 517 条 created_at（全库 2026-09-11..13）< 未来事件日，同样恒过。实测 `cutoff_not_before_event` 排除数＝**0**。⇒ ① 现阶段实质＝"有锚日期（resolve.date/matures_at）的行数"，cutoff 合规检查对当前数据零筛选力（合规性靠语句自述 cutoff＋Q0 拒收门兜底）。
- **警告 2（① 池只含两层）**：by_layer＝L3 724＋L2 322；L1/L4/L5/L6 贡献 **0**。R4 ①③④ 的全部读数实际只由 L2/L3 天气·人口·开奖类语料构成。

## §3 测试真绿复核 ✅

前置核：9 个测试文件头部铁律声明＋实码均为 `dbPath: ':memory:'`（或 `db.init(':memory:')`）＋ `app.inject`（不起真端口）→ 可安全全量跑。

```
cd "E:/music player/p1b" && time node --test
ℹ tests 177 / suites 0 / pass 177 / fail 0 / cancelled 0 / skipped 0 / todo 0
ℹ duration_ms 1016.4968    (real 0m1.145s)
```

**177/177 全绿、1.0 秒**——与 89fc7fd/b971a8d 声称一致。关键用例在输出中可见：`loadEvidence 3.0（命题 A）：d 段…`、`loadEvidence 消融开关：…逐字节退回 2.0 形状`、`loadEvidence：corpus 型结构化 evidence…不再抛 RangeError（2026-09-13 修 500）`。

## §4 git 链与未提交物清单

### §4.1 提交链（git log --oneline，会话开始时 HEAD=0ff3efa）

任务背景 4 项全部在史且语义与提交信息相符：3e7f140（R4 拍板）→ 223c93c（F16 脚本修复）→ 89fc7fd（g2_regime/matures_at 迁移，"177测试绿"）→ a48cfba（1503→1923）。后续链：5b6f484 → f76cc8e → b971a8d（修 500，177/177）→ 9399422（施工路径）→ 85cc1f5（R3）→ 744f23b（细则）→ 09babe9（R4 首跑 FAIL→根因）→ 2cdfc68（细则 D）→ 0ff3efa（门 pending 只差②）→ **会话中新增**：c948d3d（②收据落盘＋初版一致率 35.7% 不采信＋揪出 machine 段 8 条假阳性）→ **7ee6897（G2 门首达 PASS：②100% 采信 YES；machine 段改按 51 个已注册 kind 契约；残余风险已披露）** → 34f98f5（阶段3转正留痕）。f77da71（F16 store 修复，自称"白名单"）亦在史（`git log --all` 核得）。

### §4.2 未提交改动（15:40 时点，git status --porcelain 非忽略项）

| 状态 | 文件 | 规模 | 判读 |
|---|---|---|---|
| M | `.scratch/forecast-debate/PREREG-判词重跑-v1.md` | 14+/1− | **3.0 版本声明＋新 hash，未提交**（§2.1；冻结件处于"已提交正文+未提交修订"中间态） |
| M | `p1b/sim/sim-loop.cjs` | **670+ / 55−** | 任务背景所称 670 行未提交改动**仍在**（670 恰为插入行数，numstat 实测 670/55） |
| M | `p1b/scripts/corpus-resolve.cjs` | 358+/6− | 新 kind 取数函数移植**在途**（对应 433 积压的结清前置） |
| M | `p1b/scripts/g2-report.cjs` | 6+/2− | 校准结账展示（不动判定） |
| M | `p1b/src/server.js` | 1+/0− | 会话中新出现（并行棒活动） |
| M | `p1b/sim/out/resolve-daemon.due.json` | — | daemon 到期清单刷新 |
| D | `p1b/scripts/_probe-b3{,b}.cjs`、`_probe-b3.raw.json` | −105 行 | 临时探针删除 |
| ?? | `.scratch/backup/`（p1a-pre-R4-20260913071354.db） | 3,588,096 B | R4 迁移前快照，sha256 `3d1edec0…` 与 p19-PROGRESS.md:332 留痕一致 |
| ?? | `.scratch/d2/`（audit-machine.json、audit-review.tsv、g2-report.r3.bak.cjs、make-audit.cjs、probe5-audit.cjs） | — | ②抽检机具工作区＋旧版 g2-report 备份 |
| ?? | `.scratch/_inv_*.cjs`×7、`.scratch/forecast-debate/_acr2-*`、`_v3*`、`probe-v3-*`、`_test-*.out`、`resolve-r4-20260913.{out,err}`、`p1a-pre-f16-backfill.db`、`_p1a_backup_pre_m2.db`（仓库根）、`docs/sandbox/p1b/itest/p2{0,1,2}.db` 等 | — | 各棒临时产物与探针，未清理未入库 |
| ?? | `docs/specs/历史回测引擎-规格D2-20260913.md`、`docs/specs/红队R2-复核-20260913.md` | — | **两份权威 spec 本身尚未入库**（R2 报告、D2 规格） |

## §5 语料 1923 条质量抽查

### §5.1 evidence_json[].kind 分组（SQL：`SELECT json_extract(e.value,'$.kind') k, COUNT(DISTINCT p.id) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.kind') IS NOT NULL GROUP BY k ORDER BY n DESC`）

| kind | n | kind | n |
|---|---|---|---|
| wide_backfill | 280 | forward_batch | 112 |
| b4_backfill | 217 | oct_forward | 69 |
| b4_forward | 203 | b3_backfill | 52 |
| wide_forward | 183 | b3_forward | 47 |
| backfill_snapshot | 152 | cutoff_snapshot | 22 |
| forward_batch_b2 | 136 | （合计） | **1473** |

其余 **450 行无 kind**（sim 判词题：v1 90＋v2-sim 360）。注意 **forward_batch_b2 的 136 条全部无 resolve.date 键**（见 §5.2 末条）。

### §5.2 forward 抽查（outcome IS NULL，Q0-2 cutoff 合规）—— 7 条目检，未见违规

- id=451（cutoff_snapshot/L3，上海 09-14 最高温>35°C）：语句自带 `cutoff=2026-09-12T15:02:08+08:00`（=created_at 前 2 秒）< 事件日 09-14 ✅；`resolve={lat:31.23,lon:121.47,date:"2026-09-14",threshold_c:35,cmp:">"}` 锚齐 ✅；matures_at=2026-09-14。
- id=456/457/458/460（同族上海/北京 09-14..16）：cutoff 均为 09-12 17:21:54+08:00（created_at 前 11 秒），严格早于各自事件日 ✅。
- id=870（forward_batch_b2/L5 大乐透）与 id=1908（b4_forward/L2 Eurostat 2027 人口）：语句均自述 cutoff 落库时点且早于事件（开奖 2026-10-17／2027 年），**但 resolve 对象无 date 键**（dlt 只留 issue/front_max_ge；eurostat 留 url/threshold/cmp/field/year）→ 机器 cutoff 检查不可行，**被 no_resolve_date 排除在 ① 池外**（该两族 136＋35 条正是 877 无 rd 的主体）。属"不可机检"而非"cutoff 违规"；Q0-2 当前只对 1046 池内可机检。
- **结论**：抽 5＋2 条未见 cutoff 晚于事件的 Q0-2 违规；机检池内 cutoff 判据实现与数据一致。

### §5.3 backfill 抽查（truth_preview，R1-F4）—— 152 条原样在库，未修但未恶化

SQL：`SELECT COUNT(*) n FROM predictions WHERE evidence_json LIKE '%truth_preview%'` → **152**（与 R1-F4 一致，未新增：修复后落库的 b4 420 条不带 truth_preview）。其中 `AND outcome IS NULL` → **0**（所有带真值预览的行都是已解行）。

- id=473（backfill_snapshot）：`resolve={...date:"2024-01-01",threshold_c:9,cmp:">"}` 且**同行 `truth_preview=7.7`、`outcome=false`**——R1-F4 的原始例证原样在库。
- id=474：truth_preview=10 / outcome=true（10>9 ✅ 一致）；id=475：truth_preview=6.8 / outcome=false（6.8>9 ✅ 一致）。三条语句均自述"cutoff=事件前一天 23:59:59+08:00，严格早于事件日"，符合 R3④ 口径。
- **结论**：truth_preview 与题面/判据同库共 152 条（全部 bf1、全部已解）——F4"真值物理分库"仍是待办（施工路径 §2 路径 8，与 R2"不应现在做"的裁定一致）；当前未解题 0 条带真值，实盘泄漏面没有扩大。

## §6 给研讨会的"事实底座"一页速览

### ✅ 可直接引用（我已独立复现）
- 账本：**1923 题**；resolved **704**（true 376 / false 328）；未解 1219；tautology 30（不进池）；checklist_hash 空值 **0**（v2 1681/bf1 152/v1 90）。
- R4 迁移：21 列；`g2_regime='R4'`×1923；`matures_at` 非空 1046；迁移前快照 sha256 `3d1edec0…` 已留痕。
- **门读数（g2-report.cjs 复跑）**：① **1046** PASS（realtime 517/backfill 529；L3 724+L2 322；resolved 198）｜③ **PASS**（短 419/中 77/长 21，长全 realtime，长∩最难 18=85.7%，严格读法独立长 3=FAIL 已留档）｜④ **808** PASS（443+365；baseRateNote 解析 933/1046）｜⑤ 月节律仅报告（2026-09 realtime 552/backfill 152）。**② 105/105=100%**（7ee6897 门首达 PASS）。
- 命题 A 接线：verdicts.js 证据块 3.0＋P1B_EVIDENCE_V3 消融开关真实在盘并有测试；PREREG 版本声明已写、hash 双复算命中（**但该修订未提交**）。
- 177/177 测试绿（1.0 秒，:memory:）。

### ⚠️ 引用 ②/① 时必挂的三个证明力警告（数字真实，含金量受限）
1. ② 的 100%：构成=机器 105＋代理 105＋**人类校准 14（队长，端用户 0）**；初版人机一致率 **5/14=35.7% 不采信**，是"按校准意见修正机器段（改按已注册 kind 契约，消除 8 条假阳性）之后"才 105 全过；校准样本偏最易分歧处（文件内已自披露，但"满分"本身应触发审稿警觉）。
2. ① 的 cutoff 合规检查当前**零筛选力**（backfill 529 条 cutoff=matures_at−1 天恒真；realtime 全部 created_at 早于未来事件日；排除数=0）——① 实质＝"有锚日期行数"。
3. ①③④ 池**只含 L2/L3 两层**（L1/L4/L5/L6 零贡献），且 realtime 题全部落库于 2026-09-11..13 两天内。

### ❌ 已过期、勿再引用（声称→现值）
- 合格池 **1473**（施工路径 §1，1503 快照）→ 旧公式 1893 / R4① 1046。
- horizon **617/66/21**（同上）→ 同公式 427/77/21（负 521 单列）；长桶 21 不变、≥10 仍成立。
- 到期未结 **262**（R2）→ **433**（wide_backfill 225＋b4_backfill 171＋b3_backfill 37），**未结清**，daemon 不覆盖新 kind，取数函数移植在途（corpus-resolve.cjs +358 行未提交）。
- "g2-report.cjs 待按 R4 实现"（施工路径 §2 路径 5）→ **已实现并首跑 PASS**（c948d3d/7ee6897）；审议基线应更新。

### 🔴 红队发现现状（未修项，引用数字时须知）
- **F16 守卫仍是黑名单**（R3 已登记；本次源码逐行＋内存探针双重复核确认；`:145` 注释与 f77da71 message 的"白名单/未知键抛错"说法均与实现不符）。
- **public_exposure 879 行 NULL 原样**（脚本面已修、数据面未回填；b4 新行正常）。
- **baseline_brier 仍 0 行**（④ 已用 baseRateNote 外生解析旁路，N1 不再阻塞门）。
- **truth_preview 152 条仍在 evidence_json**（全为已解行；F4 分库未做，未恶化）。

### 遗留流程风险（研讨会应知）
- PREREG-判词重跑-v1.md 的 3.0 修订**未提交**（冻结件双状态窗口开着）；红队R2 报告与 D2 规格两份权威文档**未入库**；sim-loop.cjs 670+/55− 与 corpus-resolve.cjs 358+ 行大改动未提交；各棒临时探针散布 `.scratch/` 与仓库根（`_p1a_backup_pre_m2.db` 在根目录）。

（查阅 B 实证报告完 · 2026-09-13 · 全程只读，除本报告零写入）
