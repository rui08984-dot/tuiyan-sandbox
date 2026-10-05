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
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** ★顺序有依赖：p1b 的后端要 require p1a 的 better-sqlite3，所以 p1a 先装。
 *  web 独立，放最后（最慢）。 */
const PKGS = [
  { dir: 'p1a-terminal', why: '引擎（数据层 ＋ 矛盾比对器）' },
  { dir: 'p1b', why: '后端（HTTP 服务 ＋ 测试）' },
  { dir: 'p1b/web', why: '前端（React ＋ vite）' },
];

function line(s) { process.stdout.write(s + '\n'); }

function run(dir) {
  line('');
  line('  ── npm install : ' + dir);
  const r = spawnSync(NPM, ['install', '--no-audit', '--no-fund'], {
    cwd: path.join(ROOT, dir), stdio: 'inherit', timeout: 900000,
  });
  if (r.status !== 0) {
    line('  ✖ ' + dir + ' 安装失败（退出码 ' + r.status + '）');
    return false;
  }
  line('  ✔ ' + dir);
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
  }

  line('');
  line('✔ 装齐了。下一步：');
  line('');
  line('    cd p1b && node gates/gates.cjs');
  line('');
  line('  四道闸门（后端 / 构建 / 前端 / 类型）。全绿就可以 npm start 起服务。');
  line('');
}

main();
