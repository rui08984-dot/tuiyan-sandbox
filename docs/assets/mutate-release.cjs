'use strict';
/**
 * .scratch/mutate-release.cjs —— 变异注入自证跑法（临时验证工具，不入库）
 * ★还原一律用 cp，**绝对不用 git checkout**（它会把工作流尚未提交的改动一起退掉）。
 * 用法：node .scratch/mutate-release.cjs [C1 C2 ...]   —— 不给参数就跑全部 16 条
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = 'E:/music player';
const 脚本 = path.join(ROOT, 'p1b', 'scripts', 'audit-release.cjs');
const 测试 = path.join(ROOT, 'p1b', 'test', 'audit-release.test.cjs');
const 备份 = path.join(ROOT, '.scratch', 'backup', 'audit-release.cjs.orig');

// 变异表**从测试件里就地取**，不另抄一份（抄一份就迟早对不上）
function 取变异表() {
  const src = fs.readFileSync(测试, 'utf8');
  const i = src.indexOf('const 变异表 = [');
  if (i < 0) throw new Error('测试件里找不到 变异表');
  const j = src.indexOf('\n];', i);
  if (j < 0) throw new Error('变异表字面量没闭合');
  return new Function('return ' + src.slice(i + 'const 变异表 = '.length, j + 2))();
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const 只跑 = process.argv.slice(2);
const 变异表 = 取变异表().filter((m) => !只跑.length || 只跑.includes(m.项.replace(/b$/, '')) || 只跑.includes(m.项));

fs.mkdirSync(path.dirname(备份), { recursive: true });
fs.copyFileSync(脚本, 备份);                     // ★cp 备份
const 原 = sha(脚本);
// ★本件会就地改写源码。**任何退出路径（含 Ctrl-C / 超时 / 抛错）都必须还原**，
//   否则下一次跑测试的人会拿到一份被变异过的源码，而且看不出是哪条变异。
let 需还原 = false;
const 还原 = () => { if (!需还原) return; try { fs.copyFileSync(备份, 脚本); 需还原 = false; } catch (e) { console.error('★还原失败，请手工 cp ' + 备份 + ' ' + 脚本); } };
process.on('exit', 还原);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { 还原(); process.exit(130); });
console.log('备份：' + 备份 + '  sha256=' + 原.slice(0, 16) + '…');
console.log('待验变异 ' + 变异表.length + ' 条\n');

const 结果 = [];
for (const m of 变异表) {
  const 原文 = fs.readFileSync(脚本, 'utf8');
  const n = 原文.split(m.从).length - 1;
  if (n !== 1) { console.log('✘ ' + m.项 + ' 锚点出现 ' + n + ' 次（必须恰好 1 次）—— 跳过'); 结果.push([m.项, '锚点' + n + '次', '锚点' + n + '次', '未改动', 0, '']); continue; }
  fs.writeFileSync(脚本, 原文.replace(m.从, m.到), 'utf8');
  需还原 = true;
  let r;
  try {
    r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 测试], { encoding: 'utf8', timeout: 590000, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } finally { 还原(); }
  const 还原ok = sha(脚本) === 原;
  const 出 = (r.stdout || '') + (r.stderr || '');
  const 红的 = [...出.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  // 每个 not ok 块 = 标题 + 断言消息（**消息里才有「是哪一项」**：反向锁 14 项挤在一条用例里，标题看不出项号）
  const 块 = 出.split(/\n(?=not ok \d+ - )/).filter((b) => b.startsWith('not ok '));
  const 红了 = r.status !== 0;
  const 项 = m.项.replace(/b$/, '');
  const 命中块 = 块.filter((b) => b.includes(项));
  const 对应红 = 命中块.length > 0;
  const 首行 = 命中块.length ? (((命中块[0].match(/error: \|-\n\s+(.+)/) || [, ''])[1]) || '').slice(0, 70) : '';
  结果.push([m.项, (红了 ? '红' : '★没红'), 对应红 ? '对应项红✔' : '对应项没红', 还原ok ? 'cp已还原' : '★还原失败', 红的.length, 红的.join(' / ').slice(0, 90)]);
  console.log((红了 ? '✔' : '✘') + ' 变异 ' + m.项 + ' ⇒ 测试' + (红了 ? '红' : '仍然全绿（★空跑！）') +
    (对应红 ? '，红在对应项：' + 首行 : '') + (还原ok ? '，已 cp 还原' : '，★还原失败'));
  if (红了) for (const t of 红的) console.log('        not ok: ' + t);
}

console.log('\n═══ 变异自证汇总（本轮 ' + 结果.length + ' 条）═══');
for (const r of 结果) console.log('  ' + r[0].padEnd(5) + r[1].padEnd(12) + r[2].padEnd(12) + r[3].padEnd(10) + ' 失败用例数=' + r[4] + (r[5] ? '  ' + r[5] : ''));
const 全红 = 结果.every((r) => r[1] === '红');
const 全对应 = 结果.every((r) => r[2] === '对应项红✔');
const 全还原 = 结果.every((r) => r[3] === 'cp已还原');
console.log('\n本轮 ' + 结果.length + ' 条变异全部让测试变红：' + (全红 ? '是' : '否（★有空跑）'));
console.log('本轮全部红在对应项：' + (全对应 ? '是' : '否'));
console.log('全部已 cp 还原：' + (全还原 ? '是' : '否'));
const 末 = spawnSync(process.execPath, ['--test', 测试], { encoding: 'utf8', timeout: 590000, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
console.log('还原后复跑整套测试 exit=' + 末.status + '（期望 0）');
process.exit(全红 && 全对应 && 全还原 && 末.status === 0 ? 0 : 1);
