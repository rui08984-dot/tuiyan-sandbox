'use strict';
/**
 * p1b/test/result-cache.test.cjs —— 结果缓存键＋预检测试（蓝图 §2.1#7 · 2026-09-17）
 * ① 键确定性：同输入同键；空白差异归一同键；
 * ② 键敏感性：evidence / prompt 版本 / 温度任一变化 ⇒ 键变（防串结果）；不同题面 ⇒ 键变；
 * ③ 预检实跑：跨题键必须为 0（安全判据）；行数>0；生产库 sha256 不变（零写库）；md 含判读与禁词 0。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PRECHECK = path.join(ROOT, 'p1b', 'scripts', 'result-cache-precheck.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const { cacheKey } = require(path.join(ROOT, 'p1b', 'src', 'lib', 'resultCache'));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-rc-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const base = { statement: '上海 09-14 日最高气温超过 35 度吗？', evidenceJson: '{"resolve":{"kind":"openmeteo_daily_max"}}', promptVariant: 'v1_evidence', temperature: 0.2, promptVersion: 'v1' };

test('① 键确定性：同输入同键；空白差异归一', () => {
  assert.equal(cacheKey(base), cacheKey(base));
  assert.equal(cacheKey(base), cacheKey({ ...base, statement: '  上海   09-14 日最高气温超过 35 度吗？\n' }), '空白未归一');
});

test('② 键敏感性：evidence/prompt版本/温度/题面任一变化 ⇒ 键变', () => {
  const k = cacheKey(base);
  assert.notEqual(cacheKey({ ...base, evidenceJson: base.evidenceJson + ' ' }), k, 'evidence 未入键');
  assert.notEqual(cacheKey({ ...base, promptVersion: 'v2' }), k, 'prompt 版本未入键');
  assert.notEqual(cacheKey({ ...base, temperature: 0.7 }), k, '温度未入键');
  assert.notEqual(cacheKey({ ...base, statement: '北京 09-14 日最高气温超过 35 度吗？' }), k, '题面未入键');
  assert.notEqual(cacheKey({ ...base, promptVariant: 'v2_skeptical' }), k, '变体未入键');
});

test('③ 预检实跑：跨题键=0（安全）＋ 零写库 ＋ 判读在盘', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [PRECHECK, '--out-dir', tmpDir], { stdio: 'ignore' });
  const jf = path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^result-cache-precheck-\d{8}\.json$/.test(f))[0]);
  const mf = path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^result-cache-precheck-\d{8}\.md$/.test(f))[0]);
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  assert.ok(j.rows > 0, '无历史判词');
  assert.equal(j.cross_item_keys, 0, '跨题键 >0（禁止上线）：' + j.cross_item_keys);
  assert.equal(j.judgement.cross_item_safe, true);
  const md = fs.readFileSync(mf, 'utf8');
  assert.match(md, /跨题安全/);
  assert.ok(md.indexOf('预测') === -1, '正文出现禁词');
  assert.equal(sha(PROD), before, '预检改动了生产库');
});
