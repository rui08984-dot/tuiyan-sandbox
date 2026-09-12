'use strict';
/** 微步 3 批量判词 runner（Q 棒）：90 条 sim 预测 × 3 路走生产 verdicts 端点（幂等保首条），
 *  每条完成后 median(implied_prob) 写回 assigned_prob（无抽取值→NULL 如实保留）。进度逐条打印。
 *  p13 批次0.5 修补：①选题 SQL 加 games.source='sim' 域过滤（防 real 真人域卷入）；
 *  ②响应体 errors 数组逐条落 p1b/sim/out/judge-errors.log；③偶数 median 退化注释。
 *  批次1-R-A：加 --limit=N 烟测参数（选题 SQL/注入链/写回逻辑全不动）。
 *  批次2-M1（R-A 后解冻件）：inject body 带 runId 与 model（tokenrhythm/glm-5.3-flash），verdicts 表按批次指纹分组。
 *  批次2-RB 纠正（溯源污染修复）：runId 改 --runid= 参数显式传入——根因=M1 版硬编码读
 *  PREREG-判词重跑-v1.md 算出 R-A hash（f232e2a54689）污染 R-B 批次；缺省回退旧口径并打 WARN。
 *  批次2-RC M2 范围修正（工程对齐 PREREG-RC §一「题源=v2 360 条」，非判据改动）：
 *  ①选题 SQL 加 checklist_hash='v2'——旧口径 450 条混入 R-A 老域 90 条（checklist v1），
 *  15:04/15:27 两跑实锤把 123 行 R-C 判词烧在 R-A 域（越界残段已归档清除，见
 *  verdicts-archive-rc-oos-20260912.json）；②median 写回改按 runId 批内口径（防跨批混算）。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ERR_LOG = path.join(__dirname, '..', 'sim', 'out', 'judge-errors.log');
const PREREG_MD = path.join(__dirname, '..', '..', '.scratch', 'forecast-debate', 'PREREG-判词重跑-v1.md');
/** 旧口径（缺省回退用）：PREREG-判词重跑-v1.md sha256 前 12 位（排除 `> sha256` 行）；文件缺失→'prereg-missing' */
function calcRunId() {
  try {
    const lines = fs.readFileSync(PREREG_MD, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('> sha256'));
    return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex').slice(0, 12);
  } catch (e) { return 'prereg-missing'; }
}
const runidArg = process.argv.find((a) => a.startsWith('--runid='));
const RUN_ID = (runidArg && runidArg.split('=')[1]) || calcRunId();
const RUN_ID_EXPLICIT = Boolean(runidArg);
const MODEL = 'tokenrhythm/glm-5.3-flash';
async function main() {
  process.env.LLM_MOCK = '';
  const { buildServer } = require('../src/server');
  const app = await buildServer({ llmMock: false });
  const { db } = require('../src/deps');
  const conn = db.getConnection();
  // 域过滤（p13 批次0.5）：按 games.source='sim' join 语义过滤（列由 sim-loop additive 加出，
  // _counts.cjs/batch-stats.cjs 同款先例），real 真人对局永不卷入；不硬编码 id 区间——
  // sim 局数增长后区间漂移即漏判/误判。
  // 批次2-RC 范围修正：checklist_hash='v2' 只取 R-B 模板题域（PREREG-RC §一）；
  // corpus 语料题（checklist 也为 v2）由 g.source='sim' 双重排除；real 真人域永不卷入。
  const preds = conn.prepare(
    "SELECT pr.id, pr.game_id FROM predictions pr JOIN games g ON g.id = pr.game_id"
    + " WHERE g.source = 'sim' AND pr.layer IN ('L1','L6') AND pr.checklist_hash = 'v2' ORDER BY pr.id"
  ).all();
  // 烟测支持（批次1-R-A 工程修复）：--limit=N 只取前 N 条预测（选题 SQL/注入链/写回逻辑全不动）
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  const selected = (limit && limit > 0) ? preds.slice(0, limit) : preds;
  if (limit) console.log('LIMIT selected=' + selected.length + '/' + preds.length);
  // 批次2-RC 并行切片（纯工程提速，判据/选题口径不变）：--slice=K/N 按序取模分片（K∈1..N），
  // 多进程跑不相交子集；幂等由 (pid,variant,temp,runId) 唯一索引兜底；分片参数进日志供对账。
  const sliceArg = process.argv.find((a) => a.startsWith('--slice='));
  let selectedFinal = selected;
  if (sliceArg) {
    const parts = sliceArg.split('=')[1].split('/').map((x) => parseInt(x, 10));
    const k = parts[0], n = parts[1];
    if (!k || !n || k < 1 || k > n) { console.error('BAD --slice=' + sliceArg); process.exit(2); }
    selectedFinal = selected.filter((_, i) => i % n === k - 1);
    console.log('SLICE ' + k + '/' + n + ' selected=' + selectedFinal.length + '/' + selected.length);
  }
  console.log('RUN_ID=' + RUN_ID + (RUN_ID_EXPLICIT ? ' (--runid 显式传入)' : ' (缺省回退旧口径——建议显式 --runid=，防批次指纹污染)'));
  let done = 0, medianed = 0, nulled = 0;
  for (const p of selectedFinal) {
    // 批次2-RC 纠正：幂等按 runId 计数（三批隔离语义——R-B 行不挡 R-C 批生成；
    // 旧口径 COUNT(*) 不分 runId 致 R-C 全量被 R-B 行跳过，pwsh-8 实证 medianed=2 即此）
    const already = conn.prepare('SELECT COUNT(*) n FROM verdicts WHERE prediction_id = ? AND run_id = ?').get(p.id, RUN_ID).n;
    if (already >= 3) {
      done++;
      continue; // 幂等重跑：本 runId 已满 3 路的跳过生成，仅重算写回
    }
    const r = await app.inject({ method: 'POST', url: '/api/games/' + p.game_id + '/predictions/' + p.id + '/verdicts', body: { runId: RUN_ID, model: MODEL } });
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
    // 批次2-RC：写回同样按 runId 批内口径（三批隔离——跨批混算会把 R-B 行混进 R-C 写回；
    // 计分判据读 verdicts.implied_prob 不受此列影响，此处纯簿记）
    const vs = conn.prepare('SELECT implied_prob FROM verdicts WHERE prediction_id = ? AND run_id = ?').all(p.id, RUN_ID);
    const ps = vs.map((v) => v.implied_prob).filter((v) => v !== null && v !== undefined).sort((x, y) => x - y);
    let med = null;
    // 偶数分支：路数<3 时 median 退化为算术平均（2 路=(a+b)/2；0 路 med=null 如实保留 NULL）
    if (ps.length) med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
    const { updateAuditFields } = require('../src/db/predictionsStore');
    updateAuditFields(p.id, { baselineBrier: undefined }); // no-op 占位：assigned_prob 单独更新
    conn.prepare('UPDATE predictions SET assigned_prob = ? WHERE id = ?').run(med, p.id);
    if (med === null) nulled++; else medianed++;
    done++;
    if (done % 10 === 0) console.log('PROGRESS ' + done + '/' + selectedFinal.length);
  }
  console.log('DONE done=' + done + '/' + selectedFinal.length + ' medianed=' + medianed + ' nulled=' + nulled);
  await app.close();
  try { db.closeCurrent(); } catch (e) {}
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack.split('\n')[0] : e)); process.exit(1); });