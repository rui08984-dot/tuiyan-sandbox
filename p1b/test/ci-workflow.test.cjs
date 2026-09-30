'use strict';
/**
 * p1b/test/ci-workflow.test.cjs —— ci.yml 与四道闸门**同源**守卫（spec 模块 1 · ci）
 *
 * 要防的那件事（spec「测试与验收」第 1 条）：yml 里另写一套测试命令
 * ⇒ 两边悄悄漂移 ⇒ CI 绿了、本地红了，谁都说不清。
 * 所以本件**不重述**四道闸门是什么，而是把 `p1b/gates/gates.cjs` 当唯一事实源读出来，
 * 再断言 `.github/workflows/ci.yml` 里逐条逐字命中（含执行目录与执行先后）。
 *
 * 事实源怎么读（不许用固定字符窗口截源码 —— 那是量魔数不是量行为）：
 *   在 node:vm 沙箱里**真跑一遍** gates.cjs，把 child_process.spawnSync 打桩成恒绿，
 *   于是它会照常打印四道闸的「命令 / cwd」并自行 exit。命令从它自己的输出里取。
 *   ★另有**独立第二来源**：打桩记下的 4 次 spawn 调用。两条来源的条数与 cwd 必须对得上 ——
 *     将来 gates.cjs 改了打印格式，条数对不上会当场红，而不是静默读到 0 条命令（空跑绿灯）。
 *   跑的是沙箱里的 gates.cjs，**不是**四道闸本身：spawnSync 被打桩，一个用例都没执行。
 *
 * 反向锁（spec 第 3 条，本模块唯一要紧的测试）：从 yml 删掉任意一条命令 ⇒ 守卫必须红。
 *   ④在内存里删（证明判定逻辑会红）⑤把删过的 yml 写到临时目录、校验器从**盘上**读
 *   （证明它读的是真文件，而不是某个缓存字符串）。
 *
 * 覆盖不许缩水（顺带锁住一条真会发生的假绿）：前端道的文件参数是 glob，
 *   bash 不开 globstar 时 `**` 退化成 `*`，web/src/ 顶层的用例会被静默漏掉。
 *   ⇒ ⑧ 把 yml 的 glob 展开结果与 `gates.cjs --list` 的枚举清单逐条对比，
 *   并配一条**负对照**（不开 globstar 展开 ⇒ 必须不相等），否则 ⑧ 就是恒真断言。
 *
 * 零新依赖、零外网；不改 gates.cjs 一个字，不放宽任何判据。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const GATES = path.join(ROOT, 'p1b', 'gates', 'gates.cjs');
const GATES_DIR = path.dirname(GATES);

// ===========================================================================
// 一、事实源：把 gates.cjs 在沙箱里真跑一遍，取它自己打印的四条命令
// ===========================================================================

/** 去掉 gates.cjs 打印时挂在命令尾部的括号注记（形如「（5 个文件）」），只留命令本体 */
function coreOf(display) {
  const m = display.match(/^(.*?)（[^（）]*）\s*$/);
  return (m ? m[1] : display).trim();
}

/**
 * @returns {{index,display,command,relCwd,absCwd,spawnArgs}[]}  按 gates.cjs 的执行顺序
 */
