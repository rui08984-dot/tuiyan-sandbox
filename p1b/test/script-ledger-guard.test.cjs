'use strict';
/**
 * 脚本层账本不可变闸（2026-09-28 · 收口 A）
 *
 * 病象：`p1b/scripts/` 下多个脚本拿裸 `conn.prepare('UPDATE predictions …')` 直写账本，
 *   绕开 store、绕开 HTTP 校验器。裸写没有「已落定行不许改」的条件，
 *   于是 `judge-runner.cjs` 那类 TOCTOU 缺陷在 13 个文件里重复存在——
 *   2026-09-28 的修复收据只补了 `judge-runner.cjs` 一个文件（加 `AND outcome IS NULL`），
 *   `backfill-checklist-hash.cjs:16` 至今缺同型守卫。
 *
 * ★本闸只管**脚本层**，不碰 `p1b/src/db/predictionsStore.js`（读侧与写侧契约是另一条车道）。
 *   `judge-runner.cjs:105` 作者自认的「不含任何不可变守卫，勿当护栏看」是本闸存在的理由。
 *
 * 规则只有两条，硬到不能靠自觉：
 *   R1 任何 `UPDATE/INSERT/DELETE predictions` 站点，
 *      要么 SQL 自带 `AND outcome IS NULL`（原子守卫，靠 SQLite 单语句挡 TOCTOU），
 *      要么进下面的 `EXEMPT` 豁免白名单**并写明为什么**。二选一，没有第三条路。
 *   R2 豁免名单本身要被断言：条目必须指向活站点、理由不得为空、临时库/CAS 类豁免
 *      必须交出**自身证据**（如 `os.tmpdir()` 出现在文件里），不许只写一句人话。
 *
 * 豁免不是「把闸门放宽」，是把「有意为之的重写」从**默认禁止**挪到**显式登记**：
 * 谁能豁免、豁免什么、为什么豁免，全部落在下面这张表里，改一行就有人看见。
 */

// 2026-09-28 生产库实测（只读查询 `E:/music player/p1a-terminal/data/p1a.db`，1994 行；outcome 分布
// NULL 294 / false 816 / true 884）：
//   checklist_hash IS NULL = 57 行，其中 31 行已落定（但这 57 行的 evidence.kind 全不在 MAP 里，
//     脚本实跑「可回填 0 / 无映射跳过 57」⇒ 今天实际不写任何行）；
//   baseRateNote 有值但 baseRate 未结构化 = 216 行，其中 193 行已落定（这 216 个候选又被脚本自己的
//     三读序安全校验全判 unsafe，理由 G2 不一致 203 条 ⇒ 实跑「rows to backfill = 0」）；
//   game_id 8..37 的 450 行 evidence_json 已 100% 非空（backfill-evidence 的活已干完）；
//   bug-28 的 3 行（kind=red_contains 且 ball=null）已清零，实跑命中 0 行。
// ⇒ 「回填类脚本本就要触达已落定行」是事实（它们的工作面就是已落定行），故对它们用**比 outcome
//   守卫更强**的列级/pre-image 守卫，而非放宽闸门，并逐条登记在 EXEMPT 里说明为什么这样够。
//   注意：守卫是给「将来」准备的——今天这些脚本多数实跑 0 行，但闸管的是**能力**不是当次行为。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');

/**
 * 豁免白名单——每条都必须写清「为什么允许它改账本」。
 * kind 取值：
 *   temp-db    写的是脚本自建的临时库，压根不碰生产账本
 *   copy-db    写的是现库副本，脚本自述「生产库零写」
 *   probe      自插自删的探针行，且删除带 statement 二次确认
 *   col-cas    写的列不在真值链（outcome/evidence_json/assigned_prob），守卫是「只填空位不覆盖已有值」
 *   empty-only 写的列在真值链，但守卫是「evidence_json 非空即拒改」——只可能往空格里写，永远不覆盖既有真值
 *   additive-cas  写的列在真值链，守卫是**写前逐字节 pre-image CAS**（并发改写必被拒），
 *                 只能纯加键、不能重写既有真值 spec——这是它敢触达已落定行的唯一理由
 * contains：必须能在该文件里原样找到的一串 SQL 文本（防白名单条目腐化/张冠李戴）
 * evidence：临时库/CAS 类豁免必须交出的自身证据 token（必须出现在该文件里）
 */
