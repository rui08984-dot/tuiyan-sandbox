'use strict';
/**
 * p1b/test/calendar-questions.test.cjs —— I1 日历出题器回归锁（2026-09-21 · 三十九批）
 *
 * 背景：I1「日历即题源」第二步＝生成器＋候选留痕＋anchor-gate（判据：过锚率 ≥80%）。
 *   本批首跑过锚率 **100%（6/6）**。过程中口径被逼出三次修正（全记录在脚本头注），
 *   本测试把**最终口径**锁死，防止回退。
 *
 * 覆盖：
 *   ① ★零泄漏锁：目标期首日必须**严格晚于** cutoff（v3 口径；v1/v2 都被 gate 判 leak）
 *   ② 日历锁：发布日 = 月末 + lagDays（31 天，来源＝收据 §6 ESMS 原文）
 *   ③ ★字段名锁：prob 必须存在且有限（Q0-3 用）；meta.cutoff 必须存在（Q0-2 抽它）
 *   ④ ★历史值来源锁：阈值来自 resolve_note 解析（不是 base/baseRate/threshold）
 *   ⑤ 零写库锁：脚本不得含写库调用
 *   ⑥ ★活库前提条件式：IT 无历史 ⇒ 跳过而非编造（状态断言）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b/scripts/calendar-questions.cjs');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

test('① ★零泄漏锁：目标期首日严格晚于 cutoff', () => {
  // 直接跑生成器逻辑的核心函数（从源码抽取判定：期首日 > today）
  assert.ok(/if \(first > today\)/.test(SRC), '★必须存在「期首日 > today」判据（v3 口径）');
  // 反向锁：不得回退到 v1（pub > today 就返回）或 v2（monthEnd < today）
  assert.ok(!/if \(pub > today\) return/.test(SRC), '不得回退 v1 口径（只判发布日）');
  assert.ok(!/if \(monthEnd < today && pub > today\)/.test(SRC), '不得回退 v2 口径（期已结束）');
  // 读产物实测：每条候选的期首日 > cutoff
  const rowsPath = path.join(ROOT, 'p1b/sim/out/calendar-questions-20260921.rows.json');
  if (fs.existsSync(rowsPath)) {
    const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
    for (const r of rows) {
      const first = r.resolve.month + '-01';
      const cutoff = String(r.meta.cutoff).slice(0, 10);
      assert.ok(first > cutoff, '★' + r.resolve.geo + ' ' + r.resolve.month + ' 期首日 ' + first + ' 必须晚于 cutoff ' + cutoff);
    }
  }
});

test('② 日历锁：发布日 = 月末 + lagDays(31)', () => {
  assert.ok(/lagDays:\s*31/.test(SRC), 'eurostat 失业率滞后应＝31 天（收据 §6.1 ESMS 原文）');
  const rowsPath = path.join(ROOT, 'p1b/sim/out/calendar-questions-20260921.rows.json');
  if (!fs.existsSync(rowsPath)) return;
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
  for (const r of rows) {
    const mm = r.resolve.month;
    const y = Number(mm.slice(0, 4)), mo = Number(mm.slice(5, 7));
    const monthEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const expect = new Date(new Date(monthEnd + 'T12:00:00Z').getTime() + 31 * 86400000).toISOString().slice(0, 10);
    assert.equal(r.calendar.publish_date, expect, r.resolve.geo + ' 发布日应＝月末+31 天');
  }
});

test('③ ★字段名锁：prob 有限 ∧ meta.cutoff 存在（gate 的两个抽取点）', () => {
  const rowsPath = path.join(ROOT, 'p1b/sim/out/calendar-questions-20260921.rows.json');
  if (!fs.existsSync(rowsPath)) return;
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
  assert.ok(rows.length > 0, '应有候选');
  for (const r of rows) {
    assert.ok(isFinite(Number(r.prob)), r.statement.slice(0, 30) + ' 的 prob 须有限（Q0-3 判据读它）');
    assert.ok(r.prob > 0 && r.prob < 1, 'prob 不得为 0/1（否则判 tautology）');
    assert.ok(r.meta && r.meta.cutoff, 'meta.cutoff 必须存在（Q0-2 抽它）');
    assert.ok(r.meta.eventDate, 'meta.eventDate 须存在（窗口起点回退用）');
  }
});

test('④ ★历史值来源锁：解析 resolve_note（不是 base/baseRate/threshold）', () => {
  // ★代码区（剥掉注释后再查，避免把「记录教训的注释」误判成「使用错误字段」）
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/function parseObserved/.test(SRC), '须有 resolve_note 解析函数');
  assert.ok(/\[A-Z\]\{2\}/.test(SRC), '解析正则须含 geo 结构');
  // ★反向锁（只看代码区）：不得使用 baseRate 当指标值（结构化概率对象，量纲错——三十九批第三次修正的教训）
  assert.ok(!/ev\.baseRate/.test(CODE), '★代码不得用 baseRate 当指标值（结构化概率对象，非指标值）');
  assert.ok(!/histThresholds/.test(CODE), '★代码不得回退「拿阈值当历史样本」口径（自我循环）');
  // 头注须记录三次修正（防后人再踩）
  assert.ok(/设计修正史/.test(SRC) && /① `ev\.base`/.test(SRC), '头注须保留三次修正记录');
});

test('⑤ 零写库锁：脚本不得含写库调用', () => {
  // ★只看代码区（剥注释）；且用**精确**模式——正则的 `.exec(` 不是 DB exec（首版误判过一次）
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const pat of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+predictions\b/i, /\bDELETE\s+FROM\b/i, /\bconn\.exec\(/, /\bconn\.run\(/]) {
    assert.ok(!pat.test(CODE), '不得含写库调用：' + pat);
  }
  assert.ok(/readOnly:\s*true/.test(SRC), 'DB 连接须 readOnly');
  assert.ok(/零账本写/.test(SRC), '头注须声明零账本写');
});

test('⑥ 活库前提条件式：无历史 geo 如实跳过（不编）', () => {
  assert.ok(/obs\.length < 3/.test(SRC), '历史不足 3 期须跳过');
  const repPath = path.join(ROOT, 'p1b/sim/out/calendar-questions-20260921.json');
  if (!fs.existsSync(repPath)) return;
  const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
  const skipped = rep.sources[0].geos.filter((g) => g.skipped);
  for (const g of skipped) {
    assert.equal(g.rows, 0, g.geo + ' 被跳过的 geo 不应产出候选');
    assert.ok(/不编/.test(g.skipped), '跳过理由须如实（含「不编」）');
  }
  // 状态断言：IT 当前无历史 ⇒ 应在跳过列表（若将来有历史，此断言自动失效不误报）
  const it = rep.sources[0].geos.find((g) => g.geo === 'IT');
  if (it && it.hist_n === 0) assert.ok(it.skipped, 'IT 历史 0 期时须标 skipped');
});

test('⑦ ★候选留痕旁路（--record-candidates）＋ 严格口径', () => {
  // 背景（2026-09-22）：交接件 §1 新首选棒②「I1 出题器的 --record-candidates（同理补齐）」。
  //   承 corpus-sources-b4.cjs / role3-utype.cjs 同款实现（默认关 ⇒ 零行为变化）。
  assert.ok(/--record-candidates=/.test(SRC), '须支持 --record-candidates= 参数');
  assert.ok(/const DROPS = \[\]/.test(SRC), '须有 DROPS 数组');
  assert.ok(/function recDrop/.test(SRC), '须有 recDrop 函数');
  // ★默认关锁
  assert.ok(/function recDrop\(stage, reason, info\) \{ if \(!REC_PATH\) return;/.test(SRC), '★recDrop 须在 !REC_PATH 时立即 return');
  // 丢弃点：3 处（源级／geo 级／分位级）
  const n = (SRC.match(/recDrop\(/g) || []).length - 1;
  assert.equal(n, 3, '应有 3 处 recDrop 调用（实测 ' + n + '）');
  // ★产物锁：含 counts 与「源/geo 级」如实标注
  const recPath = path.join(ROOT, 'docs/assets/p37/i1-candidates.json');
  if (fs.existsSync(recPath)) {
    const r = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    assert.equal(r.counts.proposed_total, r.counts.candidates + r.counts.drops, '提议全集＝候选＋被丢');
    assert.ok(/源\/geo 级/.test(r.note), '★须如实标注 drops 是源/geo 级（非逐题级）');
    // ★严格口径读数须如实（<100% 也要记）
    assert.ok(r.counts.drops >= 1, '当前应有 ≥1 条被丢（IT 历史不足）⇒ 严格口径 < 100%');
  }
});
