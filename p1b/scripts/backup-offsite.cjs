'use strict';
/**
 * p1b/scripts/backup-offsite.cjs —— 生产库异地备份（2026-09-28 · P0-6）
 *
 * 事故背景：80 份 .db 备份全在同一块盘的同一目录，无保留策略、无异地、无恢复演练记录。
 * 「同一块盘」这件事的性质是：盘坏了、盘被勒索软件加密了、机器被偷了，三种情况一起丢。
 * 拷贝次数再多也不会让同一块盘上的第二份拷贝更抗风险——**异地不是加法，是换维度**。
 *
 * ── 本脚本刻意做的四件事 ──────────────────────────────────────────────────
 * ① **默认不动手**：不带 --确认 就只打印计划并 exit 2，一个字节都不写（连目标目录都不建）。
 *    理由与 p1b CLI 一致：写操作必须由人显式点头，否则「跑错了」和「跑对了」长得一样。
 * ② **异地是硬约束**：目标与源同盘直接拒（exit 2），除非显式 --allow-same-drive。
 *    理由：一个可以悄悄退化成同盘拷贝的「异地备份脚本」，比没有脚本更危险——
 *    它会在报告里写着「异地」，而实际那份保险和原件一起死。
 * ③ **逐份 sha256**：每份备份旁落一个 .sha256 收据（sha256sum 标准格式，可直接 sha256sum -c）。
 *    理由：备份的价值在「出事那天读得出来」，不在「拷出来了」。没有校验的备份只是文件。
 * ④ **保留最近 N 份**：按文件名倒序（时间戳在名里，字典序 == 时间序）裁剪，收据跟着一起裁。
 *
 * ── 为什么用 SQLite 在线备份 API 而不是 copyFile ─────────────────────────
 * 生产库是 WAL 模式，cp 一个正在写的 .db 只会拿到某个不一致的瞬间（可能缺 -wal 里的事务）。
 * sqlite3_backup API 产出一致快照。这不是洁癖，是「备份能不能用」的前提。
 *
 * 退出码（照 p1b 侧码表，非 p1a 的 0/1/2）：
 *   0 成功｜1 一般错（源库打不开等）｜2 用法错/缺 --确认｜4 预检失败（源库不存在）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
// better-sqlite3 只装在 p1a-terminal/node_modules 下，从 p1b/scripts 直接 require 解析不到，
// 故按绝对路径取（零新依赖：不装新包，只是指到已经在用的那一个）。
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));

const EXIT = { OK: 0, ERR: 1, USAGE: 2, GATE: 3, PRECHECK: 4 };
const PREFIX = 'p1a-offsite-';
const DEFAULT_KEEP = 10;

function stamp(d) {
  const x = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '' + x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate()) + '-' + p(x.getHours()) + p(x.getMinutes()) + p(x.getSeconds());
}

/** 只认字母数字下划线：表名/文件名会进 SQL 与路径，脏字符一律 exit 2 */
function safeName(s) { return typeof s === 'string' && /^[A-Za-z0-9_.-]+$/.test(s); }

function parseArgs(argv) {
  const o = { keep: DEFAULT_KEEP, confirm: false, allowSameDrive: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--确认' || a === '--confirm') o.confirm = true;
    else if (a === '--allow-same-drive') o.allowSameDrive = true;
    else if (a === '--db') o.db = argv[++i];
    else if (a === '--dest') o.dest = argv[++i];
    else if (a === '--keep') o.keep = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else o.unknown = a;
  }
  return o;
}