function readGates() {
  const src = fs.readFileSync(GATES, 'utf8');
  const printed = [];
  const spawned = [];
  let exitCode = null;

  const sandbox = {
    require(id) {
      if (id === 'child_process') {
        return {
          spawnSync(exe, args, opts) {
            spawned.push({ exe, args: Array.from(args), cwd: (opts || {}).cwd });
            return { status: 0 }; // 恒绿：这里只借它的命令表，不执行任何用例
          },
        };
      }
      return require(id);
    },
    console: { log: (...a) => printed.push(a.join(' ')), error: () => {}, warn: () => {} },
    __dirname: GATES_DIR,
    __filename: GATES,
    process: {
      execPath: process.execPath,
      argv: ['node', GATES],
      version: process.version,
      platform: process.platform,
      exit(code) { exitCode = code; throw new Error('__gates_exit__'); },
    },
  };
  vm.createContext(sandbox);

  let thrown = null;
  try {
    vm.runInContext(src, sandbox, { filename: GATES, timeout: 60000 });
  } catch (e) {
    thrown = e;
  }
  assert.ok(
    thrown && /__gates_exit__/.test(thrown.message),
    '沙箱里 gates.cjs 应一路跑到 process.exit 为止；实际抛出：' + (thrown && thrown.message),
  );
  assert.strictEqual(exitCode, 0, 'spawnSync 打桩后四道闸应全绿退出 0，实际 exit=' + exitCode);

  // 第一来源：它打印的「cwd / 命令」
  const gates = [];
  let cwd = null;
  for (const line of printed) {
    const c = line.match(/^[ \t]*cwd[ \t]*:[ \t]*(\S.*)$/);
    if (c) { cwd = c[1].trim(); continue; }
    const d = line.match(/^[ \t]*命令[ \t]*:[ \t]*(\S.*)$/);
    if (d) { gates.push({ display: d[1].trim(), cwd }); cwd = null; }
  }

  // 第二来源：spawn 打桩记下的实际调用
  assert.strictEqual(
    gates.length, spawned.length,
    '打印出的命令条数(' + gates.length + ') 与 spawn 次数(' + spawned.length + ') 不一致 —— gates.cjs 改了打印格式？',
  );

  return gates.map((g, i) => {
    const absCwd = path.resolve(g.cwd);
    const rel = path.relative(ROOT, absCwd).split(path.sep).join('/');
    assert.strictEqual(
      absCwd, path.resolve(spawned[i].cwd),
      '第 ' + (i + 1) + ' 道闸打印的 cwd 与实际 spawn 的 cwd 不一致',
    );
    return {
      index: i,
      display: g.display,
      command: coreOf(g.display),
      relCwd: rel === '' ? '.' : rel,
      absCwd,
      spawnArgs: spawned[i].args,
    };
  });
}

/** 跑 `gates.cjs --list`（只枚举不执行），取出它权威枚举的全部用例文件（相对 p1b） */
function gateFileList() {
  const r = spawnSync(process.execPath, [GATES, '--list'], { encoding: 'utf8', cwd: ROOT, timeout: 60000 });
  assert.strictEqual(r.status, 0, 'gates.cjs --list 应 exit 0，实际 ' + r.status + '：' + r.stderr);
  const files = [];
  const headerCount = [];
  let section = null;
  for (const raw of r.stdout.split('\n')) {
    const head = raw.match(/^(后端道|前端道)文件（(\d+)）：\s*$/);
    if (head) { section = head[1]; headerCount.push(Number(head[2])); continue; }
    if (raw.trim() === '') { section = null; continue; } // 段尾（后面是「命名不规范提醒」）
    const item = raw.match(/^ {2}(\S.*)$/);
    if (section && item) files.push(item[1].split(path.sep).join('/'));
  }
  const total = headerCount.reduce((a, b) => a + b, 0);
  assert.strictEqual(
    files.length, total,
    '--list 头部声明 ' + total + ' 个文件，实际解析出 ' + files.length + ' 个 —— 解析器或输出格式变了',
  );
  return files;
}

// ===========================================================================
// 二、yml 解析：缩进驱动，只认本仓 ci.yml 实际用到的子集，认不出就抛
// ===========================================================================

function unquote(v) {
  const s = String(v).trim();
  if (s.length >= 2 && ((s[0] === "'" && s.endsWith("'")) || (s[0] === '"' && s.endsWith('"')))) {
    return s.slice(1, -1);
  }
  // YAML 语义：未加引号的标量里，「 #」之后是注释
  const h = s.search(/\s#/);
  return (h >= 0 ? s.slice(0, h) : s).trim();
}

function indentOf(line) {
  return /^[ \t]*/.exec(line)[0].length;
}

/**
 * 取出一个 job 的 steps 列表。
 * @returns {{line:number, keys:Record<string,string>}[]}
 */
function parseSteps(text) {
  const lines = text.split('\n');
  let start = -1, base = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([ \t]*)steps:[ \t]*$/);
    if (m) { start = i; base = m[1].length; break; }
  }
  if (start < 0) throw new Error('yml 里找不到 steps: 段');
  if (/\t/.test(lines.slice(start).join('\n'))) throw new Error('steps 段里出现 tab 缩进（YAML 不允许）');

  const steps = [];
  let cur = null;
  const flush = () => { if (cur) { steps.push(cur); cur = null; } };

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^[ \t]*#/.test(raw)) continue;
    const ind = indentOf(raw);
    if (ind <= base) break; // 出了 steps 段

    const dash = raw.match(/^([ \t]*)-\s+(.*)$/);
    if (dash && dash[1].length === base + 2) {
      flush();
      cur = { line: i + 1, keys: {} };
      const kv = dash[2].match(/^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/);
      if (kv) cur.keys[kv[1]] = unquote(kv[2] === undefined ? '' : kv[2]);
      continue;
    }
    if (!cur) continue;
    if (ind <= base + 2) break; // 出了 step 体（同级非列表项）
    const kv = raw.match(/^[ \t]*([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/);
    if (!kv) continue;
    if (kv[2] === undefined || kv[2].trim() === '') {
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l2 = lines[j];
        if (!l2.trim()) { block.push(''); continue; }
        const i2 = indentOf(l2);
        if (i2 <= ind) break;
        block.push(l2.slice(ind + 2));
      }
      cur.keys[kv[1]] = block.join('\n');
      i = j - 1;
    } else {
      cur.keys[kv[1]] = unquote(kv[2]);
    }
  }
  flush();
  return steps;
}

