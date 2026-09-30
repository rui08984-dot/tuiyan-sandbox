'use strict';
/**
 * launcher/boot.cjs —— 绿色包启动器八步时序的**后四步**（④端口探测 ⑤起服务 ⑥健康检查 ⑦开浏览器 ⑧首启横幅）
 *
 * ── 为什么拆成两个文件（①②③ 在 start.bat，④⑤⑥⑦⑧ 在这里）──────────────
 *   ①②③ 是纯文件动作（建目录、拷种子库并校验、拷配置模板），bat 天然能做，且**看得见**。
 *   ④⑤⑥⑦⑧ 要做「占端口探测 / 起异步服务 / 轮询 HTTP / 数行数 / 开浏览器」——
 *   这些在 bat 里写要靠 `for /f` + 引号转义去跑 `node -e`，**正是 A1b 点名的坑**
 *   （含空格与中文的路径会把转义炸开）。所以这四步整个交给本文件：一次进程、零转义，
 *   同一套代码在测试里也能真跑。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────
 *   · **不碰产品源码**：只 require `p1b/src/server.js` 并调它导出的 `start()`；
 *     全部行为都靠既有注入点（P1B_DB_PATH / P1B_PROVIDERS_PATH / PORT / P1B_LLM_MOCK）实现。
 *   · **零新依赖**：只用 node 内置（net / fs / path / child_process / node:sqlite）。
 *   · **零写程序目录**：只写数据目录下的 logs/（pid 文件、startup.log）。
 *   · **零出站网络**：开浏览器走本机的 `start`。
 *
 * 用法（一般不由人直接跑，start.bat 会调它）：
 *   runtime\node\node.exe launcher\boot.cjs [--no-browser] [--debug] [--port N]
 *
 * 退出码（★与 start.bat 的文案一一对应）：
 *   0  正常结束（通常是服务被 Ctrl+C / stop.bat 停掉）
 *   1  启动过程抛错
 *   2  缺 P1B_DATA_DIR（直接手跑才会遇到）
 *   3  端口全被占，或日志目录不可写
 *   4  便携 node.exe 缺失（包解压不完整）
 *   5  健康检查超时（★打印 startup.log 路径，这是唯一能救命的线索）
 *   7  已经在跑（pid 文件里的进程还活着）⇒ 不许起第二个
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const 树根 = path.resolve(__dirname, '..');          // 发行树根（★从 __dirname 推，不写死盘符）
const 说 = (s) => process.stdout.write(s + '\n');
const 详说 = (s) => { if (String(process.env.P1B_DEBUG) === '1') 说('  · ' + s); };

// ── ④ 端口探测：起端口连试 3 个，第一个 bind 得上的就用 ────────────────────
/** 这个端口此刻能不能 bind（只看 127.0.0.1 —— 服务本来就只听本机） */
function 端口空着(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '127.0.0.1');
  });
}
/** 从 `从` 起连试 `几个` 个；全被占返回 0 */
async function 选端口(从, 几个) {
  const n = Math.max(1, Number(几个) || 3);
  for (let i = 0; i < n; i++) {
    const p = Number(从) + i;
    if (await 端口空着(p)) { 详说('端口 ' + p + ' 空着，用它'); return p; }
    详说('端口 ' + p + ' 被占，试下一个');
  }
  return 0;
}

/**
 * 首启 mock 判定：配置里**有任何一条**非空 api_key 才算 LIVE，否则强制 MOCK。
 * ★为什么不让 llm.js 自己判（它本来就会「无 key 落 mock」）：那判据只看得到**激活**供应商，
 *   而首启模板里所有 key 都是空的——用户只填了非激活供应商的 key 时，界面会说 LIVE 而实际发不出去。
 *   这里按「有没有任何一条非空 key」判：宁可 mock 也不说假话。
 * @param {string} [文件] 配置文件路径，缺省取 env P1B_PROVIDERS_PATH
 * @returns {boolean} true = 该走 MOCK
 */
function 需要Mock(文件) {
  const f = String(文件 || process.env.P1B_PROVIDERS_PATH || '').trim();
  if (!f) return true;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return true; }
  const ps = (j && typeof j === 'object' && j.providers) || {};
  for (const k of Object.keys(ps)) {
    const v = ps[k];
    if (v && typeof v === 'object' && String(v.api_key || '').trim()) return false;
  }
  return true;
}

/** ⑧ 横幅要的一行账本计数（只读；读不到就 null，不猜） */
function 账本行数(dbPath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const n = (sql) => { try { return db.prepare(sql).get().c; } catch { return null; } };
      return { 题: n('SELECT COUNT(*) c FROM predictions'), 已解: n('SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL') };
    } finally { db.close(); }
  } catch (e) { return { 题: null, 已解: null }; }
}

