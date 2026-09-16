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

/** 组装 Fastify 实例（不监听；测试用 app.inject 即真 HTTP 语义） */
async function buildServer(opts) {
  opts = opts || {};
  const dbPath = opts.dbPath || process.env.P1B_DB_PATH || db.DEFAULT_DB_PATH;
  const llmMock = opts.llmMock !== undefined ? !!opts.llmMock : process.env.P1B_LLM_MOCK === '1';
  const store = createProvidersStore(opts.providersPath || process.env.P1B_PROVIDERS_PATH);

  db.init(dbPath); // 复用 p1a 连接管理（:memory: 或共享 data/p1a.db，WAL 多进程安全）
  botcClaims.ensureBotcTables(db.getConnection()); // B2：p1b 私有表 botc_games/botc_claims（CREATE TABLE IF NOT EXISTS，additive，零碰 p1a 既有表）

  const app = Fastify({ logger: opts.logger === true });
  // CORS：局域网可信网（规格 §6 明确不做鉴权），反射任意来源——手机/桌面浏览器跨机直连需要
  await app.register(require('@fastify/cors'), { origin: true });
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
  const port = Number(process.env.PORT || 8787);
  const host = '0.0.0.0';
  const app = await buildServer();
  const dbPath = (app.p1b && app.p1b.dbPath) || process.env.P1B_DB_PATH || db.DEFAULT_DB_PATH; // 实际生效 dbPath（横幅铁律：打印真实值）
  await app.listen({ port, host });
  const line = '-'.repeat(64);
  console.log(line);
  console.log('推演沙盘 P1b 网页工作台 · 后端已启动');
  console.log('  数据库   : ' + dbPath + (dbPath === db.DEFAULT_DB_PATH ? '（与终端共用默认库）' : '（P1B_DB_PATH 覆盖）'));
  console.log('  LLM 模式 : ' + (process.env.P1B_LLM_MOCK === '1' ? 'MOCK（P1B_LLM_MOCK=1，零网络）' : '按激活供应商（无 key 自动落 mock）'));
  console.log('  本机访问 : ' + lanAddresses(port)[0]);
  for (const u of lanAddresses(port).slice(1)) console.log('  局域网   : ' + u + '  ← 手机连同一 Wi-Fi 用这个');
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
module.exports = { buildServer, start, lanAddresses, WEB_DIST };
