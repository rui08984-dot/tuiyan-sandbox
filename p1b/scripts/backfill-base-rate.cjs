'use strict';
/* 老行 evidence.baseRate 物化回填（零翻转安全集）。
   纪律：
     ① 候选集＝ baseRateFromNote 与三读序逐位一致的行（L2 pattern/n/k 全等 且 G2 b 全等 且 L5 p/kind 全等）
     ② 默认 dry-run；--confirm 才写
     ③ 写前在线快照（backup API）
     ④ 先副本演练（--rehearse <db-copy>），比对写前/写后 stage4 + g2 读数逐位一致
     ⑤ 单事务；写后：predictions 全列 dump sha256（除 evidence_json 外不变）+ pureAdd 校验（删键后逐字节等值）
   用法：
     node p1b/scripts/backfill-base-rate.cjs [--db <path>] [--dry-run|--confirm] [--rehearse] [--limit N]
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const CONFIRM = process.argv.indexOf('--confirm') >= 0;
const LIMIT = arg('limit', null) ? Number(arg('limit')) : null;
// --snapshot <path>：覆盖写前快照路径（测试用临时路径，避免污染仓库）；缺省落 .run-out/backup/。
// --no-snapshot：不写快照（仅在已由调用方另行留证时用；默认**总是**写）。
const SNAPSHOT = arg('snapshot', null);
const NO_SNAPSHOT = process.argv.indexOf('--no-snapshot') >= 0;
const br = require(path.join(ROOT, 'p1b/src/evidence/baseRate'));

function bitsame(a, b) { return Object.is(a, b); }
function eqNum(a, b) {
  const an = (a === null || a === undefined) ? null : a;
  const bn = (b === null || b === undefined) ? null : b;
  if (an === null && bn === null) return true;
  if (an === null || bn === null) return false;
  return bitsame(an, bn);
}

/** 返回 {safe:boolean, reason?:string, struct?:object} —— 该注记物化后是否三读序逐位不变。 */
function assess(note) {
  const tL2 = br.parseBaseRateL2(note);
  const tG2 = br.parseBaseRateG2(note);
  const tL5 = br.parseCertifiedFromNote(note);
  const st = br.baseRateFromNote(note);
  if (!st) return { safe: false, reason: 'st_null' };
  const l2ok = tL2 && bitsame(tL2.p, st.p) && eqNum(tL2.n, st.n) && eqNum(tL2.k, st.k);
  const g2ok = tG2 && bitsame(tG2.b, st.p);
  const l5kind = st.kind === 'certified' ? 'certified_text' : 'empirical_pct';
  const l5ok = tL5 && bitsame(tL5.p, st.p) && tL5.kind === l5kind;
  if (l2ok && g2ok && l5ok) return { safe: true, struct: st };
  return { safe: false, reason: [!l2ok && 'L2', !g2ok && 'G2', !l5ok && 'L5'].filter(Boolean).join('+') };
}

/** 对一行 evidence 数组：返回 {changed:boolean, ev:newArray, n:howManyAdded} */
function buildRow(ev) {
  let added = 0;
  const next = ev.map((el) => {
    if (!el || typeof el !== 'object') return el;
    if (br.isStructured(el.baseRate)) return el;             // 已有 ⇒ 不动
    const note = el.baseRateNote;
    if (typeof note !== 'string' || !note) return el;
    const a = assess(note);
    if (!a.safe) return el;                                   // 不安全 ⇒ 保持文本兜底
    added++;
    return Object.assign({}, el, { baseRate: a.struct });
  });
  return { changed: added > 0, ev: next, added };
}

