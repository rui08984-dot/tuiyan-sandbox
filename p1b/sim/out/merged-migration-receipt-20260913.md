# 合并迁移收据 · D-8.1 unknown 入账 ＋ F4 第一阶段

日期 2026-09-13 ｜ 项目 `E:\music player` ｜ 生产库 `p1a-terminal/data/p1a.db`

> **一句话结论**：**G-D2-0 三点验收全 PASS**，`unknown` 现在可以真正入账，`predictions` 1923 行迁移前后**逐行全列逐字节等值**（转储 sha256 完全一致）；但真值隔离目前只是**面级＋契约级**、**不是内核级**——直连生产库仍能读到 `truth_vault`（已作反证如实记录）；**物理分库仍未做**，它仍是 D2 立项的验收前置。

## 0. 边界与合规声明

| 铁律 | 实况 |
|---|---|
| 不接触活服务 | PID 71484（`node src/server.js`，:8787）**未杀、未重启、未改**；启动时间仍为 2026-09-13 01:07:25 |
| 不删 -wal/-shm | 未删；写入仅走正常事务（SQLite 自行管理 WAL） |
| busy_timeout | 所有写连接 `PRAGMA busy_timeout = 15000` |
| BUSY 重试 | phase1 与 phase2 都走指数退避（300ms→9.6s，≤6 次）。**实测 0 次 BUSY**（见 §7） |
| 迁移前快照+sha256 | 每个写阶段单独快照（见 §1） |
| 不改阈值本体 | 未改任何阈值/概率/门槛；`checklist_hash` 未动；`p1b/src/botc` 未动 |
| 测试行不入生产库 | `unknown` 写入验收全部在**副本库**上做（见 §6） |

## 1. 前置快照（SQLite 在线备份 API，WAL 一致态，非文件拷贝）

| 阶段 | 快照文件 | 字节 | sha256 | 完整性 |
|---|---|---|---|---|
| phase1 前 | `.scratch/backup/p1a-pre-phase1-20260913163521.db` | 3,788,800 | `b6d47aa8e7cdead6b75d6729e84f363b6acf2183da08e447c6fbb7a8293258af` | `ok`，predictions=1923 |
| phase2 前 | `.scratch/backup/p1a-pre-phase2-20260913163707.db` | 4,005,888 | `41cec6466bdbb9ce3fd2f6f00eb994d55a224176944c02b41b62be69c6ae6f38` | `ok`，predictions=1923 |

> 用备份 API 而非拷文件的原因：production 的 `-wal` 当时有 4.8 MB 未 checkpoint，直接拷 `.db` 会丢未合并事务。

## 2. 阶段 1（additive，单事务 7 ms）

新增三件，**predictions 既有列零改动**（sql 逐字未变，已断言）：

1. `truth_vault`（真值表）：`prediction_id INTEGER PRIMARY KEY, outcome TEXT, resolved_at TEXT, resolve_note TEXT, created_at TEXT DEFAULT (datetime('now')), source TEXT`。
   从 `predictions` 全量镜像：**1923/1923 行**（含 1238 行已 resolve；未解题 outcome 为 NULL 亦镜像，保证 1:1 可对账）。`source='predictions'` 记来源。
2. `process_roles`（角色表）：4 行 `resolver / scorer / participant / backtest`，`enforcement` **全部 `contract`**、`kernel` 计数 **0**。
3. `predictions_public`（只读题面视图）：19 列 = 题面＋判据＋cutoff＋分层＋engine/gate＋出处；
   **不含** `outcome`/`resolved_at`/`resolve_note`，**且不透传 `evidence_json` 原样**——
   实测 152 行 `evidence_json[0]` 内嵌 `truth_preview`（正是 R2 §2.2 硬伤 1 所述），故视图只 `json_extract` 出 `[0].resolve`（判据）与 `[0].cutoff|meta.cutoff`（cutoff）两个安全子字段。
   实测：1923 行，`cutoff_at` 非空 1451、`resolve_spec` 非空 1473，**真值列 0 个**。

