'use strict';
/**
 * p1b/src/server.js —— 推演沙盘 P1b 网页工作台 · 后端入口（P1B-SPEC §1/§3/§5，P1b-1）。
 *
 * 启动：node src/server.js
 *   监听 0.0.0.0:PORT（env PORT 缺省 8787），启动时打印本机局域网访问地址（手机竖屏录入用）。
 *   数据库共用 p1a-terminal/data/p1a.db（env P1B_DB_PATH 可覆盖；测试用 :memory:）。
 *   供应商配置与终端共用 p1a-terminal/config/providers.json（env P1B_PROVIDERS_PATH 可覆盖；测试指向临时文件）。
 *   P1B_LLM_MOCK=1 → 所有 LLM 调用强制 mockMode（零网络，测试铁律）。
 *   静态托管 p1b/web/dist（存在则挂，不存在静默跳过——P1b-2 未构建时不报错）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const Fastify = require('fastify');

const { db, llm, engine, P1A_ROOT } = require('./deps');
const { resolveDbPath, describeDbPath } = require('./paths.cjs'); // C1 runtime-paths：数据目录解析
const { assertSchemaSupported, migrate } = require('./schemaVersion'); // C1：app_meta ＋ 降级拒绝
const botcClaims = require('./botc/claims'); // B2：BOTC 适配（剧本/专属谓词私有表）
const { createProvidersStore } = require('./providersStore');
const { createTaskQueue } = require('./taskQueue');
const { makeAdviseRunner } = require('./routes/advise');
const registerGames = require('./routes/games').register;
const registerEvents = require('./routes/events').register;
const registerAdvise = require('./routes/advise').register;
const registerProviders = require('./routes/providers').register;
const registerOracle = require('./routes/oracle').register; // P2 W1：对局玄学化判词（赛后娱乐彩蛋，恒挂「娱乐参考」，绝不接入游戏研判）

const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');

/**
 * C2 error-ux：前端没构建时的兜底页。
 * ★为什么必须是 HTML 而不是 JSON —— 回 JSON 会让人以为「是我地址打错了」，
 * 于是去 URL 上反复改；而真实原因是**这个服务根本没带页面**。两件事的修法完全不同。
 */
const NO_WEB_HTML = [
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<title>P1b 网页工作台 · 前端没构建</title>',
  '<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.7}',
  'code{background:#eee;padding:.1em .3em;border-radius:3px}</style></head><body>',
  '<h1>你打开的地址不对。回 <code>/</code> 试试。</h1>',
  '<p>不过更要紧的是：<strong>这个服务没有带页面</strong>（<code>p1b/web/dist</code> 不存在），',
  '所以任何地址打开都是这一页。接口（<code>/api/*</code>）仍然是通的。</p>',
  '<p>修法：在 <code>p1b/web</code> 下跑一次 <code>npm run build</code>，再重启服务。</p>',
  '</body></html>',
].join('\n');

// ════════════════════════════════════════════════════════════════════
// P0-2 暴露面闸（2026-09-28）。设计取向：**默认收紧、可选放宽**。
//
// 为什么不是「给所有 /api 加必填令牌」：那会让「双击 start-p1b.bat」直接不可用，
// 是净倒退——本项目是单人本地工具，默认形态下根本没有除你之外的调用者。
// 所以默认形态 = 回环监听 + 不索要令牌 + 不发 CORS 放行头，本地体验零变化；
// 只有当操作者**显式**把服务开到网络上时，才强制要求共享令牌。
// ════════════════════════════════════════════════════════════════════

const TOKEN_HEADER = 'x-p1b-token';
const TOKEN_COOKIE = 'p1b_token';

/** 是不是「开给网络上的人」：回环/未指定之外的都算 */
function isOpenHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h === 'localhost') return false;
  if (h === '::1' || h === '[::1]') return false;
  return !(h === '127.0.0.1' || /^127\./.test(h));
}

/**
 * 从 env 推出监听形态。单独抽成纯函数是为了能不起端口就断言默认值
 * （p0-ssrf-credleak.test.cjs 的「双击 bat 仍可用」生死线就锁在这里）。
 * env 传参而不是直读 process.env，是为了让测试能显式给出「零环境变量」这组输入。
 */
