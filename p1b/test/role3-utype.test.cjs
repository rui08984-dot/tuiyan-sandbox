'use strict';
/**
 * p1b/test/role3-utype.test.cjs —— U 型路径题回归锁（2026-09-21 · 四十批）
 *
 * 判据来源：设计题证据件 `docs/assets/p29/...证据件-20260920.md` §1.2（U 型 noisy-OR，规则冻结）
 *   ＋ 交接件 §1 首选下一棒 ①「U 型（noisy-OR）路径题出题（规则已冻结，路径型子命题现 0 条）」。
 *
 * 覆盖：
 *   ① ★局内前瞻锁：cutoff 必须是「发言已毕、投票未开」（防退回「已完结局补录」）
 *   ② ★零概率锁：prob 必须为 null（铁律④：本批只产结构，LLM 不出概率）
 *   ③ 路径枚举锁：每局路径数＝该局平民数（不重不漏）
 *   ④ ★合成器一致：combineNoisyOr 与手算逐位相同（用真实字段名 p_e_given_b）
 *   ⑤ 零账本写锁
 *   ⑥ ★gate 口径边界（如实记录，非失败）：局内事件无日期 ⇒ 日历口径下 unverifiable
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b/scripts/role3-utype.cjs');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const ROWS = path.join(ROOT, 'p1b/sim/out/role3-utype-20260921.rows.json');
const REP = path.join(ROOT, 'p1b/sim/out/role3-utype-20260921.json');

test('① ★局内前瞻锁：cutoff 须为「发言已毕、投票未开」', () => {
  assert.ok(/发言结束/.test(SRC), '须以『发言结束』事件为 cutoff 锚');
  assert.ok(/cutoff_seq/.test(SRC), '须记录 cutoff 的 seq');
  // 反向锁：不得退回「未结算父题」口径（首版即此，结果 0 条——sim 局全已结算）
  assert.ok(!/resolved_at IS NULL ORDER BY id/.test(SRC) || !/本局狼人阵营胜利' AND resolved_at IS NULL/.test(SRC),
    '★不得退回「查未结算父题」口径（sim 局全已结算 ⇒ 恒 0 条）');
  if (!fs.existsSync(ROWS)) return;
  const rows = JSON.parse(fs.readFileSync(ROWS, 'utf8'));
  assert.ok(rows.length > 0, '应有路径题');
  for (const r of rows) {
    assert.ok(r.meta.cutoff_seq !== undefined, '须记 cutoff_seq');
    assert.ok(r.meta.cutoff_event && /发言结束/.test(r.meta.cutoff_event), 'cutoff_event 须为『发言结束』');
  }
});

test('② ★零概率锁：prob 全为 null（铁律④）', () => {
  if (!fs.existsSync(ROWS)) return;
  const rows = JSON.parse(fs.readFileSync(ROWS, 'utf8'));
  const bad = rows.filter((r) => r.prob !== null);
  assert.deepEqual(bad.map((r) => r.slug), [], '★本批不得产出任何概率（LLM 只出结构）');
  for (const r of rows) assert.ok(/只产结构/.test(r.prob_source), 'prob_source 须说明为何为 null');
});

test('③ 路径枚举锁：每局路径数＝该局平民数', () => {
  if (!fs.existsSync(REP)) return;
  const rep = JSON.parse(fs.readFileSync(REP, 'utf8'));
  const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readOnly: true });
  let checked = 0;
  for (const p of rep.parents) {
    if (p.skipped) continue;
    const g = db.prepare('SELECT meta FROM games WHERE id = ?').get(p.game_id);
    const truth = JSON.parse(g.meta).truth || {};
    const nV = (truth.villagers || []).length;
    assert.equal(p.branches, nV, 'game ' + p.game_id + ' 路径数应＝平民数 ' + nV);
    checked++;
  }
  db.close();
  assert.ok(checked > 0, '应至少核过一局');
});

test('④ ★合成器一致：noisy-OR 与手算逐位相同', () => {
  const M = require(path.join(ROOT, 'p1b/scripts/role3-combiner.cjs'));
  const ps = [0.3, 0.2, 0.1, 0.15];
  const r = M.combineNoisyOr({ branches: ps.map((p) => ({ p_e_given_b: p })) });
  assert.equal(r.ok, true);
  const manual = 1 - ps.reduce((a, p) => a * (1 - p), 1);
  assert.ok(Math.abs(r.p - manual) < 1e-9, '合成值应等于手算：' + r.p + ' vs ' + manual);
  // 缺读数须如实拒绝（不猜）
  const miss = M.combineNoisyOr({ branches: [{ p_e_given_b: 0.3 }, { p_e_given_b: null }] });
  assert.equal(miss.ok, false);
  assert.equal(miss.status, 'missing_reading');
});

test('⑤ 零账本写锁', () => {
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const pat of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+predictions\b/i, /\bDELETE\s+FROM\b/i, /\bconn\.exec\(/]) {
    assert.ok(!pat.test(CODE), '不得含写库调用：' + pat);
  }
  assert.ok(/readOnly:\s*true/.test(SRC), 'DB 连接须 readOnly');
});

test('⑥ ★gate 口径边界（如实记录，非失败）', () => {
  // 局内事件无日期 ⇒ 日历口径的 winStart 推不出 ⇒ gate 判 leak_unverified
  // 本测试**断言这一事实**（防后人误以为「U 型题已过锚」）
  if (!fs.existsSync(ROWS)) return;
  const rows = JSON.parse(fs.readFileSync(ROWS, 'utf8'));
  for (const r of rows) {
    assert.equal(r.meta.eventDate, null, '★局内事件无日期（这是 gate 判 unverifiable 的根因，如实保留）');
  }
  // 脚本头注须记录这个边界（防后人误读）
  assert.ok(/gate 口径|局内前瞻|日期粒度|unverifiable/i.test(SRC) || /日历口径/.test(SRC),
    '头注须记录「局内口径与日历口径不同量纲」这一边界');
});

test('⑦ ★候选留痕旁路（--record-candidates）', () => {
  // 背景（2026-09-22）：交接件 §1 下一棒②「新产分支批次的候选留痕（--record-candidates 同款）」。
  //   承 corpus-sources-b4.cjs 同款实现（默认关 ⇒ 零行为变化）。
  const SRC2 = fs.readFileSync(SCRIPT, 'utf8');
  // ① 静态锁：须有旁路三件（路径解析／drops 数组／落盘分支）
  assert.ok(/--record-candidates=/.test(SRC2), '须支持 --record-candidates= 参数');
  assert.ok(/const DROPS = \[\]/.test(SRC2), '须有 DROPS 数组');
  assert.ok(/function recDrop/.test(SRC2), '须有 recDrop 函数');
  assert.ok(/if \(REC_PATH\) \{/.test(SRC2), '落盘须以 REC_PATH 为条件（默认关）');
  // ② ★默认关锁：不传参时不得建数组/写文件（recDrop 首行即 return）
  assert.ok(/function recDrop\(stage, reason, info\) \{ if \(!REC_PATH\) return;/.test(SRC2), '★recDrop 须在 !REC_PATH 时立即 return（默认关零行为变化）');
  // ③ 丢弃点覆盖：5 处父题级丢弃都应留痕
  const n = (SRC2.match(/recDrop\('parent'/g) || []).length;
  assert.equal(n, 5, '应有 5 处父题级 recDrop 调用（实测 ' + n + '）');
  // ④ 产物锁：若留痕件已生成，须含 counts 与严格口径说明
  const recPath = path.join(ROOT, 'docs/assets/p37/utype-candidates.json');
  if (fs.existsSync(recPath)) {
    const r = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    assert.ok(r.counts && typeof r.counts.proposed_total === 'number', '留痕件须含 counts.proposed_total');
    assert.equal(r.counts.proposed_total, r.counts.candidates + r.counts.drops, '提议全集＝候选＋被丢');
    assert.ok(/严格分母/.test(r.note), '须说明严格分母口径');
    // ★如实标注：本生成器的 drops 是父题级（非路径级）
    assert.ok(/父题级/.test(r.note), '★须如实标注 drops 是父题级');
  }
});
