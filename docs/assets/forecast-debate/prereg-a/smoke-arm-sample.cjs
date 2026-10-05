/* prereg-A 烟测 Q③ 三臂证据离线抽样（零 LLM、只读）——复用跑批脚本同款 loadEvidence+armOpts 路径 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const P1B = path.join(ROOT, 'p1b');
const W = require(path.join(P1B, 'scripts', 'prereg-a-windows.cjs'));
const ps = require(path.join(P1B, 'src', 'db', 'predictionsStore'));
const { loadEvidence, CONTRADICTION_HEAD, SHAM_HEAD } = require(path.join(P1B, 'src', 'routes', 'verdicts'));
const { db } = require(path.join(P1B, 'src', 'deps'));
const conn = db.getConnection();
function armOpts(arm) { return arm === 'B' ? { contradictions: false } : (arm === 'C' ? { contradictionsMode: 'sham' } : {}); }
const PIDS = [92, 91];
for (const pid of PIDS) {
  const pred = ps.getPrediction(pid);
  const ev = conn.prepare('SELECT id, phase FROM events WHERE game_id = ? ORDER BY seq, id').all(pred.game_id);
  const cl = conn.prepare('SELECT c.event_id FROM claims c JOIN events e ON e.id = c.event_id WHERE e.game_id = ?').all(pred.game_id);
  const view = W.cutoffView(ev, cl); // 两参数组签名（与 run 脚本 L88 一致）
  const ids = view.events.map((e) => e.id);
  console.log('=== pid=' + pid + ' window=cutoff events=' + view.events.length + ' ===');
  const lens = {};
  for (const arm of ['A', 'B', 'C']) {
    const evBlock = loadEvidence(pred, Object.assign({ evidenceIds: ids }, armOpts(arm)));
    lens[arm] = evBlock.length;
    const hasReal = evBlock.indexOf(CONTRADICTION_HEAD) !== -1;
    const hasSham = evBlock.indexOf(SHAM_HEAD) !== -1;
    console.log('arm ' + arm + ' len=' + evBlock.length + ' has_real_d=' + hasReal + ' has_sham_d=' + hasSham);
    if (arm === 'A' && hasReal) {
      const i = evBlock.indexOf(CONTRADICTION_HEAD);
      console.log('  A d段摘录: ' + JSON.stringify(evBlock.slice(i, i + 220)));
    }
    if (arm === 'C' && hasSham) {
      const i = evBlock.indexOf(SHAM_HEAD);
      console.log('  C sham摘录: ' + JSON.stringify(evBlock.slice(i, i + 220)));
    }
    if (arm === 'B') console.log('  B 尾部160字: ' + JSON.stringify(evBlock.slice(-160)));
  }
  console.log('len差 A-B=' + (lens.A - lens.B) + ' A-C=' + (lens.A - lens.C));
}