**真值对账（production）**：`vault_rows=1923, missing=0, orphan=0, 真值列 diff=0` → `ok=true`。

> ⚠️ 对账口径的诚实边界：`truth_vault` 是**一次性镜像**，本轮**没有**任何双写/同步钩子——之后 `resolvePrediction` 只写 `predictions`，vault 不会自动跟随。**新结算题的 vault 同步是 D2 的活**（与物理分库一起做）。收据在此显式记下，避免把"当下对账一致"误读成"永远一致"。

## 3. 迁移前后 `sqlite_master` 对照（pre = phase1 快照，post = 现库）

```
objects_before = 18   objects_after = 21
added   = [table process_roles, table truth_vault, view predictions_public]
removed = []                      ← 零删除
changed = [predictions]           ← 仅此一表定义变更
unchanged = 17 个对象（games/events/claims/actions/... 全部逐字未动）
```

`predictions` 的定义变更**只有一处**（严格判据见 §5）。

## 4. 阶段 2：标准 12 步法单事务重建 `predictions`（32 ms，0 BUSY）

步骤落点（脚本 `phase2`）：①事务外 `PRAGMA foreign_keys=OFF` → ②`BEGIN EXCLUSIVE`（`busy_timeout=15000`＋指数退避） → ③先在事务外抓全量索引/触发器/依赖视图声明 → ④`CREATE TABLE new_predictions` → ⑤`INSERT INTO new_predictions (全列) SELECT 全列 FROM predictions` → ⑥`DROP TABLE predictions` → ⑦`ALTER TABLE new_predictions RENAME TO predictions` → ⑧重建 3 个索引（原文照抄） → ⑨重建依赖视图（原文照抄） → ⑩`PRAGMA foreign_key_check`（非空即 throw 回滚） → ⑪`COMMIT` → ⑫`PRAGMA foreign_keys=ON`。

### 逐项重建 / 等值校验（12 项全绿）

| # | 校验项 | 结果 |
|---|---|---|
| 1 | 行数 | before 1923 = after **1923** ✅ |
| 2 | 逐行全列转储 sha256 | `4bd8f607cc299862a7e4f1dace0b9005fa5df39781c01001a9a4239b24495ce0` 前后**完全一致** ✅（1,835,622 B 逐字节相同） |
| 3 | 逐行 manifest sha256（id＋行哈希） | `dae6579584d1e150d66f38cb1aea1b955966db876e3950b25054f3459dc10185` 前后一致 ✅ |
| 4 | 列签名（`PRAGMA table_info` 名/类型/notnull/默认/pk） | 完全一致（21 列） ✅ |
| 5 | 索引 | 3 个（`idx_predictions_game`/`idx_predictions_open`/`idx_predictions_cp_dedupe`）原文逐字一致 ✅ |
| 6 | 触发器 | before/after **均为空**，一致 ✅ |
| 7 | 依赖视图 | 原文逐字一致 ✅ |
| 8 | 外键声明 | `game_id → games(id)` 一致 ✅ |
| 9 | 全库视图清单 | 一致 ✅ |
| 10 | `PRAGMA integrity_check` | `ok` ✅ |
| 11 | `PRAGMA foreign_key_check` | 悬空 **0** 条 ✅ |
| 12 | 语义 diff 只动 layer CHECK | ✅ 见 §5 |

## 5. 「只放开了 unknown，没动别的约束」的严格证据

原表 DDL 由历史 `ALTER TABLE ... ADD COLUMN` 追加过列，末行合并 → **原始文本**换行位置与新 DDL 不同（这是格式差，不是语义差）。
判据取**归一化后恰好等于「在 primary layer CHECK 内插入一处 `,'unknown'`」**：

```
归一化(空白折叠 + RENAME 后表名引号还原) 后：
  normalized_after 删除首次出现的 ",'unknown'"  →  ===  normalized_before   （true）
  插入点落在 layer CHECK 子句内（site >= start && site < end）              （true）
  normalized_after 中 'unknown' 字面出现次数                                （1）
```