// ===========================================================================
// 三、校验器：yml 文本 + 闸门清单 → 问题清单（空 = 绿）
// ===========================================================================

function checkWorkflow(text, gates) {
  const problems = [];
  let steps;
  try {
    steps = parseSteps(text);
  } catch (e) {
    return ['ci.yml 解析失败：' + e.message];
  }
  const runs = steps.filter((s) => typeof s.keys.run === 'string' && s.keys.run !== '').map((s) => s.keys.run);

  // ① 四条命令逐条逐字命中，且各出现一次
  gates.forEach((g) => {
    const n = runs.filter((r) => r === g.command).length;
    if (n === 0) problems.push('第 ' + (g.index + 1) + ' 道闸门的命令不在 yml 的任何 run 里：' + g.command);
    else if (n > 1) problems.push('第 ' + (g.index + 1) + ' 道闸门的命令在 yml 里出现 ' + n + ' 次：' + g.command);
  });

  // ② 先后顺序与 gates.cjs 一致（构建必须在前端前面，否则 dist 不存在时前端道必假红）
  const at = gates.map((g) => runs.indexOf(g.command));
  if (!at.every((v, i) => i === 0 || v > at[i - 1])) {
    problems.push('闸门在 yml 里的先后与 gates.cjs 不一致（下标 ' + JSON.stringify(at) + '，-1 表示该命令没找到）');
  }

  // ③ 每个闸的 working-directory 必须等于 gates.cjs 里那道闸的 cwd
  gates.forEach((g) => {
    const st = steps.find((s) => s.keys.run === g.command);
    if (!st) return;
    const wd = String(st.keys['working-directory'] || '.').trim() || '.';
    if (wd !== g.relCwd) {
      problems.push('第 ' + (g.index + 1) + ' 道闸门的 working-directory=' + wd + '，与 gates.cjs 的 cwd（' + g.relCwd + '）不一致');
    }
  });

  // ④ 零新依赖：只许 actions/checkout 与 actions/setup-node
  steps.filter((s) => s.keys.uses).forEach((s) => {
    const u = String(s.keys.uses).trim();
    if (!/^actions\/(checkout|setup-node)@v\d+$/.test(u)) {
      problems.push('引入了 spec 未授权的 action（只许 actions/checkout 与 actions/setup-node）：' + u);
    }
  });

  // ⑤ 不许掩盖失败、不许放宽判据
  if (/continue-on-error/.test(text)) problems.push('yml 里有 continue-on-error —— spec Boundaries：不许用它掩盖失败');
  if (/\|\|\s*(true|exit\s+0)\b/.test(text)) problems.push('yml 里有 `|| true` / `|| exit 0` —— 不许放宽判据');
  if (/;\s*exit\s+0\b/.test(text)) problems.push('yml 里有 `; exit 0` —— 不许放宽判据');
  if (/--passWithNoTests/.test(text)) problems.push('yml 里有 --passWithNoTests —— 不许放宽判据');

  return problems;
}

function checkWorkflowFile(p, gates) {
  return checkWorkflow(fs.readFileSync(p, 'utf8'), gates);
}

// ===========================================================================
// 四、glob 展开：`**` ＝ 零或多级目录（＝ bash -O globstar 的语义）
// ===========================================================================

function listDir(abs) {
  try { return fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; }
}

