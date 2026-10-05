# 能力目录 —— 「别的 AI 装上它之后能干什么」

**生成日期**：2026-09-30 ｜ **机器可验证**：本文每一条能力都配一条**真跑过**的调用示例，
输出是从本机实际执行里贴出来的节选（不是手写的示意）。

**这份目录解决什么问题**：MCP 工具名是写给机器看的，AI 面对的就是名字和说明。
前两轮已把工具名改成人话可读并补了三个缺口（`p1b_note_record` / `p1b_where_i_bias` /
`p1b_which_layer`），**本文把它们连成一份对外说明书**：按「用户会问什么」分四组，
每条能力写满五栏（用户这么说 / 它调什么 / 得到什么 / 不能做什么 / 越界了怎么办），
边界写在能力旁边，而不是让调用方踩了才知道。

---

## 0. 先回答「你能不能连上、连上要不要钥匙」

★这一节放在最前面：前两轮盘点漏了它，「对外」这个问题就没答完整。

### 0.1 清单（实测，2026-09-30）

```bash
# 数 HTTP 端点（真扫 p1b/src/routes/ + server.js 的注册调用）
$ grep -rhoE "app\.(get|post|put|delete)\(\s*'[^']*'" p1b/src/routes/ p1b/src/server.js \
    | sed -E "s/app\.([a-z]+)\(\s*'/\U\1\E /" | awk '{print $1}' | uniq -c
      1 DELETE
     35 GET
     24 POST
      2 PUT
   # 合计 62 个端点

# 数 MCP 工具（真起 server 跑 tools/list）
$ node .tmp/mcp-drive.cjs '[{"method":"tools/list","params":{}}]'
stderr: [p1b/mcp] stdio server 就绪，21 个工具（协议 2026-07-28，零新依赖）
tool count: 21
names: p1b_doctor_board, p1b_doctor_exp_health, p1b_doctor_leak_scan, p1b_doctor_file_map,
       p1b_doctor_matures_audit, p1b_settle_corpus, p1b_read_g2_report, p1b_read_stage4,
       p1b_read_calibration, p1b_read_u8_columns, p1b_read_verdict_spread, p1b_read_kind_table,
       p1b_audit_anchor_gate, p1b_audit_g2_contract, p1b_audit_prereg_freeze, p1b_audit_g2_audit_build,
       p1b_backup_offsite, p1b_backup_restore_drill, p1b_note_record, p1b_where_i_bias, p1b_which_layer

# 数 CLI 命令（真 require 命令表）
$ node -e "const C=require('./p1b/cli/commands.cjs'); const a=C.allCommands();
           console.log('CLI 命令数 =',a.length);"
CLI 命令数 = 18
按档位 = {"R 只读":10,"W 写库·N 打网":1,"F 写盘·不写库":7}

# 数「当库用」的纯模块
$ ls p1b/src/engines p1b/src/calibration p1b/src/evidence p1b/src/disclosure
l1_proc.js  l2_baseline.js  l3_aci.js  l5_certified.js  l5_sources.js  l6_structural.js
betaCalibration.js  index.js  isotonic.js  platt.js
baseRate.js  domain.js  dueBranches.js  klineClosed.js  labBoundary.js  resolveKind.js
revealClass.js  seriesKey.js  stage5Pool.js  truthBasis.js  verdictSchema.js
habitRank.mjs  habitRank.d.mts
```

> ★**与任务书给的数字对不上的三处，如实说**（不悄悄改数）：
> | 任务书说 | 实测 | 差在哪 |
> |---|---|---|
> | HTTP 58 端点 | **62** | 2026-09-28 补注册的 analytics 4 条（`/api/analytics/*`）等已计入 |
> | MCP 21 工具 | **21** ✅ | 对得上 |
> | CLI 23 条 | **18** | CLI 表 `p1b/cli/commands.cjs` 只有 18 条（18＝MCP 的 18 条投影 ＋ 3 条对外工具＝MCP 21） |
>
> 23 这个数在仓里找不到对应物（`p1b/scripts/` 下有 130 个 `.cjs`，其中 **4 个被显式排除**
> 不进 CLI，理由随附，见 `p1b/cli/commands.cjs:265-270`）。**本文按实测数写。**

### 0.2 三种接入方式，各自的前提

| 形态 | 怎么接 | 钥匙 | 进程会碰生产库吗 |
|---|---|---|---|
| **MCP**（stdio） | 客户端配置一行：`{"command":"node","args":["<仓库>/p1b/mcp/index.cjs"]}` | **不需要令牌**（stdio 是父子进程，天然是本机的） | **不会**。MCP 进程对 `p1a.db` 零权限，只 `spawn` 子进程 |
| **HTTP** | `node p1b/src/server.js`，缺省 `127.0.0.1:8787` | **看有没有配 `P1B_SHARED_TOKEN`**（见下） | 会（复用 `p1a-terminal/data/p1a.db`） |
| **CLI** | `node p1b/cli <组> <命令>` | 不需要 | 只读命令不会；写库命令要 `--确认` |
| **当库用** | `require('<仓库>/p1b/src/…')` | 不需要 | 纯函数模块不会（`l2_baseline.js` / `revealClass.js` / `dueBranches.js` / `habitRank.mjs`） |

### 0.3 ★共享令牌门：三个真跑出来的行为

判据真源：`p1b/src/server.js:59-117`（`TOKEN_HEADER='x-p1b-token'`、`TOKEN_COOKIE='p1b_token'`、
`resolveListenConfig`）与 `p1b/src/server.js:198-214`（`onRequest` 钩子）。

**门只罩 `/api`，静态资源不罩**（`server.js:200`：`if (!req.url.startsWith('/api')) return;`）
—— 否则手机第一次打开会拿到一个连 CSS/JS 都取不到的死页面。

**真跑**（本机起服务，`P1B_SHARED_TOKEN=probe-token-abc123`、端口 8791、回环监听）：

```console
$ curl -s -i http://127.0.0.1:8791/api/health | head -2
HTTP/1.1 401 Unauthorized
{"error":"需要共享令牌","hint":"在 URL 后加一次 ?p1b_token=<P1B_SHARED_TOKEN 的值>，或请求头 x-p1b-token"}

$ curl -s -H "x-p1b-token: probe-token-abc123" http://127.0.0.1:8791/api/health
{"ok":true,"service":"p1b-web-workbench","db_path":"E:\\music player\\p1a-terminal\\data\\p1a.db",
 "llm_mock":true,"web_built":true,"engine":{"db_contract":"v1","reused_from":"p1a-terminal"}}

$ curl -s -H "x-p1b-token: wrong" http://127.0.0.1:8791/api/health
{"error":"需要共享令牌","hint":"…"}          # 错令牌与没令牌同一种回执，不泄露「哪个对了」

$ curl -s -o /dev/null -w "GET / => %{http_code}\n" http://127.0.0.1:8791/
GET / => 200                                # 静态资源确实不设门
```

**令牌从哪三个地方收**（`extractToken`，`server.js:105-117`，按顺序取第一个有的）：
① 请求头 `x-p1b-token`；② `Authorization: Bearer <令牌>`；③ Cookie `p1b_token`；
④ 查询串 `?p1b_token=`（手机首次打开用这个，种下 Cookie 后后续 `fetch` 自动带上，
`SameSite=Strict` 挡住跨站借用）。比较用 `crypto.timingSafeEqual` 定长比较（`server.js:97-102`）。

**★拒绝启动的组合**（`server.js:81-92`）：`P1B_HOST` 是开网地址（`isOpenHost` 判据在 `server.js:63-68`：
`localhost` / `::1` / `127.*` 之外都算开网）**且**没给 `P1B_SHARED_TOKEN` ⇒ 进程直接抛错退出。

```console
$ P1B_HOST=0.0.0.0 PORT=8799 node p1b/src/server.js ; echo "exit=$?"
[p1b] 启动失败: Error: [p1b] 拒绝启动：P1B_HOST=0.0.0.0 会把服务开到局域网上，但没设 P1B_SHARED_TOKEN。
        这台机器所在 Wi-Fi 上的任何设备都能改你的供应商配置、并让服务端把真密钥发出去。
        两种修法（选一种）：
          ① 只在本机用 → 去掉 P1B_HOST（或设为 127.0.0.1），不需要令牌；
          ② 要让手机连同一 Wi-Fi 用 → 在 start-p1b.bat 里 node src/server.js 那一行前面加：
               set P1B_HOST=0.0.0.0
               set P1B_SHARED_TOKEN=你自己想的一串随机字符
             然后手机浏览器打开一次 http://<本机局域网IP>:8787/?p1b_token=<那串字符> 即可。
    at resolveListenConfig (E:\music player\p1b\src\server.js:82:11)
    at start (E:\music player\p1b\src\server.js:272:18)
exit=1
```

★**这条抛出发生在任何 db 访问之前**：`start()` 的第一行（`server.js:272`）就是
`resolveListenConfig(process.env)`，而 `db.init` 在 `buildServer` 里（`server.js:142`）——
所以「拒绝启动」这条路径连库都没碰到（上例没有 `p1a.db` 的读写痕迹）。
上面那段地址是**占位符**（`<本机局域网IP>`），不是能连的地址：
发行闸 C3 专抓「看起来像真端点」的串，连注释里写一个都会被照红
（`p1b/scripts/audit-release.cjs:56-59` 的自曝注释记着它被抓过两次）。

**默认形态不需要钥匙**：没配 `P1B_SHARED_TOKEN` ⇒ `requiresToken=false` ⇒ 钩子根本不注册
（`server.js:198` 的 `if (listen.requiresToken)`），回环监听下 `/api` 直接通。
真跑（端口 8792、未设令牌）：

```console
$ curl -s http://127.0.0.1:8792/api/health
{"ok":true,"service":"p1b-web-workbench","db_path":"E:/music player/.tmp/p1a-copy.db",
 "llm_mock":true,"web_built":true,"engine":{"db_contract":"v1","reused_from":"p1a-terminal"}}
```

**另外三个环境开关**（`server.js` 里读，不设就是上面的默认）：

