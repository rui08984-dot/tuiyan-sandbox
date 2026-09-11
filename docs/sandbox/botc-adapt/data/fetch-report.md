# BOTC 数据层抓取报告（roles.json / script-schema / 官方中文译名）

> 生成时间：2026-09-08T15:10Z ｜ 执行：数据层子代理（会话内 6 轮探测 + 3 次全量管线） ｜ 工作目录 docs/sandbox/botc-adapt/data/

## 1. 数据源与抓取状态

| 源 | URL | 状态 | 产物 | 大小 |
|---|---|---|---|---|
| bra1n/townsquare roles.json | raw.githubusercontent.com/bra1n/townsquare/**master**/src/roles.json | **HTTP 200**（master 分支直中，未启用 main/jsdelivr 候选） | roles-townsquare.json | 65,425 B |
| ThePandemoniumInstitute/botc-release script-schema.json | raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/script-schema.json | **HTTP 200** | script-schema.json | 17,491 B |
| B站官方中文 Wiki（染·钟楼谜团） | wiki.biligame.com/bloodontheclocktower/api.php | **HTTP 200**（~400 请求，间隔 ≥620ms） | zh-cache/ 130 条 + ability-cache/ | — |
| 灰机 Wiki 备源（towerhb.huijiwiki.com） | api.php | **HTTP 403**（bot 防护，未重试第 4 次） | 未使用 | — |

抓取事故注记：①biligame 网关两次瞬断（HTTP 567），补全浏览器头（UA/Accept/Referer）后恢复；②search API 不可靠（部分查询恒 0 命中），弃用，改走**剧本页 gallery 权威映射**。

## 2. 三本角色数与团队结构（对照摸底报告预期）

摸底预期：TB=27 / BMR=30 / SNV=30 含旅行者 + 43 无剧本归属 → **实测完全一致** ✅

| edition | townsfolk | outsider | minion | demon | traveller | 合计 |
|---|---|---|---|---|---|---|
| tb 暗流涌动 | 13 | 4 | 4 | 1 | 5 | **27** |
| bmr 黯月初升 | 13 | 4 | 4 | 4 | 5 | **30** |
| snv 梦殒春宵 | 13 | 4 | 4 | 4 | 5 | **30** |
| （实验/无剧本） | 21 | 7 | 8 | 6 | 1 | **43** |
| 合计 | 60 | 19 | 20 | 15 | 16 | **130** |

team 总量：townsfolk 60 / outsider 19 / minion 20 / demon 15 / traveller 16。130 个 id 全部唯一、全匹配 ^[a-z0-9]+$，必填 id/name/team/ability 无缺。

## 3. 中文抓取管线（程序化）

