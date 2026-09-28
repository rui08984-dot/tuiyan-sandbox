# 到期口径：三套实现，一套权威

```bash
node p1b/cli 体检 欠账
```

R 档只读件，退出码 0。★ **唯一 stdout 直接出机器可读结果的件**
（`p1b/scripts/_b1-matures-audit.cjs:22`）——首行就是一行 JSON，**不要加 `--json`**。

## 0. 一句话

**到期日不是一个数，是三处独立算出来的数外加一列历史快照。**
它们本可以各算各的；本仓用**一条覆盖断言**把它们钉在一起，
所以你看到不一致时，**不是某处在「算错」，而是覆盖出现了缺口**。

## 1. 三套 + 一列，各自干什么

| # | 是什么 | 在哪 | 干什么用 | 权威性 |
|---|---|---|---|---|
| ① | **契约登记源** `date_derivations` | `p1b/sim/out/g2-contract-frozen-r4.json`，由 `p1b/src/evidence/dueBranches.js:29` 读入 | kind → `{source_key, granularity, rule, note}`，声明「这个 kind 的日期该从哪个字段、按什么规则推」 | ★ **权威**（口径本体，sha 锁） |
| ② | **结算侧选题闸** `dueOf()` | `p1b/scripts/corpus-resolve-daemon.cjs:66` | 决定「**哪些题现在该结算了**」；推不出就永不选中 | 实现，可能**缺分支** |
| ③ | **写端口** `deriveMaturesAt()` | `p1b/src/db/predictionsStore.js:204` | 落 `matures_at` 列；推不出**抛异常**（`p1b/src/db/predictionsStore.js:227`） | 实现，与 ② 是两条独立路径 |
| ④ | 账本已存的 `matures_at` 列 | `p1a-terminal/data/p1a.db` | **历史快照**，是③在入库当时算下的值 | **不权威**——它可能过期、可能当时就是错的 |
| ⑤ | 第三份 `dueOf()` 副本 | `p1b/scripts/_dparts/p2.cjs:21` | 另一条构建路径上的同名函数，**分支比 ② 少** | 副本，见 §4 |

★ ②③ 推不出来时的行为**不一样**，这不是 bug：
- ② 落 `{due: null, src: 'undatable'}`（`p1b/scripts/corpus-resolve-daemon.cjs:97`）⇒ 永不结算；
- ③ 直接 `throw`（`p1b/src/db/predictionsStore.js:227`）⇒ **写端不许留空**。

## 2. 为什么会有三套（病根）

`p1b/src/evidence/dueBranches.js:7`–`p1b/src/evidence/dueBranches.js:11` 写得很清楚：

> 契约登记了「每个 kind 的日期从哪个字段、按什么规则推」，
> 而 `dueOf()` 是**另写的一份手写分支表**。两者之间**没有任何断言**。
> ⇒ 契约新增一个 kind（换了 `source_key` 或粒度），`dueOf` 不跟着改
> ⇒ 该 kind 的题**静默落 `undatable`** ⇒ daemon 永不选中
> ⇒ **明明有 resolver 也永不结算，且没有任何告警**。

2026-09-27 实测：契约 22 个 kind，`dueOf` 只覆盖 14 个，**缺口 8 个 kind / 86 条全量行**。

## 3. 哪套是权威 —— 三个字的答案

> **契约（①）是权威；`dueOf`（②）是实现；覆盖断言是桥；`matures_at` 列是快照，不是判据。**

理由写在 `p1b/src/evidence/dueBranches.js:15`–`p1b/src/evidence/dueBranches.js:17`：
- 断言的登记源必须是**不会腐坏的东西**——契约文件本身被 sha256 锁住
  （比对 `kind-table-latest.json` 与 `docs/specs/kind-目录表.md` 里记的 `contract_sha256`
  是否等于当前契约的 sha）⇒ **谁改契约，谁先在 kind-table 那条打红**；
- 纯件 `dueBranches.js` **只读不写**，它的 `readFileSync` 是全件唯一的 fs 调用。

判定顺序（`p1b/src/evidence/dueBranches.js:3` 头注 ＋ `p1b/cli/index.cjs:163`–`p1b/cli/index.cjs:176`）：
**先探 `dueOf` 现场推不推得出来，探得到就不看登记。**

## 4. 覆盖缺口怎么登记

`p1b/src/evidence/dueBranches.js:73` 的 `UNIMPLEMENTED` 表登记
**已知且已拍板**的缺口：`组 → 原因`（原因必须非空、人写）。

它的设计要点（`p1b/src/evidence/dueBranches.js:62`–`p1b/src/evidence/dueBranches.js:68`）：

- **不是「例外名单」**：例外名单是**手抄的快照**，登记的是「今天哪几个没实现」，
  而要发现的是「明天多了哪个没实现」——**快照登记不了增量**。
