# 《血染钟楼》（BOTC）调研报告：AI 推演沙盘首发游戏适配性评估

> 产出：子代理 A「调研血染钟楼适配性」（2026-09-07，interrupt+恢复令后完整交付）｜方法：10 轮网页级检索与验证（web_search / platform_search / GitHub raw 抓取 / MediaWiki API / 论文 PDF 全文读取），关键事实区分官方一手与社区转述并标注置信度。

## 1. 核心规则与信息结构

**基本盘**：官方口径"5-20 名玩家 + 1 名说书人"（官网首页原文一手验证）；常规桌面局 5-10 人、社区实践 7-13 人常见；单局约 60-120 分钟。

**阵营与角色**：好人 = 镇民 Townsfolk（主要信息来源）+ 外来者 Outsider（好阵营但能力有干扰性）；坏人 = 爪牙 Minion + 恶魔 Demon。另有旅行者 Traveller 与传说角色 Fabled。

**昼夜循环**：首夜只分发身份与信息、恶魔不杀人 → 白天自由发言 + 提名 + 全员投票处决 → 夜晚各角色依官方"夜间顺序表"行动。**信息件天然离散**：洗衣妇/图书管理员/调查员拿"玩家+角色"验证信息、厨师拿好人对数、共情者拿邻居邪恶数、占卜师指两人判恶魔、送葬者验处决者、僧侣守护、间谍看魔典、下毒者使信息为假等。官方剧本 JSON Schema 中的 firstNight/otherNight 顺序数组本身就是官方维护的事件时序表——对局账本的事件轴是现成的。

**死亡机制（对本项目最关键）**：死者保留发言权 + 每人一张"鬼票"，仅失去角色能力与提名权。官方规则书原文："the game is usually decided by the votes and opinions of the dead players"。信息流不因淘汰中断。

**胜利条件**：好人处决恶魔获胜；坏人存活至仅剩 2 名活人获胜。

**三大官方剧本**：
| 剧本 | 特点 | 置信度 |
|---|---|---|
| 暗流涌动 Trouble Brewing | 入门本，恶魔仅 1 种（Imp），说书人裁量空间最小 | 官方一手 |
| 灾祸滋生 Bad Moon Rising | 恶魔每晚可多次击杀；夜间死亡不公开宣布 | 官方一手 |
| 煽动叛乱 Sects & Violets | 疯狂（Madness）机制：说书人可要求玩家坚信某事为真、公开违背受罚 | 中高 |

难度递进惯例：TB 约 10 局后再玩 BMR（社区转述）。

## 2. 公开资源与开源生态

**官方一手资源**：官方 Wiki wiki.bloodontheclocktower.com（MediaWiki，api.php 可程序化抓取）；官网 Custom Scripts 政策与 Script Tool。

**GitHub 核验：ThePandemoniumInstitute/botc-release 属实**（⭐107，官方描述"The Official Blood on the Clocktower App"）。实际内容：①官方 App 安装包发布仓库；②resources 目录（官方公开给工具制作者的资产，托管于 release.botc.app/resources，受 Community Created Content Policy 授权）；③script-schema.json——官方剧本/角色 JSON Schema（一手抓取）：数组结构，角色必填 id（小写字母数字）、name、team（townsfolk/outsider/minion/demon 等）、ability，支持 meta（剧本名/作者/firstNight/otherNight 顺序）。
> 核验结论：传闻"官方开源角色 JSON 数据仓库"基本属实、表述需修正——是"App 发布 + 工具制作者资源 + 官方 JSON Schema"组合；角色与剧本数据已官方标准化为机器可读 JSON，且官方以 CC 政策主动开放工具生态。

**社区开源工具**：bra1n/townsquare（⭐504，clocktower.online 背后仓库；注意 README 声明已停止积极维护）；AdmiralGT/botc-scripts（⭐33 剧本库）；Skateside/pocket-grimoire（⭐89）；tjhowse/botc（⭐96）；lilserf/bot-on-the-clocktower（⭐29 Discord bot）；lindsaykwardell/clocktracker（⭐19，对局记录与统计 Web 应用，与本项目"账本"思路同源）；tchajed/botc-tools；Xinverse/Blood-on-the-Clocktower-Storyteller-Discord-Bot（⭐14，纯文本全自动说书人）；官方线上平台 botc.app。