| 变量 | 不设 | 设了 | 出处 |
|---|---|---|---|
| `P1B_LLM_MOCK` | 按激活供应商调真模型 | `=1` ⇒ 所有 LLM 调用强制 mock（零网络） | `server.js:139` |
| `P1B_DB_PATH` | 解析到 `p1a-terminal/data/p1a.db` | 指到别的库（本文的写示例就指到 `.tmp/` 的副本） | `server.js:137` / `src/paths.cjs` |
| `P1B_CORS_ORIGIN` | **不发**任何 CORS 放行头 | 逗号分隔白名单 | `server.js:164-167` |
| `P1B_MCP_ALLOW_NET` | `1`（注册那条 W+N 工具） | `=0` ⇒ `tools/list` 从 21 掉到 20（只摘掉 `p1b_settle_corpus`） | `mcp/tools.cjs:51-54,86-88` |

**联机闸实测**：

```console
$ node -e "const t=require('./p1b/mcp/tools.cjs');
           const off=t.listTools({env:{P1B_MCP_ALLOW_NET:'0'}});
           console.log('默认 =',t.listTools().length,'｜ALLOW_NET=0 =',off.length,
             '｜少了：',t.listTools().map(x=>x.name).filter(n=>!off.some(o=>o.name===n)).join(','));
           try{ t.callTool('p1b_settle_corpus',{},{env:{P1B_MCP_ALLOW_NET:'0'}}); }
           catch(e){ console.log('调用被下线工具 ⇒',e.protocolError?'protocolError':'普通错','|',e.message); }"
默认 = 21 ｜ALLOW_NET=0 = 20 ｜少了： p1b_settle_corpus
调用被下线工具 ⇒ protocolError | 工具已按部署策略下线（不联网）：p1b_settle_corpus
```

### 0.4 MCP 协议形态的事实（不是所有客户端都能直连）

- 只实现三个方法：`server/discover` / `tools/list` / `tools/call`（`mcp/protocol.cjs:93-111`）。
  **没有握手**——按 2026-07-28 修订版；老客户端先发 `initialize` 会拿到 `-32601`，
  **这是正确行为，让它早点失败比让它半懂不懂地跑强**（`protocol.cjs:17-21`）。真跑：

```console
$ # 发 initialize
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"本 server 未实现方法：initialize"}}
```

- 叫了一个不存在的工具 ⇒ 协议级 `-32602`（**只有这一种**）。真跑：

```console
$ # tools/call p1b_no_such_tool
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"未知工具：p1b_no_such_tool"}}
```

- 引导信息走 **stderr**，`stdout` 是协议通道一个字节都不能被日志污染（`mcp/index.cjs:27`）。
  真跑：`[p1b/mcp] stdio server 就绪，21 个工具（协议 2026-07-28，零新依赖）`。

### 0.5 ★三条贯穿全部能力的底线

1. **返回体一律是「账本中已结算的历史统计事实」**，每条工具的 `structuredContent.disclaimer`
   固定带这句话（`mcp/toolTable.cjs:99`）。不构成任何对未来结果的判断或建议。
2. **能写生产账本的 MCP 工具数＝0**。`p1b_settle_corpus` / `p1b_backup_offsite` 撞确认闸；
   `p1b_note_record` **一个子进程都不起**（`mcp/userTools.cjs:66` `run:'confirm-gate'`，
   启动即断言「confirm-gate 工具不许挂子脚本」，`userTools.cjs:252-255`）。
3. **「没测到」≠「通过」**。`unverifiable` / `n/a` / `not_reachable` / 空榜 / `exit 3` 都要原样报出，
   不能折进通过率里。

---

## 1. 分组：打分 —— 「我判得准不准」

### 1.1 我这半年关于汇率的判断准吗（分层读数）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「我这半年关于汇率的判断准吗」「哪一层判得最差」「这两层的分数能比吗」 |
| **② 它调什么** | MCP `p1b_read_stage4` ＝ CLI `node p1b/cli 读数 分层` ＝ `p1b/scripts/stage4-run.cjs`；HTTP 侧另有 `GET /api/predictions/calibration` 与 `GET /api/audit/g2-kpi`。背后算子是 `p1b/src/engines/l2_baseline.js`（L2 统计基率＋Wilson）、`l1_proc.js` / `l3_aci.js` / `l5_certified.js` / `l6_structural.js`（L1/L3/L5/L6）；取数源是 `p1a.db` 的 `predictions` 表，只对**已 resolve** 的行计分 |
| **③ 得到什么** | `content[0].text`＝人读报告；`structuredContent`＝`{tool, exit, disclaimer, argv, stdout_bytes, stderr_bytes, output_dir, verdict?}`。报告体每层给：`账本行 / 引擎出数 / 未出数及原因 / 可计分`、`Brier(engine)`、`Brier(常数0.5)`、`Δ` 及其 95% 配对 bootstrap CI、`观测频率`、`引擎平均 p`、`n`、`贝叶斯语义`。HTTP `GET /api/predictions/calibration` 另给 `{status, n, ece, buckets:[{lo,hi,n,mean_prob,true_rate}], layers}` |
| **④ 不能做什么** | **不预判未来**：只对已 resolve 的行计分，尚未到期的题一件都不在里面。**不出总分**：分层报，**禁跨层池化**。**不混量纲**：L1 的 Brier 语义＝计算错误率，与概率层不是一回事；L1 另有 `accuracy`，★**accuracy 与 Brier 不是同一个量纲**。**不给建议**：不推荐用哪层。**不碰私钥**。样本不足的域格只报方向、不出结论 |
| **⑤ 越界了怎么办** | 缺账本/库比程序新 ⇒ 服务端 `assertSchemaSupported` 抛错、**退出码 6**（`schemaVersion.js`，`server.js:138`）。域格 n 小于阈值 ⇒ 该格显示 `n/a`（**是样本不够，不是「测了没问题」**），不出结论 |

**示例（真跑，`tools/call p1b_read_stage4`）**：

```console
exit: 0
阶段 4 · 分层预测真跑（L2/L5 最小引擎 × 真实账本）
库: E:\music player\p1a-terminal\data\p1a.db | 行域: p.g2_regime = 'R4' | 生成: 2026-09-30T11:17:39.391Z
[L1] 账本行 180 | 引擎出数 180 | 未出数 0（—）| 可计分 180
    Brier(engine)=0.0000 | Brier(常数0.5)=0.2500 | Δ(engine − 0.5)=-0.2500
    L1 决定论层：**本层 Brier 语义＝计算错误率**，不与概率层混比；vs 常数 0.5 的 Δ 在此层无概率含义
    贝叶斯语义: deterministic_recalc（概率主干豁免）
[L2] 账本行 682 | 引擎出数 611 | 未出数 71（{"insufficient_data":71}）| 可计分 434
    Brier(engine)=0.2403 | Brier(常数0.5)=0.2500 | Δ=-0.0097
    Δ 的 95% 配对 bootstrap CI=[-0.0228,0.0028]（B=1000，seed=987654321）⇒ **engine_directionally_better_but_CI_includes_0**
    贝叶斯语义: prior（基率+Wilson）
[L3] 账本行 654 | 引擎出数 654 | 未出数 0（—）| 可计分 620
    Brier(engine)=0.2386 | Δ=-0.0114
    Δ 的 95% 配对 bootstrap CI=[-0.0215,-0.0014] ⇒ **delta_vs_half_negative_CI_excludes_0**
```

> ★读法提醒（工具描述里也有）：**L2/L3 那两行「CI 不含 0」不构成可声称的「更准」**——
> 引擎 p 本身就是基率、无第二路信号；L2 的 CI 跨 0，L3 的 Δ 明确写了「不构成可声称的更准」。

**HTTP 同源示例（真跑，`GET /api/predictions/calibration`）**：

```console
$ curl -s http://127.0.0.1:8792/api/predictions/calibration
{"status":"ok","n":1700,"ece":0.02608429825732271,"buckets":[
  {"lo":0,"hi":0.1,"n":1,"mean_prob":0.01,"true_rate":0},
  {"lo":0.1,"hi":0.2,"n":29,"mean_prob":0.1719589655172414,"true_rate":0.10344827586206896},
  {"lo":0.5,"hi":0.6,"n":371,"mean_prob":0.5238713934300588,"true_rate":0.5121293800539084},
  {"lo":0.9,"hi":1,"n":6,"mean_prob":0.9116666666666667,"true_rate":0.8333333333333334}], …}
```

### 1.2 我在哪类事上偏（★本项目最核心的那个价值）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「我准不准」「我在哪类事上偏」「为什么我老在同一件事上错」「哪类事我老报大了」 |
| **② 它调什么** | MCP `p1b_where_i_bias` → spawn `p1b/scripts/where-i-bias.cjs --json`；HTTP `GET /api/disclosure/habits`；**当库用** `require('p1b/src/disclosure/habitRank.mjs')` 的 `rankHabits(cells)` / `habitBuckets(cells)`。取数源＝`p1b/sim/out/calibration-report-<日期>[字母].json` 的 `cells` 行（现成列，**不重跑引擎、不重算分数**）。判据单一真源＝`habitRank.mjs`，**本子脚本、只读端点、网页组件三方共用同一份** |
| **③ 得到什么** | `{source_file, generated_at, cells_total, cells_with_conclusion, habit_buckets_total, habit_buckets_dropped, habits:[{domain, n, ok, delta}], ranking:{what,order,denominator,cell_rules[],dropped,ties,n30,page_note}, dropped_domains:[{domain,n,cells,reason}], read_only, discipline[]}`。`ranking` 是判据的人话版，**跟着计算走**（不另写一份解释） |
| **④ 不能做什么** | **★`delta` 的分母是「够样本的格数 ok」，不是题数 n**——引用时必须照实说这是格数。**不出总分**（跨域池化会造出一个谁都没算过的数，本工具刻意不给）。**不给裁决句**（不给「你准不准」的判决、不给总分、不推荐下一步；裁决留给读的人）。**空榜不是「你没偏」**，是「还没测够」——两者必须分开说。**不预判未来**（只报已结算题的历史统计事实）。**不碰私钥** |
| **⑤ 越界了怎么办** | 缺披露件 ⇒ `isError:true` ＋ `verdict.gate='ERROR'`，stderr 带生成命令；**这是环境问题，重试无用**。HTTP 端点缺件 ⇒ `404 {"error":"n/a：缺披露件（未生成或尚未跑脚本）","hint":"node p1b/scripts/calibration-report.cjs"}`（★这一条**是从 `p1b/src/routes/disclosure.js:57` 读出来的，不是跑出来的**——真库有披露件，造不出缺件形态）。n<30 的格**不进榜、也不在 `dropped_domains` 的任何比例字段里**——只记方向 |

