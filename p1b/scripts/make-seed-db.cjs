'use strict';
/**
 * p1b/scripts/make-seed-db.cjs —— 种子库构建 ＋ 隐私体检（模块 privacy-seed，2026-09-30）
 *
 * 为什么有它：陌生人第一次打开这个工具时看到的第一批数据，不能是未经同意的真实玩家信息。
 * 本脚本从 `p1a.db` 拷出结构与读数，**剔掉 4 个真实玩家的昵称行与对他们��角色判断**，
 * 并产出一份 `seed_provenance.json` 写清「剔了什么、为什么、剩多少」。
 *
 * ★**三条硬纪律**（照 `secret-preflight.cjs` 的范式）：
 *   ① **绝不打印被剔掉的原文**。只打印条数与 id；昵称 token 账本**只在内存里**，
 *      绝不写进任何日志／收据／测试夹具（spec Boundaries: Never）。
 *   ② **绝不联网**。只碰本地文件。
 *   ③ **默认只读**。不带 `--out` 只做体检，不写盘；带 `--out` 也**只写 `--out` 指的那个文件**。
 *
 * ★**账本不可变**：来源 `p1a.db` 全程以 `readOnly: true` 打开，剔除动作在**副本**上做；
 * 构建收尾会复核来源 sha256 前后一致，把「没写过来源」做成一张收据。
 *
 * 用法：
 *   node p1b/scripts/make-seed-db.cjs --out seed/p1a-seed.db   # 构建（幂等：已存在则 exit 3，不覆盖）
 *   node p1b/scripts/make-seed-db.cjs --check-only             # 只体检默认种子库（发布闸）
 *   node p1b/scripts/make-seed-db.cjs --check-only --target X  # 体检任意库（反向锁用）
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const DEFAULT_OUT = path.join(ROOT, 'seed', 'p1a-seed.db');
const DEFAULT_PROVENANCE = path.join(ROOT, 'seed', 'seed_provenance.json');

/**
 * ★人工核出的 5 行真人昵称行（spec「隐私判据」一节；2026-09-30 逐行人工核对，5 行全在 game_id=1）。
 * 只记 id，**不记原文**——原文是那 4 个人的名字，spec Boundaries: Never。
 * 复核办法：`SELECT id,game_id,length(raw_text) FROM events WHERE id IN (1,2,3,4,5)`，
 *          再配合 `--audit` 看模式统计（本脚本不打印原文）。
 */
const HAND_VERIFIED_EVENT_IDS = Object.freeze([1, 2, 3, 4, 5]);

/** spec 判据「N号+昵称」＝ 阿拉伯数字 + 号 + **紧邻**（无分隔）的中文/字母。 */
const SEAT_NICK_RE = /(\d+)号([一-鿿㐀-䶿A-Za-z]+)/g;
/** ★上游那个「含中文且含号」的机械判据，只用来**报数**（它是假阳性机，剔了会把种子库掏空）。 */
const isMechanicalCJKHao = (s) => /[一-鿿]/.test(s) && String(s).includes('号');

const 零泄漏表 = Object.freeze(['analytics_events', 'analytics_sessions', 'analytics_visitors', 'question_owners']);

/**
 * ★**应用启动时自建的表** —— G6 结构锁唯一不参与比对的一小份名单（2026-09-30 定）。
 *
 * `app_meta` 由 `p1b/src/schemaVersion.js:53` 的 `APP_META_DDL` 在**服务启动时**建出来
 * （内容就一行 `schema_version=1`）。它是**应用运行时元数据，不是来源数据**，所以
 * 拿它去卡「种子库结构是否与来源一致」是拿错了尺子：
 *   · 它不属于「种子库该有的一切数据表」，剔它不是隐私工作，剔它也不是「剔除过头」；
 *   · **种子库不需要它** —— 首次启动时 schemaVersion 自己会建。`schemaVersion.js:188-192`
 *     把「盘上还没有 app_meta（null）」明确写成首装的**正常路径**，`migrate()` 走
 *     null → 登记，既不备份也不报错。所以「种子库零启动就位」这件事它是天生的。
 *
 * ★**为什么它当初会把闸门顶红（实测，非推断）**：来源 `p1a.db` 是 WAL 模式，而建 `app_meta`
 *   的那个事务还留在**未 checkpoint 的 `-wal`** 里。于是两边的可见性对不上：
 *     · 走 SQLite 连接读来源 → `-wal` 会被读进来 ⇒ 看得见 21 张表；
 *     · `build()` 的 `fs.copyFileSync` → **只拷主库文件，不拷 `-wal`** ⇒ 产物 20 张表。
 *   谁先按 README 起一次服务，这道闸就红一次。属于「正常使用即触发」。
 *
 * ★**排除必须两侧都做**，不能只排来源。否则哪天 `-wal` 被 checkpoint 进主库，
 *   `copyFileSync` 就会把 `app_meta` 一起带进产物，届时「只排来源」反而变成产物多出一张表，照红。
 *
 * ★**这份名单不是万能橡皮擦**：它只列应用自己建的表，G6 仍按**表名集合**逐张比，
 *   少一张真数据表照样红（`make-seed-db.test.cjs` 有反向锁钉死这一点）。
 *   ★要往里加名字，先回答一句：**这张表是应用建的，还是数据带来的？**
 *   视图不在本名单内 —— 若将来应用会自建视图，让它照红，那需要的是一次真的产品决定。
 */
