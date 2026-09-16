import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, getTerm, REQUIRED_TERM_IDS } from './terms.ts';

test('16 类裸奔术语全部收录', () => {
  for (const id of REQUIRED_TERM_IDS) {
    assert.ok(TERMS[id], '缺术语 ' + id);
  }
  assert.equal(REQUIRED_TERM_IDS.length, 16);
});

// 2026-09-16 · P0-U1：贝叶斯记账语言 4 条（真源=10 号件 §4 O1-O8 四元组）
const BAYES_IDS = ['bayesPrior', 'likelihoodEvidence', 'posteriorAgg', 'calibrationAci'];
const BAYES_BASIS_PREFIX = /^(l2_baseline|verdicts|l6_structural|l3_aci)/;
const FORBIDDEN_CLAIM = /更准|提升|超越|准确率更|优于/;

test('U1：贝叶斯 4 条可 getTerm 命中且在 REQUIRED 内', () => {
  for (const id of BAYES_IDS) {
    assert.ok(REQUIRED_TERM_IDS.includes(id), 'REQUIRED 缺 ' + id);
    const t = getTerm(id);
    assert.ok(t, 'getTerm 未命中 ' + id);
    assert.equal(t.id, id);
  }
});

test('U1：每条贝叶斯术语 basis 以真实口径源开头（防写成空话）', () => {
  for (const id of BAYES_IDS) {
    const t = getTerm(id);
    assert.match(t.basis, BAYES_BASIS_PREFIX, id + ' basis 未指向口径源: ' + t.basis);
  }
});

test('U1：每条贝叶斯术语 definition 属口径/披露表述、不含精度宣称禁词', () => {
  for (const id of BAYES_IDS) {
    const t = getTerm(id);
    assert.match(t.definition, /口径|披露/, id + ' definition 未含口径/披露表述');
    assert.doesNotMatch(t.definition, FORBIDDEN_CLAIM, id + ' definition 含精度宣称禁词');
  }
});

test('每条术语字段完整且有定义', () => {
  for (const [id, t] of Object.entries(TERMS)) {
    assert.ok(t.term && t.term.length > 0, id + ' 缺 term');
    assert.ok(t.plain && t.plain.length > 0, id + ' 缺 plain');
    assert.ok(t.definition && t.definition.length > 10, id + ' definition 过短');
    assert.ok(t.basis && t.basis.length > 0, id + ' 缺 basis（口径字段路径）');
  }
});

test('getTerm 未知 id 返回 null 而非抛错', () => {
  assert.equal(getTerm('__nope__'), null);
});

test('术语 id 与 TERMS 键一致（防漂移）', () => {
  for (const [k, t] of Object.entries(TERMS)) {
    assert.equal(t.id, k, 'id 与键不一致: ' + k);
  }
});
