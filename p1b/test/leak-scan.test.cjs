'use strict';
/**
 * p1b/test/leak-scan.test.cjs —— 全库泄漏扫描器回归锁（2026-09-22 · 续8）
 *
 * 背景：本日三批诊断暴露「覆盖缺口会掩盖真问题」——
 *   初版扫描只用 3 字段 ⇒ 276 推不出；用 gate 完整规则 ⇒ 57；补 mmwrWeekStart ⇒ leak 9→21。
 * 本锁确保扫描器**不退回**到残缺口径。
 *
 * 覆盖：
 *   ① ★同源锁：mmwrWeekStart / eventWindowStart 须与 gate 的字段清单一致
 *   ② ★未覆盖显式计数锁：报告须含 unverifiable 计数（禁混入 pass）
 *   ③ ★gate 不认字段单列锁：unsupported_by_field 须独立于 structural_by_field
 *   ④ 零写库锁
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN = path.join(ROOT, 'p1b/scripts/leak-scan.cjs');
const GATE = path.join(ROOT, 'p1b/scripts/anchor-gate.cjs');
const SRC = fs.readFileSync(SCAN, 'utf8');
const GATE_SRC = fs.readFileSync(GATE, 'utf8');

test('① ★同源锁：字段清单与 gate 一致（含 mmwrWeekStart）', () => {
  // gate 认的 11 个字段（照 eventWindowStart 逐条核）
  const FIELDS = ['rz.date', 'meta.date', 'rz.start', 'rz.epiweek', 'meta.epiweek', 'rz.month', 'rz.period', 'rz.year', 'meta.eventDate', 'meta.expectDate', 'meta.expectMonth', 'rz.week_end', 'rz.week'];
  for (const f of FIELDS) {
    const [o, k] = f.split('.');
    assert.ok(new RegExp('if \\((' + o + ')\\.' + k + '\\) return').test(SRC), '扫描器须认 ' + f + '（与 gate 同源）');
  }
  assert.ok(/function mmwrWeekStart/.test(SRC), '★须实现 mmwrWeekStart（选项 C 的产物）');
  assert.ok(/function mmwrWeekStart/.test(GATE_SRC), 'gate 须也有 mmwrWeekStart（同源）');
});

test('② ★未覆盖显式计数锁（禁混入 pass）', () => {
  assert.ok(/unverifiable:/.test(SRC), '报告须含 unverifiable 字段');
  assert.ok(/totals\.unverifiable/.test(SRC), 'totals 须含 unverifiable 计数');
  // 反向锁：pass 的累加不得包含未判定
  assert.ok(!/if \(!w\) \{ res\.pass/.test(SRC), '★未判定不得计入 pass');
});

test('③ ★gate 不认字段单列锁', () => {
  assert.ok(/GATE_UNSUPPORTED/.test(SRC), '须有 gate 不认字段清单');
  assert.ok(/STRUCTURAL_NO_DATE/.test(SRC), '须有结构性无日期清单（与之分开）');
  assert.ok(/unsupported_by_field/.test(SRC) && /structural_by_field/.test(SRC), '两者须独立计数');
  assert.ok(/commence_utc/.test(SRC) && /week_start/.test(SRC), '★须列明 gate 不认的具体字段');
});

test('④ 零写库锁', () => {
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const pat of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+predictions\b/i, /\bDELETE\s+FROM\b/i, /\bconn\.exec\(/]) {
    assert.ok(!pat.test(CODE), '不得含写库调用：' + pat);
  }
  assert.ok(/readOnly:\s*true/.test(SRC), 'DB 连接须 readOnly');
});
