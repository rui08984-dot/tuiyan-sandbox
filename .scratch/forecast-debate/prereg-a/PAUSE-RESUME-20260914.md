# 补漏跑批 · 暂停与续跑交接（2026-09-14 凌晨 · 用户令暂停，剩余明天跑）

> 用户令（原话）：「不急如果现在那个还可以用就先不测试了先进行暂停然后测试数据出来的就落盘文件里面剩下的明天跑」
> 本文件＝明天续跑的唯一入口；状态断点以 run-state-full1-repair.json 与 p1a.db 为准，本文件只做索引与留档。

## 0. 一句话现场
- 全量主跑条件：**state done=720/720**（全部 HTTP 200）
- 补漏待办：**retry_pending=370 条件**（每条含 v1_evidence / v2_skeptical / v3_baserate 三路失败变体）
- DB 已收判词（run_id LIKE preregA-full1-%）：**1055 行，全部 tokenrhythm/glm-5.3-flash**
- 最后落库：created_at 15:20:36 UTC ＝ 本地 23:20:36（注意：**DB 的 created_at 是 UTC，本地＝UTC+8**）
- 探针（2 条真实判词）23:22:16 启动、23:24:20 按令停止：**无完成样本**（新增行 0）
- 今晚不会自动跑：13 个计划任务（preregA-repair + preregA-w0..w11）**已全部 Disabled**

## 1. 分臂明细（DB 实测，UTC 时间窗 11:14:54 → 15:20:36）
| run_id | 行数 |
|---|---|
| preregA-full1-A-cutoff | 306 |
| preregA-full1-A-full | 214 |
| preregA-full1-B-full | 177 |
| preregA-full1-C-cutoff | 144 |
| preregA-full1-B-cutoff | 143 |
| preregA-full1-C-full | 71 |
| **合计** | **1055** |

- 最后 3 行（按 id 插入序）：id=3662 / 15:20:36 / B-cutoff；id=3661 / 15:20:14 / B-cutoff；id=3660 / 15:19:26 / B-cutoff
- 探针窗口（>= 2026-09-13 15:22:00 UTC）新增行：**0**
- 口径提醒：全量目标 ≈ 720 条件 × 3 变体 = 2160 行；当前 1055 行，缺口约 1105 行（以 PREREG 判据口径为准，勿以本行数直接下结论）

## 2. 根因与已修（都有证据）
### 根因①：上游 tokenrhythm 严重劣化（实测）
| 探测 | 结果 |
|---|---|
| GET /v1/models（带 key） | HTTP 200 @ 107ms，19 个模型，**glm-5.3-flash 在列**（key 有效） |
| POST /v1/chat/completions（带 key，max_tokens=4） | HTTP 200 但耗时 **24,353ms** |
| POST /v1/chat/completions（无 key 对照） | HTTP 401 @ 61ms |
| GET https://tokenrhythm.studio/ | HTTP 200 @ 149ms |
| 对照：baidu 200@310ms / api.deepseek.com 401@68ms | 本机出网正常（Mihomo TUN 198.18.0.1） |

结论：**不是断网也不是 key 失效，是上游对生成请求极端慢**；昨晚 21:46 那次的「永不回包」是同一劣化的极端个例。

### 根因②：p1b 的 LLM 调用无请求超时
- 生产路径 ctx.fetchImpl 恒 undefined → 落到 p1a-terminal/src/llm.js 的全局 fetch（该处无 signal/超时）→ 上游不回包则**永久挂死**
- 已修：p1b/src/llmOptions.js 增加 timeoutFetch（未注入 fetchImpl 时默认套 AbortController 超时；默认 120000ms，可用 **P1B_LLM_TIMEOUT_MS** 覆盖，<=0 关闭）
- 验证证据：本地黑洞服务器（POST 永不回包）→ **1512ms 抛 AbortError**（不再挂死）；node --test **226/226 全绿**
- 提交：**8f28ad2**（仅此一文件）；坑已记入 .dshwolf/buglog.json

