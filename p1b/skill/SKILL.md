---
name: p1b-forecast-ledger-cli
description: 本项目「万物可判定性账本」P1b 侧的薄 CLI 使用说明。当需要体检账本、跑只读读数件、跑门禁（锚点/契约/冻结哈希）、查到期欠账、查泄漏、或把生产库做异地备份与恢复演练时使用。覆盖 18 条命令的档位、参数、产物落点与逐条退出码读法。W 档写库命令必须人类在终端执行。
---

# P1b 判定侧薄 CLI · agent 使用说明

本件是**投影**：下面每一个命令、每一个档位、每一个退出码，都能在 `p1b/cli/commands.cjs` 与
`p1b/cli/index.cjs` 里找到出处。`p1b/test/skill-projection.test.cjs` 会在每次测试时校验这一点——
**文档里写一个不存在的命令、错一档、引用一个不存在的文件行，本件立刻打红。**
所以：照着本文跑，不要凭记忆补全参数；也不要相信任何与本文冲突的「印象」。

## 0. 这个项目是干什么的（一句话）

它把「对世界的每一条可判定断言」变成账本里的一行：**题面 + 冻结时点（cutoff）+ 判据 + 概率 + 真值锚**，
到期后由机械解析器（零 LLM）回填真值并计分；本 CLI 是这套账本的**唯一人工/agent 入口**。

## 1. 三条铁律

### 铁律① 可判定的交给代码，不可判定的才交给模型

凡是「能用一个函数判定」的事——到期日怎么推、题面有没有泄漏、真值锚够不够——**一律不许你用语言模型
现场判断**。本仓为此把判据拆成了 18 个只读/写盘件：拒收门三问（`p1b/scripts/anchor-gate.cjs:6`、
`p1b/scripts/anchor-gate.cjs:7`、`p1b/scripts/anchor-gate.cjs:8`）、到期口径契约
（`p1b/src/evidence/dueBranches.js:26`）、泄漏扫描（`p1b/scripts/leak-scan.cjs:126`）。
**你负责调用和如实转述，判据归代码。** 你自己的「我觉得这条题没问题」不是判据。

### 铁律② W 档必须人类在终端执行

W 档＝写生产账本 `p1a.db`。CLI 默认只读：命令带 `confirm: true` 而调用方没给 `--确认` 时，
`p1b/cli/index.cjs:232` 在 **spawn 之前**就 `return EXIT.USAGE`（`p1b/cli/index.cjs:245`），
**子进程一次都不起**。

- **你不要替人加 `--确认`。** 你可以在报告里写「建议执行：<完整命令>，请人类在终端确认后运行」。
- 你自己**永远不**在命令里带 `--确认`（`--confirm` 同义，见 `p1b/cli/index.cjs:184`）。
- 唯一的例外是 `备份 异地`：它是 **F 档**（只写备份目录、不碰 `p1a.db`，`p1b/cli/commands.cjs:246`），
  但同样过确认闸。**过闸不是因为它写库，是因为它真的在写盘**——`p1b/cli/commands.cjs:240` 写得很直白。

### 铁律③ 空集永不等于通过

未覆盖必须**显式计数**，不能折进「通过」里。三处证据：

- 候选 0 条时 `门禁 锚点` **退出码 3**，不是 0（`p1b/scripts/anchor-gate.cjs:209`）。
- 抽不出 cutoff 时记 `unverifiable` **单列、不计通过**（`p1b/scripts/anchor-gate.cjs:158`）。
- 样本不足 `n < 30` 时只报方向、**不出 Brier 结论**（`p1b/scripts/stage4-run.cjs:265`，
  阈值 `MIN_N = 30` 定义在 `p1b/scripts/stage4-run.cjs:30`）。

转述任何读数时，**分母是什么就说什么**。把「29 条里对了 20 条」写成「准确率 69%」是本项目明令禁止的
——`门禁 锚点` 自己在 `p1b/scripts/anchor-gate.cjs:226` 就把 `criteria_source` 与投影声明写进了产物。

## 2. 怎么调

