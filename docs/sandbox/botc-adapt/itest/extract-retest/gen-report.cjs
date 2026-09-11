'use strict';
/* gen-report.cjs — 由 stats.json + judgments.json 机械渲染 report.md（零手算：报告数字全部取自 stats.json） */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const stats = JSON.parse(fs.readFileSync(path.join(HERE, 'stats.json'), 'utf8'));
const jdz = JSON.parse(fs.readFileSync(path.join(HERE, 'judgments.json'), 'utf8'));
const pct = (x) => (x === null || x === undefined) ? '-' : (x * 100).toFixed(1) + '%';
const sec = (x) => (x === null || x === undefined) ? '-' : (x / 1000).toFixed(1) + 's';
const EDS = { tb: 'TB 犯罪之夜（Trouble Brewing）', bmr: 'BMR 血月升起（Bad Moon Rising）', snv: 'SNV 教派与紫罗兰（Sects & Violets）' };
// 狼人杀基线常数，引自 docs/sandbox/p1a/extract-live-test.md（引用值，非本次实测）
const BASE = { n: 9, structural: '9/9', strict: '33.3%', suspectIncl: '55.6%', clean: '44.4%', median: 22043.837, p90lin: 48770.714, p90nr: 59414.987, max: 59414.987 };

const L = [];
const VERDICT_ZH = { correct: '✅', suspect: '⚠️', wrong: '❌' };
function deltaLabel(now, base) {
  const d = now - base;
  if (Math.abs(d) < 500) return '持平（' + (d >= 0 ? '+' : '') + Math.round(d) + 'ms）';
  return (d < 0 ? '更快（' : '更慢（+') + sec(Math.abs(d)).replace(/s$/, 's') + '）';
}
const samplesBrief = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8')).samples.map(s => [s.id, s.text])
);
function classSummary(c) {
  const parts = [];
  if (c.main_role_ok) parts.push('角色' + c.main_role_ok);
  if (c.botc) parts.push('botc' + c.botc);
  if (c.main_generic) parts.push('通用' + c.main_generic);
  if (c.main_misaligned) parts.push('狼错位' + c.main_misaligned);
  if (c.main_role_fail) parts.push('不可入账' + c.main_role_fail);
  return parts.length ? parts.join('/') : '无';
}
function mappingCell(r) {
  if (!r.structural_ok) return 'ERROR';
  if (r.split_throws) return '❌400整批失败';
  return '入账' + r.landed_claims + '（对齐' + r.aligned_claims + '）';
}

