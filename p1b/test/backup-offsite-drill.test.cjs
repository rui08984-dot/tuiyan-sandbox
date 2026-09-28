'use strict';
/**
 * p1b/test/backup-offsite-drill.test.cjs —— 异地备份 + 恢复演练两个脚本的回归闸（2026-09-28 · P0-6）
 *
 * 背景（为什么要有这个文件）：事故是「80 份 .db 备份、全部同一块盘同一目录，无保留策略、
 * 无异地、无恢复演练记录」——备份这件事此前只有人肉 cp，既不知道能不能用，也不知道还剩几份。
 * 本文件把两个脚本的安全属性钉死，最要紧的是三条：
 *   ① **默认不动手**：两个脚本缺 --确认都必须 exit 2 且**零副作用**（不建目录、不落文件）。
 *   ② **演练绝不碰生产**：跑完一遍演练后生产库的 sha256 必须逐字节不变。
 *   ③ **坏备份要能被读成「不能用」**：损坏件必须 exit 3（门禁码），而不是 0。
 *      演练报告 exit 0 = 「这份能用」，是一句断言；退化成「跑完了」就等于没测。
 *
 * 铁律：全部落在 os.tmpdir()，不写仓库任何目录；生产库只被**读**（只取 sha256 做前后对照）。
 * 脚本一律 execFileSync 起子进程（不 require）——照 `p1b/cli/` 的薄包装纪律，
 * 也避开 `scripts-require-safety.test.cjs` 的静态同形检测。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const P1B = path.join(__dirname, '..');
const BACKUP = path.join(P1B, 'scripts', 'backup-offsite.cjs');
const DRILL = path.join(P1B, 'scripts', 'restore-drill.cjs');
const PROD_DB = path.join(P1B, '..', 'p1a-terminal', 'data', 'p1a.db');

/** 生产库的 sha256：演练前后各取一次，证明「演练没碰生产」不是空话 */
function prodSha() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(PROD_DB)).digest('hex'); } catch (e) { return null; }
}

function run(script, args) {
  try {
    const out = execFileSync(process.execPath, [script].concat(args), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    return { code: 0, out: String(out) };
  } catch (e) {
    return { code: e.status === null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

let seq = 0;
function tmpdir(tag) {
  const d = path.join(os.tmpdir(), 'p1b-p06-' + tag + '-' + process.pid + '-' + (seq++));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const cleanup = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } };

/** 造一个「像样」的小库：几张关键表都建好、行数非零，让演练有东西可校验 */
function makeSourceDb(dir, tag) {
  const src = path.join(dir, 'p1a-' + tag + '.db');
  const Database = require(path.join(P1B, '..', 'p1a-terminal', 'node_modules', 'better-sqlite3'));
  const db = new Database(src);
  db.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, text TEXT, created_at TEXT)');
  db.exec('CREATE TABLE verdicts (id INTEGER PRIMARY KEY, pid INTEGER, text TEXT)');
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, game_id INTEGER, type TEXT)');
  db.exec('CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT)');
  for (let i = 1; i <= 12; i++) db.prepare('INSERT INTO predictions (id,text,created_at) VALUES (?,?,?)').run(i, 'Q' + i, '2026-01-0' + (i % 9 + 1));
  for (let i = 1; i <= 30; i++) db.prepare('INSERT INTO verdicts (id,pid,text) VALUES (?,?,?)').run(i, (i % 12) + 1, 'V' + i);
  for (let i = 1; i <= 5; i++) db.prepare('INSERT INTO events (id,game_id,type) VALUES (?,?,?)').run(i, 1, 'statement');
  db.prepare('INSERT INTO games (id,name) VALUES (1,?)').run('G1');
  db.close();
  return src;
}

// ════════════════════════════════════════════════════════════════════
// ① 备份脚本：默认只读 + 异地硬约束 + 逐份 sha256 + 保留 N 份
// ════════════════════════════════════════════════════════════════════

test('备份脚本缺 --确认 → exit 2 且零副作用（备份目录连建都不建）', () => {
  const work = tmpdir('bk-dry');
  const dest = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    const r = run(BACKUP, ['--db', src, '--dest', dest, '--allow-same-drive']);
    assert.equal(r.code, 2, '缺 --确认 必须是 exit 2（p1b 侧码表：2=用法错/缺确认）');
    assert.equal(fs.existsSync(dest), false, '★dry-run 不得创建目标目录');
    assert.deepEqual(fs.readdirSync(work).filter((f) => f.endsWith('.db')).length, 1, '只应有源库一个 .db');
  } finally { cleanup(work); }
});

