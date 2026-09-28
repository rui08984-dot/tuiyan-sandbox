#!/usr/bin/env node
/**
 * p1b 四道闸门统一跑法（零新依赖 · 纯 node 内置模块）
 * ---------------------------------------------------------------------------
 * 背景：本项目【没有 git 远端】（`git remote -v` 输出为空，实测 2026-09-28），
 * 所以 GitHub Actions 这条路在本机根本跑不起来。闸门只能是本地形态。
 *
 * 用法：
 *   node p1b/gates/gates.cjs          # 四道全跑
 *   node p1b/gates/gates.cjs --list   # 只列出将要跑的文件，不执行
 *   （在 p1b 下等价于 `npm run gates`）
 *
 * 想把这四道挂到提交前，见同目录 pre-commit.sh 的文件头（含一条启用命令）。
 *
 * 行为约定：
 *   1. 四道【全跑】，任一道红则整体退出码非 0（不短路——短路会让人以为后面几道是绿的）。
 *   2. 逐道打印【退出码】与【用时】，末尾再打一张汇总表。
 *   3. 绝不修改任何文件：这里只 spawn 只读/构建类命令，没有任何 --fix / --write 形参。
 *      唯一的写副作用是「构建」道写 p1b/web/dist/（已在 .gitignore:7，不入库）。
 *   4. 一切路径以本文件位置反推（__dirname），所以从任何 cwd 调用都成立。
 *
 * ★为什么「构建」排在「前端测试」前面：
 *   p1b/web/dist.test.mjs:9-11 断言 dist/assets 必须存在，否则报 ENOENT 直接 exit 1。
 *   实测：把 dist/ 挪走再单跑该文件 → EXIT=1（见交付报告）。
 *   若按「后端→前端→类型→构建」的顺序跑，新机器 clone 后 dist 不存在，前端道必假红。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// __dirname = <repo>/p1b/gates
const P1B = path.resolve(__dirname, '..');
const REPO = path.resolve(P1B, '..');

// ---------------------------------------------------------------------------
// 文件枚举：自己拼 glob，不依赖 shell。
// 理由 1：npm scripts 在 Windows 上走 cmd.exe，** 根本不展开。
// 理由 2：显式列举可复现；node 的递归发现规则会顺手捞进 test/ 下的 .log/.json/.db。
// 排序固定，保证同一 commit 每次跑的是同一批文件（可复现）。
// ---------------------------------------------------------------------------

/** 列出 p1b/test 下全部 *.test.cjs（后端道） */
function backendTests() {
  const dir = path.join(P1B, 'test');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.test.cjs'))
    .sort()
    .map((f) => path.join('test', f));
}

/** 递归列出 p1b/web/src 下全部 *.test.mjs（前端道，不含 dist.test.mjs） */
function frontendTests() {
  const out = [];
  (function walk(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.name.endsWith('.test.mjs')) out.push(path.join('web', 'src', rel));
    }
  })(path.join(P1B, 'web', 'src'), '');
  return out.sort();
}

/**
 * ★2026-09-29 补齐：原来这里只喊一声「本门未覆盖 test/meihua.js」。
 *   「知道自己没覆盖」和「覆盖了」差着一整个用例 —— 现在直接把它纳进后端道。
 *   它是全仓唯一一个非 `.test.cjs` 的用例文件，node 递归发现本来就会捞它，
 *   所以纳入后**全量口径与 node 自身一致**，不再有「门绿了但全量没跑」的缝。
 *   仍保留 OUT_OF_SCOPE_HINT（措辞改为「已覆盖，但命名不规范」），
 *   因为**命名不规范本身是一条信息**：下一个人照 `.test.cjs` 写新测试，别照它写。
 */
const EXTRA_BACKEND = [path.join('test', 'meihua.js')];
const OUT_OF_SCOPE_HINT = {
  file: path.join('test', 'meihua.js'),
  reason: '唯一一个非 .test.cjs 的用例文件（命名不规范，但它已被本门覆盖）。',
};

/**
 * ★2026-09-29 新增：闸门**自身**的形态自检。
 *   起因是 2026-09-28 第七批我给 `world.run` 传了**目录** `p1b/test`，
 *   Node v24 会把 `--test` 的目录位置参当**模块**去 require ⇒ `Cannot find module`，
 *   **一个用例都没跑**却恒红。本仓 buglog bug-9-mttcixzo 早已记过同一个坑，我漏抄。
 *   那个坑在「工作流脚本」里，本文件管不到，所以在这里**把形态钉死**：
 *   后端道必须逐个列出测试文件，且清单非空。
 */
function assertGateShape() {
  const files = backendTests();
  if (!files.length) throw new Error('闸门自检失败：后端道测试清单为空 —— 那样它会「跑 0 个用例」却报绿');
  for (const f of files) {
    if (fs.statSync(path.join(P1B, f)).isDirectory()) {
      throw new Error('闸门自检失败：后端道清单里混进了目录 ' + f +
        ' —— Node v24 会把 --test 的目录位置参当模块 require，跑 0 个用例却恒红');
    }
  }
  return files.length + EXTRA_BACKEND.length;
}

// ---------------------------------------------------------------------------
// 四道闸门（顺序即执行顺序，理由见文件头）
// 命令行与任务书逐字一致，只有 cwd 不同（任务书隐含在仓库根，这里显式声明）。
// ---------------------------------------------------------------------------

