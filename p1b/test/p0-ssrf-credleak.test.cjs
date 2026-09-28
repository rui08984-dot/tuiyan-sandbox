'use strict';
/**
 * p1b/test/p0-ssrf-credleak.test.cjs —— P0-2 外网暴露面收紧的回归闸（2026-09-28）。
 *
 * 背景（为什么要有这个文件）：p1b 后端原本固定监听 0.0.0.0 + CORS 反射任意来源 + /api/providers
 * 无鉴权，构成一条完整的「凭证外泄链」：攻击者 PUT 一个自己掌控的 base_url 且**不带** api_key
 * （store 语义 = 保留现有真 key），再调 POST /api/providers/:key/test，服务端就把真 key
 * 装进 Authorization 头发给了攻击者的主机。同一条链顺带能做 SSRF（探测/读本机与内网服务）。
 *
 * 本文件锁死三件事：
 *  ① **默认不破坏本地单机使用**——一个环境变量都不设时，必须仍然监听 127.0.0.1 且不索要令牌。
 *     这是「双击 start-p1b.bat 就能用」这条主路径的生死线，故单独成测。
 *  ② base_url 指向回环/私网/链路本地/云元数据地址时，必须被拒（纯语法判定，零 DNS 零网络）。
 *  ③ 即使有人手改 providers.json 把 base_url 写成元数据地址，/test 也**不许发出任何带密钥的请求**。
 *
 * 铁律：不起固定端口（回环 + 临时端口，不外呼）；DB=:memory:；零真实 LLM；零写生产库。
 * 密钥一律用占位串，断言只看「有没有出站」，不看内容。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer, resolveListenConfig } = require('../src/server');
const { db } = require('../src/deps');
const { createProvidersStore } = require('../src/providersStore');

const tmp = (tag) => path.join(os.tmpdir(), 'p1b-p0-' + tag + '-' + process.pid + '-' + Date.now() + '.json');

/** 建一台配置为空的临时 providers 文件，返回 {store, path, cleanup} */
function freshStore(tag) {
  const p = tmp(tag);
  fs.writeFileSync(p, JSON.stringify({ active: null, providers: {} }));
  return { store: createProvidersStore(p), path: p, cleanup: () => { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } } };
}

/** 在一段同步/异步代码里劫持全局 fetch，记录出站请求（绝不真发） */
async function captureFetch(fn) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: (init && init.headers) || {} });
    return { ok: true, status: 200 };
  };
  try { return { seen, out: await fn() }; } finally { globalThis.fetch = real; }
}

// ════════════════════════════════════════════════════════════════════
// ① 默认启动面：不设任何环境变量时，「双击 bat 就能用」必须原样成立
// ════════════════════════════════════════════════════════════════════

test('默认（零环境变量）：监听 127.0.0.1 且不要求令牌——本地单机主路径不被安全改动打断', () => {
  const cfg = resolveListenConfig({});
  assert.equal(cfg.host, '127.0.0.1', '默认必须是回环，不能是 0.0.0.0');
  assert.equal(cfg.port, 8787, '默认端口保持 8787（start-p1b.bat 的标题栏依赖它）');
  assert.equal(cfg.requiresToken, false, '未设 P1B_SHARED_TOKEN 时绝不索要令牌');
  assert.equal(cfg.exposed, false, '回环监听 = 未对外暴露');
});

