'use strict';
/**
 * 局鉴 · test/package.test.cjs —— ★npm 包里到底装了什么
 *
 * ══ 为什么需要它 ═════════════════════════════════════════════════════════
 *   复现记录（2026-10-06，第一次准备 npm publish 时）：
 *     `npm pack --dry-run` 出来 49 个文件 —— **没有 `web/`，也没有 `bench/`**。
 *   而 `package.json` 的 `files` 白名单当时是
 *     ["LICENSE","README.md","bin","data","docs","gates","scripts","src","test"]
 *   —— 漏了这两个目录。后果不是"少点东西"，是两个功能整块坏掉、且**装完当场看不出**：
 *     · `jujian <局号> say` / 网页四屏：服务端要读 `web/`，读不到 ⇒ 前端全 404
 *     · `jujian-bench`：入口 require `../bench/run-bench.cjs` ⇒ 一跑就 MODULE_NOT_FOUND
 *   更糟的是反方向：`data/` 整目录被打进去，连**玩家自己的对局库 `data/jujian.db`** 一起发了。
 *
 *   ★这是本项目第 N 次同一类错误：「在我这儿是对的」≠「发出去是对的」。
 *     本地测试全绿，因为本地什么文件都在；坏的是**发行物**，而本地从不消费发行物。
 *   ⇒ 所以守卫必须**真的问 npm**（跑 `npm pack --json`），而不是核对一份自己维护的清单。
 *     自己维护清单 = 拿实现去验实现，清单漏了什么它照样漏。
 *
 * ══ 口径 ═════════════════════════════════════════════════════════════════
 *   ① 三个 bin 入口 require 到的每个相对路径，都必须在包里（真跑 pack，不看文件系统）。
 *   ② `web/` 是 HTTP 服务的运行时依赖（静态托管读它）⇒ 必须在包里。
 *   ③ 玩家数据不得进包：`*.db` 一个都不许有。
 *   ④ `mcpName` 必须与 `docs/mcp/server.json` 的 `name` 一致（registry 的 npm 所有权验证靠它）。
 *   ⑤ `files` 白名单必须是显式枚举，不许用通配。
 *
 *   跑 `npm pack` 需要 npm 在 PATH 上；拿不到就**跳过**并说明（守卫不越权：
 *   它不该因为环境缺 npm 就判红，那会把「没装 npm 的人」挡在门外）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** 真问 npm：这个包会发出去哪些文件。失败返回 null（调用方决定跳过还是判红）。 */
let _packCache;
function packFileList() {
  if (_packCache !== undefined) return _packCache;
  // ★走 npm CLI 的 JS 入口而不是 shell 里的 `npm`：
  //   Windows 上 spawnSync('npm') 会命中 npm.cmd 的批处理包装，
  //   在 Git Bash / cmd 两套转义规则下都不稳（本项目已在别处踩过同类坑）。
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const cmd = fs.existsSync(npmCli) ? process.execPath : 'npm';
  const args = (fs.existsSync(npmCli) ? [npmCli] : []).concat(['pack', '--dry-run', '--json']);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) { _packCache = null; return null; }
  try {
    const j = JSON.parse(r.stdout);
    const files = (j[0] && j[0].files) || [];
    _packCache = files.map((f) => f.path.replace(/\\/g, '/'));
    return _packCache;
  } catch (e) { _packCache = null; return null; }
}

const PACK_AVAILABLE = packFileList() !== null;
const SKIP = PACK_AVAILABLE ? false : '本机跑不了 `npm pack`（npm 不可用），打包守卫跳过';