```diff
- layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6')),
+ layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6','unknown')),
  secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')),
```

**关于 secondary_layer 的口径**（任务书写「secondary 允许 L1-L6；primary 允许 L1-L6+unknown」）：实现按此**字面执行**——primary 放开 unknown，**secondary 仍限 L1-L6**。理由是 `unknown` 作 secondary 不携带信息（"没有第二层"用 NULL 表达即可），且这与**已上线的 `intake_questions` DDL 同口径**。若原意是两张表都要放开 secondary，改成 L1-L6+unknown 是一行改动，但会与 intake 侧再次分叉。

## 6. 写入验证：`unknown` 红→绿（**全部在副本库**，生产库零写）

| 场景 | 库 | 结果 |
|---|---|---|
| RED 迁移前 `layer='unknown'` | phase2 快照的副本 | ❌ `SQLITE_CONSTRAINT_CHECK: CHECK constraint failed: layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6')` |
| GREEN 迁移后 `layer='unknown'` | 现库的副本 | ✅ 接受（id=1939，验完即删；副本用后弃） |
| 迁移后 `unknown` + `secondary='L4'` | 同上 | ✅ 接受 |
| 迁移后 `layer='L1'` + `secondary='unknown'` | 同上 | ❌ CHECK 拒（secondary 未放开，符合 §5 口径） |
| 迁移后 `layer='L7'` | 同上 | ❌ CHECK 拒 |
| 信息项：`layer='L4'` 作 primary | 同上 | ✅ DB 接受（**L4 禁作 primary 是接题层规则，不是 DB 约束**——如实记录，避免误以为是库级保证） |

## 7. G-D2-0 三点可执行验收（规格 D2 §3.2）

```
① 角色表存在               : PASS  roles=4 contract=4 kernel=0
② predictions_public 可用  : PASS  rows=1923 leaked_columns=[]
③ 回测进程 truth_vault 失败: PASS
   失败原文: {"ok":false,"code":"SQLITE_ERROR","message":"no such table: truth_vault"}
   只读写入拒绝: {"ok":false,"code":"SQLITE_READONLY","message":"attempt to write a readonly database"}
   ATTACH(plain+query_only) 变体: view={"ok":true,"rows":1} forbidden={"ok":false,"code":"SQLITE_ERROR","message":"no such table: truth_vault"}
   ATTACH(URI ?mode=ro) 变体: 不可用（本机 better-sqlite3 未启用 URI 文件名）——如实记录，非静默跳过
反证（诚实项）: {"reachable_from_prod_connection":true,"rows_in_vault":1923}
VERDICT=PASS
```

第 ③ 步怎么做到"必须失败"：回测进程拿到的是**独立 public surface 文件** `.scratch/backtest/predictions-public-surface.db`（1,114,112 B，sha256 `36cfc2b6ee2d8ee7b58c9a170972578471f4e3069234fbabc5e0ffb5815f6af8`）——里面**只有** `predictions_public` 与 `public_surface_meta` 两张表，`truth_vault` **物理不存在**，所以是**内核级**的 no-such-table（不是靠自觉）。同一 `SELECT` 在生产库连接上**会成功**（反证行）。

## 8. 隔离级别：契约级 vs 内核级（诚实说明，请勿读串）

**必须说清楚**：本项目是 **SQLite 单库单进程**，**没有 DB 级角色 / 没有 `GRANT` / 没有内核级权限**。因此：

| 面 | 隔离类型 | 强制力 |
|---|---|---|
| `process_roles` 角色表（4 行，全 `contract`） | **契约级** | 只是**声明**：谁该读什么。任何能打开 `p1a.db` 的进程都**不受它约束** |
| `predictions_public` 视图 | **面级** | 视图本身不含真值列，但**同库内**仍可直接 `SELECT predictions.outcome` 绕过 |
| 独立 public surface 文件（回测进程唯一入口） | **内核级（仅此一项）** | `truth_vault` 在该文件里不存在 ⇒ `SELECT` 必然失败（§7 ③ 实测） |

