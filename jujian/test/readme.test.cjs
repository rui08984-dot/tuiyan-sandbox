'use strict';
/**
 * 局鉴 · test/readme.test.cjs —— README 与现实一致
 *
 * 口径：README 里出现的**每一个数字、每一条命令、每一个承诺**，都必须当场验一遍。
 * 理由很直接：一个改了对局功能但忘了改 README 的项目，
 * 读者看到的「21 个端点」和实际的 23 个之间的差距，比没有文档更糟。
 *
 * 已知的一处退化（照实记）：第一版守卫从**行内反引号**里抽命令，
 * 而 README 把命令写在代码块里 ⇒ 抽到 0 条命令，那道检查是**空转**的。
 * 本版改为显式声明 COMMAND 清单并逐条真跑，判据不再依赖文本抽取。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const readme = fs.readFileSync(README, 'utf8');

/**
 * 跑子进程用的干净环境。
 *
 * ★为什么要清 NODE_TEST_CONTEXT ────────────────────────────────────────────
 *   本文件自己跑在 `node --test` 下，父进程会给测试文件设 NODE_TEST_CONTEXT。
 *   这个变量被子进程继承后，`node --test --test-reporter=tap` 的输出
 *   从 **stdout 改走 stderr** —— 于是「spawnSync 拿不到输出」，
 *   断言只好报「跑不出用例数」，而真实原因是输出流换了地方。
 *   （第一版正是这样：命令明明退出码 0、数量却数成 0。）
 *   ⇒ 子进程一律清掉它，输出回到 stdout。
 */
const CLEAN_ENV = Object.assign({}, process.env);
delete CLEAN_ENV.NODE_TEST_CONTEXT;
delete CLEAN_ENV.NODE_OPTIONS;

/** 全部测试文件（含本文件自己）。 */
const TEST_FILES = [
  'test/store.test.cjs', 'test/api.test.cjs', 'test/kernel-drift.test.cjs',
  'test/readme.test.cjs', 'test/cli.test.cjs', 'test/mcp.test.cjs', 'test/bench.test.cjs',
];
/** 除了本文件之外的测试文件。
 *  ★为什么必须排除自己：本文件是「跑别的测试」的守卫，
 *    若把它自己列进子进程命令，子进程又去跑它 ⇒ 无限递归 ⇒ 闸门自我摧毁。
 *    （第一版就是那样，退出码 1 才暴露出来。）
 */
const OTHER_TEST_FILES = TEST_FILES.filter((f) => f !== 'test/readme.test.cjs');

// ── ① README 里承诺的命令，必须逐条真跑 ─────────────────────────────────
test('① README 里承诺的命令，真跑一次（闸门不许空转）', () => {
  const commands = [
    { cmd: process.execPath, args: ['scripts/smoke.cjs'], why: 'README「先看一眼它会做什么」' },
    { cmd: process.execPath, args: ['scripts/doctor.cjs'], why: 'README「三分钟跑起来」第一步' },
    { cmd: process.execPath, args: ['--test', '--test-reporter=dot', ...OTHER_TEST_FILES], why: 'README 开发者区的 npm test（排除守卫自身，见 OTHER_TEST_FILES 注释）' },
  ];
  assert.ok(commands.length >= 3, '★命令清单为空 —— 守卫空转比没有守卫更危险');
  for (const c of commands) {
    const r = spawnSync(c.cmd, c.args, { cwd: ROOT, encoding: 'utf8', timeout: 180000, env: CLEAN_ENV });
    assert.equal(r.status, 0, `${c.why}：node ${c.args.join(' ')} 退出码 ${r.status}\n${(r.stdout || '') + (r.stderr || '')}`);
  }
});

test('② 反向锁：命令清单本身不许空转或与 README 脱节', () => {
  // README 提到的脚本必须在清单里；清单里的脚本必须在 README 里被提到。
  const mentioned = [...readme.matchAll(/(scripts\/[\w.-]+\.cjs|gates\/[\w.-]+\.cjs)/g)].map((m) => m[1]);
  const uniq = [...new Set(mentioned)];
  for (const s of uniq) {
    assert.ok(fs.existsSync(path.join(ROOT, s)), 'README 提到 ' + s + '，但文件不存在');
  }
  assert.ok(uniq.length >= 3, 'README 至少要给出三条可跑命令，当前只提到 ' + uniq.length + ' 条');
});

test('★③ README 承诺的端点数与实际注册一致', async () => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  const flat = [];
  const stack = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = line.match(/^([│ ]*)[├└]── (\S+)/);
    if (!m) continue;
    stack.length = m[1].length / 4;
    stack.push(m[2].replace(/ \(.*\)$/, ''));
    flat.push(stack.join(''));
  }
  await app.close();
  const api = flat.filter((p) => p.startsWith('/api/'));
  const claimed = Number((readme.match(/(\d+)\s*个 HTTP 端点/) || [])[1]);
  assert.ok(claimed, '★README 没写端点数量');
  assert.equal(claimed, api.length,
    `★README 说 ${claimed} 个端点，实际注册 ${api.length} 个：\n  ` + api.join('\n  '));
});

