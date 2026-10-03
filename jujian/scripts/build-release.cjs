#!/usr/bin/env node
'use strict';
/**
 * 局鉴 · scripts/build-release.cjs —— 打发行包
 *
 *   node scripts/build-release.cjs                 # 打到 ../out/
 *   node scripts/build-release.cjs --audit         # 只体检发行树，不打包
 *
 * ══ 这个包里装什么、不装什么 ═════════════════════════════════════════════
 *   装：源码 · 角色数据 · 文档 · 盲测档案 · 闸门与守卫
 *   不装：node_modules（用户 npm install，或干脆不用）· 运行期库文件 · .git
 *        · 测试临时产物 · 玩家自己的对局导出
 *
 *   ★**不带 node_modules 是刻意的**：局鉴的存储用 Node 自带的 node:sqlite，
 *   没有原生模块要编、没有平台二进制要对。三条零依赖入口（命令行/MCP/盲测）
 *   解压完就能直接跑。
 *
 * ══ 为什么要自建一个打包器 ═══════════════════════════════════════════════
 *   局鉴是从推演沙盘里独立出来的，而沙盘那边有个硬约束：便携 node.exe 的
 *   **再分发权未确认**，那让它转 public 前必须先解决（见看板〇·八未销账第①条）。
 *   局鉴不吃那个红利，所以它**不需要随包发一个 Node** ——
 *   用户自己有 Node 就有，没 Node 去装一个就行了。
 *   ⇒ 这一条让局鉴的发行没有「转 public 前的法律前置」，比沙盘干净一档。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const pkg = require('../package.json');

// ── 打包清单：写死，不靠通配 ──────────────────────────────────────────────
//   通配会在某天悄悄多带一个目录出去（比如带上了运行期库文件）。
//   这里逐条列，发行体检会核对「实际打进去的 == ��里列的」。
const INCLUDE_FILES = [
  'LICENSE', 'README.md', 'package.json',
  'bin/jujian.cjs', 'bin/jujian-mcp.cjs', 'bin/jujian-bench.cjs',
  'data/roles-zh.json',
  'docs/CAPABILITIES.md', 'docs/mcp/server.json',
  'gates/gates.cjs',
  'scripts/doctor.cjs', 'scripts/smoke.cjs', 'scripts/build-release.cjs',
];

const INCLUDE_DIRS = ['src', 'bench', 'test', 'web'];

/** 构建期的标记文件：只给 Node 看，浏览器与发行包都不需要。
 *  web/package.json 声明那里是 ES 模块目录 —— 浏览器本来��按模块加载它，
 *  Node 也需要它，但**发行包的用户不会去跑 Node 的测试**，带着它只是多一份构建配置。 */
const TOOLING = new Set(['web/package.json']);

const EXCLUDE_RE = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /\.db$|\.db-wal$|\.db-shm$/,
  /(^|\/)data\/[^/]*\.db/,
  /\.tmp$|(^|\/)tmp(\/|$)/,
  /(^|\/)\.DS_Store$/,
  /\.orig$|\.bak$|\.log$/,
];

const OUT_DIR = path.join(REPO, 'out');
const TREE_NAME = 'jujian-sandbox-v' + pkg.version + '-src';

function excluded(rel) { return EXCLUDE_RE.some((re) => re.test(rel)); }

function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}

function collect() {
  const files = [];
  for (const f of INCLUDE_FILES) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) throw new Error('打包清单里的文件不存在: ' + f);
    files.push(f);
  }
  for (const d of INCLUDE_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) throw new Error('打包清单里的目录不存在: ' + d);
    for (const rel of walk(abs, d)) if (!excluded(rel) && !TOOLING.has(rel)) files.push(rel);
  }
  return files.sort();
}

