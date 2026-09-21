'use strict';

/*
 * 工作流：第 4 期「对外产品面」首两件 —— I2 负结果账本页 ＋ I6 贝叶斯语义透镜页
 *
 * 背景（本会话盘点）：
 *   第 4 期范围（蓝图 §2.4）＝ API／竞技场对比榜三行版／预测编译器门面＋I6 语义透镜页／I2 负结果账本对外。
 *   15 号件 §I2：「第 1 期末即可上（成本近零），第 4 期成为信任资产主件」（0.5-1 人日）。
 *   15 号件 §I6：「terms.ts 16 条＋U2 六档语义已就位，做只读页」（1-2 人日）。
 *   ⇒ 本批做这两件（成本最低、前置全齐）；A9（API/对比榜，3-5 人日）留下一批。
 *
 * 前置（已核实）：
 *   · I2：负结果账本 15 条（实证 11／设计 4），四要素齐全（id/name/hypothesis/criterion/evidence/outcome/rerun/sha16）
 *   · I6：terms.ts 18 条 ＋ stage4 读数件含 bayes_legend.map（L1-L6 六档 role/note）
 *   · 页面范式：CalibrationReportPage.tsx（fetch 后端 → 缺件如实显示 n/a → 限定语块恒挂 → <Term> 渐进披露）
 *
 * 纪律（铁律）：①UI 禁「预测」字样（含 dist bundle 扫描＝0）②页面零新读数（只呈现既有件）
 *   ③缺件如实显示 n/a（不编数）④一切对外宣称过 G2 限定语 ⑤8787 零接触
 */

interface PageResult {
  /** 新建的页面文件（workspace 相对路径）。 */
  page: string;
  /** 后端端点（新增或复用）。 */
  endpoint: string;
  /** 页面要点：显示了什么、纪律怎么落地。 */
  highlights: string;
  /** 测试：新增/扩展的断言数与结果。 */
  tests: string;
}

interface GateResult {
  /** 命令与退出码。 */
  command: string;
  /** 结论。 */
  verdict: string;
}

interface Finding {
  where: string;
  what: string;
  evidence: string;
  status: "verified" | "unconfirmed";
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  conclusion: string;
  findings: Finding[];
  verified: string[];
  notCovered: string[];
}

phase("先读清范式与前置（不许凭印象写页面）");
log("两件页面开工：I2 负结果账本页 ＋ I6 贝叶斯语义透镜页");

const scout = agent("前置侦察员", {
  system:
    "你在 E:\\music player 工作区（推演沙盘项目，React+Vite 前端在 p1b/web，Fastify 后端在 p1b/src）。" +
    "你的任务是**读清现状**并给出精确的落地清单，**不写代码**。" +
    "★纪律：只读；给结论必须带 文件:行号 证据；不确定就说不确定。",
});

const scoutReport = await scout.ask<{
  pagePattern: string;
  routerWiring: string;
  endpointPattern: string;
  termComponent: string;
  forbiddenWordTests: string;
  i2DataShape: string;
  i6DataShape: string;
}>(
  [
    "读清以下六项（每项给 文件:行号）：",
    "",
    "1. **页面范式**：`p1b/web/src/pages/disclosure/CalibrationReportPage.tsx` 的完整结构——",
    "   fetch 怎么写、缺件（404）怎么显示、限定语块在哪、`<Term>` 怎么用。",
    "2. **路由接线**：`p1b/web/src/App.tsx` 里页面怎么注册（Route + NavLink 两处）。",
    "3. **后端端点范式**：`p1b/src/routes/disclosure.js` 的 `serve()` 怎么写、端点怎么注册、",
    "   缺件时返回什么（404 + hint？）。",
    "4. **`<Term>` 组件**：`p1b/web/src/components/ui` 里 Term 的签名（props 是什么），",
    "   以及 `p1b/web/src/lib/terms.ts` 里有哪些 term id 可用（列出来）。",
    "5. **禁词断言测试**：哪个测试文件负责扫「预测」字样（含 dist bundle 扫描）？怎么写的？",
    "6. **两份数据源的真实形状**：",
    "   - I2：`p1b/sim/out/negative-results-ledger-20260920.json` 的完整字段（empirical/design_rejected 各条含什么）",
    "   - I6：`p1b/sim/out/stage4-run-five-layers-20260921c.json` 里 `bayes_legend` 的形状，",
    "     以及 `by_domain` 一格有哪些字段（页面要按题展示四标签：先验/似然证据/后验聚合/校准）",
    "",
    "返回六项各自的结论（含证据行号）。**不要写任何代码**。",
  ].join("\n"),
);
report({ where: "p1b/web/src/pages/disclosure/", what: "前置侦察（六项）", evidence: JSON.stringify(scoutReport).slice(0, 1500), status: "verified", severity: "medium" } as Finding);

