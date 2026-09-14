'use strict';
/**
 * p1b/test/g2-hcal-expand.test.cjs —— ② 采信链规则②「校准 n≥35」补样通道（2026-09-14 新增）
 *
 * 锁三件事（与出表/记账两端对应）：
 *   ① 选择器：排除首轮 14 条、取满 N、可复现（同 seed 同结果）、全部落在校准池内；
 *   ② 理由必填：空理由 ⇒ 拒收（exit≠0）且不写盘——防「凑数全过」；
 *   ③ 记账：n 正确累加、acceptance 按规则重算；重复记账被拒（幂等，不重复计数）。
 *
 * 铁律：零网络；只写临时 JSON（不碰生产库/8787/真实 audit 文件）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'g2-hcal-expand.cjs');
const REAL_AUDIT = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4.json');
const R1 = [466, 476, 480, 486, 490, 524, 540, 542, 1331, 1627, 948, 1835, 1839, 1846];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-hcal-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

function emitIds(outFile, auditPath) {
  const args = [SCRIPT, '--emit', '--n', '21', '--out', outFile];
  if (auditPath) args.push('--audit', auditPath);
  execFileSync(process.execPath, args, { stdio: 'ignore' });
  const txt = fs.readFileSync(outFile, 'utf8');
  return (txt.match(/^## \d+\. id=(\d+)/gm) || []).map((s) => Number(s.match(/id=(\d+)/)[1]));
}

test('--emit：补样 21 项、排除首轮 14 条、全部落在校准池、同 seed 可复现', () => {
  const a = emitIds(path.join(tmpDir, 'sheet-a.md'));
  const b = emitIds(path.join(tmpDir, 'sheet-b.md'));
  assert.equal(a.length, 21, '取满 21 项');
  assert.deepEqual(a, b, '同 seed ⇒ 同样本（可复现）');
  for (const id of a) assert.ok(R1.indexOf(id) === -1, 'id=' + id + ' 不在首轮 14 条内');
  const audit = JSON.parse(fs.readFileSync(REAL_AUDIT, 'utf8'));
  const pool = (audit.meta.sampling.calibration.ids || []);
  for (const id of a) assert.ok(pool.indexOf(id) !== -1, 'id=' + id + ' 在校准池内');
});

test('--record：空理由 ⇒ 拒收（exit≠0）且不写盘（防凑数全过）', () => {
  const src = fs.readFileSync(REAL_AUDIT, 'utf8');
  const copy = path.join(tmpDir, 'audit-empty.json');
  fs.writeFileSync(copy, src);
  const ids = emitIds(path.join(tmpDir, 'sheet-empty.md'));
  const lines = ['# id\tverdict\treason'];
  for (const id of ids) lines.push(id + '\tPASS\t'); // 理由为空
  const tsv = path.join(tmpDir, 'empty-reason.tsv');
  fs.writeFileSync(tsv, lines.join('\n') + '\n');
  const outJson = path.join(tmpDir, 'should-not-exist.json');
  let failed = false;
  try {
    execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', copy, '--out', outJson], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
    assert.notEqual(e.status, 0, '非零退出');
    assert.ok(/缺理由/.test(String(e.stderr)), '报错说明缺理由');
  }
  assert.ok(failed, '空理由必须被拒收');
  assert.ok(!fs.existsSync(outJson), '拒收时不写盘');
  assert.equal(fs.readFileSync(REAL_AUDIT, 'utf8'), src, '真实 audit 零改动');
});

test('--record：21 项全过 ⇒ n=35 且 acceptance 重算；重复记账被拒（幂等）', () => {
  const src = fs.readFileSync(REAL_AUDIT, 'utf8');
  // 固定基线夹具：真实 audit 会随历史推进变化（本测试曾在 n 已=35 时误判），故归一化为「首轮 14 条、无补样」再测
  const fixture = JSON.parse(src);
  const hc0 = Object.assign({}, fixture.human_calibration);
  hc0.n = 14; hc0.agreed = 14; hc0.rate = 1; hc0.acceptance_status = 'pending_recheck'; hc0.accepted = false;
  delete hc0.hcal_expand;
  fixture.human_calibration = hc0;
  const copy = path.join(tmpDir, 'audit-rec.json');
  fs.writeFileSync(copy, JSON.stringify(fixture, null, 1));
  assert.equal(hc0.user_spot_check_effective, 10, '前提：端用户抽验 effective=10（by=user）');
  const ids = emitIds(path.join(tmpDir, 'sheet-rec.md'), copy); // 从**夹具**出表：保证样本内 id 与夹具的 allowed 集一致
  const lines = ['# id\tverdict\treason'];
  for (const id of ids) lines.push(id + '\tPASS\t复核：判据明确、真值锚齐、cutoff 早于事件日、基率非恒定');
  const tsv = path.join(tmpDir, 'filled.tsv');
  fs.writeFileSync(tsv, lines.join('\n') + '\n');
  const out1 = path.join(tmpDir, 'recorded1.json');
  execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', copy, '--out', out1], { stdio: 'ignore' });
  const a = JSON.parse(fs.readFileSync(out1, 'utf8'));
  const hc = a.human_calibration;
  assert.equal(hc.n, 35, 'n = 14 + 21');
  assert.equal(hc.agreed, 35, 'agreed = 14 + 21');
  assert.equal(hc.hcal_expand.added, 21, '补样计数=21');
  assert.equal(hc.hcal_expand.detail.length, 21, '逐项理由留痕');
  assert.ok(hc.hcal_expand.detail.every((d) => d.reason && d.reason.length > 0), '理由非空');
  assert.equal(hc.acceptance_status, 'accepted', 'n=35 全过 ⇒ accepted');
  assert.equal(hc.accepted, true, 'accepted 布尔同步');
  assert.ok(/代理/.test(hc.disclosure) && /不得声称全人工/.test(hc.disclosure), '代理执行如实披露');
  assert.equal(a.meta.review_composition.human_calibration, 35, '复核构成同步（human_calibration=35）');
  assert.equal(a.meta.review_composition.hcal_expand_agent, 21, '补样单列计数=21');
  // 幂等：以第一次的产物为输入再记账 ⇒ 拒收、不重复计数
  const out2 = path.join(tmpDir, 'recorded2.json');
  let failed = false;
  try {
    execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', out1, '--out', out2], { stdio: 'pipe' });
  } catch (e) { failed = true; assert.ok(/防重复记账/.test(String(e.stderr)), '报错说明重复'); }
  assert.ok(failed, '重复记账必须被拒');
  assert.ok(!fs.existsSync(out2), '重复记账不写盘');
  assert.equal(fs.readFileSync(REAL_AUDIT, 'utf8'), src, '真实 audit 零改动');
});
