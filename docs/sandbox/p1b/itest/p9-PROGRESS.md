# P9 玄学排盘正经化·进度锚（第八棒 W1 后端扩展，已收口 2026-09-10）

> 断点锚：每完成一步更新本文件。任务书 = 队长下发「玄学排盘正经化 W1-W3 微步任务书」（P2 线·第八棒）。
> 拍板铁律：独立玄学页 + 既有彩蛋弹层共存（纯增量）；恒挂「娱乐参考」标注，绝不接入任何游戏研判功能——「正经」指排盘工程完整度，不是研判能力（梅花查狼实验 docs/sandbox/p2-yijing/oracle-experiment-result.md 为边界数据背书）。
> 架构口径（docs/specs/2026-09-07-推演沙盘-design.md §2.3）：排盘=纯数学，断语=LLM。
> 终态 = **P9 全线收口（W1 后端三法 + W2 前端独立页 + W3 集成端到端全绿，2026-09-11）**。

## W1-1 时间起卦实现决策（决策+理由落盘）
- **决策：采 lunar-javascript@1.7.7（npm 依赖），弃手写农历压缩表。**
- 理由：①任务书口径「优先 npm install lunar-javascript」；②MIT、纯 JS、零原生依赖、CommonJS 直接 require，与 p1b 现有 Node 栈（fastify/better-sqlite3）无冲突；③公开历表事实五组锚点实测全对（见「W1 证据」），而手写 1900-2100 压缩表属重复造轮子、数据表出错面大且难快速交叉验证。
- 网络实测：npm registry 可达（npm.cmd view → 1.7.7，time.modified 2025-11-05）；npm.cmd install lunar-javascript --save → added 1 package in 2s，EXIT=0；p1b/package.json dependencies 新增 "lunar-javascript": "^1.7.7"，package-lock.json 生成。
- 回退路径：未来若需离线替换，lib/oracleCast.js 的 getLunarLib() 惰性加载缝是唯一替换点（数字/随机起卦不依赖历法库）。

## 状态总览（W1 已收口 2026-09-10，全部证据见「W1 证据」节）
- [x] W1-1 历法库决策（见上节）。
- [x] W1-2 p1b/src/lib/oracleCast.js：castByTime / castByRandom / castByNumbers 三法，全部转调 meihua.qiGuaByNumbers（零复制卦理；meihua.js 本体零改动——SHA256 复验 = DB255EAB67E9D42820038AD7A91ABC6F595C5ED49A973F5573F277D86665D99A，与 p8 记录一致）。
- [x] W1-3 历史档案：p1b/src/db/oracleStore.js 私有表 oracle_readings（CREATE TABLE IF NOT EXISTS additive；game_id NULLABLE REFERENCES games(id)；verdict 留结构位、排盘时恒 NULL——断语属推断层与排盘解耦）+ POST /api/oracle/cast（201 Created）+ GET /api/oracle/readings（分页/过滤）。
- [x] W1-4 server.js 单次原子编辑：一行 `require('./routes/oracleCast').register(app, ctx);`（require+register 同一句，满足任务书单次原子编辑约束），紧跟 registerOracle 之后、静态托管之前（挂载点 L70）。
- [x] W1-5 测试：p1b/test/oracleCast.test.cjs 新增 **18 用例全绿**；全量 node --test（bare）复跑 **113/113 PASS（exit 0）** = 95 基线（80 server + 13 oracle + 2 meihua 文件级）+ 18 新增，基线零退化；server.test.cjs 独立复跑 80/80。

