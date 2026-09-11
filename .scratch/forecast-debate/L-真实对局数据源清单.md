# L · 真实对局数据源勘察清单（L 棒 · L0 校准线弹药库）

> 执行者：L-数据勘察棒 ｜ 日期：2026-09-11 ｜ 锚：家底 3 局（Lyingman S02E01 / Pandakill S1E7 / BOTC rulebook）格式=docs/sandbox/p0-replay/replay-*.md（事件流 E-1..N 公开层）+ .truth.md（身份+夜行动真值）配对
> 方法：单回合联网勘察。实抓可靠域：raw.githubusercontent.com（README/LICENSE）、B站检索（platform_search）、exa/tavily/keenable 搜索。抓取失败域如实标注：fandom.com、reddit.com（含 .json 端点）、aiwolf.org（30s 超时）。
> 成本估算口径（标【估算】）：转录成本按家底 Lyingman S02E01 实作外推——有文字复盘帖≈1-2 人时/局；纯看视频转录≈3-6 人时/局；JSON→replay 写转换器 0.5-1 人天+每局分钟级。
> 优先级判据：S=真值完整（终局全身份）∧现成量大（≥10 局）∧≤2 人时/局；A=三要素缺一但可补；B=可用但成本高/量少；C=仅登记。

## 一 · 狼人杀综艺（B 站实抓检索，2026-09-11）

| 源 | 数据形态 | 真值完整性 | 数量 | 获取方式 | 转录成本【估算】 | 优先级 |
|---|---|---|---|---|---|---|
| **Lyingman 各季**（「狼人杀视频整合计划」合集） | 视频（B站） | 终局亮身份实践存在（家底 S02E01 真值系复盘帖文字实锤）；各集是否全员亮身份未逐集核【待验证】 | S1/S2/S3/S6/S7 各季全集 | S1 av56733313、S2 av3195083（家底出处季）、S3 av56755952、S6 国际狼王争霸 1080p av57171845、S7 av57653344 | 有复盘帖 1-2 人时/局；纯视频 3-6 人时/局 | **S** |
| **PandaKill 各季** | 视频 | 同上【待验证】 | S1/S2/S3 全集+S4 单集 | S1 av56786616、S2 av57535338、S3 av26958994（金字塔之旅）、S4E1 av521187331、S1E6 av25007483 | 同上 | **S** |
| **GodLie（虎牙）** | 视频（直播精剪/录屏） | 综艺局终局揭示实践同上【待验证】 | S1 全集 av67603727、S5 经典回顾 av436666792、直播精剪 av462426949 / av632443006 | B站 | 同上 | A |
| 综艺复盘帖生态（贴吧/知乎/B站专栏） | 文字 | 复盘帖常直接给全身份名单（家底 truth 即此路径实证，truth 文件 L9"复盘开头『游戏成员』名单直接给出"） | 未知，逐季逐集需搜【待验证】 | 搜索"对局名+复盘" | 有帖则 1-2 人时/局 | **S（转录加速器，配合上三行用）** |

- 评注：综艺局是唯一「真人+高 stakes+有转播意识」的真值源，与家底两局同构（可直并 L0 账本）；版型家底已定 11 人屠城局口径，同季同版型局转录模板零改造。字幕：综艺硬字幕（说话人标注）为行业常态，未逐集核【待验证】。检索快照证据=platform_search/bilibili 本轮实抓，av 号见上表。
- 风险：整合计划合集可能缺集/删档；真值「亮身份」环节每集需人工确认存在后才计入预算。

## 二 · 血染钟楼 BOTC（第二游戏域补充弹药）

