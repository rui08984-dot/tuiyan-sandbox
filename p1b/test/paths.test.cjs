'use strict';
/**
 * p1b/test/paths.test.cjs —— 数据目录解析的回归锁（SPEC-runtime-paths）
 *
 * 本文件锁四件事，前两件是**生死线**：
 *   ① ★仓库开发态行为不变：不设任何环境变量时，解析结果必须**逐字符等于**今天的
 *      `p1a-terminal/src/db.js` 里的 DEFAULT_DB_PATH。差一个字符，开发者就看不到
 *      自己刚写的数据——而「双击就能用」是这个项目的主路径。
 *   ② ★Windows 落 %LOCALAPPDATA%，绝不落 %APPDATA%。漫游会把 6 MB 的库同步到域控，
 *      还会跟着组策略变只读。测试**同时**喂两个不同的值，断言答案只认 LOCALAPPDATA。
 *   ③ 优先级链逐级：P1B_DB_PATH ＞ P1B_DATA_DIR ＞ 平台默认。
 *   ④ 含空格与中文的 P1B_DATA_DIR：能建目录、能起服务。
 *      （bat 是 shell，不加引号会断 —— 这是方案 A1b 当初翻车的根因，别让它回来。）
 *
 * 铁律：本文件只解析与建临时目录，**不写仓库任何目录**，不碰生产库。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paths = require('../src/paths.cjs');
const { db } = require('../src/deps');

/** 临时目录；每个用例自己清，测试之间不互相看见 */
function tmpDir(tag) {
  const d = path.join(os.tmpdir(), 'p1b-paths-' + tag + '-' + process.pid + '-' + Date.now());
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

test('① ★仓库开发态行为不变：零环境变量 ⇒ 解析到今天的路径', () => {
  const got = paths.resolveDbPath({});
  assert.equal(got, db.DEFAULT_DB_PATH,
    '★不设 P1B_DATA_DIR 时必须仍解析到 p1a-terminal/data/p1a.db；得到 ' + got);
  assert.equal(got, paths.REPO_DB_PATH, 'REPO_DB_PATH 常量与解析结果必须同源');
  // 显式说「我在源码树里」也必须给同一条 —— 测试不能依赖 .git 恰好存在
  assert.equal(paths.resolveDbPath({}, { isSourceCheckout: true }), db.DEFAULT_DB_PATH);
});

test('② ★Windows 默认落 %LOCALAPPDATA%，不用 %APPDATA%', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\某个人\\AppData\\Local', APPDATA: 'C:\\Users\\某个人\\AppData\\Roaming' };
  const dir = paths.platformDataDir({ env, platform: 'win32' });
  assert.ok(dir.startsWith(env.LOCALAPPDATA), '必须落在 LOCALAPPDATA 下，实际 ' + dir);
  assert.ok(!dir.startsWith(env.APPDATA), '★绝不能落 %APPDATA%（漫游会把库同步到域控），实际 ' + dir);
  assert.equal(dir, path.join(env.LOCALAPPDATA, 'P1bSandbox'));
  // 「已打包」形态下 resolveDbPath 也必须落这儿
  const full = paths.resolveDbPath(env, { isSourceCheckout: false, platform: 'win32' });
  assert.equal(full, path.join(env.LOCALAPPDATA, 'P1bSandbox', 'p1a.db'));
});

test('②b 三平台默认目录各就各位（纯函数 ⇒ 在 Windows 上也能测 mac/linux）', () => {
  assert.equal(
    paths.platformDataDir({ env: {}, platform: 'darwin', homedir: '/Users/me' }),
    path.join('/Users/me', 'Library', 'Application Support', 'P1bSandbox'),
  );
  // linux：XDG 优先
  assert.equal(
    paths.platformDataDir({ env: { XDG_DATA_HOME: '/xdg' }, platform: 'linux', homedir: '/home/me' }),
    path.join('/xdg', 'P1bSandbox'),
  );
  // linux：XDG 缺失回落 ~/.local/share
  assert.equal(
    paths.platformDataDir({ env: {}, platform: 'linux', homedir: '/home/me' }),
    path.join('/home/me', '.local', 'share', 'P1bSandbox'),
  );
  // 拿不到 LOCALAPPDATA 时必须**喊出来**，不许悄悄落到用户目录别处
  assert.throws(() => paths.platformDataDir({ env: {}, platform: 'win32' }), /LOCALAPPDATA/);
});

