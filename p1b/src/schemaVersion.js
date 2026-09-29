'use strict';
/**
 * p1b/src/schemaVersion.js —— 库格式版本 ＋ 降级拒绝（SPEC-runtime-paths）
 *
 * ── 这一层存在的理由：「脚本」与「成品」的分界线 ──────────────────────────
 *   脚本可以假设只有作者在用；成品必须处理「用户拿旧版程序打开新版库」。
 *   而 SQLite 没有「列不知道」这回事——用旧程序打开新库，它不会报错，
 *   它会**照旧把不认识的东西当成不存在**，然后下一次写就把用户的数据写坏。
 *   所以启动第一件事必须是：**读版本 → 比对 → 不认识就停下来**。
 *
 * ── 三条硬纪律 ────────────────────────────────────────────────────────────
 *   ① **绝不自动降级 schema**。把新库降回旧版 = 丢列丢数据，比拒绝启动坏得多。
 *   ② **拒绝时不碰数据**。检查走**只读连接**（`readonly + fileMustExist`），
 *      连 `-wal`/`-shm` 都不产生；实测打开前后主库文件 sha256 逐字节不变。
 *   ③ **退出码 6**，与「程序错误」1–5 区分开——「你的数据太新了」不是 bug，
 *      是「你拿错了程序」，两者混在一起会让人去翻日志。
 *
 * ── 为什么迁移前要备份 ────────────────────────────────────────────────────
 *   迁移脚本是唯一一类「跑错了和跑对了看起来一样」的代码。备份的价值不在于
 *   「拷出来了」，而在于**出事那天读得出来**——所以带 sha256 收据（可 `sha256sum -c`）。
 *   ★取 SQLite **在线备份 API**（`db.backup()`）而不是 `copyFileSync`：库是 WAL 模式，
 *   cp 一个正在写的 .db 只会拿到某个不一致的瞬间（可能缺 -wal 里的事务）。
 *
 * ★本模块允许的唯一写入是「把版本号往高处写」。`setSchemaVersion` 显式拒绝写低于
 *   当前值的版本号——降级不是「没接上」，是主动放弃数据。
 *
 * 零新依赖：better-sqlite3 只装在 p1a-terminal/node_modules 下，按绝对路径取
 * （与 `p1b/scripts/backup-offsite.cjs:35` 同一手法）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));

/** 本程序能读懂的最高 schema 版本。改 schema 时**只许往高处改**。 */
const CURRENT_SCHEMA_VERSION = 1;

/** app_meta 里版本号那一行的 key。 */
const VERSION_KEY = 'schema_version';

/**
 * 退出码 6：「库比程序新」。SPEC Open Questions 记着一条待办——
 * `p1b/cli/index.cjs:14-24` 与 `p1b/mcp/exitMap.cjs:49` 的码表都还没登记它，
 * 于是 MCP 侧会把它读成「未登记的子进程码」。**本模块只负责本程序自己 exit 6**，
 * 那两张码表属别的模块的写入面，没有授权不动（见交付报告的未做项）。
 */
const EXIT_SCHEMA_TOO_NEW = 6;