**示例（真跑，`tools/call p1b_where_i_bias`）**：

```console
isError 缺席（= false）｜exit: 0
data.habits 头几行（按 |delta| 降序）：
  {"domain":"werewolf_sim","n":450,"ok":2,"delta":-0.16227266461724815}
  {"domain":"cwl",         "n":44, "ok":1,"delta":-0.09926746804658149}
  {"domain":"noaa",        "n":52, "ok":1,"delta":-0.0373652483814616}
  {"domain":"openmeteo",   "n":574,"ok":1,"delta":-0.012478033935508975}
data.ranking.denominator:
  "delta = 偏差之和 ÷ 够样本的格数（ok）。★不是除以题数 n：分母是格数。"
data.cells_total = 29 ｜ data.cells_with_conclusion = 10
data.habit_buckets_total = 9 ｜ data.habit_buckets_dropped = 0 ｜ data.dropped_domains = []
```

**HTTP 同源示例（真跑）**：

```console
$ curl -s http://127.0.0.1:8792/api/disclosure/habits
{"source_file":"calibration-report-20260926.json","generated_at":"2026-09-26T17:10:00.670Z",
 "cells_total":29,"cells_with_conclusion":10,
 "habits":[{"domain":"werewolf_sim","n":450,"ok":2,"delta":-0.16227266461724815}, …],
 "ranking":{"what":"每个域给一个数：只有样本够的格参与的平均偏差（相对「一律报五成」的无信息线）。", …}}
```

**★当库用示例（真跑，`require` 即用，零 HTTP／零 MCP／零子进程）**：

```console
$ node -e "const h=require('./p1b/src/disclosure/habitRank.mjs');
           const cells=[
             {domain:'fx',  scored_n:100, delta_vs_half:-0.20, conclusion_allowed:true},
             {domain:'fx',  scored_n:20,  delta_vs_half: 0.90, conclusion_allowed:false},
             {domain:'weather', scored_n:5, delta_vs_half: 0.30, conclusion_allowed:false}];
           console.log(JSON.stringify(h.rankHabits(cells)));
           console.log(JSON.stringify(h.habitBuckets(cells)));"
[{"domain":"fx","n":120,"ok":1,"delta":-0.2}]                  // 只 fx 上榜：ok>0
[{"domain":"fx","n":120,"ok":1,"cells":2,"d":-0.2},            // 桶含 ok=0 的域与全部格数
 {"domain":"weather","n":5,"ok":0,"cells":1,"d":0}]
```

> 为什么这条最短：`habitRank.mjs` 是**纯计算、零副作用**（不读文件、不读库、不碰网络、不写全局量，
> 见文件头 `:21-22`），所以同一个 `cells` 进 ⇒ 同样的结果出。**后端 Node 与前端浏览器能吃同一份。**

**fail-closed 示例（真跑，缺件 / 未知参数两条路径）**：

```console
$ node p1b/scripts/where-i-bias.cjs --calibration .tmp/nope.json ; echo "exit=$?"
✗ 披露件不可解析：nope.json（ENOENT: no such file or directory, open '…\.tmp\nope.json'）
exit=1          # MCP 侧映射为 isError:true ＋ verdict.gate='ERROR'；★照实说「读不到」，
                 #   不要报成「你没偏」——那是在编数

$ node p1b/scripts/where-i-bias.cjs --bogus ; echo "exit=$?"
✗ 未知参数：--bogus（本件只认 --calibration <path> 与 --json）
exit=2          # 用法错
```

> ★缺件时**不给空榜**。空榜会被读成「你没偏」，那是编数——
> 脚本头注 `:21` 与返回体的 `discipline[]` 都把这句话写死了。

### 1.3 同类题给我一个诚实区间

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「这类题历史上大概多大机会」「做这类判断有没有先验可依」「同类题的比例是多少」 |
| **② 它调什么** | HTTP `GET /api/baseline/:kind`，背后 `p1b/src/engines/l2_baseline.js` 的 `l2Baseline()` ＋ `wilson()`；取数源＝`p1a.db` 里同类 `kind` 的**已结算**行 |
| **③ 得到什么** | `{ok, kind, state, n, k, enough, point_estimate, interval:[lo,hi], coverage_guarantee, method, source, reason, engine_note, counts:{rows_total,settled,excluded_tautology,…}}`。`coverage_guarantee` 是**区间保证什么的白话**（保证抽样过程，不保证这一道题） |
| **④ 不能做什么** | **不给建议**（点估计也给，但要不要看由调用方选）。**不预判这一道题**（区间是「同类题反复抽」的性质，不是这一道的答案）。**不碰私钥**。**n<30 两个出口都不给数**（区间与点估计都没有） |
| **⑤ 越界了怎么办** | `state` 分三档：`enough`（n≥30，给区间）／样本不足（两个出口都不给数）／`no_rows`（账本里一道这种题都没有，**与「有若干条但不足 30」是两件事**） |

**示例（真跑）**：

```console
$ curl -s http://127.0.0.1:8792/api/baseline/openmeteo_daily_max
{"ok":true,"kind":"openmeteo_daily_max","state":"enough","n":113,"k":56,"enough":true,
 "point_estimate":0.495575,"interval":[0.405062,0.58638],
 "coverage_guarantee":"Wilson score 区间，置信水平 95%（z=1.96）。它保证的是「抽样过程」：
   同一类题反复抽同样多次，100 次里大约 95 次这样的区间会盖住真实发生比例。它不保证这一道题——
   这一道题的答案仍然可能落在区间之外，那不是区间算错了。",
 "method":"stat_baseline+wilson","source":"history_series",
 "reason":"同类已结算 113 条，其中 56 条真的发生了。样本过了 30 的准入线 ⇒ 给区间…",
 "counts":{"rows_total":114,"settled":113,…}}

$ curl -s http://127.0.0.1:8792/api/baseline/zzz
{"ok":true,"kind":"zzz","state":"no_rows","n":0,"k":0,"enough":false,
 "point_estimate":null,"interval":null,"coverage_guarantee":null,
 "reason":"账本里一道这种题都没有——同类真值出来过的题是 0 条。这跟\"有若干条但不足 30\"是两件事…"}
```

### 1.4 分域校准 / 判词离散度 / 派生列（三个 F 档读数件）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「哪个题域判得偏、偏多少」「同一道题的多路判词分歧多大」「这些判词里到底有没有信息量」 |
| **② 它调什么** | MCP `p1b_read_calibration`（`p1b/scripts/calibration-report.cjs`）／`p1b_read_verdict_spread`（`verdict-spread.cjs`）／`p1b_read_u8_columns`（`u8-columns.cjs`），三者都等于 `node p1b/cli 读数 <命令>`。输入件由 CLI 从 `p1b/sim/out` **复制**进暂存目录（生产目录只读） |
| **③ 得到什么** | `content[0].text`＝人读摘要；`structuredContent.output_dir`＝产物落点（`.scratch/cli/<时间戳>/`），json/md 各自路径在 stdout 里 |
| **④ 不能做什么** | **F 档＝写盘不写库**：产物只落 `.scratch/cli/<时间戳>/`，**永不进 `p1b/sim/out`、永不进 `docs/specs/`**。分数低 ≠「有信息量但模型差」，也 ≠「没信息量」——分解项要一起读。**不给建议**。**不预判未来** |
| **⑤ 越界了怎么办** | 缺输入件 ⇒ 子脚本自己的 `n/a` 残废报告并 exit 非零，`isError:true` ＋ `verdict.gate='ERROR'`。⚠ MCP 侧 `idempotentHint:false` 是**诚实的**：CLI 每次生成新的时间戳目录，连调两次会在磁盘上留两批产物 |

**示例（真跑，`p1b_read_calibration`）**：

```console
isError 缺席｜exit: 0｜output_dir: E:\music player\.scratch\cli\20260930-192159
=== 分域格校准报告（P0-U8）===
stage4=ok 格数=29 可出结论=10
json -> E:\music player\.scratch\cli\20260930-192159\calibration-report-20260930.json
md   -> E:\music player\.scratch\cli\20260930-192159\calibration-report-20260930.md
[p1b] 已预置输入 24 件 → E:\music player\.scratch\cli\20260930-192159（生产目录只读）
```

---

## 2. 分组：记账 —— 「把一道判断存进去，到期替我核」

### 2.1 帮我记一道判断

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「帮我记一道判断」「把这句话记下来，到期了替我核」「我押上海明天 35 度以上，押六成」 |
| **② 它调什么** | MCP `p1b_note_record`（★**一个子进程都不起**，返回落账草案）｜HTTP `POST /api/predictions`（外部题免局落注，落进「外部题容器局」）｜HTTP `POST /api/games/:id/predictions`（按局落注，收局内事件 id）｜HTTP `POST /api/intake/classify`（先过拒收门三问再落账的那条路）｜**当库用** `require('p1b/src/db/predictionsStore.js')` 的 `deriveMaturesAt(resolve, evidence)`。判据真源＝`predictionsStore.js` 的 `deriveMaturesAt`（到期日推导）与 `routes/predictions.js:75-81` 的 `requireProb`（[0,1] 闭区间） |
| **③ 得到什么** | `p1b_note_record`：`{tool, exit:2, recorded:false, gate_not_confirmed:true, verdict:{gate:'NOT_CONFIRMED',do_not_retry:true}, write_plan:{statement, assigned_prob, resolve_spec:{kind,date}, layer, secondary_layer, engine, gate}, will_execute:null, will_execute_absent_why, how_to_record:[3 条], hint}`。HTTP 落注：`201` + 整行（`id / game_id / statement / assigned_prob / evidence[0].resolve / matures_at / container / idempotency`） |
| **④ 不能做什么** | **不代你落账**（MCP 侧越权写账本一律不做，草案交人类）。**不预判未来**：不查这道题会不会发生。**不给建议**：不判断该不该记、该不该改口径。**不碰私钥**：不读、不存、不打印任何令牌或密钥。**不换算你的数**：`assigned_prob` 原样带，不取整、不拿基率顶。**`prob` 必填，缺省即 400**（不许拿基率/引擎读数顶上） |
| **⑤ 越界了怎么办** | MCP 侧：`statement` 空白／`kind` 空／`prob` 不是数或越界 ⇒ `isError:true` ＋ `verdict.gate='INPUT'` ＋ `problems:[{field,why}]` 逐条说清（**这是用法错，补齐后可重试**，与「不要重试」是两回事）。★**`prob` 恰好等于 0 不是缺填**（那是「我押它不发生」）；把 0 当成「没给」会让一条真实判断凭空消失，而账本不可变、找不回来。HTTP 侧：缺 `resolve_spec` ⇒ 400「没有真值锚的行查不到历史频率、也判不了真值口径，等于没建索引」；`prob` 越界 ⇒ 400 |