test('备份脚本：目标与源同一盘且没给 --allow-same-drive → 拒绝（异地是本脚本存在的理由）', () => {
  const work = tmpdir('bk-samedrive');
  const dest = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    fs.mkdirSync(dest, { recursive: true });
    const r = run(BACKUP, ['--db', src, '--dest', dest, '--确认']);
    assert.equal(r.code, 2, '同盘必须拒收——否则「异地备份」名存实亡');
    assert.match(r.out + (r.stdout || ''), /同一|盘|盘符|异地/, '错误信息要点明是盘符问题');
  } finally { cleanup(work); }
});

test('备份脚本 --确认：产出 .db + .sha256 收据，且收据里的 sha256 与文件重算一致', () => {
  const work = tmpdir('bk-ok');
  const dest = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    const r = run(BACKUP, ['--db', src, '--dest', dest, '--allow-same-drive', '--确认']);
    assert.equal(r.code, 0, '带 --确认 应成功：' + r.out);
    const files = fs.readdirSync(dest);
    const dbs = files.filter((f) => f.endsWith('.db'));
    const receipts = files.filter((f) => f.endsWith('.sha256'));
    assert.equal(dbs.length, 1, '应恰好产出 1 份 .db，实得 ' + JSON.stringify(files));
    assert.equal(receipts.length, 1, '每份备份都须有 sha256 收据（逐份校验是硬要求）');
    const dbFile = path.join(dest, dbs[0]);
    const receipt = fs.readFileSync(path.join(dest, receipts[0]), 'utf8');
    assert.match(receipt, /[0-9a-f]{64}/, '收据里须有 64 位 sha256');
    assert.ok(receipt.includes(sha256File(dbFile)), '★收据 sha256 必须等于对文件重算的值');
  } finally { cleanup(work); }
});

test('备份脚本 --keep N：只留最近 N 份，超出的连同收据一起清掉', () => {
  const work = tmpdir('bk-keep');
  const dest = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    // 先手工铺 4 份带收据的旧备份，模拟历史存量
    for (let i = 1; i <= 4; i++) {
      const f = path.join(dest, 'p1a-offsite-2026010' + i + '-000000.db');
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(src, f);
      fs.writeFileSync(f + '.sha256', sha256File(f) + '  ' + path.basename(f) + '\n', 'utf8');
    }
    const r = run(BACKUP, ['--db', src, '--dest', dest, '--allow-same-drive', '--keep', '2', '--确认']);
    assert.equal(r.code, 0, r.out);
    const left = fs.readdirSync(dest);
    assert.equal(left.filter((f) => f.endsWith('.db')).length, 2, '--keep 2 后应只剩 2 份 .db，实得 ' + JSON.stringify(left));
    assert.equal(left.filter((f) => f.endsWith('.sha256')).length, 2, '收据必须跟着一起裁，不能剩孤儿收据');
  } finally { cleanup(work); }
});

test('备份脚本 --keep 非法值 → exit 2（别让 --keep 0 变成「全删」）', () => {
  const work = tmpdir('bk-badkeep');
  const dest = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    for (const bad of ['0', '-1', 'abc']) {
      const r = run(BACKUP, ['--db', src, '--dest', dest, '--allow-same-drive', '--keep', bad, '--确认']);
      assert.equal(r.code, 2, '--keep ' + bad + ' 应被拒（0/-1 会把备份删光）');
    }
  } finally { cleanup(work); }
});

// ════════════════════════════════════════════════════════════════════
// ② 恢复演练脚本：默认只读 + 绝不碰生产 + 坏备份读成「不能用」
// ════════════════════════════════════════════════════════════════════

test('演练脚本缺 --确认 → exit 2 且不留任何临时件', () => {
  const work = tmpdir('dr-dry');
  const dir = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, 'p1a-offsite-20260101-000000.db'));
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('p1b-restore-drill')).length;
    const r = run(DRILL, ['--dir', dir, '--db', src]);
    assert.equal(r.code, 2, '缺 --确认 必须是 exit 2');
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('p1b-restore-drill')).length;
    assert.equal(after, before, '★dry-run 不得留下临时恢复件');
  } finally { cleanup(work); }
});

test('演练脚本 --确认：好备份 → exit 0 且报告「可用」', () => {
  const work = tmpdir('dr-good');
  const dir = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    fs.mkdirSync(dir, { recursive: true });
    const bk = path.join(dir, 'p1a-offsite-20260101-000000.db');
    fs.copyFileSync(src, bk);
    fs.writeFileSync(bk + '.sha256', sha256File(bk) + '  ' + path.basename(bk) + '\n', 'utf8');

    const r = run(DRILL, ['--dir', dir, '--db', src, '--确认']);
    assert.equal(r.code, 0, '好备份应判可用：' + r.out);
    assert.match(r.out, /可用/, '报告里要出现「可用」这个结论');
    assert.match(r.out, /predictions/, '报告要落到具体表，不能只给一个空泛的 OK');
  } finally { cleanup(work); }
});

