'use strict';
/**
 * 局鉴 · src/server.js —— 服务入口
 *
 * ══ 三条不许放松的边界 ═════════════════════════════════════════════════
 *  ① **默认只听本机**（127.0.0.1）。要让同一 Wi-Fi 下的手机连，必须显式设
 *     JUJIAN_HOST=0.0.0.0 **并且** JUJIAN_SHARED_TOKEN —— 少一个就拒绝启动。
 *     这不是洁癖：局鉴的库文件里是你这一局每个人的发言与身份声称，
 *     开到局域网而无令牌 = 同一张 Wi-Fi 上的任何设备都能读走。
 *     （这条从推演沙盘原样继承，连拒绝时的排错说明也是同一句。）
 *
 *  ② **默认 MOCK 模式，零网络。** 没配 key 时所有 AI 分析走确定性模板，
 *     功能全部可用，只是措辞固定。想要真分析就设 JUJIAN_LLM_API_KEY。
 *
 *  ③ **默认不上传任何东西。** 本服务没有出网写口；对外部的出网只发生在
 *     「你填了 key 且选了 LIVE 模式」这一条路上，且只发当次分析所需的文本。
 *
 * ── 被剥离掉的模块（v0.1.0 不含，记下来免得日后当成漏做）────────────────
 *   玄学排盘（/api/oracle/* 三条）：沙盘那边自己的代码注释写着「绝不接入任何
 *   游戏研判功能」「梅花查狼实验已证判词无研判效力」，它是赛后彩蛋不是复盘内核。
 *   把它塞进一个严肃的复盘工具里，只会让工具的可信度被稀释。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const Fastify = require('fastify');

const store = require('./db/store');
const llm = require('./llm/engine');
const { createTaskQueue } = require('./taskQueue');
const { makeAdviseRunner } = require('./routes/advise');
const { ensureIdempotencyTables } = require('./http/idempotency');

const ROOT = path.join(__dirname, '..');
const TOKEN_COOKIE = 'jujian_token';

/** 0.0.0.0 / :: / 空 ⇒ 会被局域网看见的地址 */
function isOpenHost(host) {
  return host === '0.0.0.0' || host === '::' || host === '::0' || host === '';
}

/**
 * 监听配置。★对外监听却没令牌 ⇒ 抛错拒绝启动，不是警告。
 * 拒绝时给的是**可照做的修法**，不是一句「配置错误」。
 */
function resolveListenConfig(env) {
  const e = env || process.env;
  const host = String(e.JUJIAN_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(e.PORT || 8788);
  const token = String(e.JUJIAN_SHARED_TOKEN || '').trim();
  const exposed = isOpenHost(host);
  if (exposed && !token) {
    throw new Error(
      '[局鉴] 拒绝启动：JUJIAN_HOST=' + host + ' 会把服务开到局域网上，但没设 JUJIAN_SHARED_TOKEN。\n'
      + '        你这一局里每个人的发言和身份声称都在库里，同一张 Wi-Fi 上的任何设备都能读走。\n'
      + '        两种修法（选一种）：\n'
      + '          ① 只在这台电脑上用 → 去掉 JUJIAN_HOST（或设为 127.0.0.1），不需要令牌；\n'
      + '          ② 想在饭桌上用手机开 → 启动前加这两行：\n'
      + '               set JUJIAN_HOST=0.0.0.0\n'
      + '               set JUJIAN_SHARED_TOKEN=你自己想的一串随机字符\n'
      + '             然后手机浏览器打开一次 http://<本机局域网IP>:8788/?jujian_token=<那串字符>。',
    );
  }
  return { host, port, token, exposed, requiresToken: token.length > 0 };
}

/** 定长比较，避免令牌比较被计时侧信道读出前缀。 */
function tokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const kv of raw.split(';')) {
    const k = kv.split('=')[0].trim();
    if (k === name) return decodeURIComponent(kv.slice(k.length + 1));
  }
  return null;
}

/** 头 → Cookie → 查询串（手机首次打开用查询串，种下 cookie 后就不用再带）。 */
function extractToken(req) {
  const h = req.headers['x-jujian-token'];
  if (typeof h === 'string' && h) return h;
  const c = readCookie(req, TOKEN_COOKIE);
  if (c) return c;
  const q = (req.query && req.query.jujian_token) || '';
  return typeof q === 'string' ? q : '';
}