## 口径要点（写死在 lib/oracleCast.js 文件头注释，此处摘要）
- **时间起卦**（通行本《梅花易数》卷一「年月日时起例」）：数A = 年支数+农历月数+日数（上卦数），数B = 数A+时支数（下卦数）→ rem8(A)/rem8(B) 与通行本上/下卦一致；动爻沿用全产品唯一起卦管线 rem6(A+B)，与通行本 rem6(年月日+时支) 存在口径分歧——因 meihua.js 本体禁改（P8 铁律：扩展只走 wrapper）且「同一对两数在任何入口下同动爻」的产品内一致性优先，如实标注不静默选边。任务书所述「月数作上卦、日数作下卦」为民间简法变体，与通行本卷一不符，未采用。
- **流派口径冻结**（lunar-javascript 1.7.7 默认行为，公开历表事实实测）：正月初一换年（2026-02-05 立春后春节前 → 年支巳，非立春界的午；立春派可换 Lunar#getYearZhiByLiChun，未采用）；闰X月按本宫X计（2025-08-01 → 月=-6 取 6）；晚子时按当日（2026-09-25 23:30 → 日仍十五、时支=子）；地支序数 1 基（子1…亥12）。
- **随机起卦**：两数各 = crypto.randomInt(1,513) → 1..512 均匀（CSPRNG，无安全语义仅取无偏），与判词线哈希派生数域一致（lib/oracle.js 同 %512+1）；512=8×64 → %8 完全均匀；动爻 rem6(A+B) 因 512≡2 (mod 6) 存在 <1% 分布微偏（娱乐参考可接受，如实标注）；任务书备选「1-8/1-8/1-6 分层」因既有 qiGuaByNumbers 只收两数（动爻恒由 A+B 派生）而弃用——保证三法同一条卦理管线。
- **冻结锚点**（p9-anchor-probe.cjs 实测 + 公开历表事实，写死进测试）：2026-09-25 12:00（中秋·八月十五·午时·丙午年）→ A=30,B=37 → 水风井·动1·互火泽睽·变水天需·体坎水/用巽木·体生用。

## API 契约（W2 前端数据源）
- POST /api/oracle/cast → **201** { id, method, inputs, casting, verdict:null, disclaimer:'娱乐参考', created_at, game_id }
  - method=numbers：params {n1, n2} 正整数，防滥用上限 999999（超出 400）
  - method=time：params {date?} ISO 字符串（无时区后缀按服务器本地时区；缺省=服务器当前时刻；无法解析 400）
  - method=random：params 忽略
  - game_id?：挂局 id（可选；局不存在 404；不传=自由排盘，落档 NULL）
  - casting = meihua 起卦全套 + numbers{a,b} + derived_from（time 法含农历分量留档）
- GET /api/oracle/readings?limit=&offset=&game_id= → { items:[{id,method,inputs,casting,verdict,disclaimer,created_at,game_id}], total, limit, offset }；新→旧；limit 缺省 20、超 100 静默钳制；offset 缺省 0；limit=0/offset<0/game_id 非整数 → 400
- 私有表 oracle_readings（oracleStore.js）：id INTEGER PK / method CHECK IN('numbers','time','random') / inputs_json / hexagram_json / verdict NULL / disclaimer / created_at DEFAULT datetime('now') / game_id NULLABLE REFERENCES games(id) + idx_oracle_readings_game(game_id,id DESC)；存储列名 inputs_json/hexagram_json ↔ API 字段 inputs/casting（rowToReading 映射）；additive 零碰 p1a 既有表
- 恒挂铁律：disclaimer 精确「娱乐参考」（DISCLAIMER 单源自 lib/oracle.js，lib/oracleCast.js 复用不另立字符串）；两路由返回值禁止被参谋/研判类模块引用（写死文件头）

