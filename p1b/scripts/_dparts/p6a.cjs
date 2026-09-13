
// ── 一轮：查 corpus 未解题 → 到期过滤 → 参数安全门 → 预筛 → 按 resolve 参数去重 ──
const { db } = require('../src/deps');
const { resolvePrediction } = require('../src/db/predictionsStore');
const sigOf = (r) => String(r.kind) + '|' + JSON.stringify(r);
async function roundRun() {
  const t0 = Date.now();
  ROUND_CACHE = new Map(); roundApiHits = 0;   // 每轮独立：同 URL 只打一次网
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT p.id, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ? AND p.outcome IS NULL ORDER BY p.id').all('corpus%');
  const R = { total: rows.length, due: 0, notdue: 0, undatable: 0, guarded: 0, guardSamples: [], pre: 0, prescreened: 0, resolved: 0, pending: 0, fail: 0, refused: 0, refusedRace: 0, refusedPre: 0, skip: 0, unsupported: 0, unsupportedKinds: {}, failKinds: {}, netCalls: 0, deduped: 0, groups: 0, wouldWrite: 0 };
  const groups = new Map();
  for (const row of rows) {
    let ev = []; try { ev = JSON.parse(row.evidence_json || '[]'); } catch (e) { ev = []; }
    const r = ev[0] && ev[0].resolve;
    if (!r || !r.kind) { R.skip++; log('  skip id=' + row.id + '（无 resolve 参数，不机械回填）'); continue; }
    const d = dueOf(ev[0]);
    if (!d || !d.due) { R.undatable++; continue; }
    if (DUE_ONLY && isFuture(d.due)) { R.notdue++; continue; }
    const bad = paramGuard(r);
    if (bad !== null) { R.guarded++; if (R.guardSamples.length < 6) R.guardSamples.push(bad + ' @id' + row.id); continue; }
    R.due++;
    const s = sigOf(r);
    let g = groups.get(s);
    if (!g) { g = { r: r, due: d.due, src: d.src, ids: [], pre: null }; groups.set(s, g); } else { R.deduped++; }
    g.ids.push(row.id);
  }
  for (const [, g] of groups) { const p = preScreen(g.r); if (p) { g.pre = p; R.pre++; } }
  if (R.guarded) log('参数安全门：跳过 ' + R.guarded + ' 条口径不符题（不写脏账）— ' + R.guardSamples.join(' / '));
  R.groups = groups.size;
  return { R: R, groups: groups, t0: t0 };
}