**国内资料**（重要事实：中文正版已更名《染·钟楼谜团》，曾用名《血染钟楼》）：B站 WIKI wiki.biligame.com/bloodontheclocktower；灰机 Wiki towerhb.huijiwiki.com（CC BY-SA 3.0）；clocktower.gstonegames.com（资讯/角色/规则/线上版 + 官方网页魔典 /grimoire/；为国内运营方站点系推断，置信度中）；机核文确认中文版钟楼百科为官方 Wiki 全量翻译；官方城市赛体系存在（B站官方招募视频）。

## 3. AI / 学术先例

1. **Clocktower Radio**（clocktower-radio.com）：专门用 BOTC 自主对局测试 LLM 推理与社会智能的 benchmark，模型互跑完整局（站点自述+社区帖，高置信；内部评测方法未核验）。
2. **ACL 2026 Findings**：《Measuring Large Language Models' Adversarial Behavior in Social Deduction Games》——五游戏多智能体仿真测 LLM 对抗行为；论文全文已下载存于工作区 botc_acl2026.pdf，确认 BOTC 在其实验游戏名单中（一手验证）。
3. **BGG 帖 "AI plays Blood on the Clocktower"**（thread/3523162）：多 AI 智能体互玩 BOTC + 可滚动交互时间线查看每步决策——与本项目"结构化事件流+决策可视化"思路几乎一致的社区先例。
4. **开源项目**：rigeman/blood-clocktower（腾讯混元 LLM 驱动）；EthanQC/Blood-on-the-Clocktower-auto-dm（Go 后端，LLM 智能体扮演说书人，自动执行夜间行动/私聊 DM/对局流程）。

**结论**：BOTC 已是活跃的 LLM 研究对象——可行性有充分先例，同时本项目应强调"账本+竞争假设推理+辅助真人玩家"的差异化，避免重复 benchmark 路线。

## 4. 公开对局资料（5 个具体链接）

| # | 资料 | 类型 | 完整度与真值 |
|---|---|---|---|
| 1 | 官方频道真人完整局 "IN PERSON - Sects and Violets"（youtube.com/watch?v=mjHI18PX2jY），同系列播放列表 50+ 局 | 视频·官方英文 | 完整对局；官方节目惯例含结尾 grimoire 全身份揭晓（置信度中高） |
| 2 | Smosh Plays Blood On The Clocktower（youtube.com/watch?v=H0zGtq-DAAE），自带完整章节表 | 视频·英文 | 完整对局，章节化切分 |
| 3 | "BLOOD on the CLOCKTOWER \| Full Game!"（youtube.com/watch?v=5-Xs8wYote0） | 视频·英文 | 完整局 |
| 4 | B站【血染钟楼】12人风雅集高强度逻辑信息对抗局（av1651625691） | 视频·中文 | 完整对局（置信度中） |
| 5 | B站"血染钟楼8人暗流涌动复盘"（av113339371953938）与"血染钟楼对局复盘"（av116929914275690）；第一视角系列（av745774441） | 视频·中文·复盘 | 带复盘讲解 |
| 补 | Reddit 文字帖："Aaaand we go to a Grim Reveal…"（comments/1r2yedj）与 horror story 帖（comments/1i240vf，含 drunk empath 具体局叙述） | 文字 | 叙事型战报为主，非结构化 |

总体：视频类带真值资料充足且官方持续产出；文字类偏叙事。

## 5. 适配性评估（对照狼人杀职业赛事）