### 更正记录（重要，防后手误判）
- 前一轮曾判「repair 实例零推进、已 wedge」→ **有误**。依据：DB 行一直在增长（id 3658..3662 落在本地 23:18:55–23:20:36），并非停滞。
- 误判来源：把「state 不写、stdout 0 字节」当作无进展——实际是 runner 设计（prereg-a-run.cjs 重试段只在收尾 saveState，日志只在收尾 console.log）。
- 处置：据此已 taskkill PID 85132（21:46 启动那个）。**无数据损失**：已成功判词在库；未完成项仍留在 retry_pending，重跑幂等（verdicts 落库 OR IGNORE，测试有覆盖）。
- 教训：判断跑批是否在推进，**只能看 DB 行增长**，不能看 state/日志。

## 3. 明天续跑步骤
1) 上游健康自检（先做，30s 上限）：用 providers.json 的 active 供应商发一条 max_tokens=4 的 ping；HTTP 200 且 < 60s 视为可用；> 120s 或超时＝仍劣化，暂缓。
2) 续跑（串行，带 10 分钟单请求超时）：
```
cmd /c "C:\Users\crx\AppData\Local\Temp\preregA-repair.cmd"
```
   等价的直接命令：
```
node p1b/scripts/prereg-a-run.cjs --limit=120 --tag=full1 --run-prefix=preregA-full1- --max-calls=2300 --max-cost=25 --state=.scratch/forecast-debate/prereg-a/run-state-full1-repair.json
```
   该 .cmd 已内置 P1B_LLM_TIMEOUT_MS=600000，日志写 repair.out.log / repair.err.log，末尾追加 EXITCODE 行。
3) 跑完后：bootstrap 计分（--run-prefix=preregA-full1-）→ 更新 docs/specs/命题A-全量消融判定报告-20260914.md（现为负结果止发，基于 1055 行；补漏后需重算并明确是否改判）
4) 若要恢复并发分片（**不建议**，上游劣化期会重演 370 条失败）：schtasks /change /tn preregA-wN /enable
5) 若要恢复今晚那类自动触发：schtasks /change /tn preregA-repair /enable（当前 Disabled）

## 4. 本次新踩的环境坑（防重蹈）
- **DB created_at 是 UTC**，本地读出来的时间要 +8；曾据此误判「6 小时没写」
- run 的 state/stdout 只在收尾落盘 → 不能用它们判断在跑与否，**看 DB 行增长**
- TCP 可连 ≠ HTTP 可用：探测上游必须发真实小请求（本次 4-token ping 24s，而 TCP 秒连）
- 计划任务 13 条是历史遗留（/sc once /st 23:59 + 手动 run），**到点会自动再触发**；本次已全 Disabled
- 12 路并发会显著抬高失败率（历史：12 并发出现 370 条 retry_pending，串行时偶发），劣化期只走串行

## 5. 续跑日志（2026-09-14 下午）

- **健康自检（步骤 1）**：`.tmp/prereg-a-health.cjs` → **HTTP 200 @ 1039ms**（provider=tokenrhythm / model=glm-5.3-flash；昨晚同法探测 24,353ms）⇒ 判定 **HEALTHY（<60s）**⇒ 放行续跑。
- **断点核对**：`run-state-full1-repair.json` `retry_pending=**370**`；库内前缀行 **1055**（与暂停时一致，无漂移）。
- **启动**：`cmd /c C:\Users\crx\AppData\Local\Temp\preregA-repair.cmd`（**串行**；`P1B_LLM_TIMEOUT_MS=600000`；`--max-calls=2300 --max-cost=25`）。
  昨晚日志先备份为 `repair-20260913.out.log.bak` / `repair-20260913.err.log.bak`（.cmd 用 `1>` 覆写）。
- **推进判据**：只看 **DB 行增长**（state/stdout 只在收尾写——昨晚教训；探测命令见 §0/§3）。
- **跑完后必做**：bootstrap 计分（`--run-prefix=preregA-full1-`）→ 更新 `docs/specs/命题A-全量消融判定报告-20260914.md`
  （现为负结果止发、基于 1055 行；补漏后**必须重算并明确是否改判**）。
- **杂记（本次踩坑）**：首次按 §3 用 `cmd /c "...preregA-repair.cmd"` 启动**失败**——Git Bash 的 MSYS 路径转换把 `/c` 当路径吞掉，cmd 只开了个交互壳即退（零工作量、日志 0 字节、DB 零增长）。
  改用 **node 直启**（同参数、保留 `P1B_LLM_TIMEOUT_MS=600000`）：启动后 **DB 4.5 分钟 +1 行** ⇒ 确认在跑。**cmd 脚本仅适合在原生 cmd/PowerShell 里执行**。