```bash
node p1b/cli <组> <命令> [位置参数…] [-- 透传给子脚本的参数…]
node p1b/cli <命令>            # 18 个中文名全局唯一，组名可省
node p1b/cli --help            # 顶层帮助（命令表 + 排除件）
node p1b/cli <组> <命令> --help # 单条命令的用法与只读性
```

- **组只有 5 个**，每个组有中文名、英文 `key` 和别名（`p1b/cli/commands.cjs:95`）：
  `体检`(doctor) / `结算`(settle) / `读数`(read) / `门禁`(audit) / `备份`(backup)。
- **命令只有中文标识符，18 条全部没有 `key` 字段**（`p1b/cli/commands.cjs:283` 的 `findCommand`
  同时匹配 `zh` 与 `key`，但表里只填了 `zh`）。⇒ **不要发明英文命令名**。
- 单段式能用的唯一原因是 18 个中文名不重名；命中不唯一时 `p1b/cli/index.cjs:141` 会列候选并退出 2。
- **参数分流**（`p1b/cli/index.cjs:211`–`p1b/cli/index.cjs:214`）：`--` 之前的 token 是位置参数，
  `--` 之后**原样透传**给子脚本。子脚本自己的开关**一律走 `--` 之后**。
- CLI 自己的开关只有三个：`--确认` / `--confirm` / `--help`（含 `-h`、`help`）。

### 2.1 `--json` 一律是 `--json <路径>`，从无布尔式

`--json` 是**写文件**，不是「打 JSON 到 stdout」。且必须**空格分隔**：
`p1b/scripts/leak-scan.cjs:34` 要求 `--json` 后面紧跟一个**不以 `--` 开头**的 token，否则取到缺省值。
照抄：

```bash
node p1b/cli 体检 泄漏 -- --json .scratch/leak/0928.json
```

写错成 `--json`（不带路径）不会报错，会**静默不产出**——`p1b/scripts/leak-scan.cjs:149` 拿到 `null` 就跳过。

> 少数件也认 `--json=path` 这种等号形式（`p1b/scripts/anchor-gate.cjs:201`），
> 但那不是通用契约。**统一用空格分隔。**

**唯一「跑完就有机器可读结果在 stdout」的件是 `体检 欠账`**：
`p1b/scripts/_b1-matures-audit.cjs:22` 把计数打成一行 JSON。要用数字就直接 `node p1b/cli 体检 欠账`，
不要加 `--json`。

### 2.2 F 档产物路径每次运行都不同

F 档的产物**只落** `.scratch/cli/<YYYYMMDD-HHMMSS>/`（`p1b/cli/commands.cjs:55` + `p1b/cli/index.cjs:228`），
**永不进 `p1b/sim/out/`、永不进 `docs/specs/`**。时间戳每次跑都不同 ⇒ **不许硬编码路径**：

```bash
node p1b/cli 读数 列
ls -t .scratch/cli | head -1          # 取最新那次
```

为什么这么严：这些子脚本的输出路径缺省是 **git tracked** 目录
（`p1b/scripts/kind-table.cjs:33` 缺省 `docs/specs/kind-目录表.md`、
`p1b/scripts/u8-columns.cjs:25` 与 `p1b/scripts/calibration-report.cjs:16` 缺省 `p1b/sim/out`），
不注入就是「跑一次诊断、把仓库产物覆盖一遍」。

⚠️ `读数 校准` 的 `--out-dir` **既是入也是出**：CLI 会先把生产目录里命中正则的 5 个输入件
**复制**进暂存目录再跑（`p1b/cli/commands.cjs:76`），行为与生产逐位相同，生产目录只被读。

### 2.3 R 档透传写旗：CLI 只提醒、**不拦**

`p1b/cli/index.cjs:249`–`p1b/cli/index.cjs:251` 会对 `--write` / `--out` / `--json` / `--text` /
`--md` / `--emit-review` / `--record-candidates` / `--confirm`（清单在 `p1b/cli/commands.cjs:61`）
打一行提醒，**然后照跑**。这是薄包装原则的代价，**你必须自己抵住**：

