'use strict';
/**
 * p1b/test/oracleInterpret.test.cjs —— 独立排盘断语端点测试（G1 反馈#1；node:test + fastify inject）。
 * 覆盖：201 形状+娱乐参考字面+MOCK 确定性 / 400（缺 id/0/非整数）/ 404（档案不存在）/
 * 幂等（两次 201 同断语、不新增行、readings 回读落位）/ LIVE 缝与 LIVE 失败兜底缝
 * （fetchImpl 注入零真实网络，同 oracle.test.cjs 先例）。
 * 铁律：DB=:memory:；providers 指向 os.tmpdir() 临时文件；绝不外呼真实 API。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { mockVerdict } = require('../src/lib/oracle');
const { ORACLE_SYSTEM_PROMPT } = require('../src/routes/oracleInterpret');

const tmpProviders = path.join(os.tmpdir(), 'p1b-oinit-test-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
let readingId = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

test('wrapper 复用 P8 断语链：system 首行强制娱乐边界（同链证据）', () => {
  assert.ok(ORACLE_SYSTEM_PROMPT.startsWith('娱乐参考，非游戏研判。'), 'system 首行必须强制娱乐边界');
});

test('POST /api/oracle/cast 备料一条随机排盘', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'random', params: {} } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().verdict, null); // 排盘时 verdict 结构位为空（现状锚定）
  readingId = r.json().id;
});

test('interpret → 201：mode=mock、disclaimer 精确、断语含卦名+娱乐参考、= mockVerdict 逐字', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id: readingId } });
  assert.equal(r.statusCode, 201);
  const b = r.json();
  assert.equal(b.id, readingId);
  assert.equal(b.mode, 'mock');
  assert.equal(b.disclaimer, '娱乐参考'); // 恒挂标注，精确相等
  assert.ok(b.casting && b.casting.benGua && b.casting.benGua.fullName, '缺 casting');
  assert.ok(b.verdict.includes(b.casting.benGua.fullName), '断语缺卦名');
  assert.ok(b.verdict.includes('娱乐参考'), '断语缺娱乐参考字样');
  assert.equal(b.verdict, mockVerdict(b.casting)); // MOCK = 确定性模板逐字一致
  assert.equal(b.llm_error, undefined);
});

test('幂等：两次 interpret 均 201 同断语；不新增行；GET readings 回读 verdict 已落位', async () => {
  const r1 = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id: readingId } });
  const r2 = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id: readingId } });
  assert.equal(r1.statusCode, 201);
  assert.equal(r2.statusCode, 201);
  assert.equal(r1.json().verdict, r2.json().verdict);
  const list = await app.inject({ method: 'GET', url: '/api/oracle/readings?limit=100' });
  const lb = list.json();
  assert.equal(lb.total, 1, 'interpret 不得新增行');
  const row = lb.items.find((x) => x.id === readingId);
  assert.ok(row && row.verdict === r1.json().verdict, 'readings 回读 verdict 未落位');
});

test('400：缺 body / 缺 id / id=0 / id 非整数', async () => {
  const e1 = await app.inject({ method: 'POST', url: '/api/oracle/interpret' });
  assert.equal(e1.statusCode, 400);
  const e2 = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: {} });
  assert.equal(e2.statusCode, 400);
  const e3 = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id: 0 } });
  assert.equal(e3.statusCode, 400);
  const e4 = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id: 'abc' } });
  assert.equal(e4.statusCode, 400);
});

test('404：排盘档案不存在', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id: 999999 } });
  assert.equal(r.statusCode, 404);
});

function withKey(fn) {
  return async (t) => {
    const prev = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = 'test-key-not-real';
    try { await fn(t); } finally {
      if (prev === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = prev;
    }
  };
}

test('LIVE 缝：fetchImpl 注入 → mode=live、verdict=注入文本、写回 readings', withKey(async () => {
  const liveApp = await buildServer({
    dbPath: ':memory:', llmMock: false, providersPath: tmpProviders + '.live.json',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '  测试断语：水火既济，动静相宜。  ' } }] }) }),
  });
  try {
    const c = await liveApp.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'numbers', params: { n1: 7, n2: 3 } } });
    const id = c.json().id;
    const r = await liveApp.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id } });
    assert.equal(r.statusCode, 201);
    const b = r.json();
    assert.equal(b.mode, 'live');
    assert.equal(b.verdict, '测试断语：水火既济，动静相宜。');
    assert.equal(b.disclaimer, '娱乐参考');
    const list = await liveApp.inject({ method: 'GET', url: '/api/oracle/readings?limit=10' });
    assert.equal(list.json().items.find((x) => x.id === id).verdict, b.verdict, 'live 断语未写回');
  } finally { await liveApp.close(); }
}));

test('LIVE 失败缝：fetchImpl 抛错 → 201 + mode=mock_fallback + llm_error（不谎报为 LLM 断语）', withKey(async () => {
  const liveApp2 = await buildServer({
    dbPath: ':memory:', llmMock: false, providersPath: tmpProviders + '.live2.json',
    fetchImpl: async () => { throw new Error('模拟网络故障'); },
  });
  try {
    const c = await liveApp2.inject({ method: 'POST', url: '/api/oracle/cast', payload: { method: 'numbers', params: { n1: 7, n2: 3 } } });
    const id = c.json().id;
    const r = await liveApp2.inject({ method: 'POST', url: '/api/oracle/interpret', payload: { id } });
    assert.equal(r.statusCode, 201);
    const b = r.json();
    assert.equal(b.mode, 'mock_fallback');
    assert.ok(b.llm_error.includes('模拟网络故障'));
    assert.ok(b.verdict.includes('娱乐参考'));
    assert.equal(b.verdict, mockVerdict(b.casting));
  } finally { await liveApp2.close(); }
}));