**MCP 示例（真跑，草案成形）**：

```console
$ tools/call p1b_note_record {"statement":"明天 上海 最高气温 > 35°C","prob":0.8,
                              "kind":"openmeteo_daily_max","date":"2026-10-02"}
isError: false
verdict: {"gate":"NOT_CONFIRMED","do_not_retry":true}
write_plan: {"statement":"明天 上海 最高气温 > 35°C","assigned_prob":0.8,
             "resolve_spec":{"kind":"openmeteo_daily_max","date":"2026-10-02"},
             "layer":null,"secondary_layer":null,"engine":null,"gate":null}
will_execute: null
will_execute_absent_why: "闸后面那件事在 CLI 侧没有对应命令（落账通路只有 HTTP 端点与网页）…"
content[0].text 头两行：
  ✗ 这是写账本的命令，确认闸默认只读 ⇒ **未执行**（子进程未启动，一个字节都没写）。
    状态　：recorded=false（账本未动）
```

> ★`will_execute` 是 `null` **不是省略**：`p1b_settle_corpus` 那类会给一条可粘贴的命令行，
> 这条不给——因为闸后面**真的没有一条现成的命令行**。给一个不存在的执行路径比不给更糟：
> 模型会照着它去找，找不到就当成工具坏了（`userTools.cjs:377-383`）。

**MCP 示例（真跑，用法错 fail-closed）**：

```console
$ tools/call p1b_note_record {"statement":"  ","prob":0}
isError: true
verdict: {"gate":"INPUT","bad_fields":["statement","kind"]}
★注意 `bad_fields` 里**没有 prob** —— prob=0 是合法判断（押它不发生），不算缺填。
problems[0]: "statement —— 还没写这道题在问什么 —— 题面是必填的，空着记下来只是一条备忘，进不了账本。"
problems[1]: "kind —— 还没选「答案去哪里查」—— 真值锚决定这道题到期时有没有地方能核对；没有它就不是账本行。
             想知道哪些 kind 算数，用 p1b_which_layer。"
```

**HTTP 示例（真跑，写在 `.tmp/p1a-copy.db` 库副本上，生产库一个字节没动）**：

```console
$ curl -s -X POST http://127.0.0.1:8792/api/predictions -H "Content-Type: application/json" \
       -H "Idempotency-Key: probe-key-001" -d @.tmp/note-ok.json
{"id":2010,"game_id":94,"source_type":"预测卡","statement":"明天 上海 最高气温 > 35°C",
 "assigned_prob":0.8,"evidence":[{"resolve":{"kind":"openmeteo_daily_max","date":"2026-10-02"}}],
 "created_at":"2026-09-30 11:19:48","resolved_at":null,"outcome":null,
 "matures_at":"2026-10-02","external":true,
 "container":{"game_id":94,"name":"外部题（容器局 · 非对局）","scope":"external"},
 "idempotency":{"provided":true,"replayed":false,"key_header":"idempotency-key",
   "note":"本次是该幂等键的首次写入；之后用同一个键重发将返回这一条（同一个 id），不多写。"}}

# 同键重放 ⇒ 同一条，不多写
$ （同一条命令再来一次）
{"id":2010,… ,"idempotency":{"provided":true,"replayed":true,…}}     # id 相同

# 缺真值锚 ⇒ 拒收
$ curl -s -X POST …/api/predictions -d @.tmp/note-noresolve.json
{"error":"resolve_spec 必填（真值锚类型，如 {kind:\"openmeteo_daily_max\"}）——
          没有真值锚的行查不到历史频率、也判不了真值口径，等于没建索引"}

# prob 越界 ⇒ 拒收
$ curl -s -X POST …/api/predictions -d @.tmp/note-badprob.json
{"error":"prob 必须在 [0,1] 区间，收到: 1.8"}
```

> ★**幂等键是这条口的发行阻断项**（`routes/predictions.js:389` 附近注释）：一次超时重试
> ＝多一条预测＝准确率当场被污染（**账本无修正入口**）。键由调用方给；
> 没带键的老调用方**照写**，只在响应里如实回报并落一行 `keyed=0` 证据。

**★当库用示例（真跑，`require` 即用，纯函数、零句柄）**：

```console
$ node -e "const s=require('./p1b/src/db/predictionsStore.js');
           console.log('LAYERS =',JSON.stringify(s.LAYERS));
           console.log('OUTCOMES =',JSON.stringify(s.OUTCOMES));
           console.log('deriveMaturesAt(openmeteo, 2026-10-02) =',
             s.deriveMaturesAt({kind:'openmeteo_daily_max',date:'2026-10-02'}));
           console.log('deriveMaturesAt(crossref, 202640) =',
             s.deriveMaturesAt({kind:'crossref_week_total',epiweek:'202640'}));
           try{ s.deriveMaturesAt(null,[]); }catch(e){ console.log('deriveMaturesAt(null,[]) 抛：',e.message); }"
LAYERS = ["L1","L2","L3","L4","L5","L6"]
OUTCOMES = ["true","false","ambiguous"]
deriveMaturesAt(openmeteo, 2026-10-02) = 2026-10-02
deriveMaturesAt(crossref, 202640) = 2026-10-10
deriveMaturesAt(null,[]) 抛： deriveMaturesAt: 无法推导到期日（#2 写端不得留空）：resolve={}
```

### 2.2 这道题到期了吗 / 结算回填

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「这道题到期了吗」「真实发生了，我来结」「哪些题还欠着」 |
| **② 它调什么** | HTTP `POST /api/predictions/:id/resolve`（真值回填）、`GET /api/predictions/unresolved`（欠账清单）、`GET /api/predictions/:id`（单题详情）；MCP 侧 `p1b_doctor_matures_audit`（`体检 欠账`，逐行比对「已存的 matures_at」与「由 evidence 现推出的」）。**当库用** `predictionsStore.maturityState(row, today)` |
| **③ 得到什么** | 回填 ⇒ 整行（`resolved_at` / `outcome` / `matures_at` / `layer` / `gate` …）。`unresolved` ⇒ `{items:[…], …}`。单题详情 ⇒ `{…, truth_anchor:{kind,date}, base_rate, verdict_count, verdicts[], truth_basis:{excluded,hits,reason,rule,fingerprint_sha256,n_excluded_at_freeze}, l0_gate:{…}}`。欠账审计 ⇒ `{R4_rows, stored_nonnull, derived_ok, match, mismatch, stored_null_but_derivable, underivable, mismatch sample[], …by kind}` |
| **④ 不能做什么** | **不改账**：落定不可逆、**目前没有修正入口**（需要单独立项，因为修正记录算不算进统计会影响已冻结的读数）。**不替你判真值**：口径歧义恒走 `ambiguous`，不许硬判。**不碰私钥**。**不给建议** |
| **⑤ 越界了怎么办** | **未到期 ⇒ 拒收**（下面示例里贴了原话，理由写得很清楚：此刻落定＝把半成品当真值写进不可逆账本）。已落定 ⇒ 拒收（照实报 `resolved_at` 与 `outcome`）。`outcome` 不在 `true\|false\|ambiguous` ⇒ 400。`maturityState` 对 `matures_at` 缺失的行给 `state` 而不是崩 |

**示例（真跑）**：

```console
# 未到期 ⇒ 拒收
$ curl -s -X POST …/api/predictions/2010/resolve -d @.tmp/resolve-ok.json
{"error":"这道题还没到期，真值尚未产生（到期日 2026-10-02，今天 2026-09-30）——落定不可逆且没有修正入口，
          所以现在不能答。未到期：到期日 2026-10-02 晚于今天 2026-09-30，真值尚未产生，
          此刻落定＝把半成品当真值写进不可逆账本"}

# 已到期 ⇒ 落定
$ curl -s -X POST …/api/predictions/2009/resolve -d @.tmp/resolve-ok.json
{"id":2009,…,"resolved_at":"2026-09-30 11:20:04","outcome":"true","matures_at":"2026-02-01","g2_regime":"R4"}

# 重放已结算 ⇒ 拒收
$ （同一条命令再来一次）
{"error":"该记录已落定（resolved_at=2026-09-30 11:20:04，outcome=true）。账本不可改——这正是它可信的原因。
          目前**没有**修正入口（需要单独立项）：修正记录算不算进统计，会影响已冻结的读数。"}

# outcome 非法
$ curl -s -X POST …/resolve -d @.tmp/resolve-bad.json
{"error":"outcome 必须是 true|false|ambiguous，收到: \"maybe\""}
```

**MCP 欠账审计示例（真跑，`node p1b/cli 体检 欠账`）**：

```console
── 到期口径 · 契约覆盖表（登记源 g2-contract-frozen-r4.json 的 date_derivations，sha 锁）──
  end/daily  →  npm_downloads_window, openalex_works_count
  epiweek/weekly  →  delphi_fluview_ili, delphi_fluview_num_ili
  issue/draw  →  cwl_ssq_blue_odd, cwl_ssq_red_contains, dlt_draw_result
  month/monthly  →  dbnomics_bis_monthly_mean, … swpc_solar_cycle_monthly
  组数 9｜kind 合计 22｜显式登记未实现 3：epiweek/weekly, end/daily, week/weekly
{"R4_rows":1994,"stored_nonnull":1371,"derived_ok":1492,"match":1178,"mismatch":165,
 "stored_null_but_derivable":149,"underivable":474}
underivable by kind={"(no-resolve)":450,"cwl_ssq_red_contains":16,"cwl_ssq_blue_odd":8}
```

