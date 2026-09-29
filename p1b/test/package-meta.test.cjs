'use strict';
/**
 * p1b/test/package-meta.test.cjs —— 包元数据守卫（licensing 模块 · 2026-09-30）
 *
 * 不变量：① 两个子包的 `private` **不得**是 `true`（true ⇒ npm 直接拒发，陌生人装不上）
 *         ② 两个子包的 `license` 必须是 `Apache-2.0`（不是 UNLICENSED —— 那是"版权所有，保留一切"）
 *         ③ 根 `files` 白名单**逐条显式**列出，**绝不含** `config/` 与 `*.db`
 *         ④ 根 `LICENSE` 是 Apache-2.0 全文（不是占位、不是 MIT）
 *
 * ★两条反向锁（本件的价值全在这里 —— 正向断言会随改动一起被改掉，反向锁不会）：
 *   · checkPkgMeta({private:true}) 必须判红 —— 「有人把 private 改回去」当场红
 *   · checkFiles([..., 'p1a-terminal/config']) 必须判红 —— 「有人把凭证目录塞进白名单」当场红
 *   判据函数若被改成恒真，上面两条会先红，所以它们是判据本身的守卫。
 *
 * ★本件**不改** p1b/src/deps.js:9 的跨目录解析 —— 根 package.json 把两个目录打进同一
 *   tarball 保持相对路径就是正解（见 docs/specs/SPEC-licensing.md §关于根 package.json）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const SUB_PKGS = ['p1b/package.json', 'p1a-terminal/package.json'];

// —— 判据（导出给反向锁复用）——
/** 子包元数据是否可发。返回 {ok, why[]}。 */
function checkPkgMeta(j, label) {
  const why = [];
  if (j.private === true) why.push(`${label} 仍是 private:true（npm 会直接拒发）`);
  if (j.license !== 'Apache-2.0') why.push(`${label} 的 license 是 ${JSON.stringify(j.license)}，不是 Apache-2.0`);
  return { ok: why.length === 0, why };
}

/** 根 files 白名单是否安全。返回 {ok, why[]}。 */
function checkFiles(files) {
  const why = [];
  if (!Array.isArray(files) || files.length === 0) return { ok: false, why: ['根 package.json 没有 files 白名单'] };
  for (const raw of files) {
    // 否定项（! 前缀）只做排除，不可能「带进」东西，故跳过内容检查（但仍查它自己是否含 glob）
    if (/[*?]/.test(raw)) why.push(`白名单含 glob「${raw}」——必须逐条显式列出`);
    if (raw.startsWith('!')) continue;
    // ★必须同时匹配「config/」（目录内容）与「config」（目录本身）两种写法
    if (/(^|\/)config(\/|$)/.test(raw)) why.push(`白名单含 config/：${raw}（里面有 providers.json 真 key）`);
    if (/\.db(-shm|-wal)?$/.test(raw)) why.push(`白名单含数据库：${raw}`);
    if (/(^|\/)\.env(\.|$)/.test(raw)) why.push(`白名单含 .env：${raw}`);
  }
  return { ok: why.length === 0, why };
}

// ————————————————————————————————————————————————————
test('① 两个子包：private 已去掉、license 已是 Apache-2.0', () => {
  for (const p of SUB_PKGS) {
    const r = checkPkgMeta(readJson(p), p);
    assert.equal(r.ok, true, r.why.join('；'));
  }
});

test('② ★反向锁：把 private 改回去，判据必须咬人', () => {
  const r = checkPkgMeta({ private: true, license: 'Apache-2.0' }, '夹具');
  assert.equal(r.ok, false, '这条闸必须咬人：private:true 一律判红');
  assert.ok(r.why.some((w) => w.includes('private')), `理由里必须点名 private，实际：${JSON.stringify(r.why)}`);

  const r2 = checkPkgMeta({ license: 'UNLICENSED' }, '夹具');
  assert.equal(r2.ok, false, '这条闸必须咬人：UNLICENSED 一律判红');
  assert.ok(r2.why.some((w) => w.includes('license')), `理由里必须点名 license，实际：${JSON.stringify(r2.why)}`);
});

