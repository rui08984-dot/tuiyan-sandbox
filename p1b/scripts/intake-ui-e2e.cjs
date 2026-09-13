'use strict';
/**
 * p1b/scripts/intake-ui-e2e.cjs —— 接题页端到端收据（阶段 3 出口件界面面，2026-09-13）。
 *
 * 隔离端口 8791（app.listen，**零碰 8787**）+ 临时库 + P1B_LLM_MOCK=1：
 *   ① 静态前端 dist 已挂载且新 bundle 含接题页（#/intake / 接题）
 *   ② 真实提交 POST /api/intake/classify → 打印逐字段 JSON
 *   ③ 拒收分布 GET /api/intake/rejects（含 0 计数）
 *   ④ 接题库只读列表 GET /api/intake/questions
 * 全程零写生产库（写只发生在临时库）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

const PORT = 8791;
const OUT_DIR = path.join(__dirname, '..', 'sim', 'out');
const RECEIPT = path.join(OUT_DIR, 'intake-ui-e2e.receipt.md');
const RAW = path.join(OUT_DIR, 'intake-ui-e2e.out');
const dbPath = path.join(os.tmpdir(), 'p1b-intake-ui-e2e-' + process.pid + '-' + Date.now() + '.db');
const providersPath = path.join(os.tmpdir(), 'p1b-intake-ui-e2e-providers-' + process.pid + '.json');
const BASE = 'http://127.0.0.1:' + PORT;

const out = [];
let pass = 0; let fail = 0;
function log(s) { out.push(s); console.log(s); }
function check(name, cond, detail) {
  if (cond) { pass++; log('- PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; log('- FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const CK = (over) => Object.assign({
  Q0_1: true, Q0_2: true, Q0_3: true,
  L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
  L3: [false, false, false, false], L2: [false, false, false, false], L4: [false, false, false],
}, over || {});
async function jfetch(method, p, body) {
  const res = await fetch(BASE + p, {
    method: method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: res.status, text: text, json: json };
}
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: providersPath });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  log('# 接题页端到端收据（隔离端口 ' + PORT + '，阶段 3 出口件界面面，2026-09-13）');
  log('');
  log('- 服务：http://127.0.0.1:' + PORT + '（app.listen；零碰 8787）');
  log('- 临时库：' + dbPath);
  check('生产库零写（临时库 ≠ 默认库）', dbPath !== db.DEFAULT_DB_PATH, 'default=' + db.DEFAULT_DB_PATH);
  log('');

  log('## ① 静态前端 dist（后端已挂载）');
  const idx = await jfetch('GET', '/');
  const jsMatch = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(idx.text);
  const bundle = jsMatch ? jsMatch[1] : null;
  log('- GET / → ' + idx.status + '；index.html 引用 bundle：' + (bundle || '(未解析到)'));
  check('dist 已挂载（GET / 200 且 index.html 存在）', idx.status === 200 && idx.text.indexOf('<div id="root">') >= 0);
  check('新 bundle 已引用', !!bundle, 'bundle=' + bundle);
  let assetText = '';
  if (bundle) {
    const asset = await jfetch('GET', '/assets/' + bundle);
    assetText = asset.text;
    check('bundle 可取（200）', asset.status === 200, 'bytes=' + assetText.length);
  }
  check('bundle 含接题页（接题 + /intake）', assetText.indexOf('接题') >= 0 && assetText.indexOf('/intake') >= 0);
  check('bundle 无「预测」字样（UI 铁律）', assetText.length > 0 && assetText.indexOf('预测') < 0);
  log('');

  log('## ② 真实提交 POST /api/intake/classify（结构照接题页表单）');
  const payload = {
    statement: '2026-09-12 上海最高气温 > 35°C（cutoff=2026-09-11 20:00，真值锚=气象台官方日最高气温）',
    resolve_spec: { kind: 'official_stat', field: 'daily_high_temp', threshold: 35, cmp: 'gt', date: '2026-09-12' },
    checklist: CK({ L3: [true, true, true, true] }),
  };
  const sub = await jfetch('POST', '/api/intake/classify', payload);
  log('- 提交题面：' + payload.statement);
  log('- 返回 JSON：');
  log('~~~json');
  log(JSON.stringify(sub.json, null, 1));
  log('~~~');
  check('提交 200', sub.status === 200, 'status=' + sub.status);
  check('通过且归属 L3', !!(sub.json && sub.json.rejected === false && sub.json.layer === 'L3'));
  check('gate/engine 如实透出', !!(sub.json && sub.json.gate && sub.json.engine));
  const rej = await jfetch('POST', '/api/intake/classify', { statement: '以落库日当 cutoff 去问已发生的历史事件（判据泄漏）', checklist: CK({ Q0_2: false, L3: [true, true, true, true] }) });
  check('拒收样例 reason=leak', !!(rej.json && rej.json.rejected === true && rej.json.reason === 'leak'), 'reason=' + (rej.json && rej.json.reason));
  log('');

  log('## ③ 拒收原因分布 GET /api/intake/rejects');
  const rejList = await jfetch('GET', '/api/intake/rejects');
  log('- 返回：' + JSON.stringify({ ok: rejList.json && rejList.json.ok, total: rejList.json && rejList.json.total, by_reason: rejList.json && rejList.json.by_reason }));
  check('分布枚举全列（含 0 计数）', !!(rejList.json && rejList.json.by_reason && rejList.json.by_reason.length === 4));
  check('leak 计数 >=1', !!(rejList.json && rejList.json.by_reason.filter((x) => x.reason === 'leak')[0].n >= 1));
  log('');

  log('## ④ 接题库只读列表 GET /api/intake/questions');
  const qs = await jfetch('GET', '/api/intake/questions?limit=5');
  const first = qs.json && qs.json.items && qs.json.items[0];
  log('- 返回：' + JSON.stringify({ ok: qs.json && qs.json.ok, total: qs.json && qs.json.total, first: first ? { id: first.id, layer: first.layer, gate: first.gate, prob: first.prob } : null }));
  check('列表 200 且含刚提交行', qs.status === 200 && !!(qs.json && qs.json.total >= 1));
  check('行含 id/statement/layer/gate/prob/created_at', !!(first && ['id', 'statement', 'layer', 'gate', 'prob', 'created_at'].every((k) => k in first)));
  check('列表 note 无「预测」字样', !!(qs.json && qs.json.note.indexOf('预测') < 0));
  log('');

  await app.close();
  log('## 结论');
  log('- 断言：PASS ' + pass + ' / FAIL ' + fail);
  log('- 新 bundle 文件名：' + (bundle || '(未解析)'));
  log('- 用户刷新后操作：顶部导航点「接题」→ #/intake；填题面 + 按固定个数勾选六层问答 → 提交分类 → 右侧出分类结果 / 拒收分布 / 接题库。');
  log('- 未做：接题库的 resolve 写路径与并入统一账本的域容器规则（后续片）；本页只接题分类，不做结算。');
  const text = out.join('\n') + '\n';
  fs.writeFileSync(RECEIPT, text);
  fs.writeFileSync(RAW, text);
  console.log('[intake-ui-e2e] PASS=' + pass + ' FAIL=' + fail + ' bundle=' + bundle + ' receipt=' + RECEIPT);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error('[intake-ui-e2e] 失败: ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