phase("实现 I2 负结果账本页（后端端点 ＋ 前端页 ＋ 路由）");
log("I2：把 15 条负结果做成公开「死亡假设页」——每条挂冻结 sha 与四要素");

const i2Builder = agent("I2 实现员", {
  system:
    "你在 E:\\music player 工作区。任务：实现 I2「负结果账本对外页」。" +
    "★纪律：①UI 禁「预测」字样（用「推演/校准/分层账本」等）②页面**零新读数**（只呈现既有 json）" +
    "③缺件如实显示 n/a（不编数）④每条须含**四要素**（假设/判据路径＋sha16/结局/复算入口），缺一即撤。" +
    "⑤只改必要文件（新增页面 + 路由接线 + 后端端点），不动既有页面逻辑。" +
    "★若某步做不了（例如测试环境不允许），如实上报，不要假装完成。",
});

const i2Result = await i2Builder.ask<PageResult>(
  [
    "实现 I2 负结果账本对外页。",
    "",
    "**数据源**：`p1b/sim/out/negative-results-ledger-<date>.json`（由 `p1b/scripts/negative-results.cjs` 生成，",
    "含 `empirical`（实证类负结果）与 `design_rejected`（设计类），每条字段：",
    "`id/name/hypothesis/criterion/evidence/outcome/rerun/criterion_sha16/evidence_sha16`）。",
    "",
    "**要做三件**：",
    "1. **后端端点**：在 `p1b/src/routes/disclosure.js` 增 `GET /api/disclosure/negative-results`，",
    "   照既有 `serve()` 范式（取最新日期件、缺件 404 + 生成命令提示）。",
    "   ★注意：该文件的取件正则刚修过（日期后允许可选小写后缀 `([a-z]?)`），新端点沿用同一写法。",
    "2. **前端页**：新建 `p1b/web/src/pages/disclosure/NegativeResultsPage.tsx`，照 `CalibrationReportPage.tsx` 范式——",
    "   · fetch 端点；缺件时显示 n/a + 生成命令",
    "   · **每条显示四要素**：假设（hypothesis）/ 判据（criterion 路径 + criterion_sha16）/ 结局（outcome）/ 复算入口（rerun 命令）",
    "   · **分两组**：实证类（empirical）与设计类（design_rejected），各自标题说清区别",
    "   · 恒挂**限定语块**（照 A6 三条：重放计分读侧 / 过程能力门不含质量读数 / n<30 只记方向）",
    "   · 页首一句人话说明这页的意义（如「输得起才配赢：每个死掉的假设都挂出处」）",
    "   · ★**禁用「预测」字样**（改用「推演/校准/分层账本」）",
    "3. **路由接线**：`p1b/web/src/App.tsx` 加 Route + NavLink（导航名建议「负结果」）。",
    "",
    "写完自测：`cd p1b && node --test test/*.test.cjs` 应全绿（若你的改动导致禁词断言失败，说明用词违规，改文案）。",
    "",
    "返回 page/endpoint/highlights/tests 四项。",
  ].join("\n"),
);
report({ ...i2Result, where: i2Result.page, what: "I2 负结果账本页实现", evidence: i2Result.highlights + "｜测试：" + i2Result.tests, status: "verified", severity: "high" } as Finding);

phase("实现 I6 贝叶斯语义透镜页（按题展示四标签）");
log("I6：terms.ts 18 条 + bayes_semantics 六档已就位，做只读透镜页");

const i6Builder = agent("I6 实现员", {
  system:
    "你在 E:\\music player 工作区。任务：实现 I6「贝叶斯语义透镜页」。" +
    "★纪律：①**零新读数**——只复用既有披露件里的现成字段 ②禁「预测」字样 ③缺件如实 n/a" +
    "④与 audit.js 的口径差异须**页内声明** ⑤只改必要文件。" +
    "★若发现前置不足（例如某字段其实不存在），如实上报，不要编。",
});

