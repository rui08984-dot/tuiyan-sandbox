# 原生模块路径登记表 · deps-fix

> 生成 2026-09-30 · 模块 `deps-fix`（SPEC-deps-fix）· **登记不修**
>
> 用途：给 P1 的 `node:sqlite` 迁移留一份**可逐条销账**的清单。
> 迁移做完，`require('better-sqlite3')` 与它的路径问题一起消失，本表整体作废。
> 迁移判据（FTS5 / RTREE / MATH 可用、虚拟表 0 个）已在 SPEC-deps-fix 与看板里核定。

## 这张表是什么

凡是用**拼出来的路径**（硬编码绝对路径 或 `path.join(…,'node_modules','better-sqlite3')`）
去拿 `better-sqlite3` 的地方，都在这张表上。标准的 `require('better-sqlite3')` **不在表内**。

本期（deps-fix）只修了 3 处——`board.cjs` 与 `exp-health.cjs`，
因为它们是 18 条 CLI 的成员，不修则 zip 版验收 A9/A10 直接失败。
其余的**一处没动**：它们不在验收路径上，且正解是 P1 迁移，本期硬清属于治标不治本。

## 口径与数字（可复算）

在仓库根 `E:/music player` 下跑这两条，得到的并集就是本表：

```bash
grep -rnoE "E:[/\\]music player[/\\][^'\"\`)]*better-sqlite3" p1b --include=*.cjs --include=*.js --include=*.mjs
grep -rnoE "path\.join\([^)]*'node_modules', 'better-sqlite3'\)"   p1b --include=*.cjs --include=*.js --include=*.mjs
```

实测（2026-09-30）：

| 类别 | 处数 | 说明 |
|---|---:|---|
| A 硬编码绝对路径 `E:/music player/…` | 34 | ★换机器 / 换用户目录即必坏，比 B 类更脆 |
| B `path.join(…, 'node_modules', 'better-sqlite3')` | 33 | 依赖调用方对 `ROOT` 的假设 |
| **合计** | **67** | 分布在 **62** 个文件 |
| 其中本期已修 | 3 | `board.cjs` 1 处、`exp-health.cjs` 2 处 |
| **登记待迁（余下）** | **64** | |

> ⚠️ **与 SPEC-deps-fix 记的 59 处对不上**（它写的是「29 处硬编码集中在 `scripts/archive/`，
> 30 处 `path.join(ROOT,…)`」，余 57）。本表的 67 是在**写明了上面两条命令**的口径下数出来的，
> 差异来自口径（SPEC 未写明它的 grep 范围；本表额外含 `p1b/test/**` 6 处与
> `p1b/sim/out/**` 生成探针 3 处，且 A 类硬编码在 `archive/` 之外还有 10 处）。
> **以本表的 64 为准**，销账时按本表的路径逐条对。

## ★两处**不是** require 本身，别当成 bug 改

| 位置 | 它其实在干什么 |
|---|---|
| `p1b/scripts/audit-release.cjs:236` | 发行闸 **C4「原生模块可达」**：它**故意** require 发行树里的 `p1a-terminal/node_modules/better-sqlite3`，用来发现「换了机器就崩」。改用解析器会把这个检查变成恒真。 |
| `p1b/scripts/merged-migration.cjs:405` | 给回滚模板 `_rollback-template.cjs` 填 `@@BS3@@` 占位符的字符串。P1 迁移后应随模板一起删。 |

## 逐条清单（余下 64 处）

### 一、`p1b/scripts/archive/` —— 24 处，**全部 A 类硬编码**

`E:/music player/p1a-terminal/node_modules/better-sqlite3`。
归档区零活引用（`p1b/scripts/README.md` 已归档），P1 迁移时按「整目录不再 require 原生模块」销账。

