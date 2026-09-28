# 泄漏扫描怎么读：三个计数，不是两个

```bash
node p1b/cli 体检 泄漏
node p1b/cli 体检 泄漏 -- --json .scratch/leak/0928.json   # ★ --json 必须带路径
```

R 档只读件，退出码 **0 = 跑完了**。★ **`--json` 是写文件、必须空格分隔、从无布尔式**
（`p1b/scripts/leak-scan.cjs:34` 要求后跟一个不以 `--` 开头的 token；
写成裸 `--json` 会静默不产出，见 `p1b/scripts/leak-scan.cjs:149`）。
**唯一 stdout 直接出机器可读结果的是 `体检 欠账`，不是这件。**

## 1. 输出的三行（照 `p1b/scripts/leak-scan.cjs:136`–`p1b/scripts/leak-scan.cjs:147`）

```
== 全库泄漏扫描（判据同源 gate）==
  库内总题 1994｜有 meta.cutoff 可扫 1368
  pass 1311｜★leak 21｜未判定 36（gate 不认字段 30／结构性 6）
  leak 按 kind：…
  ★gate 不认的字段（单列，未改 gate）：{…}
  结构性无日期（单列）：{…}
```

> 上面的数字是 2026-09-28 在本机跑 `node p1b/cli 体检 泄漏` 的实测输出，**随账本增长会变**——
> 你的报告必须引用**你自己那次运行**的输出，不要抄这里的数。

## 2. 三个计数，逐个定义

计数结构在 `p1b/scripts/leak-scan.cjs:104`（初始化）与 `p1b/scripts/leak-scan.cjs:126`（汇总）。

### pass —— cutoff 早于事件窗口起点

判定只有一行（`p1b/scripts/leak-scan.cjs:121`）：
```js
const cDay = String(meta.cutoff).slice(0, 10);
if (cDay < w) { res.pass++; continue; }
```
`w` ＝ 事件窗口起点，由 `eventWindowStart` 推。**cutoff 严格早于窗口起点 ⇒ pass。**

### ★leak —— cutoff 晚于等于窗口起点

同一行的 else 分支（`p1b/scripts/leak-scan.cjs:122`）：把该行连同
`window_start` / `cutoff_day` / 是否已解 / 题面摘要推进 `res.leak[]`，
并按 kind 累加 `res.by_kind`。

**判据同源 `门禁 锚点` 的 Q0-2**——不是另立一套。所以两件读数不会互相打架。

### ★unverifiable —— **既不是 pass 也不是 leak**

抽不出窗口起点时走这条（`p1b/scripts/leak-scan.cjs:112`–`p1b/scripts/leak-scan.cjs:119`），
并且**分两桶单列**：

| 桶 | 含义 | 触发条件 | 出处 |
|---|---|---|---|
| `unverifiable_unsupported` | **gate 不认这个字段**，但账本里确实有窗口信息 | `GATE_UNSUPPORTED` 表命中 | `p1b/scripts/leak-scan.cjs:73` |
| `unverifiable_structural` | **结构性无日期**（期号→日期要查表） | `STRUCTURAL_NO_DATE` 命中 | `p1b/scripts/leak-scan.cjs:79` |

登记表 `GATE_UNSUPPORTED`（`p1b/scripts/leak-scan.cjs:73`）当前收录：
`resolve.commence_utc`（赔率族开赛时刻）、`resolve.week_start` / `meta.week_start`
（周窗口起点，crossref/nvd）。结构性那张是 `resolve.issue`（彩票期号）。

## 3. ★ 为什么「未判定」不能折进「pass」

这是本件最重要的一条。三条独立理由：

1. **代码里已经分开了**：`p1b/scripts/leak-scan.cjs:137` 把 `未判定` 打成
   **与 pass 并列的第三个计数**，不是 `pass` 的一部分。
2. **它可能藏着 leak**：一条 `resolve.week_start` 的题，**信息是全的**，
   只是 gate 的 `eventWindowStart` 不认这个字段。判它 pass 是放行，判它 leak 是冤——
   所以单列，**等人来判**。
3. **门禁侧同款纪律**：`p1b/scripts/anchor-gate.cjs:158` 写明
   「pass ⇔ 三问全 pass，**unverifiable 不算 pass，单列**」，注释里的理由是
   「我没观测到 ≠ 不存在」。

⇒ 报告里**必须**写成三计数。写「1994 条里 1311 条无泄漏」是错的——
分母应该是 **1368（可扫）**，另外 626 条**连扫都没扫到**（`p1b/scripts/leak-scan.cjs:110` 只取
`meta.cutoff` 非空的行，SQL 在 `p1b/scripts/leak-scan.cjs:98`）。

## 4. 正确写法对照

| ❌ 不许写 | ✅ 该写 |
|---|---|
| 泄漏率 21/1994 = 0.1% | 泄漏率 **21/1368 = 0.0015**（分母＝可扫，`leak_rate_over_scanned`，`p1b/scripts/leak-scan.cjs:132`） |
| 未判定的 36 条算安全 | 未判定 36 条**未判**，需人工处置 |
| 泄漏 0 条 | `★leak = 0`（★ 前缀是脚本自带的强调，保留） |
| 泄漏集中在 delphi | 「leak 按 kind」是**计数排序**，不是严重度排序；处置按你的下游影响排 |

## 5. 处置顺序

1. **先修 leak**：有 leak 的题，判据冻结晚于事件 ⇒ 结论被污染。
   按 `leak 按 kind` 那行定位是哪个 kind 的出题逻辑系统性泄漏
   （`p1b/scripts/calendar-questions.cjs:88` 记的就是这类系统性问题）。
2. **再清 gate 不认的字段**：那不是库的错，是**门禁的覆盖面**不够。
   `p1b/scripts/leak-scan.cjs:74` 的注释写得很直白：本件**只单列，不改 gate**。
   要改 gate 是判据改动，须走评审，**不是 agent 能顺手做的事**。
3. **结构性无日期**（彩票期号）按 `dueof.md` 处理：那是到期口径问题，不是泄漏问题。

★ **不要为了让三计数变好看去动 `GATE_UNSUPPORTED` 表。**
那等于把「我没判」改成「我判它没问题」——正是本项目最核心的防 Goodhart 设计要挡的那件事。

## 6. 与其它件的关系

- 本件的判据**同源** `门禁 锚点` 的 Q0-2 ⇒ 两者不会互相矛盾。
- 本件**只读**，零写库、零网络。
- 逐层读数里的 `n` 与本件的 `pass` 分母**不是一回事**，别混算。
