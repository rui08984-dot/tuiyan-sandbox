'use strict';
/**
 * stage5-forecast-pool.test.cjs —— 阶段 5 路线 (b) **冻结池的锁定测试**（2026-09-15 缺陷 D-B 修复）。
 *
 * 由来：首发实验把池谓词内联在**未入库的 `.tmp` 脚本**里，且抓取失败静默 `continue`
 *   ⇒ 分块失败时样本从 93 对静默截断到 72 对却仍被记为「确认达标」（留痕 §44）。
 * 本测试把池谓词与指纹**锁死**，使任何池漂移在跑前即暴露。
 *
 * 铁律：**零网络、零写库、零 LLM**（只读生产库）。
 * 若生产库合法增长（新 kind 入库/新结算），指纹会变 —— 此时**必须**由勘误件/新版本 PREREG 更新冻结锚，
 *   不得在本测试里静默放宽（断言信息已写明处置路径）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const P = require(path.join(ROOT, 'p1b/src/evidence/stage5Pool'));
const TB = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));
const DB = path.join(ROOT, 'p1a-terminal/data/p1a.db');

test('stage5Pool：冻结名册 105 条 == 冻结锚（指纹命中；名册禁改）', () => {
  // 冻结名册是**实验唯一合法跑批集合**（PREREG §6「不补样」）。
  // 断言名册自身：规模 105、指纹命中、id 唯一且升序。
  const roster = P.POOL_ROSTER_FROZEN;
  assert.equal(roster.length, P.POOL_N_AT_FREEZE, '名册规模 == 冻结锚 105');
  assert.equal(P.fingerprint(roster), P.POOL_FINGERPRINT_SHA256, '名册指纹 == 冻结锚（名册禁改，纳新须版本递进）');
  assert.equal(new Set(roster).size, roster.length, '名册 id 不得重复');
  assert.deepEqual(roster, [...roster].sort((a, b) => a - b), '名册须升序（指纹口径依赖顺序稳定）');
});

test('stage5Pool：名册仍全部落在活谓词内（池只增不减；新行走 unrostered 披露）', () => {
  // 2026-09-15 实测事件：到期例行结算使池 105→109（+4 条同 kind 当日到期题）。
  // 属**合法自然增长非漂移**（去掉新增后指纹仍命中锚）。本测试锁定两条纪律：
  //   ① 名册 105 条**必须仍是活谓词的子集**（若有行从谓词里消失＝严重，须查因）；
  //   ② 谓词选出的**名册外**行由 splitByRoster 归入 unrostered（仅披露、不入实验）。
  const db = new DatabaseSync(DB, { readOnly: true });
  const predicateRows = db.prepare(P.POOL_SQL()).all();
  db.close();
  const predicateIds = new Set(predicateRows.map((r) => r.id));
  const missingFromPredicate = P.POOL_ROSTER_FROZEN.filter((id) => !predicateIds.has(id));
  assert.deepEqual(missingFromPredicate, [], '名册内每一行都须仍被活谓词选中（池只增不减）');

  const { rostered, unrostered } = P.splitByRoster(predicateRows);
  assert.deepEqual(rostered.map((r) => r.id).sort((a, b) => a - b), [...P.POOL_ROSTER_FROZEN].sort((a, b) => a - b),
    'rostered == 名册（实验跑批集合被钉死）');
  // unrostered 允许非空（自然增长），但必须是真实存在的新行、且不在名册内
  for (const id of unrostered) assert.equal(P.POOL_ROSTER_FROZEN.includes(id), false, 'unrostered 不得含名册内 id');
  assert.equal(rostered.length + unrostered.length, predicateRows.length, '切分必须无遗漏');
});

test('stage5Pool：谓词第 7 条与 truthBasis 排除谓词同口径（SQL 集合一致）', () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  // 池的范围 ⊂ 「非缺陷」范围：池内任何一行都不得是真值口径缺陷行
  const pooled = db.prepare(P.POOL_SQL()).all();
  const defectIds = new Set(
    db.prepare("SELECT p.id FROM predictions p WHERE p.g2_regime='R4' AND p.layer='L3' "
      + "AND json_extract(p.evidence_json,'$[0].resolve.kind')='openmeteo_daily_max' "
      + 'AND NOT ' + TB.NOT_TRUTH_BASIS_DEFECT_SQL()).all().map((x) => x.id),
  );
  db.close();
  const overlap = pooled.filter((r) => defectIds.has(r.id)).map((r) => r.id);
  assert.deepEqual(overlap, [], '池内不得含真值口径缺陷行（第 7 条生效）');
});

test('stage5Pool：no_val 12 道 == 存档起点边界（2024-01-01/08/15 × 4 城），非数据缺失', () => {
  // 依据勘误件 §3：no_val 题应为 2024 年 1 月三周 × 4 城 = 12 道。
  // 口径＝**冻结名册内**（不是活谓词全量——活谓词会随自然增长多出当日到期的新题）。
  const db = new DatabaseSync(DB, { readOnly: true });
  const all = db.prepare(P.POOL_SQL()).all();
  db.close();
  const { rostered } = P.splitByRoster(all);
  const jan = rostered.filter((r) => /^2024-01-0[18]|^2024-01-15/.test(r.rdate));
  assert.equal(jan.length, P.NO_VAL_N_AT_FREEZE, '名册内 2024 年 1 月三周 × 4 城 == 12 道（previous-runs 存档起点边界）');
  const dates = [...new Set(jan.map((r) => r.rdate))].sort();
  assert.deepEqual(dates, ['2024-01-01', '2024-01-08', '2024-01-15'], '边界日期集合');
});

test('stage5Pool：纯函数——基率解析与软概率映射照 PREREG §4 写死', () => {
  // baseRate 结构化字段优先
  assert.equal(P.parseBaseRate({ br: JSON.stringify({ p: 0.444 }) }), 0.444);
  // 回退 baseRateNote「占 X%」
  assert.equal(P.parseBaseRate({ brn: '历史同期占 20%' }), 0.2);
  // 两者皆无 ⇒ null（该行计 no_base 披露，不得默认 0.5）
  assert.equal(P.parseBaseRate({}), null);
  // 软概率：±3∘覆盖 0→1；越界钳制 0.02/0.98
  assert.equal(P.softProb(30, 30, true), 0.5);
  assert.equal(P.softProb(33, 30, true), 0.98, 'fmax−thr=3 ⇒ 1.0 ⇒ 钳到 0.98');
  assert.equal(P.softProb(27, 30, true), 0.02, 'fmax−thr=−3 ⇒ 0.0 ⇒ 钳到 0.02');
  assert.equal(P.softProb(27, 30, false), 0.98, 'cmp=< 时方向取反');
});