## W1 交付物（全部为 p1b/src/**、p1b/test/**、itest/ 新增/最小改 + package.json 依赖项，零碰禁区）
| 文件 | 性质 | 说明 |
|---|---|---|
| p1b/src/lib/oracleCast.js | 新增 | 时间/随机/数字三法 wrapper；口径与分歧注释写死文件头；惰性 require 历法库（缺依赖时数字/随机起卦仍可用） |
| p1b/src/db/oracleStore.js | 新增 | 私有表 oracle_readings DDL + ensure/save/get/list（照 botc/claims.js additive 先例，JSON 字段读出自动解析） |
| p1b/src/routes/oracleCast.js | 新增 | POST /api/oracle/cast（201）+ GET /api/oracle/readings；私有表 ensure 挂在 register（与 botc 私有表同时机，换取 server.js 单次原子编辑）；边界铁律文件头写死 |
| p1b/src/server.js | 最小改（1 行） | L70 require('./routes/oracleCast').register(app, ctx)（require+register 同句） |
| p1b/package.json + package-lock.json | 依赖新增 | lunar-javascript ^1.7.7（W1-1 决策，任务书优先项） |
| p1b/test/oracleCast.test.cjs | 新增 | 18 用例：历法锚点/口径冻结（春节·闰六月·年界·晚子时）/三法管线单源/确定性（注入端界 1/512）/random 形状 20 采样/非法输入/disclaimer 单源/API 全链路（形状·校验·落档·回读·分页·钳制·挂局 404·DB 直查对账） |
| itest/p9-anchor-probe.cjs + p9-anchor-probe-out.txt | 新增 | 历法锚点探测脚本+报告（留档可复跑；UTF-8 直接落盘避开 pwsh 重定向编码坑） |
| itest/p9-w1-oraclecast-test.txt / p9-w1-full-test.txt / p9-w1-server-test-count.txt | 新增 | 测试证据三件（18/18、113/113 收尾回合复跑、80/80） |
| itest/p9-PROGRESS.md | 新增 | 本文件 |

## W1 证据（本会话新跑命令输出/文件）
- 历法锚点（p9-anchor-probe-out.txt，lunar-javascript@1.7.7 实测）：2026-09-25=八月十五（中秋）✓；2026-02-17 与 2025-01-29=正月初一（春节）✓；2025-08-01 月=-6（闰六月）✓；2026-02-05 年支=巳（正月初一换年界）✓；2026-09-25 23:30 时支=子、日仍十五（晚子时当日）✓
- meihua.js 本体零改动：Get-FileHash SHA256（p1b/src/lib/meihua.js）= DB255EAB…D99A，p1b/test/meihua.js 同值，均= p8 记录值 ✓
- 新用例：oracleCast.test.cjs → tests 18 / pass 18 / fail 0，node exit 0
- 全量复跑（node --test bare，p1b 下，收尾回合新跑）：tests 113 / pass 113 / fail 0，exit 0（=95 基线+18 新增，零退化）
- server.test.cjs 独立复跑：tests 80 / pass 80 / fail 0，exit 0
- npm install lunar-javascript --save：added 1 package in 2s，EXIT=0

## 纪律自守（本棒执行记录）
- 微步回合制：W1 已收口（含被中断后的收尾回合：仅补 PROGRESS+复跑复验，代码零再动），W2/W3 未动，停等恢复令。
- 禁区未碰：p1a-terminal/**、p1b/src/botc/ 五文件、p7-*/p8-* 既有产物（只读）、meihua.js 本体（SHA256 自证）、docs 既有文档（p9-* 全为新产物）、p1b/web/dist（本线禁 build 禁动 dist，全程未碰）。
- 8787 服务零接触：全程未起任何长驻服务，测试全走 fastify app.inject + :memory: db + os.tmpdir() providers 临时文件；未做端口探测/进程操作。
- pwsh 每条 ≤120s；同条失败 ≤2 次换路：①新测试首跑 6 红 → 根因=路由漏 reply.code(201)（Fastify POST 默认 200），修一处复跑 18/18；②edit old_string 缩进错一次 → 重读文件按实际缩进修正后成功；均 2 次内收敛，无第 3 次相同重试。
- 谎报零容忍：上述每个数字都有本会话命令输出或证据文件对应。