| 文件 | 行 |
|---|---:|
| `p1b/scripts/archive/_b1-backlog.cjs` | 2 |
| `p1b/scripts/archive/_b1-kinds-probe.cjs` | 2 |
| `p1b/scripts/archive/_b1-matures-probe.cjs` | 2 |
| `p1b/scripts/archive/_b1-publicexposure-probe.cjs` | 2 |
| `p1b/scripts/archive/_b1-regime-probe.cjs` | 2 |
| `p1b/scripts/archive/_b11-games-probe.cjs` | 2 |
| `p1b/scripts/archive/_b11-kind-meta.cjs` | 2 |
| `p1b/scripts/archive/_b11-long-dist.cjs` | 2 |
| `p1b/scripts/archive/_b11-recon.cjs` | 2 |
| `p1b/scripts/archive/_b11-resolve-samples.cjs` | 2 |
| `p1b/scripts/archive/_b11-snapshot.cjs` | 5 |
| `p1b/scripts/archive/_bd-backfill-matures.cjs` | 3 |
| `p1b/scripts/archive/_bd-backup-db.cjs` | 5 |
| `p1b/scripts/archive/_bd-decompose427.cjs` | 3 |
| `p1b/scripts/archive/_bd-probe-bf.cjs` | 3 |
| `p1b/scripts/archive/_bd-verify-matures.cjs` | 5 |
| `p1b/scripts/archive/_brn-postcheck.cjs` | 4 |
| `p1b/scripts/archive/_brn-snapshot.cjs` | 3 |
| `p1b/scripts/archive/_r5-batchstats.cjs` | 2 |
| `p1b/scripts/archive/_r5-kinds.cjs` | 2 |
| `p1b/scripts/archive/_r5-pending-stats.cjs` | 3 |
| `p1b/scripts/archive/_r5-samples.cjs` | 2 |
| `p1b/scripts/archive/_r5-target.cjs` | 3 |
| `p1b/scripts/archive/_r5-verify.cjs` | 2 |

### 二、`p1b/scripts/` 在役脚本 —— 30 处（A 类 8 ＋ B 类 22）

A 类（硬编码 `E:/music player/…`）：★这几个是 `_` 前缀的一次性探针/修补件，与 archive 同宗。

| 文件 | 行 | 类别 |
|---|---:|---|
| `p1b/scripts/_b1-matures-audit.cjs` | 3 | A |
| `p1b/scripts/_b1-snapshot.cjs` | 3 | A |
| `p1b/scripts/_b11-resolve-check.cjs` | 4 | A |
| `p1b/scripts/_bd-anchorprobe.cjs` | 3 | A |
| `p1b/scripts/_bd-dateprobe.cjs` | 3 | A |
| `p1b/scripts/_brn-verify-live.cjs` | 3 | A |
| `p1b/scripts/_r5-coverage.cjs` | 4 | A |
| `p1b/scripts/backfill-baserate-note.cjs` | 16 | A |

B 类（`path.join(…)`）：

| 文件 | 行 | 所属 |
|---|---:|---|
| `p1b/scripts/acr-run-llm.cjs` | 17 | `__dirname` 上溯两级拼的 |
| `p1b/scripts/acr-run.cjs` | 17 | `P1A_ROOT` |
| `p1b/scripts/audit-release.cjs` | 236 | ⚠️ **发行闸 C4，故意如此** |
| `p1b/scripts/backfill-base-rate.cjs` | 68 | `ROOT`（函数体内懒 require） |
| `p1b/scripts/backup-offsite.cjs` | 34 | `P1A_ROOT` |
| `p1b/scripts/base-rate-golden.cjs` | 23 | `ROOT` |
| `p1b/scripts/cleanup-g1-dedup.cjs` | 27 | `ROOT` |
| `p1b/scripts/dna-s-backfill.cjs` | 174 | `ROOT`（函数体内懒 require） |
| `p1b/scripts/fix-bug28-cwl-kind.cjs` | 27 | `ROOT` |
| `p1b/scripts/gd2-0-accept.cjs` | 20 | `ROOT` |
| `p1b/scripts/intake-e2e.cjs` | 151 | `P1A_ROOT` |
| `p1b/scripts/intake-ledger-e2e.cjs` | 92 | `P1A_ROOT` |
| `p1b/scripts/kind-table.cjs` | 22 | `ROOT` |
| `p1b/scripts/merged-migration.cjs` | 29 | `ROOT` |
| `p1b/scripts/merged-migration.cjs` | 405 | ⚠️ 模板占位符字符串，非 require |
| `p1b/scripts/prereg-a-archive.cjs` | 18 | `ROOT` |
| `p1b/scripts/prereg-a-bootstrap.cjs` | 27 | `ROOT` |
| `p1b/scripts/rb-attribution.cjs` | 14 | `P1A_ROOT` |
| `p1b/scripts/rc-score.cjs` | 13 | `P1A_ROOT` |
| `p1b/scripts/restore-drill.cjs` | 39 | `P1A_ROOT` |
| `p1b/scripts/sim-templates-v2.cjs` | 18 | `P1A_ROOT` |
| `p1b/scripts/vault-sync.cjs` | 25 | `ROOT` |

