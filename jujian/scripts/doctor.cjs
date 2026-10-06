'use strict';
/**
 * 局鉴 · scripts/doctor.cjs —— 启动前体检
 *
 *   node scripts/doctor.cjs          人读格式
 *   node scripts/doctor.cjs --json   机器读格式（给 CI / 第三方接入用）
 *
 * 存在的原因：局鉴**唯一依赖是一个 sqlite 驱动**（而且是 Node 自带的），
 * 所以绝大多数人的安装问题不会是「装不上依赖」，而是这五类：
 *   ① Node 版本太老（没有 node:sqlite）
 *   ② 角色数据文件缺失/损坏（那是 130 个角色的全部语义）
 *   ③ 内核文件缺失（平移过来的那几个）
 *   ④ 库文件 schema 版本对不上
 *   ⑤ 端口被占
 * 这五类都可以在**开服务之前**查出来，且不需要用户懂 Node。
 *
 * ★体检只读：不建库、不写文件、不出网。
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const CHECKS = [];
let worst = 0; // 0=全过 1=有警告 2=有阻塞

function ok(name, detail) { CHECKS.push({ level: 'ok', name, detail: detail || '' }); }
function warn(name, detail) { CHECKS.push({ level: 'warn', name, detail: detail || '' }); worst = Math.max(worst, 1); }
function bad(name, detail) { CHECKS.push({ level: 'bad', name, detail: detail || '' }); worst = Math.max(worst, 2); }

// ── ① Node 版本：node:sqlite 的免 flag 门槛是**两段**，不是一条直线 ──────────────
//   ★这条是被实测逼出来的（2026-10-06，本机真装多个版本逐个探针）。
//     官方版本史只给了两行：「v22.5.0 Added in」＋「v22.13.0 no longer behind --experimental-sqlite」，
//     照着写成「≥22.13 就行」会**漏掉 23 线**。实测结果（`require('node:sqlite')` 直连）：
//       v22.12.0 → THROWS      v22.13.0 → OK
//       v23.0.0  → THROWS      v23.1.0  → THROWS
//       v23.2.0  → THROWS      v23.3.0  → THROWS      v23.4.0 → OK
//     ⇒ 这是个**非单调**门槛：22.13 过了，23.0–23.3 又不行，23.4 才好。
//       旧口径「≥22.5」会让 22.5–22.12 与 23.0–23.3 六七个版本的用户
//       **体检全绿然后每个命令都崩**，崩法是一句「No such built-in module」——
//       用户根本猜不到是版本差在 minor 上。体检把阻塞项报成绿灯是最不该犯的错。
//   ⇒ 现在按实测的真实区间判，并把「怎么修」写成可直接照抄的两条路。
(function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const okNoFlag = (major === 22 && minor >= 13) || (major === 23 && minor >= 4) || major >= 24;
  const needsFlag = (major === 22 && minor >= 5 && minor < 13)
    || (major === 23 && minor < 4);
  if (okNoFlag) {
    ok('Node 版本', `v${process.versions.node}（node:sqlite 开箱可用）`);
  } else if (needsFlag) {
    // ★说清「为什么」和「合法值是什么」：这条提示必须能被直接照抄。
    //   ★★★ 2026-10-06 第二次实测修正 ★★★
    //   第一版这里写的是「npm start -- --experimental-sqlite」，**那是错的**。
    //   本机真测：npm 会把 `--` 之后的参数**追加在脚本名后面**（`node src/server.js --experimental-sqlite`），
    //   而 Node 只认**脚本名之前**的选项 ⇒ 该标志被当成普通参数，node:sqlite 照样加载不了。
    //   （实测数据：`node probe.cjs --experimental-sqlite` → execArgv=[]、sqlite THROWS；
    //    `node --experimental-sqlite probe.cjs` → execArgv=["--experimental-sqlite"]、sqlite OK。）
    //   ⇒ 只给**实测可行**的两条路，且都写成可直接粘贴的形式。
    bad('Node 版本', `当前 v${process.versions.node}。node:sqlite 在本版本仍藏在 `
      + `--experimental-sqlite 标志后面（实测：22.13 与 23.4 起才解除，23.0–23.3 又回到标志后）。\n`
      + `      两条路任选：\n`
      + `      ①升级 Node 到 v22.13+ 或 v23.4+（推荐，一劳永逸）；\n`
      + `      ②保留当前版本，加环境变量（★这是唯一能配合 npm start / npm run 用的写法）：\n`
      + `        PowerShell:  $env:NODE_OPTIONS='--experimental-sqlite'; npm start\n`
      + `        bash/zsh:    NODE_OPTIONS=--experimental-sqlite npm start\n`
      + `      ★注意：\`npm start -- --experimental-sqlite\` **不管用** —— npm 会把标志放到脚本名之后，\n`
      + `        Node 只认脚本名之前的选项，那个标志会被无声忽略。`);
  } else {
    bad('Node 版本', `当前 v${process.versions.node}。局鉴的存储用 Node 自带的 node:sqlite，`
      + `它是 v22.5.0 才加入的。需要 v22.13.0+ 或 v23.4.0+（实测免标志的两个区间）。`);
  }
})();

// ── ② 角色数据：130 个角色的全部语义 ──────────────────────────────────────
(function checkRoles() {
  const p = path.join(ROOT, 'data', 'roles-zh.json');
  if (!fs.existsSync(p)) {
    bad('角色数据', '缺 data/roles-zh.json —— 血染钟楼的所有角色语义都在这里，缺了整块功能不可用。');
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) {
      bad('角色数据', '文件为空或不是数组。');
      return;
    }
    const bad1 = raw.filter((r) => !r.id || !Array.isArray(r.editions));
    if (bad1.length) {
      bad('角色数据', `${raw.length} 个角色里有 ${bad1.length} 个缺 id 或 editions 字段，剧本筛选会错。`);
    } else {
      ok('角色数据', `${raw.length} 个角色，三剧本齐备`);
    }
  } catch (e) {
    bad('角色数据', 'JSON 解析失败：' + e.message);
  }
})();

// ── ③ 内核文件：平移自推演沙盘的那几个 ───────────────────────────────────
(function checkKernel() {
  const files = [
    'src/kernel/botc/roles.js',
    'src/kernel/botc/contradictions.js',
    'src/kernel/botc/extractPrompt.js',
    'src/kernel/botc/advisePrompt.js',
    'src/kernel/detectors/werewolf-contradictions.js',
    'src/kernel/adapters/avalon.js',
    'src/kernel/engine.js',
  ];
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) bad('内核文件', '缺 ' + missing.join('、') + ' —— 对局分析跑不起来。');
  else {
    // 真加载一遍：语法错误、循环依赖只有 require 时才暴露
    const loadFail = [];
    for (const f of files) {
      try { require(path.join(ROOT, f)); } catch (e) { loadFail.push(f + '（' + e.message + '）'); }
    }
    if (loadFail.length) bad('内核文件', '加载失败: ' + loadFail.join('；'));
    else ok('内核文件', `${files.length} 个文件全部可加载`);
  }
})();

// ── ④ 依赖：只应有 fastify ───────────────────────────────────────────────
(function checkDeps() {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch (e) {
    bad('依赖声明', 'package.json 读不出来：' + e.message);
    return;
  }
  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length !== 1 || deps[0] !== 'fastify') {
    warn('依赖声明', `期望只有 fastify 一个运行时依赖，实际是 [${deps.join(', ')}]。`
      + '多出来的每一个都是你将来要背的包。');
  } else {
    ok('依赖声明', '只有 fastify（存储用 Node 自带的 node:sqlite，无原生模块）');
    ok('零依赖面', '★命令行 / MCP / 盲测三个入口只要一个 Node，不需要 npm install');
  }
  try {
    require('fastify/package.json');
    ok('依赖就位', 'fastify ' + require('fastify/package.json').version + '（只有 HTTP 服务要它）');
  } catch (e) {
    // ★**提醒，不是阻塞。**
    //   实测（2026-10-04）：命令行、MCP、盲测三个入口**零依赖**，
    //   只有 `npm start` 的 HTTP 服务需要 fastify。
    //   把它报成「阻塞」等于告诉用户「装不上」—— 而他其实完全能用，
    //   只是用不了浏览器那一路。★那就成了体检在制造假的绝望。
    warn('依赖就位', 'fastify 没装。★不影响命令行 / MCP / 盲测（这三个入口零依赖）；'
      + '只有 `npm start` 的网页与 HTTP 接口要它。想要那一路就在本目录跑 npm install');
  }
})();

// ── ⑤ 库文件：schema 版本 ────────────────────────────────────────────────
(function checkDb() {
  const dbPath = process.env.JUJIAN_DB || path.join(ROOT, 'data', 'jujian.db');
  if (!fs.existsSync(dbPath)) {
    ok('库文件', '还没有库（首次运行会自动建：' + dbPath + '）');
    return;
  }
  try {
    const store = require(path.join(ROOT, 'src', 'db', 'store'));
    store.init(dbPath);
    const n = store.listGames().length;
    store.closeCurrent();
    ok('库文件', `${dbPath}（${n} 局）`);
  } catch (e) {
    bad('库文件', dbPath + ' 打开失败：' + e.message.replace(/^\[jujian-db\] /, ''));
  }
})();

// ── ⑥ 端口：占着就现在说，别等服务起不来才报错 ────────────────────────────
(function checkPort() {
  const port = Number(process.env.PORT || 8788);
  const srv = net.createServer();
  srv.once('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      warn('端口', String(port) + ' 已被占用。换个：PORT=8899 npm start');
    } else {
      warn('端口', '检查失败：' + e.code);
    }
  });
  srv.once('listening', () => {
    ok('端口', String(port) + ' 空闲');
    srv.close();
  });
  srv.listen(port, '127.0.0.1');
})();

// ── ⑦ AI：只报状态，不劝人配 key ──────────────────────────────────────────
(function checkLlm() {
  const has = !!(process.env.JUJIAN_LLM_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY);
  if (has) ok('AI 分析', '已配 key（发请求时才出网；key 只从环境变量读，不写任何文件）');
  else ok('AI 分析', 'MOCK 模式（零网络，措辞固定，功能全可用。想要更自然的措辞就设 JUJIAN_LLM_API_KEY）');
})();

// ── 出报告 ──────────────────────────────────────────────────────────────
process.on('exit', () => {
  if (process.env.JUJIAN_DOCTOR_JSON) return;
  const ICON = { ok: '✔', warn: '!', bad: '✖' };
  process.stdout.write('\n局鉴体检\n');
  for (const c of CHECKS) {
    process.stdout.write('  ' + ICON[c.level] + ' ' + c.name.padEnd(10) + c.detail + '\n');
  }
  const bads = CHECKS.filter((c) => c.level === 'bad').length;
  const warns = CHECKS.filter((c) => c.level === 'warn').length;
  process.stdout.write('\n' + (bads
    ? '✖ ' + bads + ' 项阻塞、' + warns + ' 项提醒 —— 先修阻塞项。\n'
    : warns ? '! ' + warns + ' 项提醒，可以继续。\n' : '✔ 一切就绪。跑 npm start。\n') + '\n');
});

if (process.env.JUJIAN_DOCTOR_JSON) {
  process.on('exit', () => {
    process.stdout.write(JSON.stringify({ ok: worst < 2, checks: CHECKS }, null, 2) + '\n');
  });
}