/** 段内通配：`*.test.cjs` 之类。切分后再转义，避免把 `*` 自己也转义掉。 */
function segMatcher(seg) {
  const re = new RegExp('^' + seg.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return (name) => re.test(name);
}

/** @param {boolean} globstar false 时 `**` 退化成 `*`（bash 默认），用于负对照 */
function globFiles(relPattern, cwd, globstar) {
  const segs = relPattern.split('/');
  let acc = [''];
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const last = si === segs.length - 1;
    const next = [];
    for (const pre of acc) {
      const abs = path.resolve(cwd, pre);
      if (seg === '**' && globstar) {
        next.push(pre); // 零级
        const queue = [pre];
        while (queue.length) {
          const cur = queue.shift();
          for (const e of listDir(path.resolve(cwd, cur))) {
            if (!e.isDirectory()) continue;
            const np = cur ? cur + '/' + e.name : e.name;
            next.push(np);
            queue.push(np);
          }
        }
        continue;
      }
      // 非 `**` 段：本层匹配即可（`**` 退化成 `*` 也走这里）。
      // 中间段允许命中目录（`test`、`web/src` 就是目录），末段只要文件 —— 与 shell glob 同。
      const hit = segMatcher(seg);
      for (const e of listDir(abs)) {
        if (last && e.isDirectory()) continue;
        if (!hit(e.name)) continue;
        next.push(pre ? pre + '/' + e.name : e.name);
      }
    }
    acc = next;
  }
  return Array.from(new Set(acc));
}

