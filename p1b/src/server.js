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
  const dbPath = opts.dbPath || process.env.P1B_DB_PATH || db.DEFAULT_DB_PATH;
  const llmMock = opts.llmMock !== undefined ? !!opts.llmMock : process.env.P1B_LLM_MOCK === '1';
  const store = createProvidersStore(opts.providersPath || process.env.P1B_PROVIDERS_PATH);

  db.init(dbPath); // 复用 p1a 连接管理（:memory: 或共享 data/p1a.db，WAL 多进程安全）
  botcClaims.ensureBotcTables(db.getConnection()); // B2：p1b 私有表 botc_games/botc_claims（CREATE TABLE IF NOT EXISTS，additive，零碰 p1a 既有表）

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
  const ctx = { db, llm, engine, store, llmMock, dbPath, p1aRoot: P1A_ROOT };
  // B7：fetchImpl 测试缝（extract/advise 共用；生产恒 undefined 零行为变化——同 B3 通道约定）
  ctx.fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : undefined;
  ctx.queue = createTaskQueue({ runner: makeAdviseRunner(ctx), maxTasks: opts.maxTasks || 200 });

  app.setErrorHandler((err, req, reply) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    if (status >= 500) process.stderr.write('[p1b] 500 @ ' + req.method + ' ' + req.url + ': ' + (err && err.stack ? err.stack : err) + '\n');
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  app.setNotFoundHandler((req, reply) => {
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
  require('./routes/disclosure').register(app, ctx); // P0-U7/U8（2026-09-16）：披露件只读端点 GET /api/disclosure/calendar｜/calibration（读 sim/out 落盘件；缺件 404 带生成命令；零写库）
  // 2026-09-28 补注册（批次三遗留）：analytics.js 早已建好，register 却从没被调用过
  //   ⇒ GET /api/analytics/questions 与 /api/analytics/summary 两个端点一直是**死的**（404）。
  //   纯只读聚合（analyticsStore），不新增表、不改既有端点。
  require('./routes/analytics').register(app, ctx); // 批次三：GET /api/analytics/questions｜/api/analytics/summary（只读聚合）

  // 静态托管前端 dist：存在则挂（挂在 /api 之后，显式路由优先），不存在静默跳过
  if (fs.existsSync(WEB_DIST)) {
    await app.register(require('@fastify/static'), { root: WEB_DIST });
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
  const dbPath = (app.p1b && app.p1b.dbPath) || process.env.P1B_DB_PATH || db.DEFAULT_DB_PATH; // 实际生效 dbPath（横幅铁律：打印真实值）
  await app.listen({ port, host });
  const line = '-'.repeat(64);
  console.log(line);
  console.log('推演沙盘 P1b 网页工作台 · 后端已启动');
  console.log('  数据库   : ' + dbPath + (dbPath === db.DEFAULT_DB_PATH ? '（与终端共用默认库）' : '（P1B_DB_PATH 覆盖）'));
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
  console.log('  前端 dist: ' + (fs.existsSync(WEB_DIST) ? '已挂载 ' + WEB_DIST : '未构建（p1b/web/dist 不存在，仅 API 可用）'));
  console.log(line);
  return app;
}

if (require.main === module) {
  start().catch((e) => {
    process.stderr.write('[p1b] 启动失败: ' + (e && e.stack ? e.stack : String(e)) + '\n');
    process.exit(1);
  });
}
module.exports = { buildServer, start, lanAddresses, resolveListenConfig, isOpenHost, WEB_DIST };