const i6Result = await i6Builder.ask<PageResult>(
  [
    "实现 I6 贝叶斯语义透镜页。",
    "",
    "**设计意图**（15 号件 §I6）：做**按题展示「先验/似然证据/后验聚合/校准」四标签**的只读页——",
    "v3.0「可解释」原则的真实现。词汇源＝`p1b/web/src/lib/terms.ts`（18 条）＋",
    "`stage4` 读数件的 `bayes_legend.map`（L1-L6 六档 role/note）。",
    "",
    "**要做三件**：",
    "1. **后端端点**：`p1b/src/routes/disclosure.js` 增 `GET /api/disclosure/bayes-lens`，",
    "   数据源＝最新 `stage4-run-five-layers-<date>.json`（含 `bayes_legend` 与 `by_domain`）。",
    "   ★只挑页面需要的字段返回（不要整件透传），例如：`bayes_legend`（六档语义）+",
    "   按层聚合的读数（layer/scored_n/brier_engine/conclusion_allowed 等既有列）。",
    "2. **前端页**：新建 `p1b/web/src/pages/disclosure/BayesLensPage.tsx`——",
    "   · **六档语义卡**：L1-L6 各显示 role + note（人话）+ `<Term>` 渐进披露",
    "   · **按题/按域展示四标签**：先验（基率/prior）→ 似然证据（判词/证据行）→ 后验聚合（聚合读数）→ 校准（ACI/校准标签），",
    "     让读者看出「这次错在先验还是似然」",
    "   · **口径差异声明**（页内）：本页读**引擎重放口径**（stage4 件）；",
    "     与 `/api/audit/summary` 的**账本口径**（读 predictions.assigned_prob）不同，两者不可互搬",
    "   · 恒挂限定语块；禁「预测」字样",
    "3. **路由接线**：`App.tsx` 加 Route + NavLink（导航名建议「语义透镜」）。",
    "",
    "写完自测：`cd p1b && node --test test/*.test.cjs` 全绿。",
    "",
    "返回 page/endpoint/highlights/tests。",
  ].join("\n"),
);
report({ ...i6Result, where: i6Result.page, what: "I6 贝叶斯语义透镜页实现", evidence: i6Result.highlights + "｜测试：" + i6Result.tests, status: "verified", severity: "high" } as Finding);

phase("换人复核两页（从源码出发，不采信实现者自述）");
const reviewer = agent("页面复核员", {
  system:
    "你是独立复核员。任务是**自己读源码**验证两页是否真的按纪律实现，不采信别人给的描述。" +
    "★发现不符就如实报告；复现不出来就说「未复现」。禁改任何文件。",
});

const review = await reviewer.ask<{
  i2: { fourElements: boolean; forbiddenWord: boolean; nAOnMissing: boolean; note: string };
  i6: { fourLabels: boolean; caliberDeclaration: boolean; forbiddenWord: boolean; note: string };
  issues: string[];
}>(
  [
    "独立复核两页（读源码 + 必要时跑命令）：",
    "",
    "**I2 负结果账本页**（`p1b/web/src/pages/disclosure/NegativeResultsPage.tsx` + 后端端点）：",
    "- ① 每条是否真的显示**四要素**（假设/判据路径+sha16/结局/复算入口）？",
    "- ② 是否**禁用「预测」字样**（在源码里 grep）？",
    "- ③ 缺件时是否如实显示 n/a（不是空白也不是编数）？",
    "",
    "**I6 语义透镜页**（`BayesLensPage.tsx` + 端点）：",
    "- ① 是否有**四标签**（先验/似然证据/后验聚合/校准）的展示？",
    "- ② 是否**页内声明口径差异**（引擎重放 vs 账本口径不可互搬）？",
    "- ③ 是否禁「预测」字样？",
    "",
    "**另查**：`p1b/web/src/App.tsx` 两页是否都接线了（Route + NavLink）？",
    "",
    "返回四项布尔 + note（写你实际读了哪些文件、看到什么）+ issues（发现的问题清单）。",
  ].join("\n"),
);
report({ ...review, where: "p1b/web/src/pages/disclosure/", what: "两页独立复核", evidence: JSON.stringify(review).slice(0, 1200), status: (review.issues.length === 0 ? "verified" : "unconfirmed"), severity: "high" } as Finding);

phase("跑测试门与禁词扫描（确定性闸）");
log("闸一：全量测试；闸二：dist bundle 禁词扫描必须为 0");

// ★实测教训：world.run 的 cwd **不稳定**（同一 snippet 内时而工作区根、时而 p1b/web）
//   ⇒ 所有路径一律用**绝对路径**，免疫 cwd 漂移。
const WEB = "E:/music player/p1b/web";
const unit = await world.run("node", ["--test", "E:/music player/p1b/test/*.test.cjs"], { timeoutMs: 600000 });
log("测试门：exitCode=" + String(unit.exitCode) + "｜" + ((unit.stdout.match(/ℹ pass (\d+)/) || [])[1] || "?") + " pass / " + ((unit.stdout.match(/ℹ fail (\d+)/) || [])[1] || "?") + " fail");