test('③ 优先级链逐级生效：P1B_DB_PATH ＞ P1B_DATA_DIR ＞ 平台默认', () => {
  const env = {
    P1B_DB_PATH: 'D:\\显式\\我的库.db',
    P1B_DATA_DIR: 'E:\\数据目录',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  };
  // ① P1B_DB_PATH 最高，且**原样返回**（不补扩展名、不解析成目录）
  assert.equal(paths.resolveDbPath(env, { isSourceCheckout: false, platform: 'win32' }), 'D:\\显式\\我的库.db');
  // ② 去掉 ① 之后 P1B_DATA_DIR 接管
  const noFile = { P1B_DATA_DIR: env.P1B_DATA_DIR, LOCALAPPDATA: env.LOCALAPPDATA };
  assert.equal(paths.resolveDbPath(noFile, { isSourceCheckout: false, platform: 'win32' }),
    path.join('E:\\数据目录', 'p1a.db'));
  // ③ 两个都不设 ⇒ 平台默认（已打包形态）
  const bare = { LOCALAPPDATA: env.LOCALAPPDATA };
  assert.equal(paths.resolveDbPath(bare, { isSourceCheckout: false, platform: 'win32' }),
    path.join(env.LOCALAPPDATA, 'P1bSandbox', 'p1a.db'));
  // 来源标注也跟着走 —— 横幅不许说假话
  assert.equal(paths.dbPathSource('x', env), 'P1B_DB_PATH');
  assert.equal(paths.dbPathSource('x', noFile), 'P1B_DATA_DIR');
  assert.equal(paths.describeDbPath('x', noFile), '（P1B_DATA_DIR 指定）');
  assert.equal(paths.describeDbPath('x', bare, { isSourceCheckout: false }), '（平台数据目录）');
});

test('③b 源码树 vs 已打包：同一份 env 走两条不同的默认', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  assert.equal(paths.resolveDbPath(env, { isSourceCheckout: true, platform: 'win32' }), db.DEFAULT_DB_PATH);
  assert.notEqual(
    paths.resolveDbPath(env, { isSourceCheckout: false, platform: 'win32' }),
    db.DEFAULT_DB_PATH, '已打包形态必须离开仓库目录');
  // P1B_DIST=1 让打包件不必带 .git 也能声明自己是打包件
  assert.equal(paths.isSourceCheckout({ env: { P1B_DIST: '1' } }), false);
});

test('④ ★含空格与中文的 P1B_DATA_DIR：能建目录', () => {
  const base = tmpDir('cn');
  try {
    const dir = path.join(base, '我的 数据 目录', '子目录 带空格');
    const resolved = paths.resolveDbPath({ P1B_DATA_DIR: dir });
    assert.equal(resolved, path.join(dir, 'p1a.db'));
    // 这一步就是「方案 A1b 翻车根因」那件事：路径里有空格与中文时 mkdir 必须成功
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    assert.ok(fs.existsSync(path.dirname(resolved)));
  } finally { rmrf(base); }
});

test('④b ★含空格与中文的 P1B_DATA_DIR：真能起服务（buildServer + /api/health）', async () => {
  const { buildServer } = require('../src/server');
  const base = tmpDir('cn-serve');
  const dir = path.join(base, '我的 数据 目录');
  const providers = path.join(base, 'providers 配置.json');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  const saved = { ...process.env };
  process.env.P1B_DATA_DIR = dir;
  delete process.env.P1B_DB_PATH;
  let app = null;
  try {
    app = await buildServer({ llmMock: true, providersPath: providers }); // 不传 dbPath ⇒ 走 P1B_DATA_DIR
    const expected = path.join(dir, 'p1a.db');
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).db_path, expected, '横幅/health 必须打印真实生效的库路径');
    assert.ok(fs.existsSync(expected), '库必须真的在那个中文+空格目录里建起来');
  } finally {
    try { if (app) await app.close(); } catch (e) { /* ignore */ }
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmrf(base);
  }
});