const 应用自建表 = Object.freeze(['app_meta']);

// ── 工具 ─────────────────────────────────────────────────────────────
function sha256File(p) {
  const fd = fs.openSync(p, 'r');
  try {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    return h.digest('hex');
  } finally { fs.closeSync(fd); }
}

/** 抽 CJK/拉丁串（昵称就是这类串） */
function runs(s) {
  return String(s).match(/[一-鿿㐀-䶿A-Za-z]+/g) || [];
}

/** 一个串的全部 len..len+hi 字子串 */
function subgrams(s, lo, hi) {
  const out = new Set();
  const a = [...s];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + lo; j <= Math.min(a.length, i + hi); j++) out.add(a.slice(i, j).join(''));
  }
  return out;
}

const 列 = (db, table) => {
  try { return db.prepare(`PRAGMA table_info("${table}")`).all(); } catch { return []; }
};
const 表存在 = (db, name) => {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name); } catch { return false; }
};
const 行数 = (db, name) => {
  if (!表存在(db, name)) return null;                 // 表不存在 ⇒ 该锁的 0 行天然满足
  try { return db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n; } catch { return null; }
};
const 结构计数 = (db) => {
  const r = db.prepare("SELECT type, COUNT(*) n FROM sqlite_master WHERE type IN ('table','view') GROUP BY type").all();
  const o = { table: 0, view: 0 };
  for (const x of r) o[x.type] = x.n;
  return o;
};
/**
 * 结构签名 = **表名与视图名的有序集合**（不是计数）。
 * ★为什么不用计数：{a,b,c} 与 {a,b,d} 的计数都是 3，计数判「一致」，
 *   而实际上有一张表被换名成了另一张 —— 那正是「剔除过头」的另一种形态。集合比计数严。
 */
const 结构签名 = (db) => {
  const s = { tables: [], views: [] };
  for (const r of db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','view')").all()) {
    (r.type === 'table' ? s.tables : s.views).push(r.name);
  }
  s.tables.sort(); s.views.sort();
  return s;
};
const 排掉自建 = (names) => names.filter((n) => !应用自建表.includes(n));
/**
 * G6 的判据本体。**两侧各自排掉「应用自建表」后**，表名集合与视图名集合必须完全相等。
 * 源基准为 null（`--check-only` 模式）⇒ 无基准可比，返回 ok=true 并把有基准标成 false。
 */
function 比结构(产, 源) {
  const 空 = { 有基准: false, ok: true, 少表: [], 多表: [], 少视图: [], 多视图: [] };
  if (!源) return 空;
  const pt = 排掉自建(产.tables), st = 排掉自建(源.tables);
  const pv = 产.views, sv = 源.views;
  const 少表 = st.filter((n) => !pt.includes(n));
  const 多表 = pt.filter((n) => !st.includes(n));
  const 少视图 = sv.filter((n) => !pv.includes(n));
  const 多视图 = pv.filter((n) => !sv.includes(n));
  return {
    有基准: true,
    ok: !少表.length && !多表.length && !少视图.length && !多视图.length,
    少表, 多表, 少视图, 多视图,
  };
}