/** 表结构。纯 additive：一张新表，**不碰 p1a 任何既有表**。 */
const APP_META_DDL = `CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/** 拒绝启动时抛的错。带 exitCode，让启动横幅不必自己判断错误种类。 */
class SchemaTooNewError extends Error {
  constructor(found, supported) {
    super(
      '[p1b] 拒绝启动：你的数据是 v' + found + ' 格式，这个程序只认到 v' + supported + '。\n' +
      '        两种修法（选一种）：\n' +
      '          ① 升级程序 —— 去拿能读 v' + found + ' 的那一版；\n' +
      '          ② 回退数据 —— 用备份恢复：node p1b/scripts/backup-offsite.cjs … 找到备份后 restore。\n' +
      '        ★本程序**不会**自动把库降级：降级会丢数据。',
    );
    this.name = 'SchemaTooNewError';
    this.found = found;
    this.supported = supported;
    this.exitCode = EXIT_SCHEMA_TOO_NEW;
  }
}

function stamp(d) {
  const x = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '' + x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate()) + '-' + p(x.getHours()) + p(x.getMinutes()) + p(x.getSeconds());
}

/** 建 app_meta（若不存在）。只建新表，零碰既有表。 */
function ensureAppMeta(conn) {
  conn.exec(APP_META_DDL);
  return conn;
}

/** 读版本号。表不存在或没这行 ⇒ null（表示「还没被登记过」）。 */
function readSchemaVersion(conn) {
  let hasTable;
  try {
    hasTable = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'")
      .get();
  } catch (e) {
    return null;
  }
  if (!hasTable) return null;
  const row = conn.prepare('SELECT value FROM app_meta WHERE key=?').get(VERSION_KEY);
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 只读打开一个库。**不写、不建 sidecar**（实测主库文件 sha256 前后不变）。
 * @returns {object|null} 连接；文件不存在 ⇒ null（全新安装，没有版本可比）
 */
function openReadonly(dbPath) {
  if (!dbPath || dbPath === ':memory:') return null;
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) return null; // 全新安装：没有「更旧的库」这回事
  return new Database(resolved, { readonly: true, fileMustExist: true });
}

/**
 * ★降级拒绝的真正闸门。启动时**在 db.init 之前**调用 ——
 *   db.init 会建 p1a 的全套表，那是写操作；一个「比程序新的库」绝不能被它先碰。
 *
 * @param {string} dbPath
 * @param {number} [supported]
 * @returns {{checked: boolean, found: number|null}} checked=false 表示无库可查（全新安装）
 * @throws {SchemaTooNewError} 库版本高于本程序支持 ⇒ 拒绝启动（exit 6），数据零改动
 */
function assertSchemaSupported(dbPath, supported) {
  const max = supported === undefined ? CURRENT_SCHEMA_VERSION : supported;
  const conn = openReadonly(dbPath);
  if (!conn) return { checked: false, found: null };
  let found;
  try {
    found = readSchemaVersion(conn);
  } finally {
    conn.close();
  }
  if (found !== null && found > max) throw new SchemaTooNewError(found, max);
  return { checked: true, found };
}

/**
 * 迁移前的自动备份：SQLite 在线备份 API ＋ sha256 收据。
 * 落在库同目录的 `backups/` 下 —— 同盘是刻意的（这里要的是「出事前读得出来」的
 * 本地回退点，跨盘是 `backup-offsite.cjs` 的活）。
 *
 * @returns {{file: string, receipt: string, sha256: string, bytes: number}}
 */
async function backupBeforeMigration(dbPath, fromVersion, toVersion) {
  const resolved = path.resolve(dbPath);
  const dir = path.join(path.dirname(resolved), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(resolved, path.extname(resolved));
  const dest = path.join(dir, base + '.v' + fromVersion + '-to-v' + toVersion + '-' + stamp() + '.db');

  const src = new Database(resolved, { readonly: true, fileMustExist: true });
  // ★必须 await 完再关连接。这里第一版写成 `try { return src.backup().then(...) } finally { src.close() }`
  //   —— finally 在 promise **返回时**就跑完了，连接先关、备份后做，backup() 立刻抛
  //   「connection is not open」。同步的 try/finally 配异步任务是本项目已记过的同族坑。
  try {
    await src.backup(dest);
  } finally {
    src.close();
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  const receipt = dest + '.sha256';
  // sha256sum 标准格式：可以直接 `sha256sum -c` 验
  fs.writeFileSync(receipt, sha256 + '  ' + path.basename(dest) + '\n', 'utf8');
  return { file: dest, receipt, sha256, bytes: fs.statSync(dest).size };
}

/**
 * 把版本号写进 app_meta。**只许往高处写** —— 传一个更低的版本号直接抛错。
 */
function setSchemaVersion(conn, version) {
  const v = Number(version);
  if (!Number.isFinite(v)) throw new Error('[p1b] schema 版本号非法: ' + version);
  const current = readSchemaVersion(conn);
  if (current !== null && v < current) {
    // ★这不是「没接上」，是主动放弃数据。宁可启动失败也不做。
    throw new Error('[p1b] 拒绝把 schema 版本从 v' + current + ' 写成 v' + v + '（降级会丢数据）');
  }
  ensureAppMeta(conn);
  conn.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
    .run(VERSION_KEY, String(v));
  return v;
}

/**
 * 迁移。**只有真的发生版本号变化时才备份**：
 *   · 盘上还没有 app_meta（null）⇒ 首次登记，不备份。理由：这时没有任何「旧版本」
 *     可回退，且这正是源码树开发态的常态——每次启动都往仓库里丢一份备份，
 *     等于把「开发态行为不变」这条铁律砸了。
 *   · 盘上是 vN（N < 当前）⇒ 真的要动结构了 ⇒ **先备份，再写版本号**。
 *   · 盘上已是当前版本 ⇒ 什么都不做。
 *   · 盘上比程序新 ⇒ 抛错退出，绝不降级。
 *
 * @param {string} dbPath
 * @param {object} conn 已经打开的连接（由调用方持有，db.init 之后的那个）
 * @param {object} [o] `{ supported?, now? }`
 * @returns {Promise<{from:number|null,to:number,backup:object|null,migrated:boolean}>}
 */
async function migrate(dbPath, conn, o) {
  const opt = o || {};
  const to = opt.supported === undefined ? CURRENT_SCHEMA_VERSION : opt.supported;
  const from = readSchemaVersion(conn);

  if (from !== null && from > to) throw new SchemaTooNewError(from, to);
  if (from === to) return { from, to, backup: null, migrated: false };

  // 首次登记（null → to）：不备份，见上方理由
  if (from === null) {
    setSchemaVersion(conn, to);
    return { from, to, backup: null, migrated: false };
  }

  // 真的要迁移：备份是**先决条件**，备份失败就不许继续
  const backup = await backupBeforeMigration(dbPath, from, to);
  setSchemaVersion(conn, to);
  return { from, to, backup, migrated: true };
}

module.exports = {
  CURRENT_SCHEMA_VERSION, VERSION_KEY, EXIT_SCHEMA_TOO_NEW, APP_META_DDL,
  SchemaTooNewError, ensureAppMeta, readSchemaVersion, openReadonly,
  assertSchemaSupported, setSchemaVersion, backupBeforeMigration, migrate,
};