const EXEMPT = [
  {
    file: '_b1-g2-backtest-e2e.cjs',
    kind: 'temp-db',
    contains: 'INSERT INTO predictions (game_id, day, source_type',
    evidence: '_b1-backtest-e2e.db',
    reason: '端到端证明回测排除子句生效：脚本自己 unlink 后在 p1b/sim/out/ 新建一个空库，'
      + '表都是自己 SELECT sql 拼出来的，行全部是当场造的前瞻/回测样例。生产账本零触。',
  },
  {
    file: '_rollback-template.cjs',
    kind: 'probe',
    contains: 'rollback probe',
    reason: '回滚验收要证「旧 CHECK 真的挡住了 unknown」：必须真插一行拿 SQLITE_CONSTRAINT_CHECK 的报错，'
      + '故只能以可写连接打生产库。防误伤靠两点——插的是 statement=rollback probe 的垃圾行，'
      + '删时带 statement 二次确认（id 对上但内容不是探针行就删不掉）。',
  },
  {
    file: 'archive/_bd-backfill-matures.cjs',
    kind: 'col-cas',
    contains: 'SET matures_at=? WHERE id=? AND matures_at IS NULL',
    reason: 'matures_at（到期日）是批次1 卫生列，不在真值链 outcome/evidence_json/assigned_prob 上，'
      + '改它不改任何判定依据。守卫是列级 CAS：matures_at 已有值的行一律拒改，'
      + '只补 NULL 位，故天然幂等、不会覆盖别人算出的到期日。',
  },
  {
    file: 'backfill-base-rate.cjs',
    kind: 'additive-cas',
    contains: 'WHERE id = ? AND evidence_json = ?',
    reason: '★唯一一条被授权触达已落定行并改 evidence_json 的脚本。实测（2026-09-28 只读）候选集 216 行、'
      + '其中 193 行已落定——它的职责就是把文本注记物化成结构化 baseRate，价值恰恰在已落定行上，'
      + '故不能用 outcome 守卫（会把这条通道掐死）。改用**写前逐字节 pre-image CAS**：'
      + '并发或事后重写一律 changes=0 拒改，再叠加脚本自带 pureAdd 写后校验（删掉新 baseRate 键后'
      + '须与写前逐字节等值），可证它只增 baseRate 键、绝不重写 resolve 真值 spec，也不动 outcome/assigned_prob。'
      + '如实记录：那 216 个候选目前全被脚本自己的三读序安全校验判为 unsafe，实际待写 0 行。',
  },
  {
    file: 'backfill-checklist-hash.cjs',
    kind: 'col-cas',
    contains: 'WHERE id=? AND checklist_hash IS NULL',
    reason: 'checklist_hash 是清单版本标签（如 v2），不是判定值，改它不改变任何题的结论。'
      + '守卫是列级 CAS：只给 NULL 的行补标签，已有标签（含别人刚补的）一律拒改，'
      + '因此不可能把一条已判定行的清单版本改掉。',
  },
  {
    file: 'backfill-evidence.cjs',
    kind: 'empty-only',
    contains: "WHERE id = ? AND (evidence_json IS NULL OR evidence_json = '' OR evidence_json = '[]')",
    reason: 'evidence_json 在真值链上，但本脚本的职责是**补回丢失的证据链**（写端 bug 导致 evidence_json 空），'
      + '不是重写。守卫即业务语义：evidence_json 非空一律拒改——哪怕内容看着不对也不在这里动，'
      + '「错证据怎么处置」要另立裁定。所以它能触达已落定行，但只可能写进**空格子**，'
      + '永远不会覆盖任何既有真值 spec。实测 2026-09-28：gid 8-37 的 450 行证据已 100% 非空，该活已干完。',
  },
  {
    file: 'batch1-write-window.cjs',
    kind: 'col-cas',
    contains: 'SET public_exposure = 0 WHERE public_exposure IS NULL',
    reason: 'public_exposure 是批次1 卫生列（设计上非 L4 层=0），不在真值链上。'
      + '本意就是一次 879 行 NULL→0 的批量补默认值，守卫是列级 CAS：只填 NULL，'
      + '已被显式设为 1 的「公开曝光」行一律拒改。',
  },
  {
    file: 'merged-migration.cjs',
    kind: 'copy-db',
    contains: 'INSERT INTO predictions (game_id, source_type, statement, layer, secondary_layer)',
    evidence: 'mkCopy',
    reason: '迁移验收红/绿对照：脚本自己 mkCopy 出 pre/post 两份副本库，所有 INSERT/DELETE 只发生在副本上，'
      + '文件头已自述「全部 INSERT 只发生在副本库；生产库仅做只读对账」，写完立刻按自增 rowid 自删。',
  },
  {
    file: 'merged-migration.cjs',
    kind: 'copy-db',
    contains: "DELETE FROM predictions WHERE id = ? AND statement = 'D-8.1 unknown 入账验收（副本库临时行）'",
    evidence: 'mkCopy',
    reason: '上面那次 INSERT 的收尾删除：只删「本脚本自己刚插进去的验收行」，且删除带 statement 二次确认，'
      + 'id 对错也删不到真实行。目标库是 mkCopy 出来的副本，生产库零触。',
  },
  {
    file: 'ui-refactor-evidence.cjs',
    kind: 'temp-db',
    contains: "INSERT INTO predictions (game_id, source_type, statement",
    evidence: 'os.tmpdir()',
    reason: 'UI 重构的 DOM/对比度验收要一份确定的种子数据，种子写在 os.tmpdir() 的一次性库里，'
      + '跨进程不共享、退出即弃。裸写只为绕开 store 的必填校验塞一条 R4 样例，生产账本零触。',
  },
  {
    file: 'ui-refactor-probe.cjs',
    kind: 'temp-db',
    contains: "INSERT INTO predictions (game_id, source_type, statement",
    evidence: 'os.tmpdir()',
    reason: '同 ui-refactor-evidence：before/after 截图对比的种子库建在 os.tmpdir()，'
      + '文件名带 label 与 pid，端口也是隔离的 8791，零碰 8787 生产实例。',
  },
];