/** ⑥ 健康检查：轮询 /api/health，拿到 200 才算「起来了」 */
async function 等健康(url, 超时, 间隔) {
  const 止 = Date.now() + Math.max(200, Number(超时) || 30000);
  const 隔 = Math.max(50, Number(间隔) || 400);
  let 次 = 0;
  for (;;) {
    次++;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) { const j = await r.json().catch(() => ({})); return { ok: true, 次, 体: j }; }
      详说('健康检查第 ' + 次 + ' 次：HTTP ' + r.status);
    } catch (e) { 详说('健康检查第 ' + 次 + ' 次：' + String((e && e.message) || e).split('\n')[0]); }
    if (Date.now() >= 止) return { ok: false, 次, 体: null };
    await new Promise((r) => setTimeout(r, 隔));
  }
}

/** ⑦ 开浏览器：Windows 的 start。`禁` 为真时一步都不走（测试与 --no-browser 走这条） */
function 开浏览器(url, 禁) {
  if (禁) { 说('（--no-browser：不开浏览器）'); return false; }
  try {
    const c = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    c.unref();
    说('已在浏览器打开：' + url);
    return true;
  } catch (e) {
    说('打不开浏览器（不影响服务，手动访问上面的地址即可）：' + url);
    return false;
  }
}

/**
 * 把控制台输出**同时**抄进 startup.log。
 * ★为什么必须有它：健康检查超时（退出码 5）时，唯一能救命的线索就是服务自己打过什么，
 *   而那些话此刻只在屏幕上滚过去就没了。
 */
function 挂启动日志(日志目录) {
  const 文件 = path.join(日志目录, 'startup.log');
  let 流 = null;
  try {
    fs.mkdirSync(日志目录, { recursive: true });
    流 = fs.createWriteStream(文件, { flags: 'a' });
    流.write('\n===== 启动于 ' + new Date().toISOString() + ' =====\n');
  } catch (e) { 流 = null; }
  if (!流) return '';
  for (const 名 of ['stdout', 'stderr']) {
    const 原 = process[名].write.bind(process[名]);
    process[名].write = (chunk, enc, cb) => {
      try { 流.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk)); } catch { /* 抄写失败不许影响服务 */ }
      return 原(chunk, enc, cb);
    };
  }
  process.on('exit', () => { try { 流.end(); } catch { /* 已关 */ } });
  return 文件;
}

/** 从 argv 里取 --port N（缺省 env PORT，再缺省 8787） */
function 起端口(argv, env) {
  const i = (argv || []).indexOf('--port');
  const v = i >= 0 ? Number((argv || [])[i + 1]) : Number((env || process.env).PORT || 8787);
  return Number.isInteger(v) && v > 0 && v < 65536 ? v : 8787;
}

