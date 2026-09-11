'use strict';
// 批次1-M1（p15）· A1 三件套之二：90 条 sim 题证据链回填。
// 背景：sim-titles.cjs 写端 bug（L33-36 insertPrediction 漏传 evidence）致库中
// evidence_json 空 90/90（2026-09-12 只读实核，gid 8-37 每局三题）。
// 本脚本按 sim-titles 同逻辑（事件选择/解析逐行对齐其 L15-28）重算三题 evidence 事件 id：
//   默认 dry-run：逐条打印 prediction_id/现值/新值 diff，零写入；
//   --apply：单事务内仅对「现值≠新值」行 UPDATE evidence_json（幂等可重放：重放时
//   changed=0 全跳过；账本不可变规则不受影响——evidence_json 是证据引用元数据，
//   非 resolve 结果，回填对齐 p12 已发表口径经队长裁定）。
// 用法：node scripts/backfill-evidence.cjs [--apply]
const { db } = require('../src/deps');
const { ensurePredictionsTable } = require('../src/db/predictionsStore');

db.init();
const conn = db.getConnection();
ensurePredictionsTable(conn); // 幂等 ensure（与 sim 局同账本；含批次1-M1 tautology 列迁移）
const APPLY = process.argv.indexOf('--apply') !== -1;

// 与 sim-titles.cjs 同逻辑重算每局三题 evidence（win/peace/votes）
const titlesOf = (g) => {
  // 注意（p14 坑位提示）：events.actor_seat 存的是 players.id 而非座位号，读座位号须 LEFT JOIN players 还原；
  // 本脚本三题 evidence 判定只消费 type/day/phase/raw_text（win=system『游戏结束』/peace=day1 death/votes=dusk death 计票），
  // actor_seat 为照抄 sim-titles 查询口径的死列，不参与任何判定。
  const evs = conn.prepare('SELECT id, day, phase, type, actor_seat, raw_text FROM events WHERE game_id = ? ORDER BY seq').all(g.id);
  const endEv = evs.find((e) => e.type === 'system' && e.raw_text.indexOf('游戏结束') !== -1);
  const nightDeath = evs.find((e) => e.type === 'death' && e.day === 1 && e.phase === 'day');
  const voteEv = evs.find((e) => e.type === 'death' && e.phase === 'dusk');
  return [
    { key: 'win', statement: '本局狼人阵营胜利', evidence: endEv ? [endEv.id] : [] },
    { key: 'peace', statement: '本局首夜平安（无人死亡）', evidence: nightDeath ? [nightDeath.id] : [] },
    { key: 'votes', statement: '本局放逐投票最高票数 >= 3 票', evidence: voteEv ? [voteEv.id] : [] },
  ];
};

const games = conn.prepare('SELECT id FROM games WHERE id >= 8 AND id <= 37 ORDER BY id').all();
const stats = { games: games.length, scanned: 0, changed: 0, unchanged: 0, missing: 0 };
const diffRows = [];
const applyStmt = conn.prepare('UPDATE predictions SET evidence_json = ? WHERE id = ?');

const runTx = conn.transaction(() => {
  for (const g of games) {
    for (const t of titlesOf(g)) {
      stats.scanned++;
      const pred = conn.prepare('SELECT id, evidence_json FROM predictions WHERE game_id = ? AND statement = ?').get(g.id, t.statement);
      if (!pred) { stats.missing++; diffRows.push({ game_id: g.id, key: t.key, prediction_id: null, status: 'MISSING' }); continue; }
      const next = JSON.stringify(t.evidence);
      let cur = pred.evidence_json;
      let curNorm = null;
      if (cur !== null && cur !== undefined) { try { curNorm = JSON.stringify(JSON.parse(cur)); } catch (e) { curNorm = String(cur); } }
      const changed = curNorm !== next;
      diffRows.push({ game_id: g.id, key: t.key, prediction_id: pred.id, status: changed ? 'DIFF' : 'SAME', old: cur === undefined ? null : cur, next: next });
      if (changed && APPLY) applyStmt.run(next, pred.id);
      if (changed) stats.changed++; else stats.unchanged++;
    }
  }
});

runTx(); // dry-run 下事务只读扫描（UPDATE 语句不触达）；--apply 时原子提交

const mode = APPLY ? 'APPLY' : 'DRY-RUN';
console.log('MODE=' + mode);
for (const d of diffRows) {
  console.log('[' + d.status + '] game=' + d.game_id + ' key=' + d.key + ' prediction_id=' + d.prediction_id
    + (d.old !== undefined ? ' 现值=' + d.old : '') + (d.next !== undefined ? ' 新值=' + d.next : ''));
}
console.log('STATS=' + JSON.stringify(stats));
console.log(APPLY ? '已提交事务 UPDATE evidence_json（仅 DIFF 行）' : 'dry-run 零写入；确认 diff 后加 --apply 执行（M1 微步禁止 apply）');
db.closeCurrent();
