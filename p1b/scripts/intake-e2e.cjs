'use strict';
/**
 * p1b/scripts/intake-e2e.cjs —— 「开放接题最小闭环」端到端收据（阶段 3 出口件，2026-09-13）。
 *
 * 走通：真实候选题 → POST /api/intake/classify（拒收门 + 六层判定）→ 拒收题写 intake_rejects 记账
 *       → GET /api/intake/rejects 仪表可见 → 关服后用**新只读连接**直读临时库证明落盘。
 *
 * 铁律：app.inject（真 HTTP 语义，零监听端口，不碰 8787）；llmMock=1（零网络）；
 *       DB=临时文件（生产库 data/p1a.db 零写，也不读）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.P1B_LLM_MOCK = '1';

const { buildServer } = require('../src/server');
const { db, P1A_ROOT } = require('../src/deps');

const OUT_DIR = path.join(__dirname, '..', 'sim', 'out');
const RECEIPT = path.join(OUT_DIR, 'intake-e2e.receipt.md');
const RAW = path.join(OUT_DIR, 'intake-e2e.out');
const dbPath = path.join(os.tmpdir(), 'p1b-intake-e2e-' + process.pid + '-' + Date.now() + '.db');
const providersPath = path.join(os.tmpdir(), 'p1b-intake-e2e-providers-' + process.pid + '.json');

const out = [];
let pass = 0;
let fail = 0;
function log(s) { out.push(s); console.log(s); }
function check(name, cond, detail) {
  if (cond) { pass++; log('- PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; log('- FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const post = (app, url, payload) => app.inject({ method: 'POST', url: url, payload: payload });
const get = (app, url) => app.inject({ method: 'GET', url: url });
const J = (r) => r.json();
const brief = (o) => JSON.stringify(o);

// 真实候选题 1（合格）：天气类 L3 短窗混沌（design §1.9 走通示例同族）
const Q_WEATHER = {
  statement: '2026-09-12 上海最高气温 > 35°C（cutoff=2026-09-11 20:00，真值锚=气象台官方日最高气温）',
  resolve_spec: { kind: 'official_stat', url_template: 'http://www.weather.com.cn/weather1d/101020100.shtml',
    field: 'daily_high_temp', threshold: 35, cmp: 'gt', date: '2026-09-12' },
  checklist: { Q0_1: true, Q0_2: true, Q0_3: true,
    L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
    L3: [true, true, true, true], L2: [false, false, false, false], L4: [false, false, false] },
};
// 真实候选题 2（拒收）：决策过程不公开、第三方无可复核真值锚（design §1.1 Q0-1）
const Q_NO_ANCHOR = {
  statement: '某公司是否会在 2026-09-20 前内部拍板 A 方案（决策过程不公开，第三方无可复核记录）',
  checklist: { Q0_1: false, Q0_2: true, Q0_3: true,
    L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
    L3: [false, false, false, false], L2: [false, false, false, false], L4: [false, false, false] },
};
// 真实候选题 3（unknown 出口）：一次性人类决策、无反馈回路、无 ≥30 同类样本（R1-F13）
const Q_UNKNOWN = {
  statement: '某自然人 2026-10-01 当天是否穿红色外套（一次性人类选择，无反馈回路、无同类样本池）',
  checklist: { Q0_1: true, Q0_2: true, Q0_3: true,
    L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
    L3: [false, 'unknown', false, false], L2: [false, false, false, false], L4: [false, false, false] },
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('# 开放接题最小闭环 · 端到端收据（阶段 3 出口件，2026-09-13）');
  log('');
  log('- 执行：`p1b/scripts/intake-e2e.cjs`（app.inject 真 HTTP 语义，零监听端口；P1B_LLM_MOCK=1 零网络）');
  log('- 临时库：`' + dbPath + '`');
  check('生产库零写（临时库 ≠ 默认生产库）', dbPath !== db.DEFAULT_DB_PATH, 'default=' + db.DEFAULT_DB_PATH);
  log('');

  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: providersPath });

  // ── 1. 分类（合格真实候选题）──
  log('## 1. 分类：真实候选题 → 六层判定 + 引擎位');
  const r1 = await post(app, '/api/intake/classify', Q_WEATHER);
  const b1 = J(r1);
  log('- 题面：' + Q_WEATHER.statement);
  log('- 返回：`' + brief({ ok: b1.ok, rejected: b1.rejected, layer: b1.layer, secondary: b1.secondary, checklist_hash: b1.checklist_hash, engine: b1.engine, calibrator: b1.engine_plan && b1.engine_plan.calibrator, gate: b1.gate }) + '`');
  check('HTTP 200', r1.statusCode === 200, 'status=' + r1.statusCode);
  check('合格题 layer=L3', b1.layer === 'L3', 'layer=' + b1.layer);
  check('engine=stat_baseline（+aci）', b1.engine === 'stat_baseline' && b1.engine_plan.calibrator === 'aci', brief(b1.engine_plan));
  check('gate=descriptive（只记账不出数）', b1.gate === 'descriptive');
  check('checklist_hash=v3', b1.checklist_hash === 'v3');
  log('');

  // ── 2. 记账（拒收留痕）──
  log('## 2. 记账：真实候选题过不了拒收门 → intake_rejects 留痕');
  const r2 = await post(app, '/api/intake/classify', Q_NO_ANCHOR);
  const b2 = J(r2);
  log('- 题面：' + Q_NO_ANCHOR.statement);
  log('- 返回：`' + brief({ ok: b2.ok, rejected: b2.rejected, reason: b2.reason, reject_id: b2.reject_id, gate: b2.gate }) + '`');
  check('HTTP 200（拒收不是失败）', r2.statusCode === 200);
  check('rejected=true / reason=no_anchor', b2.rejected === true && b2.reason === 'no_anchor', 'reason=' + b2.reason);
  check('留痕 id 已分配', typeof b2.reject_id === 'number' && b2.reject_id > 0, 'reject_id=' + b2.reject_id);
  // unknown 出口（非拒收）
  const r3 = await post(app, '/api/intake/classify', Q_UNKNOWN);
  const b3 = J(r3);
  log('- unknown 出口用例：' + Q_UNKNOWN.statement);
  log('- 返回：`' + brief({ ok: b3.ok, rejected: b3.rejected, layer: b3.layer, engine: b3.engine }) + '`');
  check('unknown 出口：layer=unknown 且非拒收', b3.rejected === false && b3.layer === 'unknown', 'layer=' + b3.layer);
  log('');

  // ── 3. 仪表可见（拒收原因分布）──
  log('## 3. 仪表可见：GET /api/intake/rejects（拒收原因分布，含 0 计数）');
  const r4 = await get(app, '/api/intake/rejects');
  const b4 = J(r4);
  log('- 返回：`' + brief({ ok: b4.ok, total: b4.total, by_reason: b4.by_reason }) + '`');
  check('HTTP 200', r4.statusCode === 200);
  check('总拒收 ≥1', b4.total >= 1, 'total=' + b4.total);
  check('no_anchor 可见且 ≥1', b4.by_reason.filter((x) => x.reason === 'no_anchor')[0].n >= 1);
  check('枚举四原因全列出（含 0 计数）', b4.by_reason.length === 4);
  check('分布之和=总数', b4.by_reason.reduce((s, x) => s + x.n, 0) === b4.total);
  check('UI 文案禁「预测」字样', !/预测/.test(b4.note));
  log('');

  // ── 4. 引擎位映射骨架（全 6 层 + unknown）──
  log('## 4. 分层引擎路由骨架（layer→engine 位，只映射不建引擎）');
  const flat = (over) => ({ Q0_1: true, Q0_2: true, Q0_3: true,
    L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
    L3: [false, false, false, false], L2: [false, false, false, false], L4: [false, false, false] });
  const cases = [
    { layer: 'L1', over: { L1: [true, true, true, true] }, engine: 'proc_calc', cal: null },
    { layer: 'L2', over: { L2: [true, true, true, true] }, engine: 'stat_baseline', cal: 'wilson' },
    { layer: 'L3', over: { L3: [true, true, true, true] }, engine: 'stat_baseline', cal: 'aci' },
    { layer: 'L5', over: { L5: [true, true, true] }, engine: 'certified_dist', cal: null },
    { layer: 'L6', over: { L6: [true, true, true, true] }, engine: 'structural', cal: null },
    { layer: 'unknown', over: {}, engine: 'none', cal: null },
  ];
  const got = [];
  for (const c of cases) {
    const ck = Object.assign(flat(), c.over);
    const rc = await post(app, '/api/intake/classify', { statement: 'engine 位映射用例 ' + c.layer, checklist: ck });
    const bc = J(rc);
    got.push(c.layer + ' → ' + bc.engine + (bc.engine_plan && bc.engine_plan.calibrator ? '+' + bc.engine_plan.calibrator : ''));
    check('engine 位 ' + c.layer + '=' + c.engine, bc.layer === c.layer && bc.engine === c.engine && bc.engine_plan.calibrator === c.cal, 'got ' + bc.layer + '/' + bc.engine);
    check('engine_plan.built=false（本轮不建引擎）', bc.engine_plan.built === false && bc.engine_plan.predicts === false);
  }
  log('- 实测：' + got.join(' ｜ '));
  log('- L4=classify-only（engine=none，叠加标注维度，本轮不在决策树内）');
  log('');

  await app.close();
  try { db.closeCurrent(); } catch (e) { /* ignore */ }

  // ── 5. 落盘直读（新只读连接，证明持久化）──
  log('## 5. 落盘直读（关服后新只读连接）');
  const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));
  const conn = new Database(dbPath, { readonly: true });
  const rows = conn.prepare('SELECT id, reason, statement FROM intake_rejects ORDER BY id ASC').all();
  const tableOk = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intake_rejects'").get();
  conn.close();
  log('- intake_rejects 表在：' + (tableOk ? 'YES' : 'NO') + '，行数 ' + rows.length);
  for (const r of rows) log('  · #' + r.id + ' reason=' + r.reason + ' ｜ ' + r.statement.slice(0, 46) + (r.statement.length > 46 ? '…' : ''));
  check('表已落盘', !!tableOk);
  check('拒收行已持久化', rows.length >= 1, 'rows=' + rows.length);
  log('');

  log('## 结论');
  log('- 断言：PASS ' + pass + ' / FAIL ' + fail);
  log('- 未做（本片范围外）：L4 叠加的可持久化列（predictions.layer CHECK 仍限 L1-L6，unknown/L4 只在接题入口返回，入账留待下一片）；L2/L5/L6 引擎本体；接题题面落 predictions（需 game_id）。');
  log('- 生产库 `' + db.DEFAULT_DB_PATH + '` 零写：全程只用临时库 `' + dbPath + '`。');

  const text = out.join('\n') + '\n';
  fs.writeFileSync(RECEIPT, text);
  fs.writeFileSync(RAW, text);
  console.log('[intake-e2e] PASS=' + pass + ' FAIL=' + fail + ' receipt=' + RECEIPT);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[intake-e2e] 失败: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
