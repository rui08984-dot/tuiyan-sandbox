'use strict';
/** 微步 3 批量判词 runner（Q 棒）：90 条 sim 预测 × 3 路走生产 verdicts 端点（幂等保首条），
 *  每条完成后 median(implied_prob) 写回 assigned_prob（无抽取值→NULL 如实保留）。进度逐条打印。
 *  p13 批次0.5 修补：①选题 SQL 加 games.source='sim' 域过滤（防 real 真人域卷入）；
 *  ②响应体 errors 数组逐条落 p1b/sim/out/judge-errors.log；③偶数 median 退化注释。 */
const fs = require('fs');
const path = require('path');
const ERR_LOG = path.join(__dirname, '..', 'sim', 'out', 'judge-errors.log');
async function main() {
  process.env.LLM_MOCK = '';
  const { buildServer } = require('../src/server');
  const app = await buildServer({ llmMock: false });
  const { db } = require('../src/deps');
  const conn = db.getConnection();
  // 域过滤（p13 批次0.5）：按 games.source='sim' join 语义过滤（列由 sim-loop additive 加出，
  // _counts.cjs/batch-stats.cjs 同款先例），real 真人对局永不卷入；不硬编码 id 区间——
  // sim 局数增长后区间漂移即漏判/误判。
  const preds = conn.prepare(
    "SELECT pr.id, pr.game_id FROM predictions pr JOIN games g ON g.id = pr.game_id"
    + " WHERE g.source = 'sim' AND pr.layer IN ('L1','L6') ORDER BY pr.id"
  ).all();
  // 烟测支持（批次1-R-A 工程修复）：--limit=N 只取前 N 条预测（选题 SQL/注入链/写回逻辑全不动）
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  const selected = (limit && limit > 0) ? preds.slice(0, limit) : preds;
  if (limit) console.log('LIMIT selected=' + selected.length + '/' + preds.length);
  let done = 0, medianed = 0, nulled = 0;
  for (const p of selected) {
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
    // p13 批次0.5：200 也可能带部分失败（errors 非空=某路生成失败不落库，路由层如实标注），
    // 逐条 append 错误日志（时间戳+pid+prediction_id+variant+error），不再只看 statusCode。
    const body = r.json();
    if (Array.isArray(body.errors) && body.errors.length) {
      fs.mkdirSync(path.dirname(ERR_LOG), { recursive: true });
      for (const err of body.errors) {
        fs.appendFileSync(ERR_LOG, JSON.stringify({
          ts: new Date().toISOString(), pid: process.pid, prediction_id: p.id,
          variant: err && err.prompt_variant, error: err && err.error,
        }) + '\n');
      }
    }
    const vs = conn.prepare('SELECT implied_prob FROM verdicts WHERE prediction_id = ?').all(p.id);
    const ps = vs.map((v) => v.implied_prob).filter((v) => v !== null && v !== undefined).sort((x, y) => x - y);
    let med = null;
    // 偶数分支：路数<3 时 median 退化为算术平均（2 路=(a+b)/2；0 路 med=null 如实保留 NULL）
    if (ps.length) med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
    const { updateAuditFields } = require('../src/db/predictionsStore');
    updateAuditFields(p.id, { baselineBrier: undefined }); // no-op 占位：assigned_prob 单独更新
    conn.prepare('UPDATE predictions SET assigned_prob = ? WHERE id = ?').run(med, p.id);
    if (med === null) nulled++; else medianed++;
    done++;
    if (done % 10 === 0) console.log('PROGRESS ' + done + '/' + selected.length);
  }
  console.log('DONE done=' + done + ' medianed=' + medianed + ' nulled=' + nulled);
  await app.close();
  try { db.closeCurrent(); } catch (e) {}
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack.split('\n')[0] : e)); process.exit(1); });