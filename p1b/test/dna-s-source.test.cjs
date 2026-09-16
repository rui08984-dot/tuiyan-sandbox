'use strict';
/**
 * p1b/test/dna-s-source.test.cjs —— E1 主口径（源快照重建）测试（P0+ · 2026-09-16）
 * ① labelFromSeries 纯函数：漂移/平稳/薄窗/窗尾过滤 四例；
 * ② 快照件存在且结构完整（≥50 系列、每日值、含 source_url）；
 * ③ source dry-run：覆盖统计含 source_labeled>0，且生产库 sha256 前后不变（零写库）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKFILL = path.join(ROOT, 'p1b', 'scripts', 'dna-s-backfill.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-e1src-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const { labelFromSeries } = require(BACKFILL);

function mkDays(vals, startIso) {
  const d0 = Date.parse((startIso || '2025-01-01') + 'T00:00:00Z'); const days = [];
  vals.forEach((v, i) => days.push({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value: v }));
  return days;
}

test('① labelFromSeries：漂移/平稳/薄窗/窗尾过滤', () => {
  const drift = labelFromSeries(mkDays(Array.from({ length: 40 }, (_, i) => (i < 20 ? 10 : 40))), '>', 30, null);
  assert.equal(drift.label, '漂移');
  assert.equal(drift.basis.k1, 0); assert.equal(drift.basis.k2, 20);
  const stable = labelFromSeries(mkDays(Array.from({ length: 40 }, (_, i) => (i % 2 ? 10 : 40))), '>', 30, null);
  assert.equal(stable.label, '平稳');
  const thin = labelFromSeries(mkDays([1, 2, 3]), '>', 2, null);
  assert.equal(thin.label, '不可判'); assert.match(thin.basis.reason, /n<20/);
  // 窗尾过滤：cutoff 前的日子才计入（构造 40 日、cutoff 卡在第 20 日 ⇒ 只有 20 日入窗 ⇒ min(n1,n2)=10 边界可判）
  const days = mkDays(Array.from({ length: 40 }, (_, i) => 40));
  const cut = days[19].date;                       // cutoff = 第 20 日（不含当日）
  const filtered = labelFromSeries(days, '>', 30, cut);
  assert.equal(filtered.basis.window_n || filtered.basis.n, 19, '窗内应只含 cutoff 之前的日子');
});

test('② 快照件：结构完整（≥50 系列、每日值、source_url、窗口类型）', () => {
  const dir = path.join(ROOT, 'p1b', 'sim', 'out');
  const f = fs.readdirSync(dir).filter((x) => /^dna-s-source-snapshots-\d{8}\.json$/.test(x)).sort().pop();
  assert.ok(f, '缺快照件');
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const keys = Object.keys(j.snapshots);
  assert.ok(keys.length >= 50, '系列数 ' + keys.length + ' < 50');
  let withUrl = 0, daysTotal = 0;
  for (const k of keys) { const s = j.snapshots[k]; assert.ok(Array.isArray(s.days) && s.days.length > 0, k + ' 无日值'); if (s.source_url) withUrl++; daysTotal += s.days.length; }
  assert.equal(withUrl, keys.length, '每个系列须带 source_url');
  assert.ok(daysTotal > 5000, '日值总量过少: ' + daysTotal);
});

test('③ source dry-run：主口径命中，且生产库 sha256 不变（零写库）', () => {
  const before = sha(PROD);
  const out = execFileSync(process.execPath, [BACKFILL, '--db', PROD, '--route', 'source'], { encoding: 'utf8' });
  const m = /覆盖统计: (\{[^}]*\})/.exec(out);
  assert.ok(m, '未打印覆盖统计');
  const cov = JSON.parse(m[1]);
  assert.ok(cov.source_labeled > 0, '主口径零命中');
  assert.ok(cov.prior > 0, '先验档计数缺失');
  assert.equal(sha(PROD), before, 'dry-run 改动了生产库');
});
