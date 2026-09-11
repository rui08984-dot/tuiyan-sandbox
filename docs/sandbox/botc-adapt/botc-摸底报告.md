# 血染钟楼（BOTC）剧本适配 · 摸底报告（收口版）

> 2026-09-09 队长整合。三源合一：①既有调研 docs/sandbox/botc-research-report.md（2026-09-07 A 路交付，10 轮网调带置信度）②设计总纲 §9.5（docs/specs/2026-09-07-推演沙盘-design.md:104）③补证网调（代理 4efb26ee 两断后由队长从其会话日志提取，.scratch/botc-research-*.txt 为原始证据）。

## 0. 一句话结论

**BOTC 适配是设计总纲既定方向（§9.5「官方 schema 是账本地基」），数据源全部就位（官方 schema+社区 130 角色数据+官方中文译名渠道），首发锁定暗流涌动（TB）本**；引擎缺口=数据层为零、谓词语义错位、唯一角色表硬编码，属中等规模一条线。

## 1. 数据源（全部核实在案）

| 源 | 内容 | 授权 | 状态 |
|---|---|---|---|
| ThePandemoniumInstitute/botc-release → script-schema.json | 官方剧本/角色 JSON Schema：数组结构，角色必填 id（小写字母数字）/name/team（townsfolk/outsider/minion/demon 等）/ability；meta 段 10 字段（剧本名/作者/firstNight/otherNight 顺序）；顶层无 uniqueItems 约束（unique 靠剧本语义非 schema 强制） | 官方一手 | ✓ 已抓取核验 |
| release.botc.app/resources | 官方公开给工具制作者的资产（CC 政策） | 官方 CC | ✓ 已核验 |
| bra1n/townsquare src/roles.json | **130 角色**（TB=27 / BMR=30 / SNV=30 含旅行者 + 43 无剧本归属），字段 11 项（id/name/team/ability/firstNight/otherNight/reminders/edition 等）；TB 细分=恶魔1(imp)+爪牙4+镇民13+外来者等 | GPL-3.0 | ✓ 已抓取统计 |
| B站官方中文 Wiki API（wiki.biligame.com/bloodontheclocktower） | 官方中文译名可程序化抓取（洗衣妇=washerwoman 实测）；中文正版更名《染·钟楼谜团》 | 官方 wiki | ✓ API 实测通 |
| 灰机 Wiki towerhb.huijiwiki.com | 中文角色资料备源 | CC BY-SA 3.0 | 备用 |
| 本地 docs/sandbox/refs/rulebook-text.txt | 规则书全文（角色名 141 处命中） | — | ✓ 在盘 |

## 2. 引擎现状缺口（实测，file:line 为证）

1. game_type 仅标签零分支（cli.js:57，全引擎无 game_type 逻辑分支）
2. 唯一角色表硬编码狼人杀五角色（engine.js:37 女巫/预言家/猎人/守卫/骑士）——BOTC 角色全不在
3. 谓词 7 枚举狼人杀味（db.js:69）——is_wolf 对 BOTC 语义错位（无统一狼阵营）
4. 参谋卡 prompt 无剧本上下文注入（llm.js 仅一句醉酒/中毒提示）
5. 前端新建局类型下拉已有 botc/script 选项（P1b-2），但选了也只是标签

## 3. 谓词/声称缺口初判（待对齐定版）

BOTC 口播声称类型映射现有 7 谓词的可行性：claims_role/is_role 可直接复用（声称是某角色）；is_good 可复用但需按剧本语义重述；voted/did_action/death 通用；**缺口**：阵营声称（我信 X 是恶魔/爪牙 → is_demon/is_minion 或统一 is_evil+object=阵营）、状态声称（我醉了/我中毒了 → 状态类）、提名-处决事件结构（nominate/execute 与狼人杀投票的日夜结构差异）、说书人裁定事件（ST 裁量=一等不确定性，既有报告 §5 已警示）。

## 4. 建议切分（供对齐后定版）

- **S1 数据层**（S）：botc-adapt/data/ 三剧本 JSON（townsquare 130 角色打底+官方 schema 校验+中文译名映射入 B站 wiki 抓取脚本）；建局时挂剧本
- **S2 谓词+比对器**（M）：谓词枚举按剧本参数化；唯一角色表由剧本数据驱动（BOTC 几乎全角色每局唯一，R1 对跳反而更强）；加 BOTC 声称谓词
- **S3 判词注入**（M）：参谋卡 prompt 注入本局剧本角色能力摘要（按角色名匹配数据层）
- **S4 前端联动**（S）：建局选剧本→加载角色清单（席位-角色映射编辑）；宏/确认卡谓词选项按剧本切换
- **S5 抽取重测**（S）：TB 口播 LIVE 抽取质量重测（狼人杀实测错误率 33%，BOTC 角色名更怪预计更高，确认流护栏不动）
- 依赖链：S1→S2→S3/S4→S5；S1/S2 可一线串行交付，S3/S4 可并行

## 5. 待用户对齐决策点

①首发剧本范围（建议仅 TB）②角色数据源与授权策略（建议 townsquare 打底+官方 schema 校验+官方中文译名抓取）③谓词扩展口径（建议新增 BOTC 专属谓词、is_wolf 保留给 werewolf）④判词/说书人建模深度（建议首版仅 prompt 注入，ST 建模一等 agent 后置）

## 6. 用户拍板（2026-09-09 颗粒度对齐三问）

①首发剧本范围=**三本一起**（TB/BMR/SNV 数据层与判词上下文一次到位；BMR/SNV 特有机制——夜死不公布/疯狂——首版以数据标记+判词提示处理，不做机制级模拟）②数据与译名=townsquare 130 角色打底+官方 script-schema 校验+B站 wiki 抓官方中文译名③谓词=新增 BOTC 专属谓词（is_demon/is_minion/状态类），is_wolf 保留 werewolf 专用。

## 7. 与玄学判词线的耦合

判词要准，剧本上下文是前置之一（S3）；玄学线（p2-yijing 已有起卦模块+16 份档案）可先做「判词生成质量」不依赖剧本数据的部分，S3 落地后接入剧本上下文。
