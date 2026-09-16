#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/result-cache-precheck.cjs —— 结果缓存预检（蓝图 §2.1#7「唯一在建缓存件」· 2026-09-17）
 *
 * 做什么：用**历史判词**验证缓存键是否够用——键=norm(statement)+hash(evidence_json)+prompt 版本+温度（resultCache.js）。
 *   判据分两条（**先安全、后披露**——2026-09-17 修正：首版把「同题多轮」误当「键不足」）：
 *   ① **跨题安全（必须 0）**：同键映射到 **≥2 个不同 prediction_id** ⇒ 复用会跨题串结果（F3 类泄漏）⇒ 禁止上线；
 *   ② **同题复现（披露项）**：同键同题但多 run/多模型 ⇒ 输出不同属**预期**（LLM 随机性）——
 *      这正是缓存要冻结的对象（复现缓存）；量化命中率与 run/model 分布。
 *   ③ 分布披露：按 prompt_variant / temperature / model 分组，供缓存策略与成本评估。
 * 纪律：零 LLM、零网络、零写库（库 readOnly）；不做任何缓存写入（只算键与统计）；产出落 sim/out。
 * 用法：node p1b/scripts/result-cache-precheck.cjs [--db <path>] [--out-dir <dir>] [--prompt-version <v>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const PROMPT_VERSION = arg('prompt-version', 'v1');   // prompt 版本（改版即键递进）

const { cacheKey } = require(path.join(ROOT, 'p1b', 'src', 'lib', 'resultCache'));

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const rows = db.prepare('SELECT v.id, v.prediction_id, v.prompt_variant, v.temperature, v.verdict_text, v.implied_prob, v.created_at, v.model, '
  + 'p.statement AS statement, p.evidence_json AS evidence_json '
  + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id ORDER BY v.created_at, v.id').all();
db.close();

const byKey = {}; const stats = { rows: rows.length, distinct_keys: 0,
  cross_item_keys: 0, cross_item_rows: 0,        // ① 跨题安全（必须 0）
  same_item_multi_output_keys: 0,                // ② 同题多轮异输出（预期：随机性；缓存冻结对象）
  hits_simulated: 0, misses_simulated: 0, by_variant: {}, by_temperature: {}, by_model: {}, by_run: {} };
for (const r of rows) {
  const key = cacheKey({ statement: r.statement, evidenceJson: r.evidence_json, promptVariant: r.prompt_variant, temperature: r.temperature, promptVersion: PROMPT_VERSION });
  if (!byKey[key]) { byKey[key] = { n: 0, pids: {}, outputs: {} }; stats.misses_simulated++; }
  else stats.hits_simulated++;
  const b = byKey[key]; b.n++;
  b.pids[r.prediction_id] = (b.pids[r.prediction_id] || 0) + 1;
  const outSig = String(r.implied_prob) + '|' + String(r.verdict_text).slice(0, 80);
  b.outputs[outSig] = (b.outputs[outSig] || 0) + 1;
  stats.by_variant[r.prompt_variant] = (stats.by_variant[r.prompt_variant] || 0) + 1;
  stats.by_temperature[String(r.temperature)] = (stats.by_temperature[String(r.temperature)] || 0) + 1;
  stats.by_model[String(r.model)] = (stats.by_model[String(r.model)] || 0) + 1;
}
for (const k of Object.keys(byKey)) {
  const b = byKey[k];
  if (Object.keys(b.pids).length > 1) { stats.cross_item_keys++; stats.cross_item_rows += b.n; }
  if (Object.keys(b.outputs).length > 1) stats.same_item_multi_output_keys++;
}
stats.distinct_keys = Object.keys(byKey).length;
const hitRate = rows.length ? stats.hits_simulated / rows.length : 0;
const safeOk = stats.cross_item_keys === 0;

const report = { script: 'p1b/scripts/result-cache-precheck.cjs', item: '蓝图 §2.1#7 结果缓存预检（唯一在建缓存件）',
  key_schema: 'resultCache.v1（norm(statement)+sha256(evidence_json)+prompt 版本+温度）', prompt_version: PROMPT_VERSION,
  judgement: {
    cross_item_safe: safeOk, cross_item_keys: stats.cross_item_keys, cross_item_rows: stats.cross_item_rows,
    verdict: safeOk
      ? '跨题安全通过（同键必同题）——同题多轮异输出属预期（随机性；缓存冻结之）⇒ 可进入实现阶段'
      : '跨题不安全：' + stats.cross_item_keys + ' 个键映射到多个 prediction_id ⇒ 禁止上线（会跨题串结果）',
  },
  replay_note: '首跑命中率 0-10% 是正确行为（防跨局信息泄漏）；模拟命中率只作披露（同题多轮/多模型场景）',
  ...stats, hit_rate_simulated: Number(hitRate.toFixed(4)), generated_at: new Date().toISOString() };

const md = ['# 结果缓存预检（' + new Date().toISOString().slice(0, 10) + '）', '',
  '> 键：`' + report.key_schema + '`｜prompt 版本 ' + PROMPT_VERSION + '｜零写库（库只读）。', '',
  '## 判读（安全优先）', '- ① 跨题安全：' + (safeOk ? '**通过**（同键必同题）' : '**不通过**——' + stats.cross_item_keys + ' 个键跨 ' + stats.cross_item_rows + ' 行映射多题'),
  '- ② 同题复现（披露）：' + stats.same_item_multi_output_keys + ' 个键在同题内出现多组输出（LLM 随机性 ⇒ 缓存冻结之，属预期）',
  '- 模拟重放：' + stats.rows + ' 行 → 命中 ' + stats.hits_simulated + ' / 首现 ' + stats.misses_simulated + '（命中率 ' + (hitRate * 100).toFixed(2) + '%）',
  '- 说明：' + report.replay_note, '',
  '## 分布', '- 变体：' + JSON.stringify(stats.by_variant), '- 温度：' + JSON.stringify(stats.by_temperature), '- 模型：' + JSON.stringify(stats.by_model), '',
  '（零 LLM／零网络／零写库 · 缓存本体尚未实现——本件为上线前置判据）'];

fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.writeFileSync(path.join(OUT_DIR, 'result-cache-precheck-' + today + '.json'), JSON.stringify(report, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'result-cache-precheck-' + today + '.md'), md.join('\n') + '\n', 'utf8');
console.log('=== 结果缓存预检 ===');
console.log('行 ' + stats.rows + ' ｜ 键 ' + stats.distinct_keys + ' ｜ 跨题键 ' + stats.cross_item_keys + '（须 0）｜ 同题多输出键 ' + stats.same_item_multi_output_keys + ' ｜ 模拟命中率 ' + (hitRate * 100).toFixed(2) + '%');
console.log('判读：' + report.judgement.verdict);
console.log('json/md -> ' + OUT_DIR);