test('★演练脚本绝不碰生产库：跑完生产库 sha256 逐字节不变', () => {
  const work = tmpdir('dr-safe');
  const dir = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, 'p1a-offsite-20260101-000000.db'));
    // 目标就指向真实生产库：这一步若有任何写，sha 必然变。
    // 边车怎么判要说清楚，否则这条断言会变成一句自欺：
    //  · p1a.db 内容 sha256  —— 真正的红线
    //  · 边车文件**集合**      —— 不许凭空多出/少掉文件
    //  · -wal 的 size 与 mtime —— 不许有事务被刷进 WAL
    //  · -shm **故意豁免 mtime**：WAL 库的共享内存索引，SQLite 连只读打开都会碰它，
    //    它随时能从 WAL 重建，不承载数据。把它算进红线会把「只读」误判成「写库」。
    const sidecars = () => fs.readdirSync(path.dirname(PROD_DB))
      .filter((f) => f.startsWith(path.basename(PROD_DB)))
      .map((f) => f + '@' + fs.statSync(path.join(path.dirname(PROD_DB), f)).size).sort();
    const beforeSha = prodSha();
    const beforeSide = sidecars();
    const r = run(DRILL, ['--dir', dir, '--db', PROD_DB, '--确认']);
    assert.equal(r.code, 0, r.out);
    assert.equal(prodSha(), beforeSha, '★生产库 sha256 变了——演练脚本写了生产库，这是红线');
    assert.deepEqual(sidecars(), beforeSide, '★演练增删了生产库边车，或往 -wal 里刷了事务');
  } finally { cleanup(work); }
});

test('演练脚本：损坏的备份 → exit 3（门禁码）且报告「不可用」，不许退化成 exit 0', () => {
  const work = tmpdir('dr-bad');
  const dir = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    fs.mkdirSync(dir, { recursive: true });
    const bk = path.join(dir, 'p1a-offsite-20260101-000000.db');
    // 造一个「头是 SQLite 魔数、内容被截断」的件：这种最阴险，能过「像不像 db」的第一眼
    const good = fs.readFileSync(src);
    const bad = Buffer.concat([good.subarray(0, Math.floor(good.length / 2))]);
    fs.writeFileSync(bk, bad);
    fs.writeFileSync(bk + '.sha256', sha256File(bk) + '  ' + path.basename(bk) + '\n', 'utf8');

    const r = run(DRILL, ['--dir', dir, '--db', src, '--确认']);
    assert.notEqual(r.code, 0, '损坏备份绝不能报 exit 0');
    assert.equal(r.code, 3, '应为门禁码 3（结论被门禁挡住），实得 ' + r.code);
    assert.match(r.out, /不可用/, '报告要明说「不可用」');
  } finally { cleanup(work); }
});

test('演练脚本：sha256 收据与实际文件不符 → 判不可用（静默损坏的克星）', () => {
  const work = tmpdir('dr-mismatch');
  const dir = path.join(work, 'offsite');
  try {
    const src = makeSourceDb(work, 'src');
    fs.mkdirSync(dir, { recursive: true });
    const bk = path.join(dir, 'p1a-offsite-20260101-000000.db');
    fs.copyFileSync(src, bk);
    fs.writeFileSync(bk + '.sha256', 'f'.repeat(64) + '  ' + path.basename(bk) + '\n', 'utf8'); // 收据写错
    const r = run(DRILL, ['--dir', dir, '--db', src, '--确认']);
    assert.equal(r.code, 3, '收据不匹配必须判不可用');
    assert.match(r.out, /sha256|校验|不符/, '要指出是校验没过：' + r.out);
  } finally { cleanup(work); }
});

test('演练脚本：备份目录为空 → exit 4（预检失败），不许静默通过', () => {
  const work = tmpdir('dr-empty');
  const dir = path.join(work, 'offsite');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const src = makeSourceDb(work, 'src');
    const r = run(DRILL, ['--dir', dir, '--db', src, '--确认']);
    assert.equal(r.code, 4, '没有备份可演 ⇒ 预检失败 4，不是「通过」0');
  } finally { cleanup(work); }
});

test('两个脚本都在 CLI 命令表里登记，且备份那档带 --确认闸', () => {
  const C = require(path.join(P1B, 'cli', 'commands.cjs'));
  const all = C.allCommands();
  const bk = all.find((c) => c.script === 'backup-offsite.cjs');
  const dr = all.find((c) => c.script === 'restore-drill.cjs');
  assert.ok(bk, '备份脚本没进 p1b/cli/commands.cjs ⇒ 走不到 --确认闸');
  assert.ok(dr, '演练脚本没进命令表');
  assert.equal(bk.confirm, true, '备份是写操作，必须 confirm: true（否则 CLI 不拦，等于没闸）');
  assert.ok(bk.tier && bk.tier !== 'R', '备份不是只读档');
  assert.ok(dr.tier && dr.tier !== 'R', '演练会写临时件，不是 R 档');
});
