'use strict';
/**
 * p1b/test/u8-columns.test.cjs —— U8 加列（KL/Murphy/prequential）测试（P0+ · 2026-09-16）
 * ① 三列齐备＋Murphy 恒等式自检（<1e-9）；② 确定性（同输入两次逐位相等）；③ 零写库（生产库 sha 前后不变）；④ L1 按语义排除。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'u8-columns.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-u8c-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const run = () => { execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir], { stdio: 'ignore' });
  return JSON.parse(fs.readFileSync(path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^u8-columns-\d{8}\.json$/.test(f))[0]), 'utf8')); };

test('① 三列齐备（L2/L3/L5/L6）＋ Murphy 恒等式残差 <1e-9', () => {
  const before = sha(PROD);
  const j = run();
  for (const L of ['L2', 'L3', 'L5', 'L6']) {
    const r = j.layers[L];
    assert.ok(r, L + ' 层缺失');
    assert.ok(r.scored_n > 0, L + ' n>0');
    if (r.scored_n >= 30) {
      assert.ok(typeof r.brier === 'number' && typeof r.kl_to_base === 'number', L + ' 三列缺失');
      assert.ok(r.murphy && r.murphy.identity_gap < 1e-9, L + ' Murphy 恒等式残差: ' + (r.murphy && r.murphy.identity_gap));
      assert.ok(r.prequential && r.prequential.points.length >= 2 && typeof r.prequential.final === 'number', L + ' prequential 缺');
    } else assert.ok(/n<30/.test(r.note || ''), L + ' 薄层应只报 n');
  }
  assert.equal(sha(PROD), before, '库文件被改动（应零写库）');
});

test('② 确定性：两次运行逐位相等', () => {
  const a = run(); const b = run();
  delete a.generated_at; delete b.generated_at;
  assert.deepEqual(a.layers, b.layers, '两次读数不一致');
});

test('③ L1 按语义排除（决定论层不进概率分解）＋ 口径定义在件内写明', () => {
  const j = run();
  assert.equal(j.layers.L1, undefined, 'L1 不应出现');
  assert.match(j.l1_excluded, /决定论/);
  assert.match(j.kl_definition, /只披露|披露/);
  assert.match(j.murphy_definition, /REL/);
  assert.match(j.prequential_definition, /resolved_at/);
});
