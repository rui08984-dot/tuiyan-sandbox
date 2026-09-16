#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/cost-ledger.cjs —— 成本台账（蓝图 §2.2#6；F7 重开判据的数据源 · 2026-09-17）
 *
 * 读法：读 usage sink（默认 `p1b/sim/out/llm-usage.jsonl`，可用 P1B_USAGE_SINK 或 --sink 指定）——
 *   由 `p1b/src/lib/usageSink.js` 在每次 LLM 调用后追加（无 sink 配置＝不落盘，零行为变化）。
 * 汇总：总量（calls / prompt / completion / cached）｜按 model ｜按日 ｜**输入 token 占比**（prompt/(prompt+completion)）。
 * 判据（蓝图写死）：**输入 token 占比 >40% ⇒ F7 上下文优化三件套重开**（本件只提示，不动 F7 状态）。
 * 纪律：零 LLM、零网络、零写库；只读 sink 文件；产出落 sim/out（.json/.md）。
 * 用法：node p1b/scripts/cost-ledger.cjs [--sink <file>] [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DEFAULT_SINK = path.join(ROOT, 'p1b', 'sim', 'out', 'llm-usage.jsonl');
const SINK = arg('sink', process.env.P1B_USAGE_SINK || DEFAULT_SINK);
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const F7_INPUT_SHARE_THRESHOLD = 0.40;   // 蓝图 §2.2#6：>40% ⇒ F7 重开

const rows = [];
let badLines = 0;
if (fs.existsSync(SINK)) {
  for (const line of fs.readFileSync(SINK, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch (e) { badLines++; }
  }
}
const tot = { calls: rows.length, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 };
const byModel = {}, byDay = {};
for (const r of rows) {
  const p = Number(r.prompt_tokens) || 0, c = Number(r.completion_tokens) || 0, ca = Number(r.cached_tokens) || 0;
  tot.prompt_tokens += p; tot.completion_tokens += c; tot.cached_tokens += ca;
  const m = String(r.model || '(unknown)'); byModel[m] = byModel[m] || { calls: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 };
  byModel[m].calls++; byModel[m].prompt_tokens += p; byModel[m].completion_tokens += c; byModel[m].cached_tokens += ca;
  const d = String(r.at || '').slice(0, 10); if (d) { byDay[d] = byDay[d] || { calls: 0, prompt_tokens: 0, completion_tokens: 0 }; byDay[d].calls++; byDay[d].prompt_tokens += p; byDay[d].completion_tokens += c; }
}
const totalTokens = tot.prompt_tokens + tot.completion_tokens;
const inputShare = totalTokens ? tot.prompt_tokens / totalTokens : null;
const f7Hint = inputShare !== null && inputShare > F7_INPUT_SHARE_THRESHOLD;

const report = { script: 'p1b/scripts/cost-ledger.cjs', sink: SINK, sink_exists: fs.existsSync(SINK), bad_lines: badLines,
  totals: tot, total_tokens: totalTokens, input_share: inputShare === null ? null : Number(inputShare.toFixed(4)),
  by_model: byModel, by_day: byDay,
  f7_rule: { threshold: F7_INPUT_SHARE_THRESHOLD, input_share_over_threshold: f7Hint,
    note: f7Hint ? '输入占比 >40% ⇒ 照蓝图 §2.2#6 提示 F7（上下文优化三件套）重开条件成立' : '输入占比未过阈（F7 维持封存）' },
  status: rows.length ? 'filled' : 'n/a（尚无 usage 落盘：sink 未配置或未跑过 LLM 批次——打点已就绪，下次判词跑批即自动累积）',
  generated_at: new Date().toISOString() };

const md = ['# 成本台账（' + new Date().toISOString().slice(0, 10) + '）', '',
  '> sink：`' + SINK + '`（存在=' + report.sink_exists + '）｜ 坏行 ' + badLines + '｜零写库。', '',
  '## 总量', '- calls ' + tot.calls + ' ｜ prompt ' + tot.prompt_tokens + ' ｜ completion ' + tot.completion_tokens + ' ｜ cached ' + tot.cached_tokens,
  '- **输入 token 占比 = ' + (inputShare === null ? 'n/a' : (inputShare * 100).toFixed(2) + '%') + '**（F7 阈 ' + (F7_INPUT_SHARE_THRESHOLD * 100) + '%）⇒ ' + report.f7_rule.note, ''];
if (Object.keys(byModel).length) md.push('## 按模型', ...Object.keys(byModel).map((m) => '- ' + m + '：' + JSON.stringify(byModel[m])));
md.push('', '## 状态', '- ' + report.status, '', '（零 LLM／零网络／零写库 · 台账数据源＝usageSink 追加行）');

fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.writeFileSync(path.join(OUT_DIR, 'cost-ledger-' + today + '.json'), JSON.stringify(report, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'cost-ledger-' + today + '.md'), md.join('\n') + '\n', 'utf8');
console.log('=== 成本台账 ===');
console.log('sink=' + SINK + '（exists=' + report.sink_exists + '）｜ calls=' + tot.calls + ' ｜ 输入占比=' + (inputShare === null ? 'n/a' : (inputShare * 100).toFixed(2) + '%'));
console.log('F7 判据：' + report.f7_rule.note);
console.log('状态：' + report.status);
console.log('json/md -> ' + OUT_DIR);
