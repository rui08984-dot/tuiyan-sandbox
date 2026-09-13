
// ── 到期时间分布报表（按天 + 按月）──
function distribute() {
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT p.id, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ? AND p.outcome IS NULL ORDER BY p.id').all('corpus%');
  const byDay = {}, byMonth = {}, bySrc = {}, byKind = {};
  let undatable = 0; const undKinds = {};
  for (const row of rows) {
    let ev = []; try { ev = JSON.parse(row.evidence_json || '[]'); } catch (e) { ev = []; }
    const e0 = ev[0] || {}, r = e0.resolve || {};
    const d = dueOf(e0);
    if (!d || !d.due) { undatable++; undKinds[String(r.kind)] = (undKinds[String(r.kind)] || 0) + 1; continue; }
    byDay[d.due] = (byDay[d.due] || 0) + 1;
    byMonth[d.due.slice(0, 7)] = (byMonth[d.due.slice(0, 7)] || 0) + 1;
    bySrc[d.src] = (bySrc[d.src] || 0) + 1;
    byKind[String(r.kind)] = (byKind[String(r.kind)] || 0) + 1;
  }
  return { rows: rows.length, byDay: byDay, byMonth: byMonth, bySrc: bySrc, byKind: byKind, undatable: undatable, undKinds: undKinds };
}
