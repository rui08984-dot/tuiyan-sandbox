'use strict';
/**
 * p1b/test/a1-whatif.test.cjs —— A1 假设重算器（完整版 v1）· 测试（2026-09-17）
 *
 * 覆盖：①格键解析与命中 ②读数聚合（基线＝eng[layer]，只收本层出数题）③三类假设的变换语义
 * ④Δ 口径（**Δ_agg ＝ 两侧聚合之差**：剔除题须体现在 Δ 里，而不是被静默丢弃）⑤金样性质（无假设 ⇒ Δ≡0）
 * ⑥require 零副作用 ⑦零写库结构证据 ⑧CLI 金样自检（真跑一次 `--whatif none`，核 Δ 全 0）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'a1-whatif.cjs');
const LAMBDA = path.join(ROOT, 'p1b', 'scripts', 'lambda-overlap.cjs');
const A = require(SCRIPT);
const { bootCI } = require(LAMBDA);

/** 合成矩阵（5 层、含薄格/thin、含 L2/L3 双引擎题） */
function fixture() {
  const items = [];
  // L3 两域：good 域 10 题（p=0.9,y=1 ⇒ brier 0.01）；bad 域 10 题（p=0.9,y=0 ⇒ brier 0.81）
  for (let i = 0; i < 10; i++) items.push({ id: 100 + i, layer: 'L3', domain: 'good', y: 1, eng: { L3: 0.9, L2: 0.9 }, keys: ['L2', 'L3'] });
  for (let i = 0; i < 10; i++) items.push({ id: 200 + i, layer: 'L3', domain: 'bad', y: 0, eng: { L3: 0.9, L2: 0.6 }, keys: ['L2', 'L3'] });
  // L2 一域 6 题
  for (let i = 0; i < 6; i++) items.push({ id: 300 + i, layer: 'L2', domain: 'mid', y: 1, eng: { L2: 0.7 }, keys: ['L2'] });
  // L6 4 题
  for (let i = 0; i < 4; i++) items.push({ id: 400 + i, layer: 'L6', domain: 'ww', y: i % 2, eng: { L6: 0.6 }, keys: ['L6'] });
  return items;
}

test('① 格键解析：cell:/domain: 两类；命中按 (layer,domain) / domain', () => {
  const ks = A.parseKeys('cell:L3/good,domain:mid');
  assert.equal(ks.length, 2);
  assert.deepEqual(ks[0], { kind: 'cell', layer: 'L3', domain: 'good' });
  assert.deepEqual(ks[1], { kind: 'domain', domain: 'mid' });
  const it = { layer: 'L3', domain: 'good' };
  assert.equal(A.keyHits(it, ks), true);
  assert.equal(A.keyHits({ layer: 'L2', domain: 'good' }, ks), false, 'cell 须同时匹配 layer 与 domain');
  assert.equal(A.keyHits({ layer: 'L5', domain: 'mid' }, ks), true, 'domain: 只按域名匹配');
});

test('② readingsOf：只收「本层引擎出数」的题；L1/L5 无引擎则 n=0', () => {
  const r = A.readingsOf(fixture());
  assert.equal(r.byLayer.L3.n, 20);
  assert.equal(r.byLayer.L2.n, 6);
  assert.equal(r.byLayer.L6.n, 4);
  assert.equal(r.byLayer.L1.n, 0);
  assert.equal(r.byLayer.L5.n, 0);
  // L3：good 0.01×10 + bad 0.81×10 ⇒ 0.41
  assert.ok(Math.abs(r.byLayer.L3.brier - 0.41) < 1e-12, 'L3 基线须为 0.41（实测 ' + r.byLayer.L3.brier + '）');
  assert.ok(Math.abs(r.byLayer.L3.brier_half - 0.25) < 1e-12, '常数 0.5 的 Brier 恒 0.25');
});

test('③ 三类假设的变换语义', () => {
  const items = fixture();
  const ex = A.applyExclude(items, A.parseKeys('cell:L3/bad'));
  assert.equal(ex.items.length, items.length - 10, 'exclude 剔除整行');
  const dr = A.applyDropBaserate(items, A.parseKeys('cell:L3/good'));
  const touched = dr.items.filter((x) => x._baserate_removed === true);
  assert.equal(touched.length, 10, 'drop-baserate 只影响命中题的 L2/L3 读数');
  assert.equal(touched[0].eng.L3, undefined, 'L3 读数被移除');
  assert.equal(touched[0].eng.L2, undefined, 'L2 读数同时被移除');
  assert.equal(dr.items.filter((x) => x.layer === 'L6')[0].eng.L6, 0.6, '非命中层不动');
  const dv = A.applyDropVariant(items, { 400: 0.2, 401: null });
  const l6 = dv.items.filter((x) => x.layer === 'L6');
  assert.equal(l6[0].eng.L6, 0.2, 'L6 读数被替换');
  assert.equal(l6[1].eng.L6, undefined, '替换为 null ⇒ 该题在 L6 侧不出数');
  assert.equal(l6[2].eng.L6, 0.6, '未给出的题不动');
});

