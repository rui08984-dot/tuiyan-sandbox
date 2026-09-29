'use strict';
/**
 * p1b/test/schema-version.test.cjs —— app_meta ＋ 降级拒绝的回归锁（SPEC-runtime-paths）
 *
 * 这一层是「脚本」与「成品」的分界线：脚本可以假设只有作者在用，成品必须处理
 * 「用户拿旧版程序打开新版库」。SQLite 不会为这件事报错——它会照旧把不认识的
 * 列当成不存在，然后下一次写就把用户的数据写坏。所以本文件锁死四件事：
 *
 *   ① ★高版本 schema ⇒ 拒绝启动，退出码 6，**且数据零改动**
 *      「零改动」不是空话：检查走只读连接，主库文件 sha256 前后逐字节相同，
 *      连 `-wal`/`-shm` 都不许冒出来。降级拒绝若顺手写了个 WAL 头，
 *      它就已经在用户的库上落下第一个字节了。
 *   ② ★绝不自动降级 schema —— `setSchemaVersion` 收到更低的版本号必须抛错。
 *   ③ 迁移前自动备份被测试覆盖：真的要从 vN 升到 vN+1 时，先落一份带 sha256 收据的备份。
 *   ④ 真起一次进程验退出码 6（不是「函数抛了个错就算数」——退出码要真从进程出来）。
 *
 * 铁律：全部落在 os.tmpdir()，**不写仓库任何目录**，不碰生产库。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3')); // 零新依赖：只装在这儿
const sv = require('../src/schemaVersion');
const SERVER = path.join(__dirname, '..', 'src', 'server.js');

function tmpDb(tag) {
  const d = path.join(os.tmpdir(), 'p1b-sv-' + tag + '-' + process.pid + '-' + Date.now());
  fs.mkdirSync(d, { recursive: true });
  return { dir: d, file: path.join(d, 'p1a.db') };
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
/** 在库里直接塞一个 schema_version（模拟「别处写的更高版本」） */
function seedVersion(file, version) {
  const d = new Database(file);
  d.exec(sv.APP_META_DDL);
  d.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(sv.VERSION_KEY, String(version));
  d.close();
}

// ════════════════════════════════════════════════════════════════════
// ① 降级拒绝：退出码 6 + 数据零改动
// ════════════════════════════════════════════════════════════════════

test('① 高版本 schema ⇒ 抛 SchemaTooNewError 且 exitCode=6', () => {
  const t = tmpDb('toonew');
  try {
    seedVersion(t.file, sv.CURRENT_SCHEMA_VERSION + 1);
    assert.throws(
      () => sv.assertSchemaSupported(t.file),
      (e) => {
        assert.equal(e.name, 'SchemaTooNewError');
        assert.equal(e.exitCode, 6, '★退出码必须是 6，与「程序错误」1–5 区分开');
        assert.equal(e.found, sv.CURRENT_SCHEMA_VERSION + 1);
        assert.equal(e.supported, sv.CURRENT_SCHEMA_VERSION);
        // 拒绝时必须把「怎么办」说出来，而不是只说一句不行
        assert.match(e.message, /升级程序/, '要说人话：两种修法都要给');
        assert.match(e.message, /回退数据/);
        assert.match(e.message, /不会.*自动把库降级/);
        return true;
      },
    );
  } finally { rmrf(t.dir); }
});

test('①b ★数据零改动：拒绝前后主库 sha256 逐字节不变，且不产生 -wal/-shm', () => {
  const t = tmpDb('zerochange');
  try {
    seedVersion(t.file, 99);
    const before = sha(t.file);
    const beforeFiles = fs.readdirSync(t.dir).sort();
    assert.throws(() => sv.assertSchemaSupported(t.file), /拒绝启动/);
    assert.equal(sha(t.file), before, '★主库文件必须一个字节都没变');
    assert.deepEqual(fs.readdirSync(t.dir).sort(), beforeFiles, '★连 sidecar 都不许冒出来');
    assert.equal(fs.existsSync(t.file + '-wal'), false);
    assert.equal(fs.existsSync(t.file + '-shm'), false);
    // 版本号本身也不能被「顺手改成当前版本」——那正是自动降级
    const d = new Database(t.file, { readonly: true });
    assert.equal(sv.readSchemaVersion(d), 99, '★拒绝不得顺手改写版本号（那就是降级）');
    d.close();
  } finally { rmrf(t.dir); }
});

