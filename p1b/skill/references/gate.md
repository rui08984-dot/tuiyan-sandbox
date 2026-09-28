# 拒收门怎么读：空集、样本量、null

> 本件讲三件最容易读错的事：**拒收门的三问**、**样本量不足时该怎么办**、
> **`p = null` 为什么绝不能显示成 0**。
> 三件事共享同一条纪律：**没测到的东西，必须以「没测到」的形态出现。**

## 1. 拒收门三问的通俗版

判据本体：`docs/specs/万物分类清单-v2.md:6`–`docs/specs/万物分类清单-v2.md:9`。
可执行判定：`p1b/scripts/anchor-gate.cjs`。**本节不新增判据，只翻译成人话。**

```bash
node p1b/cli 门禁 锚点 <候选.json>
```

| 问 | 人话 | 不过的 reason | 出处 |
|---|---|---|---|
| Q0-1 | 到期那天，有个**不靠我、不靠模型**的第三方页面能一比一判真假吗？ | `no_anchor` | `p1b/scripts/anchor-gate.cjs:6` |
| Q0-2 | 我冻结判据那一刻，**答案还没公开**吧？ | `leak` | `p1b/scripts/anchor-gate.cjs:7` |
| Q0-3 | 换个实例，**答案会变**吧？恒定就拒收。 | `tautology` | `p1b/scripts/anchor-gate.cjs:8` |

三问合一在 `p1b/scripts/anchor-gate.cjs:158`：**pass ⇔ 三问全 pass；`unverifiable` 不算 pass，单列。**

### 1.1 「注册 ≠ 可达」

Q0-1 的判定不是「kind 在表里登记过」，而是
「kind 在现役 RESOLVERS 中 ∧（解析器自建 URL ∨ spec 给了 `url`/`url_template`）∨ 显式 certifiedSource」
（`p1b/scripts/anchor-gate.cjs:17`）。
**登记过但没有 URL 的 kind 判 `not_reachable`**——那批题在网络上永远取不到数，
入库只会变成永久欠账。

### 1.2 Q0-3 的两把尺不许混

- **拒收门判据**：基率 ∈ {0, 1} ⇒ `tautology`（`p1b/scripts/anchor-gate.cjs:25`）。
- **产题口红线**：`(0.15, 0.85)`（`p1b/scripts/anchor-gate.cjs:40`）——这是**另一把尺**，
  由 `p1b/scripts/anchor-gate.cjs:170` 单列为 `inBand`、**并列披露、不混判据**。

报读数时两个都要给，但**不许合成一个「合规率」**。

## 2. 分母：候选口径 vs 严格口径

`p1b/scripts/anchor-gate.cjs:214` 同时给两个口径：

- **候选口径**：分母＝已通过的候选。
- **严格口径**：分母＝**提议全集** ＝ `candidates` ＋ `drops`。
  被丢的提议**没有 spec ⇒ 锚不可达** ⇒ 计入未过（`p1b/scripts/anchor-gate.cjs:213`）。

★ 只报候选口径等于报了一个**构造性 100%**——分母里根本没有被拒的题。
**报的时候两个都报，并说清各自的分母。**

### 2.1 候选 0 条 ⇒ 退出码 3

`p1b/scripts/anchor-gate.cjs:209`：候选为空时 `process.exit(3)`。
这是铁律③ 的代码形态：**空集不许被读成「通过」**。
`p1b/cli/index.cjs:278` 把它原样透出，**不抹平成 1**。

⇒ 你在报告里写「过锚率 100%」之前，先看退出码是不是 3。

## 3. `n < 30`：只记方向，不出结论

项目既有准入线是 **`MIN_N = 30`**（`p1b/scripts/stage4-run.cjs:30`；E2 侧同名常量在
`p1b/scripts/e2-r1-rules.cjs:33`，注释明写「不新造」）。判读规则：

```js
if (n >= MIN_N) { …给 Brier / ECE… } else { brief.note = 'n=' + n + ' < ' + MIN_N + ' ⇒ 只报方向、不出 Brier 结论'; }
```