| 维度 | 血染钟楼 | 狼人杀（WPL/WCO 型职业赛事） | 优方 |
|---|---|---|---|
| 信息离散度 | 每晚每人一个离散动作/信息件；官方 firstNight/otherNight 时序表现成 | 也离散，但无官方事件标准 | BOTC |
| 事件可结构化 | 官方 JSON Schema + wiki 角色真值页；clocktracker 已验证可行 | 赛事版型明确、判例库存在，但无机器可读数据标准 | BOTC |
| 玩家数/时长 | 5-20（常规 7-10），60-120 分钟；单局 5-10 个异质能力 agent | 12 人标准局，角色同质、私有状态简单 | 狼人杀略简 |
| 死人参与→推理连续性 | 死者保留发言+鬼票——账本永不中断 | 出局即禁言，信息流断裂 | **BOTC（决定性优势）** |
| 说书人自由裁量 | ST 可说谎、中毒/醉酒信息为假、裁定疯狂——需把 ST 建模为一等 agent；TB 本裁量最小 | 法官纯程序性 | 狼人杀 |
| 带真值公开资料 | 官方频道 50+ 局+惯例全身份揭晓；wiki+Schema 提供角色级真值 | 赛事视频有，但无事件化文字战报、依赖真人 meta | BOTC |
| AI 先例 | 专用 LLM benchmark + ACL 2026 论文 + 多个开源项目 | Mafia/Avalon 学术传统深厚 | BOTC |

**明确结论：血染钟楼更适合首发。** 三条硬理由：①账本即官方数据结构——角色 Schema+夜间时序表+wiki 真值页让结构化账本直接构建在官方标准之上；②死人参与机制保证信息流与投票动力学连续，是竞争假设推理循环跑满全场的结构性前提；③带真值复盘材料丰富且可机读。最大干扰项=说书人自由裁量——缓解：首发锁定暗流涌动（TB）本（裁量最小、恶魔唯一），把说书人建模为一等 agent（社区 auto-dm 项目已验证可行）。狼人杀作第二顺位（规则确定性强、中文赛事材料多）。

## 6. 最终结论

**适配（首发）。** 首发建议：锁定暗流涌动剧本、说书人建模为一等 agent、按"复盘推演（用公开真值对局验证假设循环）→ 自主对局"两阶段推进；说书人自由裁量与中毒/醉酒的"合法谎言"是最大建模成本，需在研判循环中作为一等不确定性来源显式处理。

## 附：全部来源 URL

官方一手：https://bloodontheclocktower.com/ · https://wiki.bloodontheclocktower.com/Character_Types · https://wiki.bloodontheclocktower.com/Bad_Moon_Rising · https://wiki.bloodontheclocktower.com/Rules_Explanation · https://bloodontheclocktower.com/pages/custom-scripts · https://github.com/ThePandemoniumInstitute/botc-release · https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/script-schema.json · https://release.botc.app/resources · https://botc.app/ · https://www.youtube.com/@thepandemoniuminstitute · https://aclanthology.org/2026.findings-acl.2043/

社区/工具：https://github.com/bra1n/townsquare · https://clocktower.online/ · https://github.com/AdmiralGT/botc-scripts · https://github.com/Skateside/pocket-grimoire · https://github.com/tjhowse/botc · https://github.com/lilserf/bot-on-the-clocktower · https://github.com/lindsaykwardell/clocktracker · https://github.com/Xinverse/Blood-on-the-Clocktower-Storyteller-Discord-Bot · https://boardgamegeek.com/thread/3523162/ai-plays-blood-on-the-clocktower · https://clocktower-radio.com/ · https://github.com/rigeman/blood-clocktower · https://github.com/EthanQC/Blood-on-the-Clocktower-auto-dm

国内：https://wiki.biligame.com/bloodontheclocktower/ · https://towerhb.huijiwiki.com/ · https://clocktower.gstonegames.com/ · https://www.gcores.com/articles/151550

对局资料：https://www.youtube.com/watch?v=mjHI18PX2jY · https://www.youtube.com/watch?v=H0zGtq-DAAE · https://www.youtube.com/watch?v=5-Xs8wYote0 · http://www.bilibili.com/video/av1651625691 · http://www.bilibili.com/video/av116929914275690

狼人杀对照：https://langrensha.163.com/ · https://werewolves.games/roles/ · https://www.bilibili.com/video/BV1LtsreAEzw/

**未核验项**：①WCO 赛事一手来源未找到；②各对局视频是否含全身份揭晓未逐一看片；③Clocktower Radio 内部评测方法未读全文；④ACL 论文五游戏完整名单未列全（BOTC 在列已确证）；⑤gstonegames 为国内代理方系推断；⑥BGG XML API 拉取失败，玩家数/时长采用官网口径与社区转述。