---

## 3. 分组：裁决 —— 「这事归哪一类 / 能不能出 / 有没有泄漏」

### 3.1 这件事机器能自己查吗（★上一轮补的三条对外工具之二）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「这件事机器能自己查吗」「这个答案机器拿得到吗」「到期谁来结」「这类题归哪一类」 |
| **② 它调什么** | MCP `p1b_which_layer` → spawn `p1b/scripts/reveal-class-query.cjs`（带 `--kind` 时加 `--kind <kind>`）。分类判据真源＝`p1b/src/evidence/revealClass.js` 的 `classifyReveal`；「支持与可达」判据＝`p1b/src/evidence/resolveKind.js` 的 `supportedKinds()`（契约表 ∪ aliases ∪ REVEAL_CLASS 的并集派生）。**当库用**＝`require` 这两个文件 |
| **③ 得到什么** | 给了 `kind` ⇒ `data.one = {kind, cls, cls_zh, note, registered_in_reveal_class, supported_kind}`；不给 ⇒ `data.{total, by_class:{ok,human,stuck}, kinds:[…], unsupported:[…], not_registered_elsewhere}`。`cls` 三类**互斥且完备**：`ok`＝机器能自动结（**这不是用户的活**）／`human`＝要人答／`stuck`＝永远结不了 |
| **④ 不能做什么** | **不预判未来**：只答「这类题的答案机器能不能自己拿到」，不答「结果会是什么」。**不给建议**：不替你挑 kind、不判断该不该用这个题。**不替你归层**：把一句话归到 L1–L6 属于接题端点那条线，**本工具不做**。**不碰私钥**。**零写盘、零写库、零网络**。**`stuck` 不给假按钮**——给一个点了没反应的按钮比不给更糟 |
| **⑤ 越界了怎么办** | 冻结契约表读不到 ⇒ `isError:true` ＋ `verdict.gate='ERROR'`，**不给任何「可达/不可达」结论**（放行等于把今天的病原样留在库里）。schema 层只认 `kind` 一个键，多传 ⇒ `additionalProperties:false` 拒。★**传了一个没见过的 kind 不是错**：`human` ＋ 两处「未登记」标记，照实报 |

**示例（真跑，`tools/call p1b_which_layer`）**：

```console
# ① 登记且在支持表内
$ {"kind":"binance_daily_close"}
data.one: {"kind":"binance_daily_close","cls":"ok",
           "cls_zh":"机器能自动结（到期守护进程自己去查）",
           "note":"到期自动查 Binance 收盘价",
           "registered_in_reveal_class":true,"supported_kind":true}

# ② 没见过的 kind ⇒ 保守按「要人答」＋ 两处未登记标记
$ {"kind":"zzz_never_registered"}
data.one: {"kind":"zzz_never_registered","cls":"human","cls_zh":"要人答（机器拿不到，但人能答）",
           "note":"这类题没有登记取数方式，先由你确认",
           "registered_in_reveal_class":false,"supported_kind":false}
```

> ★这两处标记**要原样报出来**：「按需人确认」和「它压根不在支持表里」不是一回事
> （后者意味着落注端点会拒它）。

**★当库用示例（真跑）**：

```console
$ node -e "const rc=require('./p1b/src/evidence/revealClass.js');
           for(const k of ['binance_daily_close','dlt_draw_result','cta_daily_total_rides','一个从没见过的 kind'])
             console.log('classifyReveal('+k+') =',JSON.stringify(rc.classifyReveal(k)));
           const rk=require('./p1b/src/evidence/resolveKind.js');
           console.log('supportedKinds().length =',rk.supportedKinds().length,
                       '｜isSupportedKind(\"zzz\") =',rk.isSupportedKind('zzz'));"
classifyReveal(binance_daily_close) = {"kind":"binance_daily_close","c":"ok","note":"到期自动查 Binance 收盘价"}
classifyReveal(dlt_draw_result)      = {"kind":"dlt_draw_result","c":"human","note":"大乐透要等体彩开奖公告公布"}
classifyReveal(cta_daily_total_rides) = {"kind":"cta_daily_total_rides","c":"stuck",
  "note":"芝加哥交通局接口对本机地域封禁（实测 HTTP 403），代码无法解决"}
classifyReveal(一个从没见过的 kind) = {"kind":"…","c":"human","note":"这类题没有登记取数方式，先由你确认"}
supportedKinds().length = 53 ｜isSupportedKind("zzz") = false
```

### 3.2 这道题能不能出（拒收门三问）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「我想出这道题行不行」「它有没有不靠人不靠模型的第三方真值」「换个实例答案会变吗」「这批候选的过锚率多少」 |
| **② 它调什么** | MCP `p1b_audit_anchor_gate`＝`node p1b/cli 门禁 锚点 <候选.json>`＝`p1b/scripts/anchor-gate.cjs`（可执行判定，**R 档只读**）｜HTTP `POST /api/intake/classify`（拒收门三问 ＋ 六层判定 ＋ 落接题台账） |
| **③ 得到什么** | `anchor_gate` ⇒ stdout 逐条判定 ＋ **两个口径并列**的过锚率（候选口径分母＝已通过的候选／严格口径分母＝提议全集含 `drops`）。`intake/classify` ⇒ `{ok, rejected, reason, reject_id, detail:{question,failures,checklist_hash,resolve_spec_kind}, checklist_hash, engine, gate}`（拒收）｜`{ok, rejected:false, layer, computed_layer, secondary, decided_by, checklist_hash, engine, engine_plan, gate, gate_reason, resolve_spec, statement, prob, prob_ci, engine_note, engine_result, matures_at, intake_question_id, intake_ledger}`（过门） |
| **④ 不能做什么** | **不预判未来**（只判「这类题能不能机器核」）。**不给建议**。**不碰私钥**。★**exit 3 在这条命令上是裁决不是崩溃**（`isError:false` ＋ `verdict.gate='FAIL'`，**不要重试、不要报成「通过」**）。★**过锚率必须两个口径并列报**——只报候选口径等于报了一个**构造性 100%**。★**「登记 ≠ 可达」**：`not_reachable` 的 kind 在网络上永远取不到数 |
| **⑤ 越界了怎么办** | 候选 0 条 ⇒ **exit 3**（防空集被读成通过，见下方示例）。HTTP 侧缺 `checklist` ⇒ 400 逐条说明要哪几个键；任一 `Q0_*` 为 `false` ⇒ `rejected:true` ＋ `reason` ＋ 落 `intake_rejects` 留痕（**拒收不是失败**，`ok` 仍 `true`） |

**MCP 示例（真跑，空候选 ⇒ exit 3 走成功通道）**：

```console
$ printf '{"candidates": []}' > .tmp/empty-candidates.json
$ tools/call p1b_audit_anchor_gate {"candidates":"…/.tmp/empty-candidates.json"}
isError: 缺席（= false）        ★故意是 false：程序正确地得出了「不通过」的结论
exit: 3
verdict: {"gate":"FAIL","do_not_retry":true,"kind":"VERDICT",
          "meaning":"候选 0 条 —— 这是「防空集被读成通过」的设计在说话，是裁决不是崩溃",
          "where":"p1b/scripts/anchor-gate.cjs:209"}
hint: "★这是门禁裁决，不是调用失败。…照实报告 verdict.meaning 里的那句话，不要重试，
       不要改口径重算，更不要报成「通过」。"
content[0].text:
  [anchor-gate] 候选 0 条 ⇒ exit 3（防「空集」被读成「通过」）
  [p1b] 子进程退出码 3（原样透出；3=门禁码，勿抹平）
```

**CLI 侧同一条（同一次运行）**：

```console
$ node p1b/cli 门禁 锚点 .tmp/empty-candidates.json ; echo "exit=$?"
[p1b] 门禁 · 锚点　R 只读　→ node p1b/scripts/anchor-gate.cjs --candidates .tmp/empty-candidates.json
[anchor-gate] 候选 0 条 ⇒ exit 3（防「空集」被读成「通过」）
[p1b] 子进程退出码 3（原样透出；3=门禁码，勿抹平）
exit=3
```

**HTTP 示例（真跑，写在库副本上）**：

```console
# A) 拒收门 Q0-1：无真值锚
$ curl -s -X POST …/api/intake/classify -d @.tmp/intake-reject.json
{"ok":true,"rejected":true,"reason":"no_anchor","reject_id":1,
 "detail":{"question":"Q0_1","failures":["Q0_1=false"],"checklist_hash":"v3","resolve_spec_kind":null},
 "checklist_hash":"v3","engine":"none","gate":"descriptive",
 "statement":"本轮冠军是谁（无第三方可复核真值）"}

# B) 过门 → L2 归层
$ curl -s -X POST …/api/intake/classify -d @.tmp/intake-ok.json
{"ok":true,"rejected":false,"layer":"L2","computed_layer":"L2","secondary":null,"decided_by":"auto",
 "checklist_hash":"v3","engine":"stat_baseline","engine_plan":{"layer":"L2","engine":"stat_baseline",
   "calibrator":"wilson","posture":"score","built":true,"predicts":false,"gate":"descriptive"},
 "gate":"descriptive","gate_reason":"engine_insufficient_data",
 "resolve_spec":{"kind":"openmeteo_daily_max","date":"2026-10-02"},
 "prob":null,"prob_ci":null,
 "engine_note":"engine=stat_baseline+wilson; status=insufficient_data; 无基率来源：需 history 序列 /
   counts{k,n} / evidence.baseRate（结构化）或 baseRateNote（文本），本层不出 p。; gate=descriptive",
 "engine_result":{"ok":false,"status":"insufficient_data","method":"stat_baseline+wilson",
   "p":null,"n":null,"k":null,"ci":null,"source":"none",…},
 "matures_at":"2026-10-02","intake_question_id":4,"intake_ledger":"intake_questions"}

# 缺 checklist ⇒ 400（照实说要哪几个键）
{"error":"checklist 必填（对象：Q0_1/Q0_2/Q0_3 + L5/L6/L1/L3/L2 各层问答，L4 可选）"}
```

