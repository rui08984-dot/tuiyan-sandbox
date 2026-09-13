#!/usr/bin/env node
'use strict';
/*
 * PREREG-命题A-3.0消融 · 跑批编排器（批次 4 第三步）
 * 判据来源：.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md（**只读，本脚本不改**）
 * 三臂：A=3.0 真实 d 段（默认 on）／B=2.0（P1B_EVIDENCE_V3=0）／C=sham 等 token（P1B_EVIDENCE_V3_MODE=sham）
 * 每臂每窗独立 run_id ＝ preregA-run1-{arm}-{window}
 * 双窗：cutoff／full —— **真正调用** p1b/scripts/prereg-a-windows.cjs（assertSingleWindow 生效），
 *       full = 该局全量事件（含 dusk 计票/终局）的事件 id 集，经 body.evidenceIds 覆盖证据（verdicts.js additive 参数）。
 * 硬闸：调用数 ≤ --max-calls（默认 2200）、费用 ≤ --max-cost（默认 ¥25）——内建于脚本，到任一即停并落停点。
 * 断点续跑：状态文件记录已完成 (pid|window|arm)，重跑自动跳过。
 * 用法：
 *   node p1b/scripts/prereg-a-run.cjs --dry-windows --limit=3                # 零 LLM：只算双窗证据差异（自检用）
 *   node p1b/scripts/prereg-a-run.cjs --mock --db=<临时库> --limit=2 --max-calls=6 --state=<f>   # MOCK 编排自检
 *   node p1b/scripts/prereg-a-run.cjs --limit=10                             # 真跑（由队长下令时使用）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

const MOCK = FLAG('mock');
const DRY = FLAG('dry-windows');
const LIMIT = Number(arg('limit', '0')) || null;
const ARMS = String(arg('arms', 'A,B,C')).split(',').map((s) => s.trim()).filter(Boolean);
const WINDOWS = String(arg('windows', 'cutoff,full')).split(',').map((s) => s.trim()).filter(Boolean);
const MAX_CALLS = Number(arg('max-calls', '2200'));
const MAX_COST = Number(arg('max-cost', '25'));
const CPC = Number(arg('cost-per-call', '0.0090'));
const MODEL = arg('model', 'tokenrhythm/glm-5.3-flash');
const TAG = arg('tag', 'run1');
const RUN_PREFIX = arg('run-prefix', 'preregA-run1-');
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const STATE_PATH = path.resolve(arg('state', path.join(ROOT, '.scratch', 'forecast-debate', 'prereg-a', 'run-state-' + TAG + '.json')));
const JSON_OUT = arg('json', null);
const PROVIDERS = path.resolve(arg('providers', path.join(ROOT, '.scratch', 'd2', '_mock-providers.json')));
const PREREG = path.join(ROOT, '.scratch', 'forecast-debate', 'PREREG-命题A-3.0消融-v1.md');
const V3K = 'P1B_EVIDENCE_V3', MODEK = 'P1B_EVIDENCE_V3_MODE';
const ARM_ENV = {
  A: { set: {}, note: '3.0 真实 d 段（默认 on）' },
  B: { set: { P1B_EVIDENCE_V3: '0' }, note: '2.0 对照（逐字节退回三段）' },
  C: { set: { P1B_EVIDENCE_V3_MODE: 'sham' }, note: 'C 臂 sham 等 token 空特征' },
};
function applyArm(arm) { delete process.env[V3K]; delete process.env[MODEK]; const s = (ARM_ENV[arm] || {}).set || {}; for (const k of Object.keys(s)) process.env[k] = s[k]; }
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return { tag: TAG, done: {}, calls: 0, cost: 0, stop_reason: null, started_at: new Date().toISOString() }; } }
function saveState(st) { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 1), 'utf8'); }
function preregSha() {
  try {
    const lines = fs.readFileSync(PREREG, 'utf8').split(/\r?\n/).filter((l) => l.indexOf('> sha256') !== 0);
    return require('crypto').createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex').slice(0, 12);
  } catch (e) { return 'prereg-missing'; }
}

async function main() {
  const W = require('./prereg-a-windows.cjs'); // ← 真正调用窗口模块（禁自写一套规则）；.cjs 必须带扩展名（extensionless 只试 .js/.json/.node）
  const st = loadState();
  const { buildServer } = require('../src/server');
  const app = await buildServer({ dbPath: DB_PATH, llmMock: MOCK, providersPath: PROVIDERS });
  const { db } = require('../src/deps');
  const conn = db.getConnection();
  const ps = require('../src/db/predictionsStore');
  const { loadEvidence } = require('../src/routes/verdicts');
  const preds = conn.prepare("SELECT pr.id, pr.game_id FROM predictions pr JOIN games g ON g.id = pr.game_id"
    + " WHERE g.source='sim' AND pr.layer IN ('L1','L6') AND pr.checklist_hash='v2' ORDER BY pr.id").all();
  const selected = LIMIT ? preds.slice(0, LIMIT) : preds;
  const winCache = new Map();
  function windowOf(gameId, win) {
    W.assertSingleWindow(win);
    let all = winCache.get(gameId);
    if (!all) {
      const ev = conn.prepare('SELECT id, phase FROM events WHERE game_id = ? ORDER BY seq, id').all(gameId);
      const cl = conn.prepare('SELECT c.event_id FROM claims c JOIN events e ON e.id = c.event_id WHERE e.game_id = ?').all(gameId);
      all = { ev: ev, cl: cl };
      winCache.set(gameId, all);
    }
    const view = win === 'cutoff' ? W.cutoffView(all.ev, all.cl) : W.fullView(all.ev, all.cl);
    return { ids: view.events.map((e) => e.id), n_events: view.events.length, n_claims: view.claims.length, note: view._note };
  }
  const conditions = [];
  for (const p of selected) for (const win of WINDOWS) for (const arm of ARMS) conditions.push({ pid: p.id, game_id: p.game_id, window: win, arm: arm, key: p.id + '|' + win + '|' + arm });
  const results = [];
  let stop = null, doneThis = 0, skipped = 0;
  for (const c of conditions) {
    if (st.done[c.key]) { skipped++; continue; }
    if (!DRY) {
      if (st.calls + 3 > MAX_CALLS) { stop = { reason: 'max_calls', at: c.key, calls: st.calls, cost: st.cost }; break; }
      if (st.cost + 3 * CPC > MAX_COST) { stop = { reason: 'max_cost', at: c.key, calls: st.calls, cost: st.cost }; break; }
    }
    const wid = windowOf(c.game_id, c.window);
    const evLen = loadEvidence(ps.getPrediction(c.pid), { evidenceIds: wid.ids }).length;
    const runId = RUN_PREFIX + c.arm + '-' + c.window;
    const rec = { key: c.key, pid: c.pid, window: c.window, arm: c.arm, run_id: runId, window_events: wid.n_events, window_claims: wid.n_claims, evidence_len: evLen };
    if (DRY) { results.push(rec); continue; }
    applyArm(c.arm);
    try {
      const r = await app.inject({ method: 'POST', url: '/api/games/' + c.game_id + '/predictions/' + c.pid + '/verdicts', body: { runId: runId, model: MODEL, evidenceIds: wid.ids } });
      rec.status = r.statusCode;
      const body = r.json();
      rec.saved = Array.isArray(body.saved) ? body.saved.length : 0;
      rec.errors = Array.isArray(body.errors) ? body.errors.length : 0;
    } catch (e) { rec.error = String(e && e.message); }
    delete process.env[V3K]; delete process.env[MODEK];
    st.calls += 3; st.cost = Number((st.cost + 3 * CPC).toFixed(6));
    st.done[c.key] = { run_id: runId, status: rec.status === undefined ? null : rec.status, evidence_len: evLen, window_events: wid.n_events };
    results.push(rec); doneThis++;
    saveState(st);
  }
  if (!DRY) { st.stop_reason = stop ? stop.reason : 'complete'; saveState(st); }
  const byWindow = {};
  for (const r of results) { const w = byWindow[r.window] = byWindow[r.window] || { n: 0, ev_min: 1e9, ev_max: 0, ev_set: [] }; w.n++; w.ev_min = Math.min(w.ev_min, r.evidence_len); w.ev_max = Math.max(w.ev_max, r.evidence_len); if (w.ev_set.indexOf(r.evidence_len) === -1) w.ev_set.push(r.evidence_len); }
  const out = { script: 'p1b/scripts/prereg-a-run.cjs', mode: MOCK ? 'MOCK' : (DRY ? 'DRY' : 'REAL'), prereg_sha12: preregSha(),
    arms: ARMS, windows: WINDOWS, limit: LIMIT, db: DB_PATH, caps: { max_calls: MAX_CALLS, max_cost: MAX_COST, cost_per_call: CPC },
    conditions_total: conditions.length, completed_this_run: doneThis, skipped_done: skipped, remaining: conditions.length - Object.keys(st.done).length,
    calls: st.calls, cost: st.cost, stop_reason: (DRY ? 'dry-only' : (stop ? stop.reason : 'complete')), stop_detail: stop,
    window_evidence: byWindow, results: results, state_file: STATE_PATH, generated_at: new Date().toISOString() };
  const L = [];
  L.push('[prereg-a-run] mode=' + out.mode + ' arms=' + ARMS.join('+') + ' windows=' + WINDOWS.join('+') + ' limit=' + (LIMIT || 'ALL'));
  L.push('  conditions_total=' + conditions.length + ' completed=' + doneThis + ' skipped_done=' + skipped + ' remaining=' + out.remaining);
  L.push('  calls=' + st.calls + '/' + MAX_CALLS + ' cost=¥' + st.cost.toFixed(4) + '/' + MAX_COST + ' stop=' + out.stop_reason + (stop ? (' at ' + stop.at) : ''));
  for (const w of Object.keys(byWindow)) L.push('  window=' + w + ' n=' + byWindow[w].n + ' evidence_len distinct=' + JSON.stringify(byWindow[w].ev_set) + ' (min/max ' + byWindow[w].ev_min + '/' + byWindow[w].ev_max + ')');
  L.push('  sample: ' + results.slice(0, 3).map((r) => r.key + '->' + r.run_id + '(ev=' + r.evidence_len + ',status=' + r.status + ')').join(' | '));
  L.push('  state_file=' + STATE_PATH);
  console.log(L.join('\n'));
  if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 1), 'utf8'); console.log('[prereg-a-run] JSON -> ' + path.resolve(JSON_OUT)); }
  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('[prereg-a-run] FAIL ' + (e && e.stack ? e.stack : e)); process.exit(1); });