- 契约**新增**一组且没人登记 ⇒ 断言**转红**（这正是要抓的增量）；
  契约**新增**一组且登记了原因 ⇒ 绿，但**原因摆在明处**。
- **登记项刻意不与实现状态挂钩**：分支落地后登记项**自动失效**，
  既不用删、也不会因为「施工方落地了、没顺手删登记」而互相打红。

分组规则：`p1b/src/evidence/dueBranches.js:40` 把 kind 按
`source_key + '/' + granularity` 聚成组，键序见 `p1b/src/evidence/dueBranches.js:51`。

### ★ 副本的隐患

`p1b/scripts/_dparts/p2.cjs:21` 那份 `dueOf()` 比 ② **少三条分支**
（实测对照：② 有 `year`、`week_start`、`commence_utc` 相关分支，它没有）。
**报告覆盖结论时要说清你探的是哪一份**——否则「说已覆盖、其实探的是副本」就是一个假绿。

## 5. 断言在哪、怎么跑

```bash
node --test p1b/test/corpus-resolve-dueof.test.cjs
```

第 ⑧ 例（`p1b/test/corpus-resolve-dueof.test.cjs:205`）是**契约覆盖断言**：
逐个 group 问 `dueOf`——**要么推得出来，要么该组在 `UNIMPLEMENTED` 里有非空原因**。

`p1b/cli 体检 欠账` **只打印** `dueBranches.js` 已导出的 `PAIRS` / `DERIV_BY_PAIR` / `UNIMPLEMENTED`
（`p1b/cli/index.cjs:170`–`p1b/cli/index.cjs:176`），**不复制它的判定逻辑**。
A 件缺失时**降级提示、不报错**（`p1b/cli/index.cjs:166`）。

## 6. 欠账读数怎么读

`node p1b/cli 体检 欠账` 首行（2026-09-28 本机实测，**会随账本增长变**）：

```json
{"R4_rows":1994,"stored_nonnull":1371,"derived_ok":1492,
 "match":1178,"mismatch":165,"stored_null_but_derivable":149,"underivable":474}
```

| 字段 | 人话 |
|---|---|
| `R4_rows` | R4 层全部行（分母） |
| `stored_nonnull` | 已存 `matures_at` 且非空的行数 |
| `derived_ok` | **现在**用 evidence 现推得出来的行数 |
| `match` | 两边**一致** ⇒ 这行没欠账 |
| `mismatch` | ★**两边不一致** ⇒ 存的过期了或当时算错 |
| `stored_null_but_derivable` | 存的是空、**但现在推得出来** ⇒ 该补的没补 |
| `underivable` | 存的是空、**现在也推不出** ⇒ 真欠账 |

后面还有两行按 kind 分组的明细：`null_but_derivable by kind=` 与 `underivable by kind=`
（`p1b/scripts/_b1-matures-audit.cjs:24`–`p1b/scripts/_b1-matures-audit.cjs:25`）。

### 6.1 四种欠账，四种处置

| 现象 | 含义 | 处置 |
|---|---|---|
| `match` | 无欠账 | 不用管 |
| `mismatch` | 存的与现推不一致 | **看差值方向**：`stored` 比 `derived` 晚 ⇒ 到期日被写晚了（可能过早结算过）；早 ⇒ 还没到期却已标到期 |
| `stored_null_but_derivable` | 推得出却没存 | 补录；**先确认写端口③的规则没变过**，变了就是口径问题不是欠账 |
| `underivable` | 推不出 | ★ **真欠账**：要么 ② 缺分支（去 §4 登记/补分支），要么题本身结构上无日期（如彩票期号） |

★ **`underivable` 里 `(no-resolve)` 占大头时**（实测 450/474），
先查那些行**有没有 `resolve` 元素**——不是到期口径的问题，是**证据没落全**。
别一看到 474 就去改 `dueOf`。

## 7. 与其它件的关系 / 别做的事

- `读数 分层`、`读数 校准` 的 `--out-dir` 与到期口径**无关**；
- ★ `forecast-calendar.cjs` **被显式排除在 CLI 之外**
  （`p1b/cli/commands.cjs:268`）：它 spawn daemon 的 `--report-due` **不带 `--report-due-out`**，
  而 daemon 的缺省落盘位置是 **git tracked** 的 `p1b/sim/out/resolve-daemon.due.json`
  （`p1b/scripts/corpus-resolve-daemon.cjs:520`）⇒ 它不是「写盘件」，是「覆盖仓库产物件」。
  **不要直接 `node p1b/scripts/forecast-calendar.cjs`。**
- 报告到期覆盖率时，**必须带分母**（`p1b/src/evidence/dueBranches.js:51` 的 `PAIRS` 组数、
  契约 kind 总数），并说明探的是 ② 还是 ⑤。

相关：`gate.md`（`n<30` 与 null 的读法）、`leak.md`（未判定不许折进通过）、
`forecast.md`（出题时就得保证到期日推得出来）。