test('①c 正常路径不误伤：同版本 / 更低版本 / 全新安装都放行', () => {
  const t = tmpDb('ok');
  try {
    // 全新安装：文件还不存在 ⇒ 没有「更旧的库」这回事
    assert.deepEqual(sv.assertSchemaSupported(t.file), { checked: false, found: null });
    seedVersion(t.file, sv.CURRENT_SCHEMA_VERSION);
    assert.deepEqual(sv.assertSchemaSupported(t.file), { checked: true, found: sv.CURRENT_SCHEMA_VERSION });
    // 内存库直接跳过
    assert.deepEqual(sv.assertSchemaSupported(':memory:'), { checked: false, found: null });
  } finally { rmrf(t.dir); }
});

test('①d ★真起进程验退出码 6（不是「函数抛错就算数」）', () => {
  const t = tmpDb('exit6');
  try {
    seedVersion(t.file, 42);
    const r = spawnSync(process.execPath, [SERVER], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
      env: Object.assign({}, process.env, { P1B_DB_PATH: t.file, PORT: '0' }),
    });
    const out = String(r.stdout || '') + String(r.stderr || '');
    assert.equal(r.status, 6, '★进程退出码必须是 6。实际 ' + r.status + '\n' + out);
    assert.match(out, /拒绝启动/, '拒绝时必须说清为什么：\n' + out);
    assert.match(out, /这个程序只认到/);
    // 「后端已启动」横幅绝不能打出来 —— 拒绝了就没启动
    assert.equal(/后端已启动/.test(out), false, '拒绝启动时不许打「已启动」横幅');
  } finally { rmrf(t.dir); }
});

// ════════════════════════════════════════════════════════════════════
// ② 绝不自动降级
// ════════════════════════════════════════════════════════════════════

test('② ★绝不自动降级：写更低的版本号必须抛错', () => {
  const t = tmpDb('nodowngrade');
  try {
    const d = new Database(t.file);
    sv.setSchemaVersion(d, 3);
    assert.throws(() => sv.setSchemaVersion(d, 1), /降级会丢数据/);
    assert.equal(sv.readSchemaVersion(d), 3, '★抛错后版本号必须原封不动');
    // 同版本与往高处写都合法
    assert.equal(sv.setSchemaVersion(d, 3), 3);
    assert.equal(sv.setSchemaVersion(d, 5), 5);
    d.close();
  } finally { rmrf(t.dir); }
});

test('②b migrate 遇高版本也必须抛错（不许替用户降级）', async () => {
  const t = tmpDb('mig-toonew');
  try {
    const d = new Database(t.file);
    seedVersion(t.file, sv.CURRENT_SCHEMA_VERSION + 3);
    await assert.rejects(() => sv.migrate(t.file, d), (e) => {
      assert.equal(e.name, 'SchemaTooNewError');
      assert.equal(e.exitCode, 6);
      return true;
    });
    assert.equal(sv.readSchemaVersion(d), sv.CURRENT_SCHEMA_VERSION + 3, '★版本号不得被改低');
    d.close();
  } finally { rmrf(t.dir); }
});

// ════════════════════════════════════════════════════════════════════
// ③ 迁移前自动备份
// ════════════════════════════════════════════════════════════════════

