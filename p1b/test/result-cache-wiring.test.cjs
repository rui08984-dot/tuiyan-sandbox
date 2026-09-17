'use strict';
/**
 * p1b/test/result-cache-wiring.test.cjs —— 结果缓存**生产接线**测试（2026-09-17 第十九批 · 蓝图 §2.1#7 尾巴）
 *
 * 不变量（逐条）：
 *   ① **默认关闭**：env `P1B_RESULT_CACHE_DIR` 未设 ⇒ 零行为变化（`cache_hit` 恒 false、不建缓存目录）；
 *   ② **命中即省调用**：设了 env ⇒ 同题同参数第二次 POST **不调 LLM**（`cache_hit=true`，fetch 计数不增）；
 *   ③ **键严格性**（本接线的关键安全性质）：**证据窗不同 ⇒ 提示词不同 ⇒ 必须 miss**
 *      （冻结的 `cacheKey()` 在该路径上会撞键 ⇒ 故本接线用 `keyOfMessages()`）；
 *   ④ 缓存只影响**调用**，不影响**落库**（verdicts 行照写，run_id 语义不变）。
 * 纪律：DB=:memory:；LLM 走注入的假 fetchImpl（零网络）；env 用后即删（不污染其它测试）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-cache-providers-' + process.pid + '-' + Date.now() + '.json');
const tmpCache = path.join(os.tmpdir(), 'p1b-test-cache-store-' + process.pid + '-' + Date.now());
let calls = 0;
const fakeFetch = async () => {
  calls++;
  return {
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: '分析：本路视角。\nRange: 35%-45%\nP=0.42' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'fake-model' }),
  };
};

test.before(() => {
  fs.writeFileSync(tmpProviders, JSON.stringify({ active: 'fake', providers: { fake: { api_key: 'test-key', base_url: 'http://127.0.0.1:9', cards: { model: 'fake-model' } } } }), 'utf8');
});
test.after(() => {
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { fs.rmSync(tmpCache, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
  delete process.env.P1B_RESULT_CACHE_DIR;
});

async function newServer() { return buildServer({ dbPath: ':memory:', providersPath: tmpProviders, fetchImpl: fakeFetch }); }

test('① 默认关闭：env 未设 ⇒ cache_hit 恒 false、不建缓存目录', async () => {
  delete process.env.P1B_RESULT_CACHE_DIR;
  const app = await newServer();
  try {
    let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '缓存局', type: 'werewolf', player_count: 6 } });
    const gid = r.json().game.id;
    r = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions', payload: { statement: '缓存测试题', prob: 0.5 } });
    const pid = r.json().id;
    calls = 0;
    const v = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions/' + pid + '/verdicts' });
    assert.equal(v.statusCode, 200);
    const b = v.json();
    assert.equal(b.mode, 'live', '须走真 LLM 路径（注入的假 fetch）');
    assert.equal(b.saved.length, 3);
    assert.ok(b.saved.every((s) => s.cache_hit === false), 'env 未设 ⇒ cache_hit 必须全 false');
    assert.equal(calls, 3, '三路各调一次');
    assert.equal(fs.existsSync(tmpCache), false, 'env 未设 ⇒ 不得建缓存目录');
  } finally { await app.close(); }
});

test('② 命中即省调用：同题同参数第二次 ⇒ cache_hit=true 且不调 LLM', async () => {
  process.env.P1B_RESULT_CACHE_DIR = tmpCache;
  const app = await newServer();
  try {
    let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '缓存局2', type: 'werewolf', player_count: 6 } });
    const gid = r.json().game.id;
    r = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions', payload: { statement: '缓存命中题', prob: 0.5 } });
    const pid = r.json().id;
    calls = 0;
    const v1 = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions/' + pid + '/verdicts', payload: { runId: 'run-a' } });
    assert.equal(v1.json().saved.every((s) => s.cache_hit === false), true, '首跑必 miss');
    assert.equal(calls, 3, '首跑调 3 次');
    const v2 = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions/' + pid + '/verdicts', payload: { runId: 'run-b' } });
    assert.equal(v2.statusCode, 200);
    assert.equal(v2.json().saved.length, 3, '④ 落库不受缓存影响（三路照写）');
    assert.ok(v2.json().saved.every((s) => s.cache_hit === true), '第二跑必须全命中');
    assert.equal(calls, 3, '★第二跑不得再调 LLM（调用数不增）');
    assert.ok(fs.existsSync(path.join(tmpCache, 'result-cache.jsonl')), '缓存件须落盘');
    assert.equal(fs.readFileSync(path.join(tmpCache, 'result-cache.jsonl'), 'utf8').trim().split('\n').length, 3, '三条记录');
  } finally { await app.close(); }
});

test('③ ★键严格性：证据窗不同（提示词不同）⇒ 必须 miss', async () => {
  process.env.P1B_RESULT_CACHE_DIR = tmpCache;
  const app = await newServer();
  try {
    let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '缓存局3', type: 'werewolf', player_count: 6 } });
    const gid = r.json().game.id;
    // 造一条**真实事件**并让预测引用它 ⇒ 默认提示词含证据块；再用 `evidenceIds: []` 把窗换成空集
    const conn = db.getConnection();
    conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'day', 1, 'statement', '1号发言：我是平民。')").run(gid);
    const evId = conn.prepare('SELECT id FROM events WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(gid).id;
    r = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions', payload: { statement: '窗严格性题', prob: 0.5, evidence: [evId] } });
    assert.equal(r.statusCode, 201, '带证据的落注须成功');
    const pid = r.json().id;
    calls = 0;
    const a = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions/' + pid + '/verdicts', payload: { runId: 'w-full' } });
    assert.equal(calls, 3, '首跑三路各一次');
    // 同一题、同一变体/温度，但**证据窗换成空集** ⇒ v1 的提示词不同 ⇒ v1 必须 miss（另两路不含证据块 ⇒ 命中）
    const b = await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions/' + pid + '/verdicts', payload: { runId: 'w-empty', evidenceIds: [] } });
    assert.equal(b.statusCode, 200);
    const byVar = {};
    for (const s of b.json().saved) byVar[s.prompt_variant] = s.cache_hit;
    assert.equal(byVar.v1_evidence, false, '★证据窗变了 ⇒ v1 必须 miss（冻结 cacheKey 在此会撞键）');
    assert.equal(byVar.v2_skeptical, true, 'v2 无证据块 ⇒ 提示词未变 ⇒ 命中');
    assert.equal(byVar.v3_baserate, true, 'v3 只含基率行 ⇒ 提示词未变 ⇒ 命中');
    assert.equal(calls, 3 + 1, '只 v1 多调一次（其余命中）');
  } finally { await app.close(); }
});
