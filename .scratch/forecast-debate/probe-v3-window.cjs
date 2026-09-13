'use strict';
// probe3：只读 —— 按 loadEvidence 的证据窗（evidence_json 事件子集 + 其 claims）跑检测器
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const DET = require('E:/music player/p1b/src/detectors/werewolf-contradictions.js');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const preds = db.prepare("SELECT p.id, p.game_id, p.layer, p.evidence_json, g.game_type FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.game_type LIKE '%wolf%' ORDER BY p.id").all();
const cache = new Map();
function restricted(pid, gid, ids, guard) {
  const evs = [];
  for (const id of ids) {
    const ev = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text FROM events e LEFT JOIN players p ON p.id = e.actor_seat' + (guard ? ' AND p.game_id = e.game_id' : '') + ' WHERE e.id = ? AND e.game_id = ?').get(id, gid);
    if (ev) evs.push(ev);
  }
  if (!evs.length) return null;
  const ph = ids.map(() => '?').join(',');
  const claims = db.prepare('SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object FROM claims c WHERE c.event_id IN (' + ph + ') ORDER BY c.id').all.apply(db.prepare('SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object FROM claims c WHERE c.event_id IN (' + ph + ') ORDER BY c.id'), ids);
  return { evs: evs, claims: claims };
}
let nWith = 0, nZero = 0, nNoEv = 0, sumPairs = 0, sumEv = 0, sumCl = 0;
const hist = {}; const byLayer = {};
for (const p of preds) {
  let ids = []; try { ids = JSON.parse(p.evidence_json || '[]'); } catch (e) { ids = []; }
  const r = restricted(p.id, p.game_id, ids, true);
  if (!r) { nNoEv++; continue; }
  sumEv += r.evs.length; sumCl += r.claims.length;
  const pairs = DET.detectWerewolfContradictions({ format: 'werewolf', events: r.evs, claims: r.claims });
  const h = DET.summarize(pairs);
  sumPairs += pairs.length;
  if (pairs.length > 0) { nWith++; for (const k in h) if (k !== 'total' && h[k]) hist[k] = (hist[k] || 0) + h[k]; }
  else nZero++;
  const b = byLayer[p.layer] = byLayer[p.layer] || { n: 0, w: 0 };
  b.n++; if (pairs.length > 0) b.w++;
}
console.log('preds(wolf)=', preds.length, 'noEvidenceWindow=', nNoEv, 'pairs>0=', nWith, 'pairs=0=', nZero, 'totalPairs=', sumPairs);
console.log('avg evidence events=', (sumEv / Math.max(1, nNoEv === preds.length ? 1 : preds.length - nNoEv)).toFixed(2), 'avg claims=', (sumCl / Math.max(1, preds.length - nNoEv)).toFixed(2));
console.log('rule hist(only nonzero preds)=', JSON.stringify(hist));
console.log('byLayer=', JSON.stringify(byLayer));
// 对照：guard off 是否改变数值
let diff = 0;
for (const p of preds) {
  let ids = []; try { ids = JSON.parse(p.evidence_json || '[]'); } catch (e) {}
  const a = restricted(p.id, p.game_id, ids, true), b = restricted(p.id, p.game_id, ids, false);
  if (!a || !b) continue;
  const pa = DET.detectWerewolfContradictions({ format: 'werewolf', events: a.evs, claims: a.claims });
  const pb = DET.detectWerewolfContradictions({ format: 'werewolf', events: b.evs, claims: b.claims });
  if (JSON.stringify(pa) !== JSON.stringify(pb)) diff++;
}
console.log('guard(game_id) 差异预测数=', diff);
