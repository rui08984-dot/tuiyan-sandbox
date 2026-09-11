# 开源生态扫描与审计报告（AI 推演沙盘）

> 产出说明：子代理 C 完成了全部核验（GitHub raw/HTML 抓取、roles.json 端点实测、14 仓活跃度、license 落定），但在写入本文件前崩溃。本报告由队长依 C 两份进度回报中的**已核验数据** + A 路调研报告 + 队长独立抽查整合落盘。标 [未核验] 处为 C 已核验但未及回传具体值的项目。

## 一、可直接复用（拿数据/拿代码）

| 项目 | 是什么 | 对本项目的用法 | 审计备注 |
|---|---|---|---|
| ThePandemoniumInstitute/botc-release（⭐107） | 官方 App 发布仓 + 工具制作者资源 + **官方剧本/角色 JSON Schema**（script-schema.json：id/name/team/ability 必填 + firstNight/otherNight 时序）；官方数据端点 release.botc.app/resources/data/roles.json（99KB，C 实测存在） | **账本 schema 直接建在官方标准上**：角色表=官方 JSON，事件时序=官方夜序表 | CC 授权政策向工具生态开放（A 路一手核验）；这是本项目最大的外部红利 |
| qimen-dunjia@3.1.0（npm） | 奇门遁甲排盘库 | P2 玄学层确定层首选 | npm 活跃（2026-08 有版本）；license 具体值 [未核验] |
| mingpan@0.1.7（npm） | MCP 多术数排盘 | P2 备选/交叉验证 | 活跃（2026-09）；license [未核验] |

## 二、借鉴设计不抄代码

| 项目 | 亮点 | 借鉴点 |
|---|---|---|
| bra1n/townsquare（⭐504，clocktower.online 本体） | 虚拟魔典+市镇广场，支持官方 Script Tool JSON；**README 声明已停止积极维护** | 魔典数据模型/对局状态机设计；前端交互形态参考；注意勿依赖其维护 |
| TLSM/townsquare | 另一套虚拟魔典（活跃） | 与 bra1n 版对照借鉴 |
| lindsaykwardell/clocktracker（⭐19） | 对局记录与统计 Web 应用——与本项目"账本"思路同源 | 它的"记录什么字段"就是现成的账本字段需求调研 |
| JuneQQQ/deepwolf | 狼人杀自播竞技场 + **可解释人机副驾** | 定位与本项目"辅助真人"一致：看它如何呈现研判依据与置信 |
| ReneeYe/MaKTO-Werewolf | 多智能体 KTO 强化论文代码 | 竞争假设/对抗训练思路（远期） |
| Gitsamshi/open_werewolf | 开源狼人杀引擎 | 多 agent 对局编排 |
| junjiem/werewolf-agent | 中文 Java 玩具实现 | 中文提示词素材 |
| EthanQC/Blood-on-the-Clocktower-auto-dm | Go 后端，LLM 扮演说书人自动跑夜行动作/私聊 DM | **说书人=一等 agent 的可行性已被验证**，直接借鉴其 ST 建模 |
| Xinverse/Blood-on-the-Clocktower-Storyteller-Discord-Bot（⭐14） | 纯文本全自动说书人 | 文本驱动 ST 的最小实现参考 |
| rigeman/blood-clocktower | 腾讯混元 LLM 驱动 BOTC | 中文 LLM+BOTC 接法 |
| Skateside/pocket-grimoire（⭐89）/ AdmiralGT/botc-scripts（⭐33）/ tjhowse/botc（⭐96）/ lilserf（⭐29）/ tchajed/botc-tools / ethicalAndroid/clocktower-custom-roles | 生态工具群 | 按需取用：剧本库、角色 JSON 样本 |

## 三、反面教材 / 红旗

1. **taobi@0.4.5**：奇门库 2024-09 后停更（0.x）——勿接手别人的 bug 池（P2 用 qimen-dunjia/mingpan 替代）。
2. **bra1n/townsquare 停止积极维护**：可借鉴设计，不可押注依赖。
3. **Clocktower Radio benchmark**：它是"AI 互跑测模型"路线——本项目差异化定位=辅助真人玩家，勿滑向 benchmark 内卷。
4. **方法论教训（本会话实测）**：GitHub REST API 未认证限流（C 实测）→ 走 raw/HTML 抓取；知乎/B站专栏正文反爬（B 实测 403/-509/截图化）→ 文字资料优先简书/搜狐镜像/官方规则书；**子代理单回合实测 17-18 分钟**（本会话昼 1 双轨实测 1104s/1013s）→ 委派任务必须切小块、控制输出长度。

## 四、TOP3 架构借鉴点（给下一步）

1. **账本 schema = 官方 script-schema.json 超集**：角色表直接吃官方 roles.json，事件表对齐 firstNight/otherNight 时序；「声称表+行动表」双表挂在其上。
2. **说书人建模为一等 agent**（auto-dm 项目已验证）：首发锁定 TB 本（裁量最小），ST 的自由裁量/中毒醉酒"合法谎言"作为研判循环的一等不确定性来源。
3. **研判呈现学 deepwolf**：可解释副驾（依据链+置信表述），不做黑盒断言。

## 五、对局资料检索受阻记录（B 路实测，供复用）

知乎专栏 403/jina 验证墙；Reddit .json 403；BGG PbF 正文 WAF 挡（Game 46/47 仅存线索）；B站专栏 JS 渲染+API -509 风控（正文截图化）；WPL BWIKI 只有赛程无战报。**可行的文字源**：简书复盘（Lyingman S02E01"JY封神之路"~85% 完整度）、搜狐镜像（Pandakill S1E7"阴阳倒钩"~70%）、官方规则书 Example of Play（BOTC，已建档）。B 路候选清单存于 docs/sandbox/p0-replay/candidates.md。
