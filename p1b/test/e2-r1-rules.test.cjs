'use strict';
/**
 * p1b/test/e2-r1-rules.test.cjs —— E2·R1 规则冻结核验＋人口计数 测试（2026-09-17）
 *
 * ① 纯函数 r1aDecide：no-op／改层（按 design 优先级 L5>L6>L1>L3>L2 取最特殊）／降档
 * ② ★冻结守卫：篡改冻结件正文后运行 ⇒ 必须被拒（exit 3，不产读数）——锁 M5①「冻结先于读数」
 * ③ 真实件：sha MATCH｜R1-A 改层 0／降档 27｜R1-B 保留 7 格（与阶段 4「可出结论 7 格」同集合）｜零臂读数
 * ④ 三零：零账本写／零网络／require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'e2-r1-rules.cjs');
const RULES = path.join(ROOT, '.scratch', 'forecast-debate', 'E2-R1-规则版-v1-冻结件-20260917.md');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-r1-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const M = require(SCRIPT);

test('① r1aDecide：no-op／改层（优先级）／降档', () => {
  assert.equal(M.r1aDecide('L3', ['L3', 'L2']).action, 'no-op', '本层可估 ⇒ no-op');
  assert.deepEqual(M.r1aDecide('L2', ['L5', 'L2']).action, 'no-op', '本层可估优先于其他');
  // 本层不可估 ⇒ 按 design 优先级取最特殊：L5 > L6 > L1 > L3 > L2
  assert.equal(M.r1aDecide('L2', ['L6', 'L1']).layer, 'L6', 'L6 优先于 L1');
  assert.equal(M.r1aDecide('L2', ['L1', 'L3']).layer, 'L1', 'L1 优先于 L3');
  assert.equal(M.r1aDecide('L6', ['L3', 'L2']).layer, 'L3', 'L3 优先于 L2');
  assert.equal(M.r1aDecide('L2', ['L5', 'L2']).action, 'no-op');
  assert.equal(M.r1aDecide('L1', ['L5']).layer, 'L5', 'L5 最特殊');
  // 无引擎 ⇒ 降档
  assert.equal(M.r1aDecide('L2', []).action, 'downgrade');
  assert.equal(M.r1aDecide('L3', []).layer, null);
  assert.deepEqual(M.PRIORITY, ['L5', 'L6', 'L1', 'L3', 'L2'], '优先级须与 design §1.2 一致');
});

test('② ★冻结守卫：篡改冻结件 ⇒ 必须被拒（exit 3，不出读数）', () => {
  const tampered = path.join(tmpDir, 'E2-R1-规则版-v1-篡改件.md');
  const orig = fs.readFileSync(RULES, 'utf8');
  fs.writeFileSync(tampered, orig.replace('R1 只做「错配纠正 + 低信号降档」', 'R1 也做择优') + '\n<!-- tampered -->\n', 'utf8');
  assert.notEqual(fs.readFileSync(tampered, 'utf8'), orig, '篡改须生效（否则测试无意义）');
  let code = 0, out = '';
  try { execFileSync(process.execPath, [SCRIPT, '--rules', tampered, '--out-dir', tmpDir], { encoding: 'utf8' }); }
  catch (e) { code = e.status; out = String(e.stderr || '') + String(e.stdout || ''); }
  assert.equal(code, 3, '篡改件必须 exit 3（实测 status=' + code + '）');
  assert.ok(/未 MATCH/.test(out), '应报 sha 未 MATCH: ' + out.slice(0, 120));
  const produced = fs.readdirSync(tmpDir).filter((f) => /^e2-r1-rules-/.test(f));
  assert.equal(produced.length, 0, '被拒时不得写出读数件');
});

test('③ 真实件：MATCH／人口／保留格与阶段 4 同集合／无臂读数', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir, '--boot', '200'], { encoding: 'utf8' });
  assert.equal(sha(PROD), before, '生产库被改动（应零写库）');
  // ★ 文件名带**当天**日期（脚本用 UTC 日期命名）⇒ 测试**不得写死日期**，否则跨日即红（2026-09-18 实测）。
  //   改法：在本次专属 tmpDir 里按前缀取唯一产出件（同文件 ② 的既有写法）。
  const arts = fs.readdirSync(tmpDir).filter((f) => /^e2-r1-rules-\d{8}\.json$/.test(f));
  assert.equal(arts.length, 1, '应恰好产出一份读数件: ' + JSON.stringify(arts));
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, arts[0]), 'utf8'));
  assert.equal(j.rules_match, true, '冻结核验须 MATCH');
  assert.equal(j.rules_sha256, 'e0331cf8e7237a8a0b6eed9f6393866d9b6008e2a64210f723fc699beeceb4bf', '冻结 sha 锁死');
  assert.equal(j.r1a_counts.reassign, 0, 'R1-A 改层应为 0（分配与引擎可用性一致）');
  assert.equal(j.r1a_counts['no-op'] + j.r1a_counts.reassign + j.r1a_counts.downgrade, j.cohort, '三态合计＝队列');
  const kept = j.r1b_cells.filter((c) => c.kept).map((c) => c.cell).sort();
  // ★ 数据标记（随账本增长更新）：2026-09-17 结算 183 条 ⇒ 保留格 7 → 8（新增 L2/wikimedia n=38，与阶段 4 同步）
  assert.equal(kept.length, 8, '保留格应为 8（与阶段 4「可出结论 8 格」同集合）: ' + JSON.stringify(kept));
  for (const c of ['L1/werewolf_sim', 'L2/dbnomics', 'L2/energycharts', 'L2/noaa', 'L2/wikimedia', 'L3/openmeteo', 'L5/cwl', 'L6/werewolf_sim']) {
    assert.ok(kept.indexOf(c) !== -1, '应含 ' + c);
  }
  // RES 条款当前非绑定：所有降档格都是因 n<30
  for (const c of j.r1b_cells.filter((x) => !x.kept)) assert.ok(/n<30/.test(c.reason), c.cell + ' 降档理由应为 n<30: ' + c.reason);
  assert.equal(j.discipline.arms_reading_run, false, '不得跑臂读数');
  assert.equal(j.discipline.ledger_write, false);
  assert.equal(j.discipline.network, false);
  assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(SCRIPT, 'utf8')), '不应含 fetch（零网络）');
});

test('④ require 零副作用（主流程只在 CLI 直跑）', () => {
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const s0 = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), s0, 'require 本件不得写盘');
});