// ── 扫描器：抓出脚本里所有裸写 predictions 的 SQL 站点 ────────────────────────
// 注意 `predictions_public` 不是 predictions —— 用 \b 词界把 gd2-0-accept.cjs 这类
// 「写公开视图」的脚本排除掉，否则闸会对着不相干的表报警。
const LIT = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const RAW = /\b(UPDATE\s+predictions\b|INSERT\s+INTO\s+predictions\b|DELETE\s+FROM\s+predictions\b)/i;

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.cjs')) acc.push(p);
  }
  return acc;
}

/** 返回 [{rel, line, sql, op}]：rel 为相对 scripts/ 的 posix 路径。 */
function scanSites() {
  const out = [];
  for (const abs of walk(SCRIPTS, [])) {
    const src = fs.readFileSync(abs, 'utf8');
    const rel = path.relative(SCRIPTS, abs).split(path.sep).join('/');
    let m;
    LIT.lastIndex = 0;
    while ((m = LIT.exec(src)) !== null) {
      const sql = m[2];
      const hit = RAW.exec(sql);
      if (!hit) continue;
      out.push({
        rel,
        line: src.slice(0, m.index).split('\n').length,
        sql: sql.replace(/\\'/g, "'").replace(/\\"/g, '"'),
        op: hit[1].split(/\s+/i)[0].toUpperCase(),
      });
    }
  }
  return out;
}

const SITES = scanSites();

/** 该 SQL 是否自带 outcome 守卫（原子条件，与赋值同在一条语句里）。 */
const hasOutcomeGuard = (sql) => /AND\s+outcome\s+IS\s+NULL/i.test(sql);
/** 该 SQL 是否带复合 WHERE（至少一个额外条件）。 */
const hasCompoundWhere = (sql) => {
  const w = sql.slice(sql.search(/\bWHERE\b/i));
  return /\bAND\b/i.test(w);
};

function sqlOf(rel, contains) {
  const hits = SITES.filter((s) => s.rel === rel && s.sql.includes(contains));
  assert.equal(hits.length, 1,
    `期望 ${rel} 里恰好一条含「${contains}」的裸写，实际 ${hits.length} 条（白名单/断言可能已腐化）`);
  return hits[0].sql;
}