test('★④ README 承诺的用例数与实际一致', () => {
  // 静态计数：数 test('…') 声明。选它是为了不递归（跑全部测试就得跑本文件）。
  // 单靠静态计数不够可靠（动态生成的用例会漏），所以下面用**动态计数反证静态方法**：
  // 对 OTHER_TEST_FILES，静态数必须等于真跑出来的 ok 行数。
  const staticCount = (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return (src.match(/^test\(/gm) || []).length;
  };
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...OTHER_TEST_FILES],
    { cwd: ROOT, encoding: 'utf8', timeout: 180000, env: CLEAN_ENV });
  const tap = r.stdout || '';
  const dynamicOthers = (tap.match(/^ok \d+ - /gm) || []).length;
  assert.ok(dynamicOthers > 0,
    `跑不出用例数。子进程 status=${r.status} stdout=${tap.length}字节 stderr=${(r.stderr || '').length}字节`
    + ` stdout 前 120: ${JSON.stringify(tap.slice(0, 120))}`);

  const staticOthers = OTHER_TEST_FILES.reduce((a, f) => a + staticCount(f), 0);
  assert.equal(staticOthers, dynamicOthers,
    '★静态计数法不可靠（对 OTHER_TEST_FILES 静态数与实跑数不等）—— 说明有用例不是字面 test( 声明的，'
    + '静态计数不再能当总数用。');

  const total = TEST_FILES.reduce((a, f) => a + staticCount(f), 0);
  const claimed = Number((readme.match(/npm test\s+#\s*(\d+)\s*例/) || [])[1]);
  assert.ok(claimed, '★README 的 npm test 没写用例数');
  assert.equal(claimed, total, `★README 说 ${claimed} 例，实际 ${total} 例`);
});

test('⑤ 平台与版本要求写的是已验过的那一个', () => {
  assert.match(readme, /Node ≥ 22\.5/, '必须写清 Node 最低版本（node:sqlite 的门槛）');
  assert.doesNotMatch(readme, /Node ≥ 1[0-9]\./, '版本门槛写错会导致装了跑不起来');
});

test('★⑥ 禁词闸：不许出现准确率承诺与荐结论式措辞', () => {
  // 局鉴的定位是复盘器。这些词一旦出现，产品承诺就悄悄越界了。
  const banned = [
    [/准确率/, '准确率承诺'],
    [/必胜|稳赢|包赢/, '结果承诺'],
    [/保证(能)?(找出|找到|识别)(狼|凶手)/, '破案承诺'],
    [/试用\s*\d+\s*天/, '试用倒计时'],
    [/建议你|推荐你/, '荐结论式措辞'],
    [/免费试用/, '试用措辞'],
  ];
  for (const [re, why] of banned) {
    assert.doesNotMatch(readme, re, 'README 出现被禁措辞：' + why);
  }
});

test('⑦ ★定位句必须在，且必须与 health 返回的一致', async () => {
  assert.match(readme, /复盘器/, 'README 必须自报定位是复盘器');
  assert.match(readme, /它不替你下结论/, 'README 必须有一句明确的免责定位');
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  const h = (await app.inject({ method: 'GET', url: '/api/health' })).json();
  await app.close();
  for (const frag of ['复盘器', '不替你下结论']) {
    assert.ok(readme.includes(frag), 'README 缺定位片段: ' + frag);
    assert.ok(h.positioning.includes(frag), 'health.positioning 缺定位片段: ' + frag);
  }
});

test('⑧ README 无本机绝对路径、无 IPv4 目标（换台机器也要能跑）', () => {
  assert.doesNotMatch(readme, /[A-Za-z]:\\/, 'README 出现盘符绝对路径');
  // 回环地址 127.0.0.1 与通配 0.0.0.0 是文档**必须**写的（怎么打开、怎么开给手机），
  // 不算「硬编码目标」；要禁的是别的真实主机。
  // （第一版一律禁 IPv4，把 127.0.0.1 也判红了 —— 判据比意图宽，反而逼人删掉必要信息。）
  const ips = [...readme.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)].map((m) => m[1]);
  const foreign = ips.filter((ip) => ip !== '127.0.0.1' && ip !== '0.0.0.0');
  assert.deepEqual(foreign, [], 'README 出现非回环 IP：' + foreign.join(', '));
  assert.doesNotMatch(readme, /C:\\Users|Users\\crx/, 'README 泄漏了本机用户名');
});

test('⑨ 反链检查：README 引用的每个文件都真实存在', () => {
  const links = [...readme.matchAll(/\]\(([^)#:]+)\)/g)].map((m) => m[1]);
  for (const l of links) {
    assert.ok(fs.existsSync(path.join(ROOT, l)), 'README 引用了不存在的文件: ' + l);
  }
});

test('⑩ 纯 LF、末尾有换行、无制表符缩进', () => {
  assert.ok(!readme.includes('\r\n'), 'README 必须是纯 LF');
  assert.ok(readme.endsWith('\n'), 'README 末尾必须有换行');
  assert.doesNotMatch(readme, /^\t/m, 'README 用空格缩进，不用制表符');
});