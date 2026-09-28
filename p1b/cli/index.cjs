'use strict';
/**
 * p1b/cli/index.cjs —— P1b 预测侧薄 CLI **入口**（零第三方依赖，纯 process.argv 路由）
 *
 * 用法（组 + 命令，两段式；命令名单独出现时也能解析，见 `resolveCommand`）：
 *   node p1b/cli 体检 看板
 *   node p1b/cli 读数 G2门 -- --json .scratch/cli/x/g2.json
 *   node p1b/cli 门禁 锚点 .scratch/p37/i1-candidates.json
 *   node p1b/cli --help
 *   node p1b/cli 读数 校准 --help
 *
 * 英文组名同义：doctor / settle / read / audit。
 *
 * ── 退出码（**以 p1b 侧 0-5 为准，不是 p1a 侧的 0/1/2**）────────────────────
 *   0  成功
 *   1  CLI 的一般错误（未知命令 / 组名、spawn 失败）
 *   2  用法错（缺位置参数、缺 `--确认`、命令自带用法错）
 *   3  ★门禁码：**子进程 exit 3 原样透出**。这不是「错误」，是项目最核心的防 Goodhart
 *      设计在说话——`anchor-gate.cjs:209`（候选 0 条 ⇒ 不许被读成「通过」）、
 *      `e2-r1-rules.cjs:122`（冻结件 sha 不 MATCH ⇒ 停）、`file-map.cjs:184`（产物含 NUL）。
 *      **CLI 绝不抹平它**。同理 p1a `cli.js:16` 的「2=用户放弃」与 p1b 的「2=用法错」语义
 *      冲突，参照时只借它的**形态**（USAGE 数组 + route(argv) switch），不借它的码表。
 *   4  预检失败（子脚本文件不存在 / 指向了被排除件）
 *   其它：子进程的非零码**原样透出**（如 `prereg-freeze.cjs` 的 3/4、daemon 的 2）
 *
 * ── 为什么「原样透出」是硬要求 ─────────────────────────────────────────────
 *   本项目有多个「用退出码承载结论」的件：门禁不过就是 3。把它们抹平成 1，等于把
 *   「防空集被读成通过」和「普通报错」归成同一类，CI 与人都再也分不出来。
 *
 * ── 确认闸（默认只读）────────────────────────────────────────────────────
 *   凡 `tier=W`（会写 `p1a.db`）的命令，**必须**显式 `--确认`（英文 `--confirm` 同义）
 *   才 spawn。否则打印「将要执行什么」并 exit 2，**子进程一次都不起**。
 *   `tier=F` 只往 `.scratch/cli/<时间戳>/` 写，永不入库，不需要确认。
 *
 * ── 参数分流 ─────────────────────────────────────────────────────────────
 *   组名/命令名之后、下一个独立 `--` 之前的 token = **位置参数**（按命令表的 `pos` 消费）；
 *   `--` 之后的全部 token = **原样透传**给子脚本（子脚本自己的开关一律走这里）。
 *   本 CLI 自己的开关只有两个：`--确认`/`--confirm`、`--help`/`-h`/`help`。
 *
 * 零依赖：不 require 任何第三方包；对 `p1b/scripts/` 只 spawn 不 require
 * （`p1b/test/scripts-require-safety.test.cjs:40` 的口径）。
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const C = require('./commands.cjs');

const EXIT = { OK: 0, ERR: 1, USAGE: 2, GATE: 3, PRECHECK: 4 };

/** 终端显示宽度（CJK 全角算 2 列）——命令表里有中文，pad 不准会歪。 */
function strWidth(s) {
  return [...String(s)].reduce((n, ch) => {
    const cp = ch.codePointAt(0);
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e && cp !== 0x303f)
      || (cp >= 0x3041 && cp <= 0x33ff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff)
      || (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
      || (cp >= 0x20000 && cp <= 0x3fffd);
    return n + (wide ? 2 : 1);
  }, 0);
}

/** 一行命令摘要，供表格与帮助复用。 */
function line(c, width) {
  const pad = (s, n) => s + ' '.repeat(Math.max(2, n - strWidth(s)));
  return '  ' + pad(c.zh, width) + pad(C.tierLabel(c), 18) + c.desc;
}
/** 组别名去重后拼串（`key` 通常也在 `alias` 里，别打两遍）。 */
function aliasText(g) {
  return Array.from(new Set([g.key].concat(g.alias || []))).join('/');
}

