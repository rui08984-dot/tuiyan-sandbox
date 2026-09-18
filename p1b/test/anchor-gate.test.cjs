'use strict';
/**
 * p1b/test/anchor-gate.test.cjs —— Q0 拒收门判定器守卫（2026-09-18 · 第 3 期票 A）
 *
 * 不变量：Q0 三问的判定**按冻结判据（万物分类清单-v2 §第 0 步）**作答，且**不确定时不得静默当通过**。
 * 本件是「过锚率」的唯一测量通道 ⇒ 它错了，角色③／I1 的前置就会给出编出来的读数。
 *
 * 覆盖：① MMWR 周首日（对照手算已知值）② Q0-1 注册≠可达（承 31 条空 URL 教训）
 *       ③ Q0-2 泄漏/不可判 ④ Q0-3 重言 ⑤ 汇总分母＝候选全集 ⑥ require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const M = require(path.join(ROOT, 'p1b', 'scripts', 'anchor-gate.cjs'));
const ctx = { R: M.loadResolvers() };

const mk = (o) => Object.assign({ statement: '', prob: 0.5, meta: {}, resolve: {} }, o);

test('① MMWR 周首日：对照手算已知值（含「含 ≥4 天新年」边界）', () => {
  // 2026-01-01 为周四 ⇒ 其所在 Sun–Sat 周只含 3 天新年 ⇒ 第 1 周从 2026-01-04（周日）起
  assert.equal(M.gate(mk({ resolve: { kind: 'delphi_fluview_ili', url: 'u', epiweek: '202601' }, meta: { cutoff: '2000-01-01T00:00:00+08:00' } }), ctx).q02.why.includes('2026-01-04'), true, '202601 应为 2026-01-04');
  // 2026 第 39 周 = 01-04 + 38×7 天 = 2026-09-27
  assert.equal(M.gate(mk({ resolve: { kind: 'delphi_fluview_ili', url: 'u', epiweek: '202639' }, meta: { cutoff: '2000-01-01T00:00:00+08:00' } }), ctx).q02.why.includes('2026-09-27'), true, '202639 应为 2026-09-27');
  // 2025-01-01 为周三 ⇒ 所在周含 4 天新年（1/1-1/4）⇒ 第 1 周从 2024-12-29（周日）起
  assert.equal(M.gate(mk({ resolve: { kind: 'delphi_fluview_ili', url: 'u', epiweek: '202501' }, meta: { cutoff: '2000-01-01T00:00:00+08:00' } }), ctx).q02.why.includes('2024-12-29'), true, '202501 应为 2024-12-29');
  // 形状非法 ⇒ 不猜（返回 null ⇒ 走 unverifiable）
  const bad = M.gate(mk({ resolve: { kind: 'delphi_fluview_ili', url: 'u', epiweek: '9999' }, meta: { cutoff: '2020-01-01T00:00:00+08:00' } }), ctx);
  assert.equal(bad.q02.verdict, 'unverifiable', '非法 epiweek 不得猜出窗口');
});

test('② Q0-1：注册 ≠ 可达（承 31 条空 URL 教训）', () => {
  // 已注册、解析器需要 URL、spec 未给、**且无派生层** ⇒ no_anchor（不是 pass）
  // ★用 ghcn_daily_tmax（需要 spec URL，且不在派生表里）——不用 npm：npm 自 2026-09-18 起**有派生层**，
  //   其新形态已可达（见下第三段与 resolve-spec-derive.test.cjs）。
  const g = M.gate(mk({ resolve: { kind: 'ghcn_daily_tmax', station: 'X', date: '2026-09-20', threshold: 1, cmp: '>=' }, meta: { cutoff: '2026-09-01T00:00:00+08:00' } }), ctx);
  assert.equal(g.q01.verdict, 'no_anchor', '需 URL 而无 URL 且无派生层 ⇒ 锚不可达');
  assert.equal(g.pass, false);
  // 同 kind 给了 URL ⇒ pass
  assert.equal(M.gate(mk({ resolve: { kind: 'ghcn_daily_tmax', url_template: 'https://x/{date}', date: '2026-09-20' }, meta: { cutoff: '2026-08-01T00:00:00+08:00' } }), ctx).q01.verdict, 'pass');
  // ★派生层（2026-09-18 修好 31 条空 URL 后）：npm 新形态**缺 URL 但可达** ⇒ pass
  const npm = M.gate(mk({ resolve: { kind: 'npm_downloads_window', pkg: 'react', date: '2026-09-20', threshold: 1, cmp: '>=' }, meta: { cutoff: '2026-09-01T00:00:00+08:00' } }), ctx);
  assert.equal(npm.q01.verdict, 'pass', 'npm 新形态有派生层 ⇒ 可达');
  assert.ok(/派生层/.test(npm.q01.why), '理由应标注派生层: ' + npm.q01.why);
  // 未注册 kind ⇒ no_anchor
  assert.equal(M.gate(mk({ resolve: { kind: 'no_such_kind_xyz' } }), ctx).q01.verdict, 'no_anchor');
  // 无 resolve ⇒ no_anchor
  assert.equal(M.gate(mk({ resolve: {} }), ctx).q01.verdict, 'no_anchor');
  // 显式 certifiedSource ⇒ pass（L5 语义）
  assert.equal(M.gate(mk({ resolve: { certifiedSource: { target: 'cwl' } } }), ctx).q01.verdict, 'pass');
});

test('③ Q0-2：泄漏必判 leak；抽不出 cutoff 必判 unverifiable（**禁静默当通过**）', () => {
  // 以落库日为 cutoff 去问历史事件（v2 注记原文点名的 leak 情形）
  const leak = M.gate(mk({ resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-09-12T23:59:59+08:00' } }), ctx);
  assert.equal(leak.q02.verdict, 'leak');
  assert.equal(leak.pass, false);
  // backfill 正确口径：cutoff = 前一日 23:59:59
  assert.equal(M.gate(mk({ resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-06-30T23:59:59+08:00' } }), ctx).q02.verdict, 'pass');
  // cutoff 完全抽不出 ⇒ unverifiable（**不是 pass**）
  const un = M.gate(mk({ statement: '无 cutoff 字样', resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: {} }), ctx);
  assert.equal(un.q02.verdict, 'unverifiable');
  assert.equal(un.pass, false, 'unverifiable 不得算通过');
  // 题面 cutoff 可抽（forward 常不落 meta）
  assert.equal(M.gate(mk({ statement: '（cutoff=落库时点 2026-09-13T15:10:07+08:00，该日尚未发生）', resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-09-20' }, meta: { phase: 'forward' } }), ctx).q02.verdict, 'pass');
});

test('④ Q0-3：恒定即重言；基率缺失单列；出题器红线**并列披露不混判据**', () => {
  assert.equal(M.gate(mk({ prob: 0 }), ctx).q03.verdict, 'tautology');
  assert.equal(M.gate(mk({ prob: 1 }), ctx).q03.verdict, 'tautology');
  assert.equal(M.gate(mk({ prob: 0.5 }), ctx).q03.verdict, 'pass');
  assert.equal(M.gate(mk({ prob: undefined }), ctx).q03.verdict, 'missing');
  // 红线 (0.15,0.85)：命中但**不影响 pass**（并列披露）
  const outBand = M.gate(mk({ prob: 0.05, resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-06-30T23:59:59+08:00' } }), ctx);
  assert.equal(outBand.inBand, false, '0.05 应落在红线外');
  assert.equal(outBand.q03.verdict, 'pass', '红线不是拒收门判据 ⇒ 不得影响 Q0-3');
});

test('⑤ 汇总：分母＝候选全集；原因计数与 pass 自洽', () => {
  const rows = [
    mk({ resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-06-30T23:59:59+08:00' }, prob: 0.5 }),  // pass
    mk({ resolve: { kind: 'no_such_kind_xyz' }, prob: 0.5, meta: { cutoff: '2026-06-30T00:00:00+08:00' } }),                                                     // no_anchor
    mk({ resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-09-12T23:59:59+08:00' }, prob: 0.5 }), // leak
    mk({ prob: 1, resolve: { kind: 'openmeteo_air_daily_mean', url: 'u', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-06-30T23:59:59+08:00' } }),  // tautology
  ];
  const s = M.summarize(rows, ctx);
  assert.equal(s.candidates, 4, '分母＝候选全集');
  assert.equal(s.pass, 1);
  assert.equal(s.anchor_rate, 0.25);
  assert.equal(s.by_reason.no_anchor, 1);
  assert.equal(s.by_reason.leak, 1);
  assert.equal(s.by_reason.tautology, 1);
  // 三问全过才计入 pass
  assert.equal(s.pass + s.by_reason.no_anchor + s.by_reason.leak + s.by_reason.tautology, 4);
});

test('⑥ require 本件零副作用（主流程只在 CLI 直跑）', () => {
  const snap = () => fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).sort().join('\n');
  const s0 = snap();
  delete require.cache[require.resolve(path.join(ROOT, 'p1b', 'scripts', 'anchor-gate.cjs'))];
  require(path.join(ROOT, 'p1b', 'scripts', 'anchor-gate.cjs'));
  assert.equal(snap(), s0, 'require 不得写盘');
});

test('⑦ 读数件**自描述**：md 必含「不是过锚率」的口径纪律（重跑不得丢）', () => {
  // 事故背景：2026-09-18 首次把解读**手追加**在生成物后面，重跑即被覆盖 ⇒ 改为收进生成器。
  // 本测试锁住该不变量：凡由本生成器产出的 md，必须自带口径纪律段。
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-ag-'));
  try {
    const cands = path.join(tmp, 'cands.json');
    fs.writeFileSync(cands, JSON.stringify([
      { statement: 'x', prob: 0.5, resolve: { kind: 'ghcn_daily_tmax', url_template: 'u/{date}', date: '2026-07-01' }, meta: { phase: 'backfill', cutoff: '2026-06-30T23:59:59+08:00' } },
    ]), 'utf8');
    const md = path.join(tmp, 'out.md');
    execFileSync(process.execPath, [path.join(ROOT, 'p1b', 'scripts', 'anchor-gate.cjs'), '--candidates', cands, '--md', md], { encoding: 'utf8' });
    const t = fs.readFileSync(md, 'utf8');
    assert.ok(t.includes('不是') && t.includes('过锚率'), 'md 必含「不是过锚率」的口径纪律');
    assert.ok(t.includes('intake_rejects'), 'md 必申明「被丢候选零留痕」的证据');
    assert.ok(t.includes('分母'), 'md 必申明分母差异');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
});
