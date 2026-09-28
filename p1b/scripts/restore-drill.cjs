'use strict';
/**
 * p1b/scripts/restore-drill.cjs —— 恢复演练（2026-09-28 · P0-6）
 *
 * 事故背景：80 份备份从没有一次恢复演练记录。「拷了 80 次」和「能救回来」之间隔着
 * 一整条没走过的路：文件有没有截断、SQLite 头对不对、关键表在不在、收据还对不对。
 * 没演练过的备份严格说只是文件。
 *
 * ── 本脚本的边界（红线，先读这段）──────────────────────────────────────
 *   只**读**备份与生产库；只**写** os.tmpdir() 下的临时恢复件。
 *   生产库全程 readonly 打开，脚本里没有任何一句往 --db 写的代码，
 *   并且落临时件前有一道断言：目标路径必须在 tmpdir 下、且不等于源备份与生产库路径。
 *   测试 `backup-offsite-drill.test.cjs` 的「演练绝不碰生产」一例直接拿真实生产库的
 *   sha256 前后对照，把这条红线钉成可执行的断言，而不是靠注释提醒。
 *
 * ── 结论怎么给（为什么 exit 0 是一句断言而不是「跑完了」）──────────────
 *   exit 0 ＝ **这份备份能当保险用**。它要同时满足：收据 sha256 对得上、
 *   `PRAGMA integrity_check` = ok、核心表齐全且行数非零。
 *   任一条不满足 ⇒ exit 3（门禁码，语义与 anchor-gate「不许被读成通过」同族），
 *   报告里写「不可用」并逐条列原因。演练的价值全在这条分界上：
 *   退化成一个「跑完了」的 exit 0，等于给一个假的安全感。
 *   预检失败（目录里根本没有备份）走 exit 4，不和「不可用」混在一起——
 *   「没东西可演」和「演了发现不能用」是两件事。
 *
 * ── 为什么比对行数不够，还要比表内容 sha256 ───────────────────────────
 *   行数相同但内容被换过（静默损坏、错库、过期回填）是很现实的情形。
 *   表级 sha256 把整表按 rowid 顺序喂进哈希，列名排序后序列化 ⇒ 与插入顺序无关、可复算。
 *   同时报告「与当前生产的差距」：备份本来就该比生产旧，差距大不是坏，是让你知道落后多少。
 *
 * 退出码：0 可用｜2 用法错/缺 --确认｜3 门禁码（判不可用）｜4 预检失败
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));

const EXIT = { OK: 0, ERR: 1, USAGE: 2, GATE: 3, PRECHECK: 4 };
const PREFIX = 'p1a-offsite-';

/** 账本骨架：缺任一张即判不可用（没有它们的备份救不回任何东西）。
 *  其余表存在就比、不存在只报，不因此判死——老备份天然没有后来才建的表。 */
const CORE_TABLES = ['predictions', 'events', 'games'];
/** 业务表：存在则比行数与内容 sha256，缺席只记为警告 */
const EXTRA_TABLES = ['verdicts', 'players', 'claims', 'actions', 'truth_vault', 'hypotheses', 'contradictions'];

function safeName(s) { return typeof s === 'string' && /^[A-Za-z0-9_.-]+$/.test(s); }

function parseArgs(argv) {
  const o = { confirm: false, keepTemp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--确认' || a === '--confirm') o.confirm = true;
    else if (a === '--保留临时') o.keepTemp = true;
    else if (a === '--dir') o.dir = argv[++i];
    else if (a === '--db') o.db = argv[++i];
    else if (a === '--pick') o.pick = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else o.unknown = a;
  }
  return o;
}

const USAGE = [
  '用法: node p1b/scripts/restore-drill.cjs --dir <备份目录> [--db <生产库，用于算差距>] [--pick <文件名>] [--确认] [--保留临时]',
  '',
  '  --dir      必填。备份所在目录（默认挑文件名最新的那一份）',
  '  --db       用于报告「与当前生产的差距」；缺省 p1a-terminal/data/p1a.db（只读）',
  '  --pick     指定演练哪一份，缺省取最新',
  '  --确认     真跑。不给就只打印计划并 exit 2（不建临时件、不写任何东西）',
  '  --保留临时 演练完不删临时恢复件（留给人肉翻查）',
  '',
  '退出码：0 这份备份可用｜2 用法错/缺 --确认｜3 判不可用（门禁码）｜4 预检失败',
].join('\n');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** 表级内容 sha256：按 rowid 顺序、列名排序后序列化 ⇒ 与插入顺序无关、可复算 */
function tableDigest(db, table) {
  const cols = db.prepare('PRAGMA table_info("' + table + '")').all().map((c) => c.name).sort();
  let rows;
  try {
    rows = db.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all();
  } catch (e) {
    rows = db.prepare('SELECT * FROM "' + table + '"').all(); // WITHOUT ROWID 表退化为无序，仍可比内容
  }
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(JSON.stringify(r, cols));
  return { n: rows.length, sha: h.digest('hex'), cols: cols.length };
}

