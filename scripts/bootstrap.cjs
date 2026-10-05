#!/usr/bin/env node
'use strict';
/**
 * 局鉴 · scripts/bootstrap.cjs —— 一条命令装齐整个项目
 *
 *   node scripts/bootstrap.cjs
 *
 * ★为什么要有它：本仓库有**三个嵌套的 package.json**（引擎 p1a-terminal、
 *   后端 p1b、前端 p1b/web），各自有各自的依赖树。
 *   只 `npm install` 根目录的话，引擎和前端都不装，闸门会红在
 *   「原生模块不可 require / vite 找不到」——而报错信息离根因很远。
 *
 * ★这是匿名克隆实测出来的：公开仓推上去后我以陌生人身份 clone 了一遍，
 *   照旧 README 的「cd p1b && npm install」跑，四道闸门**全红**。
 *   文档说能跑和真能跑之间的差距，只有克隆一次才量得出来。
 *
 * ★Windows 上 npm.cmd 的两个坑（都在真克隆上踩过，都是秒级失败）：
 *   ① `spawnSync('npm.cmd', args, {stdio:'inherit'})` ⇒ `EINVAL`，退出码 null。
 *      Windows 上必须 `shell: true` 才能跑 .cmd；而 `stdio:'inherit'` 与
 *      `timeout` 又不能同时用。⇒ 这里**不用 timeout**（安装本来就该跑完，
 *      外层用户等得起，中途 Ctrl+C 也归他们），只 `shell: true`。
 *   ② npm 装 `better-sqlite3` 时会 warn「node-gyp rebuild not covered by
 *      allowScripts」并**跳过编译**。预编译二进制仍然可用 ⇒ require 不报错。
 *      但真实机器上若 npm 完全禁脚本又无预编译件，安装就会静默半残。
 *      ⇒ bootstrap 装完**逐个 require 关键原生件**，不通就明确告诉用户，
 *      不让他们拿着一个「看起来装好了」的树去跑闸门然后一头雾水。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const NPM = 'npm';

/** ★顺序有依赖：p1b 的后端要 require p1a 的 better-sqlite3，所以 p1a 先装。
 *  web 独立，放最后（最慢）。
 *
 * ★checks 只列**该子包自己 package.json 声明过的依赖**，不凭猜。
 *   实测教训：第一版我在 p1b 的 checks 里写了 better-sqlite3，然后它报红 ——
 *   但那是**假阳性**：`p1b/src/schemaVersion.js:36` 是故意用绝对路径
 *   `require(p1a-terminal/node_modules/better-sqlite3)` 的（注释自述「零新依赖」），
 *   p1b 的 package.json 因此**故意不声明**它。
 *   一个因为「我猜错了依赖关系」而报红的 bootstrap，比没有 bootstrap 更糟 ——
 *   它会教会用户忽略它的输出。 */
const PKGS = [
  { dir: 'p1a-terminal', why: '引擎（数据层 ＋ 矛盾比对器）', checks: ['better-sqlite3'] },
  { dir: 'p1b', why: '后端（HTTP 服务 ＋ 测试）', checks: ['fastify'] },
  { dir: 'p1b/web', why: '前端（React ＋ vite）', checks: ['react', 'vite'] },
];

function line(s) { process.stdout.write(s + '\n'); }

function run(dir) {
  line('');
  line('  ── npm install : ' + dir);
  const r = spawnSync(NPM, ['install', '--no-audit', '--no-fund'], {
    cwd: path.join(ROOT, dir),
    stdio: 'inherit',
    shell: true,     // Windows 上 .cmd 必需；POSIX 上无害
    // ★不给 timeout：stdio:'inherit' 与 timeout 在 Windows 上冲突（EINVAL）
  });
  if (r.status !== 0) {
    line('  ✖ ' + dir + ' 安装失败（退出码 ' + r.status + '，信号 ' + r.signal + '）');
    if (r.error) line('    ' + r.error.message);
    return false;
  }
  line('  ✔ ' + dir + ' 装好');
  return true;
}

/** ★装完必须真的能 require —— 「装了」不等于「能用」。 */
function verify(dir, checks) {
  for (const m of checks || []) {
    try {
      require(require.resolve(m, { paths: [path.join(ROOT, dir)] }));
      line('      · ' + m + ' ✔');
    } catch (e) {
      line('      · ' + m + ' ✖ ' + String(e.message).split('\n')[0]);
      line('');
      line('  ✖ ' + dir + ' 里 ' + m + ' 装不上，闸门一定红在这一项。');
      line('    常见原因：本机 npm 禁用了 install 脚本（better-sqlite3 需要 node-gyp 或预编译件）。');
      line('    可以单独重试： cd ' + dir + ' && npm install --build-from-source');
      return false;
    }
  }
  return true;
}

function main() {
  line('');
  line('局鉴 · 一键安装（' + PKGS.length + ' 个子包）');

  for (const p of PKGS) {
    const abs = path.join(ROOT, p.dir);
    if (!fs.existsSync(path.join(abs, 'package.json'))) {
      line('');
      line('  ✖ 缺 ' + p.dir + '/package.json —— 这个包为什么不在盘上？它应当是仓库的一部分。');
      process.exit(1);
    }
    if (!run(p.dir)) process.exit(1);
    if (!verify(p.dir, p.checks)) process.exit(1);
  }

  line('');
  line('✔ 装齐了，且关键依赖真能 require。下一步：');
  line('');
  line('    cd p1b && node gates/gates.cjs');
  line('');
  line('  四道闸门（后端 / 构建 / 前端 / 类型）。全绿就可以起服务。');
  line('');
}

main();