function topUsage() {
  const L = [];
  L.push('P1b 预测侧薄 CLI —— 体检 / 结算 / 读数 / 门禁');
  L.push('');
  L.push('用法: node p1b/cli <组> <命令> [位置参数…] [-- 透传给子脚本的参数…]');
  L.push('      node p1b/cli <命令>            （命令名全局唯一时可省组名）');
  L.push('      node p1b/cli --help            （本表）');
  L.push('      node p1b/cli <组> <命令> --help （单条命令的用法与只读性）');
  L.push('');
  L.push('默认只读：写 p1a.db 的命令必须显式 --确认（或 --confirm），否则只打印「将要执行什么」并退出。');
  L.push('F 档（写盘不写库）的产物一律落 .scratch/cli/<时间戳>/，不入 p1b/sim/out、不入 docs/specs/。');
  L.push('退出码: 0 成功｜1 CLI 错｜2 用法错（含缺 --确认）｜3 门禁码（原样透出，勿抹平）｜4 预检失败｜其它=子进程原码');
  L.push('');
  for (const g of C.GROUPS) {
    L.push('【' + g.zh + '】 ' + g.desc + '　（别名 ' + aliasText(g) + '）');
    const w = Math.max(...g.commands.map((c) => strWidth(c.zh)));
    for (const c of g.commands) L.push(line(c, w));
    L.push('');
  }
  L.push('档位: R 只读（零写盘/零写库/零网络）｜F 写盘不写库（只落 .scratch/cli/）｜W 写 p1a.db｜N 打网络');
  L.push('');
  L.push('显式排除件（不在表内，理由随附）：');
  for (const [n, why] of C.EXCLUDED) L.push('  ' + n + ' —— ' + why);
  return L.join('\n');
}

function groupUsage(g) {
  const L = [];
  L.push('【' + g.zh + '】' + g.desc + '　别名 ' + aliasText(g));
  L.push('');
  const w = Math.max(...g.commands.map((c) => strWidth(c.zh)));
  for (const c of g.commands) L.push(line(c, w));
  L.push('');
  L.push('单条用法：node p1b/cli ' + g.zh + ' <命令> --help');
  return L.join('\n');
}

function commandUsage(c) {
  const L = [];
  L.push('node p1b/cli ' + c.group.zh + ' ' + c.zh + (c.pos && c.pos.length ? ' ' + c.pos.map((p) => '<' + p.name + '>').join(' ') : '') + ' [-- 透传参数…]');
  L.push('');
  L.push('  ' + c.desc);
  L.push('  子脚本：p1b/scripts/' + c.script);
  L.push('  档位　：' + C.tierLabel(c) + (c.tier === 'R' ? '（CLI 不注入任何写参数）' : c.tier === 'F' ? '（产物只落 .scratch/cli/<时间戳>/，不写 p1a.db）' : '（★写生产账本 p1a.db，必须 --确认）'));
  if (c.net) L.push('  网络　：会打外部数据源（离线环境慎跑）');
  if (c.pos && c.pos.length) for (const p of c.pos) L.push('  位置参数 <' + p.name + '>：' + p.desc);
  if (c.confirm) L.push('  确认闸：加 --确认（或 --confirm）才会真的执行；不加则打印将要执行的命令并 exit 2（子进程不起）');
  if (c.build && c.tier === 'F') L.push('  注入　：CLI 自动补写盘路径参数，指向 .scratch/cli/<时间戳>/（可再用 -- 覆盖）');
  if (c.writes) L.push('  写到　：' + c.writes);
  if (c.tier === 'R') L.push('  提醒　：R 档不含写参数，但若你在 -- 之后透传 ' + C.WRITE_FLAGS.join(' / ') + '，子脚本会开始写盘——CLI 只提醒不拦（薄包装原则）');
  return L.join('\n');
}

/**
 * 命令解析：先试「组 + 命令」两段式，再试「命令名单段式」（Z·收口的验收写法
 * `node p1b/cli 欠账` / `node p1b/cli 看板` 就是单段式）。
 * 单段式命中不唯一时列出候选并 exit 2，绝不猜。
 */