async function build(opts = {}) {
  const app = Fastify({ logger: false });
  const dbPath = opts.dbPath !== undefined ? opts.dbPath : store.DEFAULT_DB_PATH;
  store.init(dbPath);

  const llmMock = opts.llmMock !== undefined ? !!opts.llmMock : process.env.JUJIAN_LLM_MOCK === '1';
  const listen = opts.listenConfig || resolveListenConfig(process.env);

  const ctx = { store, llm, llmMock, dbPath, root: ROOT };
  // fetchImpl 是测试缝（extract/advise 共用）。生产恒 undefined ⇒ 零行为变化。
  ctx.fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : undefined;
  ctx.queue = createTaskQueue({ runner: makeAdviseRunner(ctx), maxTasks: opts.maxTasks || 200 });

  // 统一错误形状：对外只说人话，内部细节留给日志。
  app.setErrorHandler((err, req, reply) => {
    const code = Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? Number(err.statusCode) : 500;
    if (code >= 500) process.stderr.write('[局鉴] ' + (err.stack || err.message) + '\n');
    reply.code(code);
    return { error: err.message || '内部错误', status: code };
  });
  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return { error: '没有这个接口: ' + req.method + ' ' + req.url, status: 404 };
  });

  // 令牌门：一切请求都要过（/api/health 也过——它会报出库路径，属于信息）。
  if (listen.requiresToken) {
    app.addHook('onRequest', async (req, reply) => {
      if (tokenEquals(extractToken(req), listen.token)) {
        if (readCookie(req, TOKEN_COOKIE) !== listen.token) {
          reply.header('set-cookie', TOKEN_COOKIE + '=' + encodeURIComponent(listen.token)
            + '; Path=/; HttpOnly; SameSite=Strict');
        }
        return;
      }
      reply.code(401);
      return { error: '令牌不对。首次用手机打开请带上 ?jujian_token=<你设的那串字符>', status: 401 };
    });
  }

  app.get('/api/health', async () => ({
    ok: true,
    project: 'jujian',
    version: require('../package.json').version,
    positioning: '复盘器：把一局拆成结构化声称、抓出矛盾、给出可回查的清单。它不替你下结论。',
    db_path: dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath),
    llm_mock: llmMock,
    llm_configured: !!(process.env.JUJIAN_LLM_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY),
    exposed: listen.exposed,
    games: store.listGames().length,
  }));

  ensureIdempotencyTables(store.getConnection());
  require('./http/adapters').register(app);
  require('./routes/games').register(app, ctx);
  require('./routes/events').register(app, ctx);
  require('./routes/advise').register(app, ctx);

  return app;
}

async function start(opts = {}) {
  const app = await build(opts);
  const listen = opts.listenConfig || resolveListenConfig(process.env);
  await app.listen({ host: listen.host, port: listen.port });
  const url = listen.host === '127.0.0.1' ? 'http://127.0.0.1:' + listen.port
    : 'http://<本机局域网IP>:' + listen.port + (listen.requiresToken ? '/?jujian_token=<你的令牌>' : '');
  process.stdout.write(
    '局鉴已启动\n'
    + '  地址   ' + url + '\n'
    + '  库     ' + (listen.exposed ? path.resolve(opts.dbPath !== undefined ? opts.dbPath : store.DEFAULT_DB_PATH) : '本机') + '\n'
    + '  AI     ' + ((opts.llmMock !== undefined ? opts.llmMock : process.env.JUJIAN_LLM_MOCK === '1')
      ? 'MOCK 模式（零网络，措辞固定；功能全可用）'
      : (process.env.JUJIAN_LLM_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY
        ? 'LIVE 模式（会用你的 key，仅在发起分析时出网）'
        : 'MOCK 模式（没找到 key）')) + '\n'
    + '  令牌   ' + (listen.requiresToken ? '已开' : '未设（只听本机）') + '\n'
    + '  停止   Ctrl+C\n');
  return app;
}

module.exports = { build, start, resolveListenConfig, tokenEquals, extractToken, isOpenHost, ROOT };

if (require.main === module) {
  start().catch((e) => {
    process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  });
}
