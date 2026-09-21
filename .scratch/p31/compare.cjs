'use strict';
/*
 * .scratch/p31/compare.cjs —— baseline vs drill 逐表对照（零翻转核验）
 * 用法：node .scratch/p31/compare.cjs
 * 口径：逐表 SELECT * ORDER BY rowid ⇒ JSON.stringify ⇒ sha256 前 16 位（同 fingerprint.cjs）。
 * 输出：predictions 差异行 id＋变化字段；其余五表 sha16 与行数对照。
 */
const path = require('path');
const crypto = require('crypto');
const B = require(path.join(__dirname, '..', '..', 'p1a-terminal', 'node_modules', 'better-sqlite3'));

const A = path.join(__dirname, 'snap-baseline.db');
const D = path.join(__dirname, 'snap-drill.db');
const TABLES = ['predictions', 'games', 'verdicts', 'events', 'claims', 'players'];

const sha16 = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);

const a = new B(A, { readonly: true, fileMustExist: true });
const d = new B(D, { readonly: true, fileMustExist: true });

// ── 六表 sha16 ＋ 行数 ──
const tbl = {};
for (const t of TABLES) {
  const ra = a.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
  const rd = d.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
  tbl[t] = { nA: ra.length, nD: rd.length, shaA: sha16(ra), shaD: sha16(rd), same: sha16(ra) === sha16(rd) };
}
console.log('── 六表对照 ──');
for (const t of TABLES) {
  const x = tbl[t];
  console.log('  ' + t.padEnd(12) + ' baseline n=' + String(x.nA).padStart(5) + ' sha16=' + x.shaA + ' | drill n=' + String(x.nD).padStart(5) + ' sha16=' + x.shaD + ' | SAME=' + x.same);
}

// ── resolved 计数 ──
const resA = a.prepare('SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL').get().c;
const resD = d.prepare('SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL').get().c;
console.log('\n── resolved 计数 ──');
console.log('  baseline resolved=' + resA + ' | drill resolved=' + resD + ' | delta=' + (resD - resA));

// ── predictions 逐行 diff（按 id 对齐）──
const pa = a.prepare('SELECT * FROM predictions ORDER BY id').all();
const pd = d.prepare('SELECT * FROM predictions ORDER BY id').all();
const cols = a.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
console.log('\n── predictions 逐行 diff（列集 ' + cols.length + ' 列）──');
const mapA = new Map(pa.map((r) => [r.id, r]));
const mapD = new Map(pd.map((r) => [r.id, r]));
const onlyA = [...mapA.keys()].filter((id) => !mapD.has(id));
const onlyD = [...mapD.keys()].filter((id) => !mapA.has(id));
const changed = [];
for (const [id, ra] of mapA) {
  const rd = mapD.get(id); if (!rd) continue;
  const diffCols = cols.filter((c) => JSON.stringify(ra[c] === undefined ? null : ra[c]) !== JSON.stringify(rd[c] === undefined ? null : rd[c]));
  if (diffCols.length) changed.push({ id: id, cols: diffCols, before: diffCols.map((c) => c + '=' + JSON.stringify(ra[c])).join(' '), after: diffCols.map((c) => c + '=' + JSON.stringify(rd[c])).join(' ') });
}
console.log('  rows only in baseline: ' + JSON.stringify(onlyA));
console.log('  rows only in drill   : ' + JSON.stringify(onlyD));
console.log('  changed rows: ' + changed.length);
for (const c of changed) console.log('    id=' + c.id + ' | cols=[' + c.cols.join(',') + ']\n      before: ' + c.before + '\n      after : ' + c.after);

// ── 变化行是否全为 frankfurter ──
const kinds = {};
for (const c of changed) {
  const r = mapD.get(c.id);
  let ev = []; try { ev = JSON.parse(r.evidence_json || '[]'); } catch (e) { ev = []; }
  const k = (ev[0] && ev[0].resolve && ev[0].resolve.kind) || '(none)';
  kinds[k] = (kinds[k] || 0) + 1;
}
console.log('\n  changed rows by kind: ' + JSON.stringify(kinds));

// ── 变化字段集合 ──
const colSet = {};
for (const c of changed) for (const x of c.cols) colSet[x] = (colSet[x] || 0) + 1;
console.log('  changed columns histogram: ' + JSON.stringify(colSet));

// ── 非变化行零变化（除 changed 外）──
console.log('\n  unchanged rows = ' + (pa.length - changed.length - onlyA.length - onlyD.length) + ' / ' + pa.length);

a.close(); d.close();
