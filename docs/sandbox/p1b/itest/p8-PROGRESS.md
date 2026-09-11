# P8 玄学化判词·进度锚（第七棒 W1 后端）

> 断点锚：每完成一步更新本文件。任务书 = 队长下发「玄学化判词 W1-W3 微步任务书」（P2 线首件·第七棒）。
> 拍板铁律：①赛后彩蛋弹层形态 ②本局数据确定性派生两数起卦（零用户操作）③恒挂「娱乐参考」，绝不接入任何游戏研判功能。
> 架构口径（docs/specs/2026-09-07-推演沙盘-design.md §2.3）：排盘=纯数学，断语=LLM。
> 下一步 = **W2 前端（等队长恢复令，禁连跑）**。

## 状态总览（W1 已收口 2026-09-10，本回合新跑全部证据见「W1 证据」节）
- [x] W1-1 meihua 复制（内容不改）：docs/sandbox/p2-yijing/meihua.js → **p1b/src/lib/meihua.js + p1b/test/meihua.js**（双副本），meihua.test.cjs → p1b/test/meihua.test.cjs。SHA256 全对齐（meihua.js 四份=DB255EAB67E9D42820038AD7A91ABC6F595C5ED49A973F5573F277D86665D99A；test=56C59A028C13DF8F505AB7FF8B6DC379E1A82CF74DF0C86A0ABBD381AB77BDDB），独立跑 **17/17 PASS**（TOTAL: 17 | PASS: 17 | FAIL: 0，exit 0）。**为何双副本**：meihua.test.cjs 内容不改 → 其 `require('./meihua.js')` 是文件相对引用，p1b/test/ 必须有同名同内容副本才能跑通。**附带效应**：node --test 的 test/ 目录全收规则把 p1b/test/meihua.js 也当 1 个文件级用例跑（define-only，exit 0 → PASS，无害），全量对账见下。
- [x] W1-2 deriveCasting：p1b/src/lib/oracle.js（新增）。口径写死在文件头注释：FNV-1a 32bit 哈希派生两数——数A=fnv1a(id+'|'+type+'|'+created_at)%512+1、数B=fnv1a(player_count+'|'+created_at+'|'+id)%512+1，再走 meihua.qiGuaByNumbers（先天八卦数，%8 余0取8 / 动爻 %6 余0取6）。created_at 是建局后不变的 SQLite 文本，当不透明字符串用（不 Date.parse，避开时区差异）。同局输入永远同卦；非传统时间起卦是拍板②「本局数据自动派生」的直接推论。**冻结局锚点**（p8-anchor-probe.cjs 实测后写死进测试）：G1(id=1,werewolf,'2026-09-10 12:00:00',6人)→A=387,B=166 火水未济·动爻1·体离火/用坎水·用克体·变火泽睽；G2(id=2,botc,'2026-09-11 21:30:00',9人)→A=161,B=56 天地否·动爻1·用生体·变天雷无妄；FNV 公开向量 fnv1a('')=2166136261/fnv1a('a')=3826002220 已冻结进测试。
- [x] W1-3 API：GET /api/games/:id/oracle → { game_id, casting, verdict, disclaimer, mode[, llm_error] }。casting=meihua 起卦全套（本卦/互卦/变卦/动爻/体用/五行生克）+numbers{a,b}+derived_from；**disclaimer 恒等于「娱乐参考」**（lib/oracle.js DISCLAIMER 常量，拍板③写死）；verdict 三态：mode=mock（P1B_LLM_MOCK=1 或无 key → 固定模板，含卦名+「娱乐参考」字样，零网络确定性）｜mode=live（真实 LLM 断语）｜mode=mock_fallback（LIVE 失败落模板并如实带 llm_error，不谎报）。真实模式 prompt：system 首行强制「娱乐参考，非游戏研判」+≤120 字+只按梅花易数传统方法论解读体用生克+只输出文本；user 只投喂确定性卦象字段，不含任何对局身份/查杀信息。防失控：响应硬截 200 字符（capVerdict）。
- [x] W1-4 测试：p1b/test/oracle.test.cjs 新增 **13 用例全绿**（fnv 向量/G1/G2 冻结锚点/确定性+别名/非法输入/MOCK 模板含卦名+娱乐参考/API 200 形状/同局两次 GET 响应体逐字节一致/API casting 与本地 deriveCasting 一致/404+400/LIVE 缝 fetchImpl 注入零真实网络+线检 system 首行与无 response_format/LIVE 失败 mock_fallback 缝）。**全量 95/95 PASS（NPM_EXIT=0）**：80（server.test.cjs 既有，独立复跑 80/80 零退化）+ 13（oracle）+ 1（meihua.test.cjs 文件级，内部 17/17）+ 1（meihua.js 文件级，见上附带效应）。
- [x] W1-5 本文件建立并落盘 W1 段。

