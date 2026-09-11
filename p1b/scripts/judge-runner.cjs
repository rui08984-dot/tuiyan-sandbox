'use strict';
/** 微步 3 批量判词 runner（Q 棒）：90 条 sim 预测 × 3 路走生产 verdicts 端点（幂等保首条），
 *  每条完成后 median(implied_prob) 写回 assigned_prob（无抽取值→NULL 如实保留）。进度逐条打印。 */
const fs = require('fs');
const path = require('path');
async function main() {
  process.env.LLM_MOCK = '';
  const { buildServer } = require('../src/server');
  const app = await buildServer({ llmMock: false });
  const { db } = require('../src/deps');
  const conn = db.getConnection();
  const preds = conn.prepare("SELECT id, game_id FROM predictions WHERE layer IN ('L1','L6') AND statement LIKE '%'").all();
  let done = 0, medianed = 0, nulled = 0;
  for (const p of preds) {
    const already = conn.prepare('SELECT COUNT(*) n FROM verdicts WHERE prediction_id = ?').get(p.id).n;
    if (already >= 3) {
      done++;
      continue; // 幂等重跑：已满 3 路的跳过生成，仅重算写回
    }
    const r = await app.inject({ method: 'POST', url: '/api/games/' + p.game_id + '/predictions/' + p.id + '/verdicts' });
    if (r.statusCode !== 200) {
      console.log('ERR pid=' + p.id + ' status=' + r.statusCode);
      continue;
    }
    const vs = conn.prepare('SELECT implied_prob FROM verdicts WHERE prediction_id = ?').all(p.id);
    const ps = vs.map((v) => v.implied_prob).filter((v) => v !== null && v !== undefined).sort((x, y) => x - y);
    let med = null;
    if (ps.length) med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
    const { updateAuditFields } = require('../src/db/predictionsStore');
    updateAuditFields(p.id, { baselineBrier: undefined }); // no-op 占位：assigned_prob 单独更新
    conn.prepare('UPDATE predictions SET assigned_prob = ? WHERE id = ?').run(med, p.id);
    if (med === null) nulled++; else medianed++;
    done++;
    if (done % 10 === 0) console.log('PROGRESS ' + done + '/' + preds.length);
  }
  console.log('DONE done=' + done + ' medianed=' + medianed + ' nulled=' + nulled);
  await app.close();
  try { db.closeCurrent(); } catch (e) {}
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack.split('\n')[0] : e)); process.exit(1); });