// ── 临时库骨架：只建被守卫站点写到的列，不建全表（够验守卫语义即可） ──────────
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE predictions (
    id INTEGER PRIMARY KEY,
    statement TEXT,
    outcome TEXT,
    evidence_json TEXT,
    checklist_hash TEXT,
    assigned_prob REAL,
    public_exposure INTEGER,
    matures_at TEXT
  )`);
  return db;
}

// ══ R1：扫描闸 —— 每个裸写站点要么自带 outcome 守卫，要么在白名单里写明理由 ══

test('R1 扫描闸：predictions 裸写站点必须带 outcome 守卫或显式登记豁免', () => {
  assert.ok(SITES.length > 0, '扫描器一个站点都没抓到——正则坏了，闸是假绿，必须先修扫描器');

  const orphan = [];
  for (const s of SITES) {
    if (hasOutcomeGuard(s.sql)) continue;                 // 自带原子守卫，放行
    if (EXEMPT.some((e) => e.file === s.rel && s.sql.includes(e.contains))) continue; // 显式豁免
    orphan.push(`${s.rel}:${s.line} [${s.op}] ${s.sql.slice(0, 96)}`);
  }
  assert.deepEqual(orphan, [],
    '以下 predictions 裸写既没有 `AND outcome IS NULL` 守卫，也没登记豁免理由：\n  ' + orphan.join('\n  '));
});

test('R1b 复合 WHERE：所有 UPDATE predictions 都必须带至少一个额外条件（已登记豁免的除外）', () => {
  const bare = SITES.filter((s) => s.op === 'UPDATE' && !hasCompoundWhere(s.sql)
    && !EXEMPT.some((e) => e.file === s.rel && s.sql.includes(e.contains)));
  assert.deepEqual(bare.map((s) => `${s.rel}:${s.line} ${s.sql.slice(0, 96)}`), [],
    '裸 `UPDATE predictions SET … WHERE id = ?` 只按主键定位：并发落定/人工回填会被直接改脏。');
});

test('R1c 生产库禁令：不得在 predictions 账本上做无守卫 DELETE', () => {
  // 已登记的 probe 类豁免里，删除语句必须带二次确认条件，否则从白名单里剔除
  for (const e of EXEMPT.filter((x) => x.kind === 'probe')) {
    const del = SITES.filter((s) => s.rel === e.file && s.op === 'DELETE');
    assert.ok(del.length >= 1, `${e.file} 登记为 probe 豁免却找不到 DELETE 站点`);
    for (const d of del) {
      assert.ok(hasCompoundWhere(d.sql),
        `${e.file}:${d.line} 的 DELETE 必须是复合 WHERE（带上插行时的 statement 二次确认），否则 id 一旦对错就误删真实行`);
    }
  }
});

// ══ R2：豁免名单本身要被断言 ════════════════════════════════════════════════

test('R2 豁免白名单：每条都要指向活站点、理由非空、临时库/CAS 类交出自身证据', () => {
  for (const e of EXEMPT) {
    const abs = path.join(SCRIPTS, e.file);
    assert.ok(fs.existsSync(abs), `豁免条目指向不存在的文件：${e.file}`);

    const src = fs.readFileSync(abs, 'utf8');
    assert.ok(src.includes(e.contains),
      `${e.file} 里已找不到「${e.contains}」——豁免条目腐化，删掉或重新登记`);

    assert.ok(['temp-db', 'copy-db', 'probe', 'col-cas', 'empty-only', 'additive-cas'].includes(e.kind),
      `${e.file} 的豁免 kind 非法：${e.kind}`);
    assert.ok(typeof e.reason === 'string' && e.reason.trim().length >= 20,
      `${e.file} 的豁免必须写明为什么（≥20 字），不许只占个位`);

    if (e.evidence) {
      assert.ok(src.includes(e.evidence),
        `${e.file} 登记为「不碰生产账本」却不含自身证据「${e.evidence}」——理由是空话，闸不放行`);
    }
  }
});

test('R2b 豁免白名单不得腐化：每条都必须仍对应一个真实裸写站点（不许白养条目）', () => {
  for (const e of EXEMPT) {
    const live = SITES.filter((s) => s.rel === e.file && s.sql.includes(e.contains));
    assert.ok(live.length >= 1,
      `${e.file} 的豁免已无对应站点（SQL 删了/改了）——请删掉该豁免条目，否则闸在给不存在的东西开绿灯`);
  }
});

test('R2c 豁免必须精确到站点：不得一个条目笼统放行整文件', () => {
  // 按文件聚合：该文件里每一个「没 outcome 守卫」的裸写站点，都必须被**本文件某条**豁免
  // 的 contains 精确命中。逐条目比会误判（同文件两条豁免各自只看自己那条）。
  const files = [...new Set(EXEMPT.map((e) => e.file))];
  for (const rel of files) {
    const entries = EXEMPT.filter((e) => e.file === rel);
    const uncovered = SITES.filter((s) => s.rel === rel && !hasOutcomeGuard(s.sql)
      && !entries.some((e) => s.sql.includes(e.contains)));
    assert.deepEqual(uncovered.map((s) => `L${s.line} ${s.sql.slice(0, 80)}`), [],
      `${rel} 里还有未被任何豁免条目覆盖的裸写站点（豁免必须一站点一条）`);
  }
});

// ══ 逐站点回归断言：拿脚本里**原样那条 SQL** 去撞一个已落定行 ══════════════
// 断言形态随守卫形态走：
//   outcome 守卫  → 已落定行拒改 / 未落定行放行
//   列级 CAS      → 已有值的行拒改 / NULL 位放行（只填空不覆盖）
//   pre-image CAS → 写前快照对不上就拒改（并发改写必被挡）

/** outcome 守卫站点：已落定行必须纹丝不动，未落定行照改。 */
function assertOutcomeGuard(rel, contains, col, newVal, oldVal = 'OLD') {
  const db = freshDb();
  db.prepare('INSERT INTO predictions (id,statement,outcome,evidence_json,checklist_hash,assigned_prob) VALUES (?,?,?,?,?,?)')
    .run(1, '已落定题', 'true', 'OLD', 'OLD', 0.1);
  db.prepare('INSERT INTO predictions (id,statement,outcome,evidence_json,checklist_hash,assigned_prob) VALUES (?,?,?,?,?,?)')
    .run(2, '未落定题', null, 'OLD', 'OLD', 0.1);
  const sql = sqlOf(rel, contains);
  const n = (sql.match(/\?/g) || []).length;
  const bind = (id) => (n === 2 ? [newVal, id] : [newVal, id, 'OLD']);

  const r1 = db.prepare(sql).run(...bind(1)).changes;
  const r2 = db.prepare(sql).run(...bind(2)).changes;
  const settled = db.prepare(`SELECT ${col} v FROM predictions WHERE id=1`).get().v;
  const open = db.prepare(`SELECT ${col} v FROM predictions WHERE id=2`).get().v;

  assert.equal(r1, 0, `${rel}: 已落定行不该被改（changes=0 才算守住）`);
  assert.equal(settled, oldVal, `${rel}: 已落定行的 ${col} 被改脏了——账本不可变破了`);
  assert.equal(r2, 1, `${rel}: 未落定行必须放行，否则守卫过宽把正常写入也堵死`);
  assert.equal(open, newVal, `${rel}: 未落定行没写成`);
  db.close();
}

/** pre-image CAS 站点：写前快照对不上（并发/事后重写）一律拒改。 */
function assertPreimageCas(rel, contains) {
  const db = freshDb();
  db.prepare('INSERT INTO predictions (id,statement,outcome,evidence_json) VALUES (?,?,?,?)')
    .run(1, '已落定题', 'true', 'STALE');
  db.prepare('INSERT INTO predictions (id,statement,outcome,evidence_json) VALUES (?,?,?,?)')
    .run(2, '未落定题', null, 'OLD');
  const sql = sqlOf(rel, contains);
  const n = (sql.match(/\?/g) || []).length;
  assert.equal(n, 3, `${rel}: pre-image CAS 应有 3 个绑定（new, id, pre-image）`);

  const r1 = db.prepare(sql).run('NEW', 1, 'OLD').changes;   // 快照已过期
  const r2 = db.prepare(sql).run('NEW', 2, 'OLD').changes;   // 快照仍对得上
  assert.equal(r1, 0, `${rel}: 写前 pre-image 对不上还照写 ⇒ 并发改写没被挡住`);
  assert.equal(db.prepare('SELECT evidence_json v FROM predictions WHERE id=1').get().v, 'STALE',
    `${rel}: 已落定行被改脏了——CAS 没兜住`);
  assert.equal(r2, 1, `${rel}: pre-image 一致时必须放行`);
  assert.equal(db.prepare('SELECT evidence_json v FROM predictions WHERE id=2').get().v, 'NEW');
  db.close();
}

// —— 五个真值链站点（每处一条回归断言）——

test('回归 · backfill-baserate-note.cjs：已落定行的 evidence_json 拒改', () => {
  assertOutcomeGuard('backfill-baserate-note.cjs', 'UPDATE predictions SET evidence_json', 'evidence_json', '{"note":"x"}');
});

test('回归 · backfill-evidence.cjs：只准给空证据的已落定行补链，不得覆盖既有证据', () => {
  const db = freshDb();
  db.prepare('INSERT INTO predictions (id,statement,outcome,evidence_json) VALUES (?,?,?,?)').run(1, '已落定·证据已齐', 'true', '[{"resolve":{"kind":"cwl_ssq_blue_odd"}}]');
  db.prepare('INSERT INTO predictions (id,statement,outcome,evidence_json) VALUES (?,?,?,?)').run(2, '已落定·证据空', 'true', '[]');
  const sql = sqlOf('backfill-evidence.cjs', 'UPDATE predictions SET evidence_json');
  db.prepare(sql).run('[1]', 1);
  db.prepare(sql).run('[1]', 2);
  assert.equal(db.prepare('SELECT evidence_json v FROM predictions WHERE id=1').get().v, '[{"resolve":{"kind":"cwl_ssq_blue_odd"}}]',
    'backfill-evidence 覆盖了已有证据链 ⇒ 账本可被追溯地改写');
  assert.equal(db.prepare('SELECT evidence_json v FROM predictions WHERE id=2').get().v, '[1]',
    '证据为空的行没补上链');
  db.close();
});

test('回归 · fix-bug28-cwl-kind.cjs：已落定行的 resolve spec 拒改（把脚本的事前 abort 变成 SQL 原子条件）', () => {
  assertOutcomeGuard('fix-bug28-cwl-kind.cjs', 'UPDATE predictions SET evidence_json', 'evidence_json', '[{"resolve":{"kind":"cwl_ssq_blue_odd"}}]');
});

test('回归 · judge-runner.cjs：已补的 outcome 守卫不许被改回去', () => {
  assertOutcomeGuard('judge-runner.cjs', 'UPDATE predictions SET assigned_prob', 'assigned_prob', 0.42, 0.1);
});

test('回归 · backfill-checklist-hash.cjs：清单版本只补 NULL，已有标签（含已落定行）一律拒改', () => {
  const db = freshDb();
  db.prepare('INSERT INTO predictions (id,statement,outcome,checklist_hash) VALUES (?,?,?,?)').run(1, '已落定·标签已填', 'true', 'v2');
  db.prepare('INSERT INTO predictions (id,statement,outcome,checklist_hash) VALUES (?,?,?,?)').run(2, '未填标签', null, null);
  const sql = sqlOf('backfill-checklist-hash.cjs', 'UPDATE predictions SET checklist_hash');
  assert.equal(db.prepare(sql).run('v2', 1).changes, 0, '已填 checklist_hash 的行被覆盖了');
  assert.equal(db.prepare(sql).run('v2', 2).changes, 1, 'NULL 位没补上');
  assert.equal(db.prepare('SELECT checklist_hash v FROM predictions WHERE id=1').get().v, 'v2');
  assert.equal(db.prepare('SELECT checklist_hash v FROM predictions WHERE id=2').get().v, 'v2');
  db.close();
});

test('回归 · backfill-base-rate.cjs：pre-image CAS 挡住并发改写（唯一被授权触达已落定行的脚本）', () => {
  assertPreimageCas('backfill-base-rate.cjs', 'UPDATE predictions SET evidence_json');
});

test('回归 · archive/_bd-backfill-matures.cjs：matures_at 只补 NULL，已有到期日拒改', () => {
  const db = freshDb();
  db.prepare('INSERT INTO predictions (id,statement,outcome,matures_at) VALUES (?,?,?,?)').run(1, '已落定·到期日已定', 'true', '2026-01-01');
  db.prepare('INSERT INTO predictions (id,statement,outcome,matures_at) VALUES (?,?,?,?)').run(2, '未填到期日', null, null);
  const sql = sqlOf('archive/_bd-backfill-matures.cjs', 'UPDATE predictions SET matures_at');
  assert.equal(db.prepare(sql).run('2026-12-01', 1).changes, 0, '已有 matures_at 的行被覆盖了');
  assert.equal(db.prepare(sql).run('2026-12-01', 2).changes, 1, 'NULL 位没补上');
  assert.equal(db.prepare('SELECT matures_at v FROM predictions WHERE id=1').get().v, '2026-01-01');
  db.close();
});