**残余风险（照实记）**：
1. **契约不是强制**。今天没有任何运行时机制阻止一个进程绕过 `predictions_public` 直读 `predictions.outcome` —— 现有 24 个脚本 + 4 处 `src` 读 `outcome` 的路径**一处都没改**，它们照旧直读，等于都没受本次迁移约束。
2. **直连生产库仍可读 `truth_vault`**（反证行 `reachable_from_prod_connection=true`）。所以本阶段**不能宣称"回测拿不到真值"**，只能说"回测走 surface 文件时拿不到，且角色表声明它不该拿"。
3. **surface 文件是物化快照**，不是活视图。它按批重建；**过期即有泄漏风险的反向风险**（回测跑旧题面）。生产化时应改为每批开跑前重建 + 记录生成时的源指纹（已在 `public_surface_meta` 里落 `rows_fingerprint_sha256`）。
4. **`truth_vault` 无自动同步**（§2 已记）。

## 9. 回滚

**固化回滚脚本**（由 `p1b/scripts/_rollback-template.cjs` 生成，参数已钉死：原始 DDL、期望行数、期望逐行 sha256、迁移前快照路径）：

- 路径：`.scratch/backup/rollback-merged-migration-20260913163852.cjs`（8,764 B）
- sha256：`dde221a221aedbc71b7914481ac81498d57b280dbf832179f84227066bd0ba09`
- `node --check` 通过；默认 dry-run，`--apply` 才写；写入前**再自动快照一次**
- 两种粒度：`--to phase1`（只回退重建，保留 F4 三件）/ `--to pre`（连 F4 三件一起撤）
- 安全闸：若现库已存在 `layer='unknown'` 行，**拒绝回滚**（旧 CHECK 容纳不了）并给出处置指引 —— 本次回滚排演时现库 unknown 行数 = 0，闸门未触发

**在副本上实排（`--to pre`，未碰生产库）**：

```
rows=1923  rows_ok=true
dump_sha256=4bd8f607cc299862a7e4f1dace0b9005fa5df39781c01001a9a4239b24495ce0  dump_sha256_ok=true
  ← 与迁移前逐行转储 sha256 完全一致：回滚回到的是**逐字节相同的从前**
integrity=ok   fk_check_errors=0
layer_check_unknown_removed=true
unknown_insert_after_rollback={"ok":false,"code":"SQLITE_CONSTRAINT_CHECK",
  "message":"CHECK constraint failed: layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6')"}
f4_objects_left=[]   dropped_f4=[predictions_public, truth_vault, process_roles]
ROLLBACK=PASS
```

> 第一版排演时这一格拿到的是 `SQLITE_READONLY`（探针跑在只读连接上）——**那是错的证据**（失败原因不对）。已改为用可写连接探测，现在拿到的是真正的 `CHECK constraint failed`，才算证明"旧 CHECK 回来了"。

**灾难恢复（备份路径，文档化）**：直接恢复 `p1a-pre-phase1-20260913163521.db`（sha256 `b6d47aa8…`）。此路径需要先停 PID 71484（本轮**未执行**，也不建议在服务存活时做）。

## 10. 代码改动

