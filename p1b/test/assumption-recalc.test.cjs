'use strict';
/**
 * p1b/test/assumption-recalc.test.cjs —— A1 假设重算器 v0 测试（2026-09-17）
 * ① 金样回归：无排除 ⇒ 排除后读数与基线**逐位一致**（蓝图判据「金样零 diff」）；
 * ② 纯函数精确性：加权扣除数学正确（合成 3 格）；
 * ③ 真实件：排除 cell:L3/openmeteo ⇒ L3 评估人口归零且标 n/a（不编数）；
 * ④ 探索性标注恒挂＋禁词 0＋零写库（生产库 sha 不变）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'assumption-recalc.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-a1-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const run = (args) => execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir].concat(args || []), { encoding: 'utf8' });
const readJson = () => JSON.parse(fs.readFileSync(path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^assumption-recalc-\d{8}\.json$/.test(f))[0]), 'utf8'));
const readMd = () => fs.readFileSync(path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^assumption-recalc-\d{8}\.md$/.test(f))[0]), 'utf8');

test('① 金样回归：无排除 ⇒ 排除后与基线逐位一致（金样零 diff）', () => {
  const before = sha(PROD);
  run([]);
  const j = readJson();
  let checked = 0;
  for (const L of Object.keys(j.layers)) {
    const o = j.layers[L];
    if (o.base.brier === null) continue;
    assert.equal(o.excluded.brier, o.base.brier, L + ' 基线/排除后不一致');
    assert.equal(o.excluded.n_dropped, 0, L + ' 无排除却扣了样本');
    checked++;
  }
  assert.ok(checked >= 4, '可核层数过少: ' + checked);
  assert.equal(sha(PROD), before, '生产库被改动（应零写库）');
});

test('② 纯函数：加权扣除数学精确（合成 3 格）', () => {
  const { recalcLayer } = require(SCRIPT);
  const mk = (layer, domain, n, b) => ({ layer: layer, domain: domain, scored_n: n, brier_engine: b, delta_vs_half: 0, obs_rate: 0.5 });
  const list = [mk('L9', 'a', 100, 0.2), mk('L9', 'b', 200, 0.3), mk('L9', 'c', 50, 0.5)];
  const base = recalcLayer(list, []);
  assert.equal(base.n, 350);
  assert.ok(Math.abs(base.brier - (100 * 0.2 + 200 * 0.3 + 50 * 0.5) / 350) < 1e-12, '基线加权错误');
  const ex = recalcLayer(list, ['L9/b']);
  assert.equal(ex.n, 150); assert.equal(ex.n_dropped, 200);
  assert.ok(Math.abs(ex.brier - (100 * 0.2 + 50 * 0.5) / 150) < 1e-12, '扣除加权错误: ' + ex.brier);
  const all = recalcLayer(list, ['L9/a', 'L9/b', 'L9/c']);
  assert.equal(all.brier, null); assert.match(all.note, /n\/a/);
});

test('③ 真实件：排除 L3/openmeteo ⇒ L3 评估人口归零并标 n/a（不编数）', () => {
  run(['--exclude', 'cell:L3/openmeteo']);
  const j = readJson();
  assert.ok(j.excludes.cell.indexOf('L3/openmeteo') !== -1, '排除项未记录');
  const l3 = j.layers.L3;
  assert.equal(l3.excluded.brier, null, '应 n/a');
  assert.ok(l3.excluded.n_dropped > 300, '扣除样本应 >300: ' + l3.excluded.n_dropped);
  assert.match(l3.excluded.note, /n\/a/);
});

test('④ 探索性标注恒挂＋禁词 0＋口径写明', () => {
  const md = readMd();
  assert.match(md, /探索性/, '缺探索性标注');
  assert.match(md, /不载判据|不进任何门控/, '缺不载判据声明');
  assert.ok(md.indexOf('预测') === -1, '正文出现禁词');
  assert.match(md, /CI 不重算/, '缺 CI 不重算声明');
});

test('⑤ require 零副作用：子进程 require 本件 ⇒ sim/out 不新增/不改动任何件', () => {
  const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
  const snap = () => fs.readdirSync(SIMOUT).sort()
    .map((f) => { const s = fs.statSync(path.join(SIMOUT, f)); return f + ':' + s.size + ':' + s.mtimeMs; }).join('\n');
  const before = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), before, 'require 脚本产生写盘副作用（主流程应只在 CLI 直跑时执行）');
});