function resolveCommand(a, b) {
  const g = C.findGroup(a);
  if (g) {
    if (!b || b === '--help' || b === '-h' || b === 'help') return { group: g, cmd: null };
    const c = C.findCommand(g, b);
    return c ? { group: g, cmd: c } : { group: g, cmd: null, bad: b };
  }
  const hits = C.allCommands().filter((c) => c.zh === a || c.key === a);
  if (hits.length === 1) return { group: hits[0].group, cmd: hits[0], implicit: true };
  if (hits.length > 1) return { group: null, cmd: null, ambiguous: hits };
  return { group: null, cmd: null, unknown: a };
}

function stamp() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function isHelpTok(t) { return t === '--help' || t === '-h' || t === 'help'; }

/**
 * 「到期口径契约覆盖表」——`体检 欠账` 的表头部分。
 *
 * 数据源＝A 阶段落的纯件 `p1b/src/evidence/dueBranches.js`（只读契约文件、零 db、零写盘）。
 * ★**本函数只打印它已导出的 `PAIRS` / `DERIV_BY_PAIR` / `UNIMPLEMENTED`，不复制它的判定逻辑**：
 * 「某个 kind 到底推不推得出到期」由 `dueOf` 现场断言，断言在
 * `p1b/test/corpus-resolve-dueof.test.cjs` 第 ⑧ 例（跑法 `node --test p1b/test/corpus-resolve-dueof.test.cjs`）。
 * A 件缺失/改名时**降级提示、不报错**（CLI 的第一职责是能跑，不是替 A 件做依赖）。
 */
function printCoverage() {
  let B;
  try { B = require(path.join(C.ROOT, 'p1b', 'src', 'evidence', 'dueBranches.js')); }
  catch (e) {
    process.stderr.write('[p1b] 契约覆盖表：p1b/src/evidence/dueBranches.js 不可用（' + e.message + '）⇒ 跳过表头，只跑欠账审计。\n');
    return;
  }
  const L = [];
  L.push('── 到期口径 · 契约覆盖表（登记源 g2-contract-frozen-r4.json 的 date_derivations，sha 锁）──');
  for (const p of B.PAIRS) L.push('  ' + p + '  →  ' + B.DERIV_BY_PAIR[p].join(', '));
  const un = B.UNIMPLEMENTED || {};
  const unKeys = Object.keys(un);
  L.push('  组数 ' + B.PAIRS.length + '｜kind 合计 ' + B.PAIRS.reduce((n, p) => n + B.DERIV_BY_PAIR[p].length, 0)
    + '｜显式登记未实现 ' + unKeys.length + (unKeys.length ? '：' + unKeys.join(', ') : ''));
  L.push('  （「推不推得出」的判定在 dueOf 的覆盖断言里，本表只登记契约侧分组）');
  process.stderr.write(L.join('\n') + '\n');
}

