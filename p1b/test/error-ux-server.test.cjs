'use strict';
/**
 * p1b/test/error-ux-server.test.cjs —— 三条「静默失败」的回归锁（SPEC-error-ux）
 *
 * 被锁的三条，都是**服务器起来了、端口通着、但用户看到的是错的东西**：
 *   ① 前端没构建 → 原来 `if (fs.existsSync(WEB_DIST))` 不成立就**静默跳过**，
 *      全程没有一句说「前端没构建」。现在：stderr 有警告 ＋ /api/health 带 web_built:false。
 *   ② 404 → 原来是最坏的一屏：**纯 JSON 字符串**。现在非 /api 一律回 index.html；
 *      连 index.html 都没有时也回 HTML 人话，**绝不回 JSON**。
 *   ③ /api 的 404 **必须仍然是 JSON** —— 那是机器契约，前端 fetch 与既有测试都依赖它。
 *      把它也改成 HTML 才是本模块最容易犯的错（「让报错好看」的代价是契约破损）。
 *
 * 手法：不真删仓库里的 dist（那会连累 dist.test.mjs，且崩了就再也回不来），
 * 而是把 WEB_DIST 指向一个临时目录，分别摆「有 index.html」「目录在但没 index.html」
 * 「目录压根不存在」三种形态，**每次都真起一个 buildServer**。
 *
 * 铁律：DB=:memory:，零真实 LLM，不写仓库任何目录，警告只读不吞。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer, WEB_DIST } = require('../src/server');
const { db } = require('../src/deps');

function tmp(tag) {
  const d = path.join(os.tmpdir(), 'p1b-eux-' + tag + '-' + process.pid + '-' + Date.now());
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

/**
 * 起一台服务器，**把 stderr 原样抓下来**（警告就走 stderr —— stdout 会被脚本捕获，
 * 抓不到就等于没有；这是 spec 的 Boundaries 明写的一条）。
 */
async function withServer(tag, webDist, fn) {
  const base = tmp(tag);
  const providers = path.join(base, 'providers.json');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));

  const chunks = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  let app = null;
  try {
    app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: providers, webDist });
    return await fn(app, chunks.join(''));
  } finally {
    process.stderr.write = realWrite;
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    rmrf(base);
  }
}

test('装具前提：仓库里的 dist 确实已构建（否则下面的「已构建」用例是假的）', () => {
  assert.ok(fs.existsSync(path.join(WEB_DIST, 'index.html')),
    'p1b/web/dist/index.html 不存在——先跑 vite build，否则本文件测不到真路径');
});

// ════════════════════════════════════════════════════════════════════
// ① 前端没构建：stderr 警告 ＋ /api/health 带 web_built:false
// ════════════════════════════════════════════════════════════════════

test('① 删 dist 启动 ⇒ stderr 有明确警告 ＋ /api/health 带 web_built:false', async () => {
  const 不存在 = tmp('nobuild');
  try {
    await withServer('nobuild', 不存在, async (app, stderr) => {
      // stderr：说清「后果是什么」和「怎么修」，不是只说一句 dist 不存在
      assert.match(stderr, /前端未构建/, 'stderr 必须出现「前端未构建」：\n' + stderr);
      assert.match(stderr, /index\.html/, '要说清缺的是哪个文件');
      assert.match(stderr, /npm run build/, '★必须给出可执行的下一步：\n' + stderr);
      assert.match(stderr, /\/api/, '要说清「接口还通」，否则用户以为整个服务坏了');
      // stdout 之外的通道：机器也能判
      const r = await app.inject({ method: 'GET', url: '/api/health' });
      assert.equal(r.statusCode, 200, '前端没构建不许连健康检查都挂');
      const b = JSON.parse(r.body);
      assert.equal(b.web_built, false, '★/api/health 必须带 web_built:false');
      assert.equal(b.ok, true, '接口层本身是好的（ok 仍为 true）——别把「没页面」说成「服务坏了」');
    });
  } finally { rmrf(不存在); }
});

test('①b 前端已构建 ⇒ web_built:true ＋ stderr 不出现那条警告', async () => {
  const d = tmp('built');
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>p1b</title>');
  try {
    await withServer('built', d, async (app, stderr) => {
      assert.equal(/前端未构建/.test(stderr), false, '已构建时不许喊没构建：\n' + stderr);
      const b = JSON.parse((await app.inject({ method: 'GET', url: '/api/health' })).body);
      assert.equal(b.web_built, true);
    });
  } finally { rmrf(d); }
});

