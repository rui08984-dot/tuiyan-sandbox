'use strict';
/**
 * p1b/test/cli.test.cjs —— P1b 预测侧薄 CLI 冒烟测试（2026-09-27）
 *
 * 只验三件事，**不测业务读数**（读数对不对是那些脚本自己的收据管的）：
 *   ① **只读默认**：F 档命令跑完，`p1b/sim/out/` 的 (文件名, mtimeMs) 目录快照与
 *      `docs/specs/kind-目录表.md` 的 sha256 **双双逐位不变**。
 *      为什么快照**整目录**而不是单文件：本仓已有 12 个测试文件在 `p1b/sim/out` 上取目录
 *      快照（`e2-combo-precheck.test.cjs:110` 是同款 `readdir+stat` 快照），只查一个文件
 *      挡不住「另一个文件被顺带覆盖」这种竞态。
 *   ② **确认闸**：写 `p1a.db` 的命令不给 `--确认` ⇒ exit 2 且**子进程一次都没起**。
 *   ③ **门禁码透出**：子进程 exit 3 必须原样透出，CLI 不得抹平成 1。
 *      3 是本项目最核心的防 Goodhart 设计的载体（`anchor-gate.cjs:209` 候选 0 条不许被读成
 *      「通过」；`e2-r1-rules.cjs:122` 冻结件 sha 不 MATCH 就要停）—— 抹平了这条设计就废了。
 *
 * **零网络、零写库**：三条用例跑的命令分别是「只写 .scratch/cli/ 的 F 档」「被闸拦下的
 * 写库命令」「喂空候选文件的只读门禁件」，没有一个真打网或真写生产库。
 *
 * **spawn 绝不 require p1b/scripts 下的脚本**（`scripts-require-safety.test.cjs:40` 的口径：
 * 测试里出现「`const <名> = path.join(ROOT, 'p1b', 'scripts', '<x>.cjs')` 且同文件再
 * 模块加载它」这一对同形字样即算命中）——本文件对 p1b/cli 只 spawn CLI 本身、
 * 对 p1b/scripts 连模块加载都不做。
 * ★**本段注释刻意不写出那条正则的完整字面量**：那个检测是纯文本扫描，谁在注释里
 * 照抄一遍同形样例，谁就会被当成「require 了一个不存在的脚本」而打红（本件 2026-09-27
 * 首次落地时正是这么打红的，`scripts-require-safety.test.cjs:61` 报「测试引用了不存在的
 * 脚本」）。同族可参 `scripts-require-safety.test.cjs:19` 自己的 `SELF` 跳过写法。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI_DIR = path.join(ROOT, 'p1b', 'cli');
const CLI = path.join(CLI_DIR, 'index.cjs');
const SCRIPTS = path.join(ROOT, 'p1b', 'scripts');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const KIND_MD = path.join(ROOT, 'docs', 'specs', 'kind-目录表.md');
const PROD_DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const CLI_OUT = path.join(ROOT, '.scratch', 'cli');

/** 跑一次 CLI，捕获全部输出与退出码。 */
function runCli(args) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}

/** 目录快照：照 `e2-combo-precheck.test.cjs:110` 的同款口径（文件名 + mtimeMs）。 */
function snapDir(dir) {
  return fs.readdirSync(dir).sort().map((f) => f + ':' + fs.statSync(path.join(dir, f)).mtimeMs).join('\n');
}
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

test('① F 档命令不得写 p1b/sim/out，也不得覆盖 docs/specs/kind-目录表.md', () => {
  // F 档五条（写盘不写库）。跑之前记快照，跑之后逐位比对。
  const F_CMDS = [['读数', '列'], ['读数', '校准'], ['读数', '判词离散度'], ['读数', 'kind目录'], ['门禁', '抽检清单']];
  const dir0 = snapDir(SIMOUT);
  const kind0 = sha256(KIND_MD);
  const db0 = fs.statSync(PROD_DB).size + ':' + fs.statSync(PROD_DB).mtimeMs;

  for (const c of F_CMDS) {
    const r = runCli(c);
    assert.equal(r.status, 0, c.join(' ') + ' 应 exit 0，实际 ' + r.status + '\n' + r.all);
  }

  assert.equal(snapDir(SIMOUT), dir0, 'F 档命令往 git tracked 的 p1b/sim/out 写了东西');
  assert.equal(sha256(KIND_MD), kind0, 'F 档命令覆盖了 git tracked 的 docs/specs/kind-目录表.md');
  assert.equal(fs.statSync(PROD_DB).size + ':' + fs.statSync(PROD_DB).mtimeMs, db0, 'F 档命令碰了生产库 p1a.db（F 档定义上不许）');

  // 反向确认：产物**确实**落到了 .scratch/cli/（否则上面的「不变」可能只是「压根没产出」的假绿）
  const dirs = fs.existsSync(CLI_OUT) ? fs.readdirSync(CLI_OUT).filter((d) => fs.statSync(path.join(CLI_OUT, d)).isDirectory()) : [];
  assert.ok(dirs.length > 0, '.scratch/cli/ 下应有 F 档产出的时间戳目录');
  const produced = dirs.flatMap((d) => fs.readdirSync(path.join(CLI_OUT, d)));
  assert.ok(produced.some((f) => f === 'kind-目录表.md'), 'kind 目录的产物应被改道到 .scratch/cli/，实得：' + produced.join(','));
  assert.ok(produced.some((f) => /^calibration-report-.*\.json$/.test(f)), '校准报告的产物应被改道到 .scratch/cli/');
  assert.ok(produced.some((f) => /^g2-audit-review\.tsv$/.test(f)), '抽检清单的产物应被改道到 .scratch/cli/');
});

