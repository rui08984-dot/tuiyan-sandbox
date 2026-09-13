'use strict';
// 3.0 vs 2.0 字节级对照（基准=HEAD 版 loadEvidence 原函数）；DB=临时副本，绝不触碰 p1a.db
// 复现：① git -C 'E:/music player' show HEAD:p1b/src/routes/verdicts.js > p1b/src/routes/_v20legacy.js
//       ② Copy-Item p1a.db/-wal/-shm 到 .scratch/forecast-debate/_v3proof/p1a-proof.db（WAL 必须同拷）
//       ③ node .scratch/forecast-debate/_v3proof.cjs   ④ 跑完删除 _v20legacy.js 与 _v3proof/
const { db } = require('E:/music player/p1b/src/deps');
const legacy = require('E:/music player/p1b/src/routes/_v20legacy.js');
const modern = require('E:/music player/p1b/src/routes/verdicts.js');
db.init('E:/music player/.scratch/forecast-debate/_v3proof/p1a-proof.db');
const conn = db.getConnection();
const rows = conn.prepare('SELECT id, game_id, evidence_json FROM predictions ORDER BY id').all();
const mk = (r) => { let ev = []; try { ev = JSON.parse(r.evidence_json || '[]'); } catch (e) { ev = []; } return { id: r.id, game_id: r.game_id, evidence: ev }; };
const intIds = (ev) => Array.isArray(ev) && ev.every((x) => Number.isInteger(x));
const call = (fn, pred, opts) => { try { return { ok: true, v: fn(pred, opts) }; } catch (e) { return { ok: false, v: String(e.message) }; } };
let n = 0, num = 0, nonNum = 0, offDiff = 0, onDiff = 0, prefixBad = 0, noEv = 0, errMatch = 0, errMismatch = 0, sample3 = null, sampleId = null;
for (const r of rows) {
  const pred = mk(r); n++;
  const A = call(legacy.loadEvidence, pred);
  const B = call(modern.loadEvidence, pred, { contradictions: false });
  const C = call(modern.loadEvidence, pred);
  if (!intIds(pred.evidence)) {
    nonNum++;
    if (A.ok === B.ok && A.v === B.v && A.ok === C.ok && A.v === C.v) errMatch++; else { errMismatch++; if (errMismatch < 3) console.log('NONNUM MISMATCH id=' + r.id, JSON.stringify([A.ok, B.ok, C.ok])); }
    continue;
  }
  num++;
  if (A.v !== B.v) offDiff++;
  if (C.v !== A.v) { onDiff++; if (String(C.v).indexOf(String(A.v)) !== 0) prefixBad++; if (!sample3) { sample3 = C.v; sampleId = r.id; } }
  if (A.v === modern.NO_EVIDENCE_LINE) noEv++;
}
console.log(JSON.stringify({ predictions: n, intEvidenceRows: num, objectEvidenceRows: nonNum, v20_vs_v30flagOff_diff: offDiff, v20_vs_v30default_diff: onDiff, append_only_prefix_violations: prefixBad, noEvidenceRows: noEv, nonNumericRows_identicalBehavior: errMatch, nonNumericRows_mismatch: errMismatch }, null, 1));
const p0 = mk(rows[0]);
process.env[modern.EVIDENCE_V3_ENV] = 'off';
const e1 = modern.loadEvidence(p0);
process.env[modern.EVIDENCE_V3_ENV] = '0';
const e2 = modern.loadEvidence(p0);
delete process.env[modern.EVIDENCE_V3_ENV];
console.log('env=off 与 2.0 全等:', e1 === legacy.loadEvidence(p0), '| env=0 与 2.0 全等:', e2 === legacy.loadEvidence(p0));
console.log('--- 3.0 d 段实样例（prediction id=' + sampleId + '）---');
console.log(sample3 ? sample3.slice(-430) : '(none)');