const USAGE = [
  '用法: node p1b/scripts/backup-offsite.cjs --dest <异地备份目录> [--db <库>] [--keep N] [--确认] [--allow-same-drive]',
  '',
  '  --dest            必填。备份落点，**应位于另一块盘**（同盘会被拒，除非 --allow-same-drive）',
  '  --db              源库；缺省 p1a-terminal/data/p1a.db',
  '  --keep N          保留最近 N 份，默认 ' + DEFAULT_KEEP + '（须为 ≥1 的整数）',
  '  --确认            真跑。不给就只打印计划并 exit 2',
  '  --allow-same-drive  显式承认目标与源同盘（例：只有一个盘时的临时兜底）',
  '',
].join('\n');

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { process.stdout.write(USAGE); return EXIT.OK; }
  if (o.unknown) { process.stderr.write('✗ 未知参数 ' + o.unknown + '\n\n' + USAGE); return EXIT.USAGE; }
  if (!o.dest) { process.stderr.write('✗ 缺 --dest（备份落点必填）\n\n' + USAGE); return EXIT.USAGE; }

  const dbPath = path.resolve(o.db || path.join(P1A_ROOT, 'data', 'p1a.db'));
  const dest = path.resolve(o.dest);
  const driveOf = (p) => path.parse(p).root.replace(/[\\/]+$/, '').toLowerCase();

  // keep 必须先校：--keep 0 会把备份全删光，这种「合法解析出来但危险」的值不该走到裁剪那步
  const keep = Number(o.keep);
  if (!Number.isInteger(keep) || keep < 1) {
    process.stderr.write('✗ --keep 必须是 ≥1 的整数，收到 ' + JSON.stringify(o.keep) + '（0/-1 会把备份删光）\n');
    return EXIT.USAGE;
  }
  if (!fs.existsSync(dbPath)) {
    process.stderr.write('✗ 预检失败：源库不存在 ' + dbPath + '\n');
    return EXIT.PRECHECK;
  }
  if (!o.allowSameDrive && driveOf(dbPath) === driveOf(dest)) {
    process.stderr.write([
      '✗ 目标与源在同一块盘（' + driveOf(dbPath) + '）⇒ 拒绝。',
      '  理由：同盘的两份拷贝在「盘坏/被加密/机器被偷」面前是同时死的，异地备份不是加法而是换维度。',
      '  只有一个盘时的临时兜底：加 --allow-same-drive（报告会如实标注这是同盘）。',
      '  源：' + dbPath,
      '  目标：' + dest,
    ].join('\n') + '\n');
    return EXIT.USAGE;
  }

  const name = PREFIX + stamp() + '.db';
  const destFile = path.join(dest, name);
  const srcSize = fs.statSync(dbPath).size;

  // ── 确认闸：必须在任何写动作之前返回，包括 mkdir ──
  if (!o.confirm) {
    process.stderr.write([
      '✗ 这是写操作，默认只读 ⇒ **未执行**（未建目录、未拷贝、未删任何东西）。',
      '  源库　：' + dbPath + '（' + srcSize + ' 字节）',
      '  落点　：' + dest,
      '  盘符　：' + driveOf(dbPath) + ' → ' + driveOf(dest) + (driveOf(dbPath) === driveOf(dest) ? '（同盘，已被上面拒掉）' : '（异地 ✔）'),
      '  将产出：' + name + ' + ' + name + '.sha256（逐份校验收据）',
      '  保留　：最近 ' + keep + ' 份，超出连同收据一并裁掉',
      '  确认执行请加：--确认（或 --confirm）',
      '',
    ].join('\n'));
    return EXIT.USAGE;
  }

  fs.mkdirSync(dest, { recursive: true });

  // 在线备份：WAL 模式下唯一能拿到一致快照的路径
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    await db.backup(destFile);
  } catch (e) {
    process.stderr.write('✗ 备份失败：' + (e && e.message ? e.message : String(e)) + '\n');
    return EXIT.ERR;
  } finally {
    try { if (db) db.close(); } catch (e) { /* ignore */ }
  }

  // 逐份 sha256：拷完立刻算，落成可离线核对的收据
  const sha = crypto.createHash('sha256').update(fs.readFileSync(destFile)).digest('hex');
  fs.writeFileSync(destFile + '.sha256', sha + '  ' + name + '\n', 'utf8');

  // 保留最近 N 份。文件名内含时间戳 ⇒ 字典序 == 时间序，倒序第 keep 名之后的一律裁掉。
  const all = fs.readdirSync(dest).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db')).sort().reverse();
  const drop = all.slice(keep);
  for (const f of drop) {
    fs.rmSync(path.join(dest, f), { force: true });
    fs.rmSync(path.join(dest, f + '.sha256'), { force: true }); // 收据必须跟着走，否则留下孤儿收据比没有更误导
  }

  const outSize = fs.statSync(destFile).size;
  const lines = [
    '✔ 异地备份完成',
    '  产出　：' + destFile + '（' + outSize + ' 字节，源 ' + srcSize + '）',
    '  sha256：' + sha,
    '  收据　：' + destFile + '.sha256',
    '  盘符　：' + driveOf(dbPath) + ' → ' + driveOf(dest) + (driveOf(dbPath) === driveOf(dest) ? '　⚠ 同盘（--allow-same-drive）' : '（异地）'),
    '  现存　：' + Math.max(0, all.length - drop.length) + ' 份（保留上限 ' + keep + '）',
  ];
  if (drop.length) lines.push('  已裁掉：' + drop.join('、'));
  lines.push('  下一步：node p1b/scripts/restore-drill.cjs --dir ' + dest + ' --确认　← 别跳过，备份不验等于没备');
  process.stdout.write(lines.join('\n') + '\n');
  return EXIT.OK;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => {
    process.stderr.write('[backup-offsite] 未预期错误: ' + (e && e.stack ? e.stack : String(e)) + '\n');
    process.exit(EXIT.ERR);
  });
}

module.exports = { main, parseArgs, stamp, PREFIX, DEFAULT_KEEP, EXIT };
