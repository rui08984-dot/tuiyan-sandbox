# Spec: deps-fix · 原生模块解析的多候选兜底

> 能力地图模块 id `deps-fix` · 依赖：无 · 规模 0.3 人日
> 它是 `packaging` 的**硬前置**：不修它，zip 版的 CLI 验收（A9/A10）直接失败。

## Objective

让 `board.cjs` 与 `exp-health.cjs` 在**四种不同的目录布局**下都能找到 `better-sqlite3`，而不是只认源码树那一种。

**给谁用**：一个把发行包解压到任何地方的人。
**成功的样子**：18 条 CLI 里的「体检 看板」和「体检 跑批」在源码树里能用，在 zip 里能用，在 `npm install` 之后也能用——**同一份代码，不改调用点**。

## 背景：现在为什么在 zip 里会炸

这两处是 18 条 CLI 的成员，它们这样拿依赖：

```js
const D = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
```

★**这行在源码树里能跑，但它是「猜布局」**：它假定 `node_modules` 一定放在 `p1a-terminal/` 下面。
而打包有不止一种合理布局——按包放、上提到 `app/node_modules/`、或走 `npm install` 落到上提位置。
**猜中一种就够用了，猜不中就炸，而且是运行时才炸。**

## Tech Stack

Node 24 CommonJS · `better-sqlite3`（**版本不动**，P1 才考虑迁 `node:sqlite`）。

## Commands

```bash
node p1b/cli/index.cjs 体检 看板     # 退出码 0
node p1b/cli/index.cjs 体检 跑批     # 退出码 0
cd p1b && node gates/gates.cjs
```

## Project Structure

```
p1b/src/deps.cjs 或 p1b/scripts/_betterSqlite3.cjs   ← 新建：多候选解析器（约 25 行）
p1b/scripts/board.cjs        ← 改：改用解析器
p1b/scripts/exp-health.cjs   ← 改：改用解析器（两处 :39 与 :53）
p1b/test/deps-resolve.test.cjs  ← 新建
```

## Code Style

**只改「怎么找到」，不改「找到之后做什么」。** 两处 `new D(dbPath, {readonly:true})` 的用法一字不动。

## Testing Strategy

1. **四布局各测一次**（用临时目录造，不动真仓库）：
   - 源码树（`p1a-terminal/node_modules/better-sqlite3`）
   - 上提布局（`<root>/node_modules/better-sqlite3`）
   - `npm install` 布局（走标准解析：`node_modules` 在 `require` 链上）
   - **一个都不在** ⇒ 给出可读的人话错误，**不是** `MODULE_NOT_FOUND` 堆栈
2. **反向锁**：把候选列表清空到只剩一个不存在的路径 ⇒ 必须落到「可读错误」那条分支
3. **不空跑**：每个布局的测试都要断言「解析器真的返回了一个构造函数」（`typeof === 'function'`），
   否则「解析成功返回 undefined」也能过

## Boundaries

- **Always**：解析失败时的错误信息要说出**试过哪几个位置**（否则用户无从下手）
- **Ask first**：把 `better-sqlite3` 换成别的实现（那是 P1 的 `node:sqlite` 迁移）
- **Never**：静默 fallback 到某个「大概是这个」的路径后继续跑（宁可报错）

## ★本期的范围只到 2 处，不是 59 处

`grep` 出来的绝对／拼接路径共 **59 处**（29 处硬编码绝对路径集中在 `scripts/archive/`，
30 处 `path.join(ROOT,...)`）。★**本期只修 18 条 CLI 里的 2 个成员**
（`board.cjs:48` 与 `exp-health.cjs:39,53`）——因为**不修它们，zip 版的验收 A9/A10 直接失败**，
其余 57 处不在验收路径上。

**另外 57 处的正解是 P1 的 `node:sqlite` 迁移**（已验证 FTS5/RTREE/MATH 全可用、虚拟表 0 个），
那时它们连同路径问题一起消失。**本期硬清 57 处属于治标不治本**，还会把 25 个 archive 脚本拖进回归面。

⇒ 但**解析器要写成通用的**（导出一个可复用的函数），这样 P1 迁移时那 57 处能一行改完。

## Success Criteria

- [ ] `node p1b/cli/index.cjs 体检 看板` 退出码 0
- [ ] `node p1b/cli/index.cjs 体检 跑批` 退出码 0
- [ ] 四种布局各测一次；一个都不在时给出**列出试过哪些位置**的可读错误
- [ ] **反向锁**：候选清空 ⇒ 落到可读错误分支
- [ ] 测试**非空跑**：断言 `typeof resolved === 'function'`，不只断言「不抛」
- [ ] 源码树里解析结果与今天**逐字节相同**（开发态行为零变化）
- [ ] 四道闸门 exit 0

## Open Questions

- 另外 57 处要不要在本期登记一份清单（路径 ＋ 所属），供 P1 迁移时逐条销账？建议**登记但不修**。

## 【勘误 1 · 2026-09-29】锚点审计报 3 项「失效」属预期

`p1b/scripts/_betterSqlite3.cjs`（或 `src/deps.cjs`）与 `p1b/test/deps-resolve.test.cjs` 是本模块
**新建**文件，尚未创建；`audit_audit` 只查盘上存在性。★**这不是断链，是「还没建」**。
（另 6 项锚点是真实存在的文件与命令，已判绿。）
