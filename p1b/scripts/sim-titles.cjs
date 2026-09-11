'use strict';
// 微步 2：sim 题源接入（Q 棒）。每局 3 条 cutoff-safe 模板题→分类→落库→resolve。幂等防重。
const { db } = require('../src/deps');
const { insertPrediction, resolvePrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');
db.init();
const conn0 = db.getConnection();
ensurePredictionsTable(conn0); // 缺省库建 predictions 表（含七审计列 additive 迁移）——与 sim 局同账本
const conn = db.getConnection();

const games = conn.prepare('SELECT id, player_count FROM games WHERE id >= 8 ORDER BY id').all();
const stats = { games: 0, inserted: 0, skipped: 0, resolved: 0, byLayer: {}, outcomeTrue: 0, outcomeFalse: 0 };

for (const g of games) {
  stats.games++;
  const evs = conn.prepare('SELECT id, day, phase, type, actor_seat, raw_text FROM events WHERE game_id = ? ORDER BY seq').all(g.id);
  const endEv = evs.find((e) => e.type === 'system' && e.raw_text.indexOf('游戏结束') !== -1);
  const nightDeath = evs.find((e) => e.type === 'death' && e.day === 1 && e.phase === 'day');
  const voteEv = evs.find((e) => e.type === 'death' && e.phase === 'dusk');
  const wolfWin = endEv ? endEv.raw_text.indexOf('狼人阵营胜利') !== -1 : null;
  const peaceNight = nightDeath ? false : true;
  let maxVotes = null;
  if (voteEv) { const m = voteEv.raw_text.match(/计票：(\{[^}]*\})/); if (m) { try { const o = JSON.parse(m[1]); maxVotes = Math.max.apply(null, Object.values(o)); } catch (e) {} } }

  const titles = [
    { key: 'win', statement: '本局狼人阵营胜利', layer: 'L6', engine: 'structural', outcome: wolfWin === null ? 'ambiguous' : (wolfWin ? 'true' : 'false'), evidence: endEv ? [endEv.id] : [] },
    { key: 'peace', statement: '本局首夜平安（无人死亡）', layer: 'L1', engine: 'proc_calc', outcome: 'false', evidence: nightDeath ? [nightDeath.id] : [] },
    { key: 'votes', statement: '本局放逐投票最高票数 >= 3 票', layer: 'L6', engine: 'structural', outcome: maxVotes === null ? 'ambiguous' : (maxVotes >= 3 ? 'true' : 'false'), evidence: voteEv ? [voteEv.id] : [] },
  ];

  for (const t of titles) {
    const dup = conn.prepare('SELECT id FROM predictions WHERE game_id = ? AND statement = ?').get(g.id, t.statement);
    if (dup) { stats.skipped++; continue; }
    const row = insertPrediction({
      gameId: g.id, day: 0, sourceType: '预测卡', statement: t.statement, prob: 0.5,
      layer: t.layer, engine: t.engine, publicExposure: 0, checklistHash: 'v1', gate: 'descriptive',
    });
    stats.inserted++;
    stats.byLayer[t.layer] = (stats.byLayer[t.layer] || 0) + 1;
    if (t.outcome === 'true' || t.outcome === 'false') {
      resolvePrediction(row.id, t.outcome, '程序结算真值（sim 局）');
      stats.resolved++;
      if (t.outcome === 'true') stats.outcomeTrue++; else stats.outcomeFalse++;
    }
  }
}

console.log('STATS=' + JSON.stringify(stats));
console.log('L0_GATE=' + JSON.stringify(l0Gate()));
db.closeCurrent();