test('⑤ 只解析不做 IO：resolveDbPath 本身不建任何目录', () => {
  const base = tmpDir('noio');
  try {
    const dir = path.join(base, '不存在的目录');
    const resolved = paths.resolveDbPath({ P1B_DATA_DIR: dir });
    assert.equal(resolved, path.join(dir, 'p1a.db'));
    assert.equal(fs.existsSync(dir), false, '★paths.cjs 只解析：副作用留给调用方（db.init 会 mkdir）');
  } finally { rmrf(base); }
});

// ══════════════════════════════════════════════════════════════════
// ★2026-09-29：判据从「有没有 .git」改成「数据在不在原地」。
//   原判据的具体后果：打包成 zip（★打包模块产出的正是没有 .git 的东西）
//   再本地跑 ⇒ 数据**静默改道** %LOCALAPPDATA%，不报错不提示，
//   表现为「昨天还在的数据今天不见了」——本轮唯一一处会让人今天干不了活的。
// ══════════════════════════════════════════════════════════════════

test('⑨ ★zip 副本（无 .git）里已有数据 ⇒ 必须落原地，不许静默改道', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const mod = require(path.join(__dirname, '..', 'src', 'paths.cjs'));

  // 造一个「zip 副本」：有 p1a-terminal/ 与 p1b/，**没有 .git**，且库文件在原地
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-zip-'));
  try {
    fs.mkdirSync(path.join(dir, 'p1a-terminal', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'p1b'), { recursive: true });
    const dbFile = path.join(dir, 'p1a-terminal', 'data', 'p1a.db');
    fs.writeFileSync(dbFile, 'not-a-real-db-but-it-exists');
    assert.equal(fs.existsSync(path.join(dir, '.git')), false, '前提失效：临时目录里居然有 .git');

    const got = mod.resolveDbPath({}, { root: dir, dbPath: dbFile });
    assert.equal(got, dbFile,
      '★zip 副本里数据在原地却被改道到 ' + got + ' —— 这就是「昨天还在今天不见了」');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('⑨b ★反向锁：把判据改回「只认 .git」⇒ 本条必须红', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const mod = require(path.join(__dirname, '..', 'src', 'paths.cjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-zip2-'));
  try {
    fs.mkdirSync(path.join(dir, 'p1a-terminal', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'p1b'), { recursive: true });
    const dbFile = path.join(dir, 'p1a-terminal', 'data', 'p1a.db');
    fs.writeFileSync(dbFile, 'x');
    // 旧判据在这��情形下的返回值（= false，因为它只看 .git）
    const legacyAnswer = fs.existsSync(path.join(dir, '.git'));
    assert.equal(legacyAnswer, false, '前提失效：临时目录里居然有 .git');
    const env = { LOCALAPPDATA: 'C:/Users/x/AppData/Local' };
    const platformDefault = path.join(
      mod.platformDataDir({ env, platform: 'win32' }), 'p1a.db',
    );
    const real = mod.resolveDbPath(env, { root: dir, dbPath: dbFile });
    assert.notEqual(real, platformDefault, '★新判据没生效：结果等于平台默认路径');
    assert.equal(real, dbFile, '★数据在原地必须落原地');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('⑨c 全新安装（原地无库）⇒ 仍落平台默认（改判据不许把新用户的数据写进 app 目录）', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const mod = require(path.join(__dirname, '..', 'src', 'paths.cjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-fresh-'));
  try {
    fs.mkdirSync(path.join(dir, 'p1a-terminal', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'p1b'), { recursive: true });
    // ★必须注入 LOCALAPPDATA：platformDataDir 在 win32 下拿不到它会直接抛，
    //   那不是本条要测的东西（另两条已覆盖），所以这里把环境显式给足。
    const env = { LOCALAPPDATA: 'C:/Users/x/AppData/Local' };
    const got = mod.resolveDbPath(env, { root: dir, dbPath: path.join(dir, 'p1a-terminal', 'data', 'p1a.db') });
    assert.match(got, /P1bSandbox/i,
      '全新安装应落平台数据目录，实得 ' + got + '（否则数据会被写进程序目录，卸载即丢）');
    assert.ok(!got.startsWith(dir),
      '★数据不许落进程序目录 ' + dir + ' —— 卸载即丢');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