1. 页面命名：官方角色页为纯中文标题（洗衣妇/涡流…）；粉丝自制页多带 `中文·English` 后缀。
2. **权威映射**：五张剧本/分类页的 gallery 结构 `File:{EnToken}.png|link={中文名}|[[{中文名}]]`——TB=暗流涌动、BMR=黯月初升、SNV=梦殒春宵、旅行者、实验性角色 → 一次性拿到 129/130 的官方中文译名（mephit 无条目）。
3. 能力提取：逐角色解析中文页，取 `== 角色能力 ==` 整节清洗为纯文本（首版只取首个 ''' 块导致 SNV 四恶魔截断，已改整节重取）。
4. **污染控制**：同名粉丝页抢位检测——页面含 `出现剧本：<粉丝剧本>` 且能力语义与 roles.json 英文原文不符 → 判污染。
5. 限速：全请求间隔 ≥620ms；失败退避重试 ≤5 次；全部走完整浏览器头。

## 4. 中文覆盖率（目标 ≥90% 官方剧本角色 ✅）

| 口径 | 译名 name_zh | 能力 ability_zh |
|---|---|---|
| 全量 130 | **129/130 = 99.2%** | 124/130 = 95.4% |
| 官方三本核心角色（72，非旅行者） | **72/72 = 100%** | 69/72 = 95.8% |
| 官方三本含旅行者（88） | 88/88 = 100% | 84/88 = 95.5% |
| 实验池（43，含 1 旅行者） | 42/43 = 97.7% | 38/43 = 88.4% |
| 旅行者（16） | 16/16 = 100% | 16/16 = 100% |

（各口径分母有重叠：实验池 43 内含 1 旅行者，72+16+42=130。）

## 5. 缺页与污染清单（如实记录）

**译名缺页（1）**
- `mephit`（Mephit，实验·minion）：五张剧本页 gallery 无条目、无 File:Mephit.png、search/opensearch/反查均无 → name_zh=null。

**能力置空（5，页面被粉丝同名角色占用，能力语义与官方 EN 不符）**

| id | 官方中文名（来自剧本页 gallery，保留） | 抢位粉丝剧本 | 官方 EN 能力（节选） |
|---|---|---|---|
| soldier | 士兵 | 灯火管制 | You are safe from the Demon. |
| minstrel | 吟游诗人 | 魔法祭典 | When a Minion dies by execution, all other players… drunk until dusk tomorrow. |
| alchemist | 炼金术士 | 魔法祭典 | You have a not-in-play Minion ability. |
| fool | 弄臣 | 歌剧魅影 | The first time you die, you don't. |
| snitch | 告密者 | 灯火管制 | Minions start knowing 3 not-in-play characters. |

误报排除说明：sailor（水手）页虽标注出现剧本=器官之旅，但能力全文与官方 EN 语义一致（你不会死亡…醉酒直到下个黄昏 ↔ You can't die… drunk until dusk），**保留**。chambermaid/mastermind/legion/leviathan 的分类正则误报经人工复核为官方文本，保留。

## 6. 许可注记（铁律落位）

- **bra1n/townsquare（GPL-3.0）**：仅作为**数据源**快照引用（roles-townsquare.json 原样保存），**未引入任何 GPL 代码**到本项目；roles-zh.json 为独立加工产物（字段重组+译名合并），非衍生代码。
- **ThePandemoniumInstitute/botc-release script-schema.json**：官方一手结构基准，仅用于校验，未修改未再分发。
- **B站官方中文 Wiki**：《染·钟楼谜团》官方译名渠道；抓取内容仅作译名/能力映射，礼貌限速抓取。
- **灰机 Wiki（CC BY-SA 3.0）**：备源，本次未使用（403）。
- 无 API key 参与，无密钥落入任何输出。

## 7. 抽样 5 角色原文（roles-zh.json，含 1 BMR / 1 SNV）

### washerwoman（TB·镇民）
```json
{"id":"washerwoman","name_en":"Washerwoman","name_zh":"洗衣妇","team":"townsfolk","editions":["tb"],"ability_en":"You start knowing that 1 of 2 players is a particular Townsfolk.","ability_zh":"在你的首个夜晚，你会得知两名玩家和一个镇民角色：这两名玩家之一是该角色。","first_night":33,"other_night":0,"reminders":["Townsfolk","Wrong"],"unique_note":"唯一（BOTC 常规剧本角色每局唯一）"}
```

### sailor（BMR·镇民）
```json
{"id":"sailor","name_en":"Sailor","name_zh":"水手","team":"townsfolk","editions":["bmr"],"ability_en":"Each night, choose an alive player: either you or they are drunk until dusk. You can't die.","ability_zh":"你不会死亡。每个夜晚，你要选择除你以外的一名存活的玩家：你或他之一会醉酒直到下个黄昏。","first_night":11,"other_night":4,"reminders":["Drunk"],"unique_note":"唯一（BOTC 常规剧本角色每局唯一）"}
```

### vortox（SNV·恶魔）
```json
{"id":"vortox","name_en":"Vortox","name_zh":"涡流","team":"demon","editions":["snv"],"ability_en":"Each night*, choose a player: they die. Townsfolk abilities yield false info. Each day, if no-one is executed, evil wins.","ability_zh":"每个夜晚*，你要选择一名玩家：他死亡。 镇民玩家的能力都会产生错误信息。 如果白天没人被处决，邪恶阵营获胜。","first_night":0,"other_night":31,"reminders":["Dead"],"unique_note":"唯一（BOTC 常规剧本角色每局唯一）"}
```

### lilmonsta（实验·恶魔）
```json
{"id":"lilmonsta","name_en":"Lil' Monsta","name_zh":"小怪宝","team":"demon","editions":[],"ability_en":"Each night, Minions choose who babysits Lil' Monsta's token & \"is the Demon\". A player dies each night*. [+1 Minion]","ability_zh":"每个夜晚，所有爪牙要秘密决定由哪名玩家来照看小怪宝，然后该玩家被当作恶魔。每个夜晚*，会有一名玩家死亡。[+1爪牙]","first_night":15,"other_night":35,"reminders":[],"unique_note":"唯一（BOTC 常规剧本角色每局唯一）"}
```

### soldier（TB·镇民，污染置空样例）
```json
{"id":"soldier","name_en":"Soldier","name_zh":"士兵","team":"townsfolk","editions":["tb"],"ability_en":"You are safe from the Demon.","ability_zh":null,"first_night":0,"other_night":0,"reminders":[],"unique_note":"唯一（BOTC 常规剧本角色每局唯一）"}
```

## 8. 复现命令与产物清单

```
node validate.cjs        # 校验+统计（产物 validate-report.md）
node fetch-zh.cjs        # 搜索式初抓（历史，已被 gallery 权威路线取代）
node repair-zh.cjs       # 五剧本页 gallery 权威重映射（zh-cache）
node refetch-ab.cjs      # 整节重取能力+粉丝页判定
node patch-suspects.cjs  # 5 条污染能力置空注记
node build-roleszh.cjs   # 生成 roles-zh.json + build-stats.json
```

| 产物 | 说明 |
|---|---|
| roles-townsquare.json | townsquare 130 角色原样快照 |
| script-schema.json | 官方剧本 Schema 原样快照 |
| **roles-zh.json** | **数据层成品**：130 条归一化角色 |
| validate-report.md | 校验报告（0 错误） |
| zh-cache/ ability-cache/ | 逐角色抓取缓存（含来源路线与污染注记） |
| fetch-log.json | GitHub 抓取状态码记录 |
| build-stats.json | 构建统计 |

管线脚本与探测脚本（probe-wiki*.cjs 等 14 个）均保留于本目录备查。
