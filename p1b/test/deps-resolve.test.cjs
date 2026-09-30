'use strict';
/**
 * p1b/test/deps-resolve.test.cjs —— 原生模块多候选解析的回归锁（SPEC-deps-fix · 模块 deps-fix）
 *
 * 它替掉的那一行是**猜布局**：
 *   require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'))
 * 猜中一种就够用，猜不中就炸，★而且是运行时才炸。本文件锁四件事：
 *
 *   ① **候选表非空、有序、① 就是今天那一行**（前两条是生死线）
 *   ② **四种布局各真跑一次**（临时目录造假布局，不动真仓库）：
 *      源码树 / 上提 app\/node_modules / npm install 标准解析 / 一个都不在
 *   ③ **失败时说人话**：错误信息必须**逐条列出试过哪几个位置**与失败原因，
 *      错误对象另挂 `code`／`tried`（调用方判失败只认 code，不 match 文案）
 *   ④ **★反向锁**：把候选表清空到只剩不存在的路径 ⇒ 必须落到「可读错误」那条分支。
 *      配一条**对照**（同一份 opts，只把那一个换成真存在的）⇒ 必须成功——
 *      少了对照，本条可能只是因为 opts 根本不生效才恒绿。
 *
 * ── 不空跑的纪律（本文件处处守着）─────────────────────────────────────────
 *   · 每条带 `for` 的断言，都有一条同级的「确实跑了 N 次 / 返回值非空」前置断言；
 *   · 只断言 `typeof mod === 'function'` 是**不够**的——解析器返回仓库里那个**真的**
 *     better-sqlite3 也照样绿。所以每条布局都断言 `mod.__stub` 标记，**证明拿到的是哪一份**；
 *   · 判别法在 ④ 里：把被测对象清空，本文件必须变红。
 *
 * 零网络、零新依赖、零写仓库：临时目录一律在 `os.tmpdir()` 里造，用完删。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deps = require('../scripts/_betterSqlite3.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'p1b', 'cli', 'index.cjs');
const NAME = 'better-sqlite3';

/** 临时目录；每个用例自己清，测试之间不互相看见。 */
function tmpDir(tag) {
  const d = path.join(os.tmpdir(), 'p1b-depsfix-' + tag + '-' + process.pid + '-' + Date.now());
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

/**
 * 造一个假的 `better-sqlite3` 包（能 require 出一个**函数**），并打上 `__stub` 标记。
 *
 * ★为什么要打标记：只断言 `typeof === 'function'` 的话，解析器即使返回仓库里那个
 * 真的 better-sqlite3，本文件也照样全绿——那不叫锁住，叫陪跑。标记证明**拿到的是哪一份**。
 *
 * @param {string} base  根目录
 * @param {string} rel   相对 base 的包目录（如 `repo/p1a-terminal/node_modules/better-sqlite3`）
 * @param {object} [o]   `{tag, throws}` —— `throws:true` 造一个「存在但加载就炸」的坏包
 * @returns {string} 包目录绝对路径
 */
function stubModule(base, rel, o) {
  const opt = o || {};
  const dir = path.join(base, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: NAME, version: '0.0.0-stub', main: 'index.js' }, null, 1), 'utf8');
  const body = opt.throws
    ? "'use strict';\nthrow new Error('stub: 原生模块没编译/没带');\n"
    : "'use strict';\nfunction Stub() {}\nStub.__stub = " + JSON.stringify(opt.tag || rel) + ";\nmodule.exports = Stub;\n";
  fs.writeFileSync(path.join(dir, 'index.js'), body, 'utf8');
  return dir;
}

/**
 * 一个「标准 require 解析必然失败」的起点文件：落在空树里，node_modules 链上什么都没有。
 * 用它当 `from`，才能把「标准解析」这一项真的逼到失败分支上去（默认 `from` 是解析器自己，
 * 那条路上仓库根与 p1b/node_modules 都没有 better-sqlite3，本就失败，但不该靠这个巧合）。
 */
