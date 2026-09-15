#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/effective-source-snapshot.cjs —— 阶段 5 开工前置 ⑤：记录并冻结「实际生效源」配置快照。
 *
 * 依据（立项书 v1.1 §五-前置 5 / 评审 F13）：
 *   「LLM/检索的**实际生效源**记录并冻结配置快照（『唯一真源＋全链路同步』未完成则记现状）」。
 *
 * 纪律：
 *   · **零 key**：只记录 key 的「来源」（providers/env/none）与「是否具备」，绝不写 key 值或片段。
 *   · 只读：读 providers.json ＋ env 判定 ＋ describeEffective 口径（与 llmOptions 逐字对齐，勿各写一套）。
 *   · 输出 JSON（侧面 meta ＋ 主体），可重复跑（幂等）；用于 PREREG 冻结件附件的「生效源」节。
 *
 * 用法：node p1b/scripts/effective-source-snapshot.cjs [--out <file.json>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const OUT = arg('out', path.join(ROOT, 'p1b/sim/out/effective-source-snapshot-latest.json'));

const { describeEffective } = require(path.join(ROOT, 'p1b/src/llmOptions'));
const { createProvidersStore } = require(path.join(ROOT, 'p1b/src/providersStore'));

const out = {};
out.script = 'p1b/scripts/effective-source-snapshot.cjs';
out.generated_at = new Date().toISOString();
out.purpose = '阶段 5 开工前置 ⑤：LLM/检索实际生效源冻结快照（零 key）';

// ── LLM 侧生效源（describeEffective 口径）──
let store = null;
try { store = createProvidersStore(path.join(ROOT, 'p1a-terminal/config/providers.json')); } catch (e) { store = null; }
const eff = store ? describeEffective({ store }) : null;
out.llm = eff ? {
  mode: eff.mode, mock: eff.mock, provider: eff.provider, base_url: eff.base_url,
  model: eff.model, key_source: eff.key_source, has_key: eff.has_key, reasoning_effort: eff.reasoning_effort,
  note: 'key 只记录来源与有无，绝不含 key 值（铁律⑤）',
} : { error: 'providers store 不可用' };

// ── LLM 路径与旋钮（供 PREREG 冻结件复述）──
out.llm.transport = {
  chat_path: '/chat/completions',
  timeout_default_ms: Number(process.env.P1B_LLM_TIMEOUT_MS || 120000),
  reasoning_effort_env: process.env.P1B_LLM_REASONING_EFFORT || null,
  reasoning_effort_note: 'tokenrhythm glm-5.3-flash 强制深度思考；P1B_LLM_REASONING_EFFORT=low 为已实测降压旋钮',
};

// ── 检索侧生效源：**现状＝尚未配置**（如实记，不编）──
out.retrieval = {
  configured: false,
  provider: null,
  base_url: null,
  key_source: 'none',
  note: '阶段 5 检索 provider 尚未选定/配置；立项书 §五 前置 2 的勘察件已列**候选数据源**（29 主机/52 kind，'
    + '见 docs/specs/阶段5-功能映射表与信号源勘察-20260915.md §三），但「检索用」源须与 resolve 源分离，'
    + '且须在 PREREG 冻结前逐源验证「cutoff 时点可得性」。冻结件须写明 provider/query 模板/日期过滤/条数。',
};

// ── 环境快照（非秘密；可复现判定用）──
out.env = {
  node: process.version,
  platform: process.platform,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
};

// ── 零 key 断言（自检）──
const ser = JSON.stringify(out);
const leak = /(sk-[A-Za-z0-9]|api_key"\s*:\s*"[^"]{8,}|Bearer\s+[A-Za-z0-9._-]{16,})/.test(ser);
out.zero_key_selfcheck = { pass: !leak, note: '自检：序列化结果中不含常见 key 形态' };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('[eff-src] -> ' + OUT);
console.log(JSON.stringify({ llm: { mode: out.llm.mode, provider: out.llm.provider, model: out.llm.model, key_source: out.llm.key_source, reasoning_effort: out.llm.reasoning_effort }, retrieval: out.retrieval.configured, zero_key: out.zero_key_selfcheck.pass }, null, 1));