| 文件 | 改动 |
|---|---|
| `p1b/src/db/intakeStore.js` | 新增 `SCHEMA_PROCESS_ROLES`／`PROCESS_ROLE_SEEDS`／`SCHEMA_TRUTH_VAULT`／`PREDICTIONS_PUBLIC_SQL`；新增 `ensureF4Surfaces()` 并挂进 `ensureIntakeTables()`（幂等 additive，服务下次启动自动补建）；更新 F13 状态注释为「接题层＋入账层已闭环，物理分库仍未做」 |
| `p1b/src/db/predictionsStore.js` | 抽出 `predictionsTableDdl(tableName)`（重建换名复用同一定义）；`layer` CHECK 放开 `'unknown'`（建表 DDL ＋ `AUDIT_COLUMNS` ALTER 路径）；新增 `PRIMARY_LAYERS`（导出 `LAYERS` **仍为 L1-L6，未变**，测试断言不受影响）；`assertAuditFields` 的 layer 用 `PRIMARY_LAYERS`、secondary 仍用 `LAYERS` |
| `p1b/scripts/merged-migration.cjs` | **新**：`snapshot/phase1/phase2/recheck/verify/unknown-accept/master-diff/rollback-script` 八个子命令，默认 dry-run |
| `p1b/scripts/gd2-0-accept.cjs` | **新**：G-D2-0 三点验收 + 反证 |
| `p1b/scripts/_rollback-template.cjs` | **新**：回滚脚本模板（生成物落 `.scratch/backup/`） |
| `p1b/test/f4-surfaces.test.cjs` | **新**：5 个用例（角色表／truth_vault 形状／视图不泄露真值／unknown 可写入／truth_vault 对账一致） |
| `p1b/test/predictions-audit.test.cjs` | +1 用例：unknown 可写入、secondary=unknown 与 L7 仍被拒 |

## 11. 测试

`cd p1b && node --test`（重定向落盘，未接管道）：

```
基线（改动前）: tests 198  pass 198  fail 0  exit 0
本次（改动后）: tests 204  pass 204  fail 0  exit 0   ← +6（5 新文件 + 1 追加），零回归
```

## 12. BUSY 报告

- `phase1`：`busy_retries=0`，事务 7 ms。
- `phase2`：事务 32 ms，**0 次 BUSY**。诚实说明：phase2 实例执行时脚本**尚未**加 `withBusyRetry` 包装（当时依赖 `busy_timeout=15000`）；因全程无 BUSY，行为与补齐后等价。补齐后两个阶段都走退避重试（300ms→9.6s，≤6 次）。
- 另有一次真实 BUSY 相关观察：无。全程未强杀任何进程、未删任何 `-wal`。

## 13. 明确未做（留给 D2 立项）

**物理分库：仍未做。** 具体指，把真值列从 `predictions` 物理剥离到独立库/表、改造那 **24 个读 `outcome` 的 `p1b/scripts/*.cjs`＋4 处 `p1b/src`**（`predictionsStore.calibration/l0Gate/listUnresolved`、`routes/audit.js`、`routes/predictions.js`、`routes/verdicts.js`、`adapters/avalon.js`）——**一处未改**。

本轮做的是 **F4 第一阶段**（additive 真值表＋只读题面视图＋角色表＋G-D2-0 三点验收），也就是 R2:164 最小可逆序的第 ①②③ 步；第 ④ 步（物理分库）按 D2 §3.2 与 R2 §2.2 的结论**推迟到 D2 立项时作为其验收前置**。**本收据不宣称 F4 已全修。**

## 14. 顺带核实到、但**本轮故意不改**的一项既有瑕疵

`intakeStore.insertIntakeQuestion` 用 `INTAKE_LAYERS`（含 `'unknown'`）校验 `secondaryLayer`，而 `intake_questions.secondary_layer` 的 CHECK 只允许 L1-L6 —— 实测传 `secondaryLayer:'unknown'` 会**通过 JS 校验、再被 SQLite 拒**：

```
{"accepted":false,"code":"SQLITE_CONSTRAINT_CHECK",
 "message":"CHECK constraint failed: secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')"}
```

调用方拿到的是 500 级 SQLite 错，而不是干净的表单校验错。**未在本轮修**：它是迁移前就存在的独立瑕疵，修它会动接题层行为、扩大本次高风险迁移的爆炸半径（R2 全篇的教训就是别扩半径）。建议 D2 顺手改成独立的 `SECONDARY_LAYERS = ['L1'..'L6']`。**记录在此，不是遗漏。**

