'use strict';
/**
 * 局鉴 · scripts/doctor.cjs —— 陌生人第一次 clone 之后，跑这一条
 *
 *   node scripts/doctor.cjs
 *
 * ★为什么要有它
 *
 *   发布后我以匿名身份 clone 了一遍，照 README 走完 bootstrap，四道闸门里
 *   **backend 那道红**，17 秒就退。根因不在代码，在**数据**：
 *   `p1a-terminal/data/p1a.db`（生产库）按设计**不入库**（里面有真实玩家信息），
 *   而一堆读数脚本默认读它。于是克隆者的机器上，能装、能构建、类型也过，
 *   一到「读数」就 `no such table: predictions`。
 *
 *   这个坑我修了三轮才认清它的形状：第一次以为缺 node_modules（已由 bootstrap 解决）、
 *   第二次以为缺 `.run-out` 目录、第三次才撞见 SQL 报错。
 *   ★每次的报错都在离根因很远的地方 —— 这正是该有一条 doctor 的理由。
 *
 *   ★它解决的问题不是「帮你把库变出来」（那要碰真实数据，不能代做），
 *     而是**把「你缺什么、为什么、接下来怎么办」在三十秒内说清**，
 *     而不是让人在红字里猜。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NPM = 'npm';

function line(s = '') { process.stdout.write(s + '\n'); }
function ok(s) { line('  ✔ ' + s); }
function warn(s) { line('  ! ' + s); }
function bad(s) { line('  ✖ ' + s); }
function tip(s) { line('      → ' + s); }

const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SEED = path.join(ROOT, 'seed', 'p1a-seed.db');
const P1B_NM = path.join(ROOT, 'p1b', 'node_modules');
const P1A_NM = path.join(ROOT, 'p1a-terminal', 'node_modules');
const WEB_NM = path.join(ROOT, 'p1b', 'web', 'node_modules');

let 阻塞 = 0;
let 提醒 = 0;

function check(label, fn) {
  line();
  line(label);
  fn();
}

// ── ① Node 版本 ──────────────────────────────────────────────────────────
check('① Node 版本', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok('Node ' + process.versions.node + '（≥22，node:sqlite 可用）');
  else { bad('Node ' + process.versions.node + ' —— 项目用了内置 node:sqlite，需要 ≥22'); 阻塞++; }
});

// ── ② 依赖装没装 ─────────────────────────────────────────────────────────
check('② 依赖（三个子包各自的 node_modules）', () => {
  let 齐 = true;
  for (const [dir, nm] of [['p1a-terminal', P1A_NM], ['p1b', P1B_NM], ['p1b/web', WEB_NM]]) {
    if (fs.existsSync(nm)) ok(dir + '/node_modules 在');
    else { warn(dir + '/node_modules 不在——那一层现在起不来'); 齐 = false; 提醒++; }
  }
  if (!齐) tip('跑一条命令装齐：npm run bootstrap');
});

// ── ③ 读数要用的库 ───────────────────────────────────────────────────────
check('③ 读数数据（★这一条最容易被忽视，也最要命）', () => {
  const 有生产 = fs.existsSync(PROD);
  const 有种子 = fs.existsSync(SEED);

  if (有生产) {
    // ★不能只看文件在不在 —— 一次 node --test 就会留下一个**空库**（几万字节，
    //   一张表都没有）。那比没有库更坏：doctor 会说「库在」，然后闸门红在
    //   `no such table: predictions`，根因又一次被埋在两层下面。
    //   实测：干净 clone 后跑过测试，p1a.db 40960 字节 / 0 张表。
    const 表数 = 数表(PROD);
    if (表数 === null) { warn('生产库在但**读不出表数**（权限？损坏？）：' + path.relative(ROOT, PROD)); 提醒++; }
    else if (表数 === 0) {
      warn('生产库在但**一张表都没有**（是测试留下的空壳）：' + path.relative(ROOT, PROD));
      line('        一行读数都出不来。按下面的④补。');
      提醒++;
    } else ok('生产库在且可读（' + 表数 + ' 张表）：' + path.relative(ROOT, PROD));
  } else {
    // ★不解释说「你应该有它」——它按设计就不该在克隆里。
    line('    生产库不在（这是**正常的**，它按设计不入库：里面有真实玩家信息）。');
    line('    一批读数脚本默认读它，所以缺它的时候「能装、能构建，一到读数就红」。');
    提醒++;
  }

  if (有种子) ok('脱敏种子库在：' + path.relative(ROOT, SEED) + '（陌生人看到的第一批数据走它）');
  else warn('脱敏种子库不在（seed/p1a-seed.db）——陌生人默认看到的东西缺了');
});

/**
 * 数一个 SQLite 库里用户表的张数。打不开 / 不是库文件 ⇒ null（不抛）。
 * ★只读打开，且只跑 sqlite_master 查询，绝不写。
 */