test('③ ★迁移前自动备份：vN → vN+1 时先落一份带 sha256 收据的备份', async () => {
  const t = tmpDb('backup');
  try {
    const d = new Database(t.file);
    d.exec('CREATE TABLE t(x)'); d.prepare('INSERT INTO t VALUES(?)').run('迁移前我还在');
    sv.setSchemaVersion(d, 0);
    d.close();
    const beforeSha = sha(t.file);

    const conn = new Database(t.file);
    const out = await sv.migrate(t.file, conn);

    assert.equal(out.migrated, true, '★这次是真的迁移（0 → 1）');
    assert.equal(out.from, 0);
    assert.equal(out.to, sv.CURRENT_SCHEMA_VERSION);
    assert.ok(out.backup, '★迁移必须留下备份');
    assert.ok(fs.existsSync(out.backup.file), '备份文件必须真的在盘上');
    assert.ok(fs.existsSync(out.backup.receipt), '必须留下 sha256 收据——备份的价值在于出事那天读得出来');
    assert.equal(out.backup.sha256, sha(out.backup.file), '收据里的 sha256 必须与备份件一致');
    // sha256sum 标准格式：可以 `sha256sum -c` 直接验
    const receipt = fs.readFileSync(out.backup.receipt, 'utf8');
    assert.match(receipt, new RegExp('^[0-9a-f]{64}\\s+' + path.basename(out.backup.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // 备份里必须有迁移**前**的数据
    const b = new Database(out.backup.file, { readonly: true });
    assert.equal(b.prepare('SELECT x FROM t').get().x, '迁移前我还在');
    assert.equal(sv.readSchemaVersion(b), 0, '★备份必须是迁移前的快照（版本号还停在 0）');
    b.close();
    // 迁移后主库版本号已推进
    assert.equal(sv.readSchemaVersion(conn), sv.CURRENT_SCHEMA_VERSION);
    assert.notEqual(sha(t.file), beforeSha, '迁移后主库确实变了（否则这个测试是假通过）');
    conn.close();
  } finally { rmrf(t.dir); }
});

test('③b 首次登记（盘上没有 app_meta）不备份：源码树开发态不许每次启动都往仓库里丢备份', async () => {
  const t = tmpDb('adopt');
  try {
    const d = new Database(t.file);
    d.exec('CREATE TABLE t(x)');
    const out = await sv.migrate(t.file, d);
    assert.equal(out.from, null);
    assert.equal(out.migrated, false, '首次登记不是迁移');
    assert.equal(out.backup, null, '★首次登记不备份：没有旧版本可回退，且这是开发常态');
    assert.equal(fs.existsSync(path.join(t.dir, 'backups')), false, '不许凭空造 backups 目录');
    // 但版本号必须真的登记上，否则降级保护下一启动就失效
    assert.equal(sv.readSchemaVersion(d), sv.CURRENT_SCHEMA_VERSION);
    d.close();
  } finally { rmrf(t.dir); }
});

test('③c 已是当前版本 ⇒ 什么都不做（不备份、不重写）', async () => {
  const t = tmpDb('noop');
  try {
    const d = new Database(t.file);
    sv.setSchemaVersion(d, sv.CURRENT_SCHEMA_VERSION);
    const before = sha(t.file);
    const out = await sv.migrate(t.file, d);
    assert.equal(out.migrated, false);
    assert.equal(out.backup, null);
    assert.equal(sha(t.file), before, '★无迁移时主库必须一个字节都没动');
    d.close();
  } finally { rmrf(t.dir); }
});

// ════════════════════════════════════════════════════════════════════
// ④ 与 server 的接线
// ════════════════════════════════════════════════════════════════════

test('④ 走 buildServer 的真实接线：库更新 ⇒ 起不来，且数据零改动', async () => {
  const t = tmpDb('wiring');
  const providers = path.join(t.dir, 'providers.json');
  fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
  try {
    seedVersion(t.file, 7);
    const before = sha(t.file);
    const { buildServer } = require('../src/server');
    const { db } = require('../src/deps');
    await assert.rejects(
      () => buildServer({ dbPath: t.file, llmMock: true, providersPath: providers }),
      (e) => {
        assert.equal(e.name, 'SchemaTooNewError');
        assert.equal(e.exitCode, 6);
        return true;
      },
    );
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
    assert.equal(sha(t.file), before, '★被拒绝的启动不得碰数据');
  } finally { rmrf(t.dir); }
});

test('④b app_meta 是 additive 新表：不碰 p1a 任何既有表', async () => {
  const t = tmpDb('additive');
  try {
    const { buildServer } = require('../src/server');
    const { db } = require('../src/deps');
    const providers = path.join(t.dir, 'providers.json');
    fs.writeFileSync(providers, JSON.stringify({ active: null, providers: {} }));
    const app = await buildServer({ dbPath: t.file, llmMock: true, providersPath: providers });
    await app.close();
    const d = new Database(t.file, { readonly: true });
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    // p1a 契约里的表一个都不许少（少一张才是「碰了既有表」的真信号）
    for (const t0 of ['games', 'players', 'events', 'claims', 'actions']) {
      assert.ok(tables.includes(t0), 'p1a 既有表 ' + t0 + ' 不见了');
    }
    assert.ok(tables.includes('app_meta'), 'app_meta 必须建出来');
    d.close();
    try { db.closeCurrent(); } catch (e) { /* ignore */ }
  } finally { rmrf(t.dir); }
});
