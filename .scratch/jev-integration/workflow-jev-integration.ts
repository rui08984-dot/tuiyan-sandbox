// Jev 与本地 System One 类模型 · 能否整合进推演沙盘 —— 调研＋专家团评审
//
// 拓扑（19 个子代理，全部独立新上下文；共享通过磁盘文件而非共享会话）：
//   阶段1 读盘 ×3（现状/引擎/铁律）＋1 次只读账本核对（world.run）
//   阶段2 核查 ×5（Jev本体 / 候选A / 候选B / 证据卫生 / 本机可跑性）
//   阶段3 专家团 ×6（各自读阶段1+2的产物文件，六个不同镜头）
//   阶段4 红队 ×1（读六份表态，专职攻击）
//   阶段5 独立复核 ×2（承重事实：候选可跑性 / Jev 本体）
//   阶段6 合议 ×1 → 读者 ×1（至多一轮修订）→ 零污染自检 → 发布
//
// 判据择取：本次请求是调研＋方案，不改代码，故仓库自带测试不是本棒的判据。
// 本棒的确定性判据＝① 账本读数（node p1b/scripts/board.cjs，只读，不带输出路径参数时不落盘）
//              ② 本棒零污染自检（git status --porcelain）

interface Candidate {
  /** 候选名称（原名保留，不要翻译）。 */
  name: string;
  /** 实际达到的最高级：V1 存在 / V2 有料 / V3 可跑 / V4 可信；达不到写「未达」。 */
  grade: string;
  /** 参数量或架构规模；未知写「未知」。 */
  params: string;
  /** 在本机（见起点文件 §2 实测环境）上能否落地：是 / 否 / 不确定。 */
  localOk: string;
  /** 你本次亲测得到的最硬一条事实（含命令或 URL 与看到的输出）。 */
  note: string;
}

interface CandidateSweep {
  /** 你负责的每一条候选的结论。 */
  candidates: Candidate[];
  /** 你这批里最值得继续看的一条（写名称）；没有就写「无」。 */
  best: string;
  /** 一句话总结你这批的发现。 */
  summary: string;
  /** 你写出的产物文件路径。 */
  file: string;
}

interface StateDigest {
  /** 账本与判据的当前实测值一行。 */
  ledgerLine: string;
  /** 项目现在处于哪一期哪一棒，一到三句。 */
  whereWeAre: string;
  /** 已经封死或定性为负结果、不得重蹈的路径，逐条一句。 */
  sealedPaths: string[];
  /** 交接件给出的下一步候选，逐条一句。 */
  nextMoves: string[];
  /** 你读到的实况与交接件记载不一致之处；一致就写「无不一致」。 */
  discrepancies: string;
  file: string;
}

interface EngineMap {
  /** 五个引擎层各是什么、怎么出数，逐层一句。 */
  layers: string[];
  /** 判据原语（Brier／置信区间／TOST／MDE 等）的共享实现落在哪些文件。 */
  judgingPrimitives: string[];
  /** 一个外部模型若要插进来，明天就能动的位置（具体文件与函数名）。 */
  plugInPoints: string[];
  /** 现在大模型在系统里承担哪些角色、由哪个脚本调用、成本怎么记账。 */
  llmRoles: string[];
  file: string;
}

interface RuleMap {
  /** 与本方案直接相关的铁律原文，逐条带编号。 */
  relevantRules: string[];
  /** 铁律「大模型只出四种角色、不出概率」的原文在哪、四角色具体定义是什么。 */
  rule4Detail: string;
  /** PREREG 冻结现状：已冻结哪几件、合法改动路径是什么。 */
  preregRegime: string;
  /** 一个新的概率来源要进系统，按现行铁律最少要过哪几关，逐关一句。 */
  minimalGate: string[];
  file: string;
}

interface Position {
  /** 你的最终立场。 */
  stance: "支持整合" | "反对整合" | "条件放行";
  /** 三到五句话的核心论证。 */
  coreArgument: string;
  /** 你据以判断的最关键证据，每条一句（附文件路径或 URL）。 */
  keyEvidence: string[];
  /** 出现什么证据会让你改主意。 */
  whatWouldChangeMyMind: string;
  /** 若放行，最小可验证的第一步（一句话，具体到文件或实验）。 */
  firstStep: string;
  /** 你给「值得投入」打的分，0 到 10。 */
  score: number;
  /** 你写出的产物文件路径。 */
  file: string;
}

interface Attack {
  /** 被攻击的结论、席位或方案环节。 */
  target: string;
  /** 攻击点一句话。 */
  point: string;
  /** 证据或推理链（引文件路径、命令输出或 URL）。 */
  evidence: string;
  /** 严重度。 */
  severity: "fatal" | "major" | "minor";
}

interface RedTeamReport {
  attacks: Attack[];
  /** 三到五句话：如果这方案必败，最可能的败法是什么。 */
  failureMode: string;
  /** 专家团最自信、但证据最薄的那个判断是什么。 */
  mostOverconfident: string;
  file: string;
}

interface Confirmation {
  /** 你复核的主张原文（一句）。 */
  claim: string;
  /** 是否被你独立复现。 */
  reproduced: boolean;
  /** 你实际做了什么（命令或 URL）＋你看到了什么。 */
  how: string;
  /** 没能复现时，真实情况是什么；复现了就写「与主张一致」。 */
  correction: string;
}

interface ConfirmationBatch {
  confirmations: Confirmation[];
  file: string;
}

