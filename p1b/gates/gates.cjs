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
 *   5. ★2026-09-30：一道闸可以是多「段」（目前只有后端道＝单跑批 ＋ 并行批）。
 *      段数、拆分理由、加入新段的条件，一律写在下面的 ISOLATED_BACKEND 里；
 *      汇总表仍按**四道**记，不把「段」冒充成新的闸门。
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

/** 只取基名（单跑批与并行批对账用；两批的清单元素都是 'test/xxx.test.cjs' 形态） */
function basename(rel) { return rel.split(path.sep).pop(); }

/** 后端道的**并行批**＝全部测试文件**减去**单跑批那几个（两批的并集仍等于全集，见 assertGateShape） */
function backendBatch() {
  const 单跑 = new Set(ISOLATED_BACKEND.map((f) => basename(f)));
  const 批 = backendTests().filter((f) => !单跑.has(basename(f)));
  if (!批.length) throw new Error('闸门自检失败：并行批为空 —— 后端道会变成「只跑一个文件」');
  return 批;
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
 * ★2026-09-30 新增：后端道的**单跑批**（串行、独占机器）。
 *
 * 病象（已确诊）：`test/cli.test.cjs` 的用例①在 2026-09-30 一次闸门运行里红过（4903ms），
 *   单独跑该文件 5/5 全绿，闸门把它记成「疑似偶发 · 绿?」（现场单：
 *   `.scratch/gate-flakes/flake-2026-09-30T06-23-39-961Z-backend.log`）。
 *   红的断言是 `cli.test.cjs:69` 的整目录快照比对。
 *
 * 根因（设计层面）：该用例断言的是一条**全局不变式**——「任何 F 档命令都不许写
 *   `p1b/sim/out`」——取证手段是**整目录快照**（`readdir` ＋ 每文件 mtimeMs，
 *   `cli.test.cjs:52`），窗口约 5s（其间起 5 个子进程）。
 *   本仓有 12 个测试文件用同款口径在同一个目录上取快照（`cli.test.cjs:8-10` 自己的注释
 *   就点了名，样板见 `e2-combo-precheck.test.cjs:110`）。而 `node --test` **按 CPU 并行跑文件**
 *   （本机 `os.availableParallelism()` = 28 ⇒ 默认并发 27 个文件）。
 *   ⇒ 只要**任何一轨**在那 5s 窗口内合法地写了一下 `p1b/sim/out`，
 *      别人的快照就对不上——**与 F 档命令是否清白无关**。
 *   不变式是对的，**断言方式在并行语境下天然失效**。
 *
 * 为什么选「单跑批」而不是别的（两条都不许破：判据不弱、测试不被绕过）：
 *   ✗ 放宽判据（只查我关心的几个文件 / 变化了就重试 / 加容忍）：题面第①条明令不许，
 *     且那等于把「任何 F 档命令都不许碰 sim/out」这条全量保证缩成局部保证。
 *   ✗ 在 `cli.test.cjs` 里取一把跨进程锁，让别的测试文件也来加锁：
 *     锁是**双方协议**，只有一方守约等于没有锁；而「谁会写 sim/out」是这份清单里
 *     最脆的一环（写方是脚本的 `--out-dir` 默认值，几十个脚本都有），漏一个就静默失效。
 *     且要在别的文件里插等待逻辑，等于把 12 个文件都改了，风险远大于收益。
 *   ✓ **单跑批**：把这一个文件从并行批里摘出来，**独占**一次 `node --test`
 *     （`--test-concurrency=1`），跑完再跑其余 118 个文件的并行批。
 *     整目录快照、逐位比对、5 条 F 档命令、反向确认产物——**一个字都没改**；
 *     变的只是「跑它的时候旁边没有别人」。其余 118 个文件的并行度完全不变
 *     （实测并行批 100–120s，单跑批约 6s）。
 *
 * 维护约定：往里加文件＝「这个文件断言的是全局不变式（整仓目录/整仓文件的快照比对），
 *   并行跑必假红」。加完在文件头写上标记 `GATE-SERIAL-ALONE`（下面的自检会核对，
 *   对不上当场炸，不会静默退化）。
 */
const ISOLATED_BACKEND = [path.join('test', 'cli.test.cjs')];
const ISOLATED_MARKER = 'GATE-SERIAL-ALONE';

/**
 * ★2026-09-30 新增：偶发红**现场落盘**的机械闸。
 *   判据（阈值、取「两次里较慢的那次」、为什么取 1 秒而不是 0）全在 `flakeGate.cjs` 里，
 *   并由 `p1b/test/gate-flake-guard.test.cjs` 用真值测边界。
 *   ★判据**不住在本文件**：它所在的分支在测试里跑不到（要先让某道闸红、再复跑转绿），
 *     写在原地就等于没有测试 —— 删掉它、把 1 改成 0，绿灯不会有任何反应。
 */
const flakeGate = require(path.join(__dirname, 'flakeGate.cjs'));

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
  // ★2026-09-30 补：单跑批的三条形态锁。目的只有一个 —— **隔离不许静默退化**
  //   （退化＝文件被改名/挪走，于是它悄悄回到并行批，整目录快照又开始假红）。
  //   ① 清单里的每个文件都必须在场（改名当场炸，而不是悄悄失效）；
  //   ② 单跑批与并行批的并集必须恰好等于全集（不许漏跑、不许跑两遍）；
  //   ③ 单跑批里的文件必须自带标记 `GATE-SERIAL-ALONE`（标记与清单两头对账）。
  const 已知 = new Set(files.map((f) => basename(f)));
  for (const f of ISOLATED_BACKEND) {
    if (!已知.has(basename(f))) {
      throw new Error('闸门自检失败：单跑批里的 ' + f + ' 已不在 p1b/test 下 —— ' +
        '它多半被改名或挪走了。请更新 gates.cjs 的 ISOLATED_BACKEND，' +
        '**不要**就这么让它回到并行批（它断言的是全局不变式，并行跑必假红）');
    }
    if (fs.readFileSync(path.join(P1B, f), 'utf8').indexOf(ISOLATED_MARKER) < 0) {
      throw new Error('闸门自检失败：单跑批里的 ' + f + ' 找不到标记 ' + ISOLATED_MARKER +
        ' —— 请在该文件头写上这行标记（两批的归属要有一处人可读的凭据）');
    }
  }
  const 并集 = new Set([...ISOLATED_BACKEND, ...backendBatch()].map((f) => basename(f)));
  if (并集.size !== files.length) {
    throw new Error('闸门自检失败：单跑批 ∪ 并行批 ≠ 后端道全集（' +
      并集.size + ' vs ' + files.length + '）—— 有文件既没进单跑批也没进并行批');
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
      // ★2026-09-30：后端道拆成两「段」——单跑批（串行独占）＋并行批。理由见 ISOLATED_BACKEND。
      //   两段的并集＝全集（assertGateShape 已钉死），任一段红 ⇒ 本道红。
      aloneFiles: ISOLATED_BACKEND,
      aloneArgs: ['--test', '--test-reporter=dot', '--test-concurrency=1', ...ISOLATED_BACKEND],
      batchFiles: backendBatch(),
      args: ['--test', '--test-reporter=dot', ...backendBatch(), ...EXTRA_BACKEND],
      // ★两段各打印**一行**「命令」，格式与其余三道闸逐字同款
      //   （`node …<命令本体>（N 个文件）`，尾部括号注记由 ci-workflow.test.cjs 的 coreOf 剥掉）。
      //   之所以要两行：那份守卫在 vm 沙箱里真跑本文件，把 spawnSync 打桩成恒绿，
      //   然后断言「打印出的命令条数 == spawn 次数」并按序一一对账 cwd。
      //   ⇒ 一段 spawn 就得对应一行命令，否则守卫立刻报红（2026-09-30 实测：改成一整行多行文本
      //   就会因为正则的 `.` 不跨行而整条漏读）。**别把这行合并回去。**
      cmdForDisplay: (seg) => (seg && seg.tag === '单跑批'
        ? `node --test --test-reporter=dot --test-concurrency=1 test/cli.test.cjs（${ISOLATED_BACKEND.length} 个文件，串行独占）`
        : `node --test --test-reporter=dot test/*.test.cjs test/meihua.js  （${backendTests().length + EXTRA_BACKEND.length - ISOLATED_BACKEND.length} 个文件）`),
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
  // ★2026-09-30：`后端道文件（N）：`／`前端道文件（N）：` 这两个表头与它们下面的清单
  //   **是契约**（ci-workflow.test.cjs 的 ⑧ 按表头正则 + 两空格缩进解析，与 yml 的 glob
  //   展开结果逐条对账）。单跑批/并行批的拆分说明另起一块印在最后，不要混进这两张表里。
  const bg = gates.find((g) => g.id === 'backend');
  console.log('后端道文件（%d）：', backendFileCount);
  bg.batchFiles.concat(EXTRA_BACKEND, bg.aloneFiles).forEach((f) => console.log('  ' + f));
  console.log('前端道文件（%d）：', frontendTests().length + 1);
  frontendTests().forEach((f) => console.log('  ' + f));
  console.log('  ' + path.join('web', 'dist.test.mjs'));
  console.log('\n命名不规范提醒：%s —— %s', OUT_OF_SCOPE_HINT.file, OUT_OF_SCOPE_HINT.reason);
  console.log('后端道拆分（串行独占的单跑批 ＋ 并行批；理由见 gates.cjs 的 ISOLATED_BACKEND）：');
  console.log('  单跑批 %d 个：%s', bg.aloneFiles.length, bg.aloneFiles.join(' '));
  console.log('  并行批 %d 个：%s', bg.batchFiles.length + EXTRA_BACKEND.length, '（上表除去单跑批那几个）');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 开跑
// ---------------------------------------------------------------------------

const results = [];
const t0 = Date.now();
let buildFailed = false;
const 崩溃计数 = [];   // 本次运行里被原生崩溃打断过的闸（已知 vite/esbuild 约 8%）

/**
 * ★2026-09-30：一道闸可以是多「段」。目前只有后端道是两段（单跑批 ＋ 并行批）。
 *   **单跑批排第一**：它断言的是工作树里那个生产目录的全局不变式，
 *   取快照的窗口越早、旁边越空，越可靠（spawnSync 会等本段所有子进程退出才返回，
 *   所以「跑完并行批再跑单跑批」也成立，但把最脆的那段放在最前面，
 *   一旦它红就能在两分钟的大批之前先把话说完）。
 */
function segmentsOf(g) {
  const segs = [];
  if (g.aloneArgs) segs.push({ tag: '单跑批', files: g.aloneFiles, args: g.aloneArgs });
  if (g.args) segs.push({ tag: '并行批', files: g.batchFiles, args: g.args });
  return segs;
}

gates.forEach((g, i) => {
  const no = `${i + 1}/${gates.length}`;
  const segs = segmentsOf(g);
  console.log('');
  console.log('='.repeat(72));
  console.log(`[闸门 ${no}] ${g.label}`);
  // ★2026-09-30：cwd / 命令**逐段各打一对**（单段闸＝与 2026-09-29 之前逐字相同）。
  //   原因见 buildGates() 里 cmdForDisplay 上方的注释：ci-workflow.test.cjs 按
  //   「一条 命令 行 ↔ 一次 spawn」对账，多段必须多行、少段必须少行。
  for (const seg of segs) {
    console.log(`  cwd     : ${g.cwd}`);
    console.log(`  命令     : ${g.cmdForDisplay(seg)}`);
  }
  console.log('='.repeat(72));

  const started = Date.now();
  let code = 0;
  let spawnError = null;
  for (const seg of segs) {
    if (segs.length > 1) {
      console.log('');
      console.log(`---- [闸门 ${no}] ${seg.tag}：${seg.files.length} 个文件 ----`);
    }
    const segStart = Date.now();
    let segCode;
    try {
      // stdio: 'inherit' —— 子进程直接接管终端。--test-reporter=dot 是必须的：
      // 默认 TAP 打 900+ 用例会超 256KB 输出上限（实测，见交付报告）。
      // ★2026-09-29 试过改成 pipe 捕获输出、让偶发红有证据留底，**害处大于好处，已回退**：
      //   ① 总用时 13s → 26s（翻倍，而这道门现在每次提交都跑）；
      //   ② 首跑 exit=1 而 stdout/stderr **全空**、复跑却 exit=0 —— 四道门**每次都这样**，
      //      像 pipe 下的执行异常而不是测试失败（同一命令单独跑 exit=0 且有正常输出）。
      //   证据留不住有别的办法：**复跑那次的输出本来就被捕获**，落盘用它即可。
      const r = spawnSync(process.execPath, seg.args, { cwd: g.cwd, stdio: 'inherit', shell: false });
      if (r.error && !spawnError) spawnError = r.error;
      segCode = r.status === null ? 1 : r.status;
    } catch (e) {
      if (!spawnError) spawnError = e;
      segCode = 1;
    }
    if (segs.length > 1) {
      console.log(`\n[闸门 ${no}/${seg.tag}] 退出码 = ${segCode}    用时 = ${((Date.now() - segStart) / 1000).toFixed(2)}s`);
    }
    // 任一段红 ⇒ 本道红；退出码取**最后一个**非零段（两段都红时，复跑提示里能看出是哪个）
    if (segCode !== 0) code = segCode;
  }
  const secs = (Date.now() - started) / 1000;

  if (spawnError) {
    console.log(`\n[闸门 ${no}] 启动失败：${spawnError.message}`);
    console.log('  常见原因：依赖没装（先在 p1b 与 p1b/web 各跑一次 npm install）。');
  }


  // ★2026-09-29：红的闸**当场自动复跑一次**。
  //   起因是观测到一处偶发红：约 14 次运行里红过 2 次（一次 backend、一次 build+frontend），
  //   随后连续 21 次全绿，无法手动复现。**猜原因不如让它自己记录。**
  //   第二次绿 ⇒ 标「疑似偶发」并把两次的退出码与用时都打出来，本次**不算红**（但会留痕）。
  //   第二次还红 ⇒ 是真红，按原样失败。
  //   ★这个判定**故意偏保守**：疑似偶发只是提示，不改变退出码 —— 宁可多红一次，
  //   也不要让一次真回归因为「重跑就过了」被吞掉。
  let flakyNote = "";
  if (code !== 0) {
    const t1 = Date.now();
    // ★2026-09-30：复跑必须**把该道的每一段都重跑一遍**。
    //   早先只有一段（g.args），所以复跑＝重跑全部；拆成两段后若只复跑并行批，
    //   单跑批那一段的红就永远复现不出来 ⇒ 「疑似偶发」的判定会失真。
    let rCode = 0;
    const retryOut = [];
    for (const seg of segs) {
      const retry = spawnSync(process.execPath, seg.args, { cwd: g.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const rc = retry.status === null ? -1 : retry.status;
      if (rc !== 0) rCode = rc;
      retryOut.push('===== 复跑·' + seg.tag + ' =====\n' + (retry.stdout || '') + (retry.stderr || ''));
    }
    const rSecs = (Date.now() - t1) / 1000;
    // ★2026-09-29 抓到 exit 3221225477 = 0xC0000005 = STATUS_ACCESS_VIOLATION
    //   （Windows 访问违例、原生崩溃）之后加的判据：
    //   **「进程崩了」与「测试不稳定」是两回事，不能一起当偶发放过。**
    //   测试抖动 → 复跑绿合理；进程被原生层打死 → 复跑绿只是把环境故障藏起来。
    //   退出码落在「信号/原生崩溃」区间（128+ 或 0xC0000000+）⇒ 不复跑、直接判真红。
    // ★2026-09-29 已复现并定量：vite build 在本机**约 8% 概率原生崩溃**
    //   （12 次连跑崩 1 次，exit 139 / 0xC0000005 = SIGSEGV / ACCESS_VIOLATION）。
    //   与早先观测到的「约 14 跑红 2 次」吻合 ⇒ 那个「偶发」就是它，不是测试抖动。
    //   ⇒ **要复跑**（否则每次提交有 1/12 概率被无理由拦下），但**必须显形**：
    //   标成「原生崩溃」而不是混进普通偶发，且在汇总里单列计数。
    const 是崩溃 = (c) => c >= 3221225472 || (c >= 128 && c < 3221225472) || c < 0;
    const 本次崩溃 = 是崩溃(code);
    if (本次崩溃) {
      崩溃计数.push(no + ':' + code);
      console.log(`[闸门 ${no}] 首跑退出码 ${code} 落在「信号/原生崩溃」区间（本机已知 vite/esbuild 原生崩溃，约 8%）`);
      console.log('         ⇒ 不是测试不稳定。**复跑一次**（否则会无理由拦下约 1/12 的提交），但单独计数、不与普通偶发混同。');
    }
    if (rCode === 0) {
      if (本次崩溃) flakyNote = `  ← ★原生崩溃后复跑转绿（exit=${code}，非测试抖动）`;
      flakyNote = `  ← 疑似偶发：复跑一次已绿（第一次=${code} ${secs.toFixed(2)}s，复跑=0 ${rSecs.toFixed(2)}s）`;
      console.log(`[闸门 ${no}] 复跑一次：退出码 = 0（${rSecs.toFixed(2)}s）—— ${本次崩溃 ? '原生崩溃已绕过' : '判为偶发'}，本次不计入红。`);
      // ★把两次的输出都**落盘**。控制台会滚走 —— 只打终端的话，下一次偶发等于没记录，
      //   这个待查项就永远停在「未复现」。落盘是它能被销账的唯一前提。
      //
      // ★2026-09-30 加一道机械闸：**用时不够格的现场不许进证据目录**（判据见 flakeGate.cjs）。
      //   起因（实测）：`flake-20260930T08-23-28-601Z-backend.log` 记的是
      //   「首跑 exit=1 / 0.00s，复跑 exit=0 / 0.00s」，而同目录另三份真现场是 78s／112s／123s。
      //   后端道**单段**就要 100s+，0.00s 的现场在本机物理上不可能是真的 ——
      //   那份是修闸门时在沙箱里把 spawnSync 打桩的验证产物，误进了证据目录。
      //   ⇒ 谁按「看最新一份」的惯性去读它，会得出「后端道今天又红了」的错误结论。
      const 落盘判定 = flakeGate.decide(secs, rSecs);
      if (!落盘判定.record) {
        console.log('         ★拒落盘：两次里较慢的一次只有 ' + 落盘判定.slowest.toFixed(2) + 's < ' + 落盘判定.min
          + 's —— 这不是一次真跑（' + g.id + ' 单段就要 100s+），写进证据目录只会误导下一个按'
          + '「看最新一份」去读的人。打桩产物请写到别处。');
      } else {
        try {
          const dir = path.join(REPO, '.scratch', 'gate-flakes');
          fs.mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const f = path.join(dir, `flake-${stamp}-${g.id}.log`);
          fs.writeFileSync(f,
            '# 闸门偶发红 · 现场记录\n' +
            `# gate=${g.id}\n# 第一次 exit=${code}（${secs.toFixed(2)}s）  复跑 exit=0（${rSecs.toFixed(2)}s）\n` +
            `# node ${process.version} / ${process.platform} / ${new Date().toString()}\n` +
            `# 复现：node p1b/gates/gates.cjs 连跑，看是否再触发\n\n` +
            '===== 首跑输出未捕获 =====\n' +
            '（首跑用 stdio:inherit，输出直接进终端。试过改 pipe 捕获：总用时翻倍、且首跑 exit=1 而输出全空，已回退 —— 见上方注释）\n\n' +
            '===== ★首跑输出：未捕获（这是本文件最大的缺陷，2026-09-30 才发现） =====\n' +
            '  本文件下面记的是**复跑**的输出（复跑已通过），而**首跑那段失败输出从未被捕获**——\n' +
            '  首跑用 stdio:inherit，输出直接进终端，进不了这里。\n' +
            '  ⇒ 光看这份文件**看不出当时是哪条测试红的**。\n' +
            '  不用 pipe 捕获的原因（试过）：总用时翻倍、且首跑 exit=1 而输出全空，已回退。\n' +
            '  ⇒ 复现：cd p1b && for i in 1 2 3; do node --test --test-reporter=tap test/*.test.cjs; done\n' +
            '  ★别把「复跑绿了」当结论：2026-09-30 那条记录正是连跑两次全绿、根因至今未定位。\n\n' +
            '===== 复跑的输出（复跑已通过，这里全绿，看不出首跑红在哪） =====\n' + retryOut.join('\n') + '\n',
            'utf8');
          console.log('         已落盘：' + path.relative(REPO, f));
        } catch (e) {
          console.log('         （落盘失败：' + e.message + '）');
        }
      }
      code = 0;
    } else {
      flakyNote = `  ← 复跑仍红（第一次=${code}，复跑=${rCode}）—— 是真红`;
      console.log(`[闸门 ${no}] 复跑一次：退出码 = ${rCode}（${rSecs.toFixed(2)}s）—— 仍红，是真红。`);
    }
  }

  console.log(`\n[闸门 ${no}] 退出码 = ${code}    用时 = ${secs.toFixed(2)}s${flakyNote}`);
  if (g.producesDist && code !== 0) buildFailed = true;   // ★放在复跑之后：复跑转绿就不算红，否则会误报「前端跑在陈旧 dist 上」
  results.push({ id: g.id, label: g.label, code, secs, flaky: code === 0 && flakyNote !== "" });
});

const total = (Date.now() - t0) / 1000;
const failed = results.filter((r) => r.code !== 0);

console.log('');
console.log('='.repeat(72));
console.log('四道闸门汇总');
console.log('='.repeat(72));
for (const r of results) {
  const 标 = r.code === 0 ? (r.flaky ? '绿?' : '绿') : '红';
  console.log(`  ${标}  ${r.id.padEnd(9)} 退出码=${String(r.code).padEnd(3)} 用时=${r.secs.toFixed(2)}s${r.flaky ? '  ← 复跑才绿，见上文' : ''}`);
}
console.log('-'.repeat(72));
console.log(`  总用时 = ${total.toFixed(2)}s`);

// 构建红时，前端道测的是【上一次的旧 dist】，必须说破，否则会被读成「前端也验证过产物」。
if (buildFailed) {
  console.log('  ⚠ 构建道红 → 前端道跑在【陈旧 dist】上，dist.test.mjs 的结果本次不作数。');
}
if (崩溃计数.length) {
  console.log(`  本次有 ${崩溃计数.length} 道闸被**原生崩溃**打断、复跑才转绿：${崩溃计数.join("、")}`);
  console.log('    => 它们**不是**测试失败。已知 vite/esbuild 在本机约 8% 概率 SIGSEGV（实测 12 跑崩 1）。');
  console.log('       连续多次出现请查 esbuild 原生二进制 / 杀软，**不要**回头翻测试。');
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
