'use strict';
/**
 * truth-basis-defect.test.cjs —— 真值口径缺陷排除谓词（2026-09-15 用户裁定「丙：排除出池」）。
 * 铁律：零网络、零写库（只读生产库 + 临时库夹具）。
 * 断言：① SQL 谓词 与 JS 判定 **逐行一致**；② 排除集指纹 == 冻结锚（98 行）；
 *      ③ 未结算的 forecast 行（resolved_at=null）**不被误伤**；④ 正常行不被误伤；
 *      ⑤ g2-report / stage4-run 产物含排除计数与指纹（可复核）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const T = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));
const { DatabaseSync } = require('node:sqlite');
const DB = path.join(ROOT, 'p1a-terminal/data/p1a.db');

test('truthBasis：SQL 谓词 ≡ JS 判定，且排除集指纹与冻结锚一致', () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare('SELECT p.id, p.resolved_at, p.matures_at, p.resolve_note, p.evidence_json FROM predictions p').all();
  const sqlIds = db.prepare('SELECT p.id FROM predictions p WHERE NOT ' + T.NOT_TRUTH_BASIS_DEFECT_SQL() + ' ORDER BY p.id').all().map((x) => x.id);
  const jsIds = rows.filter((r) => T.isTruthBasisDefect(r)).map((r) => r.id).sort((a, b) => a - b);
  db.close();
  assert.deepEqual(sqlIds, jsIds, 'SQL 与 JS 判定必须逐行一致');
  assert.equal(jsIds.length, T.DEFECT_N_AT_FREEZE, '排除集行数 == 冻结锚');
  const fp = crypto.createHash('sha256').update(jsIds.join(',')).digest('hex');
  assert.equal(fp, T.DEFECT_FINGERPRINT_SHA256, '排除集指纹 == 冻结锚（防谓词漂移）');
});

test('truthBasis：live 判定——未结算 forecast 行与正常行均不被误伤', () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  // 未结算的 forecast 行（outcome/resolved_at 为 null）⇒ 保留
  const nullRows = db.prepare("SELECT p.id, p.resolved_at, p.matures_at, p.resolve_note, p.evidence_json FROM predictions p WHERE p.resolved_at IS NULL AND json_extract(p.evidence_json,'$[0].resolve.kind') LIKE '%forecast%' LIMIT 5").all();
  assert.ok(nullRows.length > 0, '夹具前提：存在未结算的 forecast 行');
  for (const r of nullRows) assert.equal(T.isTruthBasisDefect(r), false, 'id=' + r.id + ' 未结算 ⇒ 不判缺陷');
  // 正常已解行（resolved_at >= matures_at）⇒ 保留
  const okRows = db.prepare("SELECT p.id, p.resolved_at, p.matures_at, p.resolve_note, p.evidence_json FROM predictions p WHERE p.resolved_at IS NOT NULL AND p.matures_at IS NOT NULL AND p.resolved_at >= p.matures_at AND json_extract(p.evidence_json,'$[0].resolve.kind') IS NOT NULL LIMIT 5").all();
  for (const r of okRows) assert.equal(T.isTruthBasisDefect(r), false, 'id=' + r.id + ' 正常结算 ⇒ 不判缺陷');
  db.close();
});

test('truthBasis：纯函数边界（构造行）', () => {
  const mk = (o) => Object.assign({ resolved_at: '2026-09-13 07:00:00', matures_at: '2026-09-14', resolve_note: '', evidence_json: '[]' }, o);
  assert.equal(T.isTruthBasisDefect(mk({})), false, '无特征 ⇒ 非缺陷');
  assert.equal(T.isTruthBasisDefect(mk({ resolve_note: 'Open-Meteo forecast 2026-09-14 max=30.6C' })), true, 'note 含 forecast 且早结算 ⇒ 缺陷');
  assert.equal(T.isTruthBasisDefect(mk({ evidence_json: JSON.stringify([{ resolve: { kind: 'openmeteo_forecast_daily_max' } }]) })), true, 'kind 含 forecast ⇒ 缺陷');
  assert.equal(T.isTruthBasisDefect(mk({ resolved_at: '2026-09-15', resolve_note: 'forecast' })), false, '结算晚于事件日 ⇒ 非缺陷');
  assert.equal(T.isTruthBasisDefect(mk({ resolved_at: null })), false, '未结算 ⇒ 非缺陷');
  assert.equal(T.isTruthBasisDefect(null), false, '防 null');
});

test('truthBasis：g2-report 与 stage4-run 产物含排除计数与指纹（可复核）', () => {
  const g2j = path.join(os.tmpdir(), 'p1b-tb-g2-' + process.pid + '-' + Date.now() + '.json');
  const s4j = path.join(os.tmpdir(), 'p1b-tb-s4-' + process.pid + '-' + Date.now() + '.json');
  execFileSync(process.execPath, [path.join(ROOT, 'p1b/scripts/g2-report.cjs'), '--audit', path.join(ROOT, 'p1b/sim/out/g2-audit-r4.json'), '--json', g2j, '--text', g2j + '.out'], { encoding: 'utf8' });
  execFileSync(process.execPath, [path.join(ROOT, 'p1b/scripts/stage4-run.cjs'), '--json', s4j], { encoding: 'utf8' });
  const g2 = JSON.parse(fs.readFileSync(g2j, 'utf8'));
  const s4 = JSON.parse(fs.readFileSync(s4j, 'utf8'));
  assert.equal(g2.counts.truth_basis_defect_excluded_rows, T.DEFECT_N_AT_FREEZE, 'g2-report 披露排除行数');
  assert.equal(s4.truth_basis_defect_excluded_rows, T.DEFECT_N_AT_FREEZE, 'stage4-run 披露排除行数');
  assert.equal(s4.truth_basis_defect_fingerprint, T.DEFECT_FINGERPRINT_SHA256, 'stage4-run 带指纹');
});