| 源 | 数据形态 | 真值完整性 | 数量 | 获取方式 | 转录成本【估算】 | 优先级 |
|---|---|---|---|---|---|---|
| r/BloodOnTheClocktower 说书人复盘帖 | 文字+终局状态图+botc-scripts 剧本链接 | 高（说书人视角常给全身份+逐夜过程； completeness 参差） | 大量散帖（本轮 exa 实抓多例：Game Report NYC 5/29、1ka95lp、1gwrfb6 等） | reddit.com（本轮直抓+JSON 端点均 fetch failed→【转述】搜索引擎快照；需爬虫武库 batch_extract.py 试或人工浏览） | 2-4 人时/局（逐帖人工读+格式散） | B |
| No Rolls Barred YouTube 系列+fandom wiki 分集页 | 视频+wiki 文字 | 高（终局 grimoire 公开；wiki 分集页存在但本轮 fetch failed【转述】） | 系列剧集数十（fandom「No Rolls Barred Plays BOTC」+Legacy 2026-07 新季） | youtube.com + no-rolls-barred.fandom.com | 纯视频 4-8 人时/局；wiki 有身份表则降至 1-2 | B |
| **botc.app 官方在线** | 应用内记录 | 官方 App 有 public games 旁观列表（官方教程视频提及）；**对局数据导出未证实**——Reddit 帖「Download Game Data from BOTC App/Online?」（1rjghiq）实抓失败，答案未核【待验证】 | 未核 | botc.app；官方开源 App：github.com/ThePandemoniumInstitute/botc-release | 若可导出 JSON：转换器 1 人天+每局分钟级 | A-（若导出成立升 S） |
| vrrdnt/town-square（Discord 说书 bot） | Discord 频道记录 | bot 自动管理夜行动/私聊频道→结构化日志潜力 | 公共服务器未查 | github.com/vrrdnt/town-square | 未知，待验证 | C |
| pocketgrimoire.co.uk / botc-scripts.azurewebsites.net | 工具/剧本库 | 非对局数据 | — | 直接访问 | — | 工具位登记 |

- 评注：BOTC 真值结构（说书人全知+终局复盘文化）理论弹药充足，瓶颈=**机器可读性**（无公开对局日志 API 的证据）。家底已有 1 局 rulebook 局，BOTC 追加弹药优先级让位于狼人杀。

## 三 · 学术公开数据集（结构化 JSON+真值，转换器路径）

| 源 | 数据形态 | 真值完整性 | 数量 | 获取方式 | 转录成本【估算】 | 优先级 |
|---|---|---|---|---|---|---|
| **AvalonBench**（Light et al., arXiv:2310.05036） | JSON 对局记录（AgentBench 基座多智能体） | 游戏引擎生成→真值天然完整；含 human 数据（S3 直链快照：avalon-benchmark.s3.../avalon__human_scores__*.json、observations——直链可用性【待验证】） | 论文口径数百局级【待验证】 | 官方库 github.com/jonathanmli/Avalon-LLM（本轮 README 实抓）+ avalonbench.github.io + 镜像组织 github.com/Avalon-Benchmark/avalon | 转换器 1 人天+每局分钟级；但游戏域=Avalon 非狼人杀，判词 prompt 需适配第二版型 | **A** |
| **Werewolf Arena**（Google DeepMind, arXiv:2407.13943） | JSON 状态目录（runner 落盘+resume 机制） | 自对局引擎生成→真值完整 | 论文局数未在 README 载明【待验证】 | github.com/google/werewolf_arena（README+LICENSE 实抓，**Apache-2.0**）；论文数据未确认公开 | 自跑成本见 §四；复用论文存量数据未证实 | B |
| **Kaggle Game Arena: Werewolf**（blog.google 2026-02 实抓快照） | 平台对局（人类 vs Gemini 等） | 平台结算真值 | 上线 2 个月量未知【待验证】 | kaggle.com/blog/game-arena-werewolf；原始日志是否公开未证实 | 待验证 | B（观察项） |
| **AIWolf 竞赛生态**（aiwolf.org，日本） | 协议版对局日志（JSON/文本） | 引擎记录→真值完整 | 历届大赛（2024 国内大会/2025 春季等）日志量可观【待验证】 | aiwolf.org/en/resource（本轮 30s 超时【转述】）；分析站 github.com/aiwolf-ioh/aiwolfweb_front（胜率/存活率统计） | 转换器 1 人天；**协议版发言=模板化非自然语言**→对「判词/多路」用途打折，仅适合记账统计位 | B |
| LLMafia + Time to Talk（arXiv:2506.05309, niveck/LLMafia） | 异步 Mafia 论文数据 | 完整 | 论文实验局数【待验证】 | github.com/niveck/LLMafia；huggingface.co/papers/2506.05309 | 同 Avalon 路径 | B |

- 评注：学术源唯一提供**机器可读+真值天然完整**的批量数据，但两个折扣：①游戏域多为 Avalon/Mafia 变体，与狼人杀版型不同（判词/基率要按版型重写，正好当第二游戏域测泛化）；②"真人感"为零——校准线要的是「人怎么玩」，自对局/引擎局只能当**机械基线臂**，不能冒充真人对局（对齐铁律：只记不评阶段当对照数据用）。

## 四 · 自对局框架（自跑生成带真值数据——量的唯一出路）

