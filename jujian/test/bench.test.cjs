'use strict';
/**
 * 局鉴 · test/bench.test.cjs —— 真实对局盲测的守卫
 *
 * 这套测试守的不是「bench 跑出好数字」，是三件更要紧的事：
 *   ① **bench 不会因为自己坏了而静默通过**（一局都没跑起来必须抛）
 *   ② **断言不许漂**：档案数、天数、真值这些硬事实被写死，档案被改动时立刻响
 *   ③ **协议 §1.2 的裁头是真的做了**，不是写在注释里
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const parser = require('../bench/parse-archive.cjs');
const { extractClaims, ROLE_ALIASES } = require('../bench/extract-claims.cjs');
const bench = require('../bench/run-bench.cjs');

const DIR = bench.ARCHIVE_DIR;
const SLUGS = parser.listArchives(DIR);

// ══ ① 档案：硬事实不许漂 ════════════════════════════════════════════════

test('① 档案齐全：5 局，且每一局都有公开层与真值层', () => {
  assert.equal(SLUGS.length, 5, '档案数变了 —— 是加局了还是丢局了？两件都要知道');
  for (const s of SLUGS) {
    assert.ok(fs.existsSync(path.join(DIR, s + '.md')), s + ' 缺公开层');
    assert.ok(fs.existsSync(path.join(DIR, s + '.truth.md')), s + ' 缺真值层');
  }
});

test('★② 真值锚点写死：狼人集合改动 ⇒ 立刻响（不能悄悄换判据）', () => {
  const expected = {
    'replay-werewolf-lyingman-s02e01': [1, 4, 5, 6],
    'replay-werewolf-daogou-20161023': [3, 5, 6, 11],
    'replay-werewolf-pandakill-s2e2': [1, 2, 6, 8],
    'replay-werewolf-songlang-20161215': [7, 8, 10, 11],
  };
  for (const [slug, wolves] of Object.entries(expected)) {
    const a = parser.loadArchive(DIR, slug);
    assert.deepEqual(a.truth.wolves, wolves, slug + ' 的真值变了 —— 档案被改过还是解析被改坏？');
    // 狼数 + 好人数应当等于席位数（BOTC 那局例外，它没座位）
    assert.equal(a.truth.wolves.length + a.truth.good.length, a.pub.seats.length,
      slug + '：狼＋好人 ≠ 席位数，真值层可能有缺口');
  }
});

test('③ 公开层解析：席位与事件数是硬事实', () => {
  const expected = {
    'replay-werewolf-lyingman-s02e01': { seats: 11, days: [1, 2, 3], events: 31 },
    'replay-werewolf-daogou-20161023': { seats: 11, days: [1, 2], events: 31 },
    'replay-werewolf-pandakill-s2e2': { seats: 12, days: [1, 2, 3, 4, 5], events: 20 },
    'replay-werewolf-songlang-20161215': { seats: 12, days: [1, 2, 3, 4], events: 37 },
  };
  for (const [slug, e] of Object.entries(expected)) {
    const a = parser.loadArchive(DIR, slug);
    assert.equal(a.pub.seats.length, e.seats, slug + ' 席位数变了');
    assert.deepEqual([...new Set(a.pub.sections.map((s) => s.day))].sort((x, y) => x - y), e.days, slug + ' 天数变了');
    const n = a.pub.sections.reduce((t, s) => t + s.events.length, 0);
    assert.equal(n, e.events, slug + ' 事件数变了');
    assert.equal(a.pub.seats[0].seat, 1, slug + ' 首个座位应当是 1');
    assert.equal(a.pub.seats[a.pub.seats.length - 1].seat, e.seats, slug + ' 末个座位应当连续');
  }
});

test('★④ BOTC 那局必须**解析失败并说清原因**（它只有名字、没有座位号）', () => {
  // 预注册协议早已判它「不合格：恶魔公开足迹近零 + 模型记忆混杂风险」。
  // bench 拒绝它是对的，但**拒绝理由必须可复核**，不能是空数组悄悄跳过。
  assert.throws(() => parser.loadArchive(DIR, 'replay-botc-rulebook'), /没有座位号/);
});

// ══ ② 协议 §1.2：裁头是真的做了 ════════════════════════════════════════

test('★⑤ 切片必须裁掉头部（不得含叙事标签、人数、结果行）', () => {
  const a = parser.loadArchive(DIR, 'replay-werewolf-lyingman-s02e01');
  const s1 = parser.slice(a.pub, 1);
  // 头部里有这些，裁头后必须没有
  for (const leak of ['JY封神之路', '还原完整度', '屠城局', '11 人', '警长竞选 + 第一轮发言与投票（完整版）']) {
    if (leak === '警长竞选 + 第一轮发言与投票（完整版）') continue;  // 该串本来就在正文章节名里
    assert.doesNotMatch(s1, new RegExp(leak.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      '★切片泄漏了头部内容：' + leak);
  }
  // 但正文事件必须在
  assert.match(s1, /E-3/);
  assert.match(s1, /宣称身份=预言家/);
});

test('⑥ 切片里不得出现真值层的东西（真值与公开层物理隔离）', () => {
  const truthText = fs.readFileSync(path.join(DIR, 'replay-werewolf-lyingman-s02e01.truth.md'), 'utf8');
  // 真值层的招牌句
  assert.match(truthText, /真相层/);
  const a = parser.loadArchive(DIR, 'replay-werewolf-lyingman-s02e01');
  for (const day of [1, 2, 3]) {
    const s = parser.slice(a.pub, day);
    assert.doesNotMatch(s, /真相层|真值锚点/, '第 ' + day + ' 天切片里出现了真值层的字样');
  }
});

// ══ ③ 抽取器：只认明写的，不猜 ════════════════════════════════════════

test('★⑦ 否定/疑问不得被读成角色声称（否定读成肯定会毒害复盘工具）', () => {
  // 原文：「看 12号 跳不跳预言家」——11号在问别人，不是自己宣称
  const bad = extractClaims({ eid: 'E-3', text: '11号 上警发言，表示前面只有 2号 认预言家，同意 3号 的质疑，看 12号 跳不跳预言家。' });
  const roleClaims = bad.filter((c) => c.predicate === 'claims_role');
  assert.equal(roleClaims.length, 0, '★问句被读成了角色声称：' + JSON.stringify(roleClaims));
});

test('⑧ 明写的声称必须抽得到（正向不能漏）', () => {
  const cases = [
    ['E-1', '3号 公开宣称身份=预言家，公布查验信息', { seat: 3, predicate: 'claims_role' }],
    ['E-3', '9 号公开宣称身份=预言家，公布查验信息："6 号是狼人"（查杀）', { seat: 9, predicate: 'is_wolf' }],
    ['E-7', '6 号（被查杀者）公开宣称身份=女巫，对抗查杀。', { seat: 6, predicate: 'claims_role' }],
  ];
  for (const [eid, text, want] of cases) {
    const got = extractClaims({ eid, text });
    assert.ok(got.some((c) => c.seat === want.seat && c.predicate === want.predicate),
      '漏了：' + text.slice(0, 30) + '（实得 ' + JSON.stringify(got.map((c) => c.predicate)) + '）');
  }
});

test('★⑨ 角色必须落在已知词表内，否则降级 said（不留超捕获）', () => {
  const got = extractClaims({ eid: 'X', text: '8号 发言，表示自己不跳枪牌，你们看着办。' });
  for (const c of got) {
    if (c.predicate === 'claims_role') {
      assert.ok(Object.values(ROLE_ALIASES).includes(c.object),
        '★出现了词表外的角色声称：' + c.object + ' —— 那多半是散文片段');
    }
  }
});

// ══ ④ bench 本身：跑得起来、报得诚实 ═══════════════════════════════════

test('★⑩ bench 跑得起来，且机制层两关都过', () => {
  const report = bench.runAll();
  assert.ok(report.results.length >= 3, '可覆盖的局太少：' + report.results.length);
  assert.ok(report.skipped.length >= 1, '应当如实登记跳过的那局');
  for (const r of report.results) {
    assert.equal(r.contradictions.citations_authentic, true, r.slug + ' 有引用落空');
    assert.equal(r.contradictions.rd1_guard_fired, true,
      r.slug + '：RD1 守卫没拦下引擎原始输出 —— 检查了「有无辜解释」这条不变式');
  }
});

test('★⑪ 抓到的对跳必须涉及真狼（否则这条读数毫无意义）', () => {
  const report = bench.runAll();
  const jumps = report.results.flatMap((r) => r.role_jumps);
  assert.ok(jumps.length >= 3, '抓到的对跳太少：' + jumps.length);
  for (const j of jumps) {
    assert.equal(j.involves_real_wolf, true,
      '★抓到一对不涉及真狼的「对跳」：' + j.role + ' ' + j.seats.join(' vs '));
  }
  // 三个可覆盖局的真值里都各有一对同角色对跳，这是硬事实
  const lyingman = report.results.find((r) => r.slug.includes('lyingman'));
  const w = lyingman.role_jumps.find((j) => j.role === 'witch');
  assert.ok(w, '★lyingman 应抓到女巫对跳（6号 vs 10号，E-7/E-8 明写）');
  assert.deepEqual(w.seats, [6, 10]);
  assert.equal(w.involves_real_wolf, true, '★6号 JY 就是该局真狼之一');
});

test('★⑫ 覆盖不足的局必须被标出来，不许混进结论', () => {
  const report = bench.runAll();
  const low = report.results.filter((r) => r.coverage.extraction_rate < 0.15);
  assert.ok(low.length >= 1, '应当至少有一局覆盖过低');
  const txt = bench.render(report);
  for (const r of low) {
    assert.ok(txt.includes('不足以支撑任何结论'), '覆盖过低的局没被标出来：' + r.slug);
  }
});

test('★⑬ bench 一局都没跑起来时必须抛（不许报「合计 0 局」）', () => {
  // 目录注入。第一版改 module.exports.ARCHIVE_DIR，**没用** ——
  // CommonJS 里那是另一个绑定，改它不影响模块内读到的 const，于是这条用例假绿。
  const os = require('node:os');
  const fsx = require('node:fs');
  const empty = fsx.mkdtempSync(path.join(os.tmpdir(), 'jujian-bench-empty-'));
  try {
    assert.throws(() => bench.runAll(empty), /一局都没跑起来/,
      '★bench 坏了却安静地报出「0 局 · 矛盾 0 条」—— 那和「跑了没发现」长得一模一样');
  } finally {
    fsx.rmSync(empty, { recursive: true, force: true });
  }
});

test('⑭ 命令行入口跑得起来，退出码 0', () => {
  const BIN = path.join(__dirname, '..', 'bin', 'jujian-bench.cjs');
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [BIN, '--json'], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(r.status, 0, 'bench 退出码非零：' + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(j.results.length >= 3);
  assert.ok(j.scope.measures.length >= 5);
  assert.ok(j.scope.does_not_measure.some((x) => /嫌疑排序/.test(x)),
    '★必须自报「不测嫌疑排序」—— 否则读数会被过度解读');
});