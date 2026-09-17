'use strict';
/**
 * p1b/test/odds-snapshot.test.cjs —— 体育赔率前瞻快照采集 测试（2026-09-17）
 *
 * ① 去水（multiplicative）数学：隐含概率归一、和为 1
 * ② 共识三口径：等权均值／中位数／最佳价（合成博彩公司）
 * ③ ★冷却闸（配额纪律）：距上次快照 <48h ⇒ **exit 3 且不发请求**（在 fetch 之前退出 ⇒ 不耗配额）
 * ④ 结构性零账本写：源码不引 sqlite/DB 写入面；require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'odds-snapshot.cjs');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-odds-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

const M = require(SCRIPT);

test('① 去水：隐含概率归一且和为 1', () => {
  const p = M.devig([2, 4, 4]);           // 1/2 + 1/4 + 1/4 = 1 ⇒ 无需去水
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12, '和须为 1');
  assert.ok(Math.abs(p[0] - 0.5) < 1e-12);
  const q = M.devig([1.5, 3.5, 3.5]);     // 有水：1/1.5+2/3.5 ≈ 1.238 ⇒ 归一
  assert.ok(Math.abs(q.reduce((a, b) => a + b, 0) - 1) < 1e-12, '有水时仍须归一到 1');
  assert.ok(q[0] > q[1], '低赔率 ⇒ 高概率');
});

test('② 共识三口径：均值／中位数／最佳价', () => {
  const mk = (h, d, a, key) => ({ key: key, markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: h }, { name: 'D', price: d }, { name: 'A', price: a }] }] });
  const books = [mk(2.0, 4.0, 4.0, 'b1'), mk(1.5, 3.5, 3.5, 'b2'), mk(1.8, 3.8, 5.0, 'b3')];
  const c = M.consensus(books, 'H', 'A');
  assert.equal(c.n_books, 3);
  assert.equal(c.prices_best[0], 2.0, '最佳价取最大赔率'); assert.equal(c.prices_best[2], 5.0);
  assert.equal(c.probs_median.length, 3);
  assert.ok(Math.abs(c.probs_median.reduce((a, b) => a + b, 0) - 1) < 1e-9, '归一后中位数共识和为 1');
  assert.ok(Math.abs(c.probs_mean.reduce((a, b) => a + b, 0) - 1) < 1e-9, '均值共识和为 1（每家先去水）');
  // ★ 逐路中位数**天然不保证和为 1**（各列中位数不同源）⇒ 原值留档、归一的才作概率用
  assert.ok(c.probs_median_raw.length === 3 && c.probs_median_raw.every((x) => x > 0 && x < 1), '未归一中位数须留档');
  // 缺 h2h 或缺一路 ⇒ 该家不计入
  const c2 = M.consensus([mk(2.0, 4.0, 4.0, 'b1'), { key: 'b2', markets: [] }], 'H', 'A');
  assert.equal(c2.n_books, 1);
  assert.equal(M.consensus([], 'H', 'A'), null, '无可用家 ⇒ null（不编数）');
});

test('③ ★冷却闸：<48h ⇒ exit 3 且不发请求（不耗配额）', () => {
  const cfg = path.join(tmpDir, 'odds.json');
  fs.writeFileSync(cfg, JSON.stringify({ api_key: 'TEST_KEY_NOT_REAL_000000', base_url: 'https://api.the-odds-api.com/v4' }), 'utf8');
  const outDir = path.join(tmpDir, 'out'); fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'odds-snapshots-soccer_epl.jsonl'),
    JSON.stringify({ schema: 'odds-snapshot.v1', snapshot_utc: new Date().toISOString(), n_matches: 1, matches: [] }) + '\n', 'utf8');
  let code = 0, out = '';
  try { execFileSync(process.execPath, [SCRIPT, '--out-dir', outDir], { encoding: 'utf8', env: Object.assign({}, process.env, { ODDS_CONFIG: cfg }) }); }
  catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  assert.equal(code, 3, '冷却中须 exit 3（实测 ' + code + '）');
  assert.ok(/冷却中/.test(out), '应打印冷却提示: ' + out.slice(0, 100));
  const lines = fs.readFileSync(path.join(outDir, 'odds-snapshots-soccer_epl.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1, '冷却中不得追加新批（配额纪律）');
});

test('④ 结构性：零账本写＋require 零副作用', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/sqlite|better-sqlite3/.test(src), '赔率采集不得引入任何 DB 面（结构性零账本写）');
  assert.ok(/appendFileSync/.test(src), '落盘应为 append-only（历史端点不可用 ⇒ 禁删）');
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const s0 = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), s0, 'require 本件不得写盘');
});