test('★① 三个 bin 入口 require 到的相对文件，必须都在 npm 包里', { skip: SKIP }, () => {
  const files = packFileList();
  const set = new Set(files);
  const missing = [];
  for (const entry of ['bin/jujian.cjs', 'bin/jujian-mcp.cjs', 'bin/jujian-bench.cjs']) {
    const src = fs.readFileSync(path.join(ROOT, entry), 'utf8');
    // 静态扫 require('../x') —— 只认字面量，与 zero-dep.test.cjs 同一种手法（不执行代码）。
    for (const m of src.matchAll(/require\(\s*'(\.[^']+)'\s*\)/g)) {
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(entry), m[1]));
      if (rel.startsWith('..')) continue;
      // 源文件可能带也可能不带扩展名（require('../src/db/store') 与 '.../store.js' 都合法）。
      const cands = [rel, rel + '.cjs', rel + '.js', rel + '/index.cjs', rel + '/index.js'];
      if (!cands.some((c) => set.has(c))) missing.push(entry + ' → ' + rel);
    }
  }
  assert.deepEqual(missing, [],
    '★这些文件没进 npm 包，装了你的人一跑就 MODULE_NOT_FOUND：\n  ' + missing.join('\n  '));
});

test('★② web/ 是 HTTP 服务的运行时依赖，必须在包里（前端不是可选项）', { skip: SKIP }, () => {
  const files = packFileList();
  for (const f of ['web/index.html', 'web/app.js', 'web/app.css', 'web/api.js',
    'web/views/games.js', 'web/views/record.js', 'web/views/review.js', 'web/views/about.js']) {
    assert.ok(files.includes(f), '★npm 包里缺 ' + f + ' —— 服务端从 web/ 读页面，缺了前端四屏全 404');
  }
  // ★web/package.json **必须随包发**：它是 Node 侧把 web/*.js 当 ES 模块解析所必需的，
  //   而本包带着 test/（render.test.cjs 要 import 那些视图）。
  //   2026-10-06 实测：排除它 ⇒ 发行树里跑测试 3 条红（"Cannot use import statement outside a module"）。
  //   「构建标记不外发」听起来省事，代价是**发出去的那份自己就是红的**。
  assert.ok(files.includes('web/package.json'),
    '★npm 包里缺 web/package.json —— 它是 ES 模块标记，render 测试要靠它 import web/views/*.js');
});

test('★②b 两个「守卫依赖」文件必须在包里 —— 缺了它们，装完跑测试是红的', { skip: SKIP }, () => {
  // ★这条是被一次**变异测试**逼出来的（2026-10-06）：
  //   我把 `files` 里的 `.gitattributes` 删掉，跑 ★② —— **它照样绿**。
  //   而 npm pack 实测：74 → 73 个文件，`.gitattributes` 真的没了。
  //   缺了它会发生什么？`test/readme.test.cjs` ⑭ 要读它，读不到直接判红 ——
  //   也就是说**装了这个包的人 `npm test` 会红**，而我的守卫没拦住。
  //   ★这正是本项目最怕的那类：守卫看起来在岗，漏的恰好是它该看的那个文件。
  //   ⇒ 单列一条，把「发行物里必须能跑通测试」所依赖的文件逐个点名。
  const files = packFileList();
  for (const [f, why] of [
    ['.gitattributes', '换行守卫（readme.test.cjs ★⑭）要读它；缺了它，包使用者跑 npm test 直接红'],
    ['web/package.json', 'ES 模块标记；缺了它，render 测试三条红'],
  ]) {
    assert.ok(files.includes(f), '★npm 包里缺 ' + f + ' —— ' + why);
  }
});

test('★③ 玩家数据一个字节都不许进包（连自己的库一起发给别人是最糟的事）', { skip: SKIP }, () => {
  const files = packFileList();
  const db = files.filter((f) => /\.(db|db-wal|db-shm|sqlite3?)$/.test(f));
  assert.deepEqual(db, [], '★npm 包里出现了库文件（里面是玩家这一局的发言与身份声称）：' + db.join(', '));
  // 角色数据是产品的一部分，反过来说它必须**在**
  assert.ok(files.includes('data/roles-zh.json'),
    '★data/roles-zh.json 是血染钟楼 130 个角色的全部语义，必须在包里');
});

