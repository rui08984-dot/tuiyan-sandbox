#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/exp-health.cjs —— 跑批体检（任务 6 批次 2 · B1-6）
 *
 * 为什么存在：判"跑批在不在跑"要三件套——① 首个请求是否回包（wedge 判据）② DB 行增长 ③ **队列是否陈旧**
 *   （幂等写会吞掉"零增长"；2026-09-14 两次差点误判）。**CPU 时间不是判据**（网络等待型循环不吃 CPU）。
 * 用法：node p1b/scripts/exp-health.cjs [--prefix <run_id前缀>] [--state <state.json>] [--ping] [--json <out>]
 * 只读：不写库、不改任何文件；--ping 会发一条 max_tokens=4 的真实请求（唯一网络动作，可选）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;
const PREFIX = arg('prefix', 'preregA-full1-');
const STATE = arg('state', path.join(ROOT, '.scratch', 'forecast-debate', 'prereg-a', 'run-state-full1-repair.json'));
const JSON_OUT = arg('json', null);
const DB_PATH = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');

const out = { at: new Date().toISOString(), prefix: PREFIX, processes: null, growth: null, queue: null, ping: null };

// ── ① 进程（node 命令行含 prereg/corpus/stage4/g2-）──
try {
  let lines = [];
  if (process.platform === 'win32') {
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
    lines = String(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 })).split(/\r?\n/);
  } else {
    lines = String(execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8', timeout: 20000 })).split(/\r?\n/);
  }
  const hits = lines.filter((l) => /(prereg|corpus|stage4|g2-|board\.cjs)/.test(l) && !/exp-health/.test(l));
  out.processes = { count: hits.length, list: hits.slice(0, 6).map((s) => s.trim().slice(0, 120)) };
} catch (e) { out.processes = { error: String(e.message).slice(0, 120) }; }

// ── ② DB 增长（近 10 分钟新增 verdicts；created_at 为 UTC，与 datetime('now') 同域）──
try {
  const D = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
  const db = new D(DB_PATH, { readonly: true });
  const c = (where) => db.prepare("SELECT COUNT(*) c FROM verdicts WHERE run_id LIKE ? " + (where || '')).get(PREFIX + '%').c;
  const n10 = db.prepare("SELECT COUNT(*) c FROM verdicts WHERE run_id LIKE ? AND created_at >= datetime('now','-10 minutes')").get(PREFIX + '%').c;
  const n60 = db.prepare("SELECT COUNT(*) c FROM verdicts WHERE run_id LIKE ? AND created_at >= datetime('now','-60 minutes')").get(PREFIX + '%').c;
  const last = db.prepare('SELECT id, created_at FROM verdicts WHERE run_id LIKE ? ORDER BY id DESC LIMIT 1').get(PREFIX + '%');
  out.growth = { total: c(), last_10min: n10, last_60min: n60, last_row: last || null, rows_per_min_10: Number((n10 / 10).toFixed(2)) };
  db.close();
} catch (e) { out.growth = { error: String(e.message).slice(0, 120) }; }

// ── ③ 队列陈旧度（state.retry_pending 逐条核 DB：缺多少变体；已入库的＝陈旧）──
try {
  if (fs.existsSync(STATE)) {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const D = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
    const db = new D(DB_PATH, { readonly: true });
    const stV = db.prepare('SELECT COUNT(*) c FROM verdicts WHERE prediction_id=? AND run_id=? AND prompt_variant=?');
    const VARS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
    let missing = 0, stale = 0, conds = 0;
    for (const rq of (st.retry_pending || [])) {
      conds++;
      const miss = VARS.filter((v) => stV.get(rq.pid, rq.run_id, v).c === 0).length;
      if (miss === 0) stale++; else missing += miss;
    }
    out.queue = { state: path.relative(ROOT, STATE), conditions: conds, missing_variants: missing, fully_done: stale };
    db.close();
  } else { out.queue = { state: path.resolve(STATE), note: 'state 不存在（可能已收工）' }; }
} catch (e) { out.queue = { error: String(e.message).slice(0, 120) }; }

// ── ④ 上游探测（可选 --ping：4 token；真实判词体量需更大预算，见 PAUSE-RESUME §6.1）──
if (FLAG('ping')) {
  out.ping = (async () => { })(); // 占位（下方同步执行以保证输出顺序）
}

const L = [];
L.push('跑批体检（' + out.at + '）｜前缀 ' + PREFIX);
L.push('① 进程: ' + (out.processes && out.processes.count !== undefined ? (out.processes.count + ' 个相关 node 进程'
  + (out.processes.count ? '：' + out.processes.list.map((s) => s.split('\t')[0]).join(',') : '')) : JSON.stringify(out.processes)));
if (out.growth && out.growth.total !== undefined) {
  L.push('② DB 增长: 前缀共 ' + out.growth.total + ' 行 ｜ 近10分钟 +' + out.growth.last_10min + '（≈' + out.growth.rows_per_min_10 + ' 行/分）｜ 近60分钟 +' + out.growth.last_60min
    + (out.growth.last_row ? ' ｜ 最后一行 ' + out.growth.last_row.created_at + 'Z' : ''));
} else { L.push('② DB: ' + JSON.stringify(out.growth)); }
if (out.queue && out.queue.conditions !== undefined) {
  L.push('③ 队列: ' + out.queue.conditions + ' 条件 ｜ 真缺 ' + out.queue.missing_variants + ' 变体 ｜ 已入库(陈旧) ' + out.queue.fully_done + ' 条件'
    + (out.queue.missing_variants === 0 && out.queue.conditions ? ' ⇒ 队列已清空（勿重复跑）' : ''));
} else { L.push('③ 队列: ' + JSON.stringify(out.queue)); }
L.push('判读口径: **零增长 ≠ 卡死**（先看③队列是否陈旧）；**CPU 低 ≠ 卡死**；wedge 判据＝首个请求不回包＋零增长＋日志零字节。');
const text = L.join('\n');
console.log(text);
if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 1), 'utf8'); console.log('[exp-health] json -> ' + path.resolve(JSON_OUT)); }
