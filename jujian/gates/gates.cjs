#!/usr/bin/env node
'use strict';
/**
 * 局鉴 · gates/gates.cjs —— 提交前的闸门
 *
 *   node gates/gates.cjs          跑全部
 *   node gates/gates.cjs --list   只列不跑
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────────
 *   局鉴的卖点是「矛盾清单��每条都带无辜解释、每条都能回查」——
 *   这类承诺最容易在一次赶时间的改动里悄悄失效，而且**不会报错**：
 *   测试照样绿，只是矛盾少了、或者开始编造。
 *   ⇒ 把这些承诺做成每次提交都必须过的机械闸门，而不是靠人记得。
 *
 * ── 与推演沙盘四道闸门的不同（刻意不同，不照抄）────────────────────────
 *   沙盘有 build / types 两道前端闸门，因为那边带 React 前端。
 *   局鉴 v0.1.0 **没有前端**（见 §定位），所以闸门换成三道与后端同权重的东西：
 *   冒烟、端点清单、体检。多一道「契约不许悄悄变」��少一道「产物能构建」。
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

const GATES = [
  {
    name: '测试',
    desc: '存储层 ＋ 契约层 ＋ 内核漂移守卫 ＋ README 守卫',
    cmd: process.execPath,
    args: ['--test', '--test-reporter=dot', 'test/store.test.cjs', 'test/api.test.cjs',
      'test/kernel-drift.test.cjs', 'test/readme.test.cjs'],
    cwd: ROOT,
  },
  {
    name: '冒烟',
    desc: '端到端走完一局：建局→录入→原子确认→天结算→撤回→导出→三条护栏→幂等→令牌门',
    cmd: process.execPath,
    args: ['scripts/smoke.cjs'],
    cwd: ROOT,
  },
  {
    name: '体检',
    desc: 'Node 版本 / 角色数据 / 内核可加载 / 依赖 / 库版本 / 端口 —— 出厂前查五类安装事故',
    cmd: process.execPath,
    args: ['scripts/doctor.cjs'],
    cwd: ROOT,
  },
];

function run(g) {
  const started = Date.now();
  const r = spawnSync(g.cmd, g.args, { cwd: g.cwd, encoding: 'utf8', timeout: 180000 });
  return {
    code: r.status === null ? -1 : r.status,
    ms: Date.now() - started,
    out: (r.stdout || '') + (r.stderr || ''),
  };
}

if (process.argv.includes('--list')) {
  process.stdout.write('局鉴闸门（' + GATES.length + ' 道）\n');
  GATES.forEach((g, i) => process.stdout.write('  ' + (i + 1) + '. ' + g.name + ' —— ' + g.desc + '\n'));
  process.exit(0);
}

const results = [];
for (let i = 0; i < GATES.length; i++) {
  const g = GATES[i];
  process.stdout.write('\n' + '='.repeat(66) + '\n');
  process.stdout.write('[' + (i + 1) + '/' + GATES.length + '] ' + g.name + ' · ' + g.desc + '\n');
  process.stdout.write('='.repeat(66) + '\n');
  const r = run(g);
  results.push({ g, r });
  // 体检是人类可读报告，原样透出；另两道只要点阵输出，出错时才全量打印。
  if (g.name === '体检') process.stdout.write(r.out);
  else if (r.code !== 0) process.stdout.write(r.out);
  else process.stdout.write(r.out.trim().split('\n').pop() + '\n');
  process.stdout.write('\n[' + (i + 1) + '/' + GATES.length + '] 退出码 = ' + r.code + '    用时 = '
    + (r.ms / 1000).toFixed(2) + 's\n');
}

process.stdout.write('\n' + '='.repeat(66) + '\n闸门汇总\n' + '='.repeat(66) + '\n');
let failed = 0;
for (const { g, r } of results) {
  if (r.code !== 0) failed++;
  process.stdout.write('  ' + (r.code === 0 ? '绿' : '红') + '  ' + g.name.padEnd(6)
    + '退出码=' + r.code + '   用时=' + (r.ms / 1000).toFixed(2) + 's\n');
}
const total = (results.reduce((a, x) => a + x.r.ms, 0) / 1000).toFixed(2);
process.stdout.write('  总用时 = ' + total + 's\n\n');

if (failed) {
  process.stdout.write('✖ ' + failed + ' 道闸门红。提交被拦住是对的。\n');
  process.exit(1);
}
process.stdout.write('✔ 全部闸门通过。\n');