'use strict';
/**
 * p1b/test/dna-s-dryrun.test.cjs —— P0-U6 测试（2026-09-16）
 * ①Newcombe hybrid-score 数值金样（独立二分法核对 Wilson 端点；lb/ub 冻结到 1e-4）；
 * ②先验档路由（L5/L6→先验:恒平稳；L1→整层剔除计数）；
 * ③单批零散布系列（同日 30 题夹具）→「不可判」语义；
 * ④源码自检：脚本源文本不含 `--confirm` 与 `INSERT`（防后续静默加写路径）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'dna-s-dryrun.cjs');
const M = require(SCRIPT);

/** 独立实现：分数方程二分求 Wilson 端点（与闭式实现无关，用于交叉核对） */
function wilsonBisect(k, n) {
  const Z = 1.96, p = k / n;
  const G = (x) => (p - x) / Math.sqrt(x * (1 - x) / n) - Z;
  const H = (x) => (p - x) / Math.sqrt(x * (1 - x) / n) + Z;
  let lo = 0, hi = p; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (G(m) > 0) lo = m; else hi = m; }
  const L = (lo + hi) / 2;
  let lo2 = p, hi2 = 1; for (let i = 0; i < 200; i++) { const m = (lo2 + hi2) / 2; if (H(m) > 0) lo2 = m; else hi2 = m; }
  const U = (lo2 + hi2) / 2;
  return { l: L, u: U };
}

test('① Newcombe 金样（冻结 1e-4）＋ 闭式/二分独立核对（1e-9）', () => {
  const GOLD = [
    { k1: 30, n1: 100, k2: 45, n2: 100, lb: 0.023166953, ub: 0.284150258, label: '漂移' },
    { k1: 12, n1: 40, k2: 20, n2: 40, lb: 0.009927692, ub: 0.413812028, label: '漂移' },
    { k1: 5, n1: 25, k2: 14, n2: 25, lb: 0.153946922, ub: 0.629159032, label: '漂移' },
    { k1: 20, n1: 50, k2: 22, n2: 50, lb: -0.1447, ub: 0.2286, label: '平稳', tol: 1e-3 },
  ];
  for (const g of GOLD) {
    const ci = M.newcombe(g.k1, g.n1, g.k2, g.n2);
    const tol = g.tol || 1e-4;
    assert.ok(Math.abs(ci.lb - g.lb) < tol, 'lb 偏离: ' + ci.lb + ' vs ' + g.lb);
    assert.ok(Math.abs(ci.ub - g.ub) < tol, 'ub 偏离: ' + ci.ub + ' vs ' + g.ub);
    assert.equal(M.labelOf(g.k1, g.n1, g.k2, g.n2).label, g.label, '判定不符');
    // 独立核对（Wilson 端点）
    const w1c = M.wilson(g.k1, g.n1), w1i = wilsonBisect(g.k1, g.n1);
    const w2c = M.wilson(g.k2, g.n2), w2i = wilsonBisect(g.k2, g.n2);
    assert.ok(Math.abs(w1c.l - w1i.l) < 1e-9 && Math.abs(w1c.u - w1i.u) < 1e-9, 'Wilson#1 闭式≠二分');
    assert.ok(Math.abs(w2c.l - w2i.l) < 1e-9 && Math.abs(w2c.u - w2i.u) < 1e-9, 'Wilson#2 闭式≠二分');
  }
});

test('② 先验档路由：L5/L6→先验:恒平稳；L1→整层剔除（真实库只读实跑）', () => {
  const fsx = fs;
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-dna-'));
  execFileSync(process.execPath, [SCRIPT, '--out-dir', tmp], { stdio: 'ignore' });
  const jf = path.join(tmp, fsx.readdirSync(tmp).filter((f) => /^dna-s-dryrun-\d{8}\.json$/.test(f))[0]);
  const j = JSON.parse(fsx.readFileSync(jf, 'utf8'));
  assert.ok(j.counts['先验:恒平稳'] > 0, 'L5/L6 先验档计数 >0');
  assert.ok(j.counts['剔除_L1'] > 0, 'L1 剔除计数 >0');
  assert.ok(j.hard_notice.indexOf('非判据') >= 0, '件头非判据声明在');
  assert.ok(j.concentration && Array.isArray(j.concentration.warnings), '集中度预检在');
  assert.ok(j.note_writes.indexOf('无旁路表') >= 0, '零写库声明在');
  fsx.rmSync(tmp, { recursive: true, force: true });
});

test('③ 单批零散布序列 ⇒ 不可判（语义：series_n<20）', () => {
  // 单批 30 题若同系列但历史不足 20 ⇒ 不可判；此处直接用阈值语义断言（干跑已覆盖真实分布）
  assert.equal(M.labelOf(1, 10, 1, 9).label, '不可判', 'n<20 ⇒ 不可判');
  assert.equal(M.labelOf(3, 8, 4, 8).label, '不可判', 'min(n1,n2)<10 ⇒ 不可判');
});

test('④ 源码自检：无 --confirm 与 INSERT（防静默加写路径）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(src.indexOf('--confirm') === -1, '源码含 --confirm');
  assert.ok(!/\bINSERT\b/.test(src), '源码含 INSERT');
  assert.ok(src.indexOf('readOnly: true') >= 0, '库连接须 readOnly');
});
