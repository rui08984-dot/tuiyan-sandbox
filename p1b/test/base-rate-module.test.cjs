'use strict';
/**
 * base-rate-module.test.cjs —— 任务 6 · 批次 3 / B1-1：基率读数单一真源的 parity 与结构化语义。
 *
 * ① 金样回放：`fixtures/base-rate-golden.json`（**重构前**三解析器对账本 151 条真实注记的逐字输出）
 *    与共享模块逐条比对 —— 证明「三解析器收敛为一份共享模块」零读数变化。
 * ② 委托链：l2_baseline.parseBaseRateNote / l5_sources.parseCertifiedFromNote（已改委托）与金样一致。
 * ③ 结构化字段：校验、构造、读序（结构化优先、非法不采信退文本）。
 * ④ 物化不变式：baseRateFromNote 的结构化值 == 同一注记的旧读序（零翻转由构造保证）。
 * ⑤ 引擎接线：l2Baseline / l3Aci / certifiedSourceForRow 吃结构化；store 写入口随行落库；
 *    intake `evidence.baseRate` **形态判别**（结构化走新路、旧「计数」别名零变化）。
 * 铁律：不起真端口；DB=:memory:；零网络零 LLM；零写生产库。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mod = require('../src/evidence/baseRate');
const { l2Baseline, parseBaseRateNote } = require('../src/engines/l2_baseline');
const { certifiedSourceForRow, parseCertifiedFromNote } = require('../src/engines/l5_sources');
const { l3Aci } = require('../src/engines/l3_aci');
const store = require('../src/db/predictionsStore');

const FIXTURE = path.join(__dirname, 'fixtures', 'base-rate-golden.json');
const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// ── ① 金样回放（151 条真实注记 × 三条读序；金样＝重构前逐字实现的输出）────────
test('金样回放：三读序对账本真实注记逐条与重构前一致（零读数变化）', () => {
  assert.ok(golden.samples.length >= 100, '金样样本量（实际 ' + golden.samples.length + '）');
  for (const s of golden.samples) {
    // L2 引擎级（解析 + Wilson + 文案）逐字一致
    assert.deepEqual(l2Baseline({ baseRateNote: s.note }), s.l2, 'L2 引擎输出 × id=' + s.id + ' kind=' + s.kind);
    // 解析级：从冻结的引擎输出反推期望（pattern 直接来自 source 串）
    const pr = mod.parseBaseRateL2(s.note);
    if (s.l2.source === 'baseRateNote:unparsed') assert.equal(pr, null, 'unparsed × id=' + s.id);
    else if (String(s.l2.source).indexOf('baseRateNote:') === 0) {
      assert.equal(pr.pattern, String(s.l2.source).split(':')[1], 'pattern × id=' + s.id);
      assert.equal(pr.n, s.l2.n, 'n × id=' + s.id);
      assert.equal(pr.k, s.l2.k, 'k × id=' + s.id);
    } else { assert.equal(pr, null, '无基率来源 ⇒ 无解析 × id=' + s.id); }
    // G2 读序与样本量（金样为逐字复制实现）
    assert.deepEqual(mod.parseBaseRateG2(s.note), s.g2.base, 'G2 读序 × id=' + s.id);
    assert.equal(mod.parseNoteN(s.note), s.g2.note_n, '样本量 × id=' + s.id);
    // L5 三态
    assert.deepEqual(mod.parseCertifiedFromNote(s.note), s.l5, 'L5 三态 × id=' + s.id);
  }
});

// ── ② 委托链（消费方与金样一致；旧导出面名字不动）──────────────────────────
test('委托链：l2_baseline.parseBaseRateNote / l5_sources.parseCertifiedFromNote 与共享模块逐条一致', () => {
  for (const s of golden.samples) {
    assert.deepEqual(parseBaseRateNote(s.note), mod.parseBaseRateL2(s.note), 'l2 委托 × id=' + s.id);
    assert.deepEqual(parseCertifiedFromNote(s.note), mod.parseCertifiedFromNote(s.note), 'l5 委托 × id=' + s.id);
    assert.deepEqual(parseBaseRateNote(s.note), s.l2.source === 'baseRateNote:unparsed' ? null : parseBaseRateNote(s.note), '哨兵');
    // 引擎级：准入线语义不变（n>=30 出数；否则如实不足）
    const out = l2Baseline({ baseRateNote: s.note });
    if (s.l2.ok) { assert.equal(out.ok, true, 'id=' + s.id); assert.equal(out.n, s.l2.n); }
    else assert.equal(out.ok, false, 'id=' + s.id);
  }
});

// ── ③ 结构化字段：校验 / 构造 / 读序 ────────────────────────────────────────
test('结构化字段：isStructured 拒收半截/越界；buildBaseRate 非法即抛（写端当场暴露）', () => {
  assert.equal(mod.isStructured(null), false);
  assert.equal(mod.isStructured({ n: 100 }), false, '缺 p ⇒ 非结构化');
  assert.equal(mod.isStructured({ p: 1.2, n: 10 }), false, 'p 越界');
  assert.equal(mod.isStructured({ p: 0.5, n: 10, k: 11 }), false, 'k>n');
  assert.equal(mod.isStructured({ p: 0.5, n: 0 }), false, 'n 非正');
  assert.equal(mod.isStructured({ p: 0.5, kind: 'x' }), false, 'kind 白名单');
  assert.equal(mod.isStructured({ p: 0.5, window: '2020' }), false, 'window 形态');
  assert.equal(mod.isStructured({ p: 0.5, n: 100, k: 50, kind: 'empirical' }), true);
  assert.equal(mod.isStructured({ p: 0.5, n: null, k: null }), true, 'n/k 可空（宁缺不编）');
  assert.throws(() => mod.buildBaseRate({ p: 2 }), /非法结构化基率/);
  const br = mod.buildBaseRate({ p: 0.45, n: 331, k: 149, kind: 'empirical', basis: 'DBnomics pre-cutoff' });
  assert.equal(br.schema, 'evidence.baseRate.v1');
  assert.equal(br.window, null, '未记录的窗口 ⇒ null（不编）');
});

test('结构化读序：结构化优先；非法结构化不采信、退文本兜底；二者皆无 ⇒ null', () => {
  const note = '历史占比：共 149/331（pre-cutoff 已发布口径）';
  const viaText = mod.readBaseRate({ baseRateNote: note });
  assert.equal(viaText.via, 'text');
  assert.equal(viaText.p, 0.450151);
  const viaStruct = mod.readBaseRate({ baseRateNote: note, baseRate: mod.buildBaseRate({ p: 0.3, n: 10, k: 3 }) });
  assert.equal(viaStruct.via, 'structured');
  assert.equal(viaStruct.p, 0.3, '结构化优先');
  const bad = mod.readBaseRate({ baseRateNote: note, baseRate: { p: 5, n: 10 } });
  assert.equal(bad.via, 'text', '非法结构化 ⇒ 不采信，退文本');
  assert.equal(mod.readBaseRate({}), null);
  assert.equal(mod.readBaseRate(null), null);
});

// ── ④ 物化不变式（零翻转由构造保证）────────────────────────────────────────
test('物化不变式：结构化 == 同注记的解析读数；且引擎读数（p/n/k/CI）文本与结构化逐字相同', () => {
  let empirical = 0, certified = 0, none = 0;
  for (const s of golden.samples) {
    const br = mod.baseRateFromNote(s.note);
    if (!br) { none++; continue; }
    if (br.kind === 'certified') {
      certified++;
      const t = mod.parseBaseRateL2(s.note);
      assert.equal(br.p, s.l5.p, '认证行 p == L5 三态 p × id=' + s.id);
      assert.deepEqual({ n: br.n, k: br.k }, { n: t ? t.n : null, k: t ? t.k : null },
        '认证行 n/k == 同注记 L2 读序（零翻转；n 为组合数分母，非样本量）× id=' + s.id);
    } else {
      const pr = mod.parseBaseRateL2(s.note);
      if (!pr) { assert.fail('L2 读序不可解析者不该物化 × id=' + s.id); }
      empirical++;
      assert.deepEqual({ p: br.p, n: br.n, k: br.k }, { p: pr.p, n: pr.n, k: pr.k }, '经验行物化 == L2 解析读数 × id=' + s.id);
    }
    // 引擎级零翻转：文本路径 vs 结构化路径（同一注记的物化值）
    const viaT = l2Baseline({ baseRateNote: s.note });
    const viaS = l2Baseline({ baseRate: br });
    assert.equal(viaS.ok, viaT.ok, 'ok × id=' + s.id);
    if (viaT.ok) assert.deepEqual({ p: viaS.p, n: viaS.n, k: viaS.k, ci: viaS.ci }, { p: viaT.p, n: viaT.n, k: viaT.k, ci: viaT.ci }, '引擎读数 × id=' + s.id);
  }
  assert.ok(empirical > 100 && certified > 0, '两个分支都被覆盖（empirical=' + empirical + ' certified=' + certified + '）');
  // 不可物化者：只能是「本身无可解析数字」的纯定性注记（如 OpenAlex 口径说明）——读端同样无读数、无翻转
  for (const s of golden.samples) {
    if (!mod.baseRateFromNote(s.note)) {
      assert.equal(mod.parseBaseRateL2(s.note), null, '不可物化 ⇒ 文本读序亦不可解析 × id=' + s.id);
      assert.equal(mod.parseBaseRateG2(s.note), null, '不可物化 ⇒ G2 读序亦不可解析 × id=' + s.id);
    }
  }
  assert.ok(none <= 2, '不可物化者应极少（实际 ' + none + '）');
});

test('attachBaseRate：加键不改既有键、幂等、非对象元素原样通过', () => {
  const entry = { resolve: { kind: 'x' }, baseRateNote: '占 45.0%（共 331 个月值）', slug: 's1' };
  const out = mod.attachBaseRate(entry);
  assert.deepEqual(Object.keys(out)[0], 'resolve');
  assert.deepEqual(out.resolve, entry.resolve);
  assert.equal(out.slug, 's1');
  assert.equal(out.baseRate.p, 0.45);
  assert.equal(out.baseRate.n, 331);
  assert.equal(entry.baseRate, undefined, '不改入参');
  assert.equal(mod.attachBaseRate(out), out, '已有结构化 ⇒ 原样（幂等）');
  assert.equal(mod.attachBaseRate(101), 101, '整数 id 证据原样');
  assert.equal(mod.attachBaseRate({ note: '无注记' }).baseRate, undefined, '无注记 ⇒ 不加键');
  assert.equal(mod.attachBaseRate({ baseRateNote: '无可解析数字' }).baseRate, undefined, '不可解析 ⇒ 不加键（读端走文本）');
});

// ── ⑤ 引擎接线 ─────────────────────────────────────────────────────────────
test('引擎接线：l2Baseline 吃结构化（source=baseRate:structured；n 缺失时如实不出数）；l3Aci 透传', () => {
  const br = mod.buildBaseRate({ p: 0.3, n: 100, k: 30 });
  const out = l2Baseline({ baseRate: br });
  assert.equal(out.ok, true);
  assert.equal(out.source, 'baseRate:structured');
  assert.equal(out.n, 100);
  assert.equal(out.k, 30);
  assert.ok(Array.isArray(out.ci) && out.ci.length === 2);
  const noN = l2Baseline({ baseRate: mod.buildBaseRate({ p: 0.3, n: null, k: null }) });
  assert.equal(noN.ok, false);
  assert.match(noN.note, /结构化 baseRate 未含样本量 n/, '结构化专有缺 n 语义（非文本口径）');
  const l3 = l3Aci({ baseRate: br, feedback: [] });
  assert.equal(l3.ok, true);
  assert.equal(l3.n, 100);
});

test('引擎接线：certifiedSourceForRow 结构化优先并把来源如实透出（note_source）', () => {
  const resolve = { kind: 'cwl_ssq_red_contains', ball: '07' };
  const textOnly = certifiedSourceForRow({ resolve: resolve, baseRateNote: '前瞻·L5 认证随机：基率=组合数理论值 0.1818（1-C(32,6)/C(33,6)=6/33，非历史拟合）' });
  assert.equal(textOnly.ok, true);
  assert.equal(textOnly.meta.note_source, 'text');
  assert.equal(textOnly.meta.note_consistent, true, '文本认证值 0.1818 == 注册表 6/33');
  const structured = certifiedSourceForRow({ resolve: resolve, baseRate: mod.buildBaseRate({ p: 0.1818, n: null, k: null, kind: 'certified' }) });
  assert.equal(structured.ok, true);
  assert.equal(structured.meta.note_source, 'structured');
  assert.equal(structured.meta.note_p, 0.1818);
  assert.equal(structured.meta.note_consistent, true);
  const mismatch = certifiedSourceForRow({ resolve: resolve, baseRate: mod.buildBaseRate({ p: 0.5, n: null, k: null, kind: 'certified' }) });
  assert.equal(mismatch.meta.note_consistent, false, '矛盾不静默（如实带出）');
});

// ── 存储写入口随行落库（store 级，与语料写手同一路径）──────────────────────
const tmpProviders = path.join(os.tmpdir(), 'p1b-test-brmod-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
test.before(async () => { app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders }); });
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

test('store 写入口：insertPrediction 随行落库结构化基率（新行走结构化；文本键逐字保留）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '批次3-基率局', type: 'werewolf', player_count: 6 } });
  const gid = r.json().game.id;
  const note = '前瞻·M.USD.EUR.SP00.A：pre-cutoff 已发布 331 个月值中 <1.15 占 45.0%（DBnomics 实抓）';
  const row = store.insertPrediction({
    gameId: gid, day: 0, sourceType: '预测卡', statement: '批次3：结构化随行落库', prob: 0.45, g2Regime: 'R4', maturesAt: '2026-12-01',
    layer: 'L2', engine: 'stat_baseline+wilson', gate: 'descriptive', checklistHash: 'v2', publicExposure: 0,
    evidence: [{ resolve: { kind: 'dbnomics_series_value' }, baseRateNote: note, meta: {} }],
  });
  const back = store.getPrediction(row.id);
  assert.equal(back.evidence[0].baseRateNote, note, '文本注记逐字保留');
  assert.equal(back.evidence[0].baseRate.p, 0.45);
  assert.equal(back.evidence[0].baseRate.n, 331);
  assert.equal(back.evidence[0].baseRate.k, 149);
  assert.equal(back.evidence[0].baseRate.kind, 'empirical');
  // 引擎读回：结构化与文本读数一致（零翻转）
  const viaS = l2Baseline({ baseRate: back.evidence[0].baseRate });
  const viaT = l2Baseline({ baseRateNote: back.evidence[0].baseRateNote });
  assert.deepEqual({ p: viaS.p, n: viaS.n, k: viaS.k }, { p: viaT.p, n: viaT.n, k: viaT.k });
});

// ── intake 形态判别（证据面：结构化 vs 旧「计数」别名）────────────────────
async function classify(payload) {
  const r = await app.inject({ method: 'POST', url: '/api/intake/classify', payload: payload });
  return { status: r.statusCode, body: r.json() };
}
const ckL2 = () => ({ Q0_1: true, Q0_2: true, Q0_3: true, L5: [false, false, false], L6: [false, false, false, false], L1: [false, false, false, false], L3: [false, false, false, false], L2: [true, true, true, true], L4: [false, false, false] });

test('intake：evidence.baseRate 结构化 ⇒ 送引擎（概率= k/n）；旧 {k,n} 计数别名零变化', async () => {
  const s = await classify({ statement: '批次3：结构化基率端到端', checklist: ckL2(),
    evidence: { baseRate: { p: 0.45, n: 331, k: 149, kind: 'empirical' }, baseRateNote: '占 45.0%（共 331 个月值）' } });
  assert.equal(s.status, 200);
  assert.equal(s.body.layer, 'L2');
  assert.equal(s.body.gate, 'scored');
  assert.ok(Math.abs(s.body.prob - 149 / 331) < 1e-6, 'prob=k/n（实际 ' + s.body.prob + '）');
  assert.ok(Array.isArray(s.body.prob_ci));
  const legacy = await classify({ statement: '批次3：旧计数别名零变化', checklist: ckL2(), evidence: { baseRate: { k: 30, n: 100 } } });
  assert.equal(legacy.body.gate, 'scored');
  assert.equal(legacy.body.prob, 0.3, '旧形态仍走 counts 路径');
  const noN = await classify({ statement: '批次3：结构化缺 n 如实不出数', checklist: ckL2(),
    evidence: { baseRate: { p: 0.45, n: null, k: null } } });
  assert.equal(noN.body.gate, 'descriptive', 'n 未知 ⇒ 不出数');
  assert.match(String(noN.body.engine_note || ''), /结构化 baseRate 未含样本量 n/, '结构化语义出现在 engine_note（证明走的是结构化路径）');
});