test('③ 根 package.json 存在，files 逐条显式，且绝不含 config/ 或 *.db', () => {
  const root = readJson('package.json');
  const r = checkFiles(root.files);
  assert.equal(r.ok, true, r.why.join('；'));
});

test('④ files 白名单确实把两个目录都装进去了（保持 deps.js:9 的相对路径）', () => {
  const files = readJson('package.json').files;
  const incl = files.filter((f) => !f.startsWith('!'));
  const has = (prefix) => incl.some((f) => f === prefix || f.startsWith(prefix + '/'));
  assert.ok(has('p1a-terminal'), `files 未列入 p1a-terminal：${JSON.stringify(incl)}`);
  assert.ok(has('p1b'), `files 未列入 p1b：${JSON.stringify(incl)}`);
  // ★零代码改动方案的锚：两个目录必须同处一个 tarball 的相邻位置，deps.js 的 '..','..' 才解析得到
  assert.ok(incl.some((f) => f === 'p1a-terminal/src'), 'p1a-terminal/src 必须在白名单里（deps.js:11 直接 require 它）');
  assert.ok(incl.some((f) => f === 'p1b/src'), 'p1b/src 必须在白名单里（deps.js 的 __dirname 在此）');
});

test('⑤ ★反向锁：把 config/ 或 .db 塞进白名单，判据必须咬人', () => {
  const bad = ['p1a-terminal/src', 'p1a-terminal/config', 'p1a-terminal/data/p1a.db'];
  const r = checkFiles(bad);
  assert.equal(r.ok, false, '这条闸必须咬人');
  assert.equal(r.why.length, 2, `应点名两条（config/ 与 .db），实际：${JSON.stringify(r.why)}`);
  assert.ok(r.why.some((w) => w.includes('config/')), '理由里必须点名 config/');
  assert.ok(r.why.some((w) => w.includes('数据库')), '理由里必须点名 .db');

  // glob 也必须咬人（spec Code Style：files 不用 glob）
  const g = checkFiles(['p1a-terminal/**/*.js']);
  assert.equal(g.ok, false, 'glob 写法必须判红');
});

test('⑥ 根 LICENSE 是 Apache-2.0 全文（含 9 条条款与 APPENDIX，不是占位）', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.ok(txt.includes('Apache License'), 'LICENSE 缺 Apache License 抬头');
  assert.ok(txt.includes('Version 2.0, January 2004'), 'LICENSE 缺版本行');
  for (const sec of [
    '1. Definitions.', '2. Grant of Copyright License.', '3. Grant of Patent License.',
    '4. Redistribution.', '5. Submission of Contributions.', '6. Trademarks.',
    '7. Disclaimer of Warranty.', '8. Limitation of Liability.',
    '9. Accepting Warranty or Additional Liability.',
  ]) {
    assert.ok(txt.includes(sec), `LICENSE 缺条款：${sec}`);
  }
  assert.ok(txt.includes('END OF TERMS AND CONDITIONS'), 'LICENSE 缺条款结束标记');
  assert.ok(txt.includes('APPENDIX: How to apply the Apache License to your work.'), 'LICENSE 缺 APPENDIX（不是全文）');
  assert.ok(!/MIT License/i.test(txt), 'LICENSE 混进了 MIT');
});

test('⑦ 根 package.json 的 license 是 Apache-2.0，且未设 private:true', () => {
  const r = checkPkgMeta(readJson('package.json'), 'package.json');
  assert.equal(r.ok, true, r.why.join('；'));
});

test('⑧ docs/RIGHTS.md 存在且含 8 条红线（对外版全文）', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'docs', 'RIGHTS.md'), 'utf8');
  const numbered = txt.match(/^\d+\. /gm) || [];
  assert.equal(numbered.length, 8, `RIGHTS.md 应恰有 8 条编号红线，实际 ${numbered.length} 条`);
  // 逐条抽查锚句（防止有人把红线删成 6 条再重新编号）
  for (const anchor of [
    '不做事后补写', '推荐下注', '默认**不联网**', '出网白名单',
    '市场共识数据', '不提供境外托管', '不写入**姓名、邮箱、工号', '不记录调用方身份',
  ]) {
    assert.ok(txt.includes(anchor), `RIGHTS.md 缺红线锚句：${anchor}`);
  }
});