## W2 前端（第九棒补完 2026-09-11，本回合收口）
改动清单（全部 p1b/web/src/** 新增/最小改；后端、meihua.js 本体、113 测试基线、server.js L70 零碰）：
| 文件 | 性质 | 说明 |
|---|---|---|
| p1b/web/src/pages/mystic/MysticPage.tsx | 新增（267 行） | 独立排盘页：三法表单（数字两输入 1–999999 前端校验 / 时间一键「起当前卦」=不传 date / 随机一键）+ 卦象大展示（本/互/变六爻图：yao 自下而上、渲染自上而下，本卦动爻标「动」、变卦对应爻标「变」，yao 缺档时 yinYang 兜底）+ 体用五行条（ti/yong 含 position）+ derived_from 起卦留档（time 法农历分量，闰月负数防御）+ **页面级恒挂「娱乐参考 · 非游戏研判」横幅** + 历史列表（limit 20 分页、新→旧）+ 回看抽屉（CastingView 同构复用；verdict 恒空说明写死文案） |
| p1b/web/src/styles/mystic.css | 新增（118 行） | 组件全 mystic- 前缀，沿用 oracle.css 类名约定与站内变量（--panel/--line/--muted/--accent/--panel-2）+ .btn 全局类；附 a.oracle-mystic-link reset（oracle.css 本体零改动） |
| p1b/web/src/App.tsx | 最小改（3 处） | L9 import MysticPage；L33 导航「☯ 排盘」入口；L48 Route /mystic |
| p1b/web/src/pages/live/OracleZone.tsx | 最小改（1 处） | 弹层 oracle-foot 加 `<a href="#/mystic">进入排盘 →` 链接（纯增量，弹层既有逻辑/自动弹/防重弹零改动） |

新/改文件 SHA256：
- MysticPage.tsx = 8A8C436B09CDE4968EC0DA1248E83F05F914AAC21BA267DDC611526240E0AAD5
- mystic.css = D80DE1BB8FE29FA661E7C97BDDB6C02A1723FB715E03F4F18FFE60AB27FC7FD1
- App.tsx（改后）= A6DFBA20349CF704815F1B2C0AC0F5FBF72E8797437681B8101AA7B37ACBAB33
- OracleZone.tsx（改后）= 4335D4E1B7AB433AE39E00F7ACBF7FBF363DB1A79DF55CED3C4CD7AFFE685497

W2 build 证据（docs/sandbox/p1b/itest/p9-w2-build-out.txt）：`tsc && vite build` 零错误，`✓ built in 646ms`，dist/assets/index-Dk4YI9fR.js 268.29 kB 落新（2026-09-11 06:03:36）；bundle 特征实测 banner=True title=True navlink=True（横幅/页面标题/导航均已入包）。

- 微步 2 免做确认：types.ts L281-282 `yao?/yinYang?` 在位（前任已增补），MysticDerivedFrom/MysticCasting/OracleCastResult/OracleReading/OracleReadingsResult 类型链 L316-364 完整——读回确认零改动。
- 铁律自证：恒挂横幅静态置顶不随排盘状态消失；抽屉 verdict 恒空说明写死；页面不接断语不接研判，未起服务、8787 零接触。


## W3 集成收口（第九棒 2026-09-11，同 turn 起服闭环；本节后 P9 全线收口）
- 方式：单条 pwsh 内联脚本同 turn「起服→端到端→截图→杀进程」（pwsh 子进程跨 turn 必被回收）；独立端口 8791（netstat 先探空闲）+ P1B_DB_PATH=itest/p9-run.db（全新临时库）+ P1B_LLM_MOCK=1（零网络）；8787 与生产库零接触。
- 端到端（POST /api/oracle/cast ×3 全 201）：numbers 3/7 → id=1 火山旅·动4·体艮土/用离火·verdict=null·disclaimer=娱乐参考 ｜ time 不传 date → id=2 地天泰，derived_from={农历八月初一·午年·申时·lunar-javascript@1.7.7} ｜ random → id=3 巽为风·a/b=93/397。GET /api/oracle/readings?limit=20 → total=3 top3ids=3,2,1（新→旧 ✓）methods=random,time,numbers；limit=1 分页 probe ✓。
- 判词彩蛋回归旁证：POST /api/games（P9-W3-witness/werewolf/6人）→ 201 id=1；GET /api/games/1/oracle → 200 mode=mock·verdict_len=71·disclaimer=娱乐参考——P9 改动零破坏。
- 证据文件（itest/）：p9-w3-e2e-out.txt（端到端全记录）、p9-w3-mystic-page.png 54KB / p9-w3-live-page.png 34KB / p9-w3-manage-page.png 29KB（headless Edge --headless=new --screenshot，静态页面方式无交互）、p9-w3-mystic-dom.html（渲染后 DOM 留档）、p9-w3-run.ps1（闭环脚本首版）、p9-w3-server-out/err.txt。
- DOM 级证据（--dump-dom）：mystic 页渲染后 DOM 含「娱乐参考」恒挂横幅 ✓「梅花易数」标题 ✓ 历史 #1/#2/#3 全渲染 ✓（如实注明：当前模型不支持图像输入，截图为文件级+DOM 文本级双重证据，未做像素人工目验）。
- 进程闭环：3 次起杀均先 Get-CimInstance 验命令行（node.exe src/server.js）再 Stop-Process -Force，末次 netstat 复验 8791 释放。
- 排障记录（同条失败 ≤2 次换路）：①截图首跑 3 连败 → 根因 = --screenshot 路径含空格被 Start-Process -ArgumentList 拆参（Edge 秒退零输出）→ 改无空格工作目录 C:\p9shots 截图后 Move 回 itest，3/3 成功；②诊断用 ps1 文件落盘验证后消失（Parser 实测 file not found，Defender 无记录）→ 弃 ps1 文件改 pwsh 内联 -Command，一击即中；③read_image 图像核验不可用（模型无图像输入声明）→ 改 DOM 文本级证据。
- **P9 全线收口：W1 三法后端 + W2 独立排盘页 + W3 集成端到端全绿，无遗留步骤。**
- 队长验收注记（2026-09-11）：W3 证据八件盘上实核；3 张 PNG 签字节验证 OK（720×1600，像素目验因队长模型无图像输入不可行，棒内声明属实，以 DOM 关键词双验替代：娱乐参考/梅花易数/火山旅/地天泰/巽为风五串全中）；进程闭环与 8787 零接触确认。**验收通过。**

## 给下一棒（W2 前端独立页 #/mystic）的交接要点
1. 数据源 = 上「API 契约」节。casting 字段映射：benGua/huGua/bianGua {name, fullName, upper, lower, yao[6 自下而上 1=阳], yinYang[6]}、dongYao(1..6)、ti/yong {trigram, wuXing, position}、tiYongRelation、numbers{a,b}、derived_from（time 法含 lunar_month/lunar_day/leap_month/year_zhi/hour_zhi/local_time/calendar）。
2. 页面要素（任务书 W2）：三法排盘表单（数字两输入 / 时间一键「起当前卦」=不传 date / 随机一键）+ 卦象大展示（本/互/变 + 动爻体用五行）+「娱乐参考 · 非游戏研判」恒挂横幅 + 历史记录列表（回看抽屉，GET readings 分页，新→旧）。
3. OracleZone 彩蛋弹层加「进入排盘」链接 → #/mystic（纯增量，不改弹层既有逻辑；p8-W2 交接要点仍有效）。
4. 测试基线现为 **113/113**（W1 后）；W2 不得使其退化；server.js L70 挂载点勿动。
5. W3 集成收口要点：同 turn「起服（独立端口 + P1B_DB_PATH=itest/p9-run.db + P1B_LLM_MOCK=1）→ 三法端到端 + 历史回读 → 截图 p9-*.png 2-3 张 → 杀进程」闭环；netstat 探测端口，Stop-Process -Force 前先验命令行。