test('①c ★目录在但 index.html 被删 ⇒ 也算「没构建」（判据是文件，不是目录）', async () => {
  const d = tmp('noindex');
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true }); // 目录在、index.html 不在
  try {
    await withServer('noindex', d, async (app, stderr) => {
      assert.match(stderr, /前端未构建/, '★只看目录存在会漏掉这一种：\n' + stderr);
      const b = JSON.parse((await app.inject({ method: 'GET', url: '/api/health' })).body);
      assert.equal(b.web_built, false);
    });
  } finally { rmrf(d); }
});

// ════════════════════════════════════════════════════════════════════
// ② 404：SPA fallback，且绝不回 JSON
// ════════════════════════════════════════════════════════════════════

test('② 前端已构建：非 /api 的 404 ⇒ 回 index.html，不见 JSON', async () => {
  const d = tmp('spa');
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>P1b 工作台</title><div id=root></div>');
  try {
    await withServer('spa', d, async (app) => {
      const r = await app.inject({ method: 'GET', url: '/xxx' });
      assert.equal(r.statusCode, 200, 'SPA fallback 回 index.html ⇒ 200');
      assert.match(r.headers['content-type'] || '', /text\/html/, '必须是 HTML');
      assert.match(r.body, /P1b 工作台/, '★回的是 index.html 的真内容');
      assert.equal(/^\s*\{/.test(r.body), false, '★绝不能是 JSON 字符串：' + r.body.slice(0, 80));
      // 深链同理（HashRouter 下前端自己再路由，但服务端这一层不许吐 JSON）
      const deep = await app.inject({ method: 'GET', url: '/games/123/notes' });
      assert.equal(deep.statusCode, 200);
      assert.equal(/^\s*\{/.test(deep.body), false);
    });
  } finally { rmrf(d); }
});

test('②b ★删掉 index.html 后访问 /xxx ⇒ 仍是 HTML 人话，不是 JSON', async () => {
  const d = tmp('noindex404');
  try {
    await withServer('noindex404', d, async (app) => {
      const r = await app.inject({ method: 'GET', url: '/xxx' });
      assert.equal(r.statusCode, 404, '页面确实不存在 ⇒ 404 是诚实的');
      assert.match(r.headers['content-type'] || '', /text\/html/);
      assert.equal(/^\s*\{/.test(r.body), false, '★这条就是 spec 点名的病：不得见 JSON 字符串');
      // ★更较真的一句：得说清**真实原因**是「没构建」，不是让用户去改地址
      assert.match(r.body, /前端没构建|没有带页面/, '要说清真实原因，否则用户会去 URL 上反复改');
      assert.match(r.body, /npm run build/, '要给可执行的下一步');
    });
  } finally { rmrf(d); }
});

// ════════════════════════════════════════════════════════════════════
// ③ /api 的契约不许被「让报错好看」顺手改掉
// ════════════════════════════════════════════════════════════════════

test('③ ★/api 的 404 仍然是 JSON（机器契约不许被 HTML 化）', async () => {
  const d = tmp('api404');
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>P1b 工作台</title>');
  try {
    await withServer('api404', d, async (app) => {
      const r = await app.inject({ method: 'GET', url: '/api/nope' });
      assert.equal(r.statusCode, 404);
      assert.match(r.headers['content-type'] || '', /application\/json/, '★/api 404 必须是 JSON');
      const b = JSON.parse(r.body);
      assert.ok(b.error, '既有形状 { error } 不许变——前端与既有测试都依赖它');
    });
  } finally { rmrf(d); }
});

test('③b 前端没构建时 /api 也不受影响（前端缺失不许连累接口）', async () => {
  const 不存在 = tmp('nobuild-api');
  try {
    await withServer('nobuild-api', 不存在, async (app) => {
      assert.equal((await app.inject({ method: 'GET', url: '/api/games' })).statusCode, 200);
      const miss = await app.inject({ method: 'GET', url: '/api/games/999999' });
      assert.equal(miss.statusCode, 404, '业务 404 也照旧');
      assert.ok(JSON.parse(miss.body).error);
    });
  } finally { rmrf(不存在); }
});
