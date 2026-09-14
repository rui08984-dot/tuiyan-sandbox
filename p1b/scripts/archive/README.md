# p1b/scripts/archive —— 历史一次性探针/修补件（任务 6 批次 3 · 命名整理）

**这里是什么**：2026-09-13 ～ 09-14 各施工棒用过的一次性脚本（探针/修补/拼装件），任务完成后**零活引用**
（全库扫描：无任何在役代码 `require`／调用它们；仅少数历史收据在文字里引用旧路径）。

**为什么归档而不是删除**：这些文件是**证据链的一部分**——各收据（`p1b/sim/out/*.md`）与进度锚
（`docs/sandbox/p1b/itest/p19-PROGRESS.md`）里提到「用什么探针得到的读数」时指的就是它们。
`git mv` 保留了完整历史，随时可查：

```
git log --follow -- p1b/scripts/archive/<name>
```

**为什么不用破坏性改名**：改名会打断收据/文档里的旧路径引用，收益为零。故采用「归档＋目录」：
文件原位搬到本目录，路径映射规则固定为 `p1b/scripts/<name>` → `p1b/scripts/archive/<name>`。

**分类速览**（前缀＝用它的那条线）：
- `_b1-*` / `_b11-*`：批次1／批次1.1（审计字段、matures、regime、public_exposure 探针与修补）
- `_bd-*`：口径 B（月度/年度 date 派生、契约拼装、g2-report 修补）
- `_brn-*`：④ 覆盖补齐（baseRateNote 回填）的核对探针
- `_r5-*` / `_rb-*` / `_rc-*`：语料 r5 批次、判词 R-B／R-C 线的分析件
- `_p4-*`：P4 Metaculus 对表探针（**对应决策仍未决**：token 或换 PolyBench；归档保留）
- `_dparts`：批次1 的拆件目录

**还在 `p1b/scripts/` 原位的下划线文件**（有活引用，勿动）：`_sqlite-guard.cjs`（写连接守卫，被
`gd2-0-accept.cjs`/`merged-migration.cjs` require）、`_rollback-template.cjs`（回滚模板，被 `merged-migration.cjs` 引用）、
以及若干被收据点名的核对探针（`_b1-snapshot.cjs`、`_brn-verify-live.cjs`、`_bd-dateprobe.cjs` 等）。

**在役脚本目录**：见 `p1b/scripts/README.md`（由 `node p1b/scripts/scripts-index.cjs` 生成）。

（归档说明完 · 2026-09-14 · 归档 69 件 · 在役 73 个）