★ **`门禁 冻结哈希` 透传 `--write` 会真的改掉那个 md 文件**（`p1b/scripts/prereg-freeze.cjs:76`
在 `if (WRITE)` 内执行 `writeFileSync`）。**任何情况下都不要透传 `--write` 给它。**
它是 R 档件，作用是「告诉人类冻结件被改了」，不是「自动把新哈希写回去」。

## 3. 档位

**档位只有三个字母**（`p1b/cli/commands.cjs:20`–`p1b/cli/commands.cjs:24`；`p1b/test/cli.test.cjs:120`
已把这条钉死）：**R / F / W**。

- **R 只读**：零写盘、零写库、零网络。CLI 一个写参数都不注入。
- **F 写盘·不写库**：产物只落 `.scratch/cli/<时间戳>/`，永不入库。
- **W 写库**：写 `p1a.db` 生产账本，**必须 `--确认`**。

★ **N 不是第四个档。** 它是每条命令上独立的 `net: boolean` 标记（`p1b/cli/commands.cjs:92`），
显示为「W 写库·N 打网」这样的后缀。**18 条命令里只有 `结算 语料` 为真**（`p1b/cli/commands.cjs:163`）。
把 N 当成第四档去写是本仓最常见的一个错。

### 3.1 档位表（逐行对照 `p1b/cli/commands.cjs`）

| 命令 | 档位 | 一句话用途 | 什么时候用 |
|---|---|---|---|
| 看板 | R 只读 | 一页看板：G2 五门 / 采信链 / 五层读数 / 账本计数 | 开场第一眼；想知道「现在能信什么」 |
| 跑批 | R 只读 | 跑批体检：进程 / DB 增长 / 队列陈旧度 | 怀疑管道卡住时；**「零增长 ≠ 卡死」** |
| 泄漏 | R 只读 | 全库泄漏扫描：pass / leak / 未判定 | 出题后自查；有 leak 必须先修再入库 |
| 文件全图 | R 只读 | 项目文件全图生成器（缺省打 stdout，不落盘） | 需要目录结构时 |
| 欠账 | R 只读 | 到期欠账：已存 `matures_at` vs 由 evidence 现推 | 到期闸报「明明有 resolver 却不结算」时 |
| 语料 | W 写库 | 语料题机械 resolve（零 LLM）——打网 6 源 + 写 `p1a.db` | **只能人类在终端跑** |
| G2门 | R 只读 | G2 能力门月报 · R4 口径（缺省不落盘） | 定期看能力门 |
| 分层 | R 只读 | 阶段 4 分层读数真跑（L2/L5 最小引擎 × 真实账本，逐层 Brier/ECE） | 看五层读数；**禁跨层池化** |
| 校准 | F 写盘·不写库 | 分域格校准报告 | 看分域格校准；输入件由 CLI 预置 |
| 列 | F 写盘·不写库 | U8 加列读侧派生：KL 可预报性 / Murphy 三分解 | 看派生列读数 |
| 判词离散度 | F 写盘·不写库 | 同题多路判词的分歧幅度 | 怀疑判词在自说自话时 |
| kind目录 | F 写盘·不写库 | `resolve.kind` 目录表 | 查某个 kind 的契约要求 |
| 锚点 | R 只读 | Q0 拒收门三问的可执行判定（过锚率，候选/严格双口径） | 出题器产出候选后，**入库前必过** |
| 契约 | R 只读 | 契约表「源码派生」复现检查（全文件零 writeFileSync） | 怀疑代码与冻结契约脱钩时 |
| 冻结哈希 | R 只读 | PREREG 冻结块 sha256 复算 | 有人碰过 PREREG 之后 |
| 抽检清单 | F 写盘·不写库 | ② 抽检清单 v2 构造器 | 组装人工抽检批次 |
| 异地 | F 写盘·不写库 | 生产库异地备份（逐份落 sha256 收据，保留最近 N 份） | **过确认闸**；目标同盘会被直接拒 |
| 演练 | F 写盘·不写库 | 从备份恢复一份到临时件并校验，报告「能不能用」 | 验证保险真的能用（**不碰生产库**） |