interface Synthesis {
  /** 一句话结论：这套东西该不该进这个项目、以什么身份进。 */
  verdict: string;
  /** 五到八句话的执行摘要，写给用户本人看。 */
  executiveSummary: string;
  /** 方案要点逐条（每条一句，具体到模块、脚本或判据）。 */
  planSteps: string[];
  /** 必须由用户拍板的事项，每条写清「要决定什么＋推荐哪个＋理由」；没有就空数组。 */
  decisionsNeeded: string[];
  /** 明确不做的事与原因（须与本项目的负结果史对齐）。 */
  doNotDo: string[];
  file: string;
}

interface ReaderFeedback {
  /** 读起来最不清楚的地方，逐条。 */
  unclear: string[];
  /** 报告没支撑住、或证据与结论不匹配的地方，逐条。 */
  unsupported: string[];
  /** 用户读完最可能追问的问题，逐条。 */
  likelyQuestions: string[];
  /** 是否严重到必须再改一版。 */
  blocking: boolean;
  file: string;
}

interface Finding {
  /** 涉及的文件、候选或结论点。 */
  where: string;
  /** 一句话：发现了什么。 */
  what: string;
  /** 什么证明了它：读到的行、或命令与输出。 */
  evidence: string;
  /** verified＝被独立复核或确定性命令确认；unconfirmed＝未复现或未复核。 */
  status: "verified" | "unconfirmed";
  /** 重要度。high 留给会花掉真金白银或改口径的东西。 */
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  conclusion: string;
  findings: Finding[];
  verified: string[];
  notCovered: string[];
}

// ── 看板：候选逐条核查（本棒跑得久，值得有一张实时表） ──
artifact.table("candidates", {
  title: "本地开源候选逐条核查",
  description: "每批核查员回报一条；同一候选后到者覆盖先前者。V1 存在 → V2 有料 → V3 可跑 → V4 可信。",
  columns: [
    { field: "name", label: "候选" },
    { field: "grade", label: "分级" },
    { field: "params", label: "参数量" },
    { field: "localOk", label: "本机可跑" },
    { field: "note", label: "最硬的一条事实" },
  ],
  key: "name",
});

const START = ".scratch/jev-integration/00-起点事实与待核清单.md";
const OUT = ".scratch/jev-integration/";

// 所有子代理共用的硬约束（写在每条 ask 里，避免它们各写各的规矩）
const RU = [
  "【硬约束 · 违反即产出作废】",
  "1) 只读仓库。你唯一可以写的位置是 " + OUT + " 目录下你自己的产物文件；严禁写 p1b/、docs/、任何 *.db、.scratch/handoff/、任何 *-PROGRESS.md。",
  "2) 不装软件、不改配置、不动 git：禁 pip install / npm i / git add|commit|checkout。要测环境就只测量、只报告。",
  "3) 禁凭记忆编。每条事实断言都必须给出你本次亲自取到的证据（URL ＋ 你读到的原文片段，或命令 ＋ 输出）。取不到就写「未核」，不许用记忆补。",
  "4) 显式区分三类来源：厂商宣称 / 第三方报道 / 你本次亲测。",
  "5) 用中文写产物（模型名、参数名、字段名、字段值保留原文）。",
  "6) 写文件必须用 Write/Edit 工具，不要用 shell heredoc 或 node -e（本仓库踩过坑）。",
  "7) 产物文件开头三行：# 标题 / > 作者：<你的角色> / > 证据等级：<你实际做到的最强级>。",
  "8) 最后必须回报你写出的文件绝对路径。本项目纪律：NO PROGRESS CLAIM WITHOUT A FILE ON DISK。",
].join("\n");

// ─────────────────────────────────────────────────────────────
phase("先摸清项目现状：只读核对账本，再三路并行读盘");

const boardGate = await world.run("node", ["p1b/scripts/board.cjs"]);
const boardLine =
  boardGate.exitCode === 0
    ? boardGate.stdout.slice(0, 3000)
    : "board.cjs 退出码 " + boardGate.exitCode + "；stderr 前 800 字：" + boardGate.stderr.slice(0, 800);
log(boardGate.exitCode === 0 ? "账本读数已取回（只读，未落盘）" : "账本读数命令非零退出，已如实带进复盘");