function emptyAnchor(base, tag) {
  const from = path.join(base, tag, 'pkg', 'consumer.cjs');
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.writeFileSync(from, "'use strict';\n", 'utf8');
  return from;
}

// ══════════════════════════════════════════════════════════════════
// ① 候选表：非空、有序、① 就是今天那一行
// ══════════════════════════════════════════════════════════════════

test('① 前置：默认候选表非空、无重复、全部绝对路径，且 ① 逐字符等于改造前那一行', () => {
  const c = deps.candidatePaths(NAME, { root: ROOT });
  assert.equal(c.length, 3, '★候选表长度变了（少了就是漏了一种布局）：' + JSON.stringify(c));
  assert.equal(new Set(c).size, c.length, '★候选表有重复项 ⇒ 会白试一次：' + JSON.stringify(c));
  for (const p of c) assert.ok(path.isAbsolute(p), '候选必须是绝对路径：' + p);
  assert.equal(c[0], path.join(ROOT, 'p1a-terminal', 'node_modules', NAME),
    '★第 ① 候选必须逐字符等于改造前那一行，否则开发态行为变了');
  assert.equal(c[1], path.join(ROOT, 'node_modules', NAME), '第 ② 候选＝上提布局（zip 的 app/node_modules/）');
  // 传入的 root 真的被用上了（否则下面的布局测试全是在测同一个真仓库 ⇒ 恒绿）
  const other = deps.candidatePaths(NAME, { root: 'X:\\某个地方' });
  assert.equal(other.length, c.length);
  for (let i = 0; i < c.length; i++) {
    assert.ok(other[i].startsWith('X:\\某个地方'), '★候选没跟着注入的 root 走：' + other[i]);
    assert.equal(path.basename(other[i]), path.basename(c[i]), '候选尾段应恒为模块名');
  }
});

// ══════════════════════════════════════════════════════════════════
// ② 四种布局各真跑一次（临时目录造假布局，不动真仓库）
// ══════════════════════════════════════════════════════════════════

test('②a 布局一（源码树）：p1a-terminal/node_modules/ 命中，且**只试了它一个**', () => {
  const base = tmpDir('a');
  try {
    const root = path.join(base, 'repo');
    const want = stubModule(base, path.join('repo', 'p1a-terminal', 'node_modules', NAME), { tag: 'source-tree' });
    const t = deps.betterSqlite3Trace({ root, from: emptyAnchor(base, 'anchor') });
    assert.equal(t.via, 'candidate', '必须走候选命中，不该退到标准解析');
    assert.equal(t.candidate, want, '★命中的不是第 ① 候选');
    assert.equal(t.mod.__stub, 'source-tree', '★拿到的是别的副本（模块没按标记分辨 ⇒ 这条不咬人）');
    assert.equal(typeof t.mod, 'function', 'spec：断言拿到的真是构造函数');
    assert.equal(t.tried.length, 1, '★不该多试（首个就中）：' + JSON.stringify(t.tried));
    assert.equal(t.tried[0].ok, true);
    assert.equal(t.tried[0].spec, want);
  } finally { rmrf(base); }
});

test('②b 布局二（上提）：只有 <root>/node_modules/ 有 ⇒ 命中它，不报错', () => {
  const base = tmpDir('b');
  try {
    const root = path.join(base, 'repo');
    const want = stubModule(base, path.join('repo', 'node_modules', NAME), { tag: 'hoisted' });
    assert.equal(fs.existsSync(path.join(root, 'p1a-terminal')), false, '前提失效：p1a-terminal/ 不该存在');
    const t = deps.betterSqlite3Trace({ root, from: emptyAnchor(base, 'anchor') });
    assert.equal(t.via, 'candidate');
    assert.equal(t.candidate, want, '★上提布局没被认出来');
    assert.equal(t.mod.__stub, 'hoisted', '★拿到的不是上提那一份');
    assert.equal(typeof t.mod, 'function');
    assert.equal(t.tried.length, 2, '★应先试 ① 落空、再试 ② 命中：' + JSON.stringify(t.tried));
    assert.equal(t.tried[0].ok, false);
    assert.equal(t.tried[1].ok, true);
  } finally { rmrf(base); }
});