| 框架 | LLM 自对局能力 | 输出格式 | 跑一局成本【估算】 | License | 优先级 |
|---|---|---|---|---|---|
| **hikariming/AIWolfGame**（任务书 95★，实抓 90★级） | 6-12 人局全流程（夜动/讨论/投票/遗言/平票补发言）；多模型混编（GPT/Claude/Gemini/DeepSeek/Qwen…）；角色认知+记忆系统 | **完整保存游戏过程支持复盘**（README 实抓）；胜率/投票分析统计位 | 12 人×6-8 天×~250-400 次调用×~800 tok ≈ 16-32 万 tok/局；接 DeepSeek 量级模型≈**¥1-3/局**（价目未核【待验证】） | **MIT** | **A+（自对局首选）** |
| **OpenBMB/AgentVerse**（任务书 5120★） | 多智能体框架含狼人杀模拟 demo（论文 EMNLP 2023 demo） | 框架级 JSON 日志 | 框架重、旧（2023）；跑通配置成本高（人天级） | **Apache-2.0**（README 实抓） | B |
| **oil-oil/wolfcha**（任务书 701★） | Next.js 网页版 AI 狼人杀（DeepSeek/Qwen/Gemini 玩家，8 角色） | 网页对局；**对局记录导出未证实**【待验证】（自托管开源可改造） | 自托管+API 费，量级同上 | 开源（License 未实抓【待验证】） | B |
| **mohsen1/mafia-arena**（任务书 7★，实抓 6★） | Mafia 排名 arena（模型互骗互推） | ARCHITECTURE.md 载结构化设计 | 量级同上 | 未实抓【待验证】 | C |
| **google/werewolf_arena**（任务书 48★） | 论文级评测框架（v_models×w_models 组合赛制+bulk resume+Interactive Viewer） | 目录落盘状态+viewer（JSON） | 同量级；**GCP/Vertex 依赖**（Gemini 侧需 gcloud auth） | **Apache-2.0**（LICENSE 实抓） | B+（赛制引擎可抄，跑通成本中） |

### 意外收获（本轮检索新增，任务书未点名）
| 框架 | 亮点 | 优先级 |
|---|---|---|
| **JuneQQQ/deepwolf**（2★） | "LLM werewolf engine: **agent self-play arena + explainable human copilot**"——与 D-裁决 §5.2「deepwolf 嫁接」路线同名同定位，**下棒重点考察对象**（引擎+copilot 双形态正对本项目参谋卡） | A（考察位） |
| Birchove/AIWolfGame | **12 人预女猎白**（标准狼人杀版型！）+DeepSeek+观战 UI——比 hikariming 版型更贴国内 12 人局 | A- |
| strongbugman/social-arena | Werewolf/Avalon 排名 arena，隔离 agent+胜率榜 | C+ |
| yingyingxia666/AgentWereWolf、yishiyige/LLMWereWolf | 中文自对局同类品 | C 登记位 |
| abshhh/AI-Social-Deduction-Arena、shadmau/modelArena（含视频渲染器）、CJHwong/nightfall-ai-arena | 各型 Mafia/Werewolf arena | C 登记位 |

## 五 · Top5 推荐（真值完整 × 量大 × 转录成本低 综合）

| # | 推荐 | 理由 | 首个动作 |
|---|---|---|---|
| 1 | **综艺主线：Lyingman/PandaKill 各季**（S） | 唯一真人真值源、与家底两局同版型同格式、B站全集 av 号已锁 | 逐集确认终局亮身份+搜同局复盘帖（帖>视频），先做 Lyingman S2/S3（与家底同节目生态） |
| 2 | **hikariming/AIWolfGame 自跑线**（A+） | MIT、OpenAI 兼容接口（可接本机 DeepSeek 通道）、完整复盘记录、量无限 | 克隆→接 3 模型混编跑 10 局→写 JSON→replay 转换器（0.5-1 人天）；产物**只入机械基线臂**，不冒充真人对局 |
| 3 | **AvalonBench 数据集线**（A） | 结构化 JSON+真值天然完整+第二游戏域（测判词/基率跨版型泛化） | 验证 Avalon-LLM 数据下载路径（含 S3 直链）→转换器评估 |
| 4 | **botc.app 导出探针线**（A-，条件升级 S） | 若官方 App 对局记录可导出→BOTC 弹药一次性解决（真值+量大+JSON） | 先答 Reddit 帖同问：本地抓 App 存储/网络包验证有无日志接口 |
| 5 | **AIWolf 竞赛日志线**（B） | 现成量大、格式规范；折扣=协议版发言模板化，只喂记账统计位不喂判词 | aiwolf.org 超时→换镜像/存档入口验证日志下载 |

