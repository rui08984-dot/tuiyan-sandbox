'use strict';
/**
 * 局鉴 · test/cli.test.cjs —— 命令行契约测试
 *
 * 口径：每个子命令都真跑一次子进程，验它的**退出码与输出**。
 * 不 mock 存储层、不起服务 —— CLI 的价值就在于「敲一行就能用」，
 * 绕过进程去测它等于测了个不存在的东西。
 *
 * ★每条用例用独立的临时库文件：CLI 走的是真实文件库（默认 :memory: 走不到），
 *   共用一份会互相污染，而 CLI 的 bug 往往就出在「上一条命令留下了什么」。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'jujian.cjs');
const CLEAN_ENV = Object.assign({}, process.env, { JUJIAN_LLM_MOCK: '1' });
delete CLEAN_ENV.NODE_TEST_CONTEXT;
delete CLEAN_ENV.NODE_OPTIONS;

let tmpDir;
/**
 * 每条用例一份独立库文件；同一条用例里所有 run() 共用它。
 * 库路径挂在 run.db 上 —— 需要用别的 env 单独起一次子进程时，
 * 必须复用**同一个库**，否则就会出现「在 A 库建的局去 B 库查」这种自己骗自己的错。
 * （第一版测试 ⑩ 就是这么错的：new 写 A 库，say 查 B 库，报「局 1 不存在」。）
 */
function cli(t) {
  if (!tmpDir || !fs.existsSync(tmpDir)) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jujian-cli-'));
  const db = path.join(tmpDir, 'cli-' + Math.random().toString(36).slice(2) + '.db');
  t.after(() => { try { fs.rmSync(db, { force: true }); } catch (_) { /* ignore */ } });
  const run = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--db=' + db], { encoding: 'utf8', env: CLEAN_ENV, timeout: 60000 });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  run.db = db;
  return run;
}

test('① help 与 games-types 可跑，且不认识的游戏类型给出可用列表', (t) => {
  const run = cli(t);
  const h = run(['help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /局鉴 · 社交推理游戏复盘台/);
  assert.match(h.out, /advise/, '帮助里必须列出天结算');

  const g = run(['games-types', '--json']);
  assert.equal(g.code, 0);
  const types = JSON.parse(g.out).map((x) => x.id);
  for (const id of ['werewolf', 'botc', 'script', 'avalon']) assert.ok(types.includes(id), '少了 ' + id);

  const bad = run(['new', 'x', '--type=麻将', '--players=8']);
  assert.equal(bad.code, 1, '不认识的游戏类型必须非零退出');
  assert.match(bad.err, /可用：/, '错误信息必须列出可用类型');
});

test('② 建局 → 三宏 → claims 回读，全链路', (t) => {
  const run = cli(t);
  const n = run(['new', '饭桌局', '--players=8', '--json']);
  assert.equal(n.code, 0);
  const gid = JSON.parse(n.out).局号;

  assert.equal(run([String(gid), 'claim', '3', '预言家', '--day=1']).code, 0);
  assert.equal(run([String(gid), 'check', '3', '1', '--day=1']).code, 0);
  assert.equal(run([String(gid), 'good', '7', '5', '--day=1']).code, 0);

  const c = run([String(gid), 'claims', '--json']);
  assert.equal(c.code, 0);
  const claims = JSON.parse(c.out);
  assert.equal(claims.length, 3);
  assert.ok(claims.some((x) => x.predicate === 'claims_role'));
  assert.ok(claims.some((x) => x.predicate === 'is_wolf'));
  assert.ok(claims.some((x) => x.predicate === 'is_good'));
});

test('③ games 列表给人读；--json 给机器读', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '列表演示', '--players=8', '--json']).out).局号;
  run([String(gid), 'claim', '2', '预言家', '--day=1']);

  const human = run(['games']);
  assert.equal(human.code, 0);
  assert.match(human.out, /局号.*名字.*类型/);
  assert.match(human.out, /列表演示/);

  const machine = run(['games', '--json']);
  const rows = JSON.parse(machine.out);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '列表演示');
});

test('★④ 席位越界必须拒，且说得清是几人的局', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '八人局', '--players=8', '--json']).out).局号;
  const bad = run([String(gid), 'claim', '9', '预言家', '--day=1']);
  assert.equal(bad.code, 1, '9 号不在 8 人局里，必须非零退出');
  assert.match(bad.err, /不在局/, '错误要说清是席位问题');
});