function resolveListenConfig(env) {
  const e = env || process.env;
  const host = String(e.P1B_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(e.PORT || 8787);
  const token = String(e.P1B_SHARED_TOKEN || '').trim();
  const exposed = isOpenHost(host);
  if (exposed && !token) {
    throw new Error(
      '[p1b] 拒绝启动：P1B_HOST=' + host + ' 会把服务开到局域网上，但没设 P1B_SHARED_TOKEN。\n' +
      '        这台机器所在 Wi-Fi 上的任何设备都能改你的供应商配置、并让服务端把真密钥发出去。\n' +
      '        两种修法（选一种）：\n' +
      '          ① 只在本机用 → 去掉 P1B_HOST（或设为 127.0.0.1），不需要令牌；\n' +
      '          ② 要让手机连同一 Wi-Fi 用 → 在 start-p1b.bat 里 node src/server.js 那一行前面加：\n' +
      '               set P1B_HOST=0.0.0.0\n' +
      '               set P1B_SHARED_TOKEN=你自己想的一串随机字符\n' +
      '             然后手机浏览器打开一次 http://<本机局域网IP>:8787/?p1b_token=<那串字符> 即可。',
    );
  }
  return { host, port, token, exposed, requiresToken: token.length > 0 };
}

/** 定长比较，避免令牌比较被计时侧信道读出前缀 */
function tokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** 从请求里挖令牌：头 → Cookie → 查询串（手机首次打开页面用查询串，随后种 cookie） */
function extractToken(req) {
  const h = req.headers || {};
  if (h[TOKEN_HEADER]) return String(h[TOKEN_HEADER]);
  const auth = h.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const raw = h.cookie || '';
  for (const part of raw.split(';')) {
    const kv = part.trim().split('=');
    if (kv[0] === TOKEN_COOKIE) return decodeURIComponent(kv.slice(1).join('='));
  }
  const q = (req.query && req.query.p1b_token) || null;
  return q ? String(q) : null;
}

function readCookie(req, name) {
  const raw = (req.headers && req.headers.cookie) || '';
  for (const part of raw.split(';')) {
    const kv = part.trim().split('=');
    if (kv[0] === name) return decodeURIComponent(kv.slice(1).join('='));
  }
  return null;
}

/** 组装 Fastify 实例（不监听；测试用 app.inject 即真 HTTP 语义） */
async function buildServer(opts) {
  opts = opts || {};
  // 测试缝：默认仍是 p1b/web/dist。**不设时行为与从前逐字节一致**——
  // 有了它，「前端没构建」这一形态才能被测，而不必真去删仓库里的 dist
  // （删了会连累 dist.test.mjs，且中途崩掉就再也回不来）。
  const webDist = opts.webDist || WEB_DIST;
  // C1 runtime-paths：库路径改由 paths.cjs 解析（P1B_DB_PATH ＞ P1B_DATA_DIR ＞ 平台默认）。
  // 源码树里不设任何环境变量时仍解析到今天的路径 —— 开发态行为零变化。
  const dbPath = opts.dbPath || resolveDbPath();
  assertSchemaSupported(dbPath); // 降级拒绝：库比程序新 ⇒ 抛错 ⇒ 退出码 6，**且必须在 db.init 之前**
  const llmMock = opts.llmMock !== undefined ? !!opts.llmMock : process.env.P1B_LLM_MOCK === '1';
  const store = createProvidersStore(opts.providersPath || process.env.P1B_PROVIDERS_PATH);

  db.init(dbPath); // 复用 p1a 连接管理（:memory: 或共享 data/p1a.db，WAL 多进程安全）
  await migrate(dbPath, db.getConnection()); // C1：登记/推进 app_meta 版本号。首次登记不备份；真要动结构时先备份（schemaVersion.js:migrate）
  botcClaims.ensureBotcTables(db.getConnection()); // B2：p1b 私有表 botc_games/botc_claims（CREATE TABLE IF NOT EXISTS，additive，零碰 p1a 既有表）

  // C2 error-ux：★「前端没构建」原来在这里静默跳过 —— 服务器照样起来、端口照样通，
  // 但浏览器打开是 JSON 或空白，**全程没有一句说「前端没构建」**。这正是陌生人最常撞、
  // 又最难自己查出来的一类故障。现在两路都讲：stderr 给人看，/api/health 给机器判。
  const webBuilt = fs.existsSync(path.join(webDist, 'index.html'));
  if (!webBuilt) {
    process.stderr.write(
      '[p1b] ⚠ 前端未构建：找不到 ' + path.join(webDist, 'index.html') + '\n' +
      '        后果：服务与 /api 正常，但**浏览器打开任何地址都不是这个工作台**。\n' +
      '        修法：cd p1b/web && npm run build，然后重启本服务。\n',
    );
  }

  const app = Fastify({ logger: opts.logger === true });
  // P0-2：监听形态在 buildServer 里也要算一遍——app.inject 的测试走的是同一条装配路径，
  // 不能出现「启动时收紧、测试时宽松」这种测不到真实行为的缝。
  const listen = opts.listenConfig || resolveListenConfig(process.env);
  // CORS：默认**不发**任何放行头。前端 dist 与 API 同源，正常使用根本不需要 CORS；
  // 需要跨源（比如另起 vite dev server）时用 P1B_CORS_ORIGIN 显式列白名单。
  const corsOrigins = String(process.env.P1B_CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (corsOrigins.length) {
    await app.register(require('@fastify/cors'), { origin: (origin, cb) => cb(null, corsOrigins.includes(origin)) });
  }
  const ctx = { db, llm, engine, store, llmMock, dbPath, p1aRoot: P1A_ROOT, webBuilt, webDist };
  // B7：fetchImpl 测试缝（extract/advise 共用；生产恒 undefined 零行为变化——同 B3 通道约定）
  ctx.fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : undefined;
  ctx.queue = createTaskQueue({ runner: makeAdviseRunner(ctx), maxTasks: opts.maxTasks || 200 });

  app.setErrorHandler((err, req, reply) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    if (status >= 500) process.stderr.write('[p1b] 500 @ ' + req.method + ' ' + req.url + ': ' + (err && err.stack ? err.stack : err) + '\n');
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  app.setNotFoundHandler((req, reply) => {
    // C2 error-ux：★404 现在是最坏的一屏——纯 JSON 字符串。陌生人看到
    // `{"error":"not found: GET /xx"}` 既不知道发生了什么，也不知道该去哪。
    // 三路分流：
    //   · /api/*  → 机器契约，**保持 JSON**（前端 fetch 与既有测试都依赖它）
    //   · 非 /api → SPA fallback：回 index.html（HashRouter 下前端自己路由）
    //   · index.html 也没有 → 回一页 HTML 人话，**绝不回 JSON**
    //     （此刻回 JSON 会让人以为是自己地址打错了，而真实原因是「前端没构建」）
    if (!req.url.startsWith('/api')) {
      if (webBuilt) {
        return reply.type('text/html; charset=utf-8').send(fs.readFileSync(path.join(webDist, 'index.html')));
      }
      return reply.code(404).type('text/html; charset=utf-8').send(NO_WEB_HTML);
    }
    reply.code(404).send({ error: 'not found: ' + req.method + ' ' + req.url });
  });

  // P0-2 共享令牌门：只在操作者配了 P1B_SHARED_TOKEN 时才存在（默认不存在 ⇒ 本地单机零阻力）。
  // 门只罩 /api：静态前端与静态资源要能在没令牌的情况下先把页面取回来，
  // 否则手机第一次打开会拿到一个连 CSS/JS 都取不到的死页面。
  if (listen.requiresToken) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api')) return;
      // 带对令牌的一律顺手种 cookie：手机浏览器只被允许访问一次带令牌串的 URL，
      // 种下 cookie 后前端后续所有 fetch 自动带上（SameSite=Strict 挡住跨站借用）。
      if (tokenEquals(extractToken(req), listen.token)) {
        if (readCookie(req, TOKEN_COOKIE) !== listen.token) {
          reply.header('set-cookie', TOKEN_COOKIE + '=' + encodeURIComponent(listen.token) + '; Path=/; HttpOnly; SameSite=Strict');
        }
        return;
      }
      reply.code(401).send({
        error: '需要共享令牌',
        hint: '在 URL 后加一次 ?p1b_token=<P1B_SHARED_TOKEN 的值>，或请求头 ' + TOKEN_HEADER,
      });
    });
  }

  app.get('/api/health', async () => ({
    ok: true,
    service: 'p1b-web-workbench',
    db_path: dbPath,
    llm_mock: llmMock,
    // C2：让**机器**也能判「前端在不在」。只写 stderr 的话，脚本与监控看不见；
    // 只看这字段的话，人看不见。两者都要，所以两个出口都给。
    web_built: webBuilt,
    engine: { db_contract: 'v1', reused_from: 'p1a-terminal' },
  }));

  registerGames(app, ctx);
  registerEvents(app, ctx);
  registerAdvise(app, ctx);
  registerProviders(app, ctx);
  registerOracle(app, ctx); // P2 W1：GET /api/games/:id/oracle
  require('./routes/oracleCast').register(app, ctx); // p9 W1：独立玄学排盘 POST /api/oracle/cast + GET /api/oracle/readings（三法起卦+历史档案；require+register 同一句 = 任务书单次原子编辑约束）
  require('./routes/oracleInterpret').register(app, ctx); // G1 反馈#1：独立排盘断语 POST /api/oracle/interpret（扩展走 wrapper：复用 P8 断语链，UPDATE 写回 verdict 结构位；恒挂「娱乐参考」，绝不接入游戏研判）
  require('./routes/predictions').register(app, ctx); // p10 W1：预测卡 L0 账本（POST 落注/GET 分页/POST resolve 真值回填/GET unresolved/GET calibration；只记不评门禁 n≥30 局∧200 条）
  require('./routes/verdicts').register(app, ctx); // p10 W2：多路判词（POST 3 路生成全量落 verdicts 表；LLM 只出文本，implied_prob 由末行 P=0.xx 正则机械抽取）
  require('./routes/audit').register(app, ctx); // G1 反馈#3 M2：审计器仪表盘聚合 GET /api/audit/summary（纯 SQL 只读零 LLM；l0Gate 双口径 + layer×checklist_hash 分组 + gate 分组）
  require('./routes/adapters').register(app, ctx); // 通用化：GET /api/adapters 游戏类型登记（内置 werewolf/botc/script + 扫 adapters/ 目录自动登记 avalon）
  require('./routes/intake').register(app, ctx); // 阶段 3 出口件（2026-09-13）：对外开放接题 POST /api/intake/classify + GET /api/intake/rejects（拒收门三问 + 六层判定 + 拒收日志，additive 新表 intake_rejects，零碰既有列）
  require('./routes/auditKpi').register(app, ctx); // UI 重构步 2：审计页 KPI 只读端点 GET /api/audit/g2-kpi（合格池/最难档/域外计数 + 分层 Brier 置信区间；纯 SQL 只读零写，口径与 g2-report.cjs 同源，既有 /api/audit/summary 契约不变）
  require('./routes/baseline').register(app, ctx); // 诚实区间只读端点 GET /api/baseline/:kind（同类题只给区间/点估计要不要由用户选；区间与 n/k 全部取自 engines/l2_baseline.js，n<30 两出口都不给数；纯 SELECT 零写）
  require('./routes/disclosure').register(app, ctx); // P0-U7/U8（2026-09-16）：披露件只读端点 GET /api/disclosure/calendar｜/calibration（读 sim/out 落盘件；缺件 404 带生成命令；零写库）
  // 2026-09-28 补注册（批次三遗留）：analytics.js 早已建好，register 却从没被调用过
  //   ⇒ GET /api/analytics/questions 与 /api/analytics/summary 两个端点一直是**死的**（404）。
  //   纯只读聚合（analyticsStore），不新增表、不改既有端点。
  require('./routes/analytics').register(app, ctx); // 批次三：GET /api/analytics/questions｜/api/analytics/summary（只读聚合）

  // 静态托管前端 dist：挂（挂在 /api 之后，显式路由优先）。C2：不再「不存在就静默跳过」——
  // 没构建这件事已经在上面写进 stderr 并进了 /api/health，这里只管挂不挂。
  if (fs.existsSync(webDist)) {
    await app.register(require('@fastify/static'), { root: webDist });
  }

  app.decorate('p1b', ctx); // 挂运行参数快照（start 横幅打印实际 dbPath 用）
  await app.ready();
  return app;
}

