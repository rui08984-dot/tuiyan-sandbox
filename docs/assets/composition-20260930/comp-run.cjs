'use strict';
/**
 * .scratch/composition-20260930/comp-run.cjs
 * 三种组合契约的**实测台**（不是形状演示）。
 *
 * 隔离（ask 硬要求）：
 *   · 库 = 生产 p1a.db 的一致性副本 sandbox-p1a.db（VACUUM INTO 产出，见 _mksandbox.cjs）
 *   · P1B_LLM_MOCK=1（零网络、零真实 LLM）
 *   · 独立端口 8807（生产是 8787；app.listen 真监听，不是 app.inject 假传输）
 *   · 每次写入带唯一 marker，落库后按 marker 精确清点「本次跑写了几行」
 *
 * 投毒语义：破坏第 k 步的前提 ⇒ 必须停在第 k 步；前 k-1 步的写入**如实清点、不回滚**
 * （账本不可变是硬边界，回滚不了就如实报）。
 */
process.env.P1B_LLM_MOCK = '1';
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const SANDBOX = path.join(__dirname, 'sandbox-p1a.db');
const PROD_DB = path.join(REPO, 'p1a-terminal', 'data', 'p1a.db');

const { buildServer } = require(path.join(REPO, 'p1b', 'src', 'server'));
const { db } = require(path.join(REPO, 'p1b', 'src', 'deps'));
const Database = require(path.join(REPO, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const net = require('net');

/** 动态挑一个空闲端口（8807 起）：本机有一堆 node 进程在跑，固定端口会撞；绝不去 kill 别人的进程。 */
function freePort(from) {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.unref();
    s.on('error', () => { if (from > 8900) rej(new Error('no free port')); else res(freePort(from + 1)); });
    s.listen(from, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

const RUN = 'COMP' + Date.now().toString(36).toUpperCase().slice(-6);
let PORT = 8807;
let BASE = '';
const out = [];
let pass = 0, fail = 0;
const log = (s) => { out.push(s); console.log(s); };
const check = (name, cond, detail) => {
  if (cond) { pass++; log('- PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; log('- FAIL ' + name + (detail ? ' — ' + detail : '')); }
  return !!cond;
};

async function http(method, url, body, headers) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, headers || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, body: j, hdr: Object.fromEntries(res.headers) };
}

/** 只读连接直查沙箱：本次 marker 到底写了几行、写在哪几张表（绕开服务层，如实对账）。 */
let ro = null;
function ledger(marker) {
  if (!ro) ro = new Database(SANDBOX, { readonly: true, fileMustExist: true });
  const like = '%[' + marker + ']%';
  return {
    predictions: ro.prepare('SELECT COUNT(*) n FROM predictions WHERE statement LIKE ?').get(like).n,
    intake_questions: ro.prepare('SELECT COUNT(*) n FROM intake_questions WHERE statement LIKE ?').get(like).n,
    intake_rejects: ro.prepare('SELECT COUNT(*) n FROM intake_rejects WHERE statement LIKE ?').get(like).n,
    verdicts: ro.prepare(
      'SELECT COUNT(*) n FROM verdicts v JOIN predictions p ON p.id=v.prediction_id WHERE p.statement LIKE ?').get(like).n,
    idempotency_keys: ro.prepare('SELECT COUNT(*) n FROM idempotency_keys').get().n,
    // 同一 marker 下已落定的题数（回环第 2 轮的证据）
    resolved: ro.prepare(
      "SELECT COUNT(*) n FROM predictions WHERE statement LIKE ? AND outcome IS NOT NULL").get(like).n,
  };
}
const mk = (tag, text) => '[' + tag + '] ' + text;

/**
 * 步进机：顺序执行。
 *   · 步返回 ok=true            ⇒ 前进
 *   · 步返回 ok=false, stop=false ⇒ **预期的失败**（回溯的扳机：取不到真值就是回溯的入口），
 *                                   不停，继续走"回头"那条边。
 *   · 步返回 ok=false（或 stop=true）⇒ **停**：这才是投毒/前提不成立。
 * 停下来之后立刻清点前序写入，如实报告、**不回滚**（账本不可变是硬边界）。
 */
async function runSteps(title, steps, tag) {
  log('');
  log('### ' + title + '  （marker=' + tag + '）');
  const trace = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    let r;
    try { r = await s.run(); } catch (e) { r = { ok: false, stop: true, transport_error: String(e && e.message) }; }
    if (!r) r = { ok: false, stop: true };
    if (r.stop === undefined) r.stop = !r.ok;
    trace.push({ step: s.id, name: s.name, ok: !!r.ok, trigger: !!r.trigger, got: r });
    const label = r.ok ? 'OK' : (r.stop ? 'STOP' : 'TRIGGER→回溯边');
    log('  步 ' + s.id + ' ' + s.name + ' ⇒ ' + label
      + '  ' + JSON.stringify(r.summary !== undefined ? r.summary : r).slice(0, 400));
    if (r.stop) {
      const after = ledger(tag);
      log('  ⇒ 停在第 ' + s.id + ' 步。**前序写入如实清点（不回滚）**：' + JSON.stringify(after));
      return { title, outcome: 'stopped_at_' + s.id, stoppedAt: s.id, trace, writes: after };
    }
  }
  const after = ledger(tag);
  log('  ⇒ 走通。写入清点：' + JSON.stringify(after));
  return { title, outcome: 'completed', stoppedAt: null, trace, writes: after };
}

// 通用 checklist（全否 = 哪个层都不绿）
const ckFlat = (o) => Object.assign({
  Q0_1: true, Q0_2: true, Q0_3: true,
  L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
  L3: [false, false, false, false], L2: [false, false, false, false], L4: [false, false, false],
}, o || {});

async function main() {
  // 每次跑都重建沙箱副本：否则上一轮写进去的行会污染本轮的清点（实测踩过：intake_questions 数到 2）。
  // VACUUM INTO ＝ 一致性快照（含 WAL 内容），源库只读打开 ⇒ 生产库零写。
  if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX);
  {
    const src = new Database(PROD_DB, { readonly: true, fileMustExist: true });
    src.prepare('VACUUM INTO ?').run(SANDBOX);
    src.close();
  }
  log('# 能力图 × 三种组合契约 —— 实测台（RUN=' + RUN + '）');
  log('- 沙箱库：' + SANDBOX);
  log('- 生产库：' + PROD_DB + '（本脚本**不打开**它）');
  log('- 端口：动态分配（生产 8787）；P1B_LLM_MOCK=1 零真实 LLM');
  check('沙箱库 ≠ 生产库', SANDBOX !== PROD_DB);

  PORT = await freePort(8807);
  BASE = 'http://127.0.0.1:' + PORT;
  const providersPath = path.join(__dirname, 'providers-' + RUN + '.json');
  const app = await buildServer({ dbPath: SANDBOX, llmMock: true, providersPath, listenConfig: { host: '127.0.0.1', port: PORT, token: '', exposed: false, requiresToken: false } });
  await app.listen({ host: '127.0.0.1', port: PORT });
  log('- 服务已起：' + BASE + '（真监听）');

  const health = await http('GET', '/api/health');
  log('- /api/health ⇒ ' + health.status + ' db=' + JSON.stringify(health.body && health.body.db));
  check('服务在独立端口上真响应', health.status === 200);

  // ─────────────────────────────────────────────────────────────
  // 组合① 直线：归层 → 取值 → 记账（★拒收门是归层内部的分支，不是独立一步 —— 见文档）
  // ─────────────────────────────────────────────────────────────
  log('');
  log('## 组合① 直线（Straight line）');

  const S1 = (tag, stmt, spec, ck) => async () => {
    const r = await http('POST', '/api/intake/classify', { statement: mk(tag, stmt), resolve_spec: spec, checklist: ck });
    const b = r.body || {};
    return {
      ok: r.status === 200 && b.rejected === false,
      rejected: b.rejected, reason: b.reason, layer: b.layer, secondary: b.secondary,
      engine: b.engine, gate: b.gate, intake_question_id: b.intake_question_id,
      matures_at: b.matures_at, reject_id: b.reject_id,
      summary: { status: r.status, rejected: b.rejected, reason: b.reason, layer: b.layer, gate: b.gate },
    };
  };
  // ★取值步的"成功"判据 = **拿到了可用的数**（b.enough），不是 HTTP 200，也不是返回体的 ok。
  //   实测坑：routes/baseline.js:142 的 buildReading 三态（enough/too_thin/no_rows）**一律返回 ok:true**
  //   ⇒ 只看 ok 的 AI 调用方会在 n=0 时以为拿到了读数。真信号是 enough/state。
  const S2baseline = (kind) => async () => {
    const r = await http('GET', '/api/baseline/' + encodeURIComponent(kind));
    const b = r.body || {};
    return { ok: r.status === 200 && b.enough === true, http_status: r.status, body_ok: b.ok, state: b.state, enough: b.enough, n: b.n, k: b.k, interval: b.interval, why: b.why || b.reason, summary: { http: r.status, body_ok: b.ok, enough: b.enough, state: b.state, n: b.n } };
  };
  const S2engine = (tag) => async () => {
    const r = await http('GET', '/api/predictions/unresolved?limit=100');
    const b = r.body || {};
    const mine = (b.items || []).filter(x => String(x.statement || '').indexOf('[' + tag + ']') === 0);
    return { ok: r.status === 200, page_n: (b.items || []).length, mine_seen: mine.length, by_scope: b.by_scope, summary: { status: r.status, page: (b.items || []).length, mine: mine.length } };
  };
  const S3write = (tag, stmt, spec, prob, extra, idemKey) => async () => {
    const r = await http('POST', '/api/predictions', Object.assign({
      statement: mk(tag, stmt), resolve_spec: spec, prob,
    }, extra || {}), idemKey ? { 'Idempotency-Key': idemKey } : null);
    const b = r.body || {};
    return {
      ok: r.status === 201 && typeof b.id === 'number',
      status: r.status, id: b.id, error: b.error, idem: b.idempotency && { provided: b.idempotency.provided, replayed: b.idempotency.replayed },
      idem_status_hdr: r.hdr['idempotency-status'],
      summary: { status: r.status, id: b.id, error: b.error ? String(b.error).slice(0, 120) : null },
    };
  };
  const SPEC_OK = { kind: 'openmeteo_daily_max', lat: 31.23, lon: 121.47, date: '2026-09-20', threshold_c: 30, cmp: 'gt' };

  // no_rows 用的 kind：**在支持表里、但账本里一道都没有**（实测筛出来的，不是猜的）。
  const ABSENT_KIND = (() => {
    if (!ro) ro = new Database(SANDBOX, { readonly: true, fileMustExist: true });
    const { REVEAL_CLASS } = require(path.join(REPO, 'p1b', 'src', 'evidence', 'revealClass.js'));
    const have = new Set(ro.prepare("SELECT DISTINCT json_extract(evidence_json,'$[0].resolve.kind') k FROM predictions").all().map(r => r.k));
    const miss = Object.keys(REVEAL_CLASS).filter(k => !have.has(k));
    return miss[0] || null;
  })();
  log('- no_rows 用 kind：' + ABSENT_KIND);

  const c1 = await runSteps('①-0 正常直线', [
    { id: 'S1', name: '归层（内含拒收门）', run: S1('C1OK', '上海 2026-09-20 日最高气温 > 30°C', SPEC_OK, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '取值（诚实区间）', run: S2baseline('openmeteo_daily_max') },
    { id: 'S3', name: '记账（写账本）', run: S3write('C1OK', '上海 2026-09-20 日最高气温 > 30°C', SPEC_OK, 0.35, { layer: 'L3', engine: 'stat_baseline' }) },
  ], 'C1OK');
  check('① 正常直线走通', c1.outcome === 'completed');
  check('① 写进账本 1 行', c1.writes.predictions === 1, 'predictions=' + c1.writes.predictions);
  check('① 接题层留痕 1 行', c1.writes.intake_questions === 1, 'intake_questions=' + c1.writes.intake_questions);

  // 投毒 S1：破坏拒收门（Q0-1 真值锚 = 否）
  const c1p1 = await runSteps('①-P1 破坏 S1 前提：拒收门 Q0-1 答否', [
    { id: 'S1', name: '归层（内含拒收门）', run: S1('C1P1', '没有任何真值锚的题', SPEC_OK, ckFlat({ Q0_1: false, L3: [true, true, true, true] })) },
    { id: 'S2', name: '取值（诚实区间）', run: S2baseline('openmeteo_daily_max') },
    { id: 'S3', name: '记账（写账本）', run: S3write('C1P1', '没有任何真值锚的题', SPEC_OK, 0.35) },
  ], 'C1P1');
  check('①-P1 停在 S1（拒收门）', c1p1.outcome === 'stopped_at_S1');
  check('①-P1 账本零行（拒收不进 predictions）', c1p1.writes.predictions === 0, 'predictions=' + c1p1.writes.predictions);
  check('①-P1 拒收**留痕**（intake_rejects 有行，不静默）', c1p1.writes.intake_rejects === 1, 'intake_rejects=' + c1p1.writes.intake_rejects);
  check('①-P1 拒收原因=no_anchor', c1p1.trace[0].got.reason === 'no_anchor', String(c1p1.trace[0].got.reason));

  // 投毒 S2：破坏取值前提（换一个账本里一道都没有的 kind）
  const c1p2 = await runSteps('①-P2 破坏 S2 前提：同类题 n=0（账本里没这一类）', [
    { id: 'S1', name: '归层（内含拒收门）', run: S1('C1P2', '一个账本里没有历史同类题的问题', SPEC_OK, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '取值（诚实区间）', run: S2baseline(ABSENT_KIND) },
    { id: 'S3', name: '记账（写账本）', run: S3write('C1P2', '一个账本里没有历史同类题的问题', SPEC_OK, 0.35) },
  ], 'C1P2');
  check('①-P2 停在 S2（取值给不出数）', c1p2.outcome === 'stopped_at_S2');
  check('①-P2 停下原因=no_rows（不是"样本不足"）', c1p2.trace[1].got.state === 'no_rows', String(c1p2.trace[1].got.state));
  check('①-P2 ★S1 的写入仍在、如实报告', c1p2.writes.intake_questions === 1 && c1p2.writes.predictions === 0,
    'intake_questions=' + c1p2.writes.intake_questions + ' predictions=' + c1p2.writes.predictions);

  // 投毒 S2'：同类题太少（too_thin），n<30 纪律
  const thinKind = (() => {
    if (!ro) ro = new Database(SANDBOX, { readonly: true });
    const r = ro.prepare("SELECT json_extract(evidence_json,'$[0].resolve.kind') k, COUNT(*) n FROM predictions"
      + " WHERE outcome IN ('true','false') GROUP BY k HAVING n>0 AND n<30 ORDER BY n DESC LIMIT 1").get();
    return r ? r.k : null;
  })();
  log('- 薄样本 kind（0<n<30）：' + thinKind);
  const c1p2b = await runSteps('①-P2b 破坏 S2 前提：同类题 ' + (thinKind || '(无)') + ' 有数但 <30', [
    { id: 'S1', name: '归层（内含拒收门）', run: S1('C1P2B', '薄样本层的取值', SPEC_OK, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '取值（诚实区间）', run: thinKind ? S2baseline(thinKind) : async () => ({ ok: false, state: 'skip' }) },
    { id: 'S3', name: '记账（写账本）', run: S3write('C1P2B', '薄样本层的取值', SPEC_OK, 0.35) },
  ], 'C1P2B');
  check('①-P2b 停在 S2（too_thin 不给数）', c1p2b.outcome === 'stopped_at_S2' && c1p2b.trace[1].got.state === 'too_thin',
    'state=' + c1p2b.trace[1].got.state + ' n=' + c1p2b.trace[1].got.n);

  // 投毒 S3：破坏记账前提（口语概率）
  const c1p3 = await runSteps('①-P3 破坏 S3 前提：口语概率「大概率」', [
    { id: 'S1', name: '归层（内含拒收门）', run: S1('C1P3', '口语概率题', SPEC_OK, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '取值（诚实区间）', run: S2baseline('openmeteo_daily_max') },
    { id: 'S3', name: '记账（写账本）', run: S3write('C1P3', '口语概率题', SPEC_OK, '大概率') },
  ], 'C1P3');
  check('①-P3 停在 S3（400 拒收口语）', c1p3.outcome === 'stopped_at_S3' && c1p3.trace[2].got.status === 400,
    'status=' + c1p3.trace[2].got.status);
  check('①-P3 ★前两步写入仍在、如实报告', c1p3.writes.intake_questions === 1 && c1p3.writes.predictions === 0,
    'intake_questions=' + c1p3.writes.intake_questions + ' predictions=' + c1p3.writes.predictions);

  // ─────────────────────────────────────────────────────────────
  // 组合② 回溯：归层 → 取不到真值 → 退回调层/换源重试
  // ─────────────────────────────────────────────────────────────
  log('');
  log('## 组合② 回溯（Backtrack）');

  // ★按 tag **在运行那一刻**查 id（不是建数组时查）：建数组时那条题还不存在，查出来是空 ⇒ 0 ⇒ 404。
  // mode='trigger'：这一步**预期失败**——「取不到真值」正是回溯的入口，不是停机理由。
  const S2resolve = (tag, outcome, note, mode) => async () => {
    const ids = await ledgerIds(tag);
    const id = ids[0] || 0;
    const r = await http('POST', '/api/predictions/' + id + '/resolve', { outcome, note });
    const b = r.body || {};
    const got = r.status === 200;
    return {
      ok: got, stop: (mode === 'trigger') ? false : !got,
      trigger: (!got && mode === 'trigger') ? 'truth_unavailable' : null,
      pid: id, status: r.status, error: b.error, due_note: b.due_note,
      summary: { pid: id, status: r.status, ok: got, error: b.error ? String(b.error).slice(0, 90) : null },
    };
  };
  const S3reveal = (tag) => async () => {
    const r = await http('GET', '/api/disclosure/resolve-queue');
    const b = r.body || {};
    return { ok: r.status === 200, counts: b.counts, open_total: b.open_total, summary: { status: r.status, counts: b.counts, open_total: b.open_total } };
  };
  // 换层重试：decided_layer 覆盖机判（intake.js:363 的人工定层口）
  const S4reclass = (tag, stmt, spec, ck, decided) => async () => {
    const r = await http('POST', '/api/intake/classify', { statement: mk(tag, stmt), resolve_spec: spec, checklist: ck, decided_layer: decided });
    const b = r.body || {};
    return { ok: r.status === 200 && b.rejected === false, status: r.status, layer: b.layer, decided: b.decided, engine: b.engine, gate: b.gate, rejected: b.rejected, reason: b.reason, summary: { status: r.status, layer: b.layer, rejected: b.rejected } };
  };

  // 正常回溯：L3 归层 → 题未到期取不到真值 → 揭晓分流判 ok → 换源重试成另一道题
  const SPEC_FUTURE = { kind: 'openmeteo_daily_max', lat: 31.23, lon: 121.47, date: '2026-12-20', threshold_c: 30, cmp: 'gt' };
  const c2 = await runSteps('②-0 正常回溯（换源重试）', [
    { id: 'S1', name: '归层 L3', run: S1('C2OK', '上海 2026-12-20 日最高气温 > 30°C（未到期）', SPEC_FUTURE, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '记初判（题入账）', run: S3write('C2OK', '上海 2026-12-20 日最高气温 > 30°C（未到期）', SPEC_FUTURE, 0.40, { layer: 'L3', engine: 'stat_baseline' }) },
    { id: 'S3', name: '取真值（取不到 ⇒ 回溯扳机，不停）', run: S2resolve('C2OK', 'true', '试图提前落定', 'trigger') },
    { id: 'S4', name: '揭晓分流（能不能自动查）', run: S3reveal('C2OK') },
    { id: 'S5', name: '回溯：换层重归 + 换源另记一条', run: async () => {
      const a = await S4reclass('C2OK', '上海 2026-12-20 日最高气温 > 30°C（改按 L2 基率）', SPEC_FUTURE, ckFlat({ L2: [true, true, true, true] }), 'L2')();
      if (!a.ok) return a;
      const b2 = await S3write('C2OK', '上海 2026-12-20 日最高气温 > 30°C（改按 L2 基率·新题）', SPEC_FUTURE, 0.55, { layer: 'L2', engine: 'stat_baseline' })();
      return { ok: b2.ok, reclass: a, write: b2, summary: { reclass_layer: a.layer, new_id: b2.id } };
    } },
  ], 'C2OK');
  check('② 走通到 S5', c2.outcome === 'completed', c2.outcome);
  check('② 回溯=追加新题，旧题**未被改写**（账本 2 行）', c2.writes.predictions === 2, 'predictions=' + c2.writes.predictions);
  check('② 旧题仍挂在未落定清单里（无作废口）', c2.writes.resolved === 0, 'resolved=' + c2.writes.resolved);

  // 投毒 S3：到期闸（题未到期却硬要落定）
  const c2p3 = await runSteps('②-P3 破坏 S3 前提：题未到期硬要真值', [
    { id: 'S1', name: '归层 L3', run: S1('C2P3', '未到期题硬结算', SPEC_FUTURE, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '记初判（题入账）', run: S3write('C2P3', '未到期题硬结算', SPEC_FUTURE, 0.40, { layer: 'L3' }) },
    { id: 'S3', name: '取真值（未到期 ⇒ 必须拒）', run: S2resolve('C2P3', 'true', '硬落定') },
    { id: 'S4', name: '揭晓分流', run: S3reveal('C2P3') },
  ], 'C2P3');
  check('②-P3 停在 S3（409 未到期）', c2p3.outcome === 'stopped_at_S3' && c2p3.trace[2] && c2p3.trace[2].got.status === 409,
    'status=' + c2p3.trace[2].got.status);
  check('②-P3 ★前两步写入仍在、如实报告', c2p3.writes.predictions === 1 && c2p3.writes.intake_questions === 1,
    'predictions=' + c2p3.writes.predictions + ' intake_questions=' + c2p3.writes.intake_questions);

  // 投毒 S3b：已落定再改（账本不可变）
  const c2p3b = await runSteps('②-P3b 破坏 S3 前提：已落定再改一次（账本不可变）', [
    { id: 'S1', name: '归层 L3', run: S1('C2P3B', '到期题正常落定', { kind: 'openmeteo_daily_max', lat: 31.23, lon: 121.47, date: '2026-09-20', threshold_c: 30, cmp: 'gt' }, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '记初判', run: S3write('C2P3B', '到期题正常落定', { kind: 'openmeteo_daily_max', lat: 31.23, lon: 121.47, date: '2026-09-20', threshold_c: 30, cmp: 'gt' }, 0.40, { layer: 'L3' }) },
    { id: 'S3', name: '第一次落定（应成功）', run: S2resolve('C2P3B', 'true', '首次落定') },
    { id: 'S4', name: '第二次改判（应 409）', run: S2resolve('C2P3B', 'false', '想改判') },
  ], 'C2P3B');
  check('②-P3b 停在 S4（已落定拒改 409）', c2p3b.outcome === 'stopped_at_S4' && c2p3b.trace[3] && c2p3b.trace[3].got.status === 409,
    'status=' + c2p3b.trace[3].got.status);
  check('②-P3b 真值没被第二次改掉', (ro.prepare("SELECT outcome FROM predictions WHERE statement LIKE '%[C2P3B]%'").get() || {}).outcome === 'true');

  // 投毒 S5：回溯重归层给非法层
  const c2p5 = await runSteps('②-P5 破坏 S5 前提：decided_layer 非法（L4 不可作 primary）', [
    { id: 'S1', name: '归层 L3', run: S1('C2P5', '换层重归给非法层', SPEC_FUTURE, ckFlat({ L3: [true, true, true, true] })) },
    { id: 'S2', name: '记初判', run: S3write('C2P5', '换层重归给非法层', SPEC_FUTURE, 0.40, { layer: 'L3' }) },
    { id: 'S3', name: '取真值（取不到 ⇒ 回溯扳机，不停）', run: S2resolve('C2P5', 'true', 'x', 'trigger') },
    { id: 'S4', name: '揭晓分流', run: S3reveal('C2P5') },
    { id: 'S5', name: '回溯重归层（decided_layer=L4 ⇒ 必须拒）', run: S4reclass('C2P5', '换层重归给非法层', SPEC_FUTURE, ckFlat({ L4: [true, true, true] }), 'L4') },
  ], 'C2P5');
  check('②-P5 停在 S5（400 非法 primary 层）', c2p5.outcome === 'stopped_at_S5' && c2p5.trace[4] && c2p5.trace[4].got.status === 400,
    'status=' + c2p5.trace[4].got.status);
  check('②-P5 ★前序写入仍在、如实报告', c2p5.writes.predictions === 1, 'predictions=' + c2p5.writes.predictions);

  // ─────────────────────────────────────────────────────────────
  // 组合③ 回环：记一道 → 结算 → 打分 → 发现偏差 → 回写一条新判断 → 再记
  // ─────────────────────────────────────────────────────────────
  log('');
  log('## 组合③ 回环（Loop）');

  const S3score = (tag) => async () => {
    const cal = await http('GET', '/api/predictions/calibration');
    const kpi = await http('GET', '/api/audit/g2-kpi');
    const hab = await http('GET', '/api/disclosure/habits');
    return {
      ok: cal.status === 200 && kpi.status === 200,
      calib_n: cal.body && cal.body.n, calib_status: cal.body && cal.body.status,
      layer_brier: kpi.body && kpi.body.layer_brier_ci,
      habits_status: hab.status,
      habits: hab.body && hab.body.habits,
      summary: { calib_status: cal.body && cal.body.status, calib_n: cal.body && cal.body.n, habits_status: hab.status, habit_rows: hab.body && hab.body.habits ? hab.body.habits.length : null },
    };
  };
  // 本次 marker 下 L3 的 Brier（自己算，因为 /api/audit/g2-kpi 是**全库**口径不含本次新增）
  const myBrier = (tag, layer) => {
    if (!ro) ro = new Database(SANDBOX, { readonly: true });
    const r = ro.prepare("SELECT COUNT(*) n, AVG((assigned_prob-(outcome='true'))*(assigned_prob-(outcome='true'))) b"
      + " FROM predictions WHERE statement LIKE ? AND outcome IN ('true','false') AND layer=?").get('%[' + tag + ']%', layer);
    return { n: r.n, brier: r.b === null ? null : Number(r.b.toFixed(6)) };
  };

  const SPEC_DUE = { kind: 'openmeteo_daily_max', lat: 31.23, lon: 121.47, date: '2026-09-20', threshold_c: 30, cmp: 'gt' };
  const loopTag = 'C3OK';
  const c3trace = [];
  let c3rounds = [];
  for (let round = 1; round <= 3; round++) {
    const tag = loopTag + 'R' + round;
    const prob = round === 1 ? 0.85 : (round === 2 ? 0.55 : 0.40); // 偏差越大越往 0.5 收
    const res = await runSteps('③ 第 ' + round + ' 轮', [
      { id: 'S1', name: '记一道（第 ' + round + ' 轮判断）', run: S3write(tag, '回环第 ' + round + ' 轮：上海 2026-09-20 日最高气温 > 30°C', SPEC_DUE, prob, { layer: 'L3', engine: 'stat_baseline' }, 'loop-' + RUN + '-r' + round) },
      { id: 'S2', name: '结算（真值=false）', run: S2resolve(tag, 'false', '回环第 ' + round + ' 轮：真值为假') },
      { id: 'S3', name: '打分（分层 Brier + 偏差归并）', run: S3score(tag) },
      { id: 'S4', name: '偏差检测（这一轮 Brier）', run: async () => {
        const b = myBrier(tag, 'L3');
        return { ok: true, round: round, my_n: b.n, my_brier: b.brier, summary: { round: round, n: b.n, brier: b.brier } };
      } },
    ], tag);
    c3trace.push(res);
    c3rounds.push({ round: round, prob: prob, b: myBrier(tag, 'L3'), outcome: res.outcome, pid: (res.trace[0].got || {}).id });
    if (res.outcome !== 'completed') break;
  }
  log('');
  log('  ③ 逐轮读数：' + JSON.stringify(c3rounds));
  const bs = c3rounds.map(r => r.b.brier).filter(x => x !== null);
  const deltas = [];
  for (let i = 1; i < bs.length; i++) deltas.push(Number((bs[i] - bs[i - 1]).toFixed(6)));
  log('  ③ 轮间 Brier Δ：' + JSON.stringify(deltas) + '（负=变小=在收敛）');
  const conv = evaluateConvergence(c3rounds, deltas);
  log('  ③ 收敛判定：' + JSON.stringify(conv));
  check('③ 回环跑满 3 轮且每轮都落一条新判断', c3rounds.length === 3 && c3rounds.every(r => r.outcome === 'completed'),
    'rounds=' + c3rounds.length);
  check('③ 每轮一条新题、旧题一题不改（累计 3 行）', c3rounds.reduce((a, r) => a + (r.outcome === 'completed' ? 1 : 0), 0) === 3,
    'rows=' + c3rounds.length);
  check('③ 收敛条件可判定（不是"一直转"）', conv.converged === true, JSON.stringify(conv.reason));

  // 投毒 S1：口语概率
  const c3p1 = await runSteps('③-P1 破坏 S1 前提：回环写回时给了口语概率', [
    { id: 'S1', name: '记一道（口语概率）', run: S3write('C3P1', '回环投毒：口语', SPEC_DUE, '有点悬', { layer: 'L3' }) },
    { id: 'S2', name: '结算', run: S2resolve('C3P1', 'false', 'x') },
    { id: 'S3', name: '打分', run: S3score('C3P1') },
  ], 'C3P1');
  check('③-P1 停在 S1（400）', c3p1.outcome === 'stopped_at_S1' && c3p1.trace[0].got.status === 400, 'status=' + c3p1.trace[0].got.status);
  check('③-P1 账本零行（写不进就没得回滚）', c3p1.writes.predictions === 0, 'predictions=' + c3p1.writes.predictions);

  // 投毒 S2：未到期硬结算
  const c3p2 = await runSteps('③-P2 破坏 S2 前提：回环第 2 轮结算时题未到期', [
    { id: 'S1', name: '记一道（到期日推到未来）', run: S3write('C3P2', '回环投毒：未到期', SPEC_FUTURE, 0.6, { layer: 'L3' }) },
    { id: 'S2', name: '结算（未到期 ⇒ 必须拒）', run: S2resolve('C3P2', 'false', 'x') },
    { id: 'S3', name: '打分', run: S3score('C3P2') },
  ], 'C3P2');
  check('③-P2 停在 S2（409）', c3p2.outcome === 'stopped_at_S2' && c3p2.trace[1].got.status === 409, 'status=' + c3p2.trace[1].got.status);
  check('③-P2 ★第 1 轮的题已落库、如实报告、不回滚', c3p2.writes.predictions === 1, 'predictions=' + c3p2.writes.predictions);

  // 投毒 S3：**本轮自己新增的样本**不足 30 ⇒ 打分给不出能支撑回写的结论 ⇒ 必须停在这儿。
  // ★为什么用"本轮 marker 口径"而不是"换一个冷门层"：实测冷门层也不冷门（L6 已有 271 行，
  //   全库口径照样 n≥30、照样给区间）——那证明不了回环的真实约束。回环真正的约束是：
  //   **一条新判断永远只有 n=1，n<30 纪律下它自己那条永远给不出结论**。这条约束是真的。
  const c3p3 = await runSteps('③-P3 破坏 S3 前提：本轮新增样本 n=1 < 30，打分给不出可回写的结论', [
    { id: 'S1', name: '记一道', run: S3write('C3P3', '回环投毒：单条样本', SPEC_DUE, 0.5, { layer: 'L3' }) },
    { id: 'S2', name: '结算', run: S2resolve('C3P3', 'false', 'x') },
    { id: 'S3', name: '打分（本轮 n=1 ⇒ 不足 MIN_N=30，不给结论）', run: async () => {
      const mine = myBrier('C3P3', 'L3');
      const { MIN_N } = require(path.join(REPO, 'p1b', 'src', 'engines', 'l2_baseline.js'));
      const gaveConclusion = mine.n >= MIN_N;
      return { ok: gaveConclusion, my_n: mine.n, min_n: MIN_N, my_brier: mine.b,
        summary: { 本轮n: mine.n, MIN_N: MIN_N, 能否据此回写: gaveConclusion } };
    } },
    { id: 'S4', name: '按偏差回写新判断', run: S3write('C3P3', '回环投毒：不该发生的回写', SPEC_DUE, 0.45, { layer: 'L3' }) },
  ], 'C3P3');
  check('③-P3 停在 S3（本轮 n<30 ⇒ 不许回写）', c3p3.outcome === 'stopped_at_S3', c3p3.outcome);
  check('③-P3 ★S1/S2 的写入仍在、如实报告', c3p3.writes.predictions === 1, 'predictions=' + c3p3.writes.predictions);

  // 回环专用：幂等重放（AI 客户端默认重试 ⇒ 回环最典型的污染源）
  const idemTag = 'C3IDEM';
  const k1 = 'loop-idem-' + RUN;
  const i1 = await S3write(idemTag, '回环幂等：同一个键写两次', SPEC_DUE, 0.5, { layer: 'L3' }, k1)();
  const i2 = await S3write(idemTag, '回环幂等：同一个键写两次', SPEC_DUE, 0.5, { layer: 'L3' }, k1)();
  const i3 = await S3write(idemTag, '回环幂等：同一个键换个请求体', SPEC_DUE, 0.7, { layer: 'L3' }, k1)();
  log('');
  log('  ③ 幂等三连（同键同体／同键同体重放／同键异体）：');
  log('    1) ' + i1.status + ' id=' + i1.id + ' hdr=' + i1.idem_status_hdr);
  log('    2) ' + i2.status + ' id=' + i2.id + ' hdr=' + i2.idem_status_hdr);
  log('    3) ' + i3.status + ' id=' + i3.id + ' err=' + String(i3.error || '').slice(0, 60));
  check('③ 幂等：重放返回同一个 id、不多写', i1.ok && i2.ok && i1.id === i2.id && ledger(idemTag).predictions === 1,
    'id1=' + i1.id + ' id2=' + i2.id + ' rows=' + ledger(idemTag).predictions);
  check('③ 幂等：同键异体 409 拒', i3.status === 409, 'status=' + i3.status);
  // 不带键的老调用方
  const i4 = await S3write(idemTag, '回环幂等：不带键的老调用方', SPEC_DUE, 0.5, { layer: 'L3' }, null)();
  log('    4) 不带键：' + i4.status + ' id=' + i4.id + ' hdr=' + i4.idem_status_hdr);
  check('③ 不带键的老调用方照写（不静默改成拒绝）', i4.status === 201 && ledger(idemTag).predictions === 2,
    'rows=' + ledger(idemTag).predictions);

  // ─────────────────────────────────────────────────────────────
  // 附：判词节点（verdicts）—— 三组合里没有它，但它是能力图上的一个节点，
  //     图上不许留「只读过没跑过」的节点，所以单独打一发（含它自己的时序闸投毒）。
  // ─────────────────────────────────────────────────────────────
  log('');
  log('## 附：判词节点（POST verdicts，LLM mock）');
  const vTag = 'VRT';
  // ① 未结算的题 ⇒ 判词可写
  const vw = await S3write(vTag, '判词探针：未结算题', SPEC_FUTURE, 0.5, { layer: 'L3' })();
  const containerId = (ro.prepare("SELECT game_id FROM predictions WHERE id=?").get(vw.id) || {}).game_id;
  const vPost = async (pid) => {
    const r = await http('POST', '/api/games/' + containerId + '/predictions/' + pid + '/verdicts', {});
    const b = r.body || {};
    return { status: r.status, saved: (b.saved || []).length, variants: (b.saved || []).map(x => x.prompt_variant), errors: (b.errors || []).length, error: b.error };
  };
  const v1 = await vPost(vw.id);
  log('  ① 未结算题生成判词 ⇒ ' + JSON.stringify(v1));
  check('判词·未结算可写（三路变体）', v1.status === 200 && v1.saved === 3, JSON.stringify({ st: v1.status, n: v1.saved }));
  const vrows = ledger(vTag);
  log('  ① 判词落库清点：' + JSON.stringify(vrows));
  check('判词落 verdicts 表', vrows.verdicts === 3, 'verdicts=' + vrows.verdicts);

  // ② 先结算再生成判词 ⇒ 409（防泄漏闸：那是拿着答案回头看）
  const vw2 = await S3write(vTag, '判词探针：同秒结算后要判词', SPEC_DUE, 0.5, { layer: 'L3' })();
  const rs2 = await http('POST', '/api/predictions/' + vw2.id + '/resolve', { outcome: 'false', note: '先结算' });
  const v2same = await vPost(vw2.id);   // ★与结算**同一秒**内要判词
  log('  ②a 结算(' + rs2.status + ')后**同秒**要判词 ⇒ ' + JSON.stringify({ status: v2same.status, saved: v2same.saved }));

  const vw3 = await S3write(vTag, '判词探针：隔秒结算后要判词', SPEC_DUE, 0.5, { layer: 'L3' })();
  const rs3 = await http('POST', '/api/predictions/' + vw3.id + '/resolve', { outcome: 'false', note: '先结算' });
  await new Promise(r => setTimeout(r, 2500));            // ★跨过秒界
  const v3 = await vPost(vw3.id);
  log('  ②b 结算(' + rs3.status + ')后**隔 2.5 秒**要判词 ⇒ ' + JSON.stringify({ status: v3.status, saved: v3.saved, error: v3.error ? String(v3.error).slice(0, 80) : null }));

  const vrows2 = ledger(vTag);
  log('  ② 全部清点（★结算写入仍在、判词按闸分流）：' + JSON.stringify(vrows2));
  check('判词探针·两条都结算成功', rs2.status === 200 && rs3.status === 200, rs2.status + '/' + rs3.status);
  check('★实测到防泄漏闸的同秒缺口：同秒判词被放行（200）', v2same.status === 200 && v2same.saved === 3,
    'status=' + v2same.status + ' saved=' + v2same.saved);
  check('★隔秒判词被闸挡住（409）', v3.status === 409, 'status=' + v3.status);
  check('判词·前序写入仍在、不回滚', vrows2.predictions === 3 && vrows2.resolved === 2 && vrows2.verdicts === 6,
    JSON.stringify({ pred: vrows2.predictions, res: vrows2.resolved, verd: vrows2.verdicts }));

  await app.close();
  db.closeCurrent();
  if (ro) ro.close();

  log('');
  log('## 结论');
  log('- 断言：PASS ' + pass + ' / FAIL ' + fail);
  fs.writeFileSync(path.join(__dirname, 'comp-run.receipt.txt'), out.join('\n') + '\n', 'utf8');
  console.log('\n[comp-run] RUN=' + RUN + ' PASS=' + pass + ' FAIL=' + fail);
  if (fail > 0) process.exitCode = 1;
}

/** 按 marker 查本次写入的 predictions id（供后续步骤按 id 操作）。 */
async function ledgerIds(tag) {
  if (!ro) ro = new Database(SANDBOX, { readonly: true, fileMustExist: true });
  return ro.prepare('SELECT id FROM predictions WHERE statement LIKE ? ORDER BY id').all('%[' + tag + ']%').map(r => r.id);
}

/** 回环收敛条件（写死在这里，跑完就打印，不许"一直转"）。 */
function evaluateConvergence(rounds, deltas) {
  const MAX_ROUNDS = 3;
  const reasons = [];
  if (rounds.length >= MAX_ROUNDS) reasons.push('达轮数上限 ' + MAX_ROUNDS);
  const last = deltas.length ? deltas[deltas.length - 1] : null;
  if (last !== null && last >= 0) reasons.push('Brier 不再缩小（Δ=' + last + ' ≥ 0）');
  const ns = rounds.map(r => r.b.n);
  if (ns.some(n => n === 0)) reasons.push('有轮次 Brier 样本为 0');
  return {
    max_rounds: MAX_ROUNDS,
    deltas: deltas,
    converged: reasons.length > 0,
    reason: reasons.join('；') || '未收敛',
    stop_rule: '三条任一命中即停：① 轮数 = 3；② 本轮 Brier ≥ 上一轮（不再缩小）；③ 某轮 Brier 样本 n=0。★不允许「一直转」。',
  };
}

main().catch((e) => {
  console.error('[comp-run] 失败: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
  // 显式退：app.listen 的句柄会让进程挂住（实测 timeout 124），失败时必须收摊而不是等被杀。
  try { db.closeCurrent(); } catch (_) {}
  setTimeout(() => process.exit(1), 300).unref();
});