test('★⑤ advise 出矛盾清单：带描述、欠定度、无辜解释；同天重跑不灌水', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '复盘局', '--players=8', '--json']).out).局号;
  run([String(gid), 'claim', '3', '预言家', '--day=1']);
  run([String(gid), 'claim', '6', '预言家', '--day=2']);

  const a = run([String(gid), 'advise', '--day=2']);
  assert.equal(a.code, 0);
  assert.match(a.out, /\[对跳\]/, '应抓到对跳');
  assert.match(a.out, /欠定度/, '每条矛盾必须带欠定度');
  assert.match(a.out, /无辜解释：/, '每条矛盾必须带无辜解释');
  assert.match(a.out, /明天该盯/, '必须有明日清单');

  // 同一天再跑一次：矛盾条数不得翻倍
  const b = run([String(gid), 'advise', '--day=2', '--json']);
  assert.equal(b.code, 0);
  assert.equal(JSON.parse(b.out).contradictions.length, 1, '★重跑不得累加');

  const back = run([String(gid), 'card', '--day=2', '--json']);
  assert.equal(back.code, 0);
  assert.ok(JSON.parse(back.out).矛盾.length >= 1, '存档必须还在（曾因先删后写丢过）');
});

test('⑥ advise 之前没录任何东西 ⇒ 明确拒绝，不产空卡', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '空局', '--players=8', '--json']).out).局号;
  const r = run([String(gid), 'advise', '--day=1']);
  assert.equal(r.code, 1);
  assert.match(r.err, /没有任何事件/, '要说清为什么不能结算');
});

test('⑦ 撤回声称：视图里消失、行仍在库里', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '撤回局', '--players=8', '--json']).out).局号;
  run([String(gid), 'claim', '3', '预言家', '--day=1']);
  const cid = JSON.parse(run([String(gid), 'claims', '--json']).out)[0].id;

  const rm = run([String(gid), 'rm-claim', String(cid)]);
  assert.equal(rm.code, 0);
  assert.match(rm.out, /行仍在库里/, '必须自报账本不可变这件事');

  assert.equal(JSON.parse(run([String(gid), 'claims', '--json']).out).length, 0);
  const re = run([String(gid), 'rm-claim', String(cid)]);
  assert.equal(re.code, 0, '重复撤回是幂等的，不该报错');
});

test('⑧ 局不存在 / 子命令不认识 ⇒ 非零退出且说人话', (t) => {
  const run = cli(t);
  const noGame = run(['999', 'show']);
  assert.equal(noGame.code, 1);
  assert.match(noGame.err, /局 999 不存在/);

  const gid = JSON.parse(run(['new', 'x', '--players=8', '--json']).out).局号;
  const badSub = run([String(gid), '飞到火星']);
  assert.equal(badSub.code, 1);
  assert.match(badSub.err, /不认识的子命令/);

  const noArgs = run(['nonsense']);
  assert.equal(noArgs.code, 1);
  assert.match(noArgs.err, /jujian help/);
});

test('⑨ export 输出是完整合法 JSON（可以直接被别的工具读）', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '导出局', '--players=8', '--json']).out).局号;
  run([String(gid), 'claim', '3', '预言家', '--day=1']);
  const r = run([String(gid), 'export']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out);           // 解析失败即抛 ⇒ 这就是断言
  assert.equal(data.game.id, gid);
  assert.equal(data.meta.counts.events, 1);
  assert.equal(data.meta.schema_contract, 'jujian-v1');
});

test('⑩ ★CLI 不得在无 key 时出网（MOCK 模式下 say 必须自报）', (t) => {
  const run = cli(t);                       // ★先经 cli() 拿到一个本用例专属、未被清理的临时目录
  const gid = JSON.parse(run(['new', '抽取局', '--players=8', '--json']).out).局号;
  const env = Object.assign({}, CLEAN_ENV);
  delete env.JUJIAN_LLM_API_KEY; delete env.LLM_API_KEY; delete env.DEEPSEEK_API_KEY;
  const r = spawnSync(process.execPath, [BIN, String(gid), 'say', '3', '我是预言家，昨晚验的4号',
    '--day=1', '--json', '--db=' + run.db],
  { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(r.status, 0, 'say 失败：' + (r.stderr || ''));
  const j = JSON.parse(r.stdout);
  assert.equal(j.模式, 'MOCK', '★没配 key 时必须自报 MOCK，不许冒充真实模型');
  assert.match(j.说明, /待确认卡/, '抽取结果必须标明未落库');
});

test('⑪ ★null 原型行不得让渲染崩（node:sqlite 的行就是这种对象）', (t) => {
  const run = cli(t);
  const gid = JSON.parse(run(['new', '渲染局', '--players=8', '--json']).out).局号;
  run([String(gid), 'claim', '3', '预言家', '--day=1']);
  // show 走人读渲染路径 —— 这一条曾在 String(null 原型行) 上直接抛
  // "Cannot convert object to primitive value"。
  for (const args of [[String(gid), 'show'], [String(gid), 'claims'], ['games'], [String(gid), 'export']]) {
    const r = run(args);
    assert.equal(r.code, 0, `\`jujian ${args.join(' ')}\` 崩了：${r.err}`);
    assert.ok(r.out.length > 0, `\`jujian ${args.join(' ')}\` 没有任何输出`);
  }
});