> ★`prob:null` 是**纪律而不是故障**：`gate=descriptive` 时概率恒为 null，
> 「概率只在 `gate=scored` 后出现」。这道题新、账本里还没有同类基率，所以**不给 p**（宁可缺，不可编）。

### 3.3 账本里有没有泄漏

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「账本里有没有泄漏」「有没有偷看答案再记账」「这条判据我查得动吗」 |
| **② 它调什么** | MCP `p1b_doctor_leak_scan`＝`node p1b/cli 体检 泄漏`＝`p1b/scripts/leak-scan.cjs`。判据**同源**：cutoff 必须严格早于「事件窗口起点」，窗口起点规则照 `anchor-gate.cjs` 的 `eventWindowStart()`（含 MMWR 周规则），**本件不另立清单**。取数源＝`p1a.db` 只读句柄 |
| **③ 得到什么** | stdout 三行：`库内总题 N｜有 meta.cutoff 可扫 M`／`pass P｜★leak L｜未判定 U`／`leak 按 kind：…` ＋ `★gate 不认的字段（单列，未改 gate）：…` ＋ `结构性无日期（单列）：…` |
| **④ 不能做什么** | **零账本写、零网络、零判据变更**（判据完全照 gate，只做扫描与统计）。**不给建议**（只报数，不说该不该继续用某类题）。**不碰私钥**。★**「未判定」不许折进 pass** |
| **⑤ 越界了怎么办** | 未覆盖必须**显式计数**（禁把「推不出」混入 pass）。★**任何「无泄漏」的结论都必须同时报出未判定的数量**，否则就是把「没测到」读成了「干净」 |

**示例（真跑，`tools/call p1b_doctor_leak_scan`）**：

```console
isError 缺席｜exit: 0
== 全库泄漏扫描（判据同源 gate）==
  库内总题 1994｜有 meta.cutoff 可扫 1368
  pass 1311｜★leak 21｜未判定 36（gate 不认字段 30／结构性 6）
  leak 按 kind：cwl_ssq_red_contains×1｜cwl_ssq_blue_odd×1｜eurostat_live_tertiary_attain×3｜
               noaa_solar_cycle_ssn_monthly×1｜delphi_fluview_num_ili×6｜
               eurostat_live_unemployment_monthly×3｜delphi_fluview_ili×6
  ★gate 不认的字段（单列，未改 gate）：{"resolve.week_start":10,"resolve.commence_utc":20}
  结构性无日期（单列）：{"resolve.issue":6}
```

---

## 4. 分组：审计 —— 「现在整体什么状态 / 契约有没有分家 / 冻结件被动过吗」

### 4.1 现在整体什么状态（一页看板）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「现在整体什么状态」「系统健康吗」「五层读数现在多少」「L0 门禁解锁了吗」 |
| **② 它调什么** | MCP `p1b_doctor_board`＝`node p1b/cli 体检 看板`＝`p1b/scripts/board.cjs`；HTTP 侧 `GET /api/audit/summary`（纯 SQL 只读聚合）、`GET /api/audit/g2-kpi`。取数源＝`p1a.db` ＋ `p1b/sim/out` 的最新落盘件 |
| **③ 得到什么** | `board` stdout：G2 五门（每门 `PASS/pending/report-only` ＋ 值）、采信链、五层读数、贝叶斯语义图例。`GET /api/audit/summary` ⇒ `{l0_gate:{gate,games,records,records_valid,resolved,unresolved,review_unlocked}, by_layer_checklist:[{layer,checklist_hash,n,tautology_n}], by_gate:[{gate,n}], layer_calibration:[…]}`。`GET /api/audit/g2-kpi` ⇒ `{kpi:{qualified_pool,hardest,out_of_domain,out_of_regime,unlayered,regime_rows,tautology_rows}, layer_brier_ci:[{layer,n,brier,ci_lo,ci_hi}], layer_gate:[…]}` |
| **④ 不能做什么** | **R 档只读，零写盘零写库**。**不出总分、不给裁决句**（门定性恒挂限定语：「过程能力门，不含质量读数」「对外表述恒挂限定语」）。**不混量纲**。**不给建议**。**不碰私钥** |
| **⑤ 越界了怎么办** | 缺最新落盘件 ⇒ 对应层报 `n/a`／`pending`，**不是 0、也不是「没问题」**。L0 未解锁（`n<30 局 ∧ <200 条`）⇒ `review_unlocked:false`，界面数字只配「参考」 |

**MCP/CLI 示例（真跑，`node p1b/cli 体检 看板`）**：

```console
推演沙盘 · 一页看板（2026-09-30T11:22:46.833Z）
== G2 五门 ==
  ① 合格题累计        PASS        值 1251
  ② 抽检合格率        pending     值 "-"
  ③ horizon 三层下限 PASS        值 "true"
  ④ 难度最难档        PASS        值 1057
  ⑤ 月节律（realtime_resolved 按自然月） report-only 值 "-"
  ② 采信 = accepted（校准 n=35，端用户 10/10）
  门定性 = 过程能力门（不含预测质量读数），对外表述恒挂限定语
== 五层读数（最新真跑件）==
  L1  账本  180 ｜ 出数  180 ｜ 可计分  180 ｜ Brier 0.0000 ｜ 正确率 1
  L2  账本  682 ｜ 出数  611 ｜ 可计分  434 ｜ Brier 0.2403
  L3  账本  654 ｜ 出数  654 ｜ 可计分  620 ｜ Brier 0.2386
  L5  账本  108 ｜ 出数  108 ｜ 可计分   56 ｜ Brier 0.1572
  L6  账本  270 ｜ 出数  270 ｜ 可计分  270 ｜ Brier 0.1755
  （分层报，禁跨层池化；读数口径见各层 note）
== 贝叶斯语义图例（记账语言，零精度增量宣称）==
  L1 deterministic_recalc（概率主干豁免）：决定论复算，Brier 语义=计算错误率
  L2 prior（基率+Wilson）：引擎 p 即统计基率，是先验不是新读数
  L3 prior+calibration（ACI 只调区间不调 p）：点估计恒为基率
  L4 annotation_layer（不出数）：后置叠加标注层，按设计不出概率
  L5 certified_prior（不可约随机）：p 即认证源公布分布，无信息优势可学
  L6 posterior_aggregation（似然证据行→固定规则聚合）：p=判词结构聚合
```

**HTTP 示例（真跑）**：

```console
$ curl -s http://127.0.0.1:8792/api/audit/summary
{"l0_gate":{"gate":"L0 只记不评：n≥30 局 ∧ 200 条前不评分，UI 数字只配「参考」；
             重言式题（tautology=1）不计入门禁",
             "games":77,"records":1994,"records_valid":1964,"resolved":1700,
             "unresolved":294,"review_unlocked":true},
 "by_layer_checklist":[{"layer":"L1","checklist_hash":"v1","n":30,"tautology_n":30},
                       {"layer":"L1","checklist_hash":"v2","n":150,"tautology_n":0}, …],
 "by_gate":[{"gate":"descriptive","n":1935},{"gate":null,"n":59}]}

$ curl -s http://127.0.0.1:8792/api/audit/g2-kpi
{"ok":true,"kpi":{"qualified_pool":1091,"hardest":961,"out_of_domain":1,"out_of_regime":1,
                  "unlayered":3,"regime_rows":1994,"tautology_rows":0},
 "layer_brier_ci":[{"layer":"L1","n":180,"brier":0.211482,"ci_lo":0.190083,"ci_hi":0.232882},
                   {"layer":"L2","n":476,"brier":0.238457,"ci_lo":0.22612,"ci_hi":0.250793}, …]}
```

### 4.2 契约表和源码有没有分家

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「契约表跟源码还对得上吗」「改了取数逻辑但没更新契约表，有没有被发现」 |
| **② 它调什么** | MCP `p1b_audit_g2_contract`＝`node p1b/cli 门禁 契约`＝`p1b/scripts/g2-contract-verify.cjs`。做法是**从源码派生**（全文件零 `writeFileSync`），再与冻结表 `p1b/sim/out/g2-contract-frozen-r4.json` 逐条对 |
| **③ 得到什么** | stdout 逐条 `[OK] <fn> → <fn>（required 5 ｜ 读取 6）` / `[BAD] …`，表头带 `源`、`冻结表`、`contracts 34 / aliases 25` |
| **④ 不能做什么** | **R 档只读**（零写盘、零写库）。**不改判据、不改表**（只复现与比对）。**不给建议**。**不碰私钥** |
| **⑤ 越界了怎么办** | `--strict` 下有 `missing_fn` / `frozen_not_read` ⇒ 退出码 1（`isError:true` ＋ `verdict.gate='ERROR'`）。exit 3 在这条命令上**没有登记**（它不在 `toolTable.EXIT3` 表里）⇒ 走缺省 `kind:'VERDICT'`，照该脚本头注读 |

**示例（真跑，`node p1b/cli 门禁 契约`）**：

```console
[p1b] 门禁 · 契约　R 只读　→ node p1b/scripts/g2-contract-verify.cjs
② 契约表源码派生复现检查（2026-09-30T11:20:54.103Z）
源: E:\music player\p1b\scripts\corpus-resolve.cjs ｜ 冻结表: …\sim\out\g2-contract-frozen-r4.json
    （contracts 34 / aliases 25）
[OK] _dbnMonthMean → _dbnMonthMean（required 5 ｜ 读取 6）
[OK] binance_daily_close → binance_daily_close（required 5 ｜ 读取 6）
[OK] cwl_ssq_red_contains → cwl_ssq_red_contains（required 2 ｜ 读取 2）
…                                    exit=0
```