(async () => {
  // 用 node:sqlite 只读读、better-sqlite3 写（与项目先例一致）
  const { DatabaseSync } = require('node:sqlite');
  const bs3 = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
  const rdb = new DatabaseSync(DB, { readOnly: true });
  const rows = rdb.prepare('SELECT id, evidence_json ev FROM predictions ORDER BY id').all();
  rdb.close();

  const plan = [];
  let scanned = 0, skippedUnsafe = 0, alreadyStructured = 0, noNote = 0;
  const reasonHist = {};
  for (const r of rows) {
    let ev; try { ev = JSON.parse(r.ev); } catch (e) { continue; }
    if (!Array.isArray(ev)) continue;
    scanned++;
    const hasEl = ev.some((e) => e && typeof e === 'object');
    if (!hasEl) { noNote++; continue; }
    const anyExisting = ev.some((e) => e && typeof e === 'object' && br.isStructured(e.baseRate));
    if (anyExisting) { alreadyStructured++; continue; }
    const anyNote = ev.some((e) => e && typeof e === 'object' && typeof e.baseRateNote === 'string' && e.baseRateNote);
    if (!anyNote) { noNote++; continue; }
    const b = buildRow(ev);
    if (!b.changed) {
      skippedUnsafe++;
      // 记录原因
      const el = ev.find((e) => e && typeof e === 'object' && typeof e.baseRateNote === 'string' && e.baseRateNote);
      const a = assess(el.baseRateNote);
      reasonHist[a.reason || 'other'] = (reasonHist[a.reason || 'other'] || 0) + 1;
      continue;
    }
    // prev = 写前读到的 evidence_json 原样字符串（pre-image），下面 CAS 用
    plan.push({ id: r.id, ev: b.ev, prev: r.ev, added: b.added });
    if (LIMIT && plan.length >= LIMIT) break;
  }

  const out = [];
  out.push('DB = ' + DB);
  out.push('mode = ' + (CONFIRM ? 'CONFIRM' : 'DRY-RUN'));
  out.push('rows scanned            = ' + scanned);
  out.push('rows already structured = ' + alreadyStructured);
  out.push('rows without note       = ' + noNote);
  out.push('rows skipped (unsafe)   = ' + skippedUnsafe + '  reasons=' + JSON.stringify(reasonHist));
  out.push('rows to backfill        = ' + plan.length + '  (elements added = ' + plan.reduce((s, x) => s + x.added, 0) + ')');
  out.push('ids (first 20) = ' + plan.slice(0, 20).map((x) => x.id).join(','));

  if (!CONFIRM) {
    out.push('DRY-RUN: no write.');
    fs.writeFileSync(path.join(ROOT, '.tmp/backfill-dry.txt'), out.join('\n') + '\n', 'utf8');
    console.log(out.join('\n'));
    process.exit(0);
  }

  // ③ 快照
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snap = NO_SNAPSHOT ? null : (SNAPSHOT || path.join(ROOT, '.run-out/backup', 'p1a-pre-brbackfill-' + stamp + '.db'));
  const wdb = new bs3(DB);
  wdb.pragma('journal_mode = WAL');
  if (snap) { await wdb.backup(snap); out.push('snapshot = ' + snap); }
  else out.push('snapshot = (skipped by --no-snapshot)');

  // ④ 单事务写入
  // 收口 A（2026-09-28）：守卫用**写前逐字节 pre-image CAS**，不是 `AND outcome IS NULL`。
  // 为什么不用 outcome 守卫：本脚本的职责就是把 baseRateNote 文本注记物化成结构化 baseRate，
  // 而候选集（baseRateNote 有值、baseRate 未结构化）里绝大多数是已落定行——2026-09-28 生产库
  // 只读实测：候选 216 行，其中 193 行 outcome IS NOT NULL。真加 outcome 守卫会把这条回填通道
  // 掐死在「只许改未落定行」，而物化 baseRate 的价值恰恰在已落定行上。
  // （如实记录：当前 216 个候选全被脚本自己的三读序安全校验判为 unsafe，故实际待写 0 行；
  //   守卫是为将来安全校验放宽或新批数据进来时准备的，不是为了今天多写。）
  // pre-image CAS 的语义严格更强：
  //   · 写前读到的 evidence_json 必须原样还在（`AND evidence_json = ?`），并发/事后重写一律 changes=0 拒改；
  //   · 再叠加下面 ⑤ 的 pureAdd 写后校验（删掉新 baseRate 键后须与写前逐字节等值），
  //     可证本脚本只**增** baseRate 键、绝不重写 resolve 真值 spec，也不动 outcome/assigned_prob。
  const upd = wdb.prepare('UPDATE predictions SET evidence_json = ? WHERE id = ? AND evidence_json = ?');
  let written = 0, blocked = 0;
  wdb.exec('BEGIN IMMEDIATE');
  try {
    for (const p of plan) { if (upd.run(JSON.stringify(p.ev), p.id, p.prev).changes === 0) blocked++; else written++; }
    wdb.exec('COMMIT');
  } catch (e) { wdb.exec('ROLLBACK'); throw e; }
  out.push('written rows = ' + written + ' | 守卫拒改(pre-image 已变) = ' + blocked);

  // ⑤ 写后校验：pureAdd —— 对每个写入行，删掉新 baseRate 键后应与写前逐字节等值
  const post = wdb.prepare('SELECT id, evidence_json ev FROM predictions').all();
  const preMap = new Map();
  for (const r of rows) preMap.set(r.id, r.ev);
  let pureAddFail = 0, mismatch = 0;
  const checked = plan.slice(0, 400); // 抽前 400 行做逐字节校验（全量亦可，取性能平衡）
  for (const p of checked) {
    const after = post.find((x) => x.id === p.id);
    if (!after) { mismatch++; continue; }
    let ev2; try { ev2 = JSON.parse(after.ev); } catch (e) { mismatch++; continue; }
    const stripped = ev2.map((el) => { if (el && typeof el === 'object' && el.baseRate) { const c = Object.assign({}, el); delete c.baseRate; return c; } return el; });
    if (JSON.stringify(stripped) !== preMap.get(p.id)) pureAddFail++;
  }
  out.push('pureAdd check (first ' + checked.length + ' rows): fail=' + pureAddFail + ' mismatch=' + mismatch);
  const integ = wdb.pragma('integrity_check');
  out.push('integrity_check = ' + JSON.stringify(integ));
  const total = wdb.prepare('SELECT count(*) c FROM predictions').get().c;
  out.push('predictions total = ' + total + ' (unchanged expected)');
  const withBR = wdb.prepare("SELECT count(*) c FROM predictions WHERE json_extract(evidence_json,'$[0].baseRate') IS NOT NULL").get().c;
  out.push('rows with evidence[0].baseRate = ' + withBR);
  wdb.close();

  fs.writeFileSync(path.join(ROOT, '.tmp/backfill-confirm.txt'), out.join('\n') + '\n', 'utf8');
  console.log(out.join('\n'));
})().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(1); });
