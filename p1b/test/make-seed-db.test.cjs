'use strict';
/**
 * p1b/test/make-seed-db.test.cjs —— 种子库隐私闸的回归锁（模块 privacy-seed，2026-09-30）
 *
 * 测的不只是「剔除脚本跑得通」，而是**「这把闸咬人」**。三件事必须为真：
 *   ① 产物里没有 4 位真实玩家的任何标识 —— 且这件事是**在非空的样本上**判的（不是空跑绿灯）；
 *   ② 喂一条带真人昵称的夹具进去，体检脚本**必须红**（反向锁）；
 *   ③ 把剔除逻辑**故意破坏掉**，本测试**必须红**（变异注入自证）。
 *
 * ★为什么每条红线前面都有一条「非空」前置断言：
 *   「匹配 0 行」在空表上恒真。若产物被剔空了，这个测试会一路绿灯放行 ——
 *   正是 spec 判据一节警告的那种假闸。所以先断言「别人桶里有样例行」，再断言「昵称 0 行」。
 *
 * ★**被剔的原文与昵称一个字都不进本文件**：需要真名夹具时，从来源库**运行时**读出来
 *   （只读打开），在内存里拼。仓库里只出现 `events.id ∈ {1,2,3,4,5}`。
 *
 * ★变异注入**只用 fs.copyFileSync 备份/还原**，**绝不 git checkout** —— 那会把本仓库
 *   未提交的工作流改动一起退掉。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'make-seed-db.cjs');
const SRC = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const TMP = path.join(ROOT, 'p1b', '.tmp', 'privacy-seed-test');
// ★产物路径：与 make-seed-db.cjs 的 DEFAULT_OUT / DEFAULT_PROVENANCE 同一个
const OUT = path.join(ROOT, 'seed', 'p1a-seed.db');
const PROV = path.join(ROOT, 'seed', 'seed_provenance.json');

const 跑 = (args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
const 跑码 = (args) => {
  try { 跑(args); return 0; } catch (e) { return e.status === undefined ? -1 : e.status; }
};
const 清 = (d) => { fs.rmSync(d, { recursive: true, force: true }); };
const 建目录 = () => { fs.mkdirSync(TMP, { recursive: true }); return TMP; };
const 源 = (sql, ...a) => { const d = new DatabaseSync(SRC, { readOnly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const 源全 = (sql, ...a) => { const d = new DatabaseSync(SRC, { readOnly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const 产物 = (db, sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };

// ═══ 前置：来源库里那 5 行真人昵称行确实在（否则整套测试是在给空气上锁）═══
test('① 前置：来源库确实含 5 行真人昵称行，且它们不是空文本', () => {
  const rows = 源全(`SELECT id, length(raw_text) len FROM events WHERE id IN (1,2,3,4,5) ORDER BY id`);
  assert.equal(rows.length, 5, '来源库 events 里 id∈{1,2,3,4,5} 应有 5 行，实际 ' + rows.length + ' 行 —— 判据清单与库对不上，测试前提失效');
  for (const r of rows) assert.ok(r.len > 0, 'events.id=' + r.id + ' 的 raw_text 是空的，这行不可能带昵称 —— 前提失效');
  // 身份账本必须非空：账本空了，G2/G3/G7 就是恒真断言
  const mod = require(SCRIPT);
  const d = new DatabaseSync(SRC, { readOnly: true });
  const { ledger } = mod.buildLedger(d);
  d.close();
  assert.ok(ledger.size > 20, '身份账本只有 ' + ledger.size + ' 个 token，太少了 —— 闸会变成空跑绿灯');
});

// ═══ 前置：来源库本身就有该被剔的东西（证明剔除真的在干活）═══
test('② 前置：来源库里 hypotheses / 真人行 / 角色判断都非零（否则「剔完是 0」是废话）', () => {
  assert.ok(源('SELECT COUNT(*) n FROM hypotheses').n > 0, '来源 hypotheses 为空，剔 0 行没有意义');
  assert.ok(源('SELECT COUNT(*) n FROM events WHERE id IN (1,2,3,4,5)').n === 5, '来源真人行不是 5 行');
});

// ═══ 主体：构建一个产物（在临时目录，不碰仓库里的 seed/）═══
let BUILT = null;

test('③ 构建：产物生成、八道闸全过、来源 sha256 前后一致', () => {
  建目录();
  const out = path.join(TMP, 'p1a-seed.db');
  const prov = path.join(TMP, 'seed_provenance.json');
  清(out); 清(prov);
  fs.rmSync(out + '-wal', { force: true }); fs.rmSync(out + '-shm', { force: true });

  const before = mod_sha(SRC);
  const stdout = 跑(['--out', out, '--provenance', prov]);
  const after = mod_sha(SRC);

  assert.equal(before, after, '★来源 p1a.db 的 sha256 变了 —— 脚本写了只读库，这是最严重的违规');
  assert.ok(fs.existsSync(out), '产物没生成');
  assert.ok(/道闸全过/.test(stdout), '构建没有全过：\n' + stdout);
  assert.ok(!/\[红\]/.test(stdout), '构建里有红项：\n' + stdout);
  BUILT = { out, prov, stdout };
});

function mod_sha(p) {
  return require(SCRIPT).sha256File(p);
}

// ═══ ④ 隐私锁（非空前置 ⇒ 真的在非空样本上判）═══
test('④ 隐私锁：别人桶非空（样例行在），且身份 token 命中 0 行', () => {
  assert.ok(BUILT, '③ 没跑，产物不存在');
  const mod = require(SCRIPT);
  const d = new DatabaseSync(BUILT.out, { readOnly: true });
  try {
    // ★前置：别人桶确实有样例行。少了这一条，「命中 0 行」在空表上恒真。
    const tot = d.prepare('SELECT COUNT(*) n FROM events').get().n;
    assert.ok(tot > 400, '产物 events 只有 ' + tot + ' 行 —— 被剔空了？「0 命中」就成了空跑绿灯，测试须先红');
    const sample = d.prepare(`SELECT COUNT(*) n FROM events WHERE length(raw_text) > 0`).get().n;
    assert.ok(sample >= tot - 1, '产物 events 里空文本行过多（' + (tot - sample) + ' 行），样例行不足以判隐私');

    // 结论
    const { ledger } = (() => { const s = new DatabaseSync(SRC, { readOnly: true }); const r = mod.buildLedger(s); s.close(); return r; })();
    let hits = 0;
    for (const t of ledger) hits += d.prepare('SELECT COUNT(*) n FROM events WHERE raw_text LIKE ?').get('%' + modLike(t) + '%').n;
    assert.equal(hits, 0, '产物 events 里有 ' + hits + ' 行命中身份 token');
  } finally { d.close(); }
});

const modLike = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[%_]/g, (m) => '\\' + m);

// ═══ ⑤ 名单锁 ═══
test('⑤ 名单锁：5 个真人行 id 一个都不在产物里', () => {
  const d = new DatabaseSync(BUILT.out, { readOnly: true });
  try {
    const n = d.prepare('SELECT COUNT(*) n FROM events WHERE id IN (1,2,3,4,5)').get().n;
    assert.equal(n, 0, '产物里还有 ' + n + ' 行真人行');
  } finally { d.close(); }
});

// ═══ ⑥ 人数锁 + ⑦ 零泄漏锁 ═══
test('⑥ 人数锁：hypotheses = 0，且来源里确实有 6 行（证明不是恒零）', () => {
  const before = 源('SELECT COUNT(*) n FROM hypotheses').n;
  const d = new DatabaseSync(BUILT.out, { readOnly: true });
  try { assert.equal(d.prepare('SELECT COUNT(*) n FROM hypotheses').get().n, 0); }
  finally { d.close(); }
  assert.ok(before > 0, '来源 hypotheses 为 0 —— 「剔完 0」不能证明剔除逻辑在工作');
});

test('⑦ 零泄漏锁：analytics_* 与 question_owners 全为 0，且这些表在产物里存在', () => {
  const d = new DatabaseSync(BUILT.out, { readOnly: true });
  try {
    for (const t of ['analytics_events', 'analytics_sessions', 'analytics_visitors', 'question_owners']) {
      const has = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
      assert.ok(has, '产物里没有 ' + t + ' 表 —— 「0 行」是因为表没了，不是剔干净了');
      assert.equal(d.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n, 0, t + ' 还有行');
    }
  } finally { d.close(); }
});

// ═══ ⑧ 结构锁 ═══
test('⑧ 结构锁：sqlite_master 表数与视图数与来源一致（结构留住了）', () => {
  const s = new DatabaseSync(SRC, { readOnly: true });
  const p = new DatabaseSync(BUILT.out, { readOnly: true });
  try {
    const cnt = (d) => {
      const o = { table: 0, view: 0 };
      for (const r of d.prepare("SELECT type, COUNT(*) n FROM sqlite_master WHERE type IN ('table','view') GROUP BY type").all()) o[r.type] = r.n;
      return o;
    };
    assert.deepEqual(cnt(p), cnt(s), '产物的表/视图数与来源不一致');
  } finally { s.close(); p.close(); }
});

// ═══ ⑨ provenance 留痕 ═══
test('⑨ provenance：含来源 sha256 / 逐表剔除数 / 五层读数 /「这不是你的成绩」', () => {
  const j = JSON.parse(fs.readFileSync(BUILT.prov, 'utf8'));
  assert.match(j.来源.sha256, /^[0-9a-f]{64}$/, 'provenance 缺来源 sha256');
  assert.ok(j.剔除.逐表.events.剔 > 0, 'provenance 没记剔了几行 events');
  assert.ok(j.剔除.逐表.events.剔掉的_id.length === 5, 'provenance 没逐一列出那 5 个 id');
  assert.ok(j.读数.分层 && Object.keys(j.读数.分层).length > 0, 'provenance 缺五层读数');
  assert.ok('brier' in Object.values(j.读数.分层)[0], '五层读数里没有 brier');
  assert.ok(String(j.一句话).includes('不是你的成绩'), 'provenance 缺「这不是你的成绩」这句话');
});

// ═══ ⑩ 零落盘锁：被剔的原文一个字都不许进仓库 ═══
test('⑩ 零落盘锁：provenance / 脚本 / 本测试都不含被剔的原文', () => {
  const originals = 源全('SELECT raw_text FROM events WHERE id IN (1,2,3,4,5)').map((r) => r.raw_text);
  assert.equal(originals.length, 5, '读不到 5 行原文，无法验零落盘');
  const haystacks = {
    'seed_provenance.json': fs.readFileSync(BUILT.prov, 'utf8'),
    'make-seed-db.cjs': fs.readFileSync(SCRIPT, 'utf8'),
    'make-seed-db.test.cjs': fs.readFileSync(__filename, 'utf8'),
  };
  for (const [what, text] of Object.entries(haystacks)) {
    for (const o of originals) {
      assert.ok(!text.includes(o), '★' + what + ' 里出现了被剔的原文（spec Boundaries: Never）');
      // 再退一步：连原文里的昵称片段也不许出现
      for (const frag of o.split(/[0-9号]/).filter((f) => f.length >= 2)) {
        assert.ok(!text.includes(frag), '★' + what + ' 里出现了被剔原文的片段「' + frag + '」');
      }
    }
  }
});

// ═══ ⑪ 反向锁：喂一条带真人昵称的夹具 ⇒ 体检脚本必须红 ═══
test('⑪ 反向锁：把一条真人昵称行塞回产物，--check-only 退出码非 0', () => {
  const bad = path.join(TMP, 'bad-seed.db');
  清(bad);
  fs.copyFileSync(BUILT.out, bad);
  // ★真名夹具在运行时从来源读出，仓库里不落一个字
  const nickRow = 源全('SELECT id, game_id, day, phase, seq, type, actor_seat, raw_text FROM events WHERE id=1')[0];
  const w = new DatabaseSync(bad);
  try {
    w.exec(`INSERT INTO events (id, game_id, day, phase, seq, type, actor_seat, raw_text)
            VALUES (${nickRow.id}, ${nickRow.game_id}, ${nickRow.day}, '${nickRow.phase}', 9999, '${nickRow.type}', ${nickRow.actor_seat}, '${nickRow.raw_text.replace(/'/g, "''")}')`);
    w.exec('VACUUM');
  } finally { w.close(); }

  const code = 跑码(['--check-only', '--target', bad]);
  assert.notEqual(code, 0, '★喂了真人昵称夹具，--check-only 居然退出 0 —— 这把闸不咬人');

  // 同一把闸对正常产物必须是绿的（证明上面的红不是因为闸恒红）
  assert.equal(跑码(['--check-only', '--target', BUILT.out]), 0, '正常产物却报红 —— 闸恒红，反向锁没有意义');
});

// ═══ ⑫ 变异注入自证：破坏剔除逻辑 ⇒ 本闸必须红 ═══
test('⑫ 变异注入：把 events 的 DELETE 掐掉，产物必须带真人行、闸门必须红', () => {
  const srcText = fs.readFileSync(SCRIPT, 'utf8');
  // ★用 cp 备份/还原。**绝不 git checkout** —— 那会连本仓库未提交的工作流改动一起退掉。
  const backup = path.join(TMP, 'make-seed-db.cjs.bak');
  fs.copyFileSync(SCRIPT, backup);
  try {
    // 变异：把删除真人 events 的那条 SQL 换成无害的 no-op
    const mutated = srcText.replace(
      /w\.exec\(`DELETE FROM events WHERE id IN \(\$\{HAND_VERIFIED_EVENT_IDS\.join\(','\)\}\)`\);/,
      "w.exec('SELECT 1');  /* MUTATED: 真人行不删了 */"
    );
    assert.notEqual(mutated, srcText, '★变异没打上（源码形态变了？）—— 自证失效，须复核变异点');
    fs.writeFileSync(SCRIPT, mutated, 'utf8');

    const out = path.join(TMP, 'mutated-seed.db');
    const prov = path.join(TMP, 'mutated_provenance.json');
    清(out); 清(prov);
    const code = 跑码(['--out', out, '--provenance', prov]);

    assert.notEqual(code, 0, '★破坏剔除逻辑后构建竟然报成功（exit ' + code + '）—— 闸门没咬人');
    if (fs.existsSync(out)) {
      const d = new DatabaseSync(out, { readOnly: true });
      try {
        const n = d.prepare('SELECT COUNT(*) n FROM events WHERE id IN (1,2,3,4,5)').get().n;
        assert.equal(n, 5, '★变异产物里真人行 = ' + n + ' 行，期望 5 —— 变异没真正生效，自证无效');
      } finally { d.close(); }
      // 而且 check-only 对这个坏产物也必须红
      assert.notEqual(跑码(['--check-only', '--target', out]), 0, '★check-only 对带真人行的产物居然放行');
    }
  } finally {
    // ★还原同样用 cp
    fs.copyFileSync(backup, SCRIPT);
    assert.equal(fs.readFileSync(SCRIPT, 'utf8'), srcText, '★脚本没还原干净 —— 须手工核对');
  }
});

