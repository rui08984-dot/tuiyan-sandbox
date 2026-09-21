'use strict';
/**
 * p1b/test/latest-file-suffix.test.cjs —— 「后缀件选择」回归锁（2026-09-21（三十四）批）
 *
 * 背景（实测缺陷）：`latestByPattern` 类正则 `…-(\d{8})\.json$` **不接受同日重跑的后缀字母**
 *   （`…-20260921b.json`/`c.json`）⇒ **静默读旧件**。实证：`calibration-report.cjs` 读
 *   `stage4-run-five-layers-20260921.json`（格数 9）而非真实的 `…20260921c.json`（格数 10）
 *   ⇒ 报告落后一格，且 A6 §5「确认格数＝stage4 格数」出现**假一致**（9=9）。
 *
 * 三处消费者（同批修）：`calibration-report.cjs`／`board.cjs`／`src/routes/disclosure.js`。
 *
 * 覆盖：① 正则接受可选后缀字母 ② 排序取最后（无后缀 < a < b < c）③ **接线锁**：三处源码
 *   的取件正则必须含后缀组（防被改回）④ 对照：旧正则确实会漏（证明锁非恒真）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 复制被测选择逻辑（与三处实现同构：filter → sort → 取最后）。 */
function pickLatest(files, re) {
  const c = files.filter((f) => re.test(f)).sort();
  return c.length ? c[c.length - 1] : null;
}

const S4_FILES = [
  'stage4-run-five-layers-20260920.json',
  'stage4-run-five-layers-20260921.json',
  'stage4-run-five-layers-20260921b.json',
  'stage4-run-five-layers-20260921c.json',
];
const OLD_RE = /^stage4-run-five-layers-\d{8}\.json$/;
const NEW_RE = /^stage4-run-five-layers-(\d{8})([a-z]?)\.json$/;

test('① 新正则接受可选后缀字母，旧正则漏掉后缀件（对照证明锁非恒真）', () => {
  const oldPicked = pickLatest(S4_FILES, OLD_RE);
  const newPicked = pickLatest(S4_FILES, NEW_RE);
  assert.equal(oldPicked, 'stage4-run-five-layers-20260921.json', '★旧正则确实漏后缀件（对照组）');
  assert.equal(newPicked, 'stage4-run-five-layers-20260921c.json', '新正则应取到 c 版');
  assert.notEqual(oldPicked, newPicked, '★两者必须不同，否则锁无意义');
});

test('② 排序语义：无后缀 < a < b < c（同日多版取最后）', () => {
  assert.equal(pickLatest(['x-20260101.json', 'x-20260101a.json'], NEW_RE_NAMED('x')), 'x-20260101a.json');
  assert.equal(pickLatest(['x-20260101b.json', 'x-20260101a.json'], NEW_RE_NAMED('x')), 'x-20260101b.json');
  assert.equal(pickLatest(['x-20260101.json', 'x-20260101b.json', 'x-20260101a.json'], NEW_RE_NAMED('x')), 'x-20260101b.json');
  // 跨日仍按日期优先
  assert.equal(pickLatest(['x-20260102.json', 'x-20260101c.json'], NEW_RE_NAMED('x')), 'x-20260102.json');
});

function NEW_RE_NAMED(name) { return new RegExp('^' + name + '-(\\d{8})([a-z]?)\\.json$'); }

test('③ ★接线锁：三处源码的取件正则必须含后缀组', () => {
  const sites = [
    { file: 'p1b/scripts/calibration-report.cjs', pats: [/stage4-run-five-layers-\(\\d\{8\}\)\(\[a-z\]\?\)/, /g2-report-latest-\(\\d\{8\}\)\(\[a-z\]\?\)/] },
    { file: 'p1b/scripts/board.cjs', pats: [/stage4-run-five-layers-\(\\d\{8\}\)\(\[a-z\]\?\)/, /g2-report-latest-\(\\d\{8\}\)\(\[a-z\]\?\)/] },
    { file: 'p1b/src/routes/disclosure.js', pats: [/forecast-calendar-\(\\d\{8\}\)\(\[a-z\]\?\)/, /calibration-report-\(\\d\{8\}\)\(\[a-z\]\?\)/] },
  ];
  const bad = [];
  for (const s of sites) {
    const src = fs.readFileSync(path.join(ROOT, s.file), 'utf8');
    for (const p of s.pats) if (!p.test(src)) bad.push(s.file + ' 缺后缀组：' + String(p));
    // 反向：不得残留旧式（无后缀组）
    if (/(stage4-run-five-layers|calibration-report|g2-report-latest|forecast-calendar)-\\d\{8\}\\\.json\$/.test(src)) {
      bad.push(s.file + ' 残留旧式正则（无后缀组）');
    }
  }
  assert.deepEqual(bad, [], '以下位置的正则未含后缀组（后缀件将被静默忽略）：\n' + bad.join('\n'));
});