L.push('# BOTC 三本口播 LIVE 抽取重测报告（B5，2026-09-09）');
L.push('');
L.push('> 数据来源：raw/all-results.json（27 条逐条落盘；采集脚本 run-retest.cjs，串行 + 限速 1.1s/请求）。');
L.push('> 统计复算：eval-stats.cjs（node 直读 raw 输出 stats.json，本报告全部数字取自该文件，零手算）；逐条语义判定见 judgments.json。');
L.push('> 映射层实现：' + stats.mapping_impl + '（require p1b/src/botc/claims.js 真实分流代码 + roles.js，只读复用零改动）。');
L.push('> 对照基线：docs/sandbox/p1a/extract-live-test.md（狼人杀，引用值）。');
L.push('');
const o = stats.overall;
L.push('## 1. 实测概要');
L.push('');
L.push('| 项 | 值 |');
L.push('|---|---|');
L.push('| 样本 | ' + o.samples + ' 条（TB/BMR/SNV 各 9，手写典型口播，7 类覆盖） |');
L.push('| 端点/模型 | ' + stats.endpoint.baseUrl + ' / ' + stats.endpoint.model + '（providers.json active） |');
L.push('| 结构成功 | **' + o.structural_ok + '/' + o.samples + '**（error 全 null 才计成功） |');
L.push('| 内部重试 | ' + stats.rows.filter(r => (r.attempts_internal || 1) > 1).length + ' 条 attempts>1（llm.js JSON/传输重试） |');
L.push('| 外部重试 | ' + stats.rows.filter(r => r.attempts_external > 0).length + ' 条（脚本层 ≤2 次） |');
L.push('| 总耗时 | ' + sec(o.latency.total) + '（串行，含限速间隔） |');
L.push('| 声称产出 | 共 ' + o.total_claims + ' 条 claims（对齐入账 ' + o.aligned_claims + ' / 机械入账 ' + o.landed_claims + '） |');
L.push('');
L.push('## 2. 判定口径');
L.push('');
L.push('**抽取层（沿用狼人杀基线 7 谓词口径）**：✅ 正确=核心语义全捕获无编造无冲突；⚠️ 可疑=核心语义在但含无标注推断或归属丢失；❌ 有误=事实错误/关键遗漏/编造角色或座位/上下文冲突。');
L.push('');
L.push('**映射层（本报告独有价值；逐 claim 由 splitBotcClaims 同构逻辑机械分类）**：');
L.push('');
L.push('| 类别 | 判定条件 | 去向 |');
L.push('|---|---|---|');
L.push('| botc | predicate ∈ is_demon/is_minion/status_drunk/status_poisoned | botc_claims（B2 扩展表） |');
L.push('| 角色入账 | claims_role/is_role 且角色可解析且属本剧本 | 主表 claims（object=角色 id） |');
L.push('| 通用透传 | said/voted/did_action/is_good | 主表 claims 原样 |');
L.push('| 狼错位 | is_wolf（BOTC 无统一狼阵营，语义错位但代码透传） | 主表 claims（错位） |');
L.push('| 不可入账 | claims_role/is_role 但角色不可解析/越剧本 → confirm 抛 400 | **整批失败**（splitBotcClaims 首遇即 throw） |');
L.push('');
L.push('- **机械入账率** = 落库 claims / 总 claims（含狼错位——代码事实上账）；');
L.push('- **对齐可用率** = 对齐入账（botc+角色+通用）/ 总 claims（剔除狼错位，反映「记对账本」的口径）。');
L.push('');
L.push('## 3. 三本质量表（逐条判定 + 延迟，判定对照 raw 实际输出）');
L.push('');
for (const ed of ['tb', 'bmr', 'snv']) {
  L.push('### ' + EDS[ed]);
  L.push('');
  L.push('| ID | 类别 | 输入摘要 | event.type | claims(类) | 抽取判定 | 映射结果 | 延迟 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of stats.rows.filter(x => x.edition === ed)) {
    const j = jdz.judgments.find(x => x.id === r.id) || {};
    const brief = (samplesBrief[r.id] || '').replace(/\|/g, '／');
    L.push('| ' + r.id + ' | ' + r.cat + ' | ' + brief + ' | ' + (r.event_type || '-') + ' | ' + r.n_claims + '（' + classSummary(r.classes) + '） | ' + (VERDICT_ZH[r.verdict] || '-') + ' ' + (r.verdict_reason || '').replace(/\|/g, '／') + ' | ' + mappingCell(r) + ' | ' + (r.ms === null ? '-' : Math.round(r.ms) + 'ms') + ' |');
  }
  const e = stats.by_edition[ed];
  L.push('');
  L.push('小结：结构 ' + e.structural_ok + '/' + e.samples + '；判定 ✅' + e.verdicts.correct + ' ⚠️' + e.verdicts.suspect + ' ❌' + e.verdicts.wrong + '；机械入账率 ' + pct(e.claim_entry_rate) + '；对齐可用率 ' + pct(e.claim_aligned_rate) + '；中位 ' + sec(e.latency.median) + ' / P90(线性) ' + sec(e.latency.p90_linear) + '。');
  L.push('');
}
L.push('## 4. 延迟统计（n=' + o.latency.n + '，实测 ms，eval-stats.cjs 复算）');
L.push('');
L.push('| 组 | 中位数 | P90(线性插值) | P90(最近秩) | 最小 | 最大 | 均值 |');
L.push('|---|---|---|---|---|---|---|');
L.push('| 总体(n=' + o.latency.n + ') | ' + sec(o.latency.median) + ' | ' + sec(o.latency.p90_linear) + ' | ' + sec(o.latency.p90_nearest) + ' | ' + sec(o.latency.min) + ' | ' + sec(o.latency.max) + ' | ' + sec(o.latency.mean) + ' |');
for (const ed of ['tb', 'bmr', 'snv']) {
  const e = stats.by_edition[ed].latency;
  L.push('| ' + ed + '(n=' + e.n + ') | ' + sec(e.median) + ' | ' + sec(e.p90_linear) + ' | ' + sec(e.p90_nearest) + ' | ' + sec(e.min) + ' | ' + sec(e.max) + ' | ' + sec(e.mean) + ' |');
}
L.push('');
L.push('狼人杀基线（n=9，引用）：中位 ' + sec(BASE.median) + ' / P90线性 ' + sec(BASE.p90lin) + ' / P90最近秩 ' + sec(BASE.p90nr) + ' / 最大 ' + sec(BASE.max) + '。');
L.push('');
L.push('## 5. 两层可用率');
L.push('');
L.push('### 5.1 抽取层（用例级）');
L.push('');
L.push('| 组 | ✅正确 | ⚠️可疑 | ❌有误 | 严格错误率 | 可疑并入错误率 | 完全干净 |');
L.push('|---|---|---|---|---|---|---|');
L.push('| 总体(n=' + o.samples + ') | ' + o.verdicts.correct + ' | ' + o.verdicts.suspect + ' | ' + o.verdicts.wrong + ' | ' + pct(o.strict_error_rate) + ' | ' + pct(o.suspect_incl_error_rate) + ' | ' + pct(o.clean_rate) + ' |');
for (const ed of ['tb', 'bmr', 'snv']) {
  const e = stats.by_edition[ed];
  L.push('| ' + ed + '(n=' + e.samples + ') | ' + e.verdicts.correct + ' | ' + e.verdicts.suspect + ' | ' + e.verdicts.wrong + ' | ' + pct(e.strict_error_rate) + ' | ' + pct(e.suspect_incl_error_rate) + ' | ' + pct(e.clean_rate) + ' |');
}
L.push('');
L.push('### 5.2 映射层（claim 级；样本层汇总）');
L.push('');
L.push('| 组 | 总claims | botc | 角色入账 | 通用透传 | 狼错位 | 不可入账 | 机械入账率 | 对齐可用率 |');
L.push('|---|---|---|---|---|---|---|---|---|');
const mr = (tag, e) => '| ' + tag + ' | ' + e.total_claims + ' | ' + e.claim_classes.botc + ' | ' + e.claim_classes.main_role_ok + ' | ' + e.claim_classes.main_generic + ' | ' + e.claim_classes.main_misaligned + ' | ' + e.claim_classes.main_role_fail + ' | ' + pct(e.claim_entry_rate) + ' | ' + pct(e.claim_aligned_rate) + ' |';
L.push(mr('总体', o));
for (const ed of ['tb', 'bmr', 'snv']) L.push(mr(ed, stats.by_edition[ed]));
L.push('');
const failSamples = stats.rows.filter(r => !r.structural_ok || r.split_throws || (r.landed_claims === 0 && r.exp_min_claims > 0));
const partialSamples = stats.rows.filter(r => r.structural_ok && !r.split_throws && r.aligned_claims > 0 && r.aligned_claims < r.n_claims);
L.push('样本层映射结果：**完全可入账 ' + (o.samples - failSamples.length - partialSamples.length) + '/' + o.samples + '，部分对齐 ' + partialSamples.length + '，入账失败 ' + failSamples.length + '**（失败=' + (failSamples.map(r => r.id + (r.split_throws ? '[400]' : (r.structural_ok ? '[零入账]' : '[ERROR]'))).join('、') || '无') + '）。');
L.push('');
L.push('> 说明：BOTC 专属谓词（is_demon/is_minion/status_drunk/status_poisoned）在抽取层 prompt 的 7 谓词枚举中不存在，模型不可能产出——实测 botc 类 claim = ' + o.claim_classes.botc + ' 条。阵营/状态口播全部经由 7 谓词的「替身表达」（is_wolf/said/is_role(阵营词)）落地，这正是狼错位与不可入账两类问题的来源。');
L.push('');
L.push('## 6. 与狼人杀基线对照');
L.push('');
L.push('| 指标 | 狼人杀基线(n=9，引用) | 本次 BOTC 口播(n=' + o.samples + ') | 变化 |');
L.push('|---|---|---|---|');
L.push('| 结构成功 | ' + BASE.structural + '（100%） | ' + o.structural_ok + '/' + o.samples + '（' + pct(o.structural_ok / o.samples) + '） | ' + ((o.structural_ok / o.samples) >= 1 ? '持平' : '下降') + ' |');
L.push('| 严格错误率 | ' + BASE.strict + ' | ' + pct(o.strict_error_rate) + ' | ' + (o.strict_error_rate > 0.333 ? '恶化' : (o.strict_error_rate < 0.333 ? '改善' : '持平')) + ' |');
L.push('| 可疑并入错误率 | ' + BASE.suspectIncl + ' | ' + pct(o.suspect_incl_error_rate) + ' | ' + (o.suspect_incl_error_rate > 0.556 ? '恶化' : (o.suspect_incl_error_rate < 0.556 ? '改善' : '持平')) + ' |');
L.push('| 完全干净 | ' + BASE.clean + ' | ' + pct(o.clean_rate) + ' | ' + (o.clean_rate > 0.444 ? '改善' : (o.clean_rate < 0.444 ? '恶化' : '持平')) + ' |');
L.push('| 延迟中位 | ' + sec(BASE.median) + ' | ' + sec(o.latency.median) + ' | ' + deltaLabel(o.latency.median, BASE.median) + ' |');
L.push('| P90（线性插值） | ' + sec(BASE.p90lin) + ' | ' + sec(o.latency.p90_linear) + ' | ' + deltaLabel(o.latency.p90_linear, BASE.p90lin) + ' |');
L.push('| 最大延迟 | ' + sec(BASE.max) + ' | ' + sec(o.latency.max) + ' | ' + deltaLabel(o.latency.max, BASE.max) + ' |');
L.push('| 映射层 | （基线无此层） | 机械入账 ' + pct(o.claim_entry_rate) + ' / 对齐可用 ' + pct(o.claim_aligned_rate) + ' | 本次新增口径 |');
L.push('');
L.push('## 7. 失败可疑逐条');
L.push('');
const flagged = stats.flagged || [];
if (flagged.length === 0) { L.push('（无）'); }
for (const f of flagged) {
  const r = rowByIdSafe(f.id);
  L.push('- **' + f.id + '（' + (r ? r.cat : '') + '，' + VERDICT_ZH[f.verdict] + '）**：' + f.reason);
  if (r) L.push('  - 实际输出：' + (r.claims_detail.length ? r.claims_detail.map(c => c.subject_seat + '号·' + c.predicate + '(' + c.object + ')→' + c.class).join('；') : '(0 claims——整条丢失)'));
}
const throws = stats.split_throw_samples || [];
if (throws.length) L.push('- **splitBotcClaims 400 整批失败样本**：' + throws.join('、') + '（角色不可解析或越剧本，confirm 时整批 claims 拒入）。');
L.push('');
L.push('## 8. Prompt 调整建议（只建议不改——调整由队长定）');
L.push('');
for (let i = 0; i < jdz.suggestions.length; i++) {
  const s = jdz.suggestions[i];
  L.push((i + 1) + '. **' + s.title + '**：' + s.body);
}
L.push('');
L.push('## 9. 局限');
L.push('');
L.push('- 单端点单模型（tokenrhythm/glm-5.3-flash），延迟受中转站波动影响，不宜外推其他时段/网络；');
L.push('- 样本为手写典型口播（每本 9 条），非真实对局逐字转写，语料风格偏「干净口语」；');
L.push('- 映射层「机械入账率」按 splitBotcClaims 现行代码口径（is_wolf 透传主表计入入账）；对齐可用率才反映 BOTC 语义正确入账；');
L.push('- 抽取层判定（✅/⚠️/❌）为本报告口径的语义对照，供 B5 阶段可用性决策参考。');
L.push('');
L.push('## 10. 复现方式');
L.push('');
L.push('~~~');
L.push('node docs/sandbox/botc-adapt/itest/extract-retest/run-retest.cjs      # 重新采集（真实调用 LLM，限速 1.1s）');
L.push('node docs/sandbox/botc-adapt/itest/extract-retest/eval-stats.cjs      # 只复算统计（零网络）');
L.push('node docs/sandbox/botc-adapt/itest/extract-retest/gen-report.cjs      # 由 stats.json 重渲染本报告');
L.push('~~~');
L.push('');
fs.writeFileSync(path.join(HERE, 'report.md'), L.join('\n'), 'utf8');
console.log('report.md written bytes=' + fs.statSync(path.join(HERE, 'report.md')).size);
function rowByIdSafe(id) { return stats.rows.find(r => r.id === id) || null; }

