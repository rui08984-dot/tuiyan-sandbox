---
name: anchor-audit
description: 锚点审计：抽查进度锚/交接文档里引用的文件、commit、收据是否真实存在，把"只信盘上文件"从原则变成可执行检查。触发场景：接手长项目前验锚、交接前自检、怀疑代理谎报时核证、锚文件引用了大量路径需批量验证。Use when verifying that a progress anchor or handoff doc's referenced paths, commits, and receipts actually exist on disk before trusting it.
---

# 锚点审计（Anchor Audit）

**核心规则**：锚/交接文档里的每条引用，要么能在盘上找到，要么就是可疑的。本技能给出可执行检查。

## 何时用

- 接手长项目，读锚/交接前先验它引用的东西是否真实存在。
- 交接文档写完自检（零上下文验收的一部分）。
- 怀疑代理谎报（"我建了 X 文件"但 X 不存在）。
- 锚里引用了大量路径/commit/收据，人工核不过来。

## 用法

```bash
node scripts/anchor_audit.mjs <锚或交接.md> <项目根目录> [--json]
```

输出四类判定：
- `OK` 引用存在
- `MISSING` 引用不存在（**红**，必须处置）
- `SKIP` 无法判定（如纯描述性文本）
- `COMMIT-MISSING` 引用的 commit 不在 git 历史里

**退出码**：0=全绿；1=有红（MISSING/COMMIT-MISSING）。

## 识别规则（脚本内实现）

1. **反引号包裹的路径**：`p1b/src/foo.js` → 查 <root>/p1b/src/foo.js
2. **裸路径**：含 `/` 且带已知扩展名（.js/.cjs/.mjs/.md/.json/.ts/.tsx/.out/.log）
3. **commit 短哈希**：7-40 位十六进制 → `git cat-file -e`
4. **收据文件**：`.out`/`.log`/`.json` 结尾且含路径分隔符

**兜底**：直接匹配失败时，按文件名在项目内全库搜（同名多处→报歧义，不判死）。

## 输出格式

```
[OK]      p1b/scripts/corpus-backfill.cjs
[MISSING] p1b/src/foo.js          ← 红
[SKIP]    （描述性文本）
[COMMIT]  44e127d OK
----
总计 42 条引用 | OK 40 | MISSING 2 | SKIP 0 | COMMIT-OK 5
```

## 与 progress-anchor 的关系

progress-anchor 规定"锚即任务书、只信盘上文件"；本技能是它的**可执行检查件**。
- 施工中：progress-anchor 维护锚
- 交接前/接手时：本技能验锚（红项先处置再开工）

## 已知局限（实测 2026-09-13）

**提取精度**：对纯英文路径准确；**中文混排文本里的路径可能被截断**（如 `docs/specs/xxx-design.md` 被截成 `design.md`）。
- 实测：某锚 43 条引用，脚本报 12 MISSING，其中 **7 条是截断噪声、1 条是真红、4 条待核**。
- **用法**：报 MISSING 时人工扫一眼——明显的截断噪声忽略，其余去核实。
- **真红示例**：锚里引用 `tools/_p3_extract.ps1`（临时脚本已删），脚本正确抓出——这正是它的价值。

**commit 校验**：需在 git 仓库根跑（脚本用 `git cat-file -e`）。

## 过度使用防护

小任务（单文件改动、无引用）不需要跑；只在**锚/交接引用了 ≥5 条路径**或**怀疑谎报**时用。
