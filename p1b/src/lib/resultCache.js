'use strict';
/**
 * p1b/src/lib/resultCache.js —— 结果缓存键（**唯一在建缓存件**；蓝图 §2.1#7 · 2026-09-17）
 *
 * 键构造（蓝图原文逐字）：`键=norm(statement)+hash(evidence_json)+prompt 版本+温度`。
 *   · norm(statement)＝空白折叠（多次重跑同一题面同键）；
 *   · evidence_json 取 sha256（原文哈希，防巨型文本进键）；
 *   · prompt 版本＝PROMPT_VARIANTS 的版本号（改版即 run_id/键递进，防旧结果串新提示）；
 *   · 温度入键（同题异温＝不同结果，禁混用）。
 * 纪律：**语义缓存永不**（F3——同模板不同局=不同事件，跨局复用会污染下游判据）；
 *   本件只做「同题同 prompt 版本同温度」的**结果预检**，跨局复用被键结构天然排除（statement+evidence 均入键）。
 * 用法：const { cacheKey } = require('.../resultCache'); cacheKey({statement, evidenceJson, promptVariant, temperature, promptVersion})
 */
const crypto = require('node:crypto');

const KEY_SCHEMA = 'resultCache.v1';

function normStatement(s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim(); }

function sha256Hex(s) { return crypto.createHash('sha256').update(String(s === null || s === undefined ? '' : s), 'utf8').digest('hex'); }

function cacheKey(input) {
  const i = input || {};
  const parts = [
    KEY_SCHEMA,
    normStatement(i.statement),
    sha256Hex(i.evidenceJson),
    String(i.promptVariant || ''),
    String(i.temperature === undefined || i.temperature === null ? '' : i.temperature),
    String(i.promptVersion || ''),
  ];
  return crypto.createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
}

module.exports = { cacheKey: cacheKey, normStatement: normStatement, KEY_SCHEMA: KEY_SCHEMA, createStore: createStore };

/**
 * 结果缓存**存**（磁盘 JSONL；append-only；键已验证跨题安全——见 result-cache-precheck 收据）。
 * 纪律：只给「同题同 prompt 版本同温度」复用（键结构保证）；跨局/跨题复用被键排除（F3 语义缓存永不）。
 * 用法：const st = createStore(dir); st.get(key) / st.put(key, {verdict_text, implied_prob, model, created_at}) / st.close()
 */
function createStore(dir) {
  const fs = require('node:fs');
  const path = require('node:path');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'result-cache.jsonl');
  const index = new Map();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const o = JSON.parse(line); if (o && o.key) index.set(o.key, o.value); } catch (e) { /* 跳过坏行（不静默改文件） */ }
    }
  }
  return {
    dir: dir, file: file, size: () => index.size,
    get: (key) => (index.has(key) ? index.get(key) : null),
    put: (key, value) => { const rec = { key: key, value: value, at: new Date().toISOString() }; fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8'); index.set(key, value); return rec; },
    close: () => { index.clear(); },
  };
}