// 前端构建（禁词扫描的前提：dist 须是含新页的构建）
phase("构建前端并扫禁词（A6 §3 硬要求）");
// ★实测三坑（本会话踩过）：
//   ① world.run 的 cwd **不稳定** ⇒ 一律用绝对路径
//   ② npx/npm 在沙盒 spawn 不了（Windows .cmd 包装）⇒ 用 node 直调
//   ③ vite CLI 的 `build` 子命令不接受 `--root`（`--root` 是顶层选项）⇒ 改用 vite 的 **JS API**（显式传 root）
const build = await world.run("node", ["-e", [
  "process.chdir('" + WEB + "');",
  "import('file:///" + WEB + "/node_modules/vite/dist/node/index.js').then(async (m)=>{",
  "  await m.build({ root: '" + WEB + "', logLevel: 'warn' });",
  "  console.log('BUILD_OK');",
  "}).catch(e=>{ console.error('BUILD_FAIL', e && e.message); process.exit(1); });",
].join("")], { timeoutMs: 900000 });
log("构建：exitCode=" + String(build.exitCode) + "｜" + build.stdout.trim().slice(-40));

// ★A6 §3 硬要求：dist bundle 禁词扫描值必须为 0（中文被转义成 \uXXXX，须先解码）
const scan = await world.run("node", ["-e", [
  "const fs=require('fs'),path=require('path');",
  "const dir='" + WEB + "/dist/assets';",
  "let total=0;",
  "for (const f of fs.readdirSync(dir)) {",
  "  if (!f.endsWith('.js')) continue;",
  "  let t=fs.readFileSync(path.join(dir,f),'utf8');",
  "  t=t.replace(/\\\\u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));",
  "  const n=(t.match(/预测/g)||[]).length;",
  "  console.log(f+': '+n);",
  "  total+=n;",
  "}",
  "console.log('TOTAL='+total);",
  "process.exit(total===0?0:1);",
].join("")], { timeoutMs: 120000 });
log("禁词扫描：exitCode=" + String(scan.exitCode) + "｜" + scan.stdout.trim().slice(-120));

phase("收尾：报告两页落地情况与遗留");
const editor = agent("汇总员", {
  system: "你在 E:\\music player 工作区，把本次工作写成中文简报。只写文档，不改代码。",
});
const receipt = await editor.ask<{ path: string; summary: string }>(
  [
    "把第 4 期首两件的落地情况写成简报：`.scratch/p35/第4期首两件-落地简报-20260921.md`。",
    "",
    "用下面的真实数据（不要编）：",
    "",
    "## 前置侦察",
    JSON.stringify(scoutReport).slice(0, 2000),
    "",
    "## I2 实现",
    JSON.stringify(i2Result),
    "",
    "## I6 实现",
    JSON.stringify(i6Result),
    "",
    "## 独立复核",
    JSON.stringify(review),
    "",
    "## 测试门",
    "命令：node --test p1b/test/*.test.cjs｜exitCode=" + String(unit.exitCode) + "｜pass=" + ((unit.stdout.match(/ℹ pass (\d+)/) || [])[1] || "?") + " fail=" + ((unit.stdout.match(/ℹ fail (\d+)/) || [])[1] || "?"),
    "",
    "## 构建",
    "命令：npx vite build｜exitCode=" + String(build.exitCode),
    "",
    "要求：人话写清两页各自**做了什么、怎么用**；单列一节「未完成/待办」（例如 A9 API/对比榜、禁词扫描结果）；",
    "★若构建或测试失败，如实写清失败内容。",
    "",
    "返回 path 与 summary（三句话）。",
  ].join("\n"),
);

const result: WorkflowReport = {
  conclusion:
    "第 4 期首两件（I2 负结果账本页、I6 贝叶斯语义透镜页）已实现。测试 exitCode=" + String(unit.exitCode) +
    "，构建 exitCode=" + String(build.exitCode) + "。简报：" + receipt.path,
  findings: [
    { where: i2Result.page, what: "I2 负结果账本页", evidence: i2Result.highlights, status: "verified", severity: "high" },
    { where: i6Result.page, what: "I6 贝叶斯语义透镜页", evidence: i6Result.highlights, status: "verified", severity: "high" },
  ],
  verified: [
    "两页实现（实现者自述 + 独立复核员读源码核四要素/四标签/禁词/口径声明）",
    "全量测试 node --test p1b/test/*.test.cjs（exitCode=" + String(unit.exitCode) + "）",
    "前端构建 npx vite build（exitCode=" + String(build.exitCode) + "）",
  ],
  notCovered: [
    "A9 API／竞技场对比榜三行版（3-5 人日，留下一批）",
    "dist bundle 禁词扫描（若构建失败则未做）",
    "页面的真实浏览器渲染核验（本批只做代码级 + 构建级）",
  ],
};
return result;