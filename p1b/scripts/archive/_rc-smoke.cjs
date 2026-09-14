'use strict';
// RC-3 烟测（跑完即删）：L6 型 5 条+proc_calc 型 1 条 × 3 路 live；runId=PREREG-RC hash 前 12 位
const crypto = require('crypto');
const fs = require('fs');
const P = 'E:/music player/.scratch/forecast-debate/PREREG-RC-v1-待确认.md';
const lines = fs.readFileSync(P, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('> sha256'));
const RUN_ID = crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex').slice(0, 12);
const L6_PAT = [/号存活/, /自称平民实为狼/, /第一条公开发言的玩家未被放逐/, /至少有一名狼人获得至少 1 票/, /被放逐者是狼人，且其最高票唯一/];
const PC_PAT = /之差不超过 1 票/; // T3 proc_calc
async function main() {
  process.env.LLM_MOCK = '';
  const { buildServer } = require('../src/server');
  const app = await buildServer({ llmMock: false });
  const { db } = require('../src/deps');
  const conn = db.getConnection();
  const all = conn.prepare("SELECT id, game_id, statement, layer, engine FROM predictions WHERE checklist_hash='v2' ORDER BY id").all();
  const picked = [];
  const l6need = 5, pcneed = 1;
  for (const p of all) {
    if (picked.length < l6need && L6_PAT.some((re) => re.test(p.statement)) && p.layer === 'L6') picked.push(p);
  }
  for (const p of all) { if (picked.length < l6need + pcneed && PC_PAT.test(p.statement) && p.engine === 'proc_calc') { picked.push(p); break; } }
  console.log('RUN_ID=' + RUN_ID + ' 烟测题: ' + picked.map((p) => '#' + p.id + '(' + p.engine + ')').join(','));
  for (const p of picked) {
    const r = await app.inject({ method: 'POST', url: '/api/games/' + p.game_id + '/predictions/' + p.id + '/verdicts', body: { runId: RUN_ID, model: 'tokenrhythm/glm-5.3-flash' } });
    const b = r.json();
    console.log('=== pred#' + p.id + '(' + p.engine + ') status=' + r.statusCode + ' errors=' + b.errors.length);
    for (const s of b.saved) {
      const row = conn.prepare('SELECT verdict_text, run_id, model FROM verdicts WHERE id = ?').get(s.id);
      const t = row.verdict_text;
      const chk = {
        三段_事件: t.indexOf('账本证据引用') !== -1,
        三段_声称: t.indexOf('账本声称记录') !== -1,
        三段_机械: t.indexOf('账本机械统计') !== -1,
        Range: /Range: \d+%\d*%-\d+%/.test(t),
        P行: /P=0\.\d\d\s*$/.test(t.trim()),
        结算泄漏: /计票：\{|游戏结束|被放逐出局/.test(t),
        runId: row.run_id === RUN_ID,
      };
      console.log('  ' + s.prompt_variant + ' P=' + s.implied_prob + ' ' + JSON.stringify(chk));
    }
  }
  await app.close();
  try { db.closeCurrent(); } catch (e) {}
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack.split('\n')[0] : e)); process.exit(1); });
