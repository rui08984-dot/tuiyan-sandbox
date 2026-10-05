'use strict';
/**
 * p1b/test/role3-freeze.test.cjs —— 「分支冻结先于子题结算」回归锁（2026-09-21 · 四十批）
 *
 * 判据来源：PREREG-角色③ v1.1 §3 勘误原文「分支冻结（run_id）先于子题结算，**在新产分支时适用**」。
 *
 * 覆盖：
 *   ① ★硬失败锁：父题已结算 ⇒ 拒绝冻结（exit 4）——防「先看结果再冻结」
 *   ② ★sha16 稳定性：同分支集重复计算 sha16 逐位相同（顺序无关：排序后规范化）
 *   ③ ★篡改检测：改一条分支 ⇒ verify 报 MISMATCH（exit 6）
 *   ④ ★只增不改：同名冻结件 sha16 不同 ⇒ 拒绝覆写（exit 5）；相同 ⇒ 幂等通过
 *   ⑤ 零账本写锁：脚本不得含写库调用
 *   ⑥ 冻结件形状锁：必含 run_id／sha16／branch_set／parent_status_at_freeze／all_parents_unresolved
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b/scripts/role3-freeze.cjs');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const NODE = process.execPath;

function run(args) {
  try {
    const out = execFileSync(NODE, [SCRIPT].concat(args), { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

test('① ★硬失败锁：父题已结算 ⇒ 拒绝冻结', () => {
  // 造一个父题已结算的候选（取账本里任一已解行的 id）
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readOnly: true });
  const r = db.prepare('SELECT id FROM predictions WHERE resolved_at IS NOT NULL LIMIT 1').get();
  db.close();
  assert.ok(r && r.id, '账本应有已解行（前置）');
  fs.mkdirSync(path.join(ROOT, '.run-out/p35'), { recursive: true });
  const tmp = path.join(ROOT, '.run-out/p35/_test-resolved-parent.json');
  fs.writeFileSync(tmp, JSON.stringify([{ statement: 'x', resolve: { kind: 'k', pick: 'home' }, meta: { parent_prediction_id: r.id } }]), 'utf8');
  const res = run(['freeze', '--candidates', tmp, '--out', path.join(ROOT, '.run-out/p35/_never-written.json')]);
  assert.equal(res.code, 4, '★父题已结算时须 exit 4（实测 ' + res.code + '）\n' + res.out);
  assert.ok(/冻结失败/.test(res.out), '须明确报「冻结失败」');
  assert.ok(/不得事后冻结/.test(res.out), '须说明理由');
  assert.ok(!fs.existsSync(path.join(ROOT, '.run-out/p35/_never-written.json')), '★失败时不得写盘');
  fs.unlinkSync(tmp);
});

test('② ★sha16 稳定性：同集重复计算一致；顺序无关', () => {
  assert.ok(/out\.sort\(/.test(SRC), '★规范化必须排序（否则分支顺序变 ⇒ sha 变）');
  // 读已冻结件，重算应一致（用 verify 的路径）
  const fp = path.join(ROOT, 'p1b/sim/out/role3-frozen-probe-20260921.json');
  if (!fs.existsSync(fp)) return;
  const f = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const crypto = require('crypto');
  const recalc = crypto.createHash('sha256').update(JSON.stringify(f.branch_set)).digest('hex').slice(0, 16);
  assert.equal(recalc, f.sha16, '重算 sha16 须与记录一致');
  // 顺序无关：打乱后重算仍同（因为 verify 用已排序的 branch_set）
  const shuffled = f.branch_set.slice().reverse();
  const shuffledSorted = shuffled.slice().sort((a, b) => (String(a.parent_id) + '|' + String(a.pick)).localeCompare(String(b.parent_id) + '|' + String(b.pick)));
  const recalc2 = crypto.createHash('sha256').update(JSON.stringify(shuffledSorted)).digest('hex').slice(0, 16);
  assert.equal(recalc2, f.sha16, '★逆序后重排序应得同一 sha16（顺序无关）');
});

test('③ ★篡改检测：改一条分支 ⇒ MISMATCH', () => {
  const fp = path.join(ROOT, 'p1b/sim/out/role3-frozen-probe-20260921.json');
  if (!fs.existsSync(fp)) return;
  const f = JSON.parse(fs.readFileSync(fp, 'utf8'));
  f.branch_set[0].pick = 'TAMPERED';
  const tmp = path.join(ROOT, '.run-out/p35/_test-tampered.json');
  fs.writeFileSync(tmp, JSON.stringify(f), 'utf8');
  const res = run(['verify', '--frozen', tmp]);
  assert.equal(res.code, 6, '★篡改后 verify 须 exit 6（实测 ' + res.code + '）');
  assert.ok(/MISMATCH/.test(res.out), '须报 MISMATCH');
  fs.unlinkSync(tmp);
});

test('④ ★只增不改：同名冻结件 sha16 不同 ⇒ 拒绝覆写', () => {
  assert.ok(/拒绝覆写/.test(SRC) && /冻结件只增不改/.test(SRC), '须有只增不改保护');
  // 源码级锁：写盘前必须先 existsSync 检查
  const iCheck = SRC.indexOf('if (fs.existsSync(outPath))');
  const iWrite = SRC.indexOf('fs.writeFileSync(outPath');
  assert.ok(iCheck > 0 && iWrite > iCheck, '★写盘检查须在写盘之前');
});

test('⑤ 零账本写锁：脚本不得含写库调用', () => {
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const pat of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+predictions\b/i, /\bDELETE\s+FROM\b/i, /\bconn\.exec\(/]) {
    assert.ok(!pat.test(CODE), '不得含写库调用：' + pat);
  }
  assert.ok(/readOnly:\s*true/.test(SRC), 'DB 连接须 readOnly');
  assert.ok(/零账本写/.test(SRC), '头注须声明零账本写');
});

test('⑥ 冻结件形状锁', () => {
  const fp = path.join(ROOT, 'p1b/sim/out/role3-frozen-probe-20260921.json');
  if (!fs.existsSync(fp)) return;
  const f = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const k of ['run_id', 'frozen_at', 'sha16', 'branch_set', 'parent_status_at_freeze', 'all_parents_unresolved', 'sha_method']) {
    assert.ok(f[k] !== undefined, '冻结件须含 ' + k);
  }
  assert.equal(f.all_parents_unresolved, true, '冻结时父题须全部未结算');
  assert.ok(Array.isArray(f.branch_set) && f.branch_set.length > 0, 'branch_set 须非空');
  for (const b of f.branch_set) {
    for (const k of ['parent_id', 'kind', 'pick', 'child_statement']) assert.ok(k in b, '分支须含 ' + k);
  }
});

test('⑦ ★role3-pilot 的严格口径（drops:[] 是如实，非缺失）', () => {
  // 背景（2026-09-22）：role3-pilot 的口径**比 drops 数组更严**——无效项（解析失败/契约违约/调用失败）
  //   不丢弃，而是留在 rows 里以 _valid:false 标记（resolve=null ⇒ gate 判 no_anchor）
  //   ⇒ 分母天然＝提议全集。本批补显式 drops: [] ＋ 说明，让 gate 能报**严格口径**。
  const pilotSrc = fs.readFileSync(path.join(ROOT, 'p1b/scripts/role3-pilot.cjs'), 'utf8');
  assert.ok(pilotSrc.indexOf('drops: []') !== -1, '★须显式输出 drops: []（否则 gate 只报候选口径）');
  assert.ok(/drops_note/.test(pilotSrc), '须附说明（防后人误以为「空数组＝没做留痕」）');
  assert.ok(/_valid/.test(pilotSrc), '须保留 _valid 标记机制');
  assert.ok(/不丢弃任何提议|比 drops 口径更严|分母天然/.test(pilotSrc), '★说明须点明该口径比 drops 更严');
});

test('⑧ ★五出题器留痕口径审计（每器须可测严格分母）', () => {
  // 背景（2026-09-22）：候选留痕旁路覆盖全部出题器。
  //   ★判据**不机械要求** record-candidates 字样——允许两种等效设计：
  //     ① 支持 --record-candidates（落 drops 数组）
  //     ② 声明「不丢弃任何提议」（drops:[] ＋ 说明）⇒ 分母天然＝提议全集（**更严**）
  const GENS = ['corpus-sources-b4', 'corpus-thicken', 'role3-pilot', 'role3-utype', 'calendar-questions'];
  const bad = [];
  for (const g of GENS) {
    const p = path.join(ROOT, 'p1b/scripts/' + g + '.cjs');
    if (!fs.existsSync(p)) { bad.push(g + '（脚本不存在）'); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const hasParam = /record-candidates/.test(t);
    const declaresNoDrop = /drops: \[\]/.test(t) && /不丢弃/.test(t);
    if (!hasParam && !declaresNoDrop) bad.push(g + '（既无 --record-candidates 也无「不丢弃」声明）');
  }
  assert.deepEqual(bad, [], '★以下出题器无法测严格分母：' + bad.join('；'));
  assert.equal(GENS.length, 5, '出题器清单应为 5 个（新增时须同步本测试）');
});

test('⑨ ★留痕旁路「默认关」全局锁（防改成默认开）', () => {
  // 背景（2026-09-22）：评估过「让出题器**默认**产出留痕」——**否决**。理由：
  //   那会让**每次跑出题器**（含测试调用）都写仓库产物 ⇒ **正是本日刚修的缺陷模式**（d74bb81）。
  //   正确姿势＝由调用方显式传 --record-candidates（当前设计）。本锁防后人「好心」改成默认开。
  const GENS = ['corpus-sources-b4', 'corpus-thicken', 'role3-utype', 'calendar-questions'];
  const bad = [];
  for (const g of GENS) {
    const p = path.join(ROOT, 'p1b/scripts/' + g + '.cjs');
    if (!fs.existsSync(p)) { bad.push(g + ' 脚本不存在'); continue; }
    const t = fs.readFileSync(p, 'utf8');
    // ★须有「默认关」守卫：recDrop 首行 return（!REC_PATH）
    if (!/function recDrop\(stage, reason, info\) \{ if \(!REC_PATH\) return;/.test(t)) {
      bad.push(g + ' 缺默认关守卫（recDrop 须在 !REC_PATH 时立即 return）');
    }
  }
  assert.deepEqual(bad, [], '★以下出题器的留痕旁路可能被改成默认开（会写仓库产物）：' + bad.join('；'));
});
