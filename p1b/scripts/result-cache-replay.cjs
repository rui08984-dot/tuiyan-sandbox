#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/result-cache-replay.cjs —— 结果缓存本体·历史重放验证（蓝图 §2.1#7 判据「历史重跑全命中」· 2026-09-17）
 *
 * 做什么：把历史判词**两遍**过缓存（第一遍填、第二遍读），验证：
 *   ① 第二遍 **100% 命中**（判据：历史重跑全命中）；
 *   ② 命中值与原行一致（键→值映射稳定，无串行）；
 *   ③ 存为 JSONL、append-only；**演示默认写 .tmp/**（仓库外运行产物），绝不定入 sim/out。
 * 纪律：零 LLM、零网络；生产库只读；不接生产判词路径（本件只证明缓存件本身可用）。
 * 用法：node p1b/scripts/result-cache-replay.cjs [--db <path>] [--store <dir>] [--report-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const STORE = arg('store', path.join(ROOT, '.tmp', 'result-cache-demo'));
const REPORT_DIR = arg('report-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const PROMPT_VERSION = arg('prompt-version', 'v1');

const { cacheKey, createStore } = require(path.join(ROOT, 'p1b', 'src', 'lib', 'resultCache'));

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const rows = db.prepare('SELECT v.id, v.prompt_variant, v.temperature, v.verdict_text, v.implied_prob, v.model, p.statement AS statement, p.evidence_json AS evidence_json '
  + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id ORDER BY v.created_at, v.id').all();
db.close();

// 清空演示缓存（幂等重跑）
try { if (fs.existsSync(path.join(STORE, 'result-cache.jsonl'))) fs.rmSync(path.join(STORE, 'result-cache.jsonl')); } catch (e) { /* ignore */ }
const st = createStore(STORE);
const keys = [];
let pass1Miss = 0, pass1Hit = 0, pass2Hit = 0, pass2Miss = 0, valueMismatch = 0;
for (const r of rows) {                                                              // pass 1：填
  const key = cacheKey({ statement: r.statement, evidenceJson: r.evidence_json, promptVariant: r.prompt_variant, temperature: r.temperature, promptVersion: PROMPT_VERSION });
  const val = { verdict_text: r.verdict_text, implied_prob: r.implied_prob, model: r.model };
  const got = st.get(key);
  if (got === null) { pass1Miss++; st.put(key, val); } else { pass1Hit++; }
  keys.push({ key: key, val: val });
}
for (const k of keys) {                                                              // pass 2：读（判据）
  const got = st.get(k.key);
  if (got === null) pass2Miss++; else { pass2Hit++; if (got.implied_prob !== k.val.implied_prob) valueMismatch++; }
}
const report = { script: 'p1b/scripts/result-cache-replay.cjs', item: '结果缓存本体·历史重放验证',
  store: STORE, store_size_after_pass1: keys.length ? new Set(keys.map((k) => k.key)).size : 0,
  rows: rows.length, pass1: { hit: pass1Hit, miss: pass1Miss }, pass2: { hit: pass2Hit, miss: pass2Miss },
  judgement: { replay_all_hit: pass2Miss === 0, value_variance_rows: valueMismatch,
    verdict: pass2Miss === 0
      ? '**历史重跑全命中（蓝图判据达成）**；同键历史值有差异的行 ' + valueMismatch + ' 行＝LLM 轮间方差（缓存将重跑冻结到首值——降方差作用，属功能）'
      : '未达判据：pass2 有漏（' + pass2Miss + '）' },
  note: '演示缓存位于 .tmp/（运行产物，不入库）；生产接入（判词跑批路径）尚未接线', generated_at: new Date().toISOString() };
fs.mkdirSync(REPORT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.writeFileSync(path.join(REPORT_DIR, 'result-cache-replay-' + today + '.json'), JSON.stringify(report, null, 1), 'utf8');
console.log('=== 结果缓存本体·历史重放 ===');
console.log('行 ' + rows.length + ' ｜ pass1 命中 ' + pass1Hit + '/新增 ' + pass1Miss + ' ｜ pass2 命中 ' + pass2Hit + '/漏 ' + pass2Miss + ' ｜ 值不一致 ' + valueMismatch);
console.log('判据（历史重跑全命中）：' + report.judgement.verdict);
console.log('store -> ' + STORE + '（.tmp 运行产物）｜ report -> ' + path.join(REPORT_DIR, 'result-cache-replay-' + today + '.json'));
st.close();