function 数表(dbPath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(dbPath, { readOnly: true });
    const row = d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
    d.close();
    return Number(row.n);
  } catch (_) {
    return null;
  }
}

check('④ 读数缺数据时怎么补（三条路，按你的处境选）', () => {
  if (数表(PROD) > 0) { ok('你的生产库可读（' + 数表(PROD) + ' 张表），不用补'); return; }
  line('    这三条路按代价从低到高，**都不需要把真实玩家数据交出来**：');
  line('');
  line('      A｜只看界面与结构（零数据）：读数类页面会显示「暂无数据」。');
  line('         真相只读、界面、闸门里的多数项都不依赖它。');
  line('         → 不用做任何事，直接用。缺的那部分会自己说明缺。');
  line('');
  line('      B｜想让读数也活：用**自己**的判断题建一个账本。');
  line('         → node p1b/scripts/make-seed-db.cjs --out seed/p1a-seed.db');
  line('         （它从现存库拷结构并剔昵称；没有源库时它会告诉你缺什么）');
  line('');
  line('      C｜你就是要复现沙盘自己的读数：向作者要那份脱敏种子库，');
  line('         或者按 docs/specs/ 里登记的判据自己跑实验。');
  line('');
  line('    ★**没有 D 选项**：我们不把含真实玩家信息的库随仓库分发，');
  line('      也不把它上传到任何公开位置。这件事不做妥协。');
  line('    ★另外提醒：跑过 node --test 之后，p1a.db 可能变成一个**空壳**');
  line('      （文件在、0 张表）。那比不在更迷惑人 —— 上面的③会把它点出来。');
  提醒++;
});

// ── ⑤ 端口（不启动，只告知）──────────────────────────────────────────────
check('⑤ 端口', () => {
  const port = Number(process.env.PORT || 8787);
  const r = spawnSync(process.execPath, [
    '-e',
    `const n=require('node:net');const s=n.createServer();
     s.once('error',e=>{console.log(e.code==='EADDRINUSE'?'BUSY':'ERR')});
     s.once('listening',()=>{console.log('FREE');s.close()});
     s.listen(${port},'127.0.0.1');`,
  ], { encoding: 'utf8' });
  const v = (r.stdout || '').trim();
  if (v === 'FREE') ok(port + ' 空闲');
  else if (v === 'BUSY') { warn(port + ' 已被占用 —— 服务会自己往上找，一般不用管'); 提醒++; }
  else { ok(port + '（探测未完成，不阻塞）'); }
});

// ── 收尾 ────────────────────────────────────────────────────────────────
line();
line('─'.repeat(56));
line('结论');
if (阻塞) {
  line('  ✖ ' + 阻塞 + ' 项阻塞。先解决它，别的都白说。');
} else if (提醒) {
  line('  ! ' + 提醒 + ' 项提醒。**都不阻塞启动**，但会让一部分功能看不到数据。');
} else {
  line('  ✔ 一切就绪。cd p1b && node gates/gates.cjs 可以跑闸门了。');
}
line();
line('★为什么这条命令存在：');
line('  发布后我以陌生人身份 clone 了一遍。能装、能构建、类型过，');
line('  然后 backend 闸门 17 秒就红在 `no such table: predictions`。');
line('  根因（缺库）离报错的地方隔了三层。这条命令把「缺什么／为什么／怎么办」');
line('  压到三十秒，而不是让人在红字里猜。');
line('  本机永远复现不了这个坑 —— 本机的库是齐的。');
line();