- **执行顺序建议**：1 与 2 并行（1 补真人真值、2 补量）；3/4/5 按探针结果升降。
- **铁律对齐提醒**：自对局/引擎局=机械基线臂（对照数据）；综艺真人局=校准线主粮；两类在账本里分臂记账，永不混臂。

## 六 · 待验证清单（red-team 收尾，抓不到的如实列）

1. 综艺各集「终局全员亮身份」是否稳定存在——逐集人工确认前不计入预算。
2. 综艺硬字幕/说话人标注覆盖率。
3. AvalonBench S3 直链可用性与数据量。
4. botc.app 对局数据导出可行性（Reddit 提问帖实抓失败，答案未核）。
5. wolfcha 记录导出能力与其 License。
6. AIWolf 协议版日志下载入口（aiwolf.org 本轮 30s 超时，仅搜索快照【转述】）。
7. werewolf_arena 论文存量对局数据是否随仓库公开（README 未载）。
8. DeepSeek 量级模型现价（¥1-3/局估算的定价基础未核）。
9. fandom.com / reddit.com 本轮直抓全败——如需深挖走爬虫武库（batch_extract.py 经 py.exe；勿用 WindowsApps python=9009 假成功路径）。

**本轮实抓出处**：platform_search/bilibili（Lyingman/PandaKill/GodLie av 号）、github raw README×4（hikariming、AgentVerse、werewolf_arena+LICENSE、Avalon-LLM）、exa/tavily/keenable 快照（AvalonBench 链、wolfcha、mafia-arena、AIWolf 生态、NRB fandom、BOTC Reddit 复盘帖例、Kaggle Game Arena 博客）。

（L 棒完 · Top5 见 §五 · 待队长验收）

## 附录 · P 棒转录实战补充（2026-09-11，P 棒收官回合留档）

> 第 4-6 局转录实战验证的源与路径，供后续棒次复用。

| 项 | 内容 | 状态 |
|---|---|---|
| **api3.jianshu.io SSR 直抓** | 简书文章免登录域（api3.jianshu.io/p/<hash> ≙ www.jianshu.com/p/<hash>），三次验证稳定；www 域间歇反爬（同文随机空壳），r.jina.ai 本机不可达 | **已验证可复用**【已核】 |
| 喃以之语复盘系列（简书，网杀局，作者带上帝视角+身份公布节） | 复盘1 自刀狼（935eb40ad027，2016-10-17 盗贼板12人）/ 复盘2 丘比特（slug 未挖到，需作者目录页）/ 复盘3 倒钩狼（e3232b751516，预女猎白11人，**已转第5局**）/ 复盘4 怂狼（7f4c7f8b4bd3，预女猎守12人，**已转第4局**）/ 复盘5 盗贼悍跳狼（4e65b29adb6c，预女猎丘+盗贼12人） | 1/3/4/5 全文可抓【已核】；盗贼板×3 需 schema 扩展（丘比特/盗贼语义），**挂账待队长+用户裁定** |
| PandaKill S2E2（侠外论坛转载 bbs.xiawai.com/thread328066p1v1） | 原源=搜狐「封面君」专栏；恶魔板（3狼+1恶魔/预女猎守/4民）；**已转第6局**（概述级，完整度≈60%） | 【已核】 |
| 搜狐「封面君」专栏 | 系列复盘作者（S1E7 阴阳倒钩同源生态），文章 ID 不可枚举，需站内搜索或搜索引擎快照逐篇挖 | 候选源，未深挖 |
| 恶魔板 | PandaKill S2 变体：3狼+1恶魔（验神/吃毒不死/不可自爆）；账本对接=game_type 变体，恶魔验神归真相层，**公开层 schema 零扩展已验证** | 【已核】 |
| 避坑 | 233乐园「精彩对局复盘解析」系列为 AI 农场搬运文（避）；知乎 zhuanlan 直抓 403（避或走登录）；cn.bing.com 直抓长尾中文查询被降级成泛词（避，用 advanced_search exa/tavily 代替） | 【已核失败域】 |

（P 棒收官 · 真实局弹药 6 局：Lyingman S02E01 / Pandakill S1E7 / BOTC rulebook / 怂狼 20161215 / 倒钩 20161023 / Pandakill S2E2）

