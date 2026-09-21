'use strict';
/**
 * p1b/test/disclosure-phase4-pages.test.cjs —— 第 4 期两页（I2/I6）接线与纪律锁（2026-09-21）
 *
 * 覆盖：
 *   ① 两个端点已注册且能返回数据（negative-results / bayes-lens）
 *   ② ★I6 端点返回**精简投影**（不透传整件）—— 键集合固定，且不含 stage4 件里的重型字段（engine_sample/report/…）
 *   ③ ★I2 四要素完整性：每条 empirical/design_rejected 必须含 hypothesis/criterion/outcome/rerun（缺一即撤）
 *   ④ ★禁词锁：两页源码 + App.tsx 不得含「预测」字样（A6 §3）
 *   ⑤ 路由接线锁：App.tsx 须含两页的 Route + NavLink + import
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['p1b/web/src/pages/disclosure/NegativeResultsPage.tsx', 'p1b/web/src/pages/disclosure/BayesLensPage.tsx'];

function mkReply() { return { _c: 200, code(c) { this._c = c; return this; }, send(x) { this._sent = x; return x; } }; }

test('① 两个端点已注册并能返回数据', async () => {
  const { register } = require(path.join(ROOT, 'p1b/src/routes/disclosure.js'));
  const routes = {};
  register({ get: (p, h) => { routes[p] = h; } });
  assert.ok(routes['/api/disclosure/negative-results'], '缺 negative-results 端点');
  assert.ok(routes['/api/disclosure/bayes-lens'], '缺 bayes-lens 端点');

  for (const p of ['/api/disclosure/negative-results', '/api/disclosure/bayes-lens']) {
    const reply = mkReply();
    const r = await routes[p]({}, reply);
    assert.equal(reply._sent, undefined, p + ' 不应 404（实测 ' + JSON.stringify(reply._sent) + '）');
    assert.ok(r && typeof r === 'object', p + ' 应返回对象');
  }
});

test('② ★I6 端点返回精简投影（不透传整件）', async () => {
  const { register } = require(path.join(ROOT, 'p1b/src/routes/disclosure.js'));
  const routes = {};
  register({ get: (p, h) => { routes[p] = h; } });
  const r = await routes['/api/disclosure/bayes-lens']({}, mkReply());
  const keys = Object.keys(r).sort();
  assert.deepEqual(keys, ['bayes_legend', 'cells_total', 'cells_with_conclusion', 'domains', 'generated_at', 'layers', 'source_file'],
    '键集合须为投影后的固定集（实测 ' + JSON.stringify(keys) + '）');
  // 不得含 stage4 件里的重型字段
  for (const heavy of ['report', 'engine_sample', 'by_domain', 'coverage', 'fetch_log']) {
    assert.equal(r[heavy], undefined, '不应透传重型字段 ' + heavy);
  }
  // 每格只保留页面需要的列
  if (r.domains.length) {
    const dk = Object.keys(r.domains[0]).sort();
    assert.deepEqual(dk, ['brier_engine', 'conclusion_allowed', 'domain', 'layer', 'mean_p', 'obs_rate', 'scored_n'], '格字段须为投影集');
  }
});

test('③ ★I2 要素完整性（★两类字段不同，按类断言）', async () => {
  const { register } = require(path.join(ROOT, 'p1b/src/routes/disclosure.js'));
  const routes = {};
  register({ get: (p, h) => { routes[p] = h; } });
  const r = await routes['/api/disclosure/negative-results']({}, mkReply());
  const emp = r.empirical || [], des = r.design_rejected || [];
  assert.ok(emp.length >= 10, '实证类应 ≥10 条（实测 ' + emp.length + '）');
  assert.ok(des.length >= 3, '设计类应 ≥3 条（实测 ' + des.length + '）');
  const bad = [];
  // ★实证类＝四要素（跑过有读数 ⇒ 必须有结局与复算入口）
  for (const e of emp) {
    for (const k of ['hypothesis', 'criterion', 'outcome', 'rerun']) {
      if (!e[k] || !String(e[k]).trim()) bad.push(e.id + '（实证）缺 ' + k);
    }
  }
  // ★设计类＝两要素（评审否决未跑 ⇒ 无结局/复算入口是语义正确，不判缺失）
  for (const e of des) {
    for (const k of ['reason', 'source']) {
      if (!e[k] || !String(e[k]).trim()) bad.push(e.id + '（设计）缺 ' + k);
    }
    for (const k of ['outcome', 'rerun']) {
      if (e[k] !== undefined) bad.push(e.id + '（设计）不应有 ' + k + '（该类未跑）');
    }
  }
  assert.deepEqual(bad, [], '要素缺失/错配：\n' + bad.join('\n'));
});

test('④ ★禁词锁：两页源码与 App.tsx 不得含「预测」字样', () => {
  const files = PAGES.concat(['p1b/web/src/App.tsx']);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const n = (src.match(/预测/g) || []).length;
    if (n > 0) bad.push(f + ' 命中 ' + n);
  }
  assert.deepEqual(bad, [], '禁词命中（A6 §3）：\n' + bad.join('\n'));
});

test('⑤ 路由接线锁：App.tsx 含两页的 import + Route + NavLink', () => {
  const src = fs.readFileSync(path.join(ROOT, 'p1b/web/src/App.tsx'), 'utf8');
  const checks = [
    ['import NegativeResultsPage', /import NegativeResultsPage from '\.\/pages\/disclosure\/NegativeResultsPage'/],
    ['import BayesLensPage', /import BayesLensPage from '\.\/pages\/disclosure\/BayesLensPage'/],
    ['Route negative-results', /<Route path="\/negative-results" element=\{<NegativeResultsPage \/>\}/],
    ['Route bayes-lens', /<Route path="\/bayes-lens" element=\{<BayesLensPage \/>\}/],
    ['NavLink negative-results', /<NavLink to="\/negative-results"/],
    ['NavLink bayes-lens', /<NavLink to="\/bayes-lens"/],
  ];
  const bad = checks.filter(([, re]) => !re.test(src)).map(([n]) => n);
  assert.deepEqual(bad, [], '接线缺失：\n' + bad.join('\n'));
});