/** 发行体检：把「这个包能不能被人用起来」逐条查一遍。全部只读。 */
function audit(tree) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // ① 必需文件都在
  for (const f of ['README.md', 'LICENSE', 'package.json', 'bin/jujian.cjs',
    'bin/jujian-mcp.cjs', 'bin/jujian-bench.cjs', 'data/roles-zh.json']) {
    add('必需文件 ' + f, fs.existsSync(path.join(tree, f)), '');
  }

  // ② **不得带 node_modules** —— 带了会让用户以为必须用它，也平白大几 MB
  const nm = fs.existsSync(path.join(tree, 'node_modules'));
  add('不含 node_modules', !nm, nm ? '★发行树里出现了 node_modules' : '');

  // ③ 不得带运行期库文件（里面是玩家这一局的发言）
  const strays = [];
  (function scan(dir) {
    for (const n of fs.readdirSync(dir)) {
      const a = path.join(dir, n);
      if (fs.statSync(a).isDirectory()) scan(a);
      else if (/\.(db|db-wal|db-shm|sqlite3?)$/.test(n)) strays.push(path.relative(tree, a));
    }
  })(tree);
  add('不含运行期库文件', strays.length === 0, strays.join(', '));

  // ④ ★零依赖入口在发行树里真跑一次（不放 node_modules 的前提下）
  for (const [entry, args, label] of [
    ['bin/jujian-bench.cjs', [], '盲测'],
    ['bin/jujian-mcp.cjs', [], 'MCP'],
    ['bin/jujian.cjs', ['games-types', '--json'], '命令行'],
  ]) {
    const r = runIsolated(tree, entry, args);
    add('发行树里跑得起来 · ' + label, r.code === 0, r.code === 0 ? '' : r.err.slice(0, 200));
  }

  // ⑤ 角色数据完整
  try {
    const roles = JSON.parse(fs.readFileSync(path.join(tree, 'data', 'roles-zh.json'), 'utf8'));
    add('角色数据完整', Array.isArray(roles) && roles.length >= 100, roles.length + ' 个角色');
  } catch (e) {
    add('角色数据完整', false, e.message);
  }

  // ⑥ README 里没有本机路径与用户名
  const readme = fs.readFileSync(path.join(tree, 'README.md'), 'utf8');
  add('README 无本机路径', !/[A-Za-z]:\\|C:\\Users/.test(readme), '');
  add('README 无用户名', !/Users\\crx/.test(readme), '');

  // ⑦ ★不得声称「随包附 Node」（那个再分发权未确认）
  add('未声称随包附 Node', !/随包.*node|附带\s*Node|内置\s*Node/i.test(readme),
    '★便携 Node 的再分发权未确认，不得宣称');

  // ⑧ 盲测档案齐全（5 局双层）
  let games = 0;
  try {
    games = fs.readdirSync(path.join(tree, 'bench', 'archives'))
      .filter((f) => f.endsWith('.md') && !f.endsWith('.truth.md')).length;
  } catch (_) { /* 目录缺失已由 ① 的必需文件间接覆盖 */ }
  add('盲测档案 5 局', games === 5, games + ' 局');

  // ⑧ 网页：五个屏都要能取到，且 web/package.json（ES 模块标记）**不外发**
  for (const u of ['index.html', 'app.css', 'app.js', 'api.js', 'views/games.js', 'views/record.js', 'views/review.js', 'views/about.js']) {
    add('网页 ' + u, fs.existsSync(path.join(tree, 'web', u)), '');
  }
  add('网页构建标记不外发', !fs.existsSync(path.join(tree, 'web', 'package.json')),
    '★web/package.json 只是 ES 模块标记，浏览器用不到，不该进发行包');

  return checks;
}

/** 在发行树里、不带任何 NODE_PATH 的情况下真跑一次。 */
function runIsolated(tree, entry, args) {
  const env = Object.assign({}, process.env);
  delete env.NODE_PATH;
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  env.JUJIAN_DB = ':memory:';
  env.JUJIAN_LLM_MOCK = '1';
  try {
    const out = execFileSync(process.execPath, [path.join(tree, entry), ...args],
      { encoding: 'utf8', env, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: e.stdout || '', err: String(e.stderr || e.message) };
  }
}

/**
 * ★outDir 可指定 —— 零依赖测试要把发行树建进自己的临时目录。
 *   第一版它从固定的 out/ 复制，于是「谁在 out/ 里重建发行包」就会把它搞挂：
 *   症状是只有并行时红、单跑不红，且错在一条毫不相干的用例上。
 *   共享的输出目录就是一条看不见的依赖，切断它。
 */
function build(outDir) {
  const files = collect();
  const tree = path.join(outDir || OUT_DIR, TREE_NAME);
  fs.rmSync(tree, { recursive: true, force: true });
  for (const rel of files) {
    const dst = path.join(tree, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  return { tree, files };
}

function manifest(tree, files) {
  const lines = ['# 局鉴发行清单（build-release.cjs 生成，勿手改）', ''];
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(tree, rel));
    lines.push(crypto.createHash('sha256').update(buf).digest('hex') + '  ' + rel);
  }
  fs.writeFileSync(path.join(tree, 'MANIFEST.sha256'), lines.join('\n') + '\n');
  return files.length;
}

function dirSize(dir) {
  let n = 0;
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const a = path.join(d, f);
      if (fs.statSync(a).isDirectory()) walk(a);
      else n += fs.statSync(a).size;
    }
  })(dir);
  return n;
}

function main() {
  const auditOnly = process.argv.includes('--audit');
  const { tree, files } = auditOnly ? { tree: ROOT, files: collect() } : build(process.env.JUJIAN_OUT_DIR);
  const n = auditOnly ? 0 : manifest(tree, files);

  const checks = audit(tree);
  const bad = checks.filter((c) => !c.ok);

  process.stdout.write('\n局鉴发行体检\n');
  process.stdout.write('─'.repeat(60) + '\n');
  if (!auditOnly) {
    process.stdout.write('  发行树   ' + tree + '\n');
    process.stdout.write('  文件数   ' + n + '｜体积 ' + (dirSize(tree) / 1024 / 1024).toFixed(2) + ' MB\n');
    process.stdout.write('  版本     ' + pkg.version + '\n\n');
  }
  for (const c of checks) {
    process.stdout.write('  ' + (c.ok ? '✔' : '✖') + ' ' + c.name.padEnd(28) + (c.ok ? c.detail : '★' + c.detail) + '\n');
  }
  process.stdout.write('\n' + (bad.length ? '✖ ' + bad.length + ' 项不过，不可发布。\n' : '✔ 发行体检全过。\n') + '\n');
  process.exit(bad.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { collect, audit, build, INCLUDE_FILES, INCLUDE_DIRS, EXCLUDE_RE, TREE_NAME };