const [stateDigest, engineDigest, ruleDigest] = await Promise.all([
  agent(
    "现状盘点员",
    "你是这个中文项目的现状盘点员。你的标准是：只报盘上读到的，不报记忆里的；数字必须能追到文件或命令。",
  ).ask<StateDigest>(
    [
      "先读 " + START + "（起点文件：任务、本机实测环境、候选清单、核查命令、硬约束、产物命名）。",
      "读完再动手，并可在需要时加载 C:\\Users\\crx\\.agents\\skills\\progress-anchor\\SKILL.md 与 C:\\Users\\crx\\.agents\\skills\\handoff\\SKILL.md 了解本项目惯用的进度锚与交接件纪律。",
      "",
      "你的任务（Q1：这个项目现在到哪一步了）：",
      "1) 读这些盘上文件（都在本棒产物目录之外）：",
      "   - .scratch/handoff/推演沙盘-交接-20260920-终态.md（当前唯一入口，重点 §0 §1 §2 §3）",
      "   - docs/sandbox/p1b/itest/ 目录下最新的 p29 进度锚（先用 glob 找到确切文件名）",
      "   - 项目全资源地图文件（文件名含「项目全资源地图」，先用 glob 全仓找）",
      "   - p1b/scripts/README.md（在役脚本索引）",
      "2) 下面这段是主代理刚刚只读跑出的账本读数，请把它与你读到的文件相互核对（不许照抄，要指出吻合与冲突）：",
      boardLine,
      "3) 产出 " + OUT + "01-项目现状.md。",
      "",
      "重点回答：现在处于第几期、哪些票已收口、哪些票未开；已封死或负结果的路径有哪些（这是后面判断「要不要再上一个模型」的关键弹药）；交接件给的下一步是什么。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "引擎侦察员",
    "你是这个项目的引擎与判据侦察员。你的标准是：说得出具体文件与函数名，不写「大概在哪」。",
  ).ask<EngineMap>(
    [
      "先读 " + START + "。可在需要时加载 C:\\Users\\crx\\.agents\\skills\\project-atlas\\SKILL.md 了解本项目的地图纪律。",
      "",
      "你的任务（摸清引擎层与判据层，为了回答「一个外部模型能插在哪」）：",
      "1) 读这些盘上文件（先 glob 确认存在再读，找不到就如实写找不到）：",
      "   - p1b/scripts/stage4-run.cjs（五层引擎 L1–L6 的读数入口）",
      "   - p1b/sim/out/ 下最新的 stage4-run-five-layers-*.json 与 calibration-report-*.json",
      "   - p1b/scripts/e2-combo-precheck.cjs（判据原语的共享实现，据交接件是 Brier／自助置信区间／Murphy 分解的唯一真源）",
      "   - p1b/scripts/ 下与 role3 有关的脚本（role3-combiner.cjs / role3-pilot.cjs / role3-replay.cjs）",
      "   - p1b/scripts/acr-run-llm.cjs 以及任何调用上游大模型的脚本",
      "2) 产出 " + OUT + "02-引擎与判据地图.md。",
      "",
      "重点回答四个问题：",
      "   A. 五个层 L1–L6 各自是什么、出数路径是什么（对照五层读数件里的 n 与 Brier 值核对）；",
      "   B. 判据原语（Brier、置信区间、TOST、MDE、Murphy 分解）的共享实现在哪几个文件、函数名是什么；",
      "   C. 「一个新概率源」如果要进系统，最自然的两个插入点分别在哪（给出具体文件与函数）；有没有现成的「挑战者臂／新层」脚手架可以复用；",
      "   D. 现在大模型在系统里承担哪几种角色、由哪个脚本调用、成本怎么记账（成本台账文件在哪）。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "合规侦察员",
    "你是这个项目的铁律与预注册（PREREG）守门人。你的标准是：引原文，不转述；区分「原文这么写」与「我理解是」。",
  ).ask<RuleMap>(
    [
      "先读 " + START + "（其 §8 列了十条铁律的摘要，但你要读原文核对）。",
      "",
      "你的任务（把「新上一个概率源」要受哪些约束挖干净）：",
      "1) 读 .scratch/handoff/推演沙盘-交接-20260920-终态.md 的 §3 铁律与纪律全文。",
      "2) 找到铁律「大模型只出四种角色、不出概率」的原文出处（可能在交接件第 18/19/20 件、docs/sandbox/ 下的规格件、或 p1b/scripts 的注释里，先 grep 关键词）。写清四角色分别是什么。",
      "3) 找到 PREREG 冻结的清单与改动规则（交接件 §3 第 6 条、§7 的 PREREG 列表；.scratch/forecast-debate/ 目录下有各份 PREREG 件）。",
      "4) 产出 " + OUT + "03-铁律与PREREG约束.md。",
      "",
      "重点回答：",
      "   A. 一条「原生输出概率的模型」进系统，会撞上哪几条铁律？逐条给原文与编号。",
      "   B. 按现行规矩，它最少要过哪几关才能进（列出关卡清单：预注册？真值锚？判据？复现？）——这是后面专家团判定「能不能进」的硬边界。",
      "   C. 现有七件冻结的 PREREG 里，有没有已经为「新引擎臂」准备好的流程可以复用（例如 E2 六臂的判据机、厚格票的骨架）。",
      "",
      RU,
    ].join("\n"),
  ),
]);
log("项目现状三路读盘完成：" + stateDigest.file + " / " + engineDigest.file + " / " + ruleDigest.file);

// ─────────────────────────────────────────────────────────────
phase("查清 Jev 本体与本地开源同类的真伪");

const [jevBody, sweepA, sweepB, hygiene, deploy] = await Promise.all([
  agent(
    "Jev 本体调查员",
    "你是技术尽调员，负责把一款商业模型的真实能力边界查清楚。你默认厂商宣称与实测有落差，分开记。",
  ).ask<CandidateSweep>(
    [
      "先读 " + START + "（§4 是主代理已核到的 Jev 事实初稿，§5 是证据卫生红灯，§7 是实测可用的核查命令）。",
      "",
      "你的任务（Q2：Jev 到底是什么、干什么）：",
      "1) 核实并补全 Jev（TypeSafe AI）的事实：是谁做的、何时发布、System One Model 的定义、三种题型原语（Choice/Score/Noul）的确切语义与返回字段、端点与请求格式、SDK、延迟与价格、**权重是否发布／能否自托管**。",
      "2) 把「厂商宣称」「第三方报道」「你本次亲测」三类来源分开列，每条给 URL 与你读到的原文片段。",
      "3) 特别去查这几件（能查到的给证据，查不到就明写查不到）：",
      "   - 是否已发布权重或有自托管方案（MarkTechPost 说没有——请交叉验证，因为这是本方案的分水岭）；",
      "   - 价格 0.042 美元／次 与延迟 70–500ms 的**原始出处**（起点文件说 kie.ai 那篇 WebFetch 只返回了服务区域通知，只有标题级证据）；",
      "   - 有没有任何**独立第三方实测**（不是厂商自测、不是转述厂商）。",
      "4) 产出 " + OUT + "10-Jev本体.md。",
      "",
      "返回的 candidates 数组里，请把「Jev 本体」以及你核实过的每一条关键宣称各占一条（grade 用来标它的证据等级 V1–V4，note 写最硬的一条证据）。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "候选核查员-A",
    "你是开源项目的存在性与可用性核查员。你只信你自己发出的 HTTP 请求与读到的文件内容，不信任何榜单。",
  ).ask<CandidateSweep>(
    [
      "先读 " + START + "（§6 候选清单、§7 核查命令与 V1–V4 分级定义、§8 硬约束）。",
      "清单来源是一张 GitHub 榜单（awesome-jev-gallery），**单一来源、未经核实**，其中可能混有生成式垃圾条目；你的任务就是逐条打假或证实。",
      "",
      "你的任务（Q3 第一批）：核实 " + START + " §6 表格里第 1 到 12 条候选。",
      "逐条至少做这三件（用 §7 给的 curl 命令，直连失败再加代理）：",
      "   a) GitHub API 查仓库是否存在，并读回 stars / license / pushed_at / description；",
      "   b) 查仓库 contents，判断它是**有真代码或真权重**，还是只有一个空壳 README；",
      "   c) 若能定位到 HuggingFace 权重，用 HF API 带 blobs=true 取**文件清单与字节数**——这是「有没有真权重」最硬的证据。",
      "注意：榜单里的用户名有些是知名开发者。**别因为名字耳熟就判它为真**，也用不着因为它陌生就判假——一律以你自己取到的响应为准。",
      "对每条给出 V1/V2/V3/V4 分级（达不到就写「未达」并写明卡在哪一级），并判断它在起点文件 §2 的本机环境上能否落地。",
      "产出 " + OUT + "11-开源候选核查-A.md。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "候选核查员-B",
    "你是开源项目的存在性与可用性核查员。你只信你自己发出的 HTTP 请求与读到的文件内容，不信任何榜单。",
  ).ask<CandidateSweep>(
    [
      "先读 " + START + "（§6 候选清单、§7 核查命令与 V1–V4 分级定义、§8 硬约束）。",
      "清单来源单一、未核实，可能混有生成式垃圾条目。",
      "",
      "你的任务（Q3 第二批）：核实 " + START + " §6 表格里第 13 到 23 条候选，外加表后那三个多路搜索独立提到的名字（Laya、Von、Foq）。",
      "逐条至少做这三件（用 §7 给的 curl 命令，直连失败再加代理）：",
      "   a) GitHub API 查仓库是否存在，读回 stars / license / pushed_at / description；",
      "   b) 读仓库 contents，判断有真代码或真权重，还是只有空壳 README；",
      "   c) 有 HF 权重的用 HF API 带 blobs=true 取文件清单与字节数。",
      "对 Laya 特别用力：主代理直连 huggingface.co/convaiinnovations/laya 超时未取到，请换路径核实（HF API、代理、镜像、PapersWithCode、官方公告均可），把「确实存在／确实不存在／仍不可核」三种结论明确给一种。",
      "对 Von 与 Foq 两个名字，注意它们的来源站点在主代理的证据卫生红灯列表里，**先核站点本身是否可信，再核模型**。",
      "对每条给出 V1/V2/V3/V4 分级（达不到就写「未达」并写明卡在哪一级），并判断它在起点文件 §2 的本机环境上能否落地。",
      "产出 " + OUT + "12-开源候选核查-B.md。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "证据审计员",
    "你是证据审计员，专职打假。你的标准是：把营销内容与可验证事实分离开，并明确指出哪些结论目前根本没有独立证据。",
  ).ask<CandidateSweep>(
    [
      "先读 " + START + "，重点是 §4（Jev 事实初稿）与 §5（证据卫生红灯）。",
      "",
      "你的任务（这一节的结论会决定整套方案值不值得往下走）：",
      "1) 逐站审计起点文件 §5 点名的那些域名（jev-agent.com / jevapi.org / jevbest.com / jevusers.com / hermes-ai.net / openchamber.dev / apimaster.ai / myaiexp.com / foq.fr / openjev.sh / jevbot.app / kie.ai）：实际取回它们的正文，判断每个是**一手信息、二手转述、还是生成式内容农场**。给判据（不是印象）：比如正文是否互相抄、是否同名模板、是否给出可核的原始出处、是否在卖东西或引流。",
      "2) 查清「$JEV 代币」这条线：有没有、是谁在发、与 TypeSafe 有没有官方关系。凡涉及代币的内容一律降权，但要把事实说清楚。",
      "3) 核实 openchamber.dev 那篇关于「12,759 条推文：转发里 193 倍、实测里 7 倍」的说法（起点文件 §5 第 3 条）到底说了什么、它的方法是什么。",
      "4) 全库搜索并回答：**关于 Jev 与这些开源复现，存不存在任何独立第三方实测？** 没有就明写「没有」——这本身就是本棒最重要的结论之一。",
      "5) 产出 " + OUT + "13-证据卫生审计.md。",
      "",
      "返回的 candidates 数组里每条是一个信源或一条宣称，grade 写它的可信级别（V1 存在/V2 有料/V3 可跑/V4 可信，或直接写「内容农场」「不可核」），note 写判定依据。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "部署可行性工程师",
    "你是本地推理部署工程师，负责在真实机器上把账算清楚。你不装东西、不改环境，只测量与计算，然后把「真跑起来要付什么代价」写实。",
  ).ask<CandidateSweep>(
    [
      "先读 " + START + "，特别是 §2 本机实测环境（显卡、内存、Python、磁盘）与 §7 的核查命令。",
      "",
      "你的任务（Q3 的落地半边：本机到底能跑什么）：",
      "1) 以起点文件 §2 的实测环境为唯一基准，做显存与内存的落地计算：fp16 / int8 / int4 量化下，不同参数量（如 0.15B、0.4B、0.6B、2B、4B、9B）各自的权重占用、KV cache 与激活量的量级，哪些能在本机显存里放下、哪些必须 CPU 卸载或根本不行。写出你的算式，不要给结论不给我算式。",
      "2) 对「本地可跑类」候选，用 HTTP 探它们的实际文件体积（HF API 带 blobs=true，或对权重文件发 HEAD 请求），把**实测字节数**列出来与你的计算对照。",
      "3) 查清 Windows 上跑这类模型的真实工程路径与坑：vLLM 在 Windows 下的官方支持状况到底是什么（原生支持？必须走 WSL2？）、transformers 直跑是否可行、CPU 兜底的代价、以及本机现有 Python 环境（起点文件 §2 里已装了什么、缺什么）需要补什么。**这一步只许查与算，不许装。**",
      "4) 给出「若要真跑，最小可执行方案」：装什么、多大、要多久、跑通后怎么变成一个 Node 脚本能调用的 HTTP 端点（本项目的脚本都是 Node）。",
      "5) 产出 " + OUT + "14-本地可跑性.md。",
      "",
      "返回的 candidates 数组里，每条候选写它在**本机**的落地判定（localOk 写「是/否/不确定」并给算式或实测字节数），grade 写它达到的证据级别。",
      "",
      RU,
    ].join("\n"),
  ),
]);
log("Jev 与本地同类核查完成：" + jevBody.file + " / " + sweepA.file + " / " + sweepB.file + " / " + hygiene.file + " / " + deploy.file);

for (const candidate of [...sweepA.candidates, ...sweepB.candidates, ...deploy.candidates, ...hygiene.candidates]) {
  report(candidate, "candidates");
}

// ─────────────────────────────────────────────────────────────
phase("请六位专家逐位表态");

const PANEL = [
  {
    key: "校准与统计专家",
    skill: "first-principles",
    lens:
      "你的镜头是校准与统计。本项目的判据是 Brier 与分域过线，且历史上有一长串「再加一个模型没有增益」的负结果。你要正面回答：一个原生输出概率的模型，对现有五层到底有没有增量？它的概率是「对题面的校准概率」还是「对某些 token 的分布形状」？如果只是把已有信号换个方式读一遍（本项目已经吃过「同信号两次」的判死），那它就不值钱。",
  },
  {
    key: "引擎架构师",
    skill: "domain-modeling",
    lens:
      "你的镜头是系统结构。五层引擎、判据原语、账本、路由规则都已经在位。你要回答：它进来是什么身份——新的第 7 层？挑战者臂？某层的替代实现？还是根本不进引擎、只做旁路观察？每种身份的机制成本各是多少？有没有现成脚手架（E2 六臂判据机、厚格骨架、角色③合成器）可以复用，还是要新造一套？",
  },
  {
    key: "本地部署工程师",
    skill: "",
    lens:
      "你的镜头是这台机器和他自己的手。基于阶段 2 的实测环境与显存计算，你要回答：本地跑这条路在 Windows 上到底可行不可行？可行性是被显存卡住、被平台卡住、还是被维护成本卡住？如果本地不行，走 API 的话工程上是什么形状、与项目「key 不出服务端」的铁律冲不冲突？",
  },
  {
    key: "铁律守门人",
    skill: "verification-before-completion",
    lens:
      "你的镜头是铁律与预注册。你的职责不是判断技术上好不好，而是判断**按现行规矩能不能做、以及要走什么合法路径**。你要逐条点名：这个方案撞了哪几条铁律（尤其「大模型只出四角色、不出概率」那条）、PREREG 冻结要不要版本递进、真值锚怎么解决。凡结论超出你读到的原文，就说「原文没写，属于我理解」。",
  },
  {
    key: "证据充分性审判员",
    skill: "steel-manning",
    lens:
      "你的镜头是决策的证据门槛。你要先把「整合」的最强版本论证出来（steel-man，用最有力的证据与推理替它说话），然后判断：就凭现在这批证据（多数来自厂商宣称与疑似内容农场），够不够做出投入决策？注意证据不足有两种处理——补证据、或者明确降级为「只做零成本观察」。你要说清现在属于哪种。",
  },
  {
    key: "产品与机会成本负责人",
    skill: "pre-mortem",
    lens:
      "你的镜头是资源与时机。这个项目离第 4 期对外产品面只差 1 个分域（放行门需要 10 格，现在 9 格，等数据自动推进）。你要回答：把人力投到这条新线，会不会拖住已经在门口的第 4 期？假设半年后回看这次投入失败了，最可能是因为什么（pre-mortem）？如果要做，怎么切一小刀试，而不是开一个大工程？",
  },
];

const POSITION_FILES = PANEL.map((e) => OUT + "20-专家团-" + e.key + ".md");

const positions = (
  await Promise.all(
    PANEL.map((expert, index) => {
      const askLines = [
        "先读 " + START + "（起点文件：任务、本机实测环境、候选清单、硬约束）。",
      ];
      if (expert.skill.length > 0) {
        askLines.push("然后加载并遵守这个技能的方法论：C:\\Users\\crx\\.agents\\skills\\" + expert.skill + "\\SKILL.md。");
      }
      askLines.push(
        "",
        "再读阶段 1 与阶段 2 的全部产物（它们是你唯一的证据来源，不许绕过去自己重查一遍全库，但允许抽查你特别怀疑的一两处）：",
        "- " + stateDigest.file + "（项目现状）",
        "- " + engineDigest.file + "（引擎与判据地图）",
        "- " + ruleDigest.file + "（铁律与 PREREG 约束）",
        "- " + jevBody.file + "（Jev 本体）",
        "- " + sweepA.file + "（候选核查第一批）",
        "- " + sweepB.file + "（候选核查第二批）",
        "- " + hygiene.file + "（证据卫生审计）",
        "- " + deploy.file + "（本机可跑性）",
        "",
        "你要回答的问题（用户原话）：这套模型能不能整合进这个项目、能起什么作用。",
        "产出 " + POSITION_FILES[index] + "，写清：你的立场／核心论证／关键证据／什么会让你改主意／若放行最小第一步。",
        "注意：你的立场允许是「反对整合」，也允许是「条件放行」——但任何立场都必须有证据支撑，且必须正面回应本项目那些已经失败的「加一个模型」尝试。",
        "",
        RU,
      );
      return agent(
        "专家-" + expert.key,
        "你是被请来评审这个方案的" + expert.key + "。" + expert.lens + " 只答中文；结论要敢说「不该做」，那和说「该做」一样值钱。",
      ).ask<Position>(askLines.join("\n"));
    }),
  )
);
for (const position of positions) {
  report({
    seat: position.stance,
    argument: position.coreArgument,
    score: position.score,
    firstStep: position.firstStep,
  });
}
log("六位专家表态完成：支持 " + positions.filter((p) => p.stance === "支持整合").length + "／反对 " + positions.filter((p) => p.stance === "反对整合").length + "／条件放行 " + positions.filter((p) => p.stance === "条件放行").length);

// ─────────────────────────────────────────────────────────────
phase("让红队攻一遍专家团的结论");

const redTeam = await agent(
  "红队",
  "你是红队，唯一职责是找出这个方案会怎么失败。你不是平衡者，不需要给出建设性替代方案；你的产出就是攻击清单与失败模式。攻击要有据，不许为反而反。",
).ask<RedTeamReport>(
  [
    "先读 " + START + "（起点文件）。然后加载并遵守 C:\\Users\\crx\\.agents\\skills\\red-team\\SKILL.md 的方法论。",
    "",
    "再读六位专家的表态（逐份读，它们是你攻击的对象）：",
    ...POSITION_FILES.map((f) => "- " + f),
    "",
    "另外必须读这两份（你的最强弹药是本项目自己的负结果史）：",
    "- " + stateDigest.file + "（其中的「已封死／负结果路径」一栏）",
    "- " + hygiene.file + "（证据卫生：如果证据基础本身就是沙做的，整栋楼都不该盖）",
    "",
    "你的任务：",
    "1) 逐条攻击专家团的结论。特别要找：被所有六位共同默认、但其实没人验证过的前提；把「技术可行」当成「值得做」的滑坡；用厂商宣称当事实的地方；以及方案与本项目负结果史的直接冲突。",
    "2) 给出失败模式：如果这东西最终白干，最可能是怎么白干的。",
    "3) 点名专家团最自信、证据最薄的那一个判断。",
    "产出 " + OUT + "30-红队.md。每条攻击标注严重度：fatal 致命 / major 重大 / minor 可承受。",
    "",
    RU,
  ].join("\n"),
);
for (const attack of redTeam.attacks) {
  report({ target: attack.target, point: attack.point, severity: attack.severity });
}
log("红队出 " + redTeam.attacks.length + " 条攻击，其中致命 " + redTeam.attacks.filter((a) => a.severity === "fatal").length + " 条");

// ─────────────────────────────────────────────────────────────
phase("独立复核承重事实");

const runnable = [...sweepA.candidates, ...sweepB.candidates]
  .filter((c) => c.grade.indexOf("V3") === 0 || c.grade.indexOf("V4") === 0)
  .slice(0, 4);
const runnableText =
  runnable.length > 0
    ? runnable.map((c) => "- " + c.name + "（称 " + c.grade + "，参数量 " + c.params + "）：" + c.note).join("\n")
    : "（候选核查没有报出任何达到 V3 的候选）";

const [confirmCandidates, confirmJev] = await Promise.all([
  agent(
    "候选复核员",
    "你是独立复核员。原核查员报过什么不影响你：你要用自己发出的请求，逐条独立复现或推翻。复现不了就如实说推翻，并给出真实情况。",
  ).ask<ConfirmationBatch>(
    [
      "先读 " + START + "（§7 有实测可用的核查命令与 V1–V4 分级定义）。你不必读原核查员的报告全文——只核对下面这些主张，独立取你自己的证据。",
      "",
      "待复核的主张（这些是「本地能跑」这条结论的承重事实）：",
      runnableText,
      "",
      "要求：",
      "1) 对每条主张，自己发 HTTP 请求或读文件去复现。**先假设它是错的**。",
      "2) 尤其要验：仓库或模型页是否真的存在、是否真有代码或权重文件（不是空壳）、权重文件的实际字节数是多少、以及它在本机（起点文件 §2 的实测环境）上是否真的落得下。",
      "3) 若上面没有任何候选达到 V3，那就改为复核这个否定性结论本身：**尽你所能去找一个真能在本机跑起来的开源同类**，找不到才算复现成立。这是决定性的结论，值得你多花力气。",
      "4) 明确回报：哪几条复现了、哪几条被推翻、被推翻时的真实情况是什么。",
      "产出 " + OUT + "41-关键事实复核.md。",
      "",
      RU,
    ].join("\n"),
  ),
  agent(
    "Jev 事实复核员",
    "你是独立复核员。原调查员报过什么不影响你：你要独立判断这些关于 Jev 的主张是否成立。",
  ).ask<ConfirmationBatch>(
    [
      "先读 " + START + "（§4 是待核的 Jev 事实初稿）。你不必读原调查员的报告全文——独立取你自己的证据。",
      "",
      "待复核的关键主张（这几条决定整个方案走「调 API」还是走「本地跑」）：",
      "1) TypeSafe 未发布 Jev 的权重，也没有自托管方案，只能调托管 API；",
      "2) Jev 的接口是单一端点、三种题型原语、返回带概率的类型化决策；",
      "3) 关于它的延迟与价格（70–500ms、每次约 0.042 美元）在原始出处上确实成立。",
      "",
      "要求：先假设每条都错，去找反证。第 3 条尤其重要：起点文件说那个价格数字目前只有标题级证据，请尽力找到原始来源，找不到就明确写「无法证实」并说明你试了哪些路径。",
      "产出 " + OUT + "41b-Jev事实复核.md。",
      "",
      RU,
    ].join("\n"),
  ),
]);
for (const item of [...confirmCandidates.confirmations, ...confirmJev.confirmations]) {
  report({ claim: item.claim, reproduced: item.reproduced, how: item.how });
}
log("独立复核完成：复现 " + [...confirmCandidates.confirmations, ...confirmJev.confirmations].filter((c) => c.reproduced).length + " 条，未能复现 " + [...confirmCandidates.confirmations, ...confirmJev.confirmations].filter((c) => !c.reproduced).length + " 条");

// ─────────────────────────────────────────────────────────────
phase("合议成方案，并请一位没参与的人读一遍");

const writer = agent(
  "合议主编",
  "你是这次评审的合议主编，负责把六位专家、红队与独立复核的结论收敛成一份用户能直接拿去决策的中文方案。你的标准：不替用户做他该做的决定，但凡是你有推荐的地方必须明说推荐哪个以及为什么。",
);
const reportPath = OUT + "40-方案报告.md";

const brief = [
  "先读 " + START + "（用户的原始提问与整套约束在这里）。",
  "然后加载并遵守 C:\\Users\\crx\\.agents\\skills\\writing-plans\\SKILL.md 的方法论。",
  "",
  "你要读完全部材料：",
  "- 现状三份：" + [stateDigest.file, engineDigest.file, ruleDigest.file].join("、"),
  "- 事实五份：" + [jevBody.file, sweepA.file, sweepB.file, hygiene.file, deploy.file].join("、"),
  ...POSITION_FILES.map((f) => "- 专家表态：" + f),
  "- 红队：" + redTeam.file,
  "- 独立复核：" + confirmCandidates.file + "、" + confirmJev.file,
  "",
  "写一份方案报告到 " + reportPath + "，中文，结构如下（小节标题自拟但要覆盖全部）：",
  "一、结论先行：这套东西该不该进这个项目、以什么身份进（一到三句，直给）。",
  "二、项目现在在哪：简述现状与约束（让没读过交接件的人也能看懂）。",
  "三、Jev 是什么：事实、证据等级、以及哪些关键说法至今没有独立证据。",
  "四、本地开源同类核查结果：逐条给出「存在／有料／可跑／可信」的判定与它在本机的落地性；把没核实的明确标出来。",
  "五、它能在本项目里起什么作用：至少给三种可能身份，逐个评估（含机制成本、判据成本、与本项目负结果史的关系），并明确指出你推荐哪一种、为什么。",
  "六、专家团分歧：六位的立场、分歧点在哪、哪些分歧是被证据解决了、哪些还悬着。",
  "七、红队攻击与应对：逐条回应致命与重大攻击——接受并改方案，还是驳回并说明理由。",
  "八、若做，最小可验证的第一步：具体到脚本、实验、判据与「什么结果算失败」。",
  "九、明确不做的事与理由。",
  "十、需要用户拍板的事项：每条写清要决定什么、你推荐哪个、理由是什么。",
  "",
  "纪律：所有事实性陈述标出证据等级（厂商宣称／第三方报道／本项目亲测／未核）。禁止编造数字、禁止编造参考文献或链接。红队致命攻击不许略过。",
  "",
  RU,
].join("\n");

let synthesis = await writer.ask<Synthesis>(brief);

const reader = agent(
  "独立读者",
  "你是一位没参与这份方案撰写的读者。你只凭文本本身判断，不去仓库里替它补证据。",
);
const readFeedback = await reader.ask<ReaderFeedback>(
  [
    "读这份报告：" + reportPath,
    "",
    "你以一位要拿它做决策的读者身份读，回答四件事：",
    "1) 哪里读不懂、哪里说了但没说清（逐条）；",
    "2) 哪里结论超出了它自己给出的证据，或者证据与结论对不上（逐条）；",
    "3) 读完你最想问的后续问题是什么（逐条）；",
    "4) 有没有严重到必须再改一版。",
    "注意：你的职责是判断可读性与自洽性，不是去核实事实——不要去仓库里查证，也不要重写它。",
    "产出 " + OUT + "42-读者反馈.md。",
    "",
    RU,
  ].join("\n"),
);

if (readFeedback.blocking) {
  synthesis = await writer.ask<Synthesis>(
    [
      "读者对上一版的反馈如下，请据以修订并覆盖写回同一个文件 " + reportPath + "（不要另存新文件）。",
      "读不懂的地方：" + JSON.stringify(readFeedback.unclear),
      "证据与结论对不上的地方：" + JSON.stringify(readFeedback.unsupported),
      "读者最可能追问的问题（请确保报告里已经能回答，答不了的就写清为什么答不了）：" + JSON.stringify(readFeedback.likelyQuestions),
      "修订后回报同一个文件路径。",
      "",
      RU,
    ].join("\n"),
  );
}

phase("交付前的零污染自检与发布");
const integrity = await world.run("git", ["status", "--porcelain"]);
const dirty = integrity.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .filter((line) => line.indexOf("jev-integration") === -1 && line.indexOf(".zcodeignore") === -1);

let published = "未发布";
try {
  await artifact.file("report", reportPath, {
    title: "Jev 与本地 System One 类模型 · 整合方案（专家团评审）",
    description: "项目现状＋Jev 本体事实＋本地开源同类逐条核查＋六位专家表态＋红队攻击＋独立复核＋最小第一步与拍板清单。",
    primary: true,
  });
  published = reportPath;
} catch {
  await writer.ask("发布失败：文件 " + reportPath + " 取不到。请把它写到该路径（修正路径或重新落盘），然后回报路径。");
  await artifact.file("report", reportPath, {
    title: "Jev 与本地 System One 类模型 · 整合方案（专家团评审）",
    description: "项目现状＋Jev 本体事实＋本地开源同类逐条核查＋六位专家表态＋红队攻击＋独立复核＋最小第一步与拍板清单。",
    primary: true,
  });
  published = reportPath;
}

const findings: Finding[] = [
  ...confirmCandidates.confirmations.map<Finding>((c) => ({
    where: "本地可跑性",
    what: c.claim,
    evidence: c.how + "；复核结论：" + (c.reproduced ? "已独立复现" : "未能复现，真实情况：" + c.correction),
    status: c.reproduced ? "verified" : "unconfirmed",
    severity: "high",
  })),
  ...confirmJev.confirmations.map<Finding>((c) => ({
    where: "Jev 本体",
    what: c.claim,
    evidence: c.how + "；复核结论：" + (c.reproduced ? "已独立复现" : "未能复现，真实情况：" + c.correction),
    status: c.reproduced ? "verified" : "unconfirmed",
    severity: "high",
  })),
  ...redTeam.attacks
    .filter((a) => a.severity !== "minor")
    .slice(0, 6)
    .map<Finding>((a) => ({
      where: "方案 · " + a.target,
      what: a.point,
      evidence: a.evidence,
      status: "unconfirmed",
      severity: a.severity === "fatal" ? "high" : "medium",
    })),
];

const result: WorkflowReport = {
  conclusion: [
    synthesis.verdict,
    synthesis.executiveSummary,
    "六位专家：" + positions.map((p) => p.stance + "(" + p.score + ")").join("／") + "。",
    "红队致命攻击 " + redTeam.attacks.filter((a) => a.severity === "fatal").length + " 条；报告见 " + published + "。",
  ].join(" "),
  findings,
  verified: [
    "账本读数：node p1b/scripts/board.cjs（只读，退出码 " + boardGate.exitCode + "）",
    "候选逐条存在性与权重体积：由候选核查员 A/B 用 GitHub API 与 HuggingFace API 亲自取回",
    "承重事实独立复核：候选复核员与 Jev 事实复核员各自独立发请求复现",
    "本棒零污染自检：git status --porcelain，除本棒产物目录外" + (dirty.length === 0 ? "无改动" : "仍有改动：" + dirty.join(" | ")),
    "证据卫生：证据审计员逐站取回正文并判定来源性质",
  ],
  notCovered: [
    "没有安装任何本地模型，也没有做端到端本地推理——为了避免擅自改动这台机器的环境；本棒只做了显存计算与权重体积实测",
    "没有调用过 Jev 的托管 API（无 key，未申请），所有关于其接口行为的描述都来自公开文档与报道而非实测",
    "厂商宣称的延迟与价格未能追到原始出处（若复核员也追不到，这一点在报告里已标为无法证实）",
    "没有改动账本、预注册或任何生产代码，因此本方案的所有结论都还没有经过本项目真实判据的检验",
  ],
};

return result;