// ── 昵称 token 账本（★只在内存里，绝不落盘）───────────────────────────
/**
 * 判据思路：把「被剔掉的那 5 行」拆成 CJK/拉丁 n-gram，**只保留那些在来源库其余部分（全库每一个
 * TEXT 列）再也不出现的**。⇒ 留下来的必然是**只属于那 4 个人的标识**（昵称、口头禅式缩写）；
 * 「跳预言家」「查杀」「金水」这类通用盘话在别处也有，自然被排除 —— 实测 133 个 n-gram 里留下 109 个。
 *
 * ★为什么按「全库」而不是「events 表」划界：早期版本只在 events 里找，结果「当选」「警长」这种
 * 正常词被判成身份标识，把 verdicts.verdict_text 的 164 行合法分析判成泄漏（假阳性）。
 * 划界必须是全库，因为全库才是「这个 token 是不是只属于这 4 个人」的真实答案。
 *
 * 长度下限 2：单字（「狗」「水」）在正常中文里太容易撞，不能当身份标识。
 */
function buildLedger(sourceDb) {
  const removed = sourceDb.prepare(`SELECT id, raw_text FROM events WHERE id IN (${HAND_VERIFIED_EVENT_IDS.join(',')}) ORDER BY id`).all();
  const elsewhere = allTextExceptRemoved(sourceDb);
  const grams = new Set();
  for (const e of removed) for (const r of runs(e.raw_text)) for (const g of subgrams(r, 2, 6)) grams.add(g);
  const ledger = new Set([...grams].filter((g) => !elsewhere.includes(g)));
  return { ledger, removedCount: removed.length, scannedChars: elsewhere.length, gramCount: grams.size };
}

/** 来源库里「除被剔 5 行之外」的全部 TEXT 内容，拼成一个大字符串 */
function allTextExceptRemoved(db) {
  const parts = [];
  const objs = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all();
  for (const { name } of objs) {
    for (const c of 列(db, name)) {
      if (!/TEXT/i.test(c.type || '')) continue;
      try {
        const rows = (name === 'events' && c.name === 'raw_text')
          ? db.prepare(`SELECT raw_text v FROM events WHERE id NOT IN (${HAND_VERIFIED_EVENT_IDS.join(',')})`).all()
          : db.prepare(`SELECT "${c.name}" v FROM "${name}"`).all();
        for (const r of rows) if (r.v != null) parts.push(String(r.v));
      } catch { /* 视图/动态表读不出来就跳过，不影响划界的安全方向：少划＝多留 token＝闸更严 */ }
    }
  }
  return parts.join('\n');
}

/** 真人局 = 有真人昵称行的那几局（数据驱动，不写死 game_id） */
function realGameIds(db) {
  return db.prepare(`SELECT DISTINCT game_id g FROM events WHERE id IN (${HAND_VERIFIED_EVENT_IDS.join(',')}) ORDER BY g`).all().map((r) => r.g);
}

/** 全库任一 TEXT 列里命中账本的行（表名.列名 + 行数，**不打印原文**） */
function scanLedger(db, ledger) {
  const hits = [];
  if (!ledger.size) return hits;
  const objs = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all();
  const scanned = [];
  for (const { name } of objs) {
    for (const c of 列(db, name)) {
      if (!/TEXT/i.test(c.type || '')) continue;
      scanned.push(`${name}.${c.name}`);
      const n = sumHits(db, name, c.name, ledger);
      if (n) hits.push({ where: `${name}.${c.name}`, rows: n });
    }
  }
  hits.scanned = scanned;                     // ★必须报出「扫了几列」——否则「0 命中」可能是空跑绿灯
  return hits;
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[%_]/g, (m) => '\\' + m);

/** ★字节锁：产物文件的原始字节里也不能有账本 token（VACUUM 之后仍能翻出来＝没真删干净） */
function scanBytes(file, ledger) {
  if (!fs.existsSync(file)) return { checked: false, hits: [] };
  const buf = fs.readFileSync(file);
  const hits = [];
  for (const t of ledger) {
    const b = Buffer.from(t, 'utf8');
    if (b.length >= 2 && buf.indexOf(b) !== -1) hits.push(t.length);
  }
  return { checked: true, hits: hits.map((n) => `len${n}`) };
}

// ── 体检闸 ───────────────────────────────────────────────────────────
/**
 * 七道闸。返回 { red:[], rows:[[闸,结论,证据]] }。
 * ★每道闸都**先断言前提**（表在不在、行数是多少）再断言结论 —— 不做「空跑绿灯」。
 *
 * @param sourceSig {tables,views} 结构签名（排掉「应用自建表」后与产物比）；null ＝无基准，G6 不判
 */
