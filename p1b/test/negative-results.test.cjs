'use strict';
/**
 * p1b/test/negative-results.test.cjs —— I2 负结果账本 v0 测试（P0+ · 2026-09-16）
 * ① 条目数与四要素齐备；② 引用的判据/证据文件**独立复核**存在（不信任脚本自证）；③ 设计层拒绝含来源。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'negative-results.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-negres-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

let j = null;
test.before(() => {
  execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir], { stdio: 'ignore' });
  j = JSON.parse(fs.readFileSync(path.join(tmpDir, fs.readdirSync(tmpDir).filter((f) => /^negative-results-ledger-\d{8}\.json$/.test(f))[0]), 'utf8'));
});

test('① ≥8 条实证负结果，每条四要素齐备（假设/判据+sha/结局/复算入口）', () => {
  assert.ok(j.empirical.length >= 8, '实证条数: ' + j.empirical.length);
  for (const e of j.empirical) {
    assert.ok(e.hypothesis && e.hypothesis.length > 10, e.id + ' 缺假设');
    assert.ok(e.criterion && e.criterion_sha16 && e.criterion_sha16.length === 16, e.id + ' 缺判据或 sha16');
    assert.ok(e.outcome && e.outcome.length > 10, e.id + ' 缺结局');
    assert.ok(e.rerun, e.id + ' 缺复算入口');
  }
});

test('② 独立复核：全部引用的判据/证据文件确实存在', () => {
  for (const e of j.empirical) {
    for (const p of [e.criterion, e.evidence]) assert.ok(fs.existsSync(path.join(ROOT, p)), e.id + ' 引用不存在: ' + p);
  }
  for (const d of j.design_rejected) assert.ok(fs.existsSync(path.join(ROOT, d.source)), d.id + ' 来源不存在');
});

test('③ 设计层拒绝 ≥4 条且各含理由与来源', () => {
  assert.ok(j.design_rejected.length >= 4);
  for (const d of j.design_rejected) { assert.ok(d.reason && d.reason.length > 5, d.id + ' 缺理由'); assert.ok(d.source_sha16, d.id + ' 缺来源 sha'); }
});