test('默认（零环境变量）：真实起服务后 address().address 确为 127.0.0.1（回环+临时端口，不外呼）', async () => {
  const saved = { ...process.env };
  for (const k of ['P1B_HOST', 'P1B_SHARED_TOKEN', 'P1B_CORS_ORIGIN', 'PORT']) delete process.env[k];
  const providers = tmp('listen');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  let app = null;
  try {
    const cfg = resolveListenConfig(process.env);
    app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: providers });
    await app.listen({ port: 0, host: cfg.host }); // port 0 = 临时端口，只在回环上开一个口
    assert.equal(app.server.address().address, '127.0.0.1', '实际绑定地址必须是回环');
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(r.statusCode, 200, '默认路径不索要令牌，健康检查直接通');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('显式 P1B_HOST=0.0.0.0 但没设令牌 → 拒绝启动并说清原因（放开必须配令牌）', () => {
  assert.throws(
    () => resolveListenConfig({ P1B_HOST: '0.0.0.0' }),
    (e) => {
      assert.match(e.message, /P1B_SHARED_TOKEN/, '错误信息必须点名要设哪个变量');
      assert.match(e.message, /0\.0\.0\.0/, '错误信息必须复述用户设的那个值');
      return true;
    },
    '对外监听却不给令牌 = 拒绝启动，而不是默默放行',
  );
});

test('P1B_HOST=0.0.0.0 + P1B_SHARED_TOKEN → 放行且标记 requiresToken', () => {
  const cfg = resolveListenConfig({ P1B_HOST: '0.0.0.0', P1B_SHARED_TOKEN: 's3cret-token-value' });
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.requiresToken, true);
  assert.equal(cfg.exposed, true);
});

test('P1B_HOST=127.0.0.1 显式设置（哪怕同时有令牌）→ 视为未暴露', () => {
  const cfg = resolveListenConfig({ P1B_HOST: '127.0.0.1', P1B_SHARED_TOKEN: 's3cret-token-value' });
  assert.equal(cfg.exposed, false, '显式回环就是本地模式，不该被当成对外开放');
});

// ════════════════════════════════════════════════════════════════════
// ② CORS：默认关闭，白名单须显式给出
// ════════════════════════════════════════════════════════════════════

test('CORS 默认关闭：响应不带 access-control-allow-origin（不再反射任意来源）', async () => {
  const saved = { ...process.env };
  for (const k of ['P1B_CORS_ORIGIN', 'P1B_SHARED_TOKEN', 'P1B_HOST']) delete process.env[k];
  const providers = tmp('cors-off');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  let app = null;
  try {
    app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: providers });
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://evil.example' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined, '默认不得给任何来源发 CORS 放行头');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('CORS 显式白名单：名单内的 origin 拿到放行头，名单外的拿不到', async () => {
  const saved = { ...process.env };
  const providers = tmp('cors-on');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  let app = null;
  try {
    process.env.P1B_CORS_ORIGIN = 'http://192.168.1.23:5173';
    app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: providers });
    const ok = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://192.168.1.23:5173' } });
    assert.equal(ok.headers['access-control-allow-origin'], 'http://192.168.1.23:5173', '白名单内应放行');
    const bad = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://evil.example' } });
    assert.notEqual(bad.headers['access-control-allow-origin'], 'http://evil.example', '名单外绝不放行');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 共享令牌：只保护「对外监听」的形态，且绝不拖垮本地默认路径
// ════════════════════════════════════════════════════════════════════

