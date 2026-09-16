'use strict';
/**
 * p1b/src/lib/usageSink.js —— LLM 用量落盘（成本台账的数据源；蓝图 §2.2#6 · 2026-09-17）
 *
 * 用途：把每次 LLM 调用的 usage 追加到 JSONL（**只追加、不覆盖**），供 `p1b/scripts/cost-ledger.cjs` 汇总。
 * 开关：显式传 path，或环境变量 `P1B_USAGE_SINK=<文件路径>`；**都不给 = 不落盘**（零行为变化）。
 * 纪律：只写 usage 数字（token 计数），**绝不含 prompt/response 正文，绝不含 key**；写入失败静默降级（不打断主链）。
 */
const fs = require('node:fs');
const path = require('node:path');

function sinkPath(explicit) { return explicit || process.env.P1B_USAGE_SINK || null; }

function record(entry, explicitPath) {
  const p = sinkPath(explicitPath);
  if (!p) return { recorded: false, reason: 'no_sink_configured' };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const rec = {
      at: new Date().toISOString(),
      model: entry && entry.model ? String(entry.model) : null,
      prompt_tokens: Number((entry && entry.prompt_tokens) || 0),
      completion_tokens: Number((entry && entry.completion_tokens) || 0),
      cached_tokens: Number((entry && entry.cached_tokens) || 0),
      note: entry && entry.note ? String(entry.note).slice(0, 120) : null,
    };
    fs.appendFileSync(p, JSON.stringify(rec) + '\n', 'utf8');
    return { recorded: true, path: p };
  } catch (e) { return { recorded: false, reason: String(e && e.message || e) }; }
}

module.exports = { record: record, sinkPath: sinkPath };