test('②c ★顺序有意义：① 与 ② 同时存在 ⇒ 必须取 ①（今天的那个）', () => {
  const base = tmpDir('c');
  try {
    const root = path.join(base, 'repo');
    stubModule(base, path.join('repo', 'p1a-terminal', 'node_modules', NAME), { tag: 'cand-1' });
    stubModule(base, path.join('repo', 'node_modules', NAME), { tag: 'cand-2' });
    stubModule(base, path.join('repo', 'p1b', 'node_modules', NAME), { tag: 'cand-3' });
    const t = deps.betterSqlite3Trace({ root, from: emptyAnchor(base, 'anchor') });
    assert.equal(t.mod.__stub, 'cand-1', '★优先级反了：源码树那一份必须压过上提那份');
    assert.equal(t.tried.length, 1, '首个就中，不该继续试：' + JSON.stringify(t.tried));
  } finally { rmrf(base); }
});

test('②d ★存在但加载就炸的候选 ⇒ 记下原因并继续试下一个（不拿坏的那个继续跑）', () => {
  const base = tmpDir('d');
  try {
    const root = path.join(base, 'repo');
    const broken = stubModule(base, path.join('repo', 'p1a-terminal', 'node_modules', NAME), { throws: true });
    const good = stubModule(base, path.join('repo', 'node_modules', NAME), { tag: 'fallback-good' });
    const t = deps.betterSqlite3Trace({ root, from: emptyAnchor(base, 'anchor') });
    assert.equal(t.mod.__stub, 'fallback-good', '★应该落到上提那一份，而不是抛出来或拿坏的那份');
    assert.equal(t.candidate, good);
    assert.equal(t.tried.length, 2, '★两个候选都该留下凭据：' + JSON.stringify(t.tried));
    assert.equal(t.tried[0].spec, broken);
    assert.equal(t.tried[0].ok, false);
    assert.match(String(t.tried[0].reason), /原生模块没编译/, '★失败原因没带出来 ⇒ 用户无从下手');
  } finally { rmrf(base); }
});

test('②e 布局三（npm install）：候选全落空 ⇒ 退回标准 require 解析并命中', () => {
  const base = tmpDir('e');
  try {
    // root 是一棵**什么都没有**的树（三个候选必然全落空）——
    //   ★这样命中只能来自标准解析那一项，否则本条就是在测候选表。
    const root = path.join(base, 'bare-root');
    fs.mkdirSync(root, { recursive: true });
    // npm install 把包装在**另一个**层级的 node_modules 里（真实形态：仓库根 npm install 后上提）
    const installed = stubModule(base, path.join('install-tree', 'node_modules', NAME), { tag: 'npm-install' });
    const from = path.join(base, 'install-tree', 'app', 'consumer.cjs');
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.writeFileSync(from, "'use strict';\n", 'utf8');

    const t = deps.betterSqlite3Trace({ root, from });
    assert.equal(t.via, 'standard', '★必须走标准 require 解析，候选表不该命中');
    assert.equal(t.candidate, null, '标准解析命中时不该有 candidate 路径');
    assert.equal(t.from, from, '标准解析的起点必须是传入的 from');
    assert.equal(t.mod.__stub, 'npm-install', '★拿到的是别的副本');
    assert.equal(typeof t.mod, 'function');
    // 非空跑：三个候选**都**试过了（一个都没命中），然后标准解析成功
    assert.equal(t.tried.length, 4, '★应留下 3 个候选落空 ＋ 1 个标准解析命中：' + JSON.stringify(t.tried));
    assert.equal(t.tried.filter((x) => x.via === 'candidate' && x.ok === false).length, 3,
      '★三个候选都该落空并留凭据');
    assert.equal(t.tried[3].via, 'standard');
    assert.equal(t.tried[3].ok, true);
    assert.ok(installed.length > 0);
  } finally { rmrf(base); }
});

