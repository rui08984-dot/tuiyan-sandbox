# 恐怖口播产线 · Skill 调用清单（2026-09-03 定版）

> 回答三个问题：写稿走哪些 skill / 和写小说的 skill 冲突吗 / 纪律 skill 怎么用。

## 一、主产线：只走一个主 skill + 三个配套（按工作流六步）

| 工作流步骤 | 调用的 skill/工具 | 用法 |
|---|---|---|
| 1-3 受理/选型/骨架 | **horror-teller**（本地技能，唯一主产线） | 排期表受理→三档规格选型→骨架埋点 |
| 4 成稿 | horror-teller 十二条硬规 + **保质五招**（P3b §四，成稿时顺手做） | 词层杠杆前置 |
| 5 口播转译 | horror-teller → oral-conversion.md | 气群节奏/标注规范/证据音位 |
| 6-① 结构门+语感门 | structure_metrics.cjs + oral_texture.cjs（自建工具，非 skill） | 机器门 M1-M8 实测 |
| 6-② 红线 | horror-teller 红线七条+三判据 | 合规 |
| 6-③ 词层 | **deslop-standard**（E:\小说工坊 外挂，主）→ harness 技能 `deslop`（兜底） | 语义层微调 |
| 6-④ 检测 | **aidetect**（harness） | 剥标注跑，相对指标，不单独验收 |
| 6-⑤ 图谱 | 伏笔回收图谱（fuji 法，已入 S7） | 每期必建 |
| 回味段/片头 | horror-teller 栏目化节 | 排期表话题落地 |

## 二、可选辅助（按需，不默认叠加）

| skill | 什么时候用 | 什么时候不用 |
|---|---|---|
| `green-rhythm` | 朱雀片段≥0.5 定向重写修复轮；M3 句长波浪的配方来源 | 成稿时不叠加（M 门已覆盖） |
| `human` | 情绪平均/太正常的深层人味修复 | 日常成稿不叠（硬规12+人物一致性已管） |
| `aidetect` 已列上；`review`/`continuity`/`story-structure`/`character-archetypes` | 网文长篇向 | 口播稿**不用**（图谱/节奏合同/单篇规模已覆盖，防过度工程） |

## 三、与写小说 skill 的冲突判定（重点）

| 网文系 skill | 与 horror-teller 的关系 | 判定 |
|---|---|---|
| `novel-live-writing`（网文活人感总装：对话「」/破折号清零/连句少句号） | **域不同**：它管「阅读文本」，horror-teller 管「讲述稿」。且规则会打架——它要破折号清零，horror-teller 峰值处用「——」；它要对话「」体，horror-teller 转述体优先 | ❌ 不同时总装。只有把口播稿改写成图文小说版时才用它 |
| `deslop`/`humanizer-zh` | 与 deslop-standard、M8 高度重叠 | ⚠ 双去味会打架：产线内只用 deslop-standard（兜底 harness deslop）；humanizer-zh 仅当外部评价「翻译腔」时单独上 |
| `human` | 互补不冲突（它管情绪层，M8 管皮层，结构门管骨架） | ✅ 修复轮按需 |
| `aidetect` | 唯一检测器，地板效应已知 | ✅ 已定位为辅助证据 |
| `green-rhythm` | 句长波浪同源（M3/M5 阈值的配方出处） | ✅ 修复轮用 |

**一句话结论：写恐怖口播 = horror-teller 一个主 skill + deslop-standard/aidetect 两个质检配套 + 自建三工具；网文系技能不进这条产线，冲突点已隔离。**

## 四、纪律 skill 映射（会话开头那批纪律 skill，核查结果：无问题）

| 纪律 skill | 本产线触发时机 | 本会话实际执行 |
|---|---|---|
| `skill-creator` | **每次创建/更新 skill 前**（用户铁律） | ✅ 本会话成功加载 5 次（另有 2 次 anti-stuck 误拦，记录在案） |
| `plan-before-execute` | 多步骤任务 | ✅ 本清单即按其流程产出 |
| `verification-before-completion` | 宣称完成前 | ✅ 双门复验+grep 实证已成固定动作 |
| `debug-by-root-cause`/`dsh-error-protocol`/`dsh-error-triage` | 工具连续失败/报错 | ✅ 本会话每次失败都先定位根因（少括号/嵌套pwsh/编码/旧快照），无盲目重试 |
| `systematic-debugging` | bug/异常行为 | ✅ 用于朱雀对照实验设计 |
| `dsh-fast-lookup`/`local-first` | 找文件/查事实 | ✅ 资产定位、依赖核验均走此路 |

注意一个已知噪音：**env-triage/纪律提醒卡存在误报模式**（把成功调用计为失败、跨轮累计旧账），本会话与被分析的旧会话均多次实证。处置原则：卡片出现时先核对实际工具回执，回执为准，不为卡片盲目换方法。

## 五、产线资产速查

- 主技能：`E:\music player\skills\horror-teller\`（v2.1，五层：题材/骨架/技法/口播/质检）
- 自建工具三件：`E:\music player\tools\structure_metrics.cjs`（结构指纹）/ `oral_texture.cjs`（语感密度）/ `strip_annotations.cjs`（贴检剥标注）
- 外挂质检：`E:\小说工坊\skills\deslop-standard\SKILL.md`（在位 ✓）
- 贴检文件：第1期 C 版 3837 字（过阈值）/ 第2期 2613 字（短文本噪声区）
