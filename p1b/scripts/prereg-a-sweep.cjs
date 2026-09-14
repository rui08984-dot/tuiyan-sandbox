#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/prereg-a-sweep.cjs —— 命题 A 全量补齐「扫尾」（2026-09-14）
 *
 * 为什么存在：真跑的 retry_pending 只收「报了变体名」的失败项；实测还有 **245 个变体**从未入队
 *   （整请求失败/无名错误 ⇒ 静默成孤儿）。本脚本按**DB 事实**算出全量缺口（120 题 × 2 窗 × 3 臂 × 3 变体），
 *   逐条件用 verdicts 路由的 `onlyVariants` 通道补齐——与真跑**同链同口径**（applyArm + windowOf + evidenceIds）。
 *
 * 用法：
 *   node p1b/scripts/prereg-a-sweep.cjs [--dry-run（缺省）] [--confirm] [--json <out>] [--skip-state <state.json>]
 *   --skip-state：跳过该 state 的 retry_pending 里已列的条件（**与在跑的补漏零重叠**，可并行补"孤儿"缺口）
 *   env: P1B_LLM_REASONING_EFFORT=low、P1B_LLM_TIMEOUT_MS=600000（与续跑一致）
 *
 * 纪律：只对**缺失变体**发请求（幂等：verdicts 落库 OR IGNORE）；不写 run-state；如实打印/落 summary。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const CONFIRM = process.argv.indexOf('--confirm') >= 0;
const JSON_OUT = arg('json', null);
const SKIP_STATE = arg('skip-state', null); // 跳过该 state 的 retry_pending 条件（与在跑的补漏并行时用，防重复）
const ONLY_STATE = arg('only-state', null); // 只处理该 state 的 retry_pending 条件（与在跑的补漏并行「从队尾反向填」时用）
const REVERSE = process.argv.indexOf('--reverse') >= 0; // 反向顺序（与顺序推进的补漏迎面相遇，减少重叠窗口）
const V3K = 'P1B_EVIDENCE_V3', MODEK = 'P1B_EVIDENCE_V3_MODE';
const ARM_ENV = {
  A: { set: {} },
  B: { set: { P1B_EVIDENCE_V3: '0' } },
  C: { set: { P1B_EVIDENCE_V3_MODE: 'sham' } },
};
function applyArm(arm) { delete process.env[V3K]; delete process.env[MODEK]; const s = (ARM_ENV[arm] || {}).set || {}; for (const k of Object.keys(s)) process.env[k] = s[k]; }

const WINDOWS = ['cutoff', 'full'];
const ARMS = ['A', 'B', 'C'];
const VARIANTS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const RUN_PREFIX = 'preregA-full1-';
const MODEL = 'tokenrhythm/glm-5.3-flash';
const LIMIT = 120;