## 15. 证据文件清单（sha256）

| 文件 | 字节 | sha256 |
|---|---|---|
| `.scratch/merged-migration/phase1-evidence.json` | 3,205 | `85f4716f28b88219524de837ae72de3936f5dab517ca8e29e42b9fad86d979fc` |
| `.scratch/merged-migration/phase2-evidence.json` | 15,965 | `2630058a6dd870d36893b41967730ed0dfabe2b265473d91a9be62d9d61c2363` |
| `.scratch/merged-migration/gd2-0-evidence.json` | 4,081 | `0a6ddfe3c3945ff0b74abe39d9de010105fb112348169618e8887f9b507728ef` |
| `.scratch/merged-migration/unknown-accept-evidence.json` | 2,201 | `21cd71ef5d28d650a307e8b997d93428efc92d9596bd47fde23abe2972bfd198` |
| `.scratch/merged-migration/master-diff.json` | 3,004 | `d0473ce7f145a97a17ebde3b1eea9ac02b260063bedb8a3ae64e74bf2016ef22` |
| `.scratch/merged-migration/rollback-evidence-pre.json` | 938 | `cd6eefd4a896e80a5c709ae8d504d5b60fd153e99850f4a2fb7da80270163b13` |
| `.scratch/merged-migration/predictions-before.jsonl`（= after，逐字节相同） | 1,835,622 | `4bd8f607cc299862a7e4f1dace0b9005fa5df39781c01001a9a4239b24495ce0` |
| `.scratch/merged-migration/predictions-before.manifest`（= after） | 133,503 | `dae6579584d1e150d66f38cb1aea1b955966db876e3950b25054f3459dc10185` |
| `.scratch/backtest/predictions-public-surface.db` | 1,114,112 | `36cfc2b6ee2d8ee7b58c9a170972578471f4e3069234fbabc5e0ffb5815f6af8` |

（`.scratch/**` 不进 git；需要长期留档时应把上面这些 json/db 复制进 `p1b/sim/out/`。）

## 16. 复现命令

```powershell
# 0) 只看计划（零写入）
node p1b/scripts/merged-migration.cjs phase1 --db p1a-terminal/data/p1a.db
node p1b/scripts/merged-migration.cjs phase2 --db p1a-terminal/data/p1a.db

# 1) 事后只读体检（F4 三件 + layer CHECK + 真值对账 + 完整性）
node p1b/scripts/merged-migration.cjs verify --db p1a-terminal/data/p1a.db

# 2) 迁移前后 sqlite_master 对照
node p1b/scripts/merged-migration.cjs master-diff --db p1a-terminal/data/p1a.db --pre .scratch/backup/p1a-pre-phase1-20260913163521.db

# 3) G-D2-0 三点验收（含反证）
node p1b/scripts/gd2-0-accept.cjs

# 4) unknown 写入红/绿（副本库）
node p1b/scripts/merged-migration.cjs unknown-accept --db p1a-terminal/data/p1a.db

# 5) 测试
cd p1b; node --test
```

## 17. 验收状态

| 项 | 状态 |
|---|---|
| truth_vault additive 建表 + 真值镜像 | ✅ 1923/1923，对账 ok |
| predictions_public 只读题面视图 | ✅ 19 列，真值列 0，truth_preview 无泄漏 |
| G-D2-0 ①角色表 ②视图可用 ③回测读 truth_vault 失败 | ✅ 三点 PASS，失败原文已落 |
| layer CHECK 放开 unknown（12 步法单事务） | ✅ 逐行全列等值 + 索引/触发器/FK 逐项重建 |
| 生产库快照 + sha256 + 回滚脚本 | ✅ 双快照；回滚脚本已生成并在副本上实排 PASS |
| 测试不回归 + 新断言 | ✅ 204/204（基线 198） |
| 契约级 vs 内核级隔离诚实说明 | ✅ §8，含 4 条残余风险 |
| 物理分库 | ❌ **仍未做**，D2 验收前置 |





