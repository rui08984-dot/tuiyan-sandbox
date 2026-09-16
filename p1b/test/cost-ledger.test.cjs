'use strict';
/**
 * p1b/test/cost-ledger.test.cjs —— 成本台账链路测试（蓝图 §2.2#6 · 2026-09-17）
 * ① usageSink：未配置＝不落盘；配置后只写计数（**绝不含正文/密钥**）；
 * ② llmChat 接线：P1B_USAGE_SINK 设定时，chatText 调用后 sink 追加一行（含 cached_tokens）；
 * ③ cost-ledger：合成 sink ⇒ 总量/输入占比/F7 判据；空 sink ⇒ n/a；生产库 sha 不变（零写库）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LEDGER = path.join(ROOT, 'p1b', 'scripts', 'cost-ledger.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-cost-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const { record } = require(path.join(ROOT, 'p1b', 'src', 'lib', 'usageSink'));

test('① usageSink：未配置不落盘；配置后只写计数（无正文/密钥字段）', () => {
  const old = process.env.P1B_USAGE_SINK; delete process.env.P1B_USAGE_SINK;
  const r0 = record({ model: 'x', prompt_tokens: 1, completion_tokens: 1 });
  assert.equal(r0.recorded, false, '未配置却落盘');
  const f = path.join(tmpDir, 'u.jsonl');
  const r1 = record({ model: 'glm', prompt_tokens: 10, completion_tokens: 2, cached_tokens: 4, secret: 'SHOULD_NOT_APPEAR' }, f);
  assert.equal(r1.recorded, true);
  const line = JSON.parse(fs.readFileSync(f, 'utf8').trim());
  assert.deepEqual(Object.keys(line).sort(), ['at', 'cached_tokens', 'completion_tokens', 'model', 'note', 'prompt_tokens'].sort());
  assert.equal(line.prompt_tokens, 10); assert.equal(line.cached_tokens, 4);
  assert.ok(!fs.readFileSync(f, 'utf8').includes('SHOULD_NOT_APPEAR'), 'sink 混入了非计数内容');
  if (old !== undefined) process.env.P1B_USAGE_SINK = old;
});

test('② llmChat 接线：设定 P1B_USAGE_SINK 后调用即追加（含 cached_tokens）', async () => {
  const f = path.join(tmpDir, 'chat.jsonl');
  const old = process.env.P1B_USAGE_SINK; process.env.P1B_USAGE_SINK = f;
  try {
    const { chatText } = require(path.join(ROOT, 'p1b', 'src', 'lib', 'llmChat.js'));
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } } }) });
    await chatText([{ role: 'user', content: 'hi' }], { apiKey: 'k', baseUrl: 'http://x', fetchImpl: fakeFetch });
    const line = JSON.parse(fs.readFileSync(f, 'utf8').trim());
    assert.equal(line.prompt_tokens, 7); assert.equal(line.completion_tokens, 3); assert.equal(line.cached_tokens, 5);
  } finally { if (old === undefined) delete process.env.P1B_USAGE_SINK; else process.env.P1B_USAGE_SINK = old; }
});

test('③ cost-ledger：合成 sink ⇒ 占比与 F7 判据；空 sink ⇒ n/a；生产库 sha 不变', () => {
  const before = sha(PROD);
  const f = path.join(tmpDir, 'led.jsonl');
  fs.writeFileSync(f, [
    { at: '2026-09-17T01:00:00Z', model: 'm1', prompt_tokens: 900, completion_tokens: 100, cached_tokens: 400 },
    { at: '2026-09-17T01:01:00Z', model: 'm1', prompt_tokens: 900, completion_tokens: 100, cached_tokens: 0 },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  execFileSync(process.execPath, [LEDGER, '--sink', f, '--out-dir', tmpDir], { stdio: 'ignore' });
  const j1 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cost-ledger-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json'), 'utf8'));
  assert.equal(j1.totals.calls, 2); assert.equal(j1.total_tokens, 2000);
  assert.equal(j1.input_share, 0.9);
  assert.equal(j1.f7_rule.input_share_over_threshold, true, '90% 输入占比应触发 F7 提示');
  execFileSync(process.execPath, [LEDGER, '--sink', path.join(tmpDir, 'nope.jsonl'), '--out-dir', tmpDir], { stdio: 'ignore' });
  const j2 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cost-ledger-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json'), 'utf8'));
  assert.equal(j2.totals.calls, 0); assert.match(j2.status, /n\/a/);
  assert.equal(sha(PROD), before, '台账改动了生产库');
});
