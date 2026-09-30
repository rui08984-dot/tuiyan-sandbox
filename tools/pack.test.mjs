/**
 * tools/pack.test.mjs —— 打包模块的测试（模块 packaging）
 *
 * ★本模块的验收是**真跑**，不是「断言写对了」：
 *   A1  解压（复制）到临时目录 → 真跑 start.bat → /api/health 200
 *   A1b ★解压到**含空格与中文**的路径（树与数据目录都含）→ 同样通
 *   A2  web_built === true 且 db_path 落在数据目录、**不在 app 目录**
 *   A9/A10 产物里 `体检 看板` / `体检 跑批` 退出码 0
 *   发行闸 14 项：★打包方能负责的那几项必须全绿，且**红项不许超出已知清单**
 *   反向锁：往产物里塞 config/providers.json ⇒ C1 必红
 *
 * ── 反「空跑绿灯」的三条纪律（每条都在下面有对应用例）─────────────────────
 *   ① 凡带循环的断言，都有一条**同级**的「循环确实跑了 N 次 / 真的返回了非空」前置断言。
 *   ② 凡「被测对象被清空 ⇒ 必须变红」的判据，都配一条**真的清空它**的反向用例。
 *   ③ 判别法：把判据常量或清单改小，测试必须变红（见 ⑨）。
 *
 * 跑法：node tools/pack.test.mjs   或   node --test tools/pack.test.mjs
 * ★测试自己会占端口：每个真跑用例都在 after 里 stop + 确认端口释放，不留后台进程。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  仓库根, 产物名, 打包, 预检, 走树, 扫一个, 依赖闭包, 剔除决策, 扫候选树, 相对require目标,
  剪枝原生包, 解析参数, C6_MAX_BYTES, 运行时依赖种子, 依赖搜索根, 必发, 目录清单, 文件清单,
} from './pack.mjs';

const require_ = createRequire(import.meta.url);
const boot = require_(path.join(仓库根, 'tools', 'launcher', 'boot.cjs'));
const seedcheck = path.join(仓库根, 'tools', 'launcher', 'seedcheck.cjs');
const 审计 = path.join(仓库根, 'p1b', 'scripts', 'audit-release.cjs');
const 随便端口 = () => 20000 + Math.floor(Math.random() * 20000);

const 临时根 = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-pack-'));
const 建的树 = path.join(临时根, 'tree-src');
let 已打包 = null;

const 清理堆 = [];
test.after(() => {
  for (const f of 清理堆) { try { fs.rmSync(f, { recursive: true, force: true }); } catch { /* 已不在 */ } }
  try { fs.rmSync(临时根, { recursive: true, force: true }); } catch { /* 已不在 */ }
});

/** 记一个待清理的路径（临时目录、复制的树） */
function 待清理(p) { 清理堆.push(p); return p; }

/** 端口此刻是否空着（真 bind 一次，不靠猜） */
function 端口空着(p) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(p, '127.0.0.1');
  });
}
async function 找一个空端口() {
  for (let i = 0; i < 50; i++) { const p = 随便端口(); if (await 端口空着(p)) return p; }
  throw new Error('连试 50 个端口都占着，测试环境不对');
}

/** 拿健康：轮询三个候选端口（服务被占时会往后挪），返回 {端口, 体} 或 null */
async function 等健康(端口们, 毫秒) {
  const 止 = Date.now() + 毫秒;
  let 试过 = 0;
  while (Date.now() < 止) {
    for (const p of 端口们) {
      试过++;
      try {
        const r = await fetch('http://127.0.0.1:' + p + '/api/health', { signal: AbortSignal.timeout(1500) });
        if (r.status === 200) return { 端口: p, 体: await r.json(), 试过 };
      } catch { /* 还没起来 */ }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { 端口: null, 体: null, 试过 };
}

/** 端口此刻是否**连不上**（= 服务真的停了） */
async function 端口通吗(p, 毫秒 = 800) {
  return new Promise((res) => {
    const s = net.connect({ port: p, host: '127.0.0.1' });
    const 收 = (v) => { try { s.destroy(); } catch { /* 已关 */ } res(v); };
    s.setTimeout(毫秒);
    s.once('connect', () => 收(true));
    s.once('timeout', () => 收(false));
    s.once('error', () => 收(false));
  });
}

/** 环境：只留测试要给的，清掉可能从外面漏进来的 P1B_* 与 PORT */
function 净环境(数据目录, 端口) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith('P1B_')) delete e[k];
  delete e.PORT;
  e.P1B_DATA_DIR = 数据目录;
  e.P1B_NO_BROWSER = '1';
  if (端口) e.PORT = String(端口);
  return e;
}

