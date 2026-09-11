# P7 收尾进度锚（第四棒）

> 断点锚：每完成一步更新本文件。任务书 = docs/sandbox/p1b/P1B-UX-ONEPAGE.md（B6 拍板版）。

## 第四棒接手（本回合）
- **接手结论**：新会话无历史，仅以本文件为锚。盘点：①映射表 14/14 现成可用（含 13 项归属），直接采用不重查源码；②build 已过（BUILD_EXIT=0 / 70 modules）不重跑除非源码被改；③待办 = 上表 9 项中未勾的：起服回归 → p7-drive.mjs → 双回归 → 截图 → 清理 → 终态。
- **风险认知**：前三棒浏览器回归阶段僵死（打断免疫、消息只排队）→ 本棒每条命令设超时（≤120s），CDP 等待 ≤15s，同步失败 ≤2 次换路并记录，绝不无限等；回归跑 pwsh 后台作业轮询（≤30s/次，总 8min 上限）。

## 状态总览
- [x] 盘点现状+本文件建立。前棒成果：三区路由（App.tsx B6 壳：/ 现场、/manage、/settings 齿轮，旧 /games /input /advisor 全重定向）；页面组件全在（pages/live/* pages/manage/* NewGameWizard(+Steps) input/* p1b6.css）
- [x] **build 零错误（本轮新跑）**：p7-build-out.txt BUILD_EXIT=0、✓70 modules、dist hash 与 B6 相同（源码自 B6 未再改）→ 改版代码层无缺口，直接进回归阶段
- [x] 8787 处置：Get-CimInstance 验 PID 38128=node src/server.js（b6-server-pid.txt 同源）→ 杀 → p7-kill-old.txt: PID GONE / port FREE；4720 已不存在；9223 空闲
- [x] **步骤2 终态（第六棒 M5 收勾）**：13 项功能→选择器映射。映射表 14/14 早已落盘（下方两节），且 drive 重跑 35 check 已覆盖全部 13 项功能验证（对照见下方终态段）——悬四棒的「进行中」就此收尾
- [x] **起服回归（第五棒 M1 完成 2026-09-10）**：①现场核查 8787 空闲、无 src/server.js 残留（p7-m1-procs.txt，第四棒 PID 36684 已死）；②本棒起服 PID 10272（P1B_LLM_MOCK=1+P1B_DB_PATH=itest/p7-run.db）health=200/games=200 皆过（p7-m1-health.txt），仅回传被打断；③随后发现并行操作者已按同协议重启为 PID 7212（pidfile「new PID=7212」，12:39:49 起）→ 按「健康即复用」体检：/api/health=200 且 db_path=p7-run.db、llm_mock=true，/api/games=200 空局（p7-m1-health2.txt）→ **定案复用 7212，服务就绪，勿再起服**。下一步=M2 写 p7-drive.mjs
- [x] p7-drive.mjs（改自 p5-drive.mjs：CDP WebSocket+evaljs+轮询全带上限，等待 ≤15s）werewolf 局+botc 局带剧本双回归，13 项逐项 check → **第六棒重跑（15:03）：35 check = 30 OK / 5 FAILED**（p7-drive-log2.txt；对比第一轮 8 FAILED：S11b/d/e2 已被既定修法+连锁解释覆盖；残留 5 项挂账 B6-DEF-01~05 只挂账不修，见下）
- [x] 390/1280 截图 p7- 前缀（itest/ 目录）→ **第六棒 M3 复核（15:08）6/6 全中**，字节数/mtime 与 drive log2「PNG saved」行逐字吻合，全为本轮产物：p7-card-wolf-390.png 191999B @15:03:06、p7-live-botc-390.png 156877B @15:03:36、p7-manage-1280.png 86438B @15:03:40、p7-settings-1280.png 54847B @15:03:44、p7-live-wolf-390.png 156896B @15:03:48、p7-live-1280.png 57372B @15:03:49（证据 p7-m3-shots.txt）
- [x] 清理：停自己的服务与浏览器（杀前验 PID 命令行）→ **第六棒 M4 完成（15:12）**，三段证据：①谁在=netstat 8787 NO_LISTENER（服务 3796 已随 turn 被沙箱回收，无需杀）/ 9223 LISTENING PID 15308（chrome，12:26:12 起）（p7-m4-probe.txt）；②杀了谁=仅 chrome PID 15308（Stop-Process -Force；cmdline 直验通道全断——CIM 返空、wmic Alias not found，改以证据束定身份：独占链预留 9223 CDP + HeadlessChrome + CDP 标签页全为「AI 推演沙盘」@127.0.0.1:8787 + 起于链时间线 12:26 + 任务书明示 profile 被其锁定；其余 13 chrome PID/14 node PID 一律未碰）；③验证 GONE=15308 GONE、9223 无监听、8787 FREE、chrome 全树 0 残留（p7-m4-kill.txt）
- [x] 终态回报（PROGRESS 终态+build 输出+13 项核对表+截图清单+双回归结论）→ 第六棒 M5 完成：全部见下方「终态段（第六棒 M5）」

## 步骤2核对表：13 项 → 选择器（LivePage/ManagePage 实测 DOM）
1. **局列表+新建（botc 剧本选择）**：ManagePage .page-head [＋ 开新局] / .game-list>.game-item（.game-item-main、badge 进行中·第N天/未开局、meta #id·类型·剧本·N人·N事件）；Wizard .sheet 步骤1 .form-grid .field input(局名)/select(类型)/input[type=number](人数)/botc 时第4 .field select(剧本)；.sheet-actions .btn-primary [下一步→创建局并进入现场]；现场空态 [data-testid=live-empty] [＋ 开新局]；TopBar [切换/建局]→GameSheet .sheet（.sheet-search input 搜索、局按钮列表、.sheet-cta [＋ 开新局（分步引导）]）
2. **座位改名**：Wizard 步骤2 .seat-row input[aria-label="N号真名"]；Manage SeatListCard 同 aria-label（0.5s 防抖 PUT /seats、失败回滚）+[恢复默认「N号」]
3. **导出 JSON**：GameDetail .detail-card [⬇ 导出 JSON] → toast "✓ 已导出 p1b-game-{id}.json（N 字节）"
4. **天数推进**：TopBar .day-stepper [aria-label=前一天/后一天] + .day-num "第 N 天"；Manage DayAdvanceCard 同 aria-label 按钮
5. **自由文本抽取+确认流（YD5）**：.input-main textarea → [AI 拆解] → .confirm-sheet（.confirm-raw 原文、修改重显 .confirm-re）→ [确认入账]
6. **3 宏**：InputBar .macro-row [跳身份/查杀/金水] → MacroSheet .sheet：座位 select + 跳身份 input[list=role-suggest] / 查杀金水目标 select → [出确认卡] → .confirm-sheet [确认入账]
7. **时间线 edit+retract**：.tl-item/.tl-claim .tl-row-actions：[编辑]→EditSheet .sheet；[撤回]两击确认（armed="确认撤回?"，3s 自动复位）
8. **天结算+轮询+就绪提醒**：TopBar [⚡ 天结算]（settling 时禁用）；running=.adv-badge"生成中"+.adv-running（spinner+秒数+任务id）；就绪=.adv-badge.is-ready"✓ 第 N 天就绪"+.adv-ready；容器 .adv-strip/.adv-body（▼展开/▲收起）
9. **卡片渲染+历史卡回看**：AdvisorCardView .adv-card；横幅 .adv-card-banner"参谋卡·思路非答案"；.adv-sec-title（矛盾点+欠定度色标图例、竞争假设、验证点）；双栏 .hyp-grid>.hyp-card；勾选 .cp-item（本机持久化 p1b.advisor.checks.v1）；历史 chips .adv-hist-row button.chip"第N天 · N假设"
10. **供应商设置页**：App .appbar-gear→/settings；供应商列表+预置模板添加/编辑/删除；ProviderEditorSheet .sheet（名称/BaseURL/APIKey 密码框/两模型）；连接测试+激活
11. **BOTC 局谓词选项**：Wizard 剧本 select（仅 type=botc 渲染，三本 SCRIPT_LABEL）；确认卡谓词（是恶魔/是爪牙/自称醉酒/自称中毒 → botc_claims）
12. **中文角色名显示**：MacroSheet input[list=role-suggest] 按剧本出中文名建议；时间线/确认卡经 SCRIPT_LABEL+roles.json 显中文名
13. **botc-claims 可见**：现场时间线 .tl-claim（b 前缀行、tl-row-actions 撤回）；Manage BotcClaimsCard（空态提示"暂无阵营/状态声称"、viewDay 过滤、剧本参照按钮）

## 纪律自守
pwsh/node ≤120s 超时换降级路径，同条禁重试>1；CDP 等待 ≤15s 上限+超时截图存证跳过；npm.cmd；pwsh stdout 重定向文件再读；只动 p1b/web/** 与 itest/；禁改 p1b/src/**、p1a-terminal/**、docs 既有文件。

## 选择器映射（微步#2 追加；全部抄自源码实测 class/id/data-testid/文本锚）
1. **局选择器**：TopBar button「切换/建局」→ GameSheet `.sheet-overlay>.sheet`；局条目=纯 .btn 文本锚「#id 局名（类型 N人 · 第N天 · N事件）」（无专属 class→文本匹配，p5 验证模式）；搜索 `.sheet-search input`（TopBar.tsx L41/L118/L124-129）
2. **新建向导入口**：空态 `[data-testid="live-empty"]` 内 `.btn.btn-primary`「＋ 开新局」（LiveEmpty.tsx L4/L9）；管理页 `.page-head` button「＋ 开新局」（ManagePage.tsx L56）；GameSheet `.sheet-cta`「＋ 开新局（分步引导）」（TopBar.tsx L113）；向导本体 `.sheet-overlay[aria-label=开新局引导]>.sheet`+`.wiz-step`（NewGameWizard.tsx L69/L75）
3. **座位改名输入**：Wizard 步骤2 `.seat-row input[aria-label="N号真名"]`（NewGameWizardSteps.tsx L54-56）；管理页 SeatListCard 同 aria-label，0.5s 防抖自动保存（SeatListCard.tsx L74/L79）
4. **导出按钮**：`.detail-card .detail-actions` button 文本锚「⬇ 导出 JSON」（GameDetail.tsx L70-74）→ toast「✓ 已导出 p1b-game-{id}.json」
5. **天数 − ＋**：TopBar `.day-stepper` `button[aria-label=前一天]`/`button[aria-label=后一天]`+`.day-num`「第 N 天」（TopBar.tsx L44-49）；管理页 DayAdvanceCard 同 aria-label（DayAdvanceCard.tsx L27/L30）
6. **输入条 textarea**：`.input-bar>.input-main textarea`（InputBar.tsx L25/L48；placeholder「自由文本记录，如：…」L52）
7. **3 宏按钮**：`.input-bar>.macro-row` 内三 button 文本「跳身份/查杀/金水」（InputBar.tsx L39）→ MacroSheet `.sheet`：座位 select（L60）+ 跳身份 `input[list=role-suggest]`（L67）+ 查杀/金水目标 select（L77）+「出确认卡」（L87）
8. **确认卡确认+驳回**：`.confirm-overlay>.confirm-sheet`（ConfirmCard.tsx L35-36）；确认=`.confirm-foot .btn-primary`「确认入账」（修改重显时「复核无误，确认入账」L171-173）；驳回=`.confirm-foot .btn`「放弃」（onCancel，L170）
9. **时间线容器**：`.timeline>.tl-item`（Timeline.tsx L81/L83）；空态 `.tl-empty`（L78）；条目 `.tl-seq/.tl-type/.tl-actor/.tl-raw`（L85-89）
10. **edit+retract 按钮**：`.tl-row-actions` 内 `.btn`「编辑」（→EditSheet `.sheet`，L101/L123）+ ArmedBtn「撤回」→armed「确认撤回?」（两击确认，3s 自动复位，L102/L113/L124）
11. **天结算按钮**：TopBar `.btn.btn-primary` 文本锚「⚡ 天结算」（settling 时禁用+「生成中…」，TopBar.tsx L53-56）
12. **轮询角标**：running=AdvisorZone `.adv-badge`（spinner+「生成中 Ns」L22）与 TopBar `.adv-badge`「生成中」（L58）；就绪=`.adv-badge.is-ready`「✓ 第 N 天就绪」（L23）+`.adv-ready`（L41）；运行详情 `.adv-running`（L32）
13. **卡片容器**：`.adv-card[data-testid=advisor-card]`（AdvisorCardView.tsx L35）；色标=`.adv-sec-title`「矛盾点…（欠定度色标：高=红 中=黄 低=灰）」（L44）；双栏=`.hyp-grid>.hyp-card`（L72/L74）；验证点=`.cp-list>.cp-item`（label，勾选加 .done，L90/L93）；展开容器 `.adv-body`+「▼ 展开/▲ 收起」（AdvisorZone.tsx L26/L30）
14. **设置入口**：header `.appbar>.appbar-inner` 内 `.appbar-gear[aria-label=设置]`→#/settings（App.tsx L33-36）；设置页供应商列表+`添加/编辑/删除`（SettingsPage.tsx L255）+ProviderEditorSheet `.sheet`（L109）

### 缺口清单（缺专属选择器→需补 data-testid）
- **硬缺口：0 项**——14/14 全部可定位，回归无阻塞
- 弱锚建议（非阻塞，文本匹配 p5 已验证可行）：局选择条目按钮(#1)、导出按钮(#4)、天结算按钮(#11)、3 宏按钮(#7)、确认/放弃按钮(#8) 均无专属 class/testid，靠可见文本定位；如需加固可补 data-testid，列入建议不强制

## 第六棒（M2 重跑双回归 · 2026-09-10）

### 落盘点 A：环境处置 + 起服 —— 已过（14:58）
- **CDP 9223：复用**（HTTP 200，HeadlessChrome/135，PID 15308 chrome.exe；体检证据 p7-m2-probe.txt）——任务书口径「有 CDP 体检复用」
- **纠偏记录**：任务书称「8787 无监听、PID 7212 已死」，实测 7212（node）仍监听 8787 且 health payload 与回归库吻合（netstat 证据 p7-m2-pid.txt；pidfile p7-my-server-pid.txt 同源「new PID=7212」）→ 判定为本链自有回归服务，予以停止：taskkill 报 Access denied（killdiag），**Stop-Process -Force 成功，PID GONE**（p7-m2-killdiag.txt）
- **db 重置**：8787 释放后删 p7-run.db/-wal/-shm 三件 → NONE (clean)（p7-m2-start.txt）
- **起服**：node src/server.js @ E:\music player\p1b，P1B_LLM_MOCK=1 + P1B_DB_PATH=itest/p7-run.db → **服务已起 PID=25288**（pidfile p7-m2-server-pid.txt），/api/health=200 且 db_path=E:\music player\docs\sandbox\p1b\itest\p7-run.db、llm_mock=true、进程 node alive（p7-m2-start.txt）→ 落盘点 A 通过，进 B 点 drive 重跑

### 落盘点 B：drive 重跑 —— 完成（15:03，30 OK / 5 FAILED）
- **第 1 次尝试（14:59）崩于 S1c**：Failed to fetch，S0b/S1a/S1b 连环挂。根因=**我方起服方式缺陷**：Start-Process 起的 node（PID 25288）被沙箱随前台 pwsh 退出连带杀掉（diag2：25288 GONE、8787 无监听、stderr 干净无崩溃）→ 非产品问题，不留 FAIL 账
- **换路起服 v2**：node 改为 **pwsh 后台作业直跑（job pwsh-2）**，存活期=作业存活期 → **PID 3796**，health=200 db_path/llm_mock 全对，**games:[] 空库确认**（p7-m2b-start.txt；pidfile p7-m2-server-pid.txt 已更新）
- **第 2 次尝试（15:02-15:03）跑通全程**：35 check，**30 OK / 5 FAILED**（p7-drive-log2.txt），6 张 p7-*.png 全部落档
- **收尾状态**：服务（pwsh-2/PID 3796）与 chrome CDP（15308）暂留供 M3 截图核对，M4 清理

### B6-DEF 挂账清单（口径：只挂账不修，禁改 p1b/web/**、p1b/src/**）
1. **DEF-01 S5 宏[跳身份] 确认卡不出**：现象 card=false（waitSel('.confirm-sheet',8000) 超时，两轮复现）；复现=现场→[跳身份]→选座位→填「女巫」→[出确认卡]，确认卡不弹；影响=跳身份宏整链不可入账
2. **DEF-02 S5 宏[金水] 确认卡不出**：现象同上 card=false（两轮复现）；复现=现场→[金水]→座位2→目标3→[出确认卡]；影响=金水宏不可入账。**对照：宏[查杀]同表单形态 OK（S5 查杀两轮全过）→ 宏通道可用，仅跳身份/金水两形态异常**
3. **DEF-03 S8d 验证点勾选不生效**：现象=有 .cp-item checkbox，点击后 .cp-item.done 未出现（本轮新增失败，第一轮未触发→疑似时序/状态挥发）；复现=天结算→展开参谋卡→勾选任一验证点；影响=验证点勾选状态不落
4. **DEF-04 S9b 导出 events=2<4**：现象=export counts {events:2, claims:2}；根因=**DEF-01/02 连锁**（两宏未入账少 2 事件），时间线实有自由文本1+查杀1=2 条；宏修复后应自然转 OK；影响=导出断言事件数不达样本预期
5. **DEF-05 S11f botc_claims API 空**：现象=确认入账后 GET /api/games/2/botc-claims 返回 []，但时间线可见「是恶魔」（S11g OK）→ 声称未落 botc_claims 表或查询口径不符（两轮复现）；复现=botc 局→跳身份→谓词切 is_demon→确认入账→查 botc-claims；影响=BOTC 专属谓词私有表断言不过

### 环境事实备查（第六棒 M3 补记，队长实测+本棒两轮证据归并）
- **本沙箱 pwsh 子进程跨 turn 必被回收**：Start-Process 起的 node（25288）随前台 pwsh 退出被杀；后台作业直跑的 node（pwsh-2/PID 3796）也在 turn 结束后被回收（队长停机后实测 8787 NO_LISTENER）→ 每回合内「起服→用完」必须闭环，不可依赖服务跨回合存活
- **端口探测口径**：`netstat -ano` 可靠（找到 7212/15308/3796 三次全中）；`Get-NetTCPConnection`/`Get-CimInstance` 在受限模式下疑有假阴性（曾对活着的 chrome/8787 返回空集，7212「已死」误判的可能来源）；taskkill 在本沙箱 Access denied，`Stop-Process -Force` 可用

## 终态段（第六棒 M5 · 2026-09-10）

### 13 项功能 × 回归结果对照（log2 = p7-drive-log2.txt，35 check = 30 OK / 5 FAILED）
1. 局列表+新建（botc 剧本选择）：**PASS**（S1a/b/c OK + S11a/c OK）
2. 座位改名：**PASS**（S2 OK，防抖 PUT 落库 2号=赵六）
3. 导出 JSON：**PASS（功能本体）**（S9a toast OK；事件数断言 S9b 挂账 DEF-04 连锁）
4. 天数推进：**PASS**（S3 OK）
5. 自由文本抽取+确认流：**PASS**（S4a/b/c OK）
6. 3 宏：**挂账 DEF-01/02**（S5 查杀 OK；跳身份/金水确认卡不出 card=false）
7. 时间线 edit+retract：**PASS**（S6a/b OK，armed 两击撤回 3→2）
8. 天结算+轮询+就绪提醒：**PASS**（S7a/b OK，✓ 就绪+卡展开）
9. 卡片渲染+历史卡回看：**PASS（渲染本体）**（S8a/b/c OK；S8d 勾选挂账 DEF-03）
10. 供应商设置页：**PASS**（S10a/b OK，编辑弹层开合未存改动）
11. BOTC 局谓词选项：**挂账 DEF-05**（S11a/e/e2 OK 剧本三本+谓词切换；S11f 落 botc_claims 表断言不过）
12. 中文角色名显示：**PASS**（S11d datalist 洗衣妇/厨师 OK + S11h 时间线「厨师」OK）
13. botc-claims 可见：**PASS（可见性）**（S11g 时间线 b 前缀 OK + S11i manage 卡 OK；数据落表挂账 DEF-05）

小结：13 项中 **8 项全 PASS**（#1/2/4/5/7/8/10/12），**5 项本体 PASS 带挂账**（#3/#9/#13 可见性挂账、#6/#11 宏与落表挂账）——零阻塞项，5 挂账全部有复现路径。

### 双回归结论
第一轮 8 FAILED（p7-drive-log.txt，五棒时点）→ 第六棒修法重跑 5 FAILED（log2）：**两项既定修法有效性实证**——①S5 宏 waitSel('.confirm-sheet',8000) 轮询替代定额 sleep（S5 查杀时序转稳）；②ensureOnGame('P7血染回归') 建局后切局兜底（S11b 转 OK）；连锁转 OK：S11d/e2。残留 5 FAIL 全部挂账 DEF-01~05（B6-DEF-01 口径只挂账不修），其中 DEF-04 系 DEF-01/02 连锁，非独立缺陷。

### 截图清单
见上方 L16 已勾行（M3 复核 6/6，含字节数+mtime 与 log2 逐字吻合），不重复。

### DEF-01~05 汇总表（口径：只挂账不修，禁改 p1b/web/**、p1b/src/**）
| 编号 | 现象 | 影响 |
|---|---|---|
| DEF-01 | S5 宏[跳身份] 确认卡不出（card=false，两轮复现） | 跳身份宏不可入账 |
| DEF-02 | S5 宏[金水] 确认卡不出（card=false，两轮复现；对照查杀 OK） | 金水宏不可入账 |
| DEF-03 | S8d 验证点勾选 .cp-item.done 不生效（本轮新现） | 勾选状态不落 |
| DEF-04 | S9b 导出 events=2<4（DEF-01/02 连锁） | 导出事件数不达样本预期 |
| DEF-05 | S11f botc_claims API 空 []（时间线可见是恶魔） | BOTC 谓词私有表断言不过 |

### M1-M6 全链证据索引
- build（四棒）→ p7-build-out.txt → BUILD_EXIT=0 / 70 modules
- 选择器映射（四棒）→ 本文件「选择器映射」节 → 14/14 无硬缺口
- M1 起服回归（五棒）→ p7-m1-health.txt / p7-m1-health2.txt → health=200，定案复用 7212
- M2-A 处置+起服（六棒）→ p7-m2-probe.txt / p7-m2-pid.txt / p7-m2-killdiag.txt / p7-m2-start.txt / p7-m2-diag2.txt / p7-m2b-start.txt / p7-m2-server-pid.txt → 纠偏 7212 活体 + 沙箱回收根因发现；终态服务 3796 health=200 / 空库（已随 turn 回收）
- M2-B drive 重跑（六棒）→ p7-drive-log2.txt → 35 check：30 OK / 5 FAILED（挂账 DEF-01~05）
- M3 截图（六棒）→ p7-m3-shots.txt → 6/6 全中
- M4 清理（六棒）→ p7-m4-probe.txt / p7-m4-kill.txt → 8787 FREE、15308 GONE、chrome 全树 0 残留
- M5 终态锚（六棒）→ 本节
- M6 总交付（六棒）→ .scratch/血染线总交付汇报-2026-09-10.md（已完成，队长终验通过 2026-09-10）

**现场终态：服务/浏览器零残留；p7-run.db 留存本轮回归产物供复查。**