- **并发分片（w0..w11）与自动计划任务（preregA-repair）继续 Disabled**（劣化期教训：只走串行）。

## 6. 提速与队列修复（2026-09-14 下午 · 用户令「把思考拉低试试」）

### 6.1 降思考档（实测数据）
| 探测 | 结果 |
|---|---|
| 关思考 | `thinking={type:'disabled'}` / `enable_thinking=false` → **HTTP 400 `REASONING_REQUIRED`「当前模型必须开启深度思考」**（中转强制） |
| `reasoning_effort='low'`（max_tokens=2048） | 思考 token 1245→**562**（−55%）、单次 33.5s→**7.8s**（−77%），正常出可见文本 |
| `'minimal'` / `'none'` | 与默认档**无异**（无效） |
| 大提示词（≈4.5k tokens，真判词量级） | low 41.7s / 默认 17.4s（**方差大**，但都可用） |

- 实现：`p1b/src/llmOptions.js` additive 旋钮 `P1B_LLM_REASONING_EFFORT=low`（fetch 层合并请求体；**env 未设=零行为变化**；测试 3 例）。
- **PREREG 纪律**：本项属生成器档位变更 ⇒ 已落 **v1.1 增补条款**（`PREREG-命题A-3.0消融-v1.1-补漏档位-addendum.md`，**不动 v1 原件**）：
  补漏段 low 档生成、按生成期分层披露、方向不一致时以 regime A 为准（先验约定）。

### 6.2 重试队列陈旧修复（本轮的第二个真发现）
- **现象**：low 档重启后 20 分钟仍 0 新行、CPU 0.1s——一度被误判为「wedge 复发」（**更正：CPU 低不是 wedge 判据**——网络等待型循环本来就不吃 CPU；wedge 判据＝**首个请求不回包 + DB 零增长 + 日志零字节**三件套）。
- **真因**：`retry_pending` 头部**陈旧**——370 件中 **62 件全部 3 变体早已入库**（36 件部分在库、272 件真缺）。跑批在空转重跑已完成的题：`saveVerdict` 幂等（INSERT OR IGNORE）⇒ **0 新行但照烧调用**。
- **修复**：`retry_pending` 按 **DB 事实**裁剪（备份 `run-state-full1-repair.bak-2026-09-14T07-22-45-940Z.json`）：
  **370 件 → 308 件**（剔除 62 件已完成；15 件 `failed` 收敛为缺失变体）⇒ **实际缺口 = 858 次调用**。
- **修复后实测**：重启 3 分钟 **+9 行**，行间隔 **10~24s** ⇒ 全量补漏预计 **~3.5 小时**（此前估天数）。

### 6.3 教训（写入交接）
1. **判"在不在跑"不能只看 DB 增长**——还要看**队列是否陈旧**（幂等写会吞掉"零增长"）；本次差点又误判 wedge。
2. **CPU 时间不是网络型循环的活跃判据**（0.1s/20min 也可以是在正常轮询上游）。
3. 断点续跑前，先按 DB 事实**核对/裁剪**待办清单（幂等键 `(prediction_id, run_id, prompt_variant)`）。

## 7. 扫尾工具（2026-09-14 晚新增）

- **孤儿缺口**：真跑 retry 队列只收「报了变体名」的失败项；实测另有**未入队的缺口**（整请求失败/无名错误）。
- **工具**：`p1b/scripts/prereg-a-sweep.cjs`——按 **DB 事实**算全量缺口（120 题 × 2 窗 × 3 臂 × 3 变体）并逐条件用
  `onlyVariants` 通道补齐（与真跑同链同口径；幂等；不写 run-state）。
- **用法**：`node p1b/scripts/prereg-a-sweep.cjs`（dry-run 看缺口）/ `--confirm`（真补，env 同续跑：`P1B_LLM_REASONING_EFFORT=low`、`P1B_LLM_TIMEOUT_MS=600000`）。
- **时机**：**在补漏跑批结束后**执行（补漏期间跑会对同一批条件重复发请求——幂等但浪费）。
- **收尾顺序**：补漏跑完 → `sweep --confirm` → bootstrap 计分（`--run-prefix=preregA-full1-`）→ 按 v1.1 分层重算判定报告。