/** 打印可访问地址（本机 + 局域网 IPv4） */
function lanAddresses(port) {
  const urls = ['http://localhost:' + port];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push('http://' + net.address + ':' + port);
    }
  }
  return urls;
}

/** 真实启动（node src/server.js 时才执行） */
async function start() {
  const listen = resolveListenConfig(process.env); // 拒绝「对外监听却不给令牌」的组合在这里发生
  const port = listen.port;
  const host = listen.host;
  const app = await buildServer({ listenConfig: listen });
  const dbPath = (app.p1b && app.p1b.dbPath) || resolveDbPath(); // 实际生效 dbPath（横幅铁律：打印真实值）
  const webBuilt = !!(app.p1b && app.p1b.webBuilt); // 与 /api/health 同一个判据，不许两处各判各的
  const webDist = (app.p1b && app.p1b.webDist) || WEB_DIST;
  await app.listen({ port, host });
  const line = '-'.repeat(64);
  console.log(line);
  console.log('推演沙盘 P1b 网页工作台 · 后端已启动');
  // C1：标签跟着**真实来源**走。用 db.DEFAULT_DB_PATH 硬比会出事——走 P1B_DATA_DIR 时
  // 它会打「（P1B_DB_PATH 覆盖）」，而实际覆盖它的根本不是那个变量。横幅在说假话。
  console.log('  数据库   : ' + dbPath + describeDbPath(dbPath));
  console.log('  LLM 模式 : ' + (process.env.P1B_LLM_MOCK === '1' ? 'MOCK（P1B_LLM_MOCK=1，零网络）' : '按激活供应商（无 key 自动落 mock）'));
  console.log('  监听     : ' + host + ':' + port + (listen.exposed ? '（已开到局域网，令牌门生效）' : '（仅本机，局域网访问不通）'));
  if (!listen.exposed) {
    // 横幅铁律：打印真实值。以前这里无条件打局域网地址，导致横幅在说一件根本没发生的事。
    console.log('  本机访问 : ' + 'http://localhost:' + port);
    console.log('  想让手机连同一 Wi-Fi 用：在 start-p1b.bat 里设 P1B_HOST=0.0.0.0 与 P1B_SHARED_TOKEN=<随机串>，');
    console.log('              然后手机浏览器打开一次 http://<本机局域网IP>:' + port + '/?p1b_token=<那串随机串>');
  } else {
    console.log('  本机访问 : ' + 'http://localhost:' + port);
    console.log('  手机     : ' + 'http://' + (lanAddresses(port)[1] || '').replace(/^https?:\/\//, '') + '  ← 连同一 Wi-Fi，首次打开要带 ?p1b_token=<令牌>');
  }
  // 横幅铁律：打印真实值。判据与 /api/health 的 web_built 同一个（看 index.html，不只看目录在不在）。
  console.log('  前端 dist: ' + (webBuilt ? '已挂载 ' + webDist : '未构建（缺 index.html，浏览器打开的不是工作台；仅 API 可用）'));
  console.log(line);
  return app;
}

if (require.main === module) {
  start().catch((e) => {
    process.stderr.write('[p1b] 启动失败: ' + (e && e.stack ? e.stack : String(e)) + '\n');
    // C1：退出码 6 = 「库比程序新」。它不是程序错误（1–5），是「你拿错了程序」——
    // 混成 1 会让人去翻代码日志，而该做的是换程序或回退数据。err.exitCode 由 schemaVersion.js 给。
    process.exit(typeof e.exitCode === 'number' ? e.exitCode : 1);
  });
}
module.exports = { buildServer, start, lanAddresses, resolveListenConfig, isOpenHost, WEB_DIST };