function runGates(productPath, ledger, sourceSig, realGames) {
  const rows = [];
  const red = [];
  const put = (ok, name, concl, ev) => { rows.push([ok ? '[OK]' : '[红]', name, concl, ev]); if (!ok) red.push(name + '：' + concl + '（' + ev + '）'); };

  if (!fs.existsSync(productPath)) {
    put(false, 'G0 产物存在', '文件不存在', productPath);
    return { red, rows };
  }
  put(true, 'G0 产物存在', '文件在', productPath);

  const db = new DatabaseSync(productPath, { readOnly: true });
  try {
    // G1 名单锁：这 5 行一条都不许在
    const left = 表存在(db, 'events')
      ? db.prepare(`SELECT COUNT(*) n FROM events WHERE id IN (${HAND_VERIFIED_EVENT_IDS.join(',')})`).get().n : 0;
    put(left === 0, 'G1 真人行名单锁', left === 0 ? '5 行全不在' : '还有 ' + left + ' 行真人行',
        'events.id ∈ {' + HAND_VERIFIED_EVENT_IDS.join(',') + '} → ' + left);

    // G2 events 昵称锁
    const evTotal = 行数(db, 'events');
    const evHits = sumHits(db, 'events', 'raw_text', ledger);
    put(evHits === 0, 'G2 events 昵称锁', evHits === 0 ? '0 行命中身份 token' : '还有 ' + evHits + ' 行命中',
        '账本 ' + ledger.size + ' token × events.raw_text（' + evTotal + ' 行事件）→ 命中 ' + evHits + ' 行');

    // G3 全库锁：任何表的任何 TEXT 列都不能命中
    const allHits = scanLedger(db, ledger);
    put(allHits.length === 0, 'G3 全库身份锁', allHits.length === 0 ? '全库 0 命中' : allHits.map(h => h.where + ' ' + h.rows + ' 行').join('，'),
        '扫了 ' + allHits.scanned.length + ' 个 TEXT 列 × ' + ledger.size + ' token → ' + (allHits.length ? allHits.map(h => h.where + '×' + h.rows).join(',') : '0 命中'));

    // G4 hypotheses 锁：spec 要求整表 0（6 行真人判断全剔）
    const hy = 行数(db, 'hypotheses');
    put(hy === 0, 'G4 hypotheses 锁', hy === 0 ? '0 行' : '还有 ' + hy + ' 行', 'hypotheses → ' + hy);

    // G4b contradictions 锁：真人局上的角色判断一条都不许留
    const rg = (realGames || []).join(',') || '-1';
    const ct = 表存在(db, 'contradictions') ? db.prepare(`SELECT COUNT(*) n FROM contradictions WHERE game_id IN (${rg})`).get().n : 0;
    put(ct === 0, 'G4b 角色判断锁', ct === 0 ? '0 行' : '还有 ' + ct + ' 行',
        'contradictions WHERE game_id ∈ {' + rg + '} → ' + ct + '（全表 ' + (行数(db, 'contradictions') ?? '无表') + ' 行）');

    // G5 零泄漏锁
    const leak = 零泄漏表.map((t) => t + '=' + (行数(db, t) ?? '(无表)')).join(' ');
    const leakTotal = 零泄漏表.reduce((a, t) => a + (行数(db, t) || 0), 0);
    put(leakTotal === 0, 'G5 零泄漏锁', leakTotal === 0 ? '0 行' : '还有 ' + leakTotal + ' 行', leak);

    // G6 结构锁：表/视图**名字**与来源一致 —— 意图不变（缺表＝剔除过头，必须红），
    //   只是不再把「应用启动时自建的表」算进来（见 应用自建表）。
    const 产签名 = 结构签名(db);
    const cmp = 比结构(产签名, sourceSig);
    const 差异 = []
      .concat(cmp.少表.length ? ['来源有产物无：' + cmp.少表.join(',')] : [])
      .concat(cmp.多表.length ? ['产物多出：' + cmp.多表.join(',')] : [])
      .concat(cmp.少视图.length ? ['来源有视图产物无：' + cmp.少视图.join(',')] : [])
      .concat(cmp.多视图.length ? ['产物多出视图：' + cmp.多视图.join(',')] : []);
    const 形 = (s) => 'table=' + s.tables.length + ' view=' + s.views.length;
    const 形比锁 = (s) => 'table=' + 排掉自建(s.tables).length + ' view=' + s.views.length;
    put(cmp.ok, 'G6 结构锁',
        cmp.ok ? (cmp.有基准 ? '一致' : '无来源基准，本闸不判') : '与来源不一致：' + 差异.join('；'),
        '产物 ' + 形(产签名) + '（比锁后 ' + 形比锁(产签名) + '）' +
        (cmp.有基准 ? ' ↔ 来源 ' + 形(sourceSig) + '（比锁后 ' + 形比锁(sourceSig) + '）'
                   : '（无来源基准）') +
        '；排除应用自建表 ' + 应用自建表.join(','));

    // G7 字节锁：文件字节层面也别有
    const by = scanBytes(productPath, ledger);
    put(!by.checked || by.hits.length === 0, 'G7 字节锁', by.checked && by.hits.length ? by.hits.length + ' 个 token 仍在文件字节里' : '字节里 0 命中',
        by.checked ? '扫了 ' + (fs.statSync(productPath).size / 1048576).toFixed(2) + ' MB → ' + by.hits.length + ' 命中' : '未扫');
  } finally { db.close(); }
  return { red, rows };
}

