// 审计脚本D：两份交接文件引用路径 existsSync 全查
const fs = require("fs");
const path = require("path");
const ROOT = "E:/music player";
const rel = [
  // HANDOFF §二 权威文档
  "docs/specs/2026-09-07-推演沙盘-design.md",
  "docs/sandbox/p1b/P1B-SPEC.md",
  "docs/sandbox/p1a/schema-contract-v1.md",
  "docs/sandbox/redteam-p1a.md",
  "docs/sandbox/adversarial-review-v3.md",
  "docs/sandbox/p0-replay/qc-report-realgames.md",
  "docs/sandbox/p0-replay/score-protocol-realgames.md",
  "docs/sandbox/p2-yijing/oracle-experiment-result.md",
  "docs/sandbox/research-accuracy-survey.md",
  "docs/sandbox/p1a/HANDOFF-2026-09-07.md",
  "docs/sandbox/p1a/timing-report.md",
  // HANDOFF §三/§九
  "p1a-terminal",
  "p1b",
  "p1a-terminal/shap.bat",
  "docs/sandbox/p1a/extract-live-test.md",
  "docs/sandbox/p2-yijing/meihua.js",
  "config/providers.json",
  // 总交接 §1/§2/§4
  "docs/sandbox/p1b/itest/p5-integration-report.md",
  "docs/sandbox/p1b/itest/p5-手机实测指引.md",
  "docs/sandbox/p1b/itest/p7-PROGRESS.md",
  "docs/sandbox/botc-adapt/data/roles-zh.json",
  "docs/sandbox/botc-adapt/itest/extract-retest/report.md",
  "p1b/src/botc",
  "docs/sandbox/prediction-survey/调研报告.md",
  "docs/sandbox/botc-adapt/botc-摸底报告.md",
  "docs/sandbox/botc-research-report.md",
  "docs/sandbox/upgrade-review-20260909",
  ".scratch/session-39e58053/原始任务书-三路.md",
  ".scratch/session-39e58053/收口审计报告-缩靶.md",
  ".scratch/handoff/推演沙盘-P1b-2026-09-08.md",
  "docs/sandbox/p1b/P1B-UX-ONEPAGE.md",
  "docs/sandbox/botc-adapt/BOTC-BRIEFS.md",
  "p1b/test/server.test.cjs",
  "p1b/test/run.out",
  ".scratch/b2-patch3-test.txt",
  "docs/sandbox/botc-adapt/data",
];
const out = [];
let miss = 0;
for (const p of rel) {
  const fp = path.join(ROOT, p);
  let ok = false, sz = 0;
  try { const st = fs.statSync(fp); ok = true; sz = st.size; } catch (e) {}
  if (!ok) miss++;
  out.push((ok ? "OK  " : "MISS") + " | " + p + (ok ? " (" + sz + "B)" : ""));
}
// score-*.md glob
const scores = fs.readdirSync(path.join(ROOT, "docs/sandbox/p0-replay")).filter(f => f.startsWith("score-"));
out.push("score-* glob: " + scores.join(", "));
// 升级终审 10 文件
const up = fs.readdirSync(path.join(ROOT, "docs/sandbox/upgrade-review-20260909"));
out.push("upgrade-review files(" + up.length + "): " + up.join(", "));
// 外部路径
const ext = [
  "C:/Users/crx/.dsh/sessions",
];
for (const e of ext) { let ok = false; try { ok = fs.statSync(e).isDirectory(); } catch (er) {} out.push((ok ? "OK  " : "MISS") + " | [ext] " + e); }
// p1b itest 前缀产物清单
const it = fs.readdirSync(path.join(ROOT, "docs/sandbox/p1b/itest"));
out.push("itest files(" + it.length + "): " + it.join(", "));
console.log("MISS=" + miss + "/" + rel.length);
console.log(out.join("\n"));
