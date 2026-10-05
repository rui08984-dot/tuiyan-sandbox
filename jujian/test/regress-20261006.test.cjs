'use strict';
/**
 * 局鉴 · test/regress-20261006.test.cjs —— ★两个 P1 的回归钉子
 *
 * 这两条都不是"功能没做"，而是**已经能用坏的方式**：
 *   · 一台没配 key 的机器上，`jujian <局号> say` 必崩，且打印的提示与实际行为相反；
 *   · Node 22.5–22.12 / 23.0–23.3 上，体检报绿而每个命令都崩。
 * 两条都符合本项目最怕的那类：**看起来跑起来了**。所以各钉一条行为级用例。
 *
 * ══ 为什么不是"改了就算了" ═══════════════════════════════════════════════
 *   say 这个坑的形态是「提示条件」与「传给引擎的实参」各自看都合理、合起来矛盾：
 *     · 提示：`if (!mock && !key) print("走 MOCK")`
 *     · 实参：`{ mockMode: mock && !key }`
 *   无 key 时 ⇒ 提示说 MOCK，实参算出 false ⇒ 引擎把 false 读成**强制 LIVE** ⇒ 三次重试全败。
 *   下次有人来"简化"这两个表达式，很容易再写出一次同款错配。用例不看表达式，只看**行为**：
 *   无 key ⇒ 必须成功 + 必须自报 MOCK。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'jujian.cjs');

/** 一个绝对干净的环境：**三个 key 变量与 MOCK 开关全部摘掉**。 */
function bareEnv() {
  const env = Object.assign({}, process.env);
  for (const k of ['JUJIAN_LLM_API_KEY', 'LLM_API_KEY', 'DEEPSEEK_API_KEY', 'JUJIAN_LLM_MOCK',
    'JUJIAN_DB', 'NODE_TEST_CONTEXT', 'NODE_OPTIONS']) delete env[k];
  return env;
}

test('★回归 · 没配任何 LLM key 时，`say` 必须成功且自报 MOCK（曾经必崩，提示还反着说）', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jujian-say-'));
  const db = path.join(tmp, 'say.db');
  t.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ } });

  const env = bareEnv();
  const newR = spawnSync(process.execPath, [BIN, 'new', '无钥局', '--players=8', '--json', '--db=' + db],
    { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(newR.status, 0, '建局就失败了：' + (newR.stderr || ''));
  const gid = JSON.parse(newR.stdout).局号;

  const r = spawnSync(process.execPath,
    [BIN, String(gid), 'say', '3', '我是预言家，昨晚验的4号是狼', '--day=1', '--json', '--db=' + db],
    { encoding: 'utf8', env, timeout: 60000 });

  // ★这条是核心：没有 key 是**正常场景**（README 承诺「不配 key 也功能全可用」），不是错误路径。
  assert.equal(r.status, 0,
    '★无 key 时 say 必须成功（走 MOCK）。实际退出码 ' + r.status + '\n' + (r.stderr || ''));
  const j = JSON.parse(r.stdout);
  assert.equal(j.模式, 'MOCK', '★没配 key 时必须如实自报 MOCK，不许冒充真实模型');
  // 提示语与实际行为必须一致 —— 上一版的病根正是「提示说 MOCK、引擎走 LIVE」。
  assert.match(r.stderr || '', /MOCK 模式/, 'stderr 的提示应说明走 MOCK');
  assert.doesNotMatch(r.stderr || '', /LIVE_MODE 需要/,
    '★不许出现「LIVE_MODE 需要 key」这类重试失败 —— 那说明无 key 时又被强制 LIVE 了');
});

test('★回归 · doctor 不许把「装了会崩」的 Node 版本报成绿灯', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'scripts', 'doctor.cjs'), 'utf8');
  // 判据必须覆盖两段实测区间（22.13+ 与 23.4+），而不是一条 ">22 或 (22,x>=5)" 的直线。
  assert.match(doc, /22/, 'doctor 必须检查 22 线');
  assert.match(doc, /23/, '★doctor 必须也判 23 线 —— 实测 23.0–23.3 的 node:sqlite 仍在标志后面，'
    + '只写 22 线的版本判定会把这一串用户放进门里然后崩');
  assert.match(doc, /experimental-sqlite/,
    'doctor 的提示必须给出「加 --experimental-sqlite」这条可照抄的出路');
  // 提示要能直接照抄：必须同时说清「为什么」与「合法值」
  assert.match(doc, /为什么|因为|实测/,
    '★报错必须带「为什么」——只说「版本不对」用户无法判断该升级还是该加标志');
});

test('★回归 · 真跑一次 doctor，本机必须过（免得守卫自己把正常环境判红）', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'doctor.cjs')],
    { encoding: 'utf8', env: bareEnv(), timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, 'doctor 在本机报红了：\n' + out);
  assert.match(out, /Node 版本/, '体检必须报 Node 版本这一项');
  assert.doesNotMatch(out, /No such built-in module/,
    '★体检里出现 "No such built-in module" = 它自己都没跑起来，那这条体检没有意义');
});
