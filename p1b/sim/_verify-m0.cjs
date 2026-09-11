'use strict';
/** p1b/sim/_verify-m0.cjs —— M0 验收自检：SQL 直查最新 sim 局的 games/events/claims/actions 计数与样例 → out/m0-verify.txt */
const fs = require('fs');
const path = require('path');
const dbApi = require('../../p1a-terminal/src/db.js');
const NL = String.fromCharCode(10);
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const lines = [];
try {
  dbApi.init(path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db'));
  const conn = dbApi.getConnection();
  const g = conn.prepare("SELECT id,name,game_type,player_count,source FROM games WHERE source='sim' ORDER BY id DESC LIMIT 1").get();
  if (!g) throw new Error('无 sim 局');
  lines.push('games: id=' + g.id + ' name=' + g.name + ' type=' + g.game_type + ' n=' + g.player_count + ' source=' + g.source);
  lines.push('events: ' + conn.prepare('SELECT COUNT(*) c FROM events WHERE game_id=?').get(g.id).c);
  lines.push('claims: ' + conn.prepare('SELECT COUNT(*) c FROM claims WHERE event_id IN (SELECT id FROM events WHERE game_id=?)').get(g.id).c);
  lines.push('actions: ' + conn.prepare('SELECT COUNT(*) c FROM actions WHERE event_id IN (SELECT id FROM events WHERE game_id=?)').get(g.id).c);
  const cs = conn.prepare("SELECT seat,subject_seat,predicate,object,extracted_by FROM claims WHERE event_id IN (SELECT id FROM events WHERE game_id=?) LIMIT 5").all(g.id);
  lines.push('claims 样例: ' + JSON.stringify(cs));
  const as = conn.prepare("SELECT seat,action,target_seat FROM actions WHERE event_id IN (SELECT id FROM events WHERE game_id=?) LIMIT 5").all(g.id);
  lines.push('actions 样例: ' + JSON.stringify(as));
  const meta = conn.prepare('SELECT meta FROM games WHERE id=?').get(g.id);
  const m = JSON.parse(meta.meta || '{}');
  lines.push('meta.stage=' + m.stage + ' result=' + (m.truth && m.truth.result) + ' roles=' + JSON.stringify(m.truth && m.truth.roles));
  lines.push('SQL 查回: PASS');
} catch (e) {
  lines.push('VERIFY-FAIL: ' + (e && e.message));
  process.exitCode = 1;
}
fs.writeFileSync(path.join(out, 'm0-verify.txt'), lines.join(NL) + NL);