test('设了 P1B_SHARED_TOKEN：/api 无令牌 → 401；带对令牌 → 200', async () => {
  const saved = { ...process.env };
  const providers = tmp('token');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  let app = null;
  try {
    process.env.P1B_SHARED_TOKEN = 'unit-test-shared-token';
    app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: providers });
    const anon = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(anon.statusCode, 401, '无令牌必须被挡');
    const auth = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-p1b-token': 'unit-test-shared-token' } });
    assert.equal(auth.statusCode, 200, '带对令牌应放行');
    const wrong = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-p1b-token': 'wrong' } });
    assert.equal(wrong.statusCode, 401, '错令牌必须被挡');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('不设 P1B_SHARED_TOKEN：/api/health 无令牌直接 200（本地单机不被拦）', async () => {
  const saved = { ...process.env };
  const providers = tmp('notoken');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  let app = null;
  try {
    delete process.env.P1B_SHARED_TOKEN;
    app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: providers });
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(r.statusCode, 200, '本地默认形态下不得索要令牌');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ base_url 主机：回环/私网/链路本地/云元数据 一律拒（纯语法，零 DNS）
// ════════════════════════════════════════════════════════════════════

const BAD_HOSTS = [
  ['http://127.0.0.1:11434/v1', '回环（本地 Ollama 等）'],
  ['http://127.1.2.3/v1', '回环整段 127/8'],
  ['http://169.254.169.254/latest/meta-data/', '云元数据'],
  ['http://169.254.1.1/v1', '链路本地整段'],
  ['http://10.0.0.5/v1', 'RFC1918 10/8'],
  ['http://172.16.0.1/v1', 'RFC1918 172.16/12'],
  ['http://172.31.255.254/v1', 'RFC1918 172.16/12 上界'],
  ['http://192.168.1.1/v1', 'RFC1918 192.168/16'],
  ['http://[::1]:8080/v1', 'IPv6 回环'],
  ['http://[fd00::1]/v1', 'IPv6 ULA 私网'],
  ['http://[fe80::1]/v1', 'IPv6 链路本地'],
  ['http://0.0.0.0/v1', '未指定地址'],
  ['http://100.64.0.1/v1', 'CGNAT 100.64/10'],
  ['http://2130706433/v1', '十进制整数 IP 绕过'],
  ['http://0x7f000001/v1', '十六进制 IP 绕过'],
];

test('base_url 指向回环/私网/元数据 → 400 拒收（逐条，含变形绕过写法）', () => {
  const s = freshStore('badhost');
  try {
    for (const [url, why] of BAD_HOSTS) {
      assert.throws(
        () => s.store.upsert('p', { label: 'p', base_url: url, model: 'm' }),
        (e) => { assert.equal(e.statusCode, 400, `${url}（${why}）必须 400`); return true; },
        `${url}（${why}）应被拒`,
      );
    }
  } finally { s.cleanup(); }
});

test('base_url 带 userinfo（http://a@127.0.0.1/）→ 400 拒收', () => {
  const s = freshStore('userinfo');
  try {
    assert.throws(
      () => s.store.upsert('p', { label: 'p', base_url: 'http://attacker.example@127.0.0.1/v1', model: 'm' }),
      (e) => e.statusCode === 400,
      'userinfo 形式必须被拒',
    );
  } finally { s.cleanup(); }
});

test('公网 base_url 仍然可用（.example/.invalid 保留，避免打破既有测试闸）', () => {
  const s = freshStore('goodhost');
  try {
    for (const url of ['https://x.example/v1', 'https://eff2.example/v1', 'https://api.deepseek.com/v1', 'http://b3.invalid/v1']) {
      const pub = s.store.upsert('p', { label: 'p', base_url: url, model: 'm' });
      assert.equal(pub.base_url, url, `${url} 应被接受`);
    }
  } finally { s.cleanup(); }
});

test('本机私有地址可在显式逃生阀下放行（P1B_LLM_ALLOW_PRIVATE=1，服务本地模型用）', () => {
  const saved = process.env.P1B_LLM_ALLOW_PRIVATE;
  process.env.P1B_LLM_ALLOW_PRIVATE = '1';
  const s = freshStore('allowpriv');
  try {
    const pub = s.store.upsert('p', { label: 'p', base_url: 'http://127.0.0.1:11434/v1', model: 'm' });
    assert.equal(pub.base_url, 'http://127.0.0.1:11434/v1', '显式打开后本机 Ollama 之类仍可配');
  } finally {
    s.cleanup();
    if (saved === undefined) delete process.env.P1B_LLM_ALLOW_PRIVATE; else process.env.P1B_LLM_ALLOW_PRIVATE = saved;
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 凭证外泄链本体：无论 base_url 怎么来的，/test 都不许把真 key 发给私网/元数据
// ════════════════════════════════════════════════════════════════════

test('手改 providers.json 把 base_url 写成元数据地址 → /test 拒绝出站（零 fetch）', async () => {
  const saved = { ...process.env };
  const providers = tmp('exfil');
  // 模拟「有人绕过 upsert 直接改文件」：真 key 在，base_url 指向云元数据
  fs.writeFileSync(providers, JSON.stringify({
    active: 'evil',
    providers: { evil: { label: 'evil', base_url: 'http://169.254.169.254', api_key: 'REAL-KEY-DO-NOT-LEAK-0001', extraction: { model: 'm' } } },
  }));
  let app = null;
  try {
    delete process.env.P1B_LLM_MOCK; // 关键：走真实 fetch 分支
    app = await buildServer({ dbPath: ':memory:', llmMock: false, providersPath: providers });
    const { seen, out } = await captureFetch(async () => app.inject({ method: 'POST', url: '/api/providers/evil/test' }));
    const body = out.json();
    assert.equal(body.ok, false, '指向元数据地址的连接测试必须失败');
    assert.equal(seen.length, 0, `一次出站都不许发生（实际 ${seen.length} 次）——凭证外泄链在此切断`);
    assert.ok(!/REAL-KEY-DO-NOT-LEAK/.test(JSON.stringify(body)), '错误信息里绝不许回显密钥');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('完整攻击链复现：改 base_url 指向攻击者主机 + 不带 api_key → /test 出站请求不得含 Authorization 头', async () => {
  const saved = { ...process.env };
  const providers = tmp('chain');
  fs.writeFileSync(providers, JSON.stringify({ active: 'v', providers: {} }));
  let app = null;
  try {
    delete process.env.P1B_LLM_MOCK;
    process.env.P1B_LLM_STRICT_HOST = '1'; // 严格形态：换主机必须重交 key
    app = await buildServer({ dbPath: ':memory:', llmMock: false, providersPath: providers });

    // 步骤 1：受害者自己配好供应商（真 key）
    const ok = await app.inject({
      method: 'PUT', url: '/api/providers/v',
      payload: { label: 'v', base_url: 'https://legit.example/v1', api_key: 'REAL-KEY-DO-NOT-LEAK-0002', model: 'm' },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().provider.has_api_key, true);

    // 步骤 2：攻击者 PUT 自己的 base_url，**故意不带 api_key**（旧语义 = 保留真 key）
    const atk = await app.inject({
      method: 'PUT', url: '/api/providers/v',
      payload: { label: 'v', base_url: 'https://attacker.example/v1', model: 'm' },
    });
    assert.equal(atk.statusCode, 200, '换主机这一步本身可以成功（防的是外泄不是篡改）');
    assert.equal(atk.json().provider.has_api_key, false, '★换主机且未重交 key ⇒ 真 key 不得被继承到新主机');

    // 步骤 3：攻击者调 /test，把服务当信使
    const { seen, out } = await captureFetch(async () => app.inject({ method: 'POST', url: '/api/providers/v/test' }));
    const body = out.json();
    assert.equal(body.ok, false, '没有 key 就不该「测试成功」');
    const withAuth = seen.filter((r) => Object.keys(r.headers || {}).some((h) => h.toLowerCase() === 'authorization'));
    assert.equal(withAuth.length, 0, '★出站请求里绝不允许出现 Authorization 头——这是外泄链的最后一环');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(providers); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('主机白名单形态：P1B_LLM_HOST_ALLOW 未列出的主机 → PUT 直接 400（连存都存不进去）', () => {
  const saved = process.env.P1B_LLM_HOST_ALLOW;
  process.env.P1B_LLM_HOST_ALLOW = 'api.deepseek.com,tokenrhythm.studio';
  const s = freshStore('allowlist');
  try {
    s.store.upsert('ok', { label: 'ok', base_url: 'https://api.deepseek.com/v1', model: 'm' });
    assert.throws(
      () => s.store.upsert('bad', { label: 'bad', base_url: 'https://attacker.example/v1', model: 'm' }),
      (e) => { assert.equal(e.statusCode, 400); assert.match(e.message, /白名单|允许/); return true; },
      '白名单外的主机必须在写入层就被挡，而不是等到 /test',
    );
  } finally {
    s.cleanup();
    if (saved === undefined) delete process.env.P1B_LLM_HOST_ALLOW; else process.env.P1B_LLM_HOST_ALLOW = saved;
  }
});
