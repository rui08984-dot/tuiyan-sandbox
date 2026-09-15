import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('./AuditPage.tsx', import.meta.url), 'utf8');

test('审计页已接入 Term 组件', () => {
  assert.ok(/import\s*\{[^}]*\bTerm\b[^}]*\}\s*from\s*'\.\.\/\.\.\/components\/ui'/s.test(src), '未导入 Term');
  assert.ok(src.includes('<Term'), '未使用 <Term');
});

test('关键术语已接入（裸奔清零）', () => {
  for (const id of ['brier', 'baseRate', 'cutoff', 'r4', 'g2Regime', 'layer', 'resolver', 'wilson']) {
    assert.ok(src.includes("id=\"" + id + "\""), '未接入术语 ' + id);
  }
});

test('人话与专业词并存（未删术语）', () => {
  assert.ok(src.includes('基率'), '基率被删');
  assert.ok(src.includes('校准'), '校准被删');
  assert.ok(src.includes('样本不足'), '不确定性文案被删');
});

test('不确定性文案保留且未隐藏', () => {
  assert.ok(src.includes('n&lt;30') || src.includes('n<30'), 'n<30 文案丢失');
});

test('表头与 KV 键均已包 Term（第一屏可见处）', () => {
  assert.ok(/<th><Term id="layer"/.test(src), '表头「层」未包 Term');
  assert.ok(/<th><Term id="brier"/.test(src), '表头「校准参考」未包 Term');
});