- 分支位置：`p1b/scripts/stage4-run.cjs:209`；
- n<30 的那一支：`p1b/scripts/stage4-run.cjs:265`。

**你该怎么转述**：
- ✅ 「L2 这格 n=22，方向上略优于常数基线，但 n<30 ⇒ 按 K F13 准入线不出 Brier 结论。」
- ❌ 「L2 的 Brier 是 0.2403。」（这格根本没过 30，别处来的数不能挪过来）
- ❌ 「L2 准确率 24%」——**Brier 不是准确率**，两者不同量纲。

### 3.1 格级降档还有第二个理由

E2 的 R1-B 格审计（格 = R1 判定层 × 域）有**两条**降档理由
（`p1b/scripts/e2-r1-rules.cjs:97`）：

1. `n < MIN_N`（样本不足）；
2. **RES CI 下界 ≤ 0**（`relError` 的 CI 跨过 0 ⇒ **无分辨力**）。

⇒ **n 够了也可能降档。** 报「这格可保留」时要说清是过了 n 线、还是过了 RES 线。
回归锁见 `p1b/test/e2-r1-rules.test.cjs:82`（逐格断言降档理由必须是 `n<30` 或 `RES` 之一）。

### 3.2 另一条独立的下限

校准臂用**另一个**阈值：`MIN_N_JUDGE = 100`（`p1b/scripts/calab-run.cjs:42`），
全池题级 n<100 ⇒ **整案降级为探索性**。
⇒ **不同读数件的下限不一样，不要把 30 套到校准臂上。**

## 4. `p = null` 绝不显示成 0

这是本项目**最容易被制造出来的假结论**：一个没算出来的数，在表格里变成 `0.00`，
读者会当成「确实是 0」。三处防线：

1. **格式化层**：`p1b/scripts/stage4-run.cjs:86` 的 `fmt()` 对 `null` / `undefined` /
   非有限值一律返回字符串 **`'n/a'`**，绝不走 `toFixed`。
2. **结构化层**：`p1b/src/evidence/baseRate.js:29` 的纪律——**未知一律 null，禁编**。
   基率字段 `n`（样本量）**允许为 null**（`p1b/src/evidence/baseRate.js:22`），
   「宁缺不编」是写在源码头注里的，不是口头约定。
3. **门禁层**：Q0-2 抽不出 cutoff ⇒ `unverifiable` **单列**，
   `p1b/scripts/anchor-gate.cjs:158` 明写「**unverifiable 不算 pass**」。

### 4.1 报告里的写法

| 情况 | ✅ 写 | ❌ 不许写 |
|---|---|---|
| 引擎没输出 p | `p = n/a（该行无可解析证据）` | `p = 0.00` |
| 基率样本量未知 | `基率 p=0.42，n 未知` | `p=0.42（n=0）` |
| 抽不出 cutoff | `未判定 36 条（gate 不认字段 30／结构性 6）` | `pass 1311`（把未判定折进通过） |
| n<30 | `n=22，方向 X，不出结论` | 报一个 Brier 数字 |
| 比率的分母是 0 | `不可计算` | `0%` |

★ 特别注意最后一行：**`0/0` 不是 0**。`p1b/scripts/g2-audit-build.cjs:56` 的 `wilson()`
在 `n` 为 0 时把 `rate` / `lb` / `ub` 全部返回 `null`；同一件在
`p1b/scripts/g2-audit-build.cjs:147` 判验收时用的是
`calibRate !== null && calibRate >= 0.70`——**先判 null 再比大小**。
你转述时也必须保持这个顺序：null ⇒ 「不可计算」，不是「不达标」也不是「达标」。

## 5. 一句话总纲

**读数件给你的每个数字，都要能回答三句：分母是什么？n 够不够？它是算出来的还是缺省值？**
三句里任何一句答不上来，就**不要把它写进结论**，只写进「待补」。

相关：`forecast.md`（怎么出题）、`leak.md`（未判定的另一种形态）、
`dueof.md`（到期推不出来 = 永久欠账）。