function sumHits(db, table, col, ledger) {
  if (!表存在(db, table)) return 0;
  let n = 0;
  for (const t of ledger) {
    try { n += db.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE "${col}" LIKE ?`).get('%' + esc(t) + '%').n; } catch { /* 列不存在 */ }
  }
  return n;
}

// ── 五层读数（口径写在 provenance 里，可复算）─────────────────────────
function layerReadings(db) {
  const out = {};
  for (const r of db.prepare(`
    SELECT COALESCE(layer,'(null)') l, COUNT(*) n,
           AVG((assigned_prob - (CASE outcome WHEN 'true' THEN 1.0 ELSE 0.0 END)) *
               (assigned_prob - (CASE outcome WHEN 'true' THEN 1.0 ELSE 0.0 END))) brier,
           SUM(CASE WHEN (assigned_prob>0.5 AND outcome='true') OR (assigned_prob<=0.5 AND outcome='false') THEN 1 ELSE 0 END) hit
    FROM predictions
    WHERE outcome IN ('true','false') AND assigned_prob IS NOT NULL
    GROUP BY COALESCE(layer,'(null)') ORDER BY l`).all()) {
    out[r.l] = { n: r.n, brier: r.brier === null ? null : Number(r.brier.toFixed(4)), accuracy: Number(((r.hit / r.n) || 0).toFixed(4)) };
  }
  return out;
}

// ── 构建 ─────────────────────────────────────────────────────────────
function buildPlan(sourceDb) {
  const evAll = sourceDb.prepare('SELECT id, raw_text FROM events').all();
  const patRe = new RegExp(SEAT_NICK_RE.source, 'g');
  const patternRows = evAll.filter((e) => { patRe.lastIndex = 0; return patRe.test(e.raw_text); });
  const mechRows = evAll.filter((e) => isMechanicalCJKHao(e.raw_text));

  const dropEventIds = HAND_VERIFIED_EVENT_IDS.slice();
  const ph = dropEventIds.join(',');
  const cnt = (sql, ...a) => sourceDb.prepare(sql).get(...a).n;
  const realGames = realGameIds(sourceDb);
  const rgList = realGames.join(',') || '-1';

  return {
    patternRows: patternRows.length,
    mechanicalRows: mechRows.length,
    realGameIds: realGames,
    drop: {
      events: { rows: dropEventIds.length, ids: dropEventIds, before: evAll.length, why: '这 5 行 raw_text 带 4 位真实玩家的昵称，他们没同意过被公开' },
      claims: { rows: cnt(`SELECT COUNT(*) n FROM claims WHERE event_id IN (${ph})`), before: cnt('SELECT COUNT(*) n FROM claims'), why: '指向被剔 events 的外键行，留着就是悬挂引用' },
      actions: { rows: cnt(`SELECT COUNT(*) n FROM actions WHERE event_id IN (${ph})`), before: cnt('SELECT COUNT(*) n FROM actions'), why: '同上' },
      hypotheses: { rows: cnt('SELECT COUNT(*) n FROM hypotheses'), before: cnt('SELECT COUNT(*) n FROM hypotheses'), why: 'spec Success Criteria 要求整表 0（这 6 行是对真人席位的角色判断）' },
      contradictions: { rows: cnt(`SELECT COUNT(*) n FROM contradictions WHERE game_id IN (${rgList})`), before: cnt('SELECT COUNT(*) n FROM contradictions'), why: '★超出 spec 字面清单：这是同一局真人游戏上 LLM 写的角色判断（「真女巫可能恰在5、12其中之一」），与 hypotheses 同类，留着等于把真人局的角色结论发出去' },
      ...Object.fromEntries(零泄漏表.map((t) => [t, { rows: cnt(`SELECT COUNT(*) n FROM "${t}"`), before: cnt(`SELECT COUNT(*) n FROM "${t}"`), why: '零泄漏锁（spec Success Criteria）' }])),
    },
  };
}

function build(opts) {
  const src = opts.source, out = opts.out;
  if (!fs.existsSync(src)) throw new Error('来源库不存在：' + src + '（本脚本**只读**来源，不会创建）');

  const shaBefore = sha256File(src);

  // ① 只读来源，算剔除计划与身份账本
  const srcDb = new DatabaseSync(src, { readOnly: true });
  let plan, ledgerSet, sourceSig, sourceCounts;
  try {
    plan = buildPlan(srcDb);
    ({ ledger: ledgerSet } = buildLedger(srcDb));
    sourceSig = 结构签名(srcDb);        // G6 的比对基准（表名集合）
    sourceCounts = 结构计数(srcDb);     // ★仍是原样的 {table,view} —— C9 读的就是这个形状
  } finally { srcDb.close(); }

  // ② 幂等：已存在就退出，**绝不覆盖**
  if (fs.existsSync(out)) {
    return { code: 3, message: `目标已存在，不覆盖：${out}（要重建请先手工删掉它）`, shaBefore };
  }

  // ③ 剔除动作全在**副本**上做
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(src, out);
  const w = new DatabaseSync(out);
  try {
    w.exec('PRAGMA foreign_keys=OFF');
    w.exec('BEGIN');
    for (const t of 零泄漏表) w.exec(`DELETE FROM "${t}"`);
    w.exec('DELETE FROM hypotheses');
    w.exec(`DELETE FROM contradictions WHERE game_id IN (${plan.realGameIds.join(',') || '-1'})`);
    w.exec(`DELETE FROM claims WHERE event_id IN (${HAND_VERIFIED_EVENT_IDS.join(',')})`);
    w.exec(`DELETE FROM actions WHERE event_id IN (${HAND_VERIFIED_EVENT_IDS.join(',')})`);
    w.exec(`DELETE FROM events WHERE id IN (${HAND_VERIFIED_EVENT_IDS.join(',')})`);
    w.exec('COMMIT');
    w.exec('VACUUM');                              // ★不留已删文本的空闲页给 bytes 扫描翻出来
    w.exec('PRAGMA journal_mode=DELETE');         // 产物 = 单文件，好进 .gitignore
  } finally { w.close(); }
  for (const suffix of ['-wal', '-shm']) fs.rmSync(out + suffix, { force: true });

  // ④ 收工收据：来源一个字节都没动过
  const shaAfter = sha256File(src);
  const immutable = shaBefore === shaAfter;

  // ⑤ 体检 + 读数
  const gates = runGates(out, ledgerSet, sourceSig, plan.realGameIds);
  const pdb = new DatabaseSync(out, { readOnly: true });
  let layers, counts;
  try { layers = layerReadings(pdb); counts = { events: 行数(pdb, 'events'), players: 行数(pdb, 'players'), games: 行数(pdb, 'games'), predictions: 行数(pdb, 'predictions'), claims: 行数(pdb, 'claims') }; }
  finally { pdb.close(); }

  const provenance = {
    生成于: new Date().toISOString(),
    模块: 'privacy-seed',
    一句话: '这是示范数据，不是你的成绩。',
    免责: '本库由 p1a.db 拷贝而来，剔除了未经同意公开的真实玩家昵称与其角色判断；任何读数都只是演示用。',
    来源: {
      路径: path.relative(ROOT, src).replace(/\\/g, '/'),
      sha256: shaBefore,
      只读收据: immutable ? '来源 sha256 构建前后一致 ⇒ 未被写入' : '★来源 sha256 变了 ⇒ 脚本出错了，请查',
      结构: sourceCounts,           // ★原样 {table,view} 计数，发行闸 C9 依赖这个形状，别改
      比锁结构: {                   // ★G6 真正拿来比的东西（应用自建表已在两侧排掉）
        表: sourceSig.tables,
        比锁后: 排掉自建(sourceSig.tables),
        视图: sourceSig.views,
        排除的应用自建表: 应用自建表,
      },
    },
    产物: { 路径: path.relative(ROOT, out).replace(/\\/g, '/'), sha256: sha256File(out) },
    剔除: {
      判据: '① 人工核出的 5 行真人昵称行（按 events.id 逐一列入，game_id=' + plan.realGameIds.join(',') + '）；② 引用这 5 行的事件级外键行（claims/actions）；③ hypotheses 整表；④ 真人局上的角色判断（contradictions）；⑤ 零泄漏表整表。',
      真人局: plan.realGameIds,
      '为什么不用「含中文且含号」': {
        该机械判据行数: plan.mechanicalRows,
        后果: '绝大多数是合法盘话（如「3号查杀5号」），按它剔会把种子库掏空 —— spec 明令不做。',
      },
      '为什么不用「N号+昵称」做剔除': {
        该模式命中行数: plan.patternRows,
        其中真人行: 5,
        其中合成局模板行: plan.patternRows - 5,
        后果: '★该模式在合成局里 100% 命中模板盘话（「2号跳预言家」「1号给4号发金水」），按它剔＝ 168 条合法示范数据 + 363 条 claims 一起消失，' +
              '且 game 2 的事件会归零 ⇒ 种子库变成空壳。**spec 自身有这处矛盾**：Success Criteria 写「= 0 行」，' +
              '而同文 Boundaries 写「不要掏空种子库」。本脚本取后者（保数据），并把 0 行这条判据记为**未采纳**，理由见此。',
        实测证据: '按模式删 173 行后 events 556→383，合成局 551→383，game 2 事件数=0，claims 447→84（孤儿 363）。',
      },
      逐表: {
        events: { 剔: plan.drop.events.rows, 留: counts.events, 剔掉的_id: plan.drop.events.ids, 原因: '这 5 行 raw_text 带 4 位真实玩家的昵称，他们没同意过被公开' },
        claims: { 剔: plan.drop.claims.rows, 留: counts.claims, 原因: plan.drop.claims.why },
        // ★原来这里是 `行数(new DatabaseSync(out, {readOnly:true}), 'actions')` ——
        //   句柄开了不关，是个**真泄漏**。它平时不发作（要等 GC 回收后才松开），
        //   但同一时刻就要删产物目录的调用方会被 Windows 挡下（EPERM）。
        actions: { 剔: plan.drop.actions.rows, 留: (() => { const d = new DatabaseSync(out, { readOnly: true }); try { return 行数(d, 'actions'); } finally { d.close(); } })(), 原因: plan.drop.actions.why },
        hypotheses: { 剔: plan.drop.hypotheses.rows, 留: 0, 原因: plan.drop.hypotheses.why },
        contradictions: { 剔: plan.drop.contradictions.rows, 留: 0, 原因: plan.drop.contradictions.why },
        ...Object.fromEntries(零泄漏表.map((t) => [t, { 剔: plan.drop[t].rows, 留: 0, 原因: plan.drop[t].why }])),
      },
      没落盘的: '被剔的原文与昵称 token **一律不写进本文件、任何日志、任何测试夹具**（spec Boundaries: Never）；这里只留条数与 id。',
    },
    读数: {
      口径: '五层读数 = 在 outcome∈{true,false} 且 assigned_prob 非空的 predictions 上，按 layer 分组：' +
            'brier = mean((p − y)²)，y∈{0,1}；accuracy = (p>0.5 与 true 或 p≤0.5 与 false) 的比例。' +
            '★这与看板简报里的读数（stage4-run.cjs 口径）不是同一个过滤器，两者不可混用。',
      分层: layers,
      规模: counts,
    },
    闸门: { 全过: gates.red.length === 0, 结论: gates.rows },
  };
  // 结构那项另开连接取，避免上面的临时句柄泄漏
  const tmp = new DatabaseSync(out, { readOnly: true });
  try {
    provenance.产物.结构 = 结构计数(tmp);            // ★原样 {table,view}，发行闸 C9 依赖
    const 产签名 = 结构签名(tmp);
    provenance.产物.比锁结构 = { 表: 产签名.tables, 比锁后: 排掉自建(产签名.tables), 视图: 产签名.views };
  } finally { tmp.close(); }

  fs.mkdirSync(path.dirname(opts.provenance), { recursive: true });
  fs.writeFileSync(opts.provenance, JSON.stringify(provenance, null, 2) + '\n', 'utf8');

  return { code: gates.red.length === 0 && immutable ? 0 : 4, gates, plan, ledgerSize: ledgerSet.size, provenance, out, immutable, shaBefore, shaAfter, counts };
}

// ── CLI ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { source: DEFAULT_SOURCE, out: DEFAULT_OUT, provenance: DEFAULT_PROVENANCE, checkOnly: false, target: null, json: false, audit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = path.resolve(ROOT, argv[++i]);
    else if (a === '--source') o.source = path.resolve(ROOT, argv[++i]);
    else if (a === '--provenance') o.provenance = path.resolve(ROOT, argv[++i]);
    else if (a === '--target') o.target = path.resolve(ROOT, argv[++i]);
    else if (a === '--check-only') o.checkOnly = true;
    else if (a === '--json') o.json = true;
    else if (a === '--audit') o.audit = true;
    else { o.bad = a; }
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const 说 = (s) => process.stdout.write(s + '\n');
  if (o.bad) { 说('未知参数：' + o.bad + '（--out / --source / --provenance / --target / --check-only / --json / --audit）'); process.exitCode = 2; return; }

  if (o.checkOnly) {
    const target = o.target || o.out;
    if (!fs.existsSync(o.source)) { 说('来源库不存在：' + o.source + '（体检需要来源来算身份账本）'); process.exitCode = 4; return; }
    const src = new DatabaseSync(o.source, { readOnly: true });
    let ledger, realGames; try { ({ ledger } = buildLedger(src)); realGames = realGameIds(src); } finally { src.close(); }
    const g = runGates(target, ledger, null, realGames);
    if (o.json) { 说(JSON.stringify({ red: g.red, rows: g.rows }, null, 2)); }
    else {
      说('');
      说('═══ 种子库隐私体检（只读，不产出）═══');
      说('目标：' + path.relative(ROOT, target).replace(/\\/g, '/') + '　身份账本：' + ledger.size + ' token');
      for (const r of g.rows) 说('  ' + r[0] + ' ' + r[1].padEnd(18) + r[2] + '　← ' + r[3]);
      说('');
      说(g.red.length ? '✘ 红 ' + g.red.length + ' 项' : '✔ ' + g.rows.length + ' 道闸全过');
    }
    process.exitCode = g.red.length ? 4 : 0;
    return;
  }

  let r;
  try { r = build(o); } catch (e) { 说('构建失败：' + e.message); process.exitCode = 4; return; }
  if (r.code === 3) { 说(r.message); process.exitCode = 3; return; }

  if (o.json) { 说(JSON.stringify({ code: r.code, ledgerSize: r.ledgerSize, red: r.gates.red }, null, 2)); }
  else {
    说('');
    说('═══ 种子库构建（来源只读，剔除在副本上做）═══');
    说('来源 ' + path.relative(ROOT, o.source).replace(/\\/g, '/') + '  sha256 ' + r.shaBefore.slice(0, 16) + '…');
    说('产物 ' + path.relative(ROOT, r.out).replace(/\\/g, '/'));
    说('');
    说('剔除了：events ' + r.plan.drop.events.rows + ' 行（id ' + r.plan.drop.events.ids.join(',') + '）· claims ' +
        r.plan.drop.claims.rows + ' · actions ' + r.plan.drop.actions.rows + ' · hypotheses ' + r.plan.drop.hypotheses.rows +
        ' · contradictions ' + r.plan.drop.contradictions.rows);
    说('★判据说明：「含中文且含号」' + r.plan.mechanicalRows + ' 行、「N号+昵称」' + r.plan.patternRows +
        ' 行 —— 两者都**未**用作剔除依据，理由写进 seed_provenance.json');
    说('来源只读收据：' + (r.immutable ? '✔ sha256 前后一致' : '✘ sha256 变了'));
    说('');
    for (const x of r.gates.rows) 说('  ' + x[0] + ' ' + x[1].padEnd(18) + x[2] + '　← ' + x[3]);
    说('');
    说(r.gates.red.length ? '✘ 红 ' + r.gates.red.length + ' 项' : '✔ ' + r.gates.rows.length + ' 道闸全过');
    说('  ' + path.relative(ROOT, o.provenance).replace(/\\/g, '/') + ' 已写（剔了什么/为什么/剩多少/五层读数/「这不是你的成绩」）');
  }
  process.exitCode = r.code;
}

if (require.main === module) main();

module.exports = {
  HAND_VERIFIED_EVENT_IDS, SEAT_NICK_RE, 零泄漏表, 应用自建表,
  build, buildPlan, buildLedger, runGates, scanLedger, scanBytes,
  layerReadings, 结构计数, 结构签名, 比结构, 行数, sha256File, parseArgs, main,
  DEFAULT_SOURCE, DEFAULT_OUT, DEFAULT_PROVENANCE,
};