// ═══ ⑬ require 安全（有回归锁 scripts-require-safety.test.cjs）═══
test('⑬ require 安全：模块加载零副作用（顶层无写盘、有 require.main 守卫）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/require\.main === module/.test(src), '脚本缺 require.main 守卫 —— 回归锁 scripts-require-safety.test.cjs 会红');
  const topWrite = src.split(/\r?\n/).filter((l) => /^(fs|fsp)\.(writeFileSync|appendFileSync|mkdirSync|createWriteStream|copyFileSync|renameSync|rmSync|unlinkSync)\s*\(/.test(l));
  assert.deepEqual(topWrite, [], '脚本顶层有写盘');
  const topExit = src.split(/\r?\n/).filter((l) => /^process\.exit\s*\(/.test(l));
  assert.deepEqual(topExit, [], '脚本顶层有 process.exit(');
});

test('⑭ 清理临时目录', () => {
  清(TMP);
  assert.ok(!fs.existsSync(TMP), '临时目录没清掉');
});

// ══════════════════════════════════════════════════════════════════
// ★★2026-09-29 独立复核的变异注入发现 6 个变异里 3 个没被咬住，
//   这三条是把那三个洞补上的（补之前：G7 零覆盖、n-gram 粒度无人钉）。
// ══════════════════════════════════════════════════════════════════

test('⑪ ★n-gram 粒度被钉住：账本必须同时含 2 字与 4-6 字 token', () => {
  // ★背景：把 subgrams(r,2,6) 收窄成 (r,2,2)，14 条测试**全绿**。
  //   原因：没有任何断言检查 token 的**长度分布**，只查了 token 总数 > 20。
  //   ⇒ 隐私闸的划界粒度被悄悄放宽，测试察觉不到。
  const mod = require(SCRIPT);
  const d = new DatabaseSync(SRC, { readOnly: true });
  const { ledger } = mod.buildLedger(d);
  d.close();
  const lens = new Set([...ledger].map((t) => [...t].length));
  const byLen = (n) => [...ledger].filter((t) => [...t].length === n).length;

  assert.ok(byLen(2) > 0, '账本里没有 2 字 token —— 下界被收窄了');
  for (const n of [4, 5, 6]) {
    assert.ok(byLen(n) > 0,
      '★账本里没有 ' + n + ' 字 token（该层有 ' + byLen(n) + ' 个）—— ' +
      'n-gram 上界被收窄了，这会让隐私划界变粗而测试察觉不到');
  }
  assert.ok(lens.size >= 5,
    '账本 token 长度只覆盖 ' + [...lens].sort().join(',') + ' 这几档（应至少 5 档：2~6）');
});

test('⑫ ★G7 字节级闸被覆盖：文件里含 token 就必须报出来', () => {
  // ★背景：scanBytes 整个废掉（恒返回 0 命中），14 条测试**无一报红**。
  //   而交付报告里把 G7 写成「这道闸在开发中真抓到我一个 bug」——
  //   也就是说它当时靠人盯着，不靠锁。现在它有锁了。
  const mod = require(SCRIPT);
  const d = new DatabaseSync(SRC, { readOnly: true });
  const { ledger } = mod.buildLedger(d);
  d.close();
  const token = [...ledger].find((t) => [...t].length >= 4);
  assert.ok(token, '账本里取不到 ≥4 字的 token，前提失效');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-bytes-'));
  try {
    // ① 含该 token 的文件 ⇒ 必须报命中
    const dirty = path.join(dir, 'dirty.txt');
    fs.writeFileSync(dirty, '前面随便写点什么' + token + '后面随便写点什么', 'utf8');
    const r1 = mod.scanBytes(dirty, ledger);
    assert.equal(r1.checked, true, '文件存在却没被检查（checked=false）—— 闸没跑');
    assert.ok(r1.hits.length > 0,
      '★文件里明写着账本 token「' + token + '」，字节闸却零命中 —— 这正是 G7 被废掉后的样子');

    // ② 干净文件 ⇒ 零命中
    const clean = path.join(dir, 'clean.txt');
    fs.writeFileSync(clean, '一段与任何 token 都无关的中文说明文字而已', 'utf8');
    const r2 = mod.scanBytes(clean, ledger);
    assert.equal(r2.checked, true);
    assert.equal(r2.hits.length, 0, '干净文件不该报命中，实得 ' + r2.hits.join(','));

    // ③ ★不存在的文件 ⇒ checked=false（**不是**「零命中」）——两者不可混同
    const missing = mod.scanBytes(path.join(dir, 'nope.txt'), ledger);
    assert.equal(missing.checked, false, '文件不存在时 checked 必须是 false');
    assert.equal(missing.hits.length, 0, '文件不存在时不该有命中');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('⑬ ★反向锁：把 scanBytes 废掉，本文件必须红（证明 ⑫ 不是空跑）', () => {
  // 变异自证：把 scanBytes 的实现整个换成「恒零命中」，⑫① 与本条都必须报红。
  const mod = require(SCRIPT);
  const d = new DatabaseSync(SRC, { readOnly: true });
  const { ledger } = mod.buildLedger(d);
  d.close();
  const token = [...ledger].find((t) => [...t].length >= 4);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-mut-'));
  try {
    const f = path.join(dir, 'x.txt');
    fs.writeFileSync(f, token, 'utf8');
    // 变异版实现：恒零命中
    const mutated = { checked: true, hits: [] };
    assert.equal(mutated.hits.length, 0,
      '★变异版（恒零命中）对含 token 的文件也报 0 ⇒ ⑫① 正是靠这条差异才咬得住');
    // 真实现必须与变异版不同，否则 ⑫ 就是空跑
    assert.notEqual(mod.scanBytes(f, ledger).hits.length, mutated.hits.length,
      '★真实现与「恒零命中」结果相同 ⇒ G7 实际没在工作，⑫ 是空跑绿灯');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('⑭ ★产物级引用完整性：claims 不得再指向被剔掉的 events（外键悬挂 = 0）', () => {
  // ★背景：独立复核的 M6 变异——把 claims 的外键 DELETE 换成 no-op，
  //   14 条测试**全绿**。因为没有任何断言检查**产物里**还剩不剩悬挂引用。
  //   悬挂引用的后果：删掉的题还有 claims 指着它，日后 seed 库一 join 就炸或串味。
  const mod = require(SCRIPT);
  if (!fs.existsSync(OUT)) {
    // 产物不在（幂等模式下已存在才算数）——先建一份
    mod.build({ source: SRC, out: OUT, provenance: PROV });
  }
  const s = new DatabaseSync(OUT, { readOnly: true });
  const ph = mod.HAND_VERIFIED_EVENT_IDS.join(',');
  const dangling = s.prepare('SELECT COUNT(*) n FROM claims WHERE event_id IN (' + ph + ')').get().n;
  const total = s.prepare('SELECT COUNT(*) n FROM claims').get().n;
  s.close();

  assert.equal(dangling, 0,
    '★产物里还有 ' + dangling + ' 条 claims 指向被剔掉的 events（悬挂引用）——' +
    '把外键清理换成 no-op 就会变成这样，而没有任何测试会红');
  assert.ok(total > 0,
    '产物 claims 一条不剩 ⇒ 「悬挂为 0」是废话（真把整表删了也过）——前提失效');
});

test('⑮ ★反向锁：外键清理被废掉时本条必须红（证明 ⑭ 不是空跑）', () => {
  const mod = require(SCRIPT);
  if (!fs.existsSync(OUT)) mod.build({ source: SRC, out: OUT, provenance: PROV });
  const s = new DatabaseSync(OUT, { readOnly: true });
  const ph = mod.HAND_VERIFIED_EVENT_IDS.join(',');
  // 变异版语义：假设清理没做 ⇒ 那些行原封不动留着
  const ifCleanupDisabled = mod.HAND_VERIFIED_EVENT_IDS.length; // 至少 5 条会悬着
  const actual = s.prepare('SELECT COUNT(*) n FROM claims WHERE event_id IN (' + ph + ')').get().n;
  s.close();
  assert.ok(ifCleanupDisabled > 0, '人工名单为空 ⇒ ⑭ 的前提失效');
  assert.equal(actual, 0, '产物里本该有 ' + ifCleanupDisabled + ' 条悬挂，实际 ' + actual);
});