function openReadonly(p) {
  return new Database(p, { readonly: true, fileMustExist: true });
}

/** 备份目录里可演练的件；按文件名倒序（时间戳在名里，字典序 == 时间序） */
function listBackups(dir) {
  return fs.readdirSync(dir).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db')).sort().reverse();
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { process.stdout.write(USAGE); return EXIT.OK; }
  if (o.unknown) { process.stderr.write('✗ 未知参数 ' + o.unknown + '\n\n' + USAGE); return EXIT.USAGE; }
  if (!o.dir) { process.stderr.write('✗ 缺 --dir（备份目录必填）\n\n' + USAGE); return EXIT.USAGE; }

  const dir = path.resolve(o.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    process.stderr.write('✗ 预检失败：备份目录不存在 ' + dir + '\n');
    return EXIT.PRECHECK;
  }
  const candidates = listBackups(dir);
  if (!candidates.length) {
    process.stderr.write('✗ 预检失败：' + dir + ' 里没有一份 ' + PREFIX + '*.db ⇒ 无可演练对象。\n');
    return EXIT.PRECHECK;
  }
  const pick = o.pick || candidates[0];
  if (!safeName(pick) || !candidates.includes(pick)) {
    process.stderr.write('✗ --pick 必须是目录里现存的备份文件名，收到 ' + JSON.stringify(o.pick) + '\n可选：' + candidates.join('、') + '\n');
    return EXIT.USAGE;
  }
  const src = path.join(dir, pick);
  const prodPath = path.resolve(o.db || path.join(P1A_ROOT, 'data', 'p1a.db'));
  const srcSize = fs.statSync(src).size;

  // ── 确认闸：必须在任何写动作（哪怕是临时件）之前返回 ──
  if (!o.confirm) {
    process.stderr.write([
      '✗ 这是写操作（会落临时恢复件），默认只读 ⇒ **未执行**（未建临时件、未动任何文件）。',
      '  备份目录：' + dir + '（共 ' + candidates.length + ' 份）',
      '  将演练　：' + pick + '（' + srcSize + ' 字节）',
      '  临时件　：' + path.join(os.tmpdir(), 'p1b-restore-drill-*') + '（跑完即删）',
      '  对照库　：' + prodPath + '（只读，绝不写）',
      '  确认执行请加：--确认（或 --confirm）',
      '',
    ].join('\n'));
    return EXIT.USAGE;
  }

  const problems = [];
  const warns = [];
  const rows = [];
  const L = [];

  // ① 收据校验：静默损坏的克星。有收据就必须对上，对不上直接判不可用。
  const receiptPath = src + '.sha256';
  const actualSha = sha256File(src);
  let receiptSha = null;
  if (fs.existsSync(receiptPath)) {
    const m = fs.readFileSync(receiptPath, 'utf8').match(/[0-9a-f]{64}/i);
    receiptSha = m ? m[0].toLowerCase() : null;
    if (!receiptSha) problems.push('收据 ' + path.basename(receiptPath) + ' 里读不出 64 位 sha256');
    else if (receiptSha !== actualSha) problems.push('sha256 校验不符：收据 ' + receiptSha.slice(0, 12) + '… vs 实测 ' + actualSha.slice(0, 12) + '…（文件在拷贝后被改过或收据是假的）');
  } else {
    warns.push('没有 .sha256 收据，无法核对这份备份拷贝完有没有被动过（老备份属正常）');
  }

  // ② 红线断言：临时件必须在 tmpdir 下，且不等于源备份与生产库。
  //    这三行是「演练绝不碰生产」在代码里的落点，测试另有对生产库 sha256 的前后对照。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-restore-drill-'));
  const tmpFile = path.join(tmpDir, 'restored.db');
  const tmpRoot = path.parse(os.tmpdir()).root.toLowerCase();
  if (!path.resolve(tmpFile).toLowerCase().startsWith(tmpRoot)) problems.push('临时件路径逃出了 tmpdir，红线断言失败');
  if (path.resolve(tmpFile) === path.resolve(prodPath)) problems.push('临时件路径等于生产库，红线断言失败');

  let rest = null, prod = null;
  try {
    fs.copyFileSync(src, tmpFile);

    // ③ SQLite 自体检。open 与 integrity_check 必须在**同一个** try 里：
    //    截断件常常能打开却在 integrity_check 时才炸（SQLite 打开是惰性的），
    //    只包住 open 会让「文件已损坏」这个**发现**从 exit 3 漏成 exit 1（脚本自身报错）——
    //    那正好把「这份备份不能用」说成「脚本坏了」，是最坏的两种误报之一。
    try {
      rest = openReadonly(tmpFile);
      const ic = rest.pragma('integrity_check', { simple: true });
      if (ic !== 'ok') problems.push('PRAGMA integrity_check = ' + ic + '（文件本体已损坏/被截断）');
    } catch (e) {
      problems.push('恢复件不是可用 SQLite 库（打不开或体检没过）：' + (e && e.message ? e.message : String(e)));
      try { if (rest) rest.close(); } catch (e2) { /* ignore */ }
      rest = null;
    }

    if (rest) {
      const present = new Set(rest.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
      // ④ 核心表齐全 + 非空；业务表有则比、无则只记警告
      for (const t of CORE_TABLES) {
        if (!present.has(t)) { problems.push('核心表缺失：' + t); rows.push({ t, n: null, sha: null, state: '缺失' }); continue; }
        try {
          const d = tableDigest(rest, t);
          if (d.n === 0) { problems.push('核心表 ' + t + ' 行数为 0 —— 这份备份救不回任何东西'); rows.push({ t, n: 0, sha: d.sha, state: '空' }); }
          else rows.push({ t, n: d.n, sha: d.sha, state: 'ok' });
        } catch (e) {
          problems.push('核心表 ' + t + ' 读不出来：' + (e && e.message ? e.message : String(e)));
          rows.push({ t, n: null, sha: null, state: '读失败' });
        }
      }
      for (const t of EXTRA_TABLES) {
        if (!present.has(t)) { warns.push('表 ' + t + ' 不在这份备份里（多半是备份当时还没建）'); continue; }
        try { rows.push(Object.assign({ t, state: 'ok' }, tableDigest(rest, t))); }
        catch (e) { warns.push('表 ' + t + ' 读不出来，跳过内容比对：' + (e && e.message ? e.message : String(e))); }
      }

      // ⑤ 与当前生产的差距：备份本来就该比生产旧，差距大不是坏，是「你知道落后多少」
      if (fs.existsSync(prodPath) && path.resolve(prodPath) !== path.resolve(src)) {
        try {
          prod = openReadonly(prodPath);
          for (const r of rows) {
            if (r.state !== 'ok' || !r.sha) continue;
            const has = prod.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(r.t);
            if (!has) { r.drift = '生产已无此表'; continue; }
            const d = tableDigest(prod, r.t);
            r.drift = d.sha === r.sha ? '与生产一致' : (d.n - r.n > 0 ? '落后生产 ' + (d.n - r.n) + ' 行' : '内容与生产不同');
          }
        } catch (e) { warns.push('打不开生产库，跳过差距比对：' + (e && e.message ? e.message : String(e))); }
      }
    }
  } finally {
    try { if (rest) rest.close(); } catch (e) { /* ignore */ }
    try { if (prod) prod.close(); } catch (e) { /* ignore */ }
    if (!o.keepTemp) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  }

  const usable = problems.length === 0;
  L.push('── 恢复演练报告 ──');
  L.push('  备份件　：' + pick + '（' + srcSize + ' 字节）');
  L.push('  实测 sha256：' + actualSha.slice(0, 16) + '…' + (receiptSha ? '　收据 ' + receiptSha.slice(0, 16) + '…' : '　（无收据）'));
  L.push('  临时恢复：' + (o.keepTemp ? tmpFile : '已用后删除（--保留临时 可留）'));
  L.push('  表校验　：');
  for (const r of rows) {
    L.push('    ' + r.t.padEnd(16) + String(r.n === null ? '—' : (r.n + ' 行')).padEnd(12)
      + 'sha ' + (r.sha ? r.sha.slice(0, 12) + '…' : '—').padEnd(14) + (r.drift ? r.drift : r.state === 'ok' ? '' : r.state));
  }
  if (warns.length) { L.push('  提示　：'); for (const w of warns) L.push('    · ' + w); }
  if (problems.length) { L.push('  不通过　：'); for (const p of problems) L.push('    ✗ ' + p); }
  L.push('');
  L.push(usable
    ? '  结论：★ 这份备份可用（能当保险用）。'
    : '  结论：✗ 这份备份不可用 —— ' + problems.length + ' 条不通过，别指望它。');
  process.stdout.write(L.join('\n') + '\n');
  return usable ? EXIT.OK : EXIT.GATE;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) { process.stderr.write('[restore-drill] 未预期错误: ' + (e && e.stack ? e.stack : String(e)) + '\n'); process.exit(EXIT.ERR); }
}

module.exports = { main, parseArgs, tableDigest, listBackups, CORE_TABLES, EXTRA_TABLES, EXIT };
