'use strict';
/**
 * 局鉴 · test/zero-dep.test.cjs —— 零依赖面不许扩大
 *
 * ══ 守的是什么 ═════════════════════════════════════════════════════════
 *   实测（2026-10-04）：
 *     bin/jujian.cjs        零依赖 ✔
 *     bin/jujian-mcp.cjs    零依赖 ✔
 *     bin/jujian-bench.cjs  零依赖 ✔
 *     src/server.js         需要 fastify
 *
 *   也就是说：**用户只要一个 Node 就能用命令行、接 MCP、跑盲测**，
 *   不需要 `npm install`，不需要联网装任何包。HTTP 服务才需要 fastify。
 *
 *   这条性质对「能不能被人真的用起来」的影响，比任何功能都大：
 *   多一个 `npm install`，就多一批装不上的人；而那批人正是最该被服务到的
 *   ——想用它在饭桌上记两句话的人，他们不写代码。
 *
 * ══ 为什么必须用机械守卫 ═══════════════════════════════════════════════
 *   它会**不知不觉**变大：某天有人为了省事，在 CLI 里 require 了 server.js
 *   或者某个 HTTP 中间件，于是「零依赖」变成「忘了装 fastify 就全盘崩」。
 *   症状是用户照 README 的三步走，第三步报 MODULE_NOT_FOUND，
 *   而原因藏在三个提交之前。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

/**
 * 静态扫某个入口的整棵依赖树，看有没有第三方包。
 * 不 require（bin/* 一被 require 就会执行），改为解析 require 的字面量。
 */
function thirdPartyDeps(entry) {
  const seen = new Set();
  const found = new Set();
  const stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !file.endsWith('.js')) continue;
    seen.add(file);
    let src;
    try { src = require('node:fs').readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (spec.startsWith('node:') || spec.startsWith('.')) {
        stack.push(path.resolve(path.dirname(file), spec));
      } else {
        found.add(spec);
      }
    }
  }
  return [...found].sort();
}

test('★① 三个零依赖入口不得沾任何第三方包', () => {
  const zeroDep = ['bin/jujian.cjs', 'bin/jujian-mcp.cjs', 'bin/jujian-bench.cjs'];
  for (const e of zeroDep) {
    const deps = thirdPartyDeps(e).filter((d) => !d.startsWith('node:'));
    assert.deepEqual(deps, [],
      `★${e} 沾上了第三方包 ${deps.join(', ')} —— 命令行/MCP/盲测必须「只要一个 Node」`);
  }
});

test('② 只有 HTTP 服务允许需要 fastify', () => {
  const deps = thirdPartyDeps('src/server.js');
  const third = deps.filter((d) => !d.startsWith('node:'));
  assert.deepEqual(third, ['fastify'],
    'src/server.js 的第三方依赖应当恰好只有 fastify，实际是 ' + third.join(', '));
});

test('★③ 包依赖声明必须与实际一致（声明多一个就等于给用户多一道坎）', () => {
  const pkg = require('../package.json');
  const declared = Object.keys(pkg.dependencies || {});
  assert.deepEqual(declared, ['fastify'],
    '★package.json 声明的运行时依赖应当只有 fastify，实际：' + declared.join(', '));
  assert.ok(!pkg.devDependencies || !Object.keys(pkg.devDependencies).length,
    '★不该有 devDependencies —— 那些是开发期依赖，会让人以为运行时也要装');
});

/** 造一份「像发行包那样干净」的副本：源码 + 数据 + bin，没有 node_modules。 */
function cleanCopy() {
  const fs = require('node:fs');
  const os = require('node:os');
  const build = require('../scripts/build-release.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jujian-zerodep-'));
  // ★建进**自己的临时目录**，不从共享的 out/ 复制（见 build() 的注释）
  const { tree, files } = build.build(tmp);
  const dst = path.join(tmp, path.basename(tree));
  for (const rel of files) {
    const to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(tree, rel), to);
  }
  return { dir: dst, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

test('④ 零依赖入口在一份**没有 node_modules** 的发行树里也要能跑', (t) => {
  // ★第一版是把仓库里真实的 node_modules 临时改名藏起来 —— **那是给自己埋雷**：
  //   `node --test` 默认并行跑测试文件，而 api.test.cjs 这类文件正需要 fastify，
  //   它在我藏它的那 200 毫秒里起不来 ⇒ 两条毫不相干的测试变红。
  //   （症状：只有跑并行批才红，单跑不红 —— 这种红最难定位。）
  //   ⇒ 改成**复制一份干净的发行树**再跑：与其它测试零干扰，且测的正是发行物本身。
  const { dir, cleanup } = cleanCopy();
  t.after(cleanup);
  const cp = require('node:child_process');
  for (const [entry, input, label] of [
    ['bin/jujian-bench.cjs', '', '盲测'],
    ['bin/jujian-mcp.cjs', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n', 'MCP'],
    ['bin/jujian.cjs', undefined, '命令行'],
  ]) {
    const argv = entry.endsWith('jujian.cjs') && !entry.includes('bench') && !entry.includes('mcp')
      ? [path.join(dir, entry), 'games-types', '--json'] : [path.join(dir, entry)];
    const r = cp.spawnSync(process.execPath, argv, {
      input: input || '', encoding: 'utf8', timeout: 60000,
      env: Object.assign({}, process.env, { JUJIAN_DB: ':memory:', JUJIAN_LLM_MOCK: '1' }),
    });
    assert.equal(r.status, 0,
      `★${label}在无 node_modules 的发行树里跑不起来（退出码 ${r.status}）：${String(r.stderr || '').slice(0, 300)}`);
  }
});

test('⑤ 体检在零依赖环境下不许报阻塞项', (t) => {
  const { dir, cleanup } = cleanCopy();
  t.after(cleanup);
  const cp = require('node:child_process');
  const r = cp.spawnSync(process.execPath, [path.join(dir, 'scripts', 'doctor.cjs')],
    { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env) });
  const out = r.stdout || '';
  const bad = out.split('\n').filter((l) => l.includes('✖') && !/fastify/.test(l));
  assert.deepEqual(bad, [], '★零依赖环境下体检报了阻塞项：' + bad.join(' | '));
  assert.match(out, /零依赖|只要一个 Node/, '★体检应当把「零依赖」这件事说出来');
  // ★fastify 没装必须是**提醒**不是阻塞 —— 报阻塞等于告诉用户「装不上」，
  //   而他其实完全能用命令行/MCP/盲测（这条是本用例存在的全部理由）。
  assert.match(out, /!.*fastify/, '★fastify 未装应当报成提醒（!），不是阻塞（✖）');
});