'use strict';
/**
 * p1b/test/calibration-report.test.cjs —— P0-U8 测试（2026-09-16）
 * 夹具 mini stage4 JSON（一格 n≥30、一格 n<30）→ 逐格行数、薄格降级标注、限定语块、
 * 防泄漏声明、禁词黑名单、缺件 n/a 不编数。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'calibration-report.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-calrep-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

const FIX = path.join(tmpDir, 'stage4-fixture.json');
fs.writeFileSync(FIX, JSON.stringify({
  report: {
    L2: { bayes_semantics: { role: 'prior', note: '基率+Wilson' } },
    L3: { bayes_semantics: { role: 'prior+calibration', note: 'ACI 只调区间不调 p' } },
  },
  bayes_legend: { source: '10-算子攻坚-深度报告 §4（O1-O8 四元组）' },
  truth_basis_defect_excluded_rows: 98,
  truth_basis_defect_fingerprint: '78b8cedb9d37307a' + 'x'.repeat(48),
  by_domain: [
    { layer: 'L2', domain: 'dbnomics', scored_n: 79, conclusion_allowed: true, mean_p: 0.5, obs_rate: 0.49, brier_engine: 0.2499, delta_vs_half: -0.0001, delta_ci95: { lb: -0.034, ub: 0.0351 } },
    { layer: 'L3', domain: 'jpl', scored_n: 2, conclusion_allowed: false, note: 'n=2 < 30' },
  ],
}, null, 1), 'utf8');

function run(args) { return execFileSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' }); }

test('① 逐格呈现：格数=by_domain 格数；薄格标「n<30 仅方向」', () => {
  run(['--stage4', FIX, '--g2', path.join(tmpDir, 'no-g2.json'), '--out-dir', tmpDir]);
  const jf = path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^calibration-report-\d{8}\.json$/.test(f))[0]);
  const mf = path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^calibration-report-\d{8}\.md$/.test(f))[0]);
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  const md = fs.readFileSync(mf, 'utf8');
  assert.equal(j.cells_total, 2, '格数=by_domain 格数');
  assert.equal(j.cells_with_conclusion, 1, '可出结论格=1');
  assert.equal(j.cells.find((c) => c.domain === 'jpl').conclusion_allowed, false, '薄格 conclusion_allowed=false');
  assert.match(md, /n<30 仅方向/, '薄格降级标注在');
  assert.match(md, /分域格校准表（2 格；可出结论 1）/, '表头计数');
});

test('② 限定语块＋防泄漏声明（引 stage4 排除计数与指纹）＋口径边界明文', () => {
  const mf = path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^calibration-report-\d{8}\.md$/.test(f))[0]);
  const md = fs.readFileSync(mf, 'utf8');
  assert.match(md, /重放计分（读侧）/, '重放计分披露');
  assert.match(md, /门定性恒挂限定语/, '过程能力门限定语');
  assert.match(md, /已排除真值口径缺陷行 98/, '防泄漏声明引用排除计数');
  assert.match(md, /layer_calibration/, '口径边界明文引 audit.js 口径');
  assert.match(md, /引擎重放口径/, '口径边界明文引引擎重放口径');
  assert.match(md, /prior（基率\+Wilson）/, '五层贝叶斯语义（读 U2 键）');
});

test('③ 禁词黑名单：报告正文不含「预测」', () => {
  const mf = path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^calibration-report-\d{8}\.md$/.test(f))[0]);
  const md = fs.readFileSync(mf, 'utf8');
  assert.ok(md.indexOf('预测') === -1, '正文出现禁词「预测」');
});

test('④ 缺 stage4 件 ⇒ 输出 n/a 不编数', () => {
  const out2 = path.join(tmpDir, 'na');
  fs.mkdirSync(out2, { recursive: true });
  run(['--stage4', path.join(tmpDir, 'missing-stage4.json'), '--g2', path.join(tmpDir, 'missing-g2.json'), '--out-dir', out2]);
  const mf = path.join(out2, fs.readdirSync(out2).filter((f) => /^calibration-report-\d{8}\.md$/.test(f))[0]);
  const md = fs.readFileSync(mf, 'utf8');
  assert.match(md, /n\/a（缺 stage4 读数件/, '缺件标 n/a');
  assert.ok(md.indexOf('0.2499') === -1, 'n/a 情况不编数');
});
