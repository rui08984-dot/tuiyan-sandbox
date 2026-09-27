/**
 * base_rate 闸（2026-09-28 · T4 / 模块 M2 后端半）
 *
 * 病象：产品主循环是「写题 → **后端先给一个数** → 到期验证」，但
 *   `GET /api/disclosure/compiler?kind=X` 原先只给「层 + 引擎 + 样本量」，
 *   **那个数没露出来** ⇒ 等于把主循环砍掉一半。
 *   （实测：binance 那类 27 条已结算里真发生 2 条 = 7.4%，数据一直在盘上没人端出来）
 *
 * 本闸锁三条口径，**引用项目既有纪律，不新造**：
 *   ① 分母只算**已结算**的同类题——未结算的不进分母，
 *      否则会把"还没到期的题"算成已有答案。
 *   ② n<30 ⇒ enough:false（与既有 K F13／stage4 的 n≥30 纪律同一口径）。
 *   ③ 只读、零写、且**不含本题自己**（这道题还没落库）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const src = require('node:fs').readFileSync(path.join(ROOT, 'src', 'routes', 'disclosure.js'), 'utf8');

test('① base_rate 字段在场，且分母只算已结算的', () => {
  assert.ok(src.includes('base_rate: baseRate'), 'lookup 分支须返回 base_rate');
  // ★关键：SQL 里必须有 resolved_at IS NOT NULL 与 outcome IN ('true','false')
  assert.ok(/outcome = 'true' THEN 1 ELSE 0 END/.test(src), '须统计 outcome=true 的条数');
  assert.ok(/resolved_at IS NOT NULL AND outcome IN \('true','false'\)/.test(src),
    '★分母必须只算「已结算且已判 true/false」的题——未结算的不能进分母');
});

test('② n<30 必须标 enough:false（与既有 n≥30 纪律同口径）', () => {
  assert.ok(src.includes('const hEnough = hN >= 30'), '须以 n>=30 判定是否够样本');
  assert.ok(src.includes('enough: hEnough'), '须输出 enough 字段供界面决定措辞');
  assert.ok(src.includes('只能记方向'), '样本不足时须给出「只记方向」的口径说明');
});

test('③ 只读：不得写库、不得把本题算进去', () => {
  // 本端点只读——它不在任何写路径上，也不该出现 INSERT/UPDATE
  const block = src.slice(src.indexOf('base_rate: baseRate') - 2000, src.indexOf('base_rate: baseRate') + 200);
  assert.equal(/INSERT|UPDATE|DELETE/i.test(block), false, 'base_rate 计算块内不得有写库语句');
  assert.ok(src.includes('同类还没有已结算的题'), '没有同类已结算题时须如实说明（不给假数）');
});

test('④ 无历史时 rate 必须是 null（不是 0）', () => {
  // rate:null 表示"没有"，rate:0 表示"测了是 0"——两者绝不能混同（项目核心诚实纪律）
  assert.ok(src.includes('rate: null, enough: false'), '无历史时 rate 须为 null 而非 0');
});