### 4.3 PREREG 冻结件被动过吗

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「有人改过 PREREG 吗」「冻结块还对得上吗」「这个哈希还是当初那个吗」 |
| **② 它调什么** | MCP `p1b_audit_prereg_freeze`＝`node p1b/cli 门禁 冻结哈希 <文件>`＝`p1b/scripts/prereg-freeze.cjs`（重算 sha256 并与冻结登记比对） |
| **③ 得到什么** | stdout 六个字段：`file` / `blockLines`（登记块行号区间，**排除在哈希外**）／`sha256` / `recorded` / `MATCH`（布尔）／`口径` |
| **④ 不能做什么** | **R 档只读**（只有显式 `--write` 才会改文件，**本层不给**）。**不改口径重算**。**不给建议**。**不碰私钥** |
| **⑤ 越界了怎么办** | 缺位置参数 ⇒ exit 2 用法错（`isError:true` ＋ `verdict.gate='USAGE'`）。★**exit 3 在这条命令上是真崩溃不是裁决**（`prereg-freeze.cjs:66` 的解析异常，`EXIT3.kind='CRASH'`）——**与 `p1b_audit_anchor_gate` 的 exit 3 语义相反，别把两者的读法互换**。★`MATCH=false` 时**必须原样报告「冻结件已被修改」**，不要重试、不要说成通过 |

**示例（真跑）**：

```console
$ tools/call p1b_audit_prereg_freeze {"prereg_file":"…/docs/specs/PREREG-base-rate-decision-value-v1.md"}
isError 缺席｜exit: 0
file      = E:\music player\docs\specs\PREREG-base-rate-decision-value-v1.md
blockLines= 5..35（登记块，排除在哈希外；`---` 行计入）
sha256    = 619ac53a59769c2f3860ff9880788e1f61c439c7192e5760aa13e94362b80375
recorded  = 619ac53a59769c2f3860ff9880788e1f61c439c7192e5760aa13e94362b80375
MATCH     = true
口径      = 文件除登记块（第 5-35 行）外全部原始字节，sha256，字节级（`---` 计入哈希）
```

### 4.4 结算语料（W+N 档 · 唯一的联网件 · 确认闸）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「把到期没结的题去查一下真值」「跑一轮结算」 |
| **② 它调什么** | MCP `p1b_settle_corpus`＝`node p1b/cli 结算 语料`＝`p1b/scripts/corpus-resolve.cjs`（零 LLM，按 `evidence_json[0].resolve` 的参数机械 resolve），**打网 6 个数据源 ＋ 写 `p1a.db`** |
| **③ 得到什么** | MCP 侧**永远是** `isError:false` ＋ `gate_not_confirmed:true` ＋ `verdict:{gate:'NOT_CONFIRMED',do_not_retry:true}` ＋ `will_execute:"node p1b/scripts/corpus-resolve.cjs --confirm"` ＋ `hint` |
| **④ 不能做什么** | **这条工具永远不会真的结算**（确认闸在 spawn 之前 return，**子进程一次都没起、一次网络都没发**）。**不要重试**：重试不会让它执行。要真结算 ⇒ 把 `will_execute` 原样交给人类在终端里亲自加 `--确认`。**不代替使用者下结论** |
| **⑤ 越界了怎么办** | 部署侧 `P1B_MCP_ALLOW_NET=0` ⇒ 这条工具**从 `tools/list` 里消失**（21→20），调用它 ⇒ 协议级 `-32602`「工具已按部署策略下线（不联网）」 |

**示例（真跑）**：

```console
$ tools/call p1b_settle_corpus {}
isError 缺席（= false）           ★闸在工作，不是失败
exit: 2
verdict: {"gate":"NOT_CONFIRMED","do_not_retry":true}
will_execute: "node p1b/scripts/corpus-resolve.cjs --confirm"
content[0].text:
  ✗ 这是写库命令，默认只读 ⇒ **未执行**（子进程未启动）。
    组·命令：结算 语料　档位：W 写库·N 打网
    写库　：p1a.db（生产账本）　打网：是
    将要执行：node p1b/scripts/corpus-resolve.cjs --confirm
    确认执行请加：--确认（或 --confirm）
```

### 4.5 到期欠账对账（★当库用）

| 栏 | 内容 |
|---|---|
| **① 用户这么说** | 「到期口径有哪几套」「这批 kind 推不推得出到期日」「哪些行存的和推的不一样」 |
| **② 它调什么** | `node p1b/cli 体检 欠账`（`p1b/scripts/_b1-matures-audit.cjs`）。**表头部分直接 require `p1b/src/evidence/dueBranches.js`**（只读契约文件、零 db、零写盘）并**只打印它已导出的东西，不复制它的判定逻辑**（`cli/index.cjs:157-161`）。★**当库用**＝`require('p1b/src/evidence/dueBranches.js')` |
| **③ 得到什么** | 表头：契约覆盖表（9 个 `pair → kind[]` 分组 ＋ 组数/kind 合计/显式登记未实现）+ 欠账明细 `{R4_rows, stored_nonnull, derived_ok, match, mismatch, stored_null_but_derivable, underivable, mismatch sample[], …by kind}`。库用形态给 `{CONTRACT_PATH, DATE_DERIVATIONS, DERIV_BY_PAIR, PAIRS, UNIMPLEMENTED, pairOf}` |
| **④ 不能做什么** | **R 档只读**。**只登记分组、不登记「实现状态」**——推不推得出由 `dueOf` 现场判定（`UNIMPLEMENTED` 是登记项，**刻意不与实现状态挂钩**）。**不给建议**。**不碰私钥**。A 件（`dueBranches.js`）缺失时**降级提示、不报错** |
| **⑤ 越界了怎么办** | `dueOf` 推不出且该组没在 `UNIMPLEMENTED` 登记 ⇒ 覆盖断言红（`p1b/test/corpus-resolve-dueof.test.cjs` 第 ⑧ 例）。`pairOf(未登记的 kind)` ⇒ 返回 `null`（**不是**编一个 pair） |

**★当库用示例（真跑）**：

```console
$ node -e "const d=require('./p1b/src/evidence/dueBranches.js');
           console.log('PAIRS =',JSON.stringify(d.PAIRS));
           console.log('pairOf(\"dbnomics_series_value\") =',JSON.stringify(d.pairOf('dbnomics_series_value')));
           console.log('DATE_DERIVATIONS[\"dbnomics_series_value\"] =',
             JSON.stringify(d.DATE_DERIVATIONS['dbnomics_series_value']));
           console.log('UNIMPLEMENTED 键 =',JSON.stringify(Object.keys(d.UNIMPLEMENTED)));
           console.log('CONTRACT_PATH basename =',require('path').basename(d.CONTRACT_PATH));"
PAIRS = ["end/daily","epiweek/weekly","issue/draw","month/monthly","period/monthly",
         "week/weekly","week_end/daily","week_start/weekly","year/yearly"]
pairOf("dbnomics_series_value") = "period/monthly"
DATE_DERIVATIONS["dbnomics_series_value"] =
  {"source_key":"period","granularity":"monthly",
   "rule":"date = last_day(月 + 1 个月)；输入 YYYY-MM，输出次月最后一日 YYYY-MM-DD",
   "approximation":"conservative_upper_bound","note":"保守近似＝月度值发布窗口上界"}
UNIMPLEMENTED 键 = ["epiweek/weekly","end/daily","week/weekly"]
CONTRACT_PATH basename = g2-contract-frozen-r4.json
```

---

## 5. 形态速查表（按「用户会问什么」索引）

| 组 | MCP 工具 | CLI | HTTP | 当库用（最短的路） |
|---|---|---|---|---|
| 打分 | `p1b_read_stage4` | `读数 分层` | `GET /api/predictions/calibration`｜`GET /api/audit/g2-kpi` | `l2_baseline.l2Baseline()` |
| 打分 | `p1b_where_i_bias` | —（CLI 侧无对应命令） | `GET /api/disclosure/habits` | `habitRank.rankHabits(cells)` |
| 打分 | `p1b_read_calibration`｜`p1b_read_u8_columns`｜`p1b_read_verdict_spread` | `读数 校准`｜`读数 列`｜`读数 判词离散度` | `GET /api/disclosure/calibration`｜`…/verdict-spread` | `calibration/index.js`（`isotonic`/`betaCalibration`/`platt`/`clampProb`） |
| 打分 | — | — | `GET /api/baseline/:kind` | `l2_baseline.wilson()` |
| 记账 | `p1b_note_record`（确认闸） | —（CLI 侧无对应命令） | `POST /api/predictions`｜`POST /api/games/:id/predictions`｜`POST /api/intake/classify` | `predictionsStore.deriveMaturesAt()` |
| 记账 | — | — | `POST /api/predictions/:id/resolve`｜`GET /api/predictions/unresolved`｜`GET /api/predictions/:id` | `predictionsStore.maturityState()` |
| 记账 | — | — | `GET /api/games/:id/predictions` | `predictionsStore.LAYERS` / `OUTCOMES` / `CORE_INSERT_KEYS` |
| 裁决 | `p1b_which_layer` | —（CLI 侧无对应命令） | — | `revealClass.classifyReveal()` ＋ `resolveKind.isSupportedKind()` |
| 裁决 | `p1b_audit_anchor_gate` | `门禁 锚点` | `POST /api/intake/classify` | — |
| 裁决 | `p1b_doctor_leak_scan` | `体检 泄漏` | `GET /api/intake/rejects` | — |
| 审计 | `p1b_doctor_board` | `体检 看板` | `GET /api/audit/summary` | — |
| 审计 | `p1b_audit_g2_contract` | `门禁 契约` | `GET /api/audit/g2-kpi` | — |
| 审计 | `p1b_audit_prereg_freeze` | `门禁 冻结哈希` | — | — |
| 审计 | `p1b_doctor_matures_audit` | `体检 欠账` | — | `dueBranches.PAIRS` / `pairOf()` / `DATE_DERIVATIONS` |
| 审计 | `p1b_settle_corpus`（W+N 确认闸） | `结算 语料` | — | — |
| 审计 | `p1b_backup_offsite`（F 档确认闸）｜`p1b_backup_restore_drill` | `备份 异地`｜`备份 演练` | — | — |

**MCP 21 条全表**（`tools/list` 真跑，顺序即返回顺序）：