## 4. 逐条命令

格式：`node p1b/cli <组> <命令>` ｜ 档位 ｜ 退出码要点。

### 体检 看板
`node p1b/cli 体检 看板` ｜ R ｜ 0。本仓的一页总览。想开始任何工作先跑它。

### 体检 跑批
`node p1b/cli 体检 跑批` ｜ R ｜ 0。
★ 判读口径在脚本自述里：**「零增长 ≠ 卡死」**。DB 增长 0 只说明此刻没批在跑，不说明管道坏了。

### 体检 泄漏
`node p1b/cli 体检 泄漏` ｜ R ｜ 0。三计数读法见 `references/leak.md`。
要机器可读就加 `-- --json <路径>`（**必须带路径**）。

### 体检 文件全图
`node p1b/cli 体检 文件全图` ｜ R ｜ **3 = 生成物含 NUL**（`p1b/scripts/file-map.cjs:185`，防二进制泄漏）。
缺省打 stdout、不落盘；`-- --out <路径>` 才会写盘（写了就是 R 档件的提醒，CLI 不拦）。

### 体检 欠账
`node p1b/cli 体检 欠账` ｜ R ｜ 0。
**唯一 stdout 直接出机器可读结果的件**（`p1b/scripts/_b1-matures-audit.cjs:22`）：首行是
`{R4_rows, stored_nonnull, derived_ok, match, mismatch, stored_null_but_derivable, underivable}`。
跑之前 CLI 会先打一张**契约到期口径覆盖表**到 stderr（`p1b/cli/index.cjs:263`）——那是纯件
`p1b/src/evidence/dueBranches.js` 导出的东西，**CLI 只打印、不复制它的判定逻辑**。
三套到期口径的关系见 `references/dueof.md`。

### 结算 语料
`node p1b/cli 结算 语料` ｜ **W 写库·N 打网**｜ **2 = 缺 `--确认`（子进程未起）**。
★ 唯一打网的命令（`p1b/cli/commands.cjs:163`），会写 `p1a.db`。
**agent 不得执行**（铁律②）。写清要人类跑什么，让人类自己敲 `--确认`。
子脚本自己的开关也叫 `--confirm`（`p1b/cli/commands.cjs:167`），CLI 会自动替你补上——
所以你只要决定要不要让人类确认，不要试图代劳。

### 读数 G2门
`node p1b/cli 读数 G2门` ｜ R ｜ 0。缺省不写盘（落盘在脚本的 `if (JSON_OUT/TEXT_OUT)` 内）。

### 读数 分层
`node p1b/cli 读数 分层` ｜ R ｜ 0。逐层 Brier/ECE。
★ `n < 30` 的层**只报方向、不出 Brier 结论**（`p1b/scripts/stage4-run.cjs:265`）。
★ L1 的 `accuracy` 与 Brier **不同量纲**（`p1b/scripts/stage4-run.cjs:238` 注明 accuracy = 1 − 错误率），
**不许混着报**。★ **禁跨层池化**（`p1b/scripts/stage4-run.cjs:202`，判据见 `p1b/scripts/stage4-run.cjs:260`）。

### 读数 校准
`node p1b/cli 读数 校准` ｜ F ｜ 0。产物在 `.scratch/cli/<ts>/`，用 `ls -t .scratch/cli | head -1` 找。

### 读数 列
`node p1b/cli 读数 列` ｜ F ｜ 0。同上找产物。

### 读数 判词离散度
`node p1b/cli 读数 判词离散度` ｜ F ｜ 0。同上。

### 读数 kind目录
`node p1b/cli 读数 kind目录` ｜ F ｜ 0。产物含 `kind-目录表.md` 与 `kind-table-latest.json`，
**都在暂存目录**；仓库里那份 `docs/specs/kind-目录表.md` 不会被碰（`p1b/scripts/kind-table.cjs:237`
是无条件写，但 CLI 注入的 `--out` 指向暂存目录，见 `p1b/cli/commands.cjs:183`）。