function buildGates() {
  const node = process.execPath; // 用绝对路径，避免 PATH 里没有 node 时静默失败
  return [
    {
      id: 'backend',
      label: '后端 · node --test（p1b/test/*.test.cjs ＋ meihua.js）',
      cwd: P1B,
      args: ['--test', '--test-reporter=dot', ...backendTests(), ...EXTRA_BACKEND],
      cmdForDisplay: () => `node --test --test-reporter=dot test/*.test.cjs test/meihua.js  （${backendTests().length + EXTRA_BACKEND.length} 个文件）`,
    },
    {
      id: 'build',
      label: '构建 · vite build p1b/web',
      cwd: REPO,
      args: [path.join('p1b', 'web', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', 'p1b/web'],
      cmdForDisplay: () => 'node p1b/web/node_modules/vite/bin/vite.js build p1b/web',
      producesDist: true,
    },
    {
      id: 'frontend',
      label: '前端 · node --test（p1b/web/src/**/*.test.mjs ＋ p1b/web/dist.test.mjs）',
      cwd: P1B,
      args: ['--test', '--test-reporter=dot', ...frontendTests(), path.join('web', 'dist.test.mjs')],
      cmdForDisplay: () =>
        `node --test --test-reporter=dot web/src/**/*.test.mjs web/dist.test.mjs  （${frontendTests().length + 1} 个文件）`,
    },
    {
      id: 'types',
      label: '类型 · tsc --noEmit',
      cwd: REPO,
      args: [path.join('p1b', 'web', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join('p1b', 'web', 'tsconfig.json'), '--noEmit'],
      cmdForDisplay: () => 'node p1b/web/node_modules/typescript/bin/tsc -p p1b/web/tsconfig.json --noEmit',
    },
  ];
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法：node p1b/gates/gates.cjs [--list]');
  console.log('  无参数  四道闸门全跑，任一红 → 整体退出码非 0');
  console.log('  --list  只列出将要跑的文件');
  process.exit(0);
}

const gates = buildGates();
// ★2026-09-29：形态自检在**建表时**就跑，不等到执行 —— 清单形态错了要当场炸，
//   而不是跑完四道之后才发现后端道其实跑的是 0 个用例。
const backendFileCount = assertGateShape();

if (args.includes('--list')) {
  console.log('后端道文件（%d）：', backendFileCount);
  gates.find((g) => g.id === 'backend').args.slice(2).forEach((f) => console.log('  ' + f));
  console.log('前端道文件（%d）：', frontendTests().length + 1);
  frontendTests().forEach((f) => console.log('  ' + f));
  console.log('  ' + path.join('web', 'dist.test.mjs'));
  console.log('\n命名不规范提醒：%s —— %s', OUT_OF_SCOPE_HINT.file, OUT_OF_SCOPE_HINT.reason);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 开跑
// ---------------------------------------------------------------------------

const results = [];
const t0 = Date.now();
let buildFailed = false;

gates.forEach((g, i) => {
  const no = `${i + 1}/${gates.length}`;
  console.log('');
  console.log('='.repeat(72));
  console.log(`[闸门 ${no}] ${g.label}`);
  console.log(`  cwd     : ${g.cwd}`);
  console.log(`  命令     : ${g.cmdForDisplay()}`);
  console.log('='.repeat(72));

  const started = Date.now();
  let code;
  let spawnError = null;
  try {
    // stdio: 'inherit' —— 子进程直接接管终端。--test-reporter=dot 是必须的：
    // 默认 TAP 打 900+ 用例会超 256KB 输出上限（实测，见交付报告）。
    const r = spawnSync(process.execPath, g.args, { cwd: g.cwd, stdio: 'inherit', shell: false });
    if (r.error) spawnError = r.error;
    code = r.status === null ? 1 : r.status;
  } catch (e) {
    spawnError = e;
    code = 1;
  }
  const secs = (Date.now() - started) / 1000;

  if (spawnError) {
    console.log(`\n[闸门 ${no}] 启动失败：${spawnError.message}`);
    console.log('  常见原因：依赖没装（先在 p1b 与 p1b/web 各跑一次 npm install）。');
  }

  if (g.producesDist && code !== 0) buildFailed = true;

  console.log(`\n[闸门 ${no}] 退出码 = ${code}    用时 = ${secs.toFixed(2)}s`);
  results.push({ id: g.id, label: g.label, code, secs });
});

const total = (Date.now() - t0) / 1000;
const failed = results.filter((r) => r.code !== 0);

console.log('');
console.log('='.repeat(72));
console.log('四道闸门汇总');
console.log('='.repeat(72));
for (const r of results) {
  console.log(`  ${r.code === 0 ? '绿' : '红'}  ${r.id.padEnd(9)} 退出码=${String(r.code).padEnd(3)} 用时=${r.secs.toFixed(2)}s`);
}
console.log('-'.repeat(72));
console.log(`  总用时 = ${total.toFixed(2)}s`);

// 构建红时，前端道测的是【上一次的旧 dist】，必须说破，否则会被读成「前端也验证过产物」。
if (buildFailed) {
  console.log('  ⚠ 构建道红 → 前端道跑在【陈旧 dist】上，dist.test.mjs 的结果本次不作数。');
}
console.log(`  命名不规范：${OUT_OF_SCOPE_HINT.file}（${OUT_OF_SCOPE_HINT.reason}）`);
console.log('='.repeat(72));

if (failed.length > 0) {
  console.log('');
  console.log(`✖ ${failed.length}/${results.length} 道闸门红：${failed.map((f) => f.id).join('、')}`);
  console.log('  本脚本不改任何文件；要绕过请用 `git commit --no-verify`（仅在明确知道后果时）。');
  process.exit(1);
}

console.log('');
console.log('✔ 四道闸门全绿。');
process.exit(0);
