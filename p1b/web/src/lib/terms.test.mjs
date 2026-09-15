import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, getTerm, REQUIRED_TERM_IDS } from './terms.ts';

test('12 类裸奔术语全部收录', () => {
  for (const id of REQUIRED_TERM_IDS) {
    assert.ok(TERMS[id], '缺术语 ' + id);
  }
  assert.equal(REQUIRED_TERM_IDS.length, 12);
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
