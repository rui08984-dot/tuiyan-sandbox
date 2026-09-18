'use strict';
/**
 * p1b/test/mdl-retention.test.cjs —— 18⑥ MDL 两部码留位判据 ＋ 效度回放 测试（2026-09-17）
 *
 * ① 纯函数：对数分／数据部分 A 的方向／ΔL 符号（**死件 ⇒ ΔL<0 ⇒ 剪**）／临界 k*
 * ② ★符号更正回归锁：死件判剪、有用件判留（判据不是「一律剪」的是机器）
 * ③ 真实件：六格交叉核对通过｜效度靶 A→B 两窗 CI 含 0 ∧ k=1 判剪｜靶标记正确
 * ④ 三零：零账本写（生产库 sha 不变）｜零网络（源码无 fetch）｜require 零副作用
 * ⑤ 确定性：同种子两次 CI 逐位相同
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'mdl-retention.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-mdl-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const M = require(SCRIPT);

test('① 纯函数：对数分／数据部分 A／ΔL 符号／临界 k*', () => {
  assert.ok(Math.abs(M.logScore(0.5, 1) - Math.log(0.5)) < 1e-12);
  assert.ok(Math.abs(M.logScore(0.5, 0) - Math.log(0.5)) < 1e-12);
  assert.ok(isFinite(M.logScore(0, 1)) && isFinite(M.logScore(1, 0)), '夹取后须有限（不许 −Inf）');
  // A>0 ⟺ 含该对象更好
  const better = [{ y: 1, pWith: 0.9, pWithout: 0.6 }, { y: 0, pWith: 0.1, pWithout: 0.4 }];
  assert.ok(M.dataDeltaL(better) > 0, '含者更好 ⇒ A>0');
  assert.ok(M.dataDeltaL(better.map((r) => ({ y: r.y, pWith: r.pWithout, pWithout: r.pWith }))) < 0, '方向对调 ⇒ A<0');
  assert.equal(M.dataDeltaL([{ y: 1, pWith: 0.7, pWithout: 0.7 }]), 0, '死件 ⇒ A=0');
  // ΔL = A − (ln n)/2·k：死件 ⇒ ΔL<0 ⇒ 剪（符号更正锁死）
  const n = 400, P = Math.log(n) / 2;
  assert.ok(M.twoPartDL(0, n, 1) < 0, '死件须判剪（ΔL<0）');
  assert.ok(Math.abs(M.twoPartDL(0, n, 1) + P) < 1e-12, 'ΔL = −P');
  assert.equal(M.breakEvenK(0, n), 0, '死件 k*=0（任何 k≥0 都判剪）');
});

test('② ★判据有鉴别力：死件判剪、有用件判留（回归锁）', () => {
  const n = 300, P = Math.log(n) / 2;
  const dead = 0, useful = 5 * P;             // 有用件的数据部分 ＝ 5 个参数份的罚（⇒ k*=5）
  assert.equal(M.twoPartDL(dead, n, 1) <= 0 ? '剪' : '留', '剪', '死件应判剪');
  assert.equal(M.twoPartDL(useful, n, 1) <= 0 ? '剪' : '留', '留', '有用件应判留');
  assert.ok(Math.abs(M.breakEvenK(useful, n) - 5) < 1e-9, 'k* 应 ＝ 5: ' + M.breakEvenK(useful, n));
  assert.ok(M.twoPartDL(useful, n, 4) > 0, 'k=4 < k* ⇒ 留');
  assert.ok(M.twoPartDL(useful, n, 6) <= 0, 'k=6 > k* ⇒ 剪（临界点两侧翻转，判据随 k 单调）');
});

test('③ 真实件：六格交叉核对＋效度靶＋三零＋零副作用', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir], { encoding: 'utf8' });
  assert.equal(sha(PROD), before, '生产库被改动（应零写库）');
  // ★ 文件名带**当天**日期（脚本用 UTC 日期命名）⇒ 测试**不得写死日期**，否则跨日即红（2026-09-18 实测）。
  const arts = fs.readdirSync(tmpDir).filter((f) => /^mdl-retention-\d{8}\.json$/.test(f));
  assert.equal(arts.length, 1, '应恰好产出一份读数件: ' + JSON.stringify(arts));
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, arts[0]), 'utf8'));
  assert.equal(j.cross_check_pass, true, '六格交叉核对须通过');
  assert.equal(j.cross_check.length, 6, '六格齐');
  for (const c of j.cross_check) assert.ok(c.exact_match === true || c.reconciled_match === true, c.window + '/' + c.pair + ' 未对账');
  assert.equal(j.validity_pass, true, '效度回放须 PASS');
  assert.equal(j.validity_target, 'A→B（两窗）');
  const targets = j.replay_main.filter((r) => r.is_validity_target);
  assert.equal(targets.length, 2, '效度靶应两窗各一格');
  for (const t of targets) { assert.equal(t.ci_contains_0, true, t.label + ' 靶格 CI 须含 0'); assert.equal(t.verdict_k1, '剪', t.label + ' 靶格 k=1 须判剪'); }
  // B→C full 是官方唯一显著格 ⇒ 判据也应判「留」（方向一致）
  const bcf = j.replay_main.find((r) => r.label === 'full/B→C');
  assert.equal(bcf.ci_contains_0, false, 'B→C full 应显著（sham 有效性证据）');
  assert.equal(bcf.verdict_k1, '留', '显著格不应被判剪');
  assert.equal(j.discipline.ledger_write, false);
  assert.equal(j.discipline.network, false);
  assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(SCRIPT, 'utf8')), '脚本不应含 fetch（零网络）');
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const s0 = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), s0, 'require 本件不得写盘（主流程应只在 CLI 直跑时执行）');
});

test('④ 确定性：同种子两次 CI 逐位相同；换种子换流', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ y: i % 3 === 0 ? 1 : 0, pWith: 0.4 + (i % 5) * 0.05, pWithout: 0.5 });
  const a = M.bootCI(rows, (s) => M.dataDeltaL(s), 300, 4242);
  const b = M.bootCI(rows, (s) => M.dataDeltaL(s), 300, 4242);
  const c = M.bootCI(rows, (s) => M.dataDeltaL(s), 300, 9999);
  assert.equal(a.lo, b.lo, '同种子须可复现（lo）');
  assert.equal(a.hi, b.hi, '同种子须可复现（hi）');
  assert.notEqual(a.lo, c.lo, '换种子应换流');
});