function main(argv) {
  if (!argv.length) { process.stdout.write(topUsage() + '\n'); return EXIT.OK; }
  if (isHelpTok(argv[0])) { process.stdout.write(topUsage() + '\n'); return EXIT.OK; }

  const confirmed = argv.some((t) => t === '--确认' || t === '--confirm');
  const a = argv[0];
  const b = argv[1];

  // ── 「组 --help」/「命令 --help」/「--help」统一在此分流 ──
  if (b !== undefined && isHelpTok(b)) {
    const g = C.findGroup(a);
    if (g) { process.stdout.write(groupUsage(g) + '\n'); return EXIT.OK; }
    const r = resolveCommand(a);
    if (r.cmd) { process.stdout.write(commandUsage(r.cmd) + '\n'); return EXIT.OK; }
    process.stderr.write('✗ 未知命令「' + a + '」\n\n' + topUsage() + '\n');
    return EXIT.ERR;
  }

  const r = resolveCommand(a, b);
  if (r.ambiguous) {
    process.stderr.write('✗ 命令名「' + a + '」不唯一，请带组名：\n' + r.ambiguous.map((c) => '  node p1b/cli ' + c.group.zh + ' ' + c.zh).join('\n') + '\n');
    return EXIT.USAGE;
  }
  if (r.unknown) { process.stderr.write('✗ 未知命令「' + r.unknown + '」\n\n' + topUsage() + '\n'); return EXIT.ERR; }
  if (!r.cmd) {
    process.stderr.write('✗ 组「' + r.group.zh + '」下没有命令「' + (r.bad || '') + '」\n\n' + groupUsage(r.group) + '\n');
    return EXIT.USAGE;
  }
  const c = r.cmd;

  // 位置参数 = 去掉组名/命令名之后、`--` 之前的 token
  const head = r.implicit ? argv.slice(1) : argv.slice(2);
  const sep = head.indexOf('--');
  const pos = sep >= 0 ? head.slice(0, sep) : head.slice(0);
  const passthrough = sep >= 0 ? head.slice(sep + 1) : [];

  if (isHelpTok(pos[0])) { process.stdout.write(commandUsage(c) + '\n'); return EXIT.OK; }
  if ((c.pos || []).length && !pos[0]) {
    process.stderr.write('✗ 缺位置参数：' + c.pos.map((p) => '<' + p.name + '>').join(' ') + '\n\n' + commandUsage(c) + '\n');
    return EXIT.USAGE;
  }

  const scriptPath = path.join(C.SCRIPTS, c.script);
  if (!fs.existsSync(scriptPath)) {
    process.stderr.write('✗ 预检失败：子脚本不存在 p1b/scripts/' + c.script + '\n');
    return EXIT.PRECHECK;
  }

  const outDir = path.join(C.OUT_ROOT, stamp());
  const ctx = { outDir, root: C.ROOT, scripts: C.SCRIPTS, ts: stamp() };

  // ── 确认闸：默认只读。必须**在 spawn 之前**返回，子进程一次都不起 ──
  if (c.confirm && !confirmed) {
    const childArgs = (c.build ? c.build(ctx, pos) : []).concat(passthrough);
    // 写库目标按命令自述：备份这类「只写别处、不碰 p1a.db」的命令若被笼统写成
    // 「写 p1a.db（生产账本）」，用户看到的是一句假话——真到该点确认的时候他就不敢点了。
    const writes = c.writes || 'p1a.db（生产账本）';
    process.stderr.write([
      c.writes ? '✗ 这是写盘命令，默认只读 ⇒ **未执行**（子进程未启动）。' : '✗ 这是写库命令，默认只读 ⇒ **未执行**（子进程未启动）。',
      '  组·命令：' + c.group.zh + ' ' + c.zh + '　档位：' + C.tierLabel(c),
      '  写库　：' + writes + '　打网：' + (c.net ? '是' : '否'),
      '  将要执行：node p1b/scripts/' + c.script + (childArgs.length ? ' ' + childArgs.join(' ') : ''),
      '  确认执行请加：--确认（或 --confirm）',
      '',
    ].join('\n'));
    return EXIT.USAGE;
  }

  // R 档透传了写参数 ⇒ 提醒但不拦
  if (c.tier === 'R') {
    const hit = passthrough.filter((t) => C.WRITE_FLAGS.includes(t));
    if (hit.length) process.stderr.write('[p1b] 提醒：' + hit.join(' ') + ' 会让这个 R 档命令开始写盘（CLI 不拦，薄包装原则）。\n');
  }

  // F 档：暂存目录 + 输入预置（只在真要跑的时候建，不进 --help 路径）
  if (c.tier === 'F') {
    fs.mkdirSync(outDir, { recursive: true });
    if (c.pre) {
      for (const note of c.pre(ctx) || []) process.stderr.write('[p1b] ' + note + '\n');
    }
  }

  // 欠账：先打契约覆盖表（只读、零副作用），再跑子脚本
  if (c.coverage) printCoverage();

  const childArgs = (c.build ? c.build(ctx, pos) : []).concat(passthrough);
  process.stderr.write('[p1b] ' + c.group.zh + ' · ' + c.zh + '　' + C.tierLabel(c)
    + '　→ node p1b/scripts/' + c.script + (childArgs.length ? ' ' + childArgs.join(' ') : '') + '\n');

  const res = spawnSync(process.execPath, [scriptPath].concat(childArgs), {
    cwd: C.ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],   // 子进程零交互（15 条命令全非交互）⇒ stdin 不给
    env: process.env,
  });
  if (res.error) { process.stderr.write('✗ spawn 失败：' + res.error.message + '\n'); return EXIT.ERR; }
  if (res.signal) { process.stderr.write('✗ 子进程被信号 ' + res.signal + ' 终止\n'); return EXIT.ERR; }
  const code = res.status === null ? EXIT.ERR : res.status;
  if (code !== EXIT.OK) {
    process.stderr.write('[p1b] 子进程退出码 ' + code + '（原样透出；3=门禁码，勿抹平）\n');
  }
  return code;
}

if (require.main === module) process.exit(main(process.argv.slice(2)) || 0);

module.exports = { main, topUsage, groupUsage, commandUsage, resolveCommand, EXIT };