/** 等启动器输出里出现某个记号（横幅是健康检查之后才打的，有先后竞态，不许断言「立刻就有」） */
async function 等输出(出, 记号, 毫秒) {
  const 止 = Date.now() + (毫秒 || 8000);
  while (Date.now() < 止) {
    if (记号.test(出())) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** 起一次 start.bat（真跑，双击的等价物），返回 {子进程, 出} */
function 起启动器(树, 数据目录, 端口, 额外参数) {
  const 子 = spawn('cmd.exe', ['/c', path.join(树, 'start.bat'), '--no-browser', '--port', String(端口), ...(额外参数 || [])], {
    cwd: 树, env: 净环境(数据目录, 端口), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const 收集 = [];
  子.stdout.on('data', (d) => 收集.push(String(d)));
  子.stderr.on('data', (d) => 收集.push(String(d)));
  return { 子, 出: () => 收集.join('') };
}

/** 停服务：先跑 stop.bat（这也是被测行为之一），再兜底按 pid 杀，最后确认端口释放 */
async function 停干净(树, 数据目录, 端口们) {
  const r = spawnSync('cmd.exe', ['/c', path.join(树, 'stop.bat')], { cwd: 树, env: 净环境(数据目录), encoding: 'utf8', timeout: 30000 });
  for (const p of 端口们) {
    const 止 = Date.now() + 5000;
    while (Date.now() < 止 && (await 端口通吗(p))) await new Promise((x) => setTimeout(x, 200));
  }
  const pid文件 = path.join(数据目录, 'logs', 'server.pid');
  if (fs.existsSync(pid文件)) {                       // 兜底：stop 没成功就直接杀，绝不留后台进程
    const pid = Number(String(fs.readFileSync(pid文件, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid); } catch { /* 已不在 */ } }
    try { fs.unlinkSync(pid文件); } catch { /* 已不在 */ }
  }
  return r;
}

// ════════════════════════════════════════════════════════════════════
// ① 判据不许空跑
// ════════════════════════════════════════════════════════════════════

test('①a 扫一个：C2/C3 判据咬得住（清空判据 ⇒ 计数归零）', () => {
  const f = path.join(临时根, 'scan-probe.txt');
  fs.writeFileSync(f, '第一行没有盘符\n第二行 数据目录 D:\\用户\\数据\n第三行 http://192.168.31.7/api\n第四行 127.0.0.1 放行\n', 'utf8');
  const r = 扫一个(f);
  assert.equal(r.读了, true, '★前置：这���文件真的被读了（不是二进制、没抛错）');
  assert.equal(r.c2, 1, '★扫出 1 处绝对路径（盘符 + 反斜杠）');
  assert.equal(r.c3, 1, '★扫出 1 处非本机 IPv4（127.0.0.1 已被放行）');
  assert.deepEqual(r.位置.map((x) => x.行), [2, 3], '★行号定位到第 2、3 行（不是「 somewhere」）');
  // 判别法：把绝对路径那一行去掉，C2 必须归零（证明计数不是恒定的幻觉）
  fs.writeFileSync(f, '第一行没有盘符\n第三行 http://192.168.31.7/api\n', 'utf8');
  assert.equal(扫一个(f).c2, 0, '★判别法：拿掉那行后 C2 归零 ⇒ 刚才那 1 处是真的');
  assert.equal(扫一个(f).c3, 1, '★同一份文件里 C3 仍是 1（两个判据各咬各的）');
});

test('①b 扫一个：二进制与读不到的文件不假装「干净」', () => {
  const f = path.join(临时根, 'scan-bin.node');
  fs.writeFileSync(f, Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]));
  const r = 扫一个(f);
  assert.equal(r.读了, false, '★含 NUL 的二进制不被当文本扫');
  assert.equal(r.c2 + r.c3, 0, '★它不贡献命中，但 also 不谎称读过（读了=false）');
  assert.equal(扫一个(path.join(临时根, '不存在.txt')).读了, false, '★读不到的文件同样 读了=false');
});

test('①c 依赖闭包：真解出包，且未命中会报出来（不是恒返回空）', () => {
  const 闭 = 依赖闭包(运行时依赖种子, { 搜索根: 依赖搜索根() });
  assert.equal(闭.未命中.length, 0, '★全部种子都解出来了：' + 闭.未命中.join('、'));
  assert.ok(闭.包.length >= 5, '★闭包至少 5 个包（4 个纯 JS + better-sqlite3），实得 ' + 闭.包.length);
  const 名 = new Set(闭.包.map((p) => p.name));
  for (const 必需 of ['fastify', '@fastify/cors', '@fastify/static', 'lunar-javascript', 'better-sqlite3']) {
    assert.ok(名.has(必需), '★闭包含 ' + 必需);
  }
  assert.ok(闭.包.every((p) => p.字节 > 0), '★每个包的字节数都 > 0（不是 0 的空壳记录）');
  // 判别法：换成一个不存在的包，必须报未命中（证明「未命中」这条通道真的会响）
  const 假 = 依赖闭包(['这个包一定不存在-xyz'], { 搜索根: [仓库根] });
  assert.equal(假.包.length, 0, '★不存在的包 ⇒ 闭包为空');
  assert.equal(假.未命中.length, 1, '★判别法：并且明确报出未命中，不是静默返回空');
});

test('①d 剔除决策：被 require 的脏文件**剔不得**（清空「可达」判据 ⇒ 行为必须变）', () => {
  const 候 = [
    { rel: 'a/main.js', 脏: false, c2: 0, c3: 0, 位置: [], 需: ['a/helper.js'], 文本: "require('./helper')" },
    { rel: 'a/helper.js', 脏: true, c2: 1, c3: 0, 位置: [{ 行: 1 }], 需: [], 文本: '盘符 D:\\x' },
    { rel: 'a/孤儿.js', 脏: true, c2: 1, c3: 0, 位置: [{ 行: 1 }], 需: [], 文本: '盘符 D:\\y' },
  ];
  const 决 = 剔除决策(候);
  assert.equal(决.剔.length, 1, '★只有真正没人要的孤儿被剔（实得剔：' + 决.剔.join('、') + '）');
  assert.deepEqual(决.剔, ['a/孤儿.js'], '★剔的正是那个没人 require 的脏文件');
  assert.ok(决.阻.has('a/helper.js'), '★被 require 的脏文件落在「阻」里（照发 + 判红）');
  assert.match(决.阻.get('a/helper.js'), /require/, '★理由说清了是「有文件 require 它」');
  // 判别法：把 main 的 require 去掉，helper 就该变成可剔 —— 证明可达性判据真的在算
  const 决2 = 剔除决策([{ ...候[0], 需: [], 文本: '没有 require 了' }, 候[1], 候[2]]);
  assert.deepEqual(决2.剔.sort(), ['a/helper.js', 'a/孤儿.js'], '★判别法：require 断了 ⇒ helper 也变成可剔');
  assert.equal(决2.阻.size, 0, '★此时「阻」为空');
});

test('①e 相对require目标：解析相对路径并补扩展名候选；越出扫描根的一律丢掉', () => {
  const d = path.join(临时根, 'req');
  fs.mkdirSync(path.join(d, 'sub'), { recursive: true });
  const f = path.join(d, 'i.js');
  fs.writeFileSync(f, "const a = require('./x');\nconst b = require('./sub/y.cjs');\nconst c = require('fastify');\n", 'utf8');
  const t = 相对require目标(f, d);
  assert.ok(t.length >= 4, '★真的解析出了多个候选（' + t.length + ' 个）：' + t.join(' '));
  assert.ok(t.includes('x') && t.includes('x.js'), '★./x 解析成 x 与 x.js 两个候选：' + t.join(' '));
  assert.ok(t.includes('sub/y.cjs'), '★./sub/y.cjs 原样解析');
  assert.ok(!t.some((x) => x.includes('fastify')), '★裸包名不算相对 require（那是依赖闭包管的）');
  // 越出扫描根的（../ 到根外）必须被丢掉：它根本不在候选集里，算进「可达」只会给出假保护
  const g = path.join(d, 'sub', 'j.js');
  fs.writeFileSync(g, "const b = require('../../outside.js');\n", 'utf8');
  const t2 = 相对require目标(g, d);
  assert.equal(t2.length, 0, '★越出扫描根的相对 require 被丢弃（实测 ' + t2.length + ' 条）：' + t2.join(' '));
});

// ════════════════════════════════════════════════════════════════════
// ② 体积账与剔除规则
// ════════════════════════════════════════════════════════════════════

test('②a 走树：node_modules 与便携 node 的目录**不进计费**（清空豁免 ⇒ 判定必须变）', () => {
  const 树 = path.join(临时根, '量'); 待清理(树);
  fs.mkdirSync(path.join(树, 'runtime', 'node'), { recursive: true });
  fs.mkdirSync(path.join(树, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(树, 'a.js'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(树, 'runtime', 'node', 'node.exe'), Buffer.alloc(5 * 1024 * 1024));
  fs.writeFileSync(path.join(树, 'node_modules', 'x', 'i.js'), 'y'.repeat(3 * 1024 * 1024));
  const w = 走树(树);
  assert.equal(w.计费, 1000, '★计费只算发行文件：node.exe 与依赖都在豁免目录里');
  assert.ok(w.便携字节 >= 5 * 1024 * 1024, '★便携 node 的体积照报（不许藏）');
  assert.ok(w.依赖字节 >= 3 * 1024 * 1024, '★依赖体积照报');
  assert.equal(w.files.length, 1, '★清单里只有 a.js 一个文件');
  // 判别法：把 node.exe 挪出豁免目录，计费必须暴涨
  fs.mkdirSync(path.join(树, 'runtime', 'bin'), { recursive: true });
  fs.renameSync(path.join(树, 'runtime', 'node', 'node.exe'), path.join(树, 'runtime', 'bin', 'node.exe'));
  assert.ok(走树(树).计费 >= 5 * 1024 * 1024, '★判别法：离开名为 node 的目录 ⇒ 立刻计入费（这正是本包把 node.exe 放在 runtime\\node\\ 的原因）');
});

test('②b better-sqlite3 剪枝：只留本机 prebuild，且剪掉的量要报出来', () => {
  const 源 = path.join(仓库根, 'p1a-terminal', 'node_modules', 'better-sqlite3');
  assert.ok(fs.existsSync(源), '★源目录在（本机装过）');
  const 目标 = path.join(临时根, 'bs3'); 待清理(目标);
  const 剪 = 剪枝原生包(源, 目标, process.platform, process.arch);
  assert.ok(剪.拷贝.length > 0 && 剪.丢弃.length > 0, '★两边都非空：留 ' + 剪.拷贝.length + ' / 剪 ' + 剪.丢弃.length);
  assert.ok(剪.丢弃字节 > 1024 * 1024, '★剪掉的字节数被真实统计（>1MB），不是 0');
  const prebuild = 剪.拷贝.find((x) => x.includes('prebuilds'));
  assert.ok(prebuild && prebuild.endsWith(process.platform + '-' + process.arch + '.node'), '★只留本机那一个 prebuild：' + prebuild);
  assert.equal(剪.丢弃.filter((x) => x.includes('prebuilds')).length, 7, '★另外 7 个平台的 prebuild 被明确列为剪掉（照实报）');
  assert.ok(fs.existsSync(path.join(目标, 'package.json')), '★package.json 留着（require 入口靠它）');
  assert.ok(fs.existsSync(path.join(目标, 'lib', 'database.js')), '★lib/ 留着');
  // ★真 require：剪完还能不能加载，只有真跑一次才知道（这才是「剪枝正确」的判据）
  const r = spawnSync(process.execPath, ['-e', 'const D=require(process.argv[1]); const d=new D(":memory:"); d.exec("CREATE TABLE t(a)"); console.log("ok:"+d.prepare("SELECT count(*) c FROM t").get().c);', path.join(目标)], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, '★剪完的 better-sqlite3 真能 require 并开库：' + (r.stderr || '').split('\n')[0]);
  assert.match(r.stdout, /ok:0/, '★且真能执行 SQL');
});

// ════════════════════════════════════════════════════════════════════
// ③ 参数与清单
// ════════════════════════════════════════════════════════════════════

test('③a 解析参数：--check / --no-audit / 未知参数', () => {
  assert.equal(解析参数([]).打包, true, '★默认打包');
  assert.equal(解析参数(['--check']).查, true, '★--check 只体检');
  assert.equal(解析参数(['--no-audit']).审, false, '★--no-audit 不跑发行闸');
  assert.match(解析参数(['--瞎写']).错, /未知参数/, '★未知参数被拒（不是默默照跑）');
  assert.match(解析参数(['--out']).错, /缺目录/, '★--out 缺值被拒');
  assert.equal(产物名('0.1.0'), 'p1b-sandbox-v0.1.0-win-x64', '★产物目录名照 SPEC 的写法');
});

test('③b 清单：必发件都在树上；体积账里点名的目录都进了清单', () => {
  for (const d of ['p1a-terminal/src', 'p1b/src', 'p1b/cli', 'p1b/mcp', 'p1b/gates', 'p1b/skill', 'p1b/web/dist', 'p1b/scripts']) {
    assert.ok(目录清单.some((x) => x.自 === d), '★目录清单含 ' + d);
  }
  assert.ok(文件清单.some((x) => x.到 === 'seed/p1a-seed.db'), '★种子库在文件清单里');
  assert.ok(文件清单.some((x) => x.到 === 'docs/kind-目录表.md'), '★kind 表在文件清单里（C12 要它）');
  assert.ok(必发.includes('runtime/node/node.exe'), '★便携 node 在必发清单里');
  assert.equal(运行时依赖种子.length, 5, '★运行时依赖种子 5 个（4 纯 JS + 原生件）');
});

// ════════════════════════════════════════════════════════════════════
// ④ 打包一次（后面所有真跑用例共用这棵树）
// ════════════════════════════════════════════════════════════════════

test('④ 打包：产出树 + 自检零红 + 必发件齐全', { timeout: 600000 }, () => {
  已打包 = 打包({ 树根: 建的树, 静默: true });
  assert.ok(fs.existsSync(建的树), '★树建出来了：' + 建的树);
  assert.equal(已打包.检.红.length, 0, '★自持判据零红：' + 已打包.检.红.join(' / '));
  assert.ok(已打包.走.files.length > 300, '★发行文件数 > 300（实得 ' + 已打包.走.files.length + '）');
  assert.ok(已打包.拷入 > 300, '★拷入计数 > 300（实得 ' + 已打包.拷入 + '）——证明不是「循环没跑」');
  assert.ok(已打包.走.计费 > 0 && 已打包.走.计费 < C6_MAX_BYTES, '★计费在 0 与 12MB 之间：' + 已打包.走.计费);
  assert.ok(已打包.走.依赖字节 > 0, '★依赖字节 > 0（依赖真拷进去了）');
  assert.ok(已打包.便携字节 > 1024 * 1024, '★便携 node 真的拷进去了');
  for (const f of 必发) {
    assert.ok(fs.existsSync(path.join(建的树, ...f.split('/'))), '★必发件在树上：' + f);
  }
  // 产物里绝不含的东西（逐条查，不是「大概没有」）
  for (const f of 已打包.走.files) {
    assert.ok(!f.rel.split('/').includes('config'), '★没有 config 路径段：' + f.rel);
    assert.ok(!/\.db-(wal|shm)$/i.test(f.段), '★没有 wal/shm：' + f.rel);
    assert.ok(!f.rel.includes('.git'), '★没有 .git：' + f.rel);
    assert.ok(f.段 !== '.env', '★没有 .env：' + f.rel);
    assert.ok(!f.rel.startsWith('p1a-terminal/data/'), '★没有打进 p1a-terminal/data/：' + f.rel);
    assert.ok(!/\.db$/i.test(f.段) || f.rel === 'seed/p1a-seed.db', '★除种子库外没有 .db：' + f.rel);
  }
  // 种子库逐字节一致（拷坏了要当场知道）
  const a = fs.readFileSync(path.join(仓库根, 'seed', 'p1a-seed.db'));
  const b = fs.readFileSync(path.join(建的树, 'seed', 'p1a-seed.db'));
  assert.equal(a.length, b.length, '★种子库字节数一致');
  assert.ok(a.equals(b), '★种子库逐字节一致');
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 文本纪律：bat 在产物里是 CRLF、其余是 LF、无 BOM、bat 里不许有盘符
// ════════════════════════════════════════════════════════════════════

test('⑤a 三个 bat：产物里 CRLF、无 BOM、不写死盘符、路径全加引号', () => {
  for (const 名 of ['start.bat', 'start-debug.bat', 'stop.bat']) {
    const p = path.join(建的树, 名);
    const buf = fs.readFileSync(p);
    const t = buf.toString('utf8');
    assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), '★' + 名 + ' 无 BOM（BOM 会让 cmd 把第一行当命令）');
    // ★产物里必须是 CRLF：cmd.exe 逐字节读 bat 并按字节偏移回 seek，LF 会把整份批处理切成碎片
    assert.match(t, /^@echo off\r\nchcp 65001 >nul\r\n/, '★' + 名 + ' 前两行是 @echo off + chcp 65001，且行尾是 CRLF');
    assert.ok(!/[^\r]\n/.test(t), '★' + 名 + ' 每个换行都是 CRLF（没有裸 LF）——实测 LF 会让 bat 报「不是内部或外部命令」的碎片');
    assert.ok(!/[A-Za-z]:\\/.test(t), '★' + 名 + ' 里没有任何盘符写法（发行闸 C2/C13 的判据，实测这条真咬过我一次）');
    assert.ok(!/^\s*cd\s+\/d\s+/im.test(t), '★' + 名 + ' 不用 cd /d（换机器/换用户会起不来）');
    assert.ok(!/[ \t]+\r$/m.test(t), '★' + 名 + ' 没有行尾空白');
  }
  // 全路径加引号：★只看**把路径当参数用**的行（echo/rem 只是把它打印出来，不需要引号，
  //   否则这条判据会误报——实测它一开始就把两条 echo 报成违规）
  const t = fs.readFileSync(path.join(建的树, 'start.bat'), 'utf8');
  const 裸 = t.split(/\n/).map((l) => l.trim())
    .filter((l) => l && !/^(echo|rem|::)/i.test(l))
    .filter((l) => /%APPDIR%|%P1B_DATA_DIR%/.test(l) && /(mkdir|copy|move|del|cd|if\s+(not\s+)?exist|type|start)\b/i.test(l))
    .filter((l) => !/"/.test(l));
  assert.equal(裸.length, 0, '★所有把路径当参数用的地方都带引号（★这就是 A1b 的生死线）：' + 裸.join(' ⏎ '));
  assert.ok(t.split(/\n/).filter((l) => /^(copy|move|mkdir|del)\b/i.test(l.trim())).length >= 5,
    '★（对照）上面这条判据确实覆盖到了实际的路径操作行，不是扫不到行');
});

test('⑤b 生成件：README / package.json / 配置模板 / provenance 都是 UTF-8+LF，且不含盘符', () => {
  for (const f of ['README.md', 'package.json', 'p1a-terminal/providers.template.json', 'seed/seed_provenance.json']) {
    const t = fs.readFileSync(path.join(建的树, ...f.split('/')), 'utf8');
    assert.ok(!t.includes('\r\n'), '★' + f + ' 是 LF');
    assert.ok(!/[A-Za-z]:\\/.test(t), '★' + f + ' 里没有盘符');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(建的树, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts && pkg.scripts.start, '★package.json 有 scripts.start（发行闸 C13 要它）');
  assert.match(pkg.scripts.start, /launcher\/boot\.cjs/, '★scripts.start 走的是启动器半边（有 pid/健康/横幅）');
  const 模板 = JSON.parse(fs.readFileSync(path.join(建的树, 'p1a-terminal', 'providers.template.json'), 'utf8'));
  const 空 = Object.values(模板.providers || {}).every((p) => !String((p || {}).api_key || '').trim());
  assert.ok(空, '★配置模板里一条非空 key 都没有（★真配置里那 3 处必须清空）');
  const prov = JSON.parse(fs.readFileSync(path.join(建的树, 'seed', 'seed_provenance.json'), 'utf8'));
  assert.ok(prov.剔除 && prov.剔除.逐表 && typeof prov.剔除.逐表.hypotheses.留 === 'number', '★provenance 的剔除声明还在（C10 要读它）');
  assert.ok(prov.发行包注意, '★provenance 记了「本文件是洗过路径的副本」');
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 启动器行为（不开服务也能测的那几个纯函数/真进程）
// ════════════════════════════════════════════════════════════════════

test('⑥a 需要Mock：有非空 key 才 LIVE（两条用例都跑，缺一不可）', () => {
  const f = path.join(临时根, 'prov-empty.json');
  fs.writeFileSync(f, JSON.stringify({ active: 'a', providers: { a: { label: 'A', api_key: '' }, b: { label: 'B', api_key: '   ' } } }), 'utf8');
  assert.equal(boot.需要Mock(f), true, '★全空 ⇒ MOCK（首启不许联网）');
  const g = path.join(临时根, 'prov-key.json');
  fs.writeFileSync(g, JSON.stringify({ active: 'a', providers: { a: { api_key: 'sk-real-key' } } }), 'utf8');
  assert.equal(boot.需要Mock(g), false, '★任一条非空 key ⇒ LIVE（哪怕它不是激活供应商）');
  assert.equal(boot.需要Mock(path.join(临时根, '没有这个文件.json')), true, '★读不到配置 ⇒ 保守 MOCK');
  // 判别法：把 key 清成空串，结论必须翻回 MOCK
  fs.writeFileSync(g, JSON.stringify({ active: 'a', providers: { a: { api_key: '' } } }), 'utf8');
  assert.equal(boot.需要Mock(g), true, '★判别法：清掉那条 key ⇒ 翻回 MOCK（证明上一步不是因为别的理由）');
});

test('⑥b 选端口：被占就往后挪（真 bind，不是 mock）', async () => {
  const 占 = await 找一个空端口();
  const s = net.createServer();
  await new Promise((r) => s.listen(占, '127.0.0.1', r));
  try {
    assert.equal(await boot.端口空着(占), false, '★真占着时 端口空着=false');
    const 选 = await boot.选端口(占, 3);
    assert.notEqual(选, 0, '★探测成功返回了一个端口（不是 0）');
    assert.ok(选 > 占, '★它跳过了被占的那个：' + 占 + ' → ' + 选);
    assert.equal(await boot.端口空着(选), true, '★它选的那个此刻真的空着');
  } finally { await new Promise((r) => s.close(r)); }
  assert.equal(await boot.端口空着(占), true, '★释放后同一个端口又空（证明上面那两条不是幻觉）');
  // ★连续三口全占 ⇒ 返 0（调用方据此退出码 3）。必须占的是**连续**三个，只占随机三个测不到这条。
  const 起 = await 找一个空端口();
  const 占们 = [];
  for (let i = 0; i < 3; i++) {
    const s2 = net.createServer();
    try { await new Promise((r, j) => { s2.once('error', j); s2.listen(起 + i, '127.0.0.1', r); }); 占们.push(s2); } catch { /* 本来就被别人占了也算「占着」 */ }
  }
  try {
    assert.equal(await boot.选端口(起, 3), 0, '★连续三个全占 ⇒ 返 0（start.bat 会据此退出码 3）');
  } finally { for (const s2 of 占们) await new Promise((r) => s2.close(r)); }
  assert.equal(await boot.选端口(起, 3) !== 0, true, '★释放后同一个起点又能选到端口了（判别法：上面那个 0 是占端口造成的）');
});

test('⑥c 起端口：--port 优先于 env PORT，env 优先于 8787', () => {
  assert.equal(boot.起端口(['--port', '9101'], { PORT: '9202' }), 9101, '★--port 赢');
  assert.equal(boot.起端口([], { PORT: '9202' }), 9202, '★没 --port 用 env');
  assert.equal(boot.起端口([], {}), 8787, '★都没有用 8787');
  assert.equal(boot.起端口(['--port', '不是数字'], {}), 8787, '★垃圾值退回 8787（不许拿 NaN 去 listen）');
});

test('⑥d seedcheck：真跑。好库过、坏库不过（判别法：清空判据的对照物）', () => {
  const 好的 = path.join(临时根, 'seed-好.db');
  fs.copyFileSync(path.join(仓库根, 'seed', 'p1a-seed.db'), 好的);
  const r1 = spawnSync(process.execPath, [seedcheck, 好的], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r1.status, 0, '★好库过：' + (r1.stdout || '') + (r1.stderr || ''));
  assert.match(r1.stdout, /integrity_check = ok/, '★它真跑了 integrity_check（不是无条件 exit 0）');
  const 坏的 = path.join(临时根, 'seed-坏.db');
  const 全 = fs.readFileSync(好的);
  fs.writeFileSync(坏的, 全.subarray(0, Math.floor(全.length / 3)));   // 截断
  const r2 = spawnSync(process.execPath, [seedcheck, 坏的], { encoding: 'utf8', timeout: 120000 });
  assert.notEqual(r2.status, 0, '★截断的库必须不过（这就是它存在的理由）');
  const r3 = spawnSync(process.execPath, [seedcheck], { encoding: 'utf8' });
  assert.equal(r3.status, 2, '★不给路径 ⇒ 用法错 2');
  assert.equal(spawnSync(process.execPath, [seedcheck, path.join(临时根, '不存在.db')], { encoding: 'utf8' }).status, 3, '★文件不存在 ⇒ 3');
});

// ════════════════════════════════════════════════════════════════════
// ⑦★ A1 / A1b：真跑启动器
// ════════════════════════════════════════════════════════════════════

/** A1/A1b 的共同主体：把树复制到 `树`，在 `数据目录` 上真跑一遍 start.bat，验完停干净。 */
async function 真跑一次(t, 树, 数据目录, 标签) {
  const 端口 = await 找一个空端口();
  const 端口们 = [端口, 端口 + 1, 端口 + 2];
  const { 子, 出 } = 起启动器(树, 数据目录, 端口);
  let 健 = null;
  try {
    健 = await 等健康(端口们, 90000);
    const 日志 = 出();
    assert.equal(健.端口 !== null, true,
      '★[' + 标签 + '] /api/health 90 秒内没回 200。启动器输出：\n' + 日志.slice(-3000)
      + '\n--- startup.log ---\n' + (fs.existsSync(path.join(数据目录, 'logs', 'startup.log')) ? fs.readFileSync(path.join(数据目录, 'logs', 'startup.log'), 'utf8').slice(-3000) : '(无)'));
    assert.ok(健.试过 >= 1, '★健康轮询真的发过请求（试了 ' + 健.试过 + ' 次）——不是循环空转');
    assert.equal(健.体.ok, true, '★health.ok=true');
    // ── A2 ──
    assert.equal(健.体.web_built, true, '★A2：web_built === true（前端产物在包里且被挂上）');
    assert.equal(健.体.service, 'p1b-web-workbench', '★确实是本服务');
    assert.ok(健.体.db_path && fs.existsSync(健.体.db_path), '★A2：db_path 指向一个真存在的库：' + 健.体.db_path);
    assert.ok(path.resolve(健.体.db_path).startsWith(path.resolve(数据目录)), '★A2：db_path 落在数据目录里，不是 app 目录');
    assert.ok(!path.resolve(健.体.db_path).startsWith(path.resolve(树)), '★A2：db_path 绝不在发行树里（树是只读的）');
    assert.equal(健.体.llm_mock, true, '★首启无 key ⇒ 强制 MOCK（陌生人没有 key 也能开）');
    // 数据目录该有的都在
    assert.ok(fs.existsSync(path.join(数据目录, 'config', 'providers.json')), '★配置模板已落到数据目录');
    assert.ok(fs.existsSync(path.join(数据目录, 'backups')), '★backups 目录建了');
    assert.ok(fs.existsSync(path.join(数据目录, 'logs', 'startup.log')), '★startup.log 写了（超时时要靠它救命）');
    assert.ok(fs.existsSync(path.join(数据目录, 'logs', 'seed-copied.txt')), '★种子库复制留了幂等标记');
    // 树里没有多出 db / wal（★种子库本身是该在的，它要的就是这个）
    const 多余 = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === 'node') continue; walk(p); }
        else if (/\.db($|-)/i.test(e.name)) {
          const rel = path.relative(树, p).split(path.sep).join('/');
          if (rel !== 'seed/p1a-seed.db') 多余.push(rel);
        }
      }
    })(树);
    assert.equal(多余.length, 0, '★发行树里除种子库外没多出任何 .db（账本只在数据目录）：' + 多余.join('、'));
    assert.ok(fs.existsSync(path.join(树, 'seed', 'p1a-seed.db')), '★（对照）种子库确实在包里 —— 上面那条不是「树里一个 db 都没有」的空断言');
    const 日志文本 = 出();
    assert.equal(await 等输出(出, /推演沙盘已就绪/, 10000), true,
      '★⑧ 首启横幅真的打了（健康检查之后才打，最多等 10 秒）。实际输出尾部：\n' + 出().slice(-1200));
    assert.match(出(), /MOCK/, '★横幅明说当前是 MOCK（不许让人以为在联网）');
    assert.match(出(), /账本行数/, '★横幅报了账本行数');
    assert.match(出(), /停止方法/, '★横幅说了怎么停');
    void 日志文本;
  } finally {
    const 停 = await 停干净(树, 数据目录, 端口们);
    const 码 = await new Promise((r) => {
    // ★等待预算放够：装卸/杀软会拖延（实测 20s 真的等满过 26s 一次）
      const t2 = setTimeout(() => { try { 子.kill(); } catch { /* 已不在 */ } r(null); }, 60000);
      子.once('exit', (c) => { clearTimeout(t2); r(c); });
    });
    // ★被 stop.bat 停掉的进程在 Windows 上退出码也是 1（TerminateProcess 不走信号处理）。
    //   start.bat 必须靠 stop-request.flag 把它归因成「按要求停止」并回 0 ——
    //   否则每次正常停止都吓用户一跳（这条实测踩过：曾报「启动器退出码 1」）。
    assert.equal(码, 0, '★[' + 标签 + '] stop 之后 start.bat 自己退出码 0（实得 ' + 码 + '）：\n' + 出().slice(-1200));
    assert.match(出(), /Service stopped on request via stop\.bat/, '★它把这次结束归因成「按 stop.bat 的要求停止」而不是失败：\n' + 出().slice(-600));
    assert.equal(fs.existsSync(path.join(数据目录, 'logs', 'stop-request.flag')), false, '★停止标记被读掉并删除了（不留给下一次启动误判）');
    t.diagnostic('stop.bat 退出码=' + 停.status + ' 输出=' + String(停.stdout || '').trim().slice(0, 300));
  }
  // ★端口必须真的释放（不留后台进程）
  for (const p of 端口们) {
    assert.equal(await 端口通吗(p), false, '★[' + 标签 + '] 端口 ' + p + ' 已释放（没有残留后台进程）');
  }
  assert.equal(fs.existsSync(path.join(数据目录, 'logs', 'server.pid')), false, '★pid 文件已清掉');
  return 健;
}

test('⑦a A1：解压（复制）到临时目录 → 真跑 start.bat → /api/health 200', { timeout: 300000 }, async (t) => {
  assert.ok(已打包, '★前置：④ 已打包（这不是空跑）');
  const 树 = 待清理(path.join(临时根, 'A1-普通路径'));
  fs.cpSync(建的树, 树, { recursive: true });
  const 数据目录 = 待清理(path.join(临时根, 'A1-data'));
  fs.mkdirSync(数据目录, { recursive: true });
  const 健 = await 真跑一次(t, 树, 数据目录, 'A1');
  assert.equal(健.端口 !== null, true);
});

test('⑦b A1b：★解压到「含空格与中文」的路径（树与数据目录都含）→ 同样通', { timeout: 300000 }, async (t) => {
  assert.ok(已打包, '★前置：④ 已打包');
  // ★目录名刻意同时含空格与中文；数据目录也含（两级都含才算过这一关）
  const 树 = 待清理(path.join(临时根, '测试 空格 路径 A1b', '解压 目录'));
  const 数据目录 = 待清理(path.join(临时根, '测试 空格 路径 A1b', '数据 目录'));
  fs.mkdirSync(数据目录, { recursive: true });
  fs.cpSync(建的树, 树, { recursive: true });
  assert.ok(/ /.test(树) && /[一-鿿]/.test(树), '★前置：树路径确实含空格与中文 —— ' + 树);
  assert.ok(/ /.test(数据目录) && /[一-鿿]/.test(数据目录), '★前置：数据目录确实含空格与中文 —— ' + 数据目录);
  const 健 = await 真跑一次(t, 树, 数据目录, 'A1b');
  assert.equal(健.端口 !== null, true);
});

test('⑦c 首启幂等：第二次 start.bat 不重复拷种子库，且照样起得来', { timeout: 300000 }, async (t) => {
  const 树 = 待清理(path.join(临时根, 'A1-普通路径'));
  const 数据目录 = 待清理(path.join(临时根, 'A1-data'));
  const 第一次 = fs.statSync(path.join(数据目录, 'p1a.db'));
  const 端口 = await 找一个空端口();
  const 端口们 = [端口, 端口 + 1, 端口 + 2];
  const { 子, 出 } = 起启动器(树, 数据目录, 端口);
  try {
    const 健 = await 等健康(端口们, 90000);
    assert.equal(健.端口 !== null, true, '★第二次也起来了：' + 出().slice(-2000));
    assert.match(出(), /ledger\s+: already there, seed copy skipped/, '★幂等：第二次没重拷种子库');
    const 第二次 = fs.statSync(path.join(数据目录, 'p1a.db'));
    assert.equal(第一次.size, 第二次.size, '★库没被换掉（大小不变）');
    assert.equal(fs.existsSync(path.join(数据目录, 'p1a.db.tmp')), false, '★没有残留 .tmp');
  } finally {
    await 停干净(树, 数据目录, 端口们);
    await new Promise((r) => { const t2 = setTimeout(r, 15000); 子.once('exit', () => { clearTimeout(t2); r(); }); });
  }
  for (const p of 端口们) assert.equal(await 端口通吗(p), false, '★端口 ' + p + ' 已释放');
});

test('⑦d start-debug.bat：真跑一遍（同一套时序 ＋ 追加 --debug ＋ 停后不关窗口）', { timeout: 300000 }, async () => {
  const 树 = 待清理(path.join(临时根, 'A1-普通路径'));
  const 数据目录 = 待清理(path.join(临时根, 'A1-data'));
  const 端口 = await 找一个空端口();
  const 端口们 = [端口, 端口 + 1, 端口 + 2];
  // stdin 给 'ignore'：最后的 pause 会立刻拿到 EOF 返回（等价于「用户按了任意键」）
  const 子 = spawn('cmd.exe', ['/c', path.join(树, 'start-debug.bat'), '--no-browser', '--port', String(端口)], {
    cwd: 树, env: 净环境(数据目录, 端口), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const 收集 = [];
  子.stdout.on('data', (d) => 收集.push(String(d)));
  子.stderr.on('data', (d) => 收集.push(String(d)));
  const 出 = () => 收集.join('');
  try {
    const 健 = await 等健康(端口们, 90000);
    assert.equal(健.端口 !== null, true, '★start-debug.bat 也把服务起起来了：\n' + 出().slice(-2000));
    assert.equal(await 等输出(出, /推演沙盘已就绪/, 10000), true, '★它跑的是同一套八步时序（横幅照打）');
    assert.equal(await 等输出(出, /· 端口 \d+ 空着，用它|健康检查第/, 5000), true, '★--debug 追加生效：端口探测/健康检查的细节被打印出来：\n' + 出().slice(-1200));
  } finally {
    await 停干净(树, 数据目录, 端口们);
    const 码 = await new Promise((r) => {
      const t2 = setTimeout(() => { try { 子.kill(); } catch { /* 已不在 */ } r(null); }, 60000);
      子.once('exit', (c) => { clearTimeout(t2); r(c); });
    });
    assert.equal(码, 0, '★服务停掉后 start-debug.bat 自己退出码 0（实得 ' + 码 + '）');
  }
  // ★用「等输出」而不是直接读：子进程 'exit' 事件先于管道里最后几段数据到达，直接读会漏
  assert.equal(await 等输出(出, /\[start-debug\] exit code 0/, 5000), true, '★它打印了自己的退出码（debug 版存在的理由）：\n' + 出().slice(-800));
  for (const p of 端口们) assert.equal(await 端口通吗(p), false, '★端口 ' + p + ' 已释放');
});

// ════════════════════════════════════════════════════════════════════
// ⑧ A9 / A10：产物里的 CLI
// ════════════════════════════════════════════════════════════════════

test('⑧ A9/A10：产物里 `体检 看板` / `体检 跑批` 退出码 0（真跑，用包里的便携 node）', { timeout: 300000 }, () => {
  assert.ok(已打包, '★前置：④ 已打包');
  const 树 = 建的树;
  const node = path.join(树, 'runtime', 'node', 'node.exe');
  assert.ok(fs.existsSync(node), '★便携 node 在包里');
  const 数据目录 = path.join(临时根, 'A9-data');
  fs.mkdirSync(数据目录, { recursive: true });
  fs.mkdirSync(path.join(数据目录, 'config'), { recursive: true });
  fs.copyFileSync(path.join(树, 'p1a-terminal', 'providers.template.json'), path.join(数据目录, 'config', 'providers.json'));
  fs.copyFileSync(path.join(树, 'seed', 'p1a-seed.db'), path.join(数据目录, 'p1a.db'));
  const env = 净环境(数据目录, 0);
  for (const [组, 命令] of [['体检', '看板'], ['体检', '跑批']]) {
    const r = spawnSync(node, [path.join(树, 'p1b', 'cli', 'index.cjs'), 组, 命令], { cwd: 树, env, encoding: 'utf8', timeout: 180000 });
    const 出 = ((r.stdout || '') + (r.stderr || '')).trim();
    assert.equal(r.status, 0, '★' + 组 + ' ' + 命令 + ' 退出码 0（实得 ' + r.status + '）：\n' + 出.slice(-2500));
    assert.ok(出.length > 50, '★' + 组 + ' ' + 命令 + ' 真的有输出（不是空跑绿灯）：' + 出.length + ' 字符');
    assert.ok(/推演沙盘|跑批|看板|进程|账本|DB|队列/.test(出), '★' + 组 + ' ' + 命令 + ' 的输出长得像它自己：\n' + 出.slice(0, 400));
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑨ 发行闸 + 反向锁
// ════════════════════════════════════════════════════════════════════

test('⑨a 发行闸：14 项都跑；打包方负责的那 11 项全绿；红项不许超出已知清单', { timeout: 300000 }, () => {
  assert.ok(已打包, '★前置：④ 已打包');
  const r = spawnSync(process.execPath, [审计, '--tree', 建的树, '--json'], { cwd: 仓库根, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status !== null, true, '★发行闸跑完了（没超时）');
  const j = JSON.parse(r.stdout);
  assert.equal(j.项.length, 14, '★14 项都跑了（不是只跑了子集）');
  // ★打包方能负责的：不含 C2/C3/C14（这三项红在**上游源码/种子库**上，见交付报告）
  const 我负责 = ['C1', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13'];
  for (const id of 我负责) {
    const x = j.项.find((y) => y.id === id);
    assert.ok(x, '★' + id + ' 在 14 项里');
    assert.equal(x.红, false, '★' + id + ' 绿：' + x.结论 + ' ← ' + String(x.证据).slice(0, 300));
  }
  const 红 = j.项.filter((x) => x.红).map((x) => x.id);
  const 已知 = ['C2', 'C3', 'C14'];
  assert.equal(红.every((x) => 已知.includes(x)), true,
    '★红项只允许是已知的上游三项（' + 已知.join('/') + '），实得：' + (红.join('、') || '（无）')
    + '\n  ★若某项是新的红，说明打包这一步引入了问题，请按 file:line 查。');
  assert.equal(j.码, 红.length ? 3 : 0, '★整体退出码：全过 0，有红 3（门禁码）');
  // C6 的体积账与打包器自己算的必须一致（两套口径不许各算各的）
  const c6 = j.项.find((x) => x.id === 'C6');
  assert.match(c6.证据, new RegExp('共 ' + 走树(建的树).files.length + ' 个发行文件'), '★C6 看到的文件数与打包器走树一致');
});

test('⑨b 反向锁：往产物里塞 config/providers.json ⇒ C1 必红（发行闸自己会咬）', { timeout: 300000 }, () => {
  const 树 = 待清理(path.join(临时根, 'C1-反向锁'));
  fs.cpSync(建的树, 树, { recursive: true });
  fs.mkdirSync(path.join(树, 'p1a-terminal', 'config'), { recursive: true });
  fs.writeFileSync(path.join(树, 'p1a-terminal', 'config', 'providers.json'), JSON.stringify({ active: 'x', providers: { x: { api_key: 'ZZZFAKEKEYZZZ' } } }), 'utf8');
  const r = spawnSync(process.execPath, [审计, '--tree', 树, '--json'], { cwd: 仓库根, encoding: 'utf8', timeout: 300000 });
  const j = JSON.parse(r.stdout);
  const c1 = j.项.find((x) => x.id === 'C1');
  assert.equal(c1.红, true, '★C1 红了（塞进去的 providers.json 被抓住）');
  assert.match(c1.证据, /p1a-terminal\/config\/providers\.json/, '★它指到了那个真文件：' + c1.证据);
  assert.equal(j.码, 3, '★整体门禁码 3');
  assert.equal(JSON.stringify(j.项).includes('ZZZFAKEKEYZZZ'), false, '★★闸的输出里不出现密钥本体（纪律①）');
});

test('⑨c 反向锁：把自持判据清空 ⇒ 预检必须变红（不是恒绿）', () => {
  const 树 = 待清理(path.join(临时根, '预检-反向锁'));
  fs.cpSync(建的树, 树, { recursive: true });
  assert.equal(预检(树).红.length, 0, '★前置：干净树预检零红');
  // ① config 目录（同时触发 C1 与 C7）
  fs.mkdirSync(path.join(树, 'p1a-terminal', 'config'), { recursive: true });
  fs.writeFileSync(path.join(树, 'p1a-terminal', 'config', 'providers.json'), '{}', 'utf8');
  let 检 = 预检(树);
  assert.ok(检.红.some((x) => /config/.test(x)), '①config 目录 ⇒ 预检红：' + 检.红.join(' | '));
  fs.rmSync(path.join(树, 'p1a-terminal', 'config'), { recursive: true, force: true });
  assert.equal(预检(树).红.length, 0, '①撤掉 ⇒ 回到零红（证明刚才那红是它造成的）');
  // ② wal 副件
  fs.writeFileSync(path.join(树, 'seed', 'p1a-seed.db-wal'), 'WAL');
  assert.ok(预检(树).红.some((x) => /wal/.test(x)), '②wal 副件 ⇒ 红');
  fs.rmSync(path.join(树, 'seed', 'p1a-seed.db-wal'));
  // ③ .env
  fs.writeFileSync(path.join(树, '.env'), 'X=1');
  assert.ok(预检(树).红.some((x) => /\.env/.test(x)), '③.env ⇒ 红');
  fs.rmSync(path.join(树, '.env'));
  // ④ 打进生产数据目录
  // ★★2026-09-29 修（独立复核的 M4 变异存活）：原来注入 p1a.db、断言用宽松正则
  //   `/p1a-terminal\/data/`，而**另一条判据**（`有非种子库的 .db`）的消息里也含这个串
  //   ⇒ 把「★打进了 p1a-terminal/data/」那条判据整个删掉，测试照样 30 pass 0 fail。
  //   ★那一条是 spec Boundaries 明写 Never 的生产库泄漏，是唯一「判据删光测试也不红」的。
  // ⇒ 两处一起改：① 注入一个**非 .db** 的文件（notes.txt），让它**只能**由那条判据触发；
  //   ② 断言收紧到**只匹配那条判据自己的消息前缀**。
  fs.mkdirSync(path.join(树, 'p1a-terminal', 'data'), { recursive: true });
  fs.writeFileSync(path.join(树, 'p1a-terminal', 'data', 'notes.txt'), 'x');
  assert.ok(预检(树).红.some((x) => /★打进了 p1a-terminal\/data/.test(x)),
    '④打进 p1a-terminal/data ⇒ 红（★必须由那条判据自己报，不许被别的判据的消息喂饱）');
  // ④b 生产库本体走另一条判据——两条判据各自独立被覆盖
  fs.writeFileSync(path.join(树, 'p1a-terminal', 'data', 'p1a.db'), 'x');
  assert.ok(预检(树).红.some((x) => /有非种子库的 \.db/.test(x)), '④b生产库 .db ⇒ 红');
  fs.rmSync(path.join(树, 'p1a-terminal', 'data'), { recursive: true, force: true });
  // ⑤ 必发件缺失
  fs.unlinkSync(path.join(树, 'start.bat'));
  assert.ok(预检(树).红.some((x) => /start\.bat/.test(x)), '⑤必发件缺失 ⇒ 红');
  fs.copyFileSync(path.join(仓库根, 'tools', 'launcher', 'start.bat'), path.join(树, 'start.bat'));
  // ⑥ 自产文件里写盘符（★这条真咬过我一次：start.bat 注释里写了示例盘符）
  fs.writeFileSync(path.join(树, 'README.md'), '数据目录：D:\\Users\\打包人\\数据\n', 'utf8');
  assert.ok(预检(树).红.some((x) => /README\.md/.test(x)), '⑥自产文件带盘符 ⇒ 红');
  fs.copyFileSync(path.join(建的树, 'README.md'), path.join(树, 'README.md'));
  // ⑦ C6 体积
  fs.writeFileSync(path.join(树, 'big.bin'), Buffer.alloc(C6_MAX_BYTES + 1024, 7));
  assert.ok(预检(树).红.some((x) => /C6/.test(x)), '⑦超 12MB ⇒ C6 红');
  fs.rmSync(path.join(树, 'big.bin'));
  assert.equal(预检(树).红.length, 0, '★全部撤掉后回到零红 —— 上面每一条红都是被测对象自己造成的');
});

test('⑨d 上游命中：必须**列出来**（不许静默），且剔掉的与阻断的分得清', () => {
  assert.ok(已打包, '★前置：④ 已打包');
  assert.ok(已打包.检.上游命中.length >= 1, '★上游 C2/C3 命中被如实列出（' + 已打包.检.上游命中.length + ' 条）');
  for (const t of 已打包.检.上游命中) {
    assert.match(t, /：C2 \d+ 处 \/ C3 \d+ 处，行 \d+/, '★每条都带 file:行 与条数：' + t);
  }
  assert.ok(已打包.阻断.length >= 1, '★有「剔不得」的阻断项被单独标出（' + 已打包.阻断.length + ' 条）');
  for (const b of 已打包.阻断) assert.ok(b.因, '★阻断项带理由：' + b.rel);
  // 剔掉的文件**真的不在树上**
  for (const t of 已打包.剔掉) {
    assert.equal(fs.existsSync(path.join(建的树, ...t.rel.split('/'))), false, '★声称剔掉的确实不在树里：' + t.rel);
  }
  assert.ok(已打包.剔掉.length >= 1, '★至少剔掉了一个（否则这条判据是空跑的）：' + 已打包.剔掉.map((x) => x.rel).join('、'));
});

test('⑨e --check：只体检不产出（产物目录的 mtime 不许变）', { timeout: 300000 }, () => {
  const 前 = fs.statSync(path.join(建的树, 'start.bat')).mtimeMs;
  const r = spawnSync(process.execPath, [path.join(仓库根, 'tools', 'pack.mjs'), '--check', '--out', 建的树], { cwd: 仓库根, encoding: 'utf8', timeout: 300000 });
  assert.match(r.stdout, /只体检，不产出/, '★它明说了只体检');
  const 后 = fs.statSync(path.join(建的树, 'start.bat')).mtimeMs;
  assert.equal(前, 后, '★产物一个字节都没被重写（mtime 不变）');
  assert.ok(r.status === 0 || r.status === 3, '★退出码非 1（不是用法错）：' + r.status);
  const 缺 = spawnSync(process.execPath, [path.join(仓库根, 'tools', 'pack.mjs'), '--check', '--out', path.join(临时根, '没有这个产物')], { cwd: 仓库根, encoding: 'utf8' });
  assert.equal(缺.status, 1, '★产物不存在 ⇒ 退出码 1 且可读（不许静默通过）');
  assert.match(缺.stderr, /产物不存在/, '★错误说得清：' + 缺.stderr.trim());
});

// ════════════════════════════════════════════════════════════════════
// ⑩ 启动器文件自身
// ════════════════════════════════════════════════════════════════════

test('⑩a 三个启动器源件在仓库里，且是 LF/无 BOM（打包源不是产物才过）', () => {
  for (const f of ['start.bat', 'start-debug.bat', 'stop.bat', 'boot.cjs', 'stop.cjs', 'seedcheck.cjs']) {
    const p = path.join(仓库根, 'tools', 'launcher', f);
    assert.ok(fs.existsSync(p), '★源件在：tools/launcher/' + f);
    const buf = fs.readFileSync(p);
    assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb), '★' + f + ' 无 BOM');
    assert.ok(!buf.toString('utf8').includes('\r'), '★' + f + ' 是 LF 行尾');
  }
  const c = spawnSync(process.execPath, ['--check', path.join(仓库根, 'tools', 'launcher', 'boot.cjs')], { encoding: 'utf8' });
  assert.equal(c.status, 0, '★boot.cjs 语法过 node --check');
});

test('⑩c 三个 bat：每个 goto 都有对应标签，且标签与目标全是 ASCII', () => {
  // ★这条是被咬出来的：cmd 在 chcp 65001 下按字节匹配 `goto` 标签，中文标签必然落空，
  //   cmd 会把标签的某个字节片段当命令去执行（症状：'过' 不是内部或外部命令）。
  //   2026-09-30 在 start.bat 上踩了两次（数据目录失败 / 种子库 / 配置模板 / 被要求停止）。
  let 标签计数 = 0, 跳转计数 = 0;   // ★不能用 goto 做变量名：它是 ES 严格模式下的 future reserved word
  for (const 名 of ['start.bat', 'start-debug.bat', 'stop.bat']) {
    const t = fs.readFileSync(path.join(仓库根, 'tools', 'launcher', 名), 'utf8');
    const 标签 = new Set(t.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(':')).map((l) => l.slice(1).trim()));
    const goto们 = [...t.matchAll(/goto\s+(\S+)/g)].map((m) => m[1]);
    标签计数 += 标签.size; 跳转计数 += goto们.length;
    for (const g of goto们) {
      assert.ok(标签.has(g), '★' + 名 + ' 的 goto ' + g + ' 有对应标签（标签：' + [...标签].join(',') + '）');
      assert.ok(/^[\x00-\x7F]+$/.test(g), '★' + 名 + ' 的 goto 目标是 ASCII：' + g);
    }
    for (const l of 标签) assert.ok(/^[\x00-\x7F]+$/.test(l), '★' + 名 + ' 的标签是 ASCII：' + l);
  }
  assert.ok(标签计数 > 0 && 跳转计数 > 0, '★两个计数都非空（标签 ' + 标签计数 + ' / goto ' + 跳转计数 + '）——不是「没找到所以通过」');
});

test('⑩e 三个 bat 必须是纯 ASCII（cmd 在 chcp 65001 下按字节偏移读 bat，多字节文本会让它执行错行）', () => {
  // ★这条是被 A1b 咬出来的：树解压到「测试 空格 路径」下时，start.bat 里含中文的 echo 行
  //   被 cmd 截断成半截命令去执行（'过' 不是内部或外部命令），而且只在中文路径下出现。
  //   ⇒ bat 里一个非 ASCII 字节都不许有；中文一律由 Node 半边（boot.cjs / stop.cjs）打印。
  for (const 名 of ['start.bat', 'start-debug.bat', 'stop.bat']) {
    const 源 = fs.readFileSync(path.join(仓库根, 'tools', 'launcher', 名), 'utf8');
    const 产 = fs.readFileSync(path.join(建的树, 名), 'utf8');
    for (const [哪, t] of [['源件', 源], ['产物', 产]]) {
      const 坏 = [...t].map((c, i) => [c, i]).filter(([c]) => c.charCodeAt(0) > 0x7f);
      assert.equal(坏.length, 0, '★' + 名 + '（' + 哪 + '）没有非 ASCII 字符，实得 ' + 坏.length + ' 个，首个在第 '
        + (坏[0] ? 坏[0][1] + ' 行：' + JSON.stringify(坏[0][0]) : '') + '（cmd 读多字节 bat 会执行错行）');
    }
  }
  // ★对照：Node 半边**必须**是中文的（否则这条 ASCII 规则就把中文体验一起干掉了）
  const bootSrc = fs.readFileSync(path.join(仓库根, 'tools', 'launcher', 'boot.cjs'), 'utf8');
  assert.ok(/[一-鿿]/.test(bootSrc), '★对照：boot.cjs 里确实有中文（中文体验由 Node 半边承担，不是被删了）');
  assert.match(bootSrc, /推演沙盘已就绪/, '★首启横幅的中文还在 boot.cjs 里');
});

test('⑩d 八步时序在代码里真的存在（不是只写在注释里）', () => {
  const bat = fs.readFileSync(path.join(仓库根, 'tools', 'launcher', 'start.bat'), 'utf8');
  const bootSrc = fs.readFileSync(path.join(仓库根, 'tools', 'launcher', 'boot.cjs'), 'utf8');
  // ①②③ 在 bat 里
  assert.match(bat, /P1B_DATA_DIR|LOCALAPPDATA/, '★① 数据目录解析在 bat 里');
  assert.match(bat, /p1a\.db\.tmp/, '★② 先拷 .tmp');
  assert.match(bat, /SEEDCHK/, '★② 调 seedcheck 校验');
  assert.match(bat, /move \/y "%P1B_DATA_DIR%\\p1a\.db\.tmp"/, '★② 校验后才 rename（同卷 rename 是原子的）');
  assert.match(bat, /providers\.template\.json/, '★③ 拷空配置模板');
  // ④⑤⑥⑦⑧ 在 boot 里
  assert.match(bat, /set "P1B_DB_PATH=/, '★④ 注入 P1B_DB_PATH');
  assert.match(bat, /set "P1B_PROVIDERS_PATH=/, '★④ 注入 P1B_PROVIDERS_PATH');
  assert.match(bat, /if not defined PORT set "PORT=8787"/, '★④ 端口缺省 8787');
  assert.match(bootSrc, /process\.env\.P1B_LLM_MOCK = '1'/, '★④ 首启无 key 强制 MOCK');
  assert.match(bootSrc, /await start\(\)/, '⑤ 起服务');
  assert.match(bootSrc, /等健康\(url \+ 'api\/health'/, '⑥ 健康检查打的是 /api/health');
  assert.match(bootSrc, /startup\.log/, '⑥ 超时时打印 startup.log 路径');
  assert.match(bootSrc, /'cmd\.exe', \['\/c', 'start', '', url\]/, '⑦ 用 Windows 的 start 开浏览器');
  assert.match(bootSrc, /推演沙盘已就绪/, '⑧ 首启横幅');
  assert.match(bootSrc, /账本行数/, '⑧ 横幅带账本行数');
  assert.match(bootSrc, /停止方法/, '⑧ 横幅带停止方法');
  // 零联网：boot 里不许出现 http 出站
  assert.ok(!/fetch\(['"]https?:/.test(bootSrc), '★boot 不对任何外网发请求（fetch 只打 127.0.0.1）');
  assert.ok(!/require\(['"](http|https|dns|tls|net)['"]\)/.test(bootSrc.replace("require('net')", "require('node:net')")), '★boot 不 require http/https/dns/tls（零出站网络）');
});