/** 把一条命令里的文件类参数展开成相对该闸 cwd 的文件清单 */
function fileArgsOf(command, absCwd, globstar) {
  const toks = command.split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of toks.slice(1)) { // toks[0] 是 node
    if (t.startsWith('-')) continue;
    if (t.includes('*')) {
      out.push(...globFiles(t, absCwd, globstar));
    } else {
      const abs = path.resolve(absCwd, t);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) out.push(path.relative(absCwd, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

function unionOfTestGates(gates, globstar) {
  const set = new Set();
  for (const g of gates.filter((x) => x.command.includes(' --test '))) {
    for (const f of fileArgsOf(g.command, g.absCwd, globstar)) set.add(f);
  }
  return Array.from(set).sort();
}

// ===========================================================================
// 五、测试
// ===========================================================================

test('① 前置：ci.yml 存在、UTF-8 无 BOM、纯 LF、无 tab，且**能解析出 steps**（防空跑绿灯）', () => {
  assert.ok(fs.existsSync(WORKFLOW), '工作流应存在：' + WORKFLOW);
  const buf = fs.readFileSync(WORKFLOW);
  assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), '不得带 UTF-8 BOM');
  const text = buf.toString('utf8');
  assert.ok(text.length > 0, 'ci.yml 不得为空');
  assert.ok(!/\r/.test(text), '必须是纯 LF（CRLF 会让 git diff --check 逐行报 trailing whitespace）');
  assert.ok(!text.includes('\t'), '不得用 tab 缩进');
  for (const k of ['name:', 'on:', 'jobs:']) {
    assert.ok(new RegExp('^' + k, 'm').test(text), 'yml 顶层（第 0 列）应有 ' + k);
  }
  assert.ok(/^[ \t]+steps:[ \t]*$/m.test(text), 'yml 里应有 steps: 段');
  const steps = parseSteps(text);
  assert.ok(steps.length >= 4, 'steps 至少 4 条，实际 ' + steps.length);
  assert.ok(steps.every((s) => s.keys.name || s.keys.uses), '每个 step 都该有 name 或 uses（否则解析器可能没真在读 step）');
  assert.ok(steps.filter((s) => s.keys.run).length >= 4, '至少 4 个 step 带 run，实际 ' + steps.filter((s) => s.keys.run).length);
});

test('② 前置：能从 gates.cjs 取到**非空且互不相同**的闸门命令（否则 ③④ 都在空跑）', () => {
  const gates = readGates();
  assert.ok(gates.length >= 4, 'gates.cjs 至少应有 4 道闸，实际 ' + gates.length);
  assert.ok(gates.every((g) => g.command.length > 0), '每条命令都必须非空');
  assert.strictEqual(
    new Set(gates.map((g) => g.command)).size, gates.length,
    '四道闸的命令必须互不相同：' + JSON.stringify(gates.map((g) => g.command)),
  );
  assert.ok(
    gates.filter((g) => g.display !== g.command).length >= 1,
    '至少一条命令带括号注记（证明 coreOf 的剥括号规则真的生效，而不是恒等返回）',
  );
  assert.strictEqual(
    gates.filter((g) => g.command.includes(' --test ')).length, 2,
    '应恰有两道闸在跑用例（后端道 + 前端道）',
  );
});

test('③ 四道闸门命令在 ci.yml 里逐条逐字命中，且执行目录与先后顺序都与 gates.cjs 一致', () => {
  const gates = readGates();
  const problems = checkWorkflowFile(WORKFLOW, gates);
  assert.deepStrictEqual(problems, [], 'ci.yml 与 gates.cjs 漂移了：\n  - ' + problems.join('\n  - '));
  // 逐条点名，便于失败时直接看出是哪一道闸
  const steps = parseSteps(fs.readFileSync(WORKFLOW, 'utf8'));
  for (const g of gates) {
    const st = steps.find((s) => s.keys.run === g.command);
    assert.ok(st, '第 ' + (g.index + 1) + ' 道闸门的命令应有对应 step：' + g.command);
    assert.strictEqual(
      String(st.keys['working-directory'] || '.').trim() || '.', g.relCwd,
      '第 ' + (g.index + 1) + ' 道闸门的工作目录应与 gates.cjs 的 cwd 一致',
    );
  }
});

test('④ ★反向锁：在 yml 里逐条删掉四个 run 行 ⇒ 校验器必须报红（本模块唯一要紧的测试）', () => {
  const gates = readGates();
  const orig = fs.readFileSync(WORKFLOW, 'utf8');
  assert.deepStrictEqual(checkWorkflow(orig, gates), [], '对照组：未改动的 ci.yml 必须先绿，否则下面的红没有意义');

  let removedTotal = 0;
  for (const g of gates) {
    const target = 'run: ' + g.command;
    const lines = orig.split('\n');
    const hits = lines.filter((l) => l.trim() === target);
    assert.strictEqual(hits.length, 1, 'ci.yml 里应恰有一行 ' + target + '，实际 ' + hits.length + ' 行');
    const mutated = lines.filter((l) => l.trim() !== target).join('\n');
    removedTotal += 1;
    assert.notStrictEqual(mutated, orig, '删掉第 ' + (g.index + 1) + ' 道闸门的行后内容必须真的变了（否则变异是空操作）');
    const problems = checkWorkflow(mutated, gates);
    assert.ok(problems.length > 0, '删掉第 ' + (g.index + 1) + ' 道闸门的命令后，守卫必须红，实际绿了');
    assert.ok(
      problems.some((p) => p.includes(g.command)),
      '报红原因应点名被删掉的那条命令，实际：' + JSON.stringify(problems),
    );
  }
  assert.strictEqual(removedTotal, gates.length, '四道闸都要各删一遍');
});

test('⑤ ★反向锁·走真文件：把删过一条的 ci.yml 写到临时目录、校验器从盘上读 ⇒ 仍红', () => {
  const gates = readGates();
  const orig = fs.readFileSync(WORKFLOW, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-ciwf-'));
  try {
    for (const g of gates) {
      const target = 'run: ' + g.command;
      const lines = orig.split('\n');
      assert.strictEqual(lines.filter((l) => l.trim() === target).length, 1, '应恰有一行 ' + target);
      const mutated = lines.filter((l) => l.trim() !== target).join('\n');
      const p = path.join(tmpDir, 'ci-删掉第' + (g.index + 1) + '道.yml');
      fs.writeFileSync(p, mutated, 'utf8');
      // 确认真文件确实少了一行（防空跑绿灯：写失败/写错文件都不会被发现）
      const onDisk = fs.readFileSync(p, 'utf8');
      assert.ok(!onDisk.includes(g.command), '临时文件里不该再有第 ' + (g.index + 1) + ' 道闸门的命令');
      const problems = checkWorkflowFile(p, gates);
      assert.ok(problems.length > 0, '从盘上读删过的 yml，守卫必须红，实际绿了');
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
});

test('⑥ 零新依赖：yml 只许引用 actions/checkout 与 actions/setup-node（且都被真正用上）', () => {
  const gates = readGates();
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  const steps = parseSteps(text);
  const uses = steps.filter((s) => s.keys.uses).map((s) => String(s.keys.uses).trim());
  assert.ok(uses.length >= 2, '至少应检出与装 node 两步，实际 ' + uses.length);
  for (const want of ['actions/checkout@v4', 'actions/setup-node@v4']) {
    assert.ok(uses.includes(want), 'yml 应真的用到 ' + want + '，实际用到：' + JSON.stringify(uses));
  }
  assert.deepStrictEqual(checkWorkflow(text, gates), [], '现状必须绿');

  // 负对照：在检出之后塞一个未授权 action，校验器必须点名报红（否则本测试是恒真）
  const injected = text.replace(
    /^([ \t]*- name: 检出\n[ \t]*uses: actions\/checkout@v4\n)/m,
    '$1      - name: 偷加的一步\n        uses: third-party/thing@v1\n',
  );
  assert.notStrictEqual(injected, text, '注入未授权 action 后文本必须真的变了');
  assert.ok(injected.includes('third-party/thing@v1'), '注入的内容应确实在文本里（防空跑绿灯）');
  const problems = checkWorkflow(injected, gates);
  assert.ok(
    problems.some((p) => p.includes('third-party/thing@v1')),
    '引入未授权 action 必须报红，实际：' + JSON.stringify(problems),
  );
});

test('⑦ 不许掩盖失败 / 不许放宽判据：注入三种典型掩盖写法都必须报红（负对照）', () => {
  const gates = readGates();
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  assert.deepStrictEqual(checkWorkflow(text, gates), [], '现状必须绿');
  const 后端道 = 'run: node --test --test-reporter=dot test/*.test.cjs test/meihua.js';
  assert.ok(text.includes(后端道), 'yml 里应找得到后端道那一行（注入点定位）');
  const 注入 = [
    ['continue-on-error: true', 'continue-on-error', (t) => t.replace(后端道, 后端道 + '\n        continue-on-error: true')],
    ['|| true', '|| true', (t) => t.replace(后端道, 后端道 + ' || true')],
    ['; exit 0', '; exit 0', (t) => t.replace(后端道, 后端道 + ' ; exit 0')],
  ];
  for (const [名, 词, fn] of 注入) {
    const mutated = fn(text);
    assert.notStrictEqual(mutated, text, '注入「' + 名 + '」后文本必须真的变了（否则变异是空操作）');
    assert.ok(mutated.includes(名), '注入的「' + 名 + '」应确实在文本里（防空跑绿灯）');
    const problems = checkWorkflow(mutated, gates);
    assert.ok(
      problems.some((p) => p.includes(词)),
      '注入「' + 名 + '」必须被点名报红，实际：' + JSON.stringify(problems),
    );
  }
});

test('⑧ 覆盖不许缩水：yml 里的 glob 展开后必须与 gates.cjs --list 的枚举清单完全相等', () => {
  const list = gateFileList();
  assert.ok(list.length > 100, '--list 应枚举出大量用例文件，实际 ' + list.length + ' 个');
  for (const sentinel of ['test/meihua.js', 'web/dist.test.mjs']) {
    assert.ok(list.includes(sentinel), '枚举清单应含哨兵文件 ' + sentinel);
  }
  const gates = readGates();
  const actual = unionOfTestGates(gates, true);
  const expected = list.slice().sort();
  assert.strictEqual(actual.length, expected.length, 'yml glob 展开出 ' + actual.length + ' 个文件，gates.cjs 枚举 ' + expected.length + ' 个');
  assert.deepStrictEqual(
    actual, expected,
    'yml 的 glob 展开结果与 gates.cjs 枚举的用例文件不一致（漏跑或多了都会让 CI 的绿是假的）',
  );

  // 负对照：不开 globstar（bash 默认）时必须对不上，否则上面那条是恒真断言
  const naive = unionOfTestGates(gates, false);
  assert.notDeepStrictEqual(naive, list.slice().sort(), '负对照失灵：不开 globstar 也覆盖全部 ⇒ ⑧ 是恒真断言');
  assert.ok(naive.length < list.length, '不开 globstar 时应漏掉一部分文件（实测 web/src/ 顶层用例会被漏掉）');

  // 且 yml 必须把 globstar 钉在 shell 上，否则 ubuntu 的 bash 会按负对照那套跑
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  assert.ok(
    /^[ \t]*shell:[^\n]*globstar/m.test(text),
    'yml 的 shell 必须开 globstar（前端道参数是 web/src/**/*.test.mjs，不开就会静默漏掉顶层用例）',
  );
});
