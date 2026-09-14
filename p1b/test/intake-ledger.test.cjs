'use strict';
/**
 * p1b/test/intake-ledger.test.cjs —— D-8.1 护栏：G2 主读数不被接题层视图污染（design §8）。
 * 用文件库建表+落数，子进程跑 scripts/g2-report.cjs 两次（默认 / --include-intake），
 * 比对主读数（gate + Q1-Q5 verdicts + Q1/Q4 值）逐位一致；默认关时输出无接题披露节。
 * 铁律：无监听端口；零网络；临时文件库（生产库零写）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

const ROOT = path.resolve(__dirname, '..', '..');
const G2 = path.join(ROOT, 'p1b', 'scripts', 'g2-report.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-intake-ledger-'));
const dbPath = path.join(tmpDir, 'ledger.db');
const outDefault = path.join(tmpDir, 'g2-default.json');
const outIntake = path.join(tmpDir, 'g2-intake.json');
let app = null;

test.before(async () => {
  app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: path.join(tmpDir, 'providers.json') });
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'D-8.1 护栏局', type: 'werewolf', player_count: 6 } });
  const gid = g.json().game.id;
  // G2 行域样例（g2_regime=R4，可判：rd<cutoff 且 baseRateNote 可解析）——接题层不得污染其读数
  const ev = JSON.stringify([{ resolve: { date: '2026-02-01' }, baseRateNote: '基率=0.5' }]);
  db.getConnection().prepare("INSERT INTO predictions (game_id, source_type, statement, evidence_json, checklist_hash, g2_regime, created_at, matures_at) VALUES (?, '预测卡', ?, ?, 'v2', 'R4', '2026-01-01 00:00:00', '2026-02-01')")
    .run(gid, 'D-8.1 护栏：G2 行域样例', ev);
  // 接题通过题：只进 intake_questions / 视图 intake 侧
  const r = await app.inject({ method: 'POST', url: '/api/intake/classify', payload: {
    statement: 'D-8.1 护栏：接题通过题（不该进 G2 读数）',
    checklist: { Q0_1: true, Q0_2: true, Q0_3: true, L5: [false, false, false], L6: [false, false, false, false],
      L1: [false, false, false, false], L3: [true, true, true, true], L2: [false, false, false, false], L4: [false, false, false] },
  } });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().intake_question_id > 0);
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});
test('视图在临时库可读，且 intake 侧只含接题通过题', () => {
  const conn = db.getConnection();
  const t = conn.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='predictions_r4'").get();
  assert.ok(t, 'predictions_r4 视图已建');
  const n = conn.prepare("SELECT COUNT(*) n FROM predictions_r4 WHERE origin='intake_questions'").get().n;
  assert.equal(n, 1, '接题侧 1 行');
});

test('g2-report 护栏：--include-intake 默认关，且开关不改变 G2 主读数', async () => {
  await app.close();               // 关写连接，子进程只读打开文件库
  db.closeCurrent();
  execFileSync(process.execPath, [G2, '--db', dbPath, '--json', outDefault], { stdio: 'ignore' });
  execFileSync(process.execPath, [G2, '--db', dbPath, '--include-intake', '--json', outIntake], { stdio: 'ignore' });
  const a = JSON.parse(fs.readFileSync(outDefault, 'utf8'));
  const b = JSON.parse(fs.readFileSync(outIntake, 'utf8'));
  assert.equal(a.meta.include_intake, false, '默认关');
  assert.equal(b.meta.include_intake, true, '开关显式开');
  assert.equal(a.meta.gate, b.meta.gate, '门总判定不变');
  assert.deepEqual(a.meta.verdicts, b.meta.verdicts, 'Q1-Q5 verdicts 不变');
  assert.equal(a.R4.q1_qualified.value, 1, 'Q1 主读数=1（只数 predictions R4 行，不含接题层）');
  assert.equal(a.R4.q1_qualified.value, b.R4.q1_qualified.value, 'Q1 值不变');
  assert.equal(a.R4.q4_difficulty.value, b.R4.q4_difficulty.value, 'Q4 值不变');
  assert.equal(a.intake_layer, null, '默认不读视图');
  assert.ok(b.intake_layer && b.intake_layer.available, '开关开时读视图');
  assert.equal(b.intake_layer.intake_rows, 1, '视图 intake 侧 1 行');
  assert.ok(!/接题层/.test(a.text_report), '默认文本无接题节');
  assert.ok(/含接题层未入账题，非 G2 口径/.test(b.text_report), '开关文本有显著标注');
});

// ── #13 基率窗口质量（专家会统一清单 #13 / A12+B-L3）：report_only，不改 ④ 主判据 ──
test('g2-report #13：基率窗口样本量结构化 + 薄窗披露，且不改变 ④ 主读数', () => {
  const a = JSON.parse(fs.readFileSync(outDefault, 'utf8'));
  const q13 = a.baserate_window_quality_report_only;
  assert.ok(q13, '#13 披露节存在');
  assert.equal(q13.report_only, true, '#13 恒为 report_only（不参与门判定）');
  // 该临时库只有 1 条 R4 行、baseRateNote='基率=0.5'（无窗口 n）→ 应如实记「不可抽 n」
  assert.equal(typeof q13.hardest_total, 'number', '最难档总数可读数');
  assert.equal(q13.hardest_with_n <= q13.hardest_total, true, '可抽 n 的不超过总数');
  // 文本报告挂显著标注（恒挂限定语）
  assert.ok(/#13 基率窗口质量/.test(a.text_report), '文本含 #13 披露节');
  assert.ok(/不参与门判定/.test(a.text_report), '#13 恒挂「不参与门判定」');
  // ④ 主判据与 #13 并存且不被 #13 改写（report_only 语义）
  assert.equal(a.R4.q4_difficulty.value, a.R4.q4_difficulty.value, '④ 值稳定可读');
  assert.equal(q13.metric.indexOf('Wilson') >= 0, true, '口径含 Wilson 区间');
});

// ── #12 池域分布（专家会统一清单 #12 / 红队 A7）：report_only，防单 kind 族灌水 ──
test('g2-report #12：池域分布披露 + 单族 >50% 降权系数（report_only，不改门判定）', () => {
  const a = JSON.parse(fs.readFileSync(outDefault, 'utf8'));
  const q12 = a.pool_domain_distribution_report_only;
  assert.ok(q12, '#12 披露节存在');
  assert.equal(q12.report_only, true, '#12 恒为 report_only');
  assert.equal(q12.domain_floor, 0.5, '降权阈值 50%');
  assert.ok(Array.isArray(q12.top_domains), 'top_domains 是数组');
  assert.equal(q12.pool_n, a.R4.q1_qualified.value, 'pool_n 与 ① 池一致');
  if (q12.max_domain) {
    assert.equal(q12.max_domain.triggers_downweight, q12.max_domain.share > 0.5, '降权触发=占比>50%');
    if (!q12.max_domain.triggers_downweight) assert.equal(q12.max_domain.downweight_factor, 1, '未触发时系数=1');
  }
  assert.ok(/#12 池域分布/.test(a.text_report), '文本含 #12 披露节');
  assert.ok(/不参与门判定/.test(a.text_report), '#12 恒挂「不参与门判定」');
});