(async () => {
  const W = require('./prereg-a-windows.cjs');
  const { buildServer } = require('../src/server');
  const app = await buildServer({ dbPath: path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'), llmMock: false });
  const { db } = require('../src/deps');
  const conn = db.getConnection();
  const ps = require('../src/db/predictionsStore');
  const preds = conn.prepare("SELECT pr.id, pr.game_id FROM predictions pr JOIN games g ON g.id = pr.game_id"
    + " WHERE g.source='sim' AND pr.layer IN ('L1','L6') AND pr.checklist_hash='v2' ORDER BY pr.id").all().slice(0, LIMIT);
  const winCache = new Map();
  function windowOf(gameId, win) {
    W.assertSingleWindow(win);
    let all = winCache.get(gameId);
    if (!all) {
      const ev = conn.prepare('SELECT id, phase FROM events WHERE game_id = ? ORDER BY seq, id').all(gameId);
      const cl = conn.prepare('SELECT c.event_id FROM claims c JOIN events e ON e.id = c.event_id WHERE e.game_id = ?').all(gameId);
      all = { ev: ev, cl: cl }; winCache.set(gameId, all);
    }
    const view = win === 'cutoff' ? W.cutoffView(all.ev, all.cl) : W.fullView(all.ev, all.cl);
    return { ids: view.events.map((e) => e.id) };
  }
  const stV = conn.prepare('SELECT COUNT(*) c FROM verdicts WHERE prediction_id=? AND run_id=? AND prompt_variant=?');
  // --skip-state：与在跑的补漏零重叠（只补它队列外的孤儿条件）
  let skipSet = null;
  if (SKIP_STATE) {
    try {
      const st = JSON.parse(fs.readFileSync(path.resolve(SKIP_STATE), 'utf8'));
      skipSet = new Set((st.retry_pending || []).map((x) => x.key));
      console.log('[sweep] skip-state: ' + path.resolve(SKIP_STATE) + '（跳过 ' + skipSet.size + ' 个在队条件）');
    } catch (e) { console.log('[sweep] skip-state 读取失败：' + e.message + '（不跳过）'); skipSet = null; }
  }
  // --only-state：只处理在队条件（与补漏并行分半；配合 --reverse 从队尾迎面填）
  let onlySet = null;
  if (ONLY_STATE) {
    try {
      const st = JSON.parse(fs.readFileSync(path.resolve(ONLY_STATE), 'utf8'));
      onlySet = new Set((st.retry_pending || []).map((x) => x.key));
      console.log('[sweep] only-state: ' + path.resolve(ONLY_STATE) + '（只做 ' + onlySet.size + ' 个在队条件）' + (REVERSE ? ' 逆序' : ''));
    } catch (e) { console.log('[sweep] only-state 读取失败：' + e.message + '（不做）'); onlySet = new Set(); }
  }
  // 算缺口（按条件分组）
  const gaps = [];
  let missingTotal = 0;
  let skipped = 0;
  for (const p of preds) {
    for (const win of WINDOWS) {
      for (const arm of ARMS) {
        const key = p.id + '|' + win + '|' + arm;
        if (skipSet && skipSet.has(key)) { skipped++; continue; }
        if (onlySet && !onlySet.has(key)) { skipped++; continue; }
        const runId = RUN_PREFIX + arm + '-' + win;
        const miss = VARIANTS.filter((v) => stV.get(p.id, runId, v).c === 0);
        if (!miss.length) continue;
        missingTotal += miss.length;
        gaps.push({ pid: p.id, game_id: p.game_id, window: win, arm: arm, run_id: runId, missing: miss });
      }
    }
  }
  console.log('[sweep] 全量缺口：条件 ' + gaps.length + ' 个 ｜ 缺失变体 ' + missingTotal + ' 个'
    + (skipSet || onlySet ? '（已跳过 ' + skipped + ' 个条件）' : '') + (CONFIRM ? '' : '（dry-run：不发请求）'));
  if (REVERSE) gaps.reverse();
  const results = [];
  let saved = 0, errors = 0;
  if (CONFIRM) {
    for (const g of gaps) {
      applyArm(g.arm);
      try {
        const wid = windowOf(g.game_id, g.window);
        const r = await app.inject({ method: 'POST', url: '/api/games/' + g.game_id + '/predictions/' + g.pid + '/verdicts',
          body: { runId: g.run_id, model: MODEL, evidenceIds: wid.ids, onlyVariants: g.missing } });
        const b = r.json();
        const s = Array.isArray(b.saved) ? b.saved.length : 0;
        const e2 = Array.isArray(b.errors) ? b.errors.length : 0;
        saved += s; errors += e2;
        results.push({ pid: g.pid, window: g.window, arm: g.arm, requested: g.missing.length, saved: s, errors: e2 });
        console.log('[sweep] pid=' + g.pid + ' ' + g.arm + '/' + g.window + ' → saved=' + s + ' errors=' + e2 + '（requested ' + g.missing.length + '）');
      } catch (e) {
        errors++;
        results.push({ pid: g.pid, window: g.window, arm: g.arm, error: String(e && e.message) });
        console.log('[sweep] pid=' + g.pid + ' ' + g.arm + '/' + g.window + ' ERROR ' + (e && e.message));
      }
      delete process.env[V3K]; delete process.env[MODEK];
    }
  }
  const summary = { confirm: CONFIRM, conditions_with_gap: gaps.length, missing_variants: missingTotal, saved: saved, errors: errors, at: new Date().toISOString(), results: results };
  console.log('[sweep] 汇总: ' + JSON.stringify({ conditions: gaps.length, missing: missingTotal, saved: saved, errors: errors }));
  if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(summary, null, 1), 'utf8'); console.log('[sweep] -> ' + path.resolve(JSON_OUT)); }
  process.exit(0);
})();