test('④ ★Δ 口径：Δ_agg ＝两侧聚合之差（剔除题须体现在 Δ 里）', () => {
  const items = fixture();
  const base = A.readingsOf(items);
  // 排除 bad 域 ⇒ L3 只剩 good ⇒ 0.41 → 0.01，Δ 应为 −0.40（而非 0）
  const alt = A.applyExclude(items, A.parseKeys('domain:bad'));
  const d = A.deltaOf(base.rows, A.readingsOf(alt.items).rows, bootCI);
  assert.equal(d.L3.n_base, 20);
  assert.equal(d.L3.n_alt, 10);
  assert.equal(d.L3.n_lost, 10);
  assert.ok(Math.abs(d.L3.alt_brier - 0.01) < 1e-12, '变更后 L3＝0.01');
  assert.ok(Math.abs(d.L3.delta - (-0.40)) < 1e-12, '★Δ 须为 −0.40（首版「配对均值差」会误报 0）实测 ' + d.L3.delta);
  assert.ok(d.L3.ci95.lo < 0 && d.L3.ci95.hi < 0, 'CI 应全负（该剔除显著）');
  // drop-baserate 同理：命中题不再出数 ⇒ 分母与均值都变
  const alt2 = A.applyDropBaserate(items, A.parseKeys('cell:L3/good'));
  const d2 = A.deltaOf(base.rows, A.readingsOf(alt2.items).rows, bootCI);
  assert.equal(d2.L3.n_alt, 10, 'good 域 10 题在 L3 侧不再出数');
  assert.ok(Math.abs(d2.L3.delta - 0.40) < 1e-12, 'Δ 须为 +0.40（实测 ' + d2.L3.delta + '）');
});

test('⑤ 金样性质：无假设 ⇒ Δ ≡ 0 且无丢失（矩阵逐位回放）', () => {
  const items = fixture();
  const base = A.readingsOf(items);
  const same = A.readingsOf(items);
  const d = A.deltaOf(base.rows, same.rows, bootCI);
  for (const K of A.LAYERS.concat(['ALL'])) {
    // 空层（本 fixture 里 L1/L5 无引擎读数）⇒ Δ 为 null（n/a，**不编 0**，照项目「缺数即 n/a」纪律）
    if (d[K].n_base === 0) assert.equal(d[K].delta, null, K + ' 空层 ⇒ Δ 须 n/a');
    else assert.equal(d[K].delta, 0, K + ' Δ 须为 0');
  }
  assert.equal(d.ALL.n_lost, 0);
});

test('⑥ require 零副作用：导出面齐全、不写盘', () => {
  const before = fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).length;
  assert.equal(typeof A.readingsOf, 'function');
  assert.equal(typeof A.deltaOf, 'function');
  assert.equal(typeof A.applyExclude, 'function');
  assert.equal(typeof A.applyDropBaserate, 'function');
  assert.equal(typeof A.applyDropVariant, 'function');
  assert.deepEqual(A.LAYERS, ['L1', 'L2', 'L3', 'L5', 'L6']);
  assert.equal(fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).length, before, 'sim/out 文件数不变');
});

test('⑦ 零写库结构证据：脚本不含 SQL 写语句；库以 readOnly 打开', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|VIEW)|CREATE\s+(TABLE|VIEW))\b/i.test(src), '不得含 SQL 写语句');
  assert.ok(/readOnly:\s*true/.test(src), '须有 readOnly 打开');
  assert.ok(/不产新概率进账本/.test(src), '禁令须写入脚本头（11 号件 §6 原文）');
  assert.ok(/探索性 what-if 读数/.test(src), '探索性标注须恒挂');
});

test('⑧ CLI 金样自检：真跑 `--whatif none`，Δ 全 0 且输出件落盘', () => {
  // ★输出目录必须解耦（项目纪律）：测试跑 CLI 时 `--out-dir` 指向临时目录，
  //   否则会往 `p1b/sim/out` 写件——而 `assumption-recalc.test.cjs` 会快照该目录 ⇒ **互相干扰致误报**。
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'a1-whatif-'));
  const out = execFileSync(process.execPath, [SCRIPT, '--whatif', 'none', '--out-dir', tmpDir], { encoding: 'utf8', cwd: ROOT });
  assert.ok(out.indexOf('金样回放零读数变化') > 0, 'MD 须含金样结论');
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, 'a1-whatif-20260917.json'), 'utf8'));
  assert.equal(j.health_check.identical, true, 'health_check 须 PASS');
  for (const K of ['L1', 'L2', 'L3', 'L5', 'L6', 'ALL']) assert.equal(j.delta[K].delta, 0, K + ' Δ 须为 0');
  assert.equal(j.discipline.ledger_write, false);
  assert.equal(j.discipline.into_calibration, false);
  assert.ok(j.label.indexOf('探索性') === 0, 'label 须以探索性开头');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