```
p1b_doctor_board              p1b_doctor_exp_health        p1b_doctor_leak_scan
p1b_doctor_file_map           p1b_doctor_matures_audit     p1b_settle_corpus
p1b_read_g2_report            p1b_read_stage4              p1b_read_calibration
p1b_read_u8_columns           p1b_read_verdict_spread      p1b_read_kind_table
p1b_audit_anchor_gate         p1b_audit_g2_contract        p1b_audit_prereg_freeze
p1b_audit_g2_audit_build      p1b_backup_offsite           p1b_backup_restore_drill
p1b_note_record               p1b_where_i_bias             p1b_which_layer
```

**HTTP 62 端点全表**（`grep` 真扫，按文件分组）：

| 文件 | 端点 |
|---|---|
| `server.js` | `GET /api/health` |
| `routes/games.js` | `GET /api/games`｜`GET /api/games/:id`｜`GET /api/games/:id/state`｜`GET /api/games/:id/export`｜`POST /api/games`｜`PUT /api/games/:id/seats` |
| `routes/events.js` | `GET /api/games/:id/botc-claims`｜`POST /api/games/:id/events/macro`｜`POST /api/games/:id/events/extract`｜`POST /api/games/:id/events/confirm`｜`POST /api/games/:id/claims/:claimId/edit`｜`POST /api/games/:id/claims/:claimId/retract`｜`POST /api/games/:id/actions/:actionId/edit`｜`POST /api/games/:id/actions/:actionId/retract`｜`POST /api/games/:id/botc-claims/:claimId/edit`｜`POST /api/games/:id/botc-claims/:claimId/retract` |
| `routes/advise.js` | `POST /api/games/:id/day/:n/advise`｜`GET /api/tasks/:taskId`｜`GET /api/games/:id/cards`｜`GET /api/games/:id/cards/:day` |
| `routes/providers.js` | `GET /api/providers`｜`GET /api/providers/effective`｜`PUT /api/providers/:key`｜`DELETE /api/providers/:key`｜`POST /api/providers/:key/activate`｜`POST /api/providers/:key/test` |
| `routes/oracle.js` | `GET /api/games/:id/oracle` |
| `routes/oracleCast.js` | `POST /api/oracle/cast`｜`GET /api/oracle/readings` |
| `routes/oracleInterpret.js` | `POST /api/oracle/interpret` |
| `routes/predictions.js` | `GET /api/games/:id/predictions`｜`GET /api/predictions/unresolved`｜`GET /api/predictions/calibration`｜`GET /api/predictions/domains`｜`POST /api/games/:id/predictions`｜`POST /api/predictions`｜`POST /api/predictions/:id/resolve`｜`GET /api/predictions/:id` |
| `routes/verdicts.js` | `POST /api/games/:id/predictions/:pid/verdicts` |
| `routes/audit.js` | `GET /api/audit/summary` |
| `routes/auditKpi.js` | `GET /api/audit/g2-kpi` |
| `routes/adapters.js` | `GET /api/adapters` |
| `routes/intake.js` | `POST /api/intake/classify`｜`GET /api/intake/rejects`｜`GET /api/intake/questions` |
| `routes/baseline.js` | `GET /api/baseline/:kind` |
| `routes/disclosure.js` | `GET /api/disclosure/calendar`｜`/calibration`｜`/habits`｜`/negative-results`｜`/verdict-spread`｜`/resolve-queue`｜`/bayes-lens`｜`/arena`｜`/compiler` |
| `routes/analytics.js` | `POST /api/analytics/session/start`｜`/session/end`｜`/event`｜`/claim`｜`GET /api/analytics/questions`｜`/summary` |

---

## 6. 这份目录**没有**回答的问题（自认缺口）

1. **「装上它」的具体接入步骤没写到可复制的程度**。MCP 那行客户端配置在本机跑通了
   （`tools/list` 21 条），但**没有对任何真实第三方客户端（如某个 IDE 的 MCP 设置界面）做过端到端联调**；
   §0.4 的「没有握手、只有 2026-07-28 三个方法」意味着**老客户端直连会失败**，需要哪一类客户端能连，
   没有验证。`ttlMs` 未填（`docs/specs/2026-09-29-MCP适配层说明.md:70-73` 记录的已知偏离），
   严格按 schema 校验的客户端可能拒收 `tools/list` 返回体。
2. **62 个 HTTP 端点里，只有本文出现的那些**贴了真跑输出。剩下约 40 个（对局事件、参谋卡、
   供应商管理、玄学三法、判词生成、analytics 遥测等）**没有逐条核对过**——它们不在四组能力范围内，
   本文只列了路径。**「列了」不等于「验过」**。
3. **CLI 那 18 条里，有 10 条没有实跑过**（`体检 跑批`／`体检 文件全图`／`读数 G2门`／`读数 列`／
   `读数 判词离散度`／`读数 kind目录`／`门禁 抽检清单`／`备份 异地`／`备份 演练`，以及未在本文出现的
   `读数 kind目录` 之外的读数件）——只核了命令表里的档位与 `build()` 参数注入规则，**没有逐条跑过**。
   实跑过的是：`体检 看板`／`体检 泄漏`／`体检 欠账`／`门禁 契约`／`门禁 锚点`／`读数 分层`／`读数 校准`
   ＋经 MCP 跑的 `p1b_audit_prereg_freeze`／`p1b_settle_corpus`（确认闸）。
   ★`备份 异地`／`备份 演练` 需要一个真实的异地备份目录，本仓没有 ⇒ 没跑。
4. **「当库用」这一栏只覆盖了纯函数模块**。需要开 db 句柄的 store
   （`predictionsStore.insertPrediction` / `l0Gate` / `calibration` 等）**没有库用示例**——
   它们在 `require` 时会连带打开连接，不属于「最轻」这条路。
5. **`GET /api/baseline/:kind` 的 n<30 那一档没有实跑输出**（真库里所有 kind 都够样本或 `no_rows`，
   没造出「有若干条但不足 30」那一档）。该分支的行为是从 `p1b/src/engines/l2_baseline.js`
   的 `n < minN` 判定与 `routes/baseline.js:162` 的响应拼装读出来的，**不是跑出来的**。
6. **写入示例全部跑在 `.tmp/p1a-copy.db` 库副本上**（生产库 `p1a-terminal/data/p1a.db`
   一个字节没动，跑完核对过 mtime 仍是本会话开始前的值）。副本上的 `id=2010/2009`
   是副本自己的行号，**生产库上的 id 不一样**。
7. **本目录不在发行包里**。根 `package.json` 的 `files` 数组收的是 `docs/RIGHTS.md`，
   **没有 `docs/mcp/`** ⇒ 发行闸 C3 扫发行树时**根本看不到这份目录**。
   自检测试里那条「C3 同款」是照 `p1b/scripts/audit-release.cjs:60-79` 的判定口径复刻的
   （只判像连接目标的非本机 IPv4），**不是**真闸本身。
   要不要把 `docs/mcp/` 加进 `files`，**是一个打包决策，本轮没做**（超出本批授权面）。
8. **自检测试只钉「目录与真源对得上」，不钉「目录里的结论对不对」**。
   它能发现「写了不存在的工具/端点/文件」，发现不了「把 `ok` 写成了 `human`」——
   后者要靠 §3.1 那样的真跑输出与 `revealClass.js` 逐条对，属于人工复核。

---

## 7. 这份目录怎么被守住

`p1b/test/capability-catalog.test.cjs`（11 条断言，零写库、零网络、零子进程）守四件事：

1. **五栏齐**：每个 `### N.y` 能力块必须有 ①②③④⑤，且 ④ 那一格的实质文字 ≥ 20 字符
   （**空栏比没栏更坏**——它看起来像有边界）。
2. **标识符对得上真源**：目录里出现的每一个 `p1b_*` 工具名、`/api/...` 端点、
   「组 命令」CLI 对、仓内文件路径，都必须真的存在；**且 21 条工具一条都不许从目录里消失**
   （漏写比写错更难发现）。
3. **每条能力带一个真跑过的示例**：每个能力块至少一个 ` ```console ` 围栏；
   另外扫一串搪塞/占位词（清单在测试文件的 `搪塞词` 数组里，**本文不把它们抄出来**——
   抄出来就会被同一条断言照红，测试文件的注释记着这个自指陷阱）。
4. **令牌门那一节不许被删**（§0 的六条关键词：共享令牌、请求头名、401、拒绝启动、开网地址、静态资源）。

**「不许空跑绿灯」怎么保证**：②③ 与「每组至少一条当库用」这几组断言全是遍历型的——
它们的绿灯完全取决于「提取到了东西」。所以每组前面都有一条**同级前置断言**先把提取条数钉死
（工具名 ≥21、端点 ≥15、CLI 对 ≥10、文件路径 ≥20、能力块 ≥10、分组节 ＝4），
并额外要求真源侧非空（`tools/list` ≥20 条、路由扫描 ≥50 条，取不到就抛而不是返回空数组）。
**没有这些前置，判据会从「全部对得上」退化成「数组为空时全部通过」。**

**发行闸 C3 同款**：自检里那条照 `p1b/scripts/audit-release.cjs:60-79` 的口径复刻
（只判「前文带 `://`、或后文带 `:端口`、或前文带 `userinfo@`」的非本机 IPv4；
`127.0.0.1` / `0.0.0.0` 放行；`x.x.x.0/16` 这种网段说明文字不判红）。

**跑法**（本轮实跑）：

```console
$ node --test p1b/test/capability-catalog.test.cjs
✔ 目录件在位：存在、非空、UTF-8、LF 行尾
✔ 四组齐：打分 / 记账 / 裁决 / 审计
✔ ★令牌门一节在位：连不连得上 / 连上要不要钥匙 / 拒绝启动组合，三条都答了
✔ 每条能力五栏齐，且「不能做什么」不许空
✔ 每条能力都带一个真跑过的示例围栏；全文无搪塞词
✔ 目录里的每个 MCP 工具名都真存在（遍历不空跑）
✔ 目录里的每个 /api 端点都真注册（遍历不空跑）
✔ 目录里的每个「组 命令」CLI 对都真存在（遍历不空跑）
✔ 目录里的每个仓内文件路径都真在盘上（遍历不空跑）
✔ 四组各至少有一条「当库用」（require 即用的最短路）
✔ ★发行闸 C3 同款：目录里没有「看起来像真端点」的非本机 IPv4
ℹ tests 11   ℹ pass 11   ℹ fail 0
```
