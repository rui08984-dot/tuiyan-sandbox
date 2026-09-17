'use strict';
/**
 * p1b/test/scripts-require-safety.test.cjs —— 脚本 require 安全守卫（2026-09-17）
 *
 * 不变量：**凡被测试 require 的脚本，必须「顶层无写盘」或「有 require.main === module 守卫」**。
 *
 * 事故背景（本条即回归锁）：`assumption-recalc.cjs` 顶层写盘 + 测试 `require(SCRIPT)` 取纯函数
 * ⇒ **每跑一次测试就往 `p1b/sim/out` 写同名件**；2026-09-16 终态归档提交后 1 秒即覆盖了同名
 * tracked 产物（权威版＝带 domain:openmeteo 排除），2026-09-17 又生成本日 stray 件。
 * 同族先例：`dna-s-source.test.cjs` 未传 `--out-dir` 把计划件写进仓库（p23 锚记）。
 *
 * 检测口径（静态、启发式，宁可漏报不误报）：
 *   ① require 目标 = 测试里 `const X = path.join(ROOT,'p1b','scripts','<名>.cjs')` 且**同文件内出现 `require(X)`**
 *      ——只认**模块加载**（进程内执行顶层代码）；`execFileSync(X, …)` 是独立进程的 CLI 调用，属另一类风险（另见锚）。
 *   ② 顶层写盘 = 行首列 0 处出现 fs./fsp. 的 writeFileSync|appendFileSync|mkdirSync|createWriteStream|
 *      copyFileSync|renameSync|rmSync|unlinkSync（缩进在函数体里的不算）。
 * 新增脚本若被测试 require 且顶层写盘 ⇒ 本测试报红，按同族范式收进 main() 并加守卫。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'p1b', 'scripts');
const TESTS = path.join(ROOT, 'p1b', 'test');

const TOP_WRITE = /^(fs|fsp)\.(writeFileSync|appendFileSync|mkdirSync|createWriteStream|copyFileSync|renameSync|rmSync|unlinkSync)\s*\(/;
/** ★ 2026-09-17 加：**顶层立即执行的副作用载体**——列 0 的 `process.exit(` 与列 0 的 IIFE（`(async () => {`）：
 *  它们同样在 `require` 时立刻执行（实例：odds-snapshot.cjs 曾用顶层 IIFE ⇒ 测试 require 时命中冷却闸 exit 3，
 *  而旧口径只扫 `fs.write*` ⇒ 漏检）。 */
const TOP_SIDE_EFFECT = /^(process\.exit\s*\(|\(async\s*\(\s*\)\s*=>\s*\{|\(function\s*\(\s*\)\s*\{|\(\s*\(\s*\)\s*=>\s*\{)/;

/** 测试里被**模块 require** 的脚本名（照 `const SCRIPT = path.join(ROOT,'p1b','scripts','x.cjs')` ＋ `require(SCRIPT)` 同形） */
function requiredByTests() {
  const names = new Set();
  const SELF = path.basename(__filename);   // 本件文档里含同形示例字样，跳过自身免误报
  for (const t of fs.readdirSync(TESTS).filter((f) => f.endsWith('.cjs') && f !== SELF)) {
    const src = fs.readFileSync(path.join(TESTS, t), 'utf8');
    const re = /const\s+(\w+)\s*=\s*path\.join\(\s*ROOT\s*,\s*['"]p1b['"]\s*,\s*['"]scripts['"]\s*,\s*['"]([^'"]+\.cjs)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (new RegExp('require\\(\\s*' + m[1] + '\\s*\\)').test(src)) names.add(m[2]);
    }
  }
  return names;
}

/** 顶层（列 0）写盘行 ＋ 顶层立即执行副作用行 */
function topLevelWrites(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => TOP_WRITE.test(l) || TOP_SIDE_EFFECT.test(l));
}

test('被测试 require 的脚本必须 require 安全（顶层写盘 ⇒ 须有 require.main 守卫）', () => {
  const names = requiredByTests();
  assert.ok(names.size >= 1, '未识别到任何被 require 的脚本——检测口径可能失效，须复核');
  const violations = [];
  const checked = [];
  for (const n of Array.from(names).sort()) {
    const p = path.join(SCRIPTS, n);
    assert.ok(fs.existsSync(p), '测试引用了不存在的脚本: ' + n);
    const writes = topLevelWrites(p);
    const guarded = /require\.main === module/.test(fs.readFileSync(p, 'utf8'));
    checked.push(n + (writes.length ? '(顶层写盘 ' + writes.length + ' 处, 守卫=' + guarded + ')' : '(无顶层写盘)'));
    if (writes.length && !guarded) violations.push(n + ' → ' + writes.length + ' 处顶层写盘且无 require.main 守卫');
  }
  assert.deepEqual(violations, [], '以下脚本会被测试 require 却在模块加载时写盘：\n' + violations.join('\n')
    + '\n已核: ' + checked.join(' | '));
});

test('对照组：检测器能识别出顶层写盘（证明不是恒真断言）', () => {
  const probe = path.join(TESTS, '__probe_topwrite__.cjs');
  fs.writeFileSync(probe, "const fs = require('fs');\nfs.writeFileSync('/tmp/x', 'y');\n", 'utf8');
  try {
    assert.equal(topLevelWrites(probe).length, 1, '检测器漏检顶层写盘');
    assert.equal(topLevelWrites(__filename).length, 0, '检测器把本文件误判为顶层写盘');
  } finally {
    fs.rmSync(probe, { force: true });
  }
});