### 门禁 锚点
`node p1b/cli 门禁 锚点 <候选.json>` ｜ R ｜ **3 = 候选 0 条**（`p1b/scripts/anchor-gate.cjs:209`）。
位置参数必填，缺了退 2。**只有给了 `--out/--md` 才写盘**，所以 R 档成立。
判据与读法见 `references/gate.md`。

### 门禁 契约
`node p1b/cli 门禁 契约` ｜ R ｜ **0 = 通过（逐行 `[OK]`）**；**1 = `--strict` 下有 missing_fn /
frozen_not_read**（`p1b/scripts/g2-contract-verify.cjs:143`，`--strict` 定义在
`p1b/scripts/g2-contract-verify.cjs:25`）。
★ **注意：这条命令的失败码是 1，不是 3。** 逐行看 `[DIFF]` / `[missing_fn]` 才是判读正路。

### 门禁 冻结哈希
`node p1b/cli 门禁 冻结哈希 <文件.md>` ｜ R ｜
- **0 = 脚本跑完了**——⚠️ **不代表 MATCH 为真**。`MATCH = false` 也是 0。
  **必须读 stdout 的 `MATCH     = ` 那一行**（`p1b/scripts/prereg-freeze.cjs:73`）。
- **2 = 文件不存在**（`p1b/scripts/prereg-freeze.cjs:62`）。
- **3 = 解析抛异常（真崩溃，不是裁决）**（`p1b/scripts/prereg-freeze.cjs:66`）：
  典型是「未找到登记块起始标记」或「未找到登记块结束行」。
- **4 = 给了 `--write` 但找不到哈希写入位**（`p1b/scripts/prereg-freeze.cjs:81`）——见 §2.3，别给。

### 门禁 抽检清单
`node p1b/cli 门禁 抽检清单` ｜ F ｜ 0。产物 `g2-audit-review.tsv` 在暂存目录
（脚本的落盘是无条件的，CLI 必须注入路径，`p1b/scripts/g2-audit-build.cjs:18`）。

### 备份 异地
`node p1b/cli 备份 异地 <异地目录>` ｜ **F** ｜ **2 = 缺 `--确认`（子进程未起）**。
★ 它是 **F 档**（只写备份目录、**不碰 `p1a.db`**），但**过确认闸**——因为它真在写盘。
`--dest` 从位置参数取，**CLI 不替你选盘符**（`p1b/cli/commands.cjs:247`）。
目标与源同盘会被子脚本直接拒。

### 备份 演练
`node p1b/cli 备份 演练 <备份目录>` ｜ F ｜
- **0 = 这份备份可用**；
- **3 = 这份备份不可用**（`p1b/scripts/restore-drill.cjs:246`，逐条列不通过项）；
- **4 = 预检失败**（目录里根本没有备份，`p1b/scripts/restore-drill.cjs:115`/`120`）——
  **4 和 3 不混**：「压根没备份」与「备份在但不能用」是两件事。
★ **绝不碰生产库**：它只恢复到临时件。

## 5. 退出码怎么读

CLI 的码表在 `p1b/cli/index.cjs:49`，**除 0–4 之外一律原样透出子进程的非零码**
（`p1b/cli/index.cjs:276`–`p1b/cli/index.cjs:280`）。

| 码 | 含义 | 判读动作 |
|---|---|---|
| 0 | 成功 | ⚠️ **不等于「结论为真」**（见 `门禁 冻结哈希`） |
| 1 | CLI 一般错误（未知命令 / 组名、spawn 失败） | 多半是命令名写错 |
| 2 | 用法错，**或缺 `--确认`** | 看 stderr 的「✗ 缺位置参数」/「未执行」 |
| 3 | **子进程原样透出** | ★ 含义随命令而变，见下表，**绝不可笼统读成「门禁不通过」** |
| 4 | 预检失败（子脚本不存在 / 指向被排除件） | 检查路径 |
| 其它 | 子进程原码 | 照脚本自己的文档读 |

### 5.1 exit 3 的逐命令含义（**唯一正确的读法**）