### 三、`p1b/src/` —— 1 处

| 文件 | 行 | 所属 |
|---|---:|---|
| `p1b/src/schemaVersion.js` | 36 | `P1A_ROOT`。★**这是服务器侧的**——比 CLI 更该先迁 |

### 四、`p1b/test/` —— 6 处

测试自己造路径，迁 `node:sqlite` 时与被测件同批改（否则测试会先红）。

| 文件 | 行 | 所属 |
|---|---:|---|
| `p1b/test/backfill-base-rate.test.cjs` | 24 | `ROOT` |
| `p1b/test/backup-offsite-drill.test.cjs` | 59 | `path.join(P1B,'..','p1a-terminal',…)` |
| `p1b/test/kind-table.test.cjs` | 20 | `ROOT` |
| `p1b/test/schema-version.test.cjs` | 28 | `P1A_ROOT` |
| `p1b/test/vault-sync.test.cjs` | 20 | `ROOT` |
| `p1b/test/verdicts-leak-gate.test.cjs` | 275 | `__dirname` 上溯两级 |

### 五、`p1b/sim/out/merged-migration/` —— 3 处（**生成件**）

这三个是 `merged-migration.cjs` 产出的探针脚本，**源头改掉即消失**，不必单独销账。
（`p1b/sim/out/` 在 `.gitignore` 里的部分不入库。）

| 文件 | 行 | 类别 |
|---|---:|---|
| `p1b/sim/out/merged-migration/probe-evidence.cjs` | 4 | A |
| `p1b/sim/out/merged-migration/probe-schema.cjs` | 4 | A |
| `p1b/sim/out/merged-migration/probe-view.cjs` | 5 | B |

## 本期已修的 3 处（供对照）

| 文件 | 改造前 | 现状 |
|---|---|---|
| `p1b/scripts/board.cjs` | 48：`require(path.join(ROOT,'p1a-terminal','node_modules','better-sqlite3'))` | 51：`betterSqlite3()`（顶部 14 行 import） |
| `p1b/scripts/exp-health.cjs` | 39：同上 | 42：`betterSqlite3()`（顶部 16 行 import） |
| `p1b/scripts/exp-health.cjs` | 53：同上 | 56：`betterSqlite3()` |

`new D(dbPath, { readonly: true })` 三处**一字未动**（`board.cjs:52`、`exp-health.cjs:43`、`exp-health.cjs:57`）。

## 销账时怎么用

1. 逐条把 `require(path.join(…,'node_modules','better-sqlite3'))` 换成 `require('node:sqlite')` 的等价用法；
2. `audit-release.cjs:236` 的 **C4 不要动**——它检查的就是「发行树里原生模块可 require」，
   P1 迁移后应改成「发行树里 `node:sqlite` 路径可用」或整条删（视发行形态而定）；
3. 三、四类跑各自的测试；五类（生成件）不用管。
4. 全表销完后删掉本文件与 `p1b/scripts/_betterSqlite3.cjs`（届时没有第二个调用点了）。
