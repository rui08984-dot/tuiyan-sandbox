'use strict';
/**
 * p1b/scripts/intake-ledger-e2e.cjs —— D-8.1/D-8.2 端到端收据（design §8，2026-09-13）。
 * 走通：真实候选题 classify 通过 → intake_questions 记账 → predictions_r4 只读视图可见 →
 *       g2-report 默认/--include-intake 主读数一致（护栏）→ 关服后只读直读落盘。
 * 铁律：app.inject（零监听端口，不碰 8787）；llmMock=1 零网络；临时文件库（生产库零写）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
process.env.P1B_LLM_MOCK = '1';
const { buildServer } = require('../src/server');
const { db, P1A_ROOT } = require('../src/deps');

const OUT_DIR = path.join(__dirname, '..', 'sim', 'out');
const RECEIPT = path.join(OUT_DIR, 'intake-ledger-e2e.receipt.md');
const RAW = path.join(OUT_DIR, 'intake-ledger-e2e.out');
const dbPath = path.join(os.tmpdir(), 'p1b-intake-ledger-e2e-' + process.pid + '-' + Date.now() + '.db');
const providersPath = path.join(os.tmpdir(), 'p1b-intake-ledger-e2e-providers-' + process.pid + '.json');
const g2Default = path.join(os.tmpdir(), 'g2-e2e-default-' + process.pid + '.json');
const g2Intake = path.join(os.tmpdir(), 'g2-e2e-intake-' + process.pid + '.json');
const G2 = path.join(__dirname, 'g2-report.cjs');

const out = [];
let pass = 0; let fail = 0;
function log(s) { out.push(s); console.log(s); }
function check(name, cond, detail) {
  if (cond) { pass++; log('- PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; log('- FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const J = (r) => r.json();
const ckFlat = (over) => Object.assign({
  Q0_1: true, Q0_2: true, Q0_3: true,
  L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false],
  L3: [false, false, false, false], L2: [false, false, false, false], L4: [false, false, false],
}, over || {});
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('# 接题闭环 D-8.1/D-8.2 端到端收据（design §8，2026-09-13）');
  log('');
  log('- 执行：p1b/scripts/intake-ledger-e2e.cjs（app.inject 零监听端口；P1B_LLM_MOCK=1 零网络）');
  log('- 临时库：' + dbPath);
  check('生产库零写（临时库 ≠ 默认库）', dbPath !== db.DEFAULT_DB_PATH, 'default=' + db.DEFAULT_DB_PATH);
  log('');
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: providersPath });

  log('## 1. D-8.2：classify 通过 → intake_questions 记账');
  const q1 = { statement: '2026-09-12 上海最高气温 > 35°C（外部题，无「局」）',
    resolve_spec: { kind: 'official_stat', field: 'daily_high_temp', threshold: 35, cmp: 'gt', date: '2026-09-12' },
    checklist: ckFlat({ L3: [true, true, true, true] }) };
  const r1 = J(await app.inject({ method: 'POST', url: '/api/intake/classify', payload: q1 }));
  log('- 返回：' + JSON.stringify({ rejected: r1.rejected, layer: r1.layer, engine: r1.engine, gate: r1.gate, intake_question_id: r1.intake_question_id }));
  check('通过且落 intake_questions', r1.rejected === false && r1.intake_ledger === 'intake_questions' && r1.intake_question_id > 0);
  check('layer=L3 / engine=stat_baseline', r1.layer === 'L3' && r1.engine === 'stat_baseline');

  log('## 2. D-8.1：unknown 落 intake_questions，predictions 零行');
  const unkStmt = '某自然人 2026-10-01 是否穿红色外套（一次性人类选择）';
  const r2 = J(await app.inject({ method: 'POST', url: '/api/intake/classify', payload: { statement: unkStmt, checklist: ckFlat({ L4: [true, true, true] }) } }));
  log('- 返回：' + JSON.stringify({ layer: r2.layer, secondary: r2.secondary, intake_question_id: r2.intake_question_id }));
  check('unknown 落 intake_questions', r2.layer === 'unknown' && r2.secondary === 'L4' && r2.intake_question_id > 0);
  const conn = db.getConnection();
  const predUnk = conn.prepare('SELECT COUNT(*) n FROM predictions WHERE statement = ?').get(unkStmt).n;
  check('unknown 未进 predictions（layer CHECK 未放开）', predUnk === 0, 'predictions rows=' + predUnk);

  log('## 3. D-8.1：只读归一视图 predictions_r4');
  const vcols = conn.prepare('PRAGMA table_info(predictions_r4)').all().map((c) => c.name);
  const vorig = conn.prepare('SELECT origin, COUNT(*) n FROM predictions_r4 GROUP BY origin').all();
  const vlayers = conn.prepare("SELECT layer, COUNT(*) n FROM predictions_r4 WHERE origin='intake_questions' GROUP BY layer ORDER BY layer").all();
  log('- 列形状（21 列）：' + vcols.join(','));
  log('- origin 计数：' + JSON.stringify(vorig));
  log('- 接题侧分层：' + JSON.stringify(vlayers));
  check('视图列形状 21 列统一', vcols.length === 21 && vcols[0] === 'origin' && vcols[20] === 'intake_reject_id');
  check('接题侧含 unknown 行', vlayers.some((x) => x.layer === 'unknown'));
  log('## 4. D-8.1 护栏：g2-report 默认 / --include-intake 主读数一致');
  await app.close();
  db.closeCurrent();
  execFileSync(process.execPath, [G2, '--db', dbPath, '--json', g2Default], { stdio: 'ignore' });
  execFileSync(process.execPath, [G2, '--db', dbPath, '--include-intake', '--json', g2Intake], { stdio: 'ignore' });
  const ga = JSON.parse(fs.readFileSync(g2Default, 'utf8'));
  const gb = JSON.parse(fs.readFileSync(g2Intake, 'utf8'));
  log('- 默认：include_intake=' + ga.meta.include_intake + '，gate=' + ga.meta.gate + '，intake_layer=' + JSON.stringify(ga.intake_layer));
  log('- 开关：include_intake=' + gb.meta.include_intake + '，gate=' + gb.meta.gate + '，视图 intake 行=' + (gb.intake_layer && gb.intake_layer.intake_rows));
  check('默认关（不读视图）', ga.meta.include_intake === false && ga.intake_layer === null);
  check('开关不改变门总判定', ga.meta.gate === gb.meta.gate, ga.meta.gate + ' vs ' + gb.meta.gate);
  check('开关不改变 Q1-Q5 verdicts', JSON.stringify(ga.meta.verdicts) === JSON.stringify(gb.meta.verdicts));
  check('开关文本含显著标注「非 G2 口径」', /含接题层未入账题，非 G2 口径/.test(gb.text_report));
  check('默认文本无接题披露节', !/接题层/.test(ga.text_report));
  check('开关开时视图被读到（intake 行 2）', !!(gb.intake_layer && gb.intake_layer.available && gb.intake_layer.intake_rows === 2));

  log('## 5. 落盘直读（关服后新只读连接）');
  const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));
  const ro = new Database(dbPath, { readonly: true });
  const nq = ro.prepare('SELECT COUNT(*) n FROM intake_questions').get().n;
  const nv = ro.prepare("SELECT COUNT(*) n FROM predictions_r4 WHERE origin='intake_questions'").get().n;
  const nview = ro.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='view' AND name='predictions_r4'").get().n;
  ro.close();
  log('- intake_questions 行=' + nq + ' ｜ 视图 intake 行=' + nv + ' ｜ 视图存在=' + nview);
  check('intake_questions 已落盘（2 行）', nq === 2, 'rows=' + nq);
  check('视图已落盘且可读', nview === 1 && nv === 2);

  log('');
  log('## 结论');
  log('- 断言：PASS ' + pass + ' / FAIL ' + fail);
  log('- F13 = 半闭环：接题层已闭环（unknown 落 intake_questions）；入账层（放开 predictions.layer CHECK 的表重建）待与 F4 真值分库合并为同一次计划内账本迁移（design §8 D-8.1）。');
  log('- 仍待定义：外部题 resolve 后并入统一账本（predictions）的域容器规则；本轮不做自动落 predictions，禁沿用隐式 corpus:* 模式。');
  log('- 生产库 ' + db.DEFAULT_DB_PATH + ' 零写：全程只用临时库 ' + dbPath + '。');
  const text = out.join('\n') + '\n';
  fs.writeFileSync(RECEIPT, text);
  fs.writeFileSync(RAW, text);
  console.log('[intake-ledger-e2e] PASS=' + pass + ' FAIL=' + fail + ' receipt=' + RECEIPT);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error('[intake-ledger-e2e] 失败: ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