test('②f 布局四（一个都不在）⇒ 抛可读人话错误，且**逐条列出试过哪几个位置**', () => {
  const base = tmpDir('f');
  try {
    const root = path.join(base, 'bare-root');
    fs.mkdirSync(root, { recursive: true });
    const from = emptyAnchor(base, 'anchor');
    assert.throws(
      () => deps.betterSqlite3Trace({ root, from }),
      (e) => {
        assert.equal(e.code, deps.NATIVE_MODULE_NOT_FOUND, '★错误对象没挂 code（调用方无从判）');
        assert.equal(e.module, NAME);
        assert.equal(e.from, from);
        // ── 非空跑：循环真的跑了 4 次（3 候选 ＋ 标准解析），且**条条都没中** ──
        assert.equal(e.tried.length, 4, '★凭据条数不对：' + JSON.stringify(e.tried));
        assert.equal(e.tried.filter((x) => x.ok).length, 0, '★不该有成功的项');
        for (const t of e.tried) {
          assert.ok(t.reason, '★有条目没写失败原因：' + JSON.stringify(t));
        }
        // ── 错误信息必须**说得出试过哪几个位置**（这是本模块的硬要求）──
        assert.match(e.message, /试过/, '★错误信息没说自己试过什么');
        for (const spec of e.candidates) {
          assert.ok(e.message.includes(spec), '★错误信息没列出候选位置：' + spec);
        }
        assert.ok(e.message.includes('标准 require 解析'), '★错误信息没提标准解析那一项');
        assert.match(e.message, /修法/, '★没告诉用户怎么办');
        assert.ok(e.message.split('\n').length >= 3, '★错误信息不是多行的（那是堆栈不是人话）');
        return true;
      },
    );
  } finally { rmrf(base); }
});

// ══════════════════════════════════════════════════════════════════
// ③ ★反向锁：把候选表清空到只剩不存在的路径 ⇒ 必须落到「可读错误」分支
// ══════════════════════════════════════════════════════════════════

test('③ ★反向锁：候选清空到只剩一个不存在的路径 ⇒ 落到可读错误；对照组必须成功', () => {
  const base = tmpDir('lock');
  try {
    const from = emptyAnchor(base, 'anchor');
    const ghost = path.join(base, 'never-there', 'node_modules', NAME);

    // ── ★判别法的前半：同一份 opts，只把那一个不存在的候选换成真存在的 ⇒ 必须成功。
    //   少了这一条，下面那条可能只是因为候选注入根本不生效才恒绿。
    const real = stubModule(base, path.join('ctrl', 'node_modules', NAME), { tag: 'lock-control' });
    const okTrace = deps.betterSqlite3Trace({ candidates: [real], from, allowStandard: false });
    assert.equal(okTrace.via, 'candidate');
    assert.equal(okTrace.mod.__stub, 'lock-control', '★候选注入根本不生效 ⇒ 反向锁是假绿');
    assert.equal(okTrace.tried.length, 1);
    assert.equal(okTrace.tried[0].ok, true);

    // ── ★判别法的后半：把被测对象清空（同一个不存在的候选）⇒ 必须变红。
    assert.throws(
      () => deps.betterSqlite3Trace({ candidates: [ghost], from, allowStandard: false }),
      (e) => {
        assert.equal(e.code, deps.NATIVE_MODULE_NOT_FOUND, '★清空后没落到可读错误分支');
        assert.equal(e.tried.length, 1, '★只试了一个候选就该放弃：' + JSON.stringify(e.tried));
        assert.equal(e.tried[0].spec, ghost);
        assert.equal(e.tried[0].ok, false);
        assert.ok(e.tried[0].reason, '★失败原因为空 ⇒ 用户无从下手');
        assert.ok(e.message.includes(ghost), '★错误信息没列出试过的那个位置');
        assert.match(e.message, /修法/, '★没告诉用户怎么办');
        return true;
      },
    );

    // ── 候选表整个给空数组：同样落到可读错误，且明说「候选表是空的」
    assert.throws(
      () => deps.betterSqlite3Trace({ candidates: [], from, allowStandard: false }),
      (e) => {
        assert.equal(e.code, deps.NATIVE_MODULE_NOT_FOUND);
        assert.equal(e.tried.length, 0, '空候选表不该有尝试凭据');
        assert.match(e.message, /候选表是空的/, '★没明说候选表是空的（用户会以为是环境问题）');
        return true;
      },
    );
  } finally { rmrf(base); }
});