test('② 默认只读：写库命令无 --确认 ⇒ exit 2 且子进程未启动', () => {
  const st = () => { const s = fs.statSync(PROD_DB); return s.size + ':' + s.mtimeMs; };
  const db0 = st();
  const r = runCli(['结算', '语料']);

  assert.equal(r.status, 2, '缺 --确认 应 exit 2，实际 ' + r.status + '\n' + r.all);
  assert.match(r.stderr, /未执行/, '必须明说「未执行」');
  assert.match(r.stderr, /将要执行：node p1b\/scripts\/corpus-resolve\.cjs/, '必须打印「将要执行什么」');
  assert.match(r.stderr, /--确认/, '必须告诉用户怎么确认');
  // 「子进程未起」的三条独立证据（任一条被绕过就说明闸漏了）：
  //   a) 子进程第一行输出恒为 `corpus pending rows: …`（实测）⇒ stdout 里没有它 = 没起
  //   b) stderr 里只有 CLI 自己的计划行，没有子进程的行
  //   c) 生产库 (size, mtimeMs) 逐位不变（子进程一启动就会以读写方式打开它）
  assert.doesNotMatch(r.stdout, /corpus pending rows/, '子进程疑似被启动了（stdout 出现了它的输出）');
  assert.doesNotMatch(r.all, /corpus pending rows/, '子进程疑似被启动了');
  assert.equal(st(), db0, '生产库被触碰了');
});

test('③ 子进程 exit 3 原样透出（门禁码不许被抹平成 1）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-cli-'));
  try {
    const f = path.join(tmp, 'empty-candidates.json');
    fs.writeFileSync(f, JSON.stringify({ candidates: [], note: 'CLI 自测：空候选' }), 'utf8');
    const r = runCli(['门禁', '锚点', f]);
    assert.equal(r.status, 3, 'anchor-gate 候选 0 条应 exit 3 并被原样透出，实际 ' + r.status + '\n' + r.all);
    assert.match(r.all, /exit 3/, '应能看到门禁码的来源说明');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('④ 帮助面自洽：命令表里的脚本都存在，两件 _ 辅助件不在列', () => {
  const C = require(path.join(CLI_DIR, 'commands.cjs'));   // 纯数据模块（无 db / 无写盘）
  const all = C.allCommands();
  assert.ok(all.length >= 15, '第一批命令数应 ≥15，实得 ' + all.length);

  for (const c of all) {
    assert.ok(fs.existsSync(path.join(SCRIPTS, c.script)), '命令「' + c.zh + '」指向的脚本不存在：p1b/scripts/' + c.script);
    assert.ok(['R', 'F', 'W'].includes(c.tier), '命令「' + c.zh + '」的档位非法：' + c.tier);
  }

  // 显式排除件：必须在 EXCLUDED 里，且**不得**出现在命令表里
  const names = new Set(all.map((c) => c.script));
  for (const [n, why] of C.EXCLUDED) {
    assert.ok(!names.has(n), '排除件 ' + n + ' 又被收进命令表了（理由：' + why + '）');
    assert.ok(fs.existsSync(path.join(SCRIPTS, n)) || n === '_rollback-template.cjs', '排除件 ' + n + ' 在 p1b/scripts 下找不到，EXCLUDED 该更新');
  }
  assert.ok(names.has('_b1-matures-audit.cjs'), '「欠账」应包 _b1-matures-audit.cjs（只读、零参、readonly 连接）');
  assert.ok(!names.has('_sqlite-guard.cjs') && !names.has('_rollback-template.cjs'), '两件 _ 辅助件不得进表');

  // 顶层帮助必须把每条命令和每件排除件都列出来（否则「为什么没有它」无人可答）
  const h = runCli(['--help']);
  assert.equal(h.status, 0, '--help 应 exit 0');
  for (const c of all) assert.ok(h.stdout.includes(c.zh), '--help 未列出命令「' + c.zh + '」');
  for (const [n] of C.EXCLUDED) assert.ok(h.stdout.includes(n), '--help 未列出排除件 ' + n);
  for (const g of C.GROUPS) {
    const gh = runCli([g.zh, '--help']);
    assert.equal(gh.status, 0, g.zh + ' --help 应 exit 0');
    for (const c of g.commands) assert.ok(gh.stdout.includes(c.zh), g.zh + ' --help 未列出「' + c.zh + '」');
  }
});

test('⑤ 路由面：组名 / 英文别名 / 单段式 / 未知命令的退出码', () => {
  assert.equal(runCli([]).status, 0, '零参应打用法并 exit 0');
  assert.equal(runCli(['--help']).status, 0);
  assert.equal(runCli(['体检', '--help']).status, 0);
  assert.equal(runCli(['体检', '看板', '--help']).status, 0);

  assert.equal(runCli(['体检', '瞎写']).status, 2, '组内错命令 = 用法错(2)');
  assert.equal(runCli(['完全不存在']).status, 1, '未知命令 = CLI 错(1)');
  assert.equal(runCli(['门禁', '锚点']).status, 2, '缺位置参数 = 用法错(2)');

  // 单段式（组名可省）与英文组名同义
  const a = runCli(['看板', '--help']);
  const b = runCli(['体检', '看板', '--help']);
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout, '单段式与两段式的帮助应完全一致');
  assert.equal(runCli(['doctor', '看板', '--help']).stdout, b.stdout, '英文组名 doctor 应等价于 体检');
  assert.equal(runCli(['read', 'G2门', '--help']).status, 0);
  assert.equal(runCli(['audit', '契约', '--help']).status, 0);
});