| 命令 | exit 3 到底意味着 | 出处 |
|---|---|---|
| `门禁 锚点` | **候选 0 条**（防空集被读成「通过」） | `p1b/scripts/anchor-gate.cjs:209` |
| `体检 文件全图` | **生成物含 NUL**（防二进制泄漏进仓库） | `p1b/scripts/file-map.cjs:185` |
| `备份 演练` | **这份备份不可用**（不是 0） | `p1b/scripts/restore-drill.cjs:246` |
| `门禁 冻结哈希` | **解析抛异常 —— 这是真崩溃，不是裁决** | `p1b/scripts/prereg-freeze.cjs:66` |
| 其它命令 | 各脚本自有语义 | 照该脚本头注 |

⇒ **报告里写 3 的时候，必须同时写清是哪条命令的 3、它在那条命令里代表什么。**
只写「exit 3」等于没写。

## 6. 显式排除件：agent 不得直接调

这 4 个脚本**故意不在命令表里**（`p1b/cli/commands.cjs:265`–`p1b/cli/commands.cjs:270`）：

- `_sqlite-guard.cjs` —— 是**库**不是 CLI，spawn 起来什么都不做。
- `_rollback-template.cjs` —— 是**模板**，且 `node --check` 即语法错。
- `forecast-calendar.cjs` —— 会覆盖 git tracked 产物。
- `intake-ledger-e2e.cjs` —— 输出目录硬编码且无条件写，**零参件无法被 CLI 重定向**。

**直接 `node p1b/scripts/<这四个>` 会绕过全部防护。** 需要它们的能力时，走对应的 CLI 命令。

## 7. 四条人类保留位置（agent 停手，交人）

1. **押注时** —— 在题上写下概率、冻结 cutoff、落库。`结算 语料` 这类 W 档写操作，命令由人敲。
2. **认账时** —— 承认某次判断错了、写负结果、结案。改的是账本里已经发生的记录。
3. **决定相不相信一份报告时** —— 报告是 agent 生成的，采信它是人的动作。
   agent 可以指出「本报告的分母是 29，不是 30，出不了结论」，**不能替人点头**。
4. **任何 W 档写操作** —— 无例外，见铁律②。

被闸拦住时（exit 2 + `未执行`），正确动作是**把命令原样交给人**，不是换个旗再试。
`p1b/cli/index.cjs:237`–`p1b/cli/index.cjs:244` 打的那几行（组·命令、档位、写库、将要执行、怎么确认）
就是给人看的，**照抄进你的报告即可**。

## 8. 延伸阅读

- `references/forecast.md` —— 怎么出一道配得上账本的题（题面 / cutoff / 阈值 / 真值锚）。
- `references/gate.md` —— 拒收门三问的通俗版、`n<30` 只记方向、`p=null` 绝不显示成 0。
- `references/leak.md` —— 泄漏扫描三计数（pass / leak / **unverifiable**）怎么读。
- `references/dueof.md` —— 到期口径为什么有三套、哪套是权威。

## 9. 常见坑速查

| 现象 | 真因 | 出处 |
|---|---|---|
| 跑完找不到产物 | 忘了 `--json` 要带路径 | `p1b/scripts/leak-scan.cjs:34` |
| 产物覆盖了仓库文件 | 硬编码了 `p1b/sim/out` 路径 | `p1b/cli/commands.cjs:55` |
| 命令名写错退 1 | 想当然用了英文命令名 | `p1b/cli/commands.cjs:283` |
| 加了 `--确认` 但闸没拦 | 那条命令本来就没 `confirm` | `p1b/cli/index.cjs:232` |
| 冻结哈希退 3 | 那个 md 里没有 `## 冻结登记` 块 | `p1b/scripts/prereg-freeze.cjs:66` |
| 把 3 一律当成「门禁不通过」 | 3 的含义随脚本而变 | `p1b/cli/index.cjs:278` |
| 把 N 当成第四个档 | N 是 `net` 布尔标记 | `p1b/cli/commands.cjs:92` |
| R 档件居然写盘了 | `--` 之后透传了写旗，CLI 只提醒不拦 | `p1b/cli/index.cjs:251` |