// ══════════════════════════════════════════════════════════════════
// ④ 真仓库：开发态行为零变化 ＋ 两个调用点真跑
// ══════════════════════════════════════════════════════════════════

test('④ ★源码树里解析结果与今天逐字节相同（同一个模块对象，且走第 ① 候选）', () => {
  const legacyPath = path.join(ROOT, 'p1a-terminal', 'node_modules', NAME);
  assert.ok(fs.existsSync(legacyPath), '前提失效：源码树里那一行今天就不成立，本条无从测起');
  // require 一个**目录**时走 package.json 的 main，所以解析终点是包里的入口文件而不是目录本身
  const entry = require.resolve(legacyPath);
  assert.ok(entry.startsWith(legacyPath + path.sep), '前提失效：解析终点不在包目录里：' + entry);
  assert.ok(entry.endsWith('.js'), '前提失效：解析终点不是 js 文件：' + entry);

  const legacy = require(legacyPath);
  const now = deps.betterSqlite3();
  assert.strictEqual(now, legacy, '★拿到的不是同一个模块对象（require 缓存按解析后的文件路径索引）');
  assert.equal(typeof now, 'function');

  const t = deps.betterSqlite3Trace();
  assert.equal(t.via, 'candidate');
  assert.equal(t.candidate, legacyPath, '★第 ① 候选必须是今天那一行');
  assert.equal(t.tried.length, 1, '★不该多试：' + JSON.stringify(t.tried));
  assert.equal(t.tried.filter((x) => !x.ok).length, 0, '不该有失败项');

  // 拿到的东西**真的能开库**（只断言是函数不够：解析器给个空壳也过）
  const dbPath = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
  const db = new now(dbPath, { readonly: true });
  try {
    assert.equal(db.prepare('SELECT 1 AS one').get().one, 1, '★拿到的构造函数开不了只读库');
  } finally { db.close(); }
});

test('⑤ ★18 条 CLI 的「体检 看板」「体检 跑批」退出码 0（spec Success Criteria）', () => {
  const pairs = [['体检', '看板'], ['体检', '跑批']];
  const outs = [];
  for (const [group, cmd] of pairs) {
    const r = spawnSync(process.execPath, [CLI, group, cmd], { encoding: 'utf8', cwd: ROOT, timeout: 120000 });
    assert.equal(r.status, 0, `${group} ${cmd} 退出码 ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
    outs.push(r.stdout || '');
  }
  // ── 非空跑：循环确实跑了两次，两次都吐了东西 ──
  assert.equal(outs.length, 2, '★循环没跑满两轮');
  for (const o of outs) assert.ok(o.length > 0, '★某条命令零输出（解析失败也可能静默）');
  for (const o of outs) {
    assert.ok(!/找不到原生模块|MODULE_NOT_FOUND|Cannot find module/.test(o),
      '★命令行里出现了解析失败：\n' + o);
  }
  // 看板：账本段是真数字（不是「n/a（库不可读）」）⇒ board.cjs 那个调用点真的解析到了
  assert.match(outs[0], /==\s*账本\s*==/, '★看板没有账本段');
  assert.match(outs[0], /题\s+\d+/, '★看板账本题数不是数字 ⇒ board.cjs 的 betterSqlite3() 没成功');
  assert.match(outs[0], /integrity ok/, '★账本 integrity 不是 ok');
  // 跑批：① ② ③ 三段都在 ⇒ exp-health 两个调用点（② 与 ③）都真的开到了库
  assert.match(outs[1], /② DB 增长: 前缀共 \d+ 行/, '★② 段没出数 ⇒ exp-health.cjs 第一个调用点没成功');
  assert.match(outs[1], /③ 队列: \d+ 条件/, '★③ 段没出数 ⇒ exp-health.cjs 第二个调用点没成功');
});