async function 主流程(argv) {
  const args = argv || process.argv.slice(2);
  const 数据目录 = String(process.env.P1B_DATA_DIR || '').trim();
  if (!数据目录) {
    process.stderr.write('[boot] 缺 P1B_DATA_DIR。start.bat 一定会设；直接手跑本文件请自己设一个。\n');
    return 2;
  }
  const 日志目录 = path.join(数据目录, 'logs');
  const pid文件 = path.join(日志目录, 'server.pid');
  if (args.includes('--debug')) process.env.P1B_DEBUG = '1';   // start-debug.bat 传的就是它
  const 不开浏览器 = args.includes('--no-browser') || process.env.P1B_NO_BROWSER === '1';
  const 超时 = Number(process.env.P1B_HEALTH_TIMEOUT_MS || 30000);
  const nodeExe = path.join(树根, 'runtime', 'node', 'node.exe');
  if (!fs.existsSync(nodeExe)) {
    process.stderr.write('[boot] 找不到便携 Node：runtime\\node\\node.exe（这个包解压不完整，请重新解压）\n');
    return 4;
  }
  const 启动日志 = 挂启动日志(日志目录);
  // 清掉上一次可能残留的「停止请求」标记（上次没人读它，例如窗口被直接关掉）。
  // ★必须在本次启动**之前**清：留着会让 start.bat 把这次的正常结束也当成「按 stop.bat 停的」。
  try { fs.unlinkSync(path.join(日志目录, 'stop-request.flag')); } catch { /* 本来就没有 */ }

  // 已经在跑就别起第二个（pid 文件里的进程还活着就拒）
  try {
    const 旧 = Number(String(fs.readFileSync(pid文件, 'utf8')).trim());
    if (Number.isInteger(旧) && 旧 > 0) {
      try { process.kill(旧, 0); 说('服务已经在跑（pid ' + 旧 + '）。要重开请先双击 stop.bat，或直接关掉那个窗口。'); return 7; }
      catch { /* 那个 pid 已经不在了 ⇒ 下面覆盖写入 */ }
    }
  } catch { /* 没有 pid 文件 ⇒ 首次启动 */ }
  try {
    fs.mkdirSync(日志目录, { recursive: true });
    fs.writeFileSync(pid文件, String(process.pid), 'utf8');
  } catch (e) {
    process.stderr.write('[boot] 写不了 pid 文件（日志目录不可写）：' + 日志目录 + '\n');
    return 3;
  }
  const 清pid = () => { try { if (Number(String(fs.readFileSync(pid文件, 'utf8')).trim()) === process.pid) fs.unlinkSync(pid文件); } catch { /* 已不在 */ } };
  process.on('exit', 清pid);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { 清pid(); process.exit(0); });

  // ④ 端口 + MOCK 判定（一个字符源码都不改，只改 env）
  const 从 = 起端口(args, process.env);
  const 端口 = await 选端口(从, 3);
  if (!端口) {
    process.stderr.write('[boot] 端口 ' + 从 + ' 到 ' + (从 + 2) + ' 全被占。关掉占用者，或设 PORT 环境变量换一个。\n');
    return 3;
  }
  process.env.PORT = String(端口);
  const mock = 需要Mock();
  if (mock) process.env.P1B_LLM_MOCK = '1'; else delete process.env.P1B_LLM_MOCK;
  说('[4/8] 端口 ' + 端口 + '（从 ' + 从 + ' 起，被占就往后试 3 个）· LLM ' + (mock ? 'MOCK（没填 key，零网络）' : 'LIVE（检测到非空 key）'));
  详说('P1B_DB_PATH=' + (process.env.P1B_DB_PATH || '(未设)'));
  详说('P1B_PROVIDERS_PATH=' + (process.env.P1B_PROVIDERS_PATH || '(未设)'));
  详说('P1B_LLM_MOCK=' + (process.env.P1B_LLM_MOCK || '(未设 ⇒ 按激活供应商走)'));

  // ⑤ 起服务（在本进程里起 ⇒ pid 文件里的 pid 就是服务自己的 pid，stop.bat 杀得准）
  const { start } = require(path.join(树根, 'p1b', 'src', 'server.js'));
  await start();

  // ⑥ 健康检查
  const url = 'http://127.0.0.1:' + 端口 + '/';
  const 健 = await 等健康(url + 'api/health', 超时);
  if (!健.ok) {
    process.stderr.write('[boot] ' + Math.round(超时 / 1000) + ' 秒内 /api/health 没回 200（共试了 ' + 健.次 + ' 次）。\n');
    process.stderr.write('      服务可能起来了但页面不响应，也可能启动就崩了。看这个文件：\n      ' + 启动日志 + '\n');
    return 5;
  }
  说('[6/8] 健康检查通过（HTTP 200，试了 ' + 健.次 + ' 次）');

  // ⑧ 首启横幅
  const dbPath = String(process.env.P1B_DB_PATH || '');
  const 行 = 账本行数(dbPath);
  let active = '(读不到)';
  try { active = (JSON.parse(fs.readFileSync(process.env.P1B_PROVIDERS_PATH, 'utf8')).active) || '(无)'; } catch { /* 已在上面打过 */ }
  说('');
  说('------------------------------------------------------------');
  说('  推演沙盘已就绪');
  说('  地址     : ' + url);
  说('  数据目录 : ' + 数据目录 + '   ← 账本、配置、日志都在这里（不在程序目录）');
  说('  账本行数 : ' + (行.题 === null ? 'n/a（库读不到）' : '题 ' + 行.题 + ' · 已解 ' + 行.已解));
  说('  供应商   : ' + active + ' · ' + (mock ? 'MOCK（没填 key，不会发任何网络请求）' : 'LIVE（会用你填的 key 发请求）'));
  说('  停止方法 : 关掉这个窗口 ／ Ctrl+C ／ 另开窗口双击 stop.bat');
  if (健.体 && 健.体.web_built === false) {
    说('  [注意] 前端没构建（web_built=false）：接口通，但浏览器打开的不是工作台。');
    说('         修法：在 p1b\\web 下跑一次 npm run build 后重新打包。');
  }
  说('------------------------------------------------------------');
  说('');
  开浏览器(url, 不开浏览器);
  详说('服务句柄已挂住，进程会活到 Ctrl+C ／ 关窗口 ／ stop.bat。');
  return 0;   // ★返回 0 ≠ 进程退出：服务器的 socket 继续吊着事件循环
}

if (require.main === module) {
  主流程(process.argv.slice(2)).then((码) => {
    if (码 !== 0) process.exit(码);
  }).catch((e) => {
    process.stderr.write('[boot] 启动失败：' + ((e && e.stack) || e) + '\n');
    process.exit(1);
  });
}

module.exports = { 端口空着, 选端口, 需要Mock, 账本行数, 等健康, 开浏览器, 挂启动日志, 起端口, 主流程, 树根 };