test('★④ mcpName 必须与 server.json 的 name 一致（registry 的 npm 所有权验证靠它）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const serverJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'mcp', 'server.json'), 'utf8'));
  assert.equal(pkg.mcpName, serverJson.name,
    '★package.json 的 mcpName 与 docs/mcp/server.json 的 name 不一致 —— '
    + 'MCP registry 用它验证 npm 包归属，不一致会被拒；且游标 readers 会认错 server');
  assert.match(pkg.mcpName, /^io\.github\./, '★GitHub 命名空间下的 mcpName 必须以 io.github. 开头');

  // registry 规范：registryType 必须是已知包类型，identifier 是**包名**不是 server 名
  const p = serverJson.packages[0];
  const KNOWN = ['npm', 'pypi', 'nuget', 'cargo', 'oci', 'mcpb'];
  assert.ok(KNOWN.includes(p.registryType),
    '★registryType=' + p.registryType + ' 不在官方枚举 ' + KNOWN.join('/') + ' 里');
  assert.equal(p.registryType, 'npm', '本包是 npm 包，registryType 应为 npm');
  assert.equal(p.identifier, pkg.name,
    '★identifier 要填 npm 包名（' + pkg.name + '），不是 server name；填错客户端会去装一个不存在的包');
  assert.ok(!p.registryBaseUrl,
    'registryBaseUrl 的语义是底层包注册表（npm 时为 registry.npmjs.org），官方模板不含此字段，不填为宜');
});

test('★⑤ files 白名单必须显式枚举，且与真实存在的顶层目录对齐', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, '★必须显式给出 files 白名单');
  for (const f of pkg.files) {
    assert.ok(!/[*?]/.test(f), '★files 里不许用通配（' + f + '）—— 通配会在某天悄悄多带一个目录出去');
  }
  // 白名单里的每个路径都必须真实存在（打错字 = npm 静默忽略 = 又是一个缺文件的包）
  for (const f of pkg.files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), '★files 里的 ' + f + ' 在仓库里不存在（拼错了？）');
  }
});

test('★⑥ 声明的最低 Node 版本，必须真能跑起来（门槛不是抄来的，是测出来的）', { skip: SKIP }, () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const eng = pkg.engines && pkg.engines.node;
  assert.ok(eng, '★必须在 engines 里声明 Node 门槛');
  // ★这条的由来（2026-10-06 实测）：node:sqlite 的免标志门槛**不是一条直线** ——
  //   22.12 ✗ / 22.13 ✓ / 23.0 ✗ ✗ ✗ / 23.4 ✓。
  //   原来的 ">=22.5.0" 会让 22.5–22.12 与 23.0–23.3 的用户体检全绿、然后每个命令都崩
  //   （报错是一句 "No such built-in module: node:sqlite"，用户猜不到是版本问题）。
  //   现在声明的是实测过的两个区间；这条断言保证「声明」与「doctor 的判据」不会各说各话。
  const doctor = fs.readFileSync(path.join(ROOT, 'scripts', 'doctor.cjs'), 'utf8');
  assert.match(doctor, /node:sqlite/, 'doctor 必须自己检查 node:sqlite 的可用性');
  assert.ok(/22\.13/.test(eng) && /23\.4/.test(eng),
    `★engines.node 应写成实测过的区间（如 ^22.13.0 || >=23.4.0），当前是 ${eng}`);
  assert.doesNotMatch(eng, />=22\.5(?![.\d])/,
    '★不许再声明 ">=22.5.0" 这种整段门槛 —— 22.5–22.12 与 23.0–23.3 上 node:sqlite 要加标志，会崩');
  // 本机版本必须真的落在这条门槛里（自己都不满足就不用谈发版）
  const [maj, min] = process.versions.node.split('.').map(Number);
  const okHere = (maj === 22 && min >= 13) || (maj === 23 && min >= 4) || maj >= 24;
  assert.ok(okHere, `本机 Node v${process.versions.node} 不在声明门槛内 —— 先把环境修好`);
});
