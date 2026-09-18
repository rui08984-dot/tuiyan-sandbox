'use strict';
/**
 * p1b/test/file-map-binary-guard.test.cjs —— 地图生成器**二进制泄漏**守卫（2026-09-18）
 *
 * 不变量：**`file-map.cjs` 的产物不得含 NUL 等 C0 控制字符，也不得把二进制体当「一句话」写进去**。
 *
 * 事故背景（本条即回归锁）：地图文件 `项目全资源地图-20260914.md` 里
 * `p1b/test/fixtures/stage4-golden-db-20260917.db` 一行的摘要**是 SQLite 原始头字节**（含 NUL）
 * ⇒ 该 tracked 文件对 grep／编辑器／Edit 类工具变成「二进制」（**已进 HEAD**，承 §23 的 A 类重跑）。
 * 根因：`headline()` 用 `fs.readFileSync(p,'utf8')` —— **对二进制不抛错**（非法字节静默替换成 U+FFFD），
 * 于是 `catch { return '（不可读/二进制）' }` 这道守卫**从不触发**。
 * 修法：判据下移到**字节层**（前 8KB 出现 NUL 即视为二进制）＋出口 sanitize ＋写盘前含 NUL 即 exit 3。
 *
 * 检测口径：跑一次真实生成到**临时目录**（不碰仓库产物），断言 ① 无 NUL ② 文中无 `SQLite format`
 * ③ 二进制夹具行走到「不抽句」分支；并用**对照组**证明断言非恒真（对确有文本的可读件仍能抽出句子）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'file-map.cjs');
const BIN_FIXTURE = path.join(ROOT, 'p1b', 'test', 'fixtures', 'stage4-golden-db-20260917.db');

test('① 前置：仓库里确有二进制夹具（否则本测试无意义）', () => {
  assert.ok(fs.existsSync(BIN_FIXTURE), '二进制夹具应存在: ' + BIN_FIXTURE);
  const buf = fs.readFileSync(BIN_FIXTURE);
  assert.ok(buf.includes(0), '夹具应含 NUL 字节（正是本守卫要防的东西）');
  assert.ok(buf.slice(0, 16).toString('latin1').startsWith('SQLite format 3'), '夹具应为 SQLite 文件头');
});

test('② 生成物无 NUL、无二进制头 —— 回归锁（本件修复前必红）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-filemap-'));
  try {
    const out = path.join(tmp, 'map.md');
    execFileSync(process.execPath, [SCRIPT, '--out', out], { encoding: 'utf8' });
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(!/\u0000/.test(text), '生成物不得含 NUL（二进制泄漏）');
    assert.ok(!/SQLite format/.test(text), '生成物不得含 SQLite 文件头');
    // C0 控制字符（除 \n \t）一律不得出现
    const ctrl = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g);
    assert.equal(ctrl, null, '生成物不得含 C0 控制字符: ' + JSON.stringify(ctrl));
    // 该二进制夹具必须以「不抽句」形态出现
    const line = text.split('\n').find((l) => l.includes('stage4-golden-db-20260917.db'));
    assert.ok(line, '应列出该二进制夹具');
    assert.ok(/不抽句|二进制/.test(line), '二进制件须走「不抽句」分支: ' + line);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
});

test('③ 对照组：可读件仍能抽出句子（证明断言非恒真）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-filemap-'));
  try {
    const out = path.join(tmp, 'map.md');
    execFileSync(process.execPath, [SCRIPT, '--out', out], { encoding: 'utf8' });
    const text = fs.readFileSync(out, 'utf8');
    const fileLines = text.split('\n').filter((l) => /^- `[^`]+` —— /.test(l));
    // 反恒真：若「不抽句」成了**普遍**分支，说明守卫过度触发（把可读件也判成二进制）⇒ 本测试报红。
    const noSentence = fileLines.filter((l) => /不抽句|二进制|不可读/.test(l));
    assert.ok(fileLines.length > 50, '应有大量逐件条目: ' + fileLines.length);
    assert.ok(noSentence.length < fileLines.length * 0.1,
      '「不抽句」不得成为普遍分支（' + noSentence.length + '/' + fileLines.length + '）');
    const substantive = fileLines.filter((l) => !/不抽句|二进制|不可读|无一句话可抽/.test(l));
    assert.ok(substantive.length > 50, '多数可读件应抽出实质摘要: ' + substantive.length);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
});

test('④ 本测试不写仓库（零副作用）', () => {
  const before = fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).sort().join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-filemap-'));
  try {
    execFileSync(process.execPath, [SCRIPT, '--out', path.join(tmp, 'm.md')], { encoding: 'utf8' });
    assert.equal(fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).sort().join('\n'), before, '不得写入 sim/out');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
});
