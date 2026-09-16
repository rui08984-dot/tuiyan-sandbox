'use strict';
/**
 * p1b/test/forecast-calendar.test.cjs —— P0-U7 测试（2026-09-16）
 * ①spawn→due.json→calendar 三段链（桩 daemon ＋ 临时目录隔离）；
 * ②桶守恒（各桶之和=总行数，不用魔法数）；③双源比对计数=行数；④禁词黑名单（无「预测」）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'forecast-calendar.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-cal-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

const STUB = path.join(tmpDir, 'stub-daemon.cjs');
const STUB_DUE = path.join(tmpDir, 'due.json');
fs.writeFileSync(STUB, [
  "'use strict';",
  "const fs = require('fs');",
  "const out = process.env.STUB_DUE_OUT;",
  "fs.writeFileSync(out, JSON.stringify({ generated_at: 'stub', today: '2026-09-16', rows: 0, byDay: {}, byMonth: {}, bySrc: { stub: 0 }, byKind: {}, undatable: 0, undKinds: {} }), 'utf8');",
  "console.log('[stub-daemon] wrote ' + out);",
].join('\n'), 'utf8');

function run(extraArgs, env) {
  return execFileSync(process.execPath, [SCRIPT].concat(extraArgs), { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
}

test('① 三段链：spawn(桩 daemon) → due.json → calendar 件（临时目录隔离）', () => {
  assert.ok(!fs.existsSync(STUB_DUE), '前置：due.json 不存在');
  const out = run(['--spawn', '--daemon-cmd', STUB, '--due-json', STUB_DUE, '--out-dir', tmpDir], { STUB_DUE_OUT: STUB_DUE });
  assert.ok(fs.existsSync(STUB_DUE), '桩 daemon 已产出 due.json');
  assert.match(out, /待验证队列日历/);
  const files = fs.readdirSync(tmpDir).filter((f) => /^forecast-calendar-\d{8}\.(json|md)$/.test(f));
  assert.ok(files.some((f) => f.endsWith('.json')) && files.some((f) => f.endsWith('.md')), '日历 json/md 落盘: ' + files.join(','));
});

test('② 桶守恒：各桶之和 = 未解总行数（真实库只读）', () => {
  const out = run(['--due-json', STUB_DUE, '--out-dir', tmpDir]);
  assert.match(out, /待验证队列日历/);
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^forecast-calendar-\d{8}\.json$/.test(f))[0]), 'utf8'));
  const b = j.buckets;
  const sum = Object.keys(b.day_window).reduce((s, k) => s + b.day_window[k], 0)
    + Object.keys(b.week_window).reduce((s, k) => s + b.week_window[k], 0) + b.gt30 + b.undatable_ledger;
  assert.equal(sum, j.rows, '桶守恒：' + sum + ' vs rows ' + j.rows);
  assert.equal(j.conservation.sum, j.conservation.rows, '守恒自检一致');
});

test('③ 双源比对计数守恒：agree+mismatch+ledger_only+evidence_only+both_none = 行数', () => {
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^forecast-calendar-\d{8}\.json$/.test(f))[0]), 'utf8'));
  const d = j.dual_source_row;
  const sum = d.agree + d.mismatch_n + d.ledger_only_n + d.evidence_only_n + d.both_none;
  assert.equal(sum, j.rows, '双源计数守恒：' + sum + ' vs rows ' + j.rows);
  assert.ok(d.rule.indexOf('只披露不裁决') >= 0, '规则文案在');
});

test('④ 禁词黑名单：日历披露件正文不含「预测」', () => {
  const mdFile = fs.readdirSync(tmpDir).filter((f) => /^forecast-calendar-\d{8}\.md$/.test(f))[0];
  const md = fs.readFileSync(path.join(tmpDir, mdFile), 'utf8');
  assert.ok(md.indexOf('预测') === -1, '正文出现禁词「预测」');
  assert.match(md, /待验证队列日历/, '标题用「待验证队列」');
});
