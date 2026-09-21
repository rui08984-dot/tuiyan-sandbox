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
    // 第 4 期 A9（三行对比榜）
    ['import ArenaPage', /import ArenaPage from '\.\/pages\/disclosure\/ArenaPage'/],
    ['Route arena', /<Route path="\/arena" element=\{<ArenaPage \/>\}/],
    ['NavLink arena', /<NavLink to="\/arena"/],
  ];
  const bad = checks.filter(([, re]) => !re.test(src)).map(([n]) => n);
  assert.deepEqual(bad, [], '接线缺失：\n' + bad.join('\n'));
});

test('⑥ ★A9 三行对比榜：口径纪律锁（禁跨题集直接比较）', async () => {
  const { register } = require(path.join(ROOT, 'p1b/src/routes/disclosure.js'));
  const routes = {};
  register({ get: (p, h) => { routes[p] = h; } });
  assert.ok(routes['/api/disclosure/arena'], '缺 arena 端点');
  const r = await routes['/api/disclosure/arena']({}, mkReply());

  // ① 三行齐：我方 / 人类 / 市场
  assert.ok(Array.isArray(r.mine) && r.mine.length >= 3, '我方行应 ≥3 层');
  assert.ok(r.human && r.human.values, '人类行应含基线值');
  assert.ok(r.market && typeof r.market.available === 'boolean', '市场行应含 available 标志');

  // ② ★核心纪律：必须逐对声明可比性（不可比原因）
  assert.ok(Array.isArray(r.incomparable) && r.incomparable.length >= 2, '应 ≥2 条可比性声明（实测 ' + (r.incomparable || []).length + '）');
  for (const x of r.incomparable) {
    assert.ok(x.pair && x.reason && String(x.reason).length > 10, '每条声明须含 pair 与实质 reason');
  }

  // ③ 恒挂限定语块三条
  assert.equal(r.qualification_block.length, 3, '限定语块应 3 条');

  // ④ ★市场行不得混入我方读数（07 号件：市场价仅作对手参照）
  const mineStr = JSON.stringify(r.mine);
  assert.ok(mineStr.indexOf('marketPrice') < 0, '我方行不得含市场价字段');
  assert.ok(mineStr.indexOf('p_pick') < 0, '我方行不得含市场价字段');

  // ⑤ ★人类基线须标注核验状态（转载级不得冒充已核验）
  assert.ok(r.human.status && /转载级/.test(r.human.status), '人类基线须如实标注「转载级」核验状态');

  // ⑥ ★页面源码禁词（A6 §3）—— ArenaPage 单独查
  const src = fs.readFileSync(path.join(ROOT, 'p1b/web/src/pages/disclosure/ArenaPage.tsx'), 'utf8');
  assert.equal((src.match(/预测/g) || []).length, 0, 'ArenaPage 不得含禁词');
});

test('⑦ ★编译器门面：kind→层自动推断（只读历史，不出概率）', async () => {
  const { register } = require(path.join(ROOT, 'p1b/src/routes/disclosure.js'));
  const routes = {};
  register({ get: (p, h) => { routes[p] = h; } });
  assert.ok(routes['/api/disclosure/compiler'], '缺 compiler 端点');

  // ① 首屏（无 kind）：给可选 kind 目录 + 使用说明
  const cat = await routes['/api/disclosure/compiler']({ query: {} }, mkReply());
  assert.equal(cat.mode, 'catalog');
  assert.ok(cat.kinds.length >= 20, 'kind 目录应 ≥20（实测 ' + cat.kinds.length + '）');
  assert.equal(cat.how_it_works.length, 3, '应给三步说明');
  // ★内部别名（下划线开头）不得出现在用户可选列表
  const internal = cat.kinds.filter((k) => k.kind.charAt(0) === '_');
  assert.deepEqual(internal, [], '内部别名不应出现在 kind 目录：' + JSON.stringify(internal.map((x) => x.kind)));

  // ② 查已知 kind：给层 + 引擎 + 样本量
  const r = await routes['/api/disclosure/compiler']({ query: { kind: 'openmeteo_daily_max' } }, mkReply());
  assert.equal(r.known, true);
  assert.ok(r.suggestion && r.suggestion.layer, '应给建议层');
  assert.ok(r.evidence && r.evidence.total_n > 0, '应给样本量');
  assert.equal(typeof r.evidence.sample_ok, 'boolean');
  assert.ok(r.suggestion.layer_unanimous === true, 'openmeteo_daily_max 历史应单层（实测）');
  assert.ok(Array.isArray(r.next_steps) && r.next_steps.length >= 2, '应给下一步');
  // ★纪律：不得出概率（门面只给参考建议）
  assert.ok(JSON.stringify(r).indexOf('"p":') < 0, '门面不得返回概率字段');
  assert.ok(/不出概率/.test(JSON.stringify(r.next_steps) + r.discipline_note), '须声明不出概率');

  // ③ 未知 kind：如实报「无历史」，不编
  const u = await routes['/api/disclosure/compiler']({ query: { kind: 'nonexistent_xyz_kind' } }, mkReply());
  assert.equal(u.known, false);
  assert.ok(u.reason && /无此 kind/.test(u.reason), '未知 kind 须如实说明');
});

test('⑧ ★kind→层单层性（门面自动推断的前提，本会话实测 52/52）', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readOnly: true });
  const rows = db.prepare(
    "SELECT json_extract(evidence_json,'$[0].resolve.kind') k, layer, COUNT(*) n FROM predictions" +
    " WHERE json_extract(evidence_json,'$[0].resolve.kind') IS NOT NULL GROUP BY k, layer"
  ).all();
  db.close();
  const byK = {};
  for (const r of rows) { (byK[r.k] = byK[r.k] || new Set()).add(r.layer); }
  const mixed = Object.keys(byK).filter((k) => byK[k].size > 1);
  assert.deepEqual(mixed, [], '★出现跨层 kind ⇒ 门面的「自动推断」前提被破坏，须改为人工确认：\n' + mixed.map((k) => k + ' → ' + [...byK[k]].join('/')).join('\n'));
  assert.ok(Object.keys(byK).length >= 40, 'kind 数应 ≥40（实测 ' + Object.keys(byK).length + '）');
});

test('⑨ 第 4 期五页接线齐（含编译器）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'p1b/web/src/App.tsx'), 'utf8');
  for (const p of ['negative-results', 'bayes-lens', 'arena', 'compiler']) {
    assert.ok(new RegExp('<Route path="/' + p + '"').test(src), '缺 Route: ' + p);
    assert.ok(new RegExp('<NavLink to="/' + p + '"').test(src), '缺 NavLink: ' + p);
  }
});