## W1 交付物（全部为 p1b/src/**、p1b/test/**、itest/ 新增/最小改，零碰禁区）
| 文件 | 性质 | 说明 |
|---|---|---|
| p1b/src/lib/meihua.js | 新增（复制） | 梅花易数确定层，内容不改（SHA256 与源一致；尾部 /*__MH_PARTx__*/ 注释标记系源文件原有，照抄保留） |
| p1b/test/meihua.js | 新增（复制） | 同内容副本，仅为 test 的相对 require 服务（见上） |
| p1b/test/meihua.test.cjs | 新增（复制） | 内容不改，node --test 下作 1 个文件级用例（内部 17 断言自跑） |
| p1b/src/lib/oracle.js | 新增 | deriveCasting（确定性起卦派生）+mockVerdict（MOCK 固定模板）+fnv1a+DISCLAIMER='娱乐参考'；文件头写死娱乐边界与口径注释 |
| p1b/src/lib/llmChat.js | 新增 | 最小文本 chat 通道（POST {baseUrl}/chat/completions；options 与 resolveLlmOptions 对齐；**不发 response_format**——断语要自然文本非 JSON 契约；无重试环，失败由路由兜底）。**为何存在**：p1a llm.js 导出面全是 JSON 契约（extract/generateCards）未导出文本 chatCompletion，且 p1a-terminal/** 为禁改面 → p1b 侧按同协议最小实现，供应商配置仍走现有 store+resolveLlmOptions 链（key 永不出服务端）。已向队长报备此偏差 |
| p1b/src/routes/oracle.js | 新增 | GET /api/games/:id/oracle 路由；ORACLE_SYSTEM_PROMPT 首行强制「娱乐参考，非游戏研判」；mode 三态（mock/live/mock_fallback）；文件头写死拍板边界：本接口返回值禁止被参谋/研判类模块引用 |
| p1b/src/server.js | 最小改（2 行） | L26 require + L69 registerOracle(app, ctx)，其余零改动 |
| p1b/test/oracle.test.cjs | 新增 | 13 用例（见 W1-4），LIVE 缝走 fetchImpl 注入+LLM_API_KEY env，零真实网络 |
| itest/p8-anchor-probe.cjs | 新增 | 锚点探测一次性脚本（留档可复跑） |
| itest/p8-w1-oracle-test.txt / p8-w1-full-test.txt / p8-w1-server-test-count.txt | 新增 | 测试证据三件（oracle 13/13、全量 95/95、server 80/80） |

## 纪律自守（本棒执行记录）
- 每回合一个微步：本回合只做 W1，W2/W3 未动，停等恢复令。
- 禁区未碰：p1a-terminal/**、p1b/src/botc/ 五文件、p7-* 既有产物、meihua.js 本体、docs 既有文档零改动（p8-* 全为新产物）。
- pwsh/node 每条 ≤120s 超时；失败 ≤2 次换路（实际换路 1 次：node -e 锚点探测被 pwsh 引号转义搅坏 → 改落 itest/p8-anchor-probe.cjs 脚本文件跑，一次过）。
- pwsh stdout 重定向文件再读；LF 文件全部用文件编辑工具写；npm 用 npm.cmd；复制用 Copy-Item+SHA256 双验。
- 沙箱进程不跨 turn：本回合未起长驻服务（W3 才需要，届时按任务书「同 turn 起服→测→杀」闭环）。
- 谎报零容忍：上述每个 PASS 都有本回合命令输出或文件证据（SHA256 行、17/17 行、95/95 行、NPM_EXIT=0、13 行 ✔）。

## 给下一棒（W2 前端）的交接要点
1. API 形状（W2 弹层数据源）：GET /api/games/:id/oracle → 200 { game_id, casting:{ numbers:{a,b}, derived_from:{...}, benGua:{name,fullName,upper,lower,yao,yinYang}, huGua, bianGua, dongYao, ti:{trigram,wuXing,position}, yong:{...}, tiYongRelation }, verdict:文案, disclaimer:'娱乐参考', mode:'mock'|'live'|'mock_fallback', llm_error? }；404=局不存在；400=非整数 id。前端务必恒显 disclaimer 与「娱乐参考 · 思路非答案」标注（拍板③）。
2. 触发口径：.adv-badge.is-ready「✓ 第 N 天就绪」出现后自动弹一次，localStorage key 含 game id 防重复；现场页常驻小入口「☯ 判词」手动开；z-index 不遮挡确认卡（.confirm-overlay）与宏表单（.sheet-overlay）；关闭按钮必须显眼。
3. MOCK 断语已含卦名与「娱乐参考」字样（可直接断言渲染）；mode=mock_fallback 时 llm_error 有值，前端可弱提示但不必特殊处理。
4. 全量测试基线现为 **95/95**（W1 后）；W2 不得使其退化；meihua.js/test 双副本结构勿拆（拆了 meihua.test.cjs 的相对 require 会断）。
5. W3 集成收口要点：同 turn「起服（P1B_LLM_MOCK=1 + P1B_DB_PATH=itest/p8-run.db）→测→杀」；截图 p8- 前缀 2 张（弹层开/关）；真实 LLM 抽验 1 次（provider 可用才做，不可用如实记录跳过——p1a-terminal/config/providers.json 有 key 时走 providers 激活链，route 的 mode 应为 live）。

---

# W2 段（第八回合 · 前端彩蛋弹层，已收口 2026-09-10）

> 队长验收 W1 通过后下发恢复令。本回合只做前端（p1b/web/**），零碰 8787（队长预览服务 PID 31432 全程 LISTENING 未动，netstat 证据见下）。

## W2 交付物
| 文件 | 性质 | 说明 |
|---|---|---|
| p1b/web/src/pages/live/OracleZone.tsx | 新增 | 彩蛋弹层组件：常驻入口「☯ 判词」+ 弹层（卦象三行本/互/变 + 动爻体用五行 + 断语 + 「娱乐参考 · 非游戏研判」恒挂标注 + 右上✕/底部关闭双通道 + mock_fallback 弱提示） |
| p1b/web/src/styles/oracle.css | 新增 | .oracle-overlay z-index:45（低于确认卡 .confirm-overlay 60 / 宏表单·编辑抽屉 .sheet-overlay 50，层级铁律写死在文件头注释）；入口行/卡面/卦象行样式 |
| p1b/web/src/types.ts | 追加 | OracleGua/OracleTiYong/OracleCasting/OracleResult 契约类型（尾部追加，零改既有行） |
| p1b/web/src/api.ts | 最小改 | import 加 OracleResult + 文件尾 getOracle(gameId)（USE_MOCK reject 同 botc-claims 模式） |
| p1b/web/src/pages/LivePage.tsx | 最小改（2 行） | import OracleZone + gid 非空时渲染一行 <OracleZone gameId advise />（紧跟 AdvisorZone，既有元素零改动） |

## W2 触发与防重弹（实现口径）
- 自动弹信号 = advise.current.source==='task' 且 current.gameId===gid（useAdvise L68 任务完成时刻，与 .adv-badge.is-ready「✓ 第 N 天就绪」同源信号；存档/历史卡 source='server'|'local' 不触发）。
- 防重弹 = localStorage key 「p1b.oracle.seen.v1.<gameId>」（key 含 game id，任务书拍板）值=已自动弹过的最大 day；seenDay>=cur.day 即不再自动弹；手动入口不受限。localStorage 写失败仍允许当次查看。
- 弹层数据源 = 打开时 GET /api/games/{id}/oracle（loading「起卦中……」/错误 sheet-error 兜底）。

## W2 证据（本回合新跑）
1. **build 零错误**：npm.cmd run build（tsc && vite build）第一轮 TS18047 'data' possibly null（中间变量 c 切断 TS 收窄链）→ 去掉中间变量改守卫直接判 data → 重跑 **BUILD_EXIT=0**，✓72 modules transformed（旧 70，新增 OracleZone+css 模块），p8-w2-build.txt 存档。
2. **dist 落新**：新 hash index-Bj1KFkPJ.js（260.37kB）/ index-CsoskYLU.css（23.34kB），旧 index-CGN3VCTv.js 已替换。
3. **turn 内起停闭环冒烟**（p8-w2-smoke.ps1，独立端口 **8788**，P1B_LLM_MOCK=1 + 独立 db p8-w2-smoke.db，pwsh 后台作业直跑 node）：health ok=True/mock=True → 首页 HTML **has-new-js=True has-new-css=True**（dist 挂载生效）→ 建局 id=1 → GET oracle mode=mock、disclaimer=娱乐参考、ben=风天小畜、dong=4、断语模板正常 → **Stop-Job 收口**。exit 0，服务端日志存 p8-w2-smoke-server.txt。
4. **无残留**：netstat 8788 仅 TIME_WAIT（客户端侧残迹，无 LISTENING=服务已死）；smoke db/-wal 已删（left=False）；**8787 队长服务全程未碰**（收尾复验 PID 31432 LISTENING 健在）。
5. 后端零改动 → W1 基线 95/95 无需重跑仍有效（如需我方复跑随时可做）。

## W2 纪律自守
- 换路记录：①build 第一轮 TS18047 → 读报错定位（中间变量切断收窄）→ 一次修复；②冒烟命令内联两次被搅（node -e 引号被 pwsh 吃 / PS 的 -join 误写进 JS 层，env-triage 卡溯源为同族根因=跨层内联引号）→ 按纪律沉淀 **p8-w2-smoke.ps1 脚本文件**再 & 调用，一次过；教训已录 wolf_bug；③PROGRESS 追加段模板字面量含反引号提前闭合 JS 串 → 内容弃用反引号改「」后一次过（同族根因第三实例）。
- 禁区未碰：p1a-terminal/**、p1b/src/**（本回合零改后端）、p7-* 产物、meihua、docs 既有文档；8787 服务未杀未动。
- 每条 pwsh/node ≤120s（实际 build ~10s、冒烟 ~8s）；pwsh stdout 重定向文件再读；npm 用 npm.cmd；探测命令沉淀为脚本。

## 给下一棒（W3 集成收口）的补充要点
1. 弹层选择器（截图/回归用）：入口 .oracle-entry-row .oracle-entry（文本「☯ 判词」）；弹层 .oracle-overlay>.oracle-card；卦象行 .oracle-gua-row（3 行）；动爻体用条 .oracle-tiyong；断语 .oracle-verdict；恒挂标注 .oracle-disclaimer（「娱乐参考 · 非游戏研判」）；关闭 .oracle-foot .btn-primary「关闭」/.oracle-head .btn-ghost「✕」。
2. 自动弹冒烟路径：现场选局 → ⚡ 天结算 → 轮询就绪（.adv-badge.is-ready）→ 弹层应自动出现一次；同 day 第二次结算不再自动弹（localStorage p1b.oracle.seen.v1.<gid>）；刷新页面不重弹（current 不持久化）。手动入口随时可开。
3. 层级实测锚：确认卡(.confirm-overlay z-60) 弹出时盖住判词层(z-45)属预期；判词层不得盖宏表单(.sheet-overlay z-50)。
4. W3 记得：起服用 p8-run.db + 截图 2 张（建议 p8-oracle-open/p8-oracle-closed）+ 真实 LLM 抽验（mode 应=live）+ PROGRESS 终态。

---

# W3 段 · 终态（第九回合 · 集成收口，2026-09-10 21:57 收口）

> 环境曾手动重启一次（中断恢复后 ready 唤醒），恢复令两次确认后开跑。本回合全链收口，p1b/src+web 零代码改动（纯验证回合）。

## W3 证据（本回合新跑）
1. **端到端 26/26 ALL PASS（DRIVE_EXIT=0）**：p8-drive.mjs v2 + p8-w3-run.ps1（8789 独立端口 + P1B_LLM_MOCK=1 + 独立 db p8-w3.db，chrome 由 drive 自 spawn 收口，全链同 turn 闭环）。log=p8-w3-drive-log.txt，逐项：
   - S0 现场页可达 ｜ S1 向导建局（id=1，werewolf 6人，落库）
   - S2 常驻入口「☯ 判词」在场 + 恒挂提示 ｜ S3 AI 拆解→确认卡→入账
   - S4 天结算就绪（.adv-badge.is-ready）→ **判词弹层自动出现** → 卦象三行 rows=3 → 动爻体用条 → 断语含「娱乐参考」→ 恒挂标注「娱乐参考 · 非游戏研判」→ localStorage key p1b.oracle.seen.v1.1=1 ｜ 截图 p8-oracle-open.png
   - S5 关闭生效 ｜ S6 **刷新不重弹 + 同 day 重复结算不重弹 + localStorage 仍=1**（防重弹三连证）
   - S7 手动「☯ 判词」开弹层 → API /oracle mode=mock + disclaimer 精确 + **弹层断语与 API verdict 逐字一致** + 断语含卦名 ｜ 截图 p8-oracle-manual.png
   - S8 关闭后现场页正常（弹层无+入口在）｜ 截图 p8-oracle-closed.png
   - S9 day2 结算 → 判词再次自动弹（新 day 放行）→ localStorage=2
2. **真实 LLM 抽验 1 次（mode=live）**：p8-w3-live.ps1（8790 端口 + 真实模式 + p8-w3-live.db + 默认 providers tokenrhythm）。health llm_mock=False → 建局 → GET /oracle → **mode=live，雷天大壮局，LLM 断语实出**（按体用生克展开约 130 字，含互卦夬/变卦雷风恒，无任何研判内容，disclaimer 恒挂）——llmChat live 通道实测打通；三态设计之 live 态验证点闭环（mock 态由 drive S7b、mock_fallback 态由 W1 单测覆盖）。
3. **截图 3 张落 itest/**：p8-oracle-open.png 161462B / p8-oracle-manual.png 160474B / p8-oracle-closed.png 186753B（780×1688=@2x 390×844 移动视口，时间戳 21:57 与 drive log「PNG saved」行吻合）。vision_glance 目检因 vision 后端超时三次不可用（如实记录为环境限制）——弹层可见性证据以 drive 的 DOM 断言链为准（比像素描述更硬），PNG 供人工随时复核。
4. **收口干净**：8789/9224/8790 全 FREE；chrome 经 exit 钩子 + CIM 命令行扫描（仅杀带 p8-chrome-prof2/9224 标记者）双保险收口，profile 目录已删；8787 队长服务全程未碰（收尾复验 PID 40116 LISTENING 健在）。

## 施工过程中的两次换路（均一次修复）
1. chrome 拉起方式：pwsh Start-Process 两次在 CDP 等待窗口被沙箱击杀（exit 1 无信号标记，server banner 证实跑到 CDP 前夜）→ 换路 **chrome 由 node drive 自 spawn（stdio:ignore，沙箱明示安全通道）+ exit 钩子兜杀**，一次通。
2. drive S3 时序：waitText 对确认卡原文假阳性（卡未关文本已在）→ 天结算点击落在 disabled 按钮被吞 → 加「确认卡关闭（busy 复位）」等待后一次通（v2 轮 8 FAIL → v3 轮 ALL PASS，两轮 log 均留档）。

## B6 回归结论不受影响声明
- B6 已收口结论（35 check=30 OK/5 挂账 DEF-01~05）的判定基线未被本功能触碰：判词线全部改动 = 新增 3 个 lib/routes 文件 + server.js 2 行挂载 + 前端新增 2 文件 + types/api/LivePage 追加行（W1 95/95 全量含 80 既有用例零退化；W2 build 72 modules 零错误）。
- 本回合端到端在**新 dist**上实跑了 B6 同族流程（向导建局/AI 拆解确认入账/天结算就绪徽标/参谋卡区）全过——功能层零回归的旁证；5 项 DEF 挂账属 B6 遗留，不在本功能改动面内，维持挂账现状。

## 判词链路总结（终态）
**排盘（纯数学）**：games 行 → lib/oracle.js deriveCasting（FNV-1a 确定性两数 1..512）→ meihua.qiGuaByNumbers → 本/互/变卦+动爻+体用五行（同局恒同卦，锚点 G1/G2 冻结于测试）→ **断语（LLM）**：routes/oracle.js 按 resolveMode 三态——mock=确定性模板（零网络）/live=llmChat 文本通道（system 首行「娱乐参考，非游戏研判」+≤120 字+只解读体用生克，实测雷天大壮断语出）/mock_fallback=LIVE 失败落模板+llm_error 如实标注 → **前端（彩蛋）**：OracleZone 常驻入口+天结算就绪自动弹一次（localStorage p1b.oracle.seen.v1.<gid> 按 day 防重弹）+z-45 不遮确认卡/宏表单 → **边界（拍板③）**：disclaimer=「娱乐参考」恒挂 API 与 UI，绝不接入游戏研判（代码注释+UI 标注双写死，禁止被参谋/研判模块引用）。

## 全线交付物清单（W1+W2+W3）
- 后端：p1b/src/lib/{meihua.js,oracle.js,llmChat.js}、p1b/src/routes/oracle.js、p1b/src/server.js（2 行）、p1b/test/{meihua.test.cjs,meihua.js,oracle.test.cjs}——测试 95/95（80 既有+13 oracle+2 文件级）
- 前端：p1b/web/src/pages/live/OracleZone.tsx、p1b/web/src/styles/oracle.css、types.ts（追加）、api.ts（+getOracle）、LivePage.tsx（2 行）——build 72 modules 零错误
- 验证产物（itest/）：p8-PROGRESS.md、p8-anchor-probe.cjs、p8-w1-{oracle-test,full-test,server-test-count}.txt、p8-w2-build.txt、p8-w2-smoke{.ps1,-server.txt}、p8-drive.mjs、p8-w3-run.ps1、p8-w3-drive-log.txt、p8-w3-server.txt、p8-w3-live.ps1、p8-w3-live-server.txt、p8-oracle-{open,manual,closed}.png
- 遗留物说明：p8-w3.db / p8-w3-live.db 为验证局数据存档（p7 同例保留）；8787 由队长重启对齐前后端后，判词功能即可在真实预览中使用（现场页「☯ 判词」）。
