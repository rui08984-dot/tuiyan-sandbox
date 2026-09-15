'use strict';
/**
 * stage5-retrieval.test.cjs —— 阶段 5 开工前置 ④（工程验证）：固定聚合规则 ＋ sham 臂构造器 ＋ 泄漏探针。
 * 铁律：零网络、零 LLM、零写库；只验**工程**（形状/确定性/边界/探针分辨力），**不看任何分数**。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const agg = require(path.join(ROOT, 'p1b/src/retrieval/aggregate'));
const sham = require(path.join(ROOT, 'p1b/src/retrieval/sham'));

test('aggregate：固定规则（strength 加权 for vs against）+ 中性不计 + 兜底 0.5 + 越界钳制', () => {
  // 2 for (0.8, 0.4) vs 1 against (0.6) → 1.2/(1.2+0.6)=0.666667
  const r1 = agg.aggregateEvidence([{ direction: 'for', strength: 0.8 }, { direction: 'for', strength: 0.4 }, { direction: 'against', strength: 0.6 }, { direction: 'neutral', strength: 1 }]);
  assert.equal(r1.p, 0.666667);
  assert.deepEqual([r1.n_for, r1.n_against, r1.n_neutral], [2, 1, 1], '方向计数');
  assert.equal(r1.fallback, false);
  // 纯 neutral ⇒ 兜底 0.5
  const r2 = agg.aggregateEvidence([{ direction: 'neutral', strength: 0.9 }]);
  assert.equal(r2.p, 0.5); assert.equal(r2.fallback, true);
  // 空/无 for/against ⇒ 兜底
  assert.equal(agg.aggregateEvidence([]).p, 0.5);
  assert.equal(agg.aggregateEvidence(null).p, 0.5);
  // 越界钳制：strength=5 → 1；-3 → 0；非数值 → 0
  const r3 = agg.aggregateEvidence([{ direction: 'for', strength: 5 }, { direction: 'against', strength: -3 }, { direction: 'for', strength: 'x' }]);
  assert.equal(r3.strength_for, 1, '5 钳到 1，非数值 0');
  assert.equal(r3.strength_against, 0);
  assert.equal(r3.p, 1);
  // 非法 direction ⇒ 丢弃（不计入任何桶）
  const r4 = agg.aggregateEvidence([{ direction: 'bogus', strength: 1 }, { direction: 'for', strength: 1 }]);
  assert.equal(r4.n_rows, 1, '非法方向被丢弃');
  // 确定性：同输入同输出
  const a = agg.aggregateEvidence([{ direction: 'for', strength: 0.3 }, { direction: 'against', strength: 0.7 }]);
  const b = agg.aggregateEvidence([{ direction: 'for', strength: 0.3 }, { direction: 'against', strength: 0.7 }]);
  assert.deepEqual(a, b, '纯函数确定性');
});

test('sham：同形输出 + 确定性（同 seed 同结果）+ 长度 ±5% 预算', () => {
  const real = [
    { url: 'https://a.example/1', published_at: '2026-09-01', event_at: '2026-09-02', quote: '上海 9 月历史均值统计：35 度以上极少见', direction: 'against', strength: 0.7 },
    { url: 'https://b.example/2', published_at: '2026-09-01', event_at: '2026-09-03', quote: '昨夜起报显示冷空气南下', direction: 'for', strength: 0.4 },
  ];
  const s1 = sham.makeShamEvidence(real, { ratio: 1.0, seed: 7 });
  const s2 = sham.makeShamEvidence(real, { ratio: 1.0, seed: 7 });
  assert.deepEqual(s1, s2, '同 seed 确定性（无 Math.random/Date）');
  assert.equal(s1.rows.length, real.length, '同形：行数一致');
  const shapeReal = Object.keys(real[0]).sort().join(',');
  const shapeSham = Object.keys(s1.rows[0]).sort().join(',');
  assert.equal(shapeSham, shapeReal, '同形：字段集一致');
  assert.ok(['neutral'].every((d) => s1.rows.every((r) => r.direction === d)), 'sham 行方向为 neutral（无关值）');
  // 预算：±5%
  assert.ok(Math.abs(s1.budget.delta_pct) <= 5.0001, '长度偏差在 ±5% 内（实测 ' + s1.budget.delta_pct + '%）');
  // 不同 seed ⇒ 不同取样（但仍同长）
  const s3 = sham.makeShamEvidence(real, { ratio: 1.0, seed: 8 });
  assert.notEqual(s3.rows[0].quote, s1.rows[0].quote, '不同 seed 取样不同');
  assert.equal(s3.budget.got_len, s1.budget.got_len, '长度约束与 seed 无关');
  // 聚合 sham 行 ⇒ 必然兜底 0.5（真实验时由 LLM 重抽，这里只验工程）
  assert.equal(agg.aggregateEvidence(s1.rows).p, 0.5);
});

test('泄漏探针：三层全 PASS 且泄漏率 = 0（工程验证，不看分数）', () => {
  const outPath = path.join(os.tmpdir(), 'p1b-leakprobe-' + process.pid + '-' + Date.now() + '.json');
  execFileSync(process.execPath, [path.join(ROOT, 'p1b/scripts/stage5-leak-probe.cjs'), '--out', outPath], { encoding: 'utf8' });
  const j = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(j.leak_count, 0, '泄漏率 = 0');
  assert.equal(j.verdict, 'PASS');
  assert.ok(j.layers.L1_sql.assertions.every((a) => a.pass), '层① SQL 断言全过');
  assert.equal(j.layers.L2_source_scan.hits, 0, '层② 源码字面命中 = 0');
  assert.ok(j.layers.L3_content_time.discriminates, '层③ canary 探针有分辨力');
});
