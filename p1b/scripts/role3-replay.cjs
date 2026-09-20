'use strict';
/*
 * p1b/scripts/role3-replay.cjs —— 角色③「分支合成 vs 父题直接判词」重放（2026-09-20）
 *
 * 依据：PREREG-角色③情景分支合成器-v1-20260920.md（sha 44acb872…）§2 判读面／§4 判据／§5 开跑令闸
 *   ＋ v1.1 勘误（C3 口径对齐蓝图原文「不劣于各分支」；v1 §4 文本「vs 直接」降并列披露）。
 *
 * 判读面（PREREG §2）：sim 域 **N 型合取族**——
 *   T9 族：父=「被放逐者是狼人且最高票唯一」  子= T9a「被放逐者是狼人」＋ T9b「最高票唯一」
 *   T10 族：父=「第一条发言者未被放逐且投票无弃票」 子= T6「第一条发言者未被放逐」＋ T4「投票无弃票」
 *   6 题面 × 30 场 ＝ 180 题；父题 60 个判读单元。
 *   ★D 型（1X2 互斥划分）**不进判读**（Σ 子题 p ≡ 父题分布 ⇒ Δ≡0 构造性恒等，设计题 §1.1）；
 *     U 型（noisy-OR）规则冻结、判读留待实现期（路径型子命题现为 0 条）。
 *
 * 读数来源（PREREG §3）：**只读现役 L6 结构聚合**（l6Structural 固定规则；实验批前缀排除照登记表）；
 *   判词批固定 run_id＝`ca1b5cdbddfc`（R-B 基线批，与真值批同域同 cutoff）。**不新跑 LLM、零账本写**。
 *
 * 判据（PREREG §4 ＋ v1.1 勘误，数字写死）：
 *   C1 非劣：Δ＝Brier(合成)−Brier(直接) 配对 bootstrap(B=1000,seed=987654321) 95%CI 上界 ≤ +0.005
 *   C2 方向：CI 上界 < 0 ⇒ 合成显著更好（只披露，不设承诺）
 *   C3 校准传播（**双口径并列披露**）：
 *     ① 蓝图原文口径（v1.1 主口径）：合成 REL ≤ **各分支** REL ⇒ 不劣化
 *     ② v1 §4 文本口径（并列披露）：合成 REL ≤ **直接** REL ⇒ 不劣化
 *   功效义务：σ̂_d 与 MDE ≈ 2.8·σ̂_d/√n **必须与 Δ/CI 同报**
 *   金样：退化输入（P(A)=直接读数、P(B)=1）⇒ 恒等（Δ≡0、σ̂_d=0、CI=[0,0]）
 *   6C 披露：结构分量（合取分解：分支 {A,¬A}，条件独立近似）——只披露不判生死（喂 O6 用）
 *
 * ★开跑令闸（PREREG §5）：无 `--arms` ⇒ **exit 3 零写盘**；有则先核**两件**冻结 sha，任一不符 ⇒ exit 3。
 *
 * 用法：
 *   node p1b/scripts/role3-replay.cjs                          # 闸检 + 摘要（exit 3）
 *   node p1b/scripts/role3-replay.cjs --arms [--json <p>] [--text <p>]   # 真跑并落盘
 *   node p1b/scripts/role3-replay.cjs --arms --selftest         # 金样自检（不读库）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const eq = process.argv.find((a) => a.startsWith('--' + n + '=')); if (eq) return eq.split('=').slice(1).join('='); const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const DATE_STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const JSON_OUT = arg('json', path.join(OUT_DIR, 'role3-replay-' + DATE_STAMP + '.json'));
const TEXT_OUT = arg('text', path.join(OUT_DIR, 'role3-replay-' + DATE_STAMP + '.md'));
const ARMS = FLAG('arms');
const SELFTEST = FLAG('selftest');

const PREREG = path.join(ROOT, '.scratch', 'forecast-debate', 'PREREG-角色③情景分支合成器-v1-20260920.md');
const PREREG_V11 = path.join(ROOT, '.scratch', 'forecast-debate', 'PREREG-角色③情景分支合成器-v1.1-勘误-20260920.md');
const RUN_ID = 'ca1b5cdbddfc';           // PREREG §3 冻结的判词批
const B = 1000, SEED = 987654321;        // PREREG §4 冻结的 bootstrap 参数
const NONINF_MARGIN = 0.005;             // C1 上界

const { l6Structural } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l6_structural.js'));
const C = require('./role3-combiner.cjs');

// ── 判读面定义（PREREG §2；SQL 逐族写死，禁泛化猜测）──
const FAMILIES = [
  { id: 'T9', parent: "statement LIKE '%] 本局被放逐者是狼人，且其最高票唯一%'", children: ['T9a', 'T9b'] },
  { id: 'T10', parent: "statement LIKE '%] 本局第一条公开发言的玩家未被放逐，且投票无弃票%'", children: ['T6', 'T4'] },
];
const CHILD_SQL = {
  T9a: "statement LIKE '%] 本局被放逐者是狼人' AND statement NOT LIKE '%且%'",
  T9b: "statement LIKE '%] 本局放逐计票最高票唯一%'",
  T6: "statement LIKE '%] 本局第一条公开发言的玩家未被放逐' AND statement NOT LIKE '%且%'",
  T4: "statement LIKE '%] 本局放逐投票无弃票%'",
};

/** 读一题面的（id, game_id, outcome）；按 game_id 建索引供族内配对。 */
function loadGroup(db, sql) {
  const rows = db.prepare('SELECT id, game_id, outcome, resolved_at FROM predictions WHERE ' + sql + ' ORDER BY game_id').all();
  const m = {};
  for (const r of rows) m[r.game_id] = r;
  return m;
}

/** 单题读数＝现役 L6 结构聚合（读 verdicts 时必须选出 run_id——接线锁要求）。 */
function readingOf(db, pid) {
  const vs = db.prepare("SELECT id, prompt_variant, implied_prob, run_id FROM verdicts WHERE prediction_id = ? AND run_id = ?").all(pid, RUN_ID);
  const o = l6Structural({ verdicts: vs });
  return { ok: o.ok, p: o.ok ? o.p : null, n_variants: o.n_variants, verdict_rows: o.verdict_rows, note: o.note };
}

function buildUnits(db) {
  const units = [];
  for (const fam of FAMILIES) {
    const par = loadGroup(db, fam.parent);
    const ch = {};
    for (const cid of fam.children) ch[cid] = loadGroup(db, CHILD_SQL[cid]);
    const games = Object.keys(par).map(Number).sort((a, b) => a - b);
    for (const gid of games) {
      const pRow = par[gid];
      const aRow = ch[fam.children[0]][gid], bRow = ch[fam.children[1]][gid];
      const u = { family: fam.id, game_id: gid, parent_id: pRow.id,
        child_ids: [aRow ? aRow.id : null, bRow ? bRow.id : null],
        y: pRow.outcome === 'true' ? 1 : (pRow.outcome === 'false' ? 0 : null),
        outcome_raw: pRow.outcome, direct: null, synth: null, missing: null };
      if (!aRow || !bRow) { u.missing = 'child_row_missing'; units.push(u); continue; }
      u.ya = aRow.outcome === 'true' ? 1 : (aRow.outcome === 'false' ? 0 : null);
      u.yb = bRow.outcome === 'true' ? 1 : (bRow.outcome === 'false' ? 0 : null);
      const ra = readingOf(db, aRow.id), rb = readingOf(db, bRow.id), rd = readingOf(db, pRow.id);
      u.direct = rd.ok ? rd.p : null;
      const comb = C.combineConjunction({ pa: ra.p, pb: rb.p });
      u.synth = comb.ok ? comb.p : null;
      u.readings = { pa: ra.p, pb: rb.p, direct: rd.p, pa_ok: ra.ok, pb_ok: rb.ok, direct_ok: rd.ok };
      // 6C 结构分量（合取分解：分支 {A,¬A}，条件独立近似）——披露项
      u.structural_6c = (ra.p !== null && rb.p !== null) ? Number((ra.p * (1 - ra.p) * rb.p * rb.p).toFixed(6)) : null;
      if (!rd.ok) u.missing = 'direct_reading_missing';
      else if (!comb.ok) u.missing = 'child_reading_missing';
      units.push(u);
    }
  }
  return units;
}

function metricsOf(units) {
  const usable = units.filter((u) => u.missing === null && u.y !== null && u.direct !== null && u.synth !== null);
  const d = usable.map((u) => C.brier(u.synth, u.y) - C.brier(u.direct, u.y));
  const st = C.diffStats(d);
  const ci = C.bootCI(d, B, SEED);
  const relSynth = C.murphyRel(usable.map((u) => u.synth), usable.map((u) => u.y));
  const relDirect = C.murphyRel(usable.map((u) => u.direct), usable.map((u) => u.y));
  // 各分支 REL（对各自真值）——v1.1 主口径用
  const withAB = usable.filter((u) => u.ya !== null && u.yb !== null && u.readings.pa !== null && u.readings.pb !== null);
  const relA = withAB.length ? C.murphyRel(withAB.map((u) => u.readings.pa), withAB.map((u) => u.ya)) : null;
  const relB = withAB.length ? C.murphyRel(withAB.map((u) => u.readings.pb), withAB.map((u) => u.yb)) : null;
  // REL 差的 bootstrap CI（合成−各分支／合成−直接）——「含 0」歧义并列披露
  const relDiffCI = (sub, which) => {
    const rs = C.murphyRel(sub.map((u) => u.synth), sub.map((u) => u.y));
    const ro = which === 'direct' ? C.murphyRel(sub.map((u) => u.direct), sub.map((u) => u.y))
      : which === 'a' ? C.murphyRel(sub.map((u) => u.readings.pa), sub.map((u) => u.ya))
        : C.murphyRel(sub.map((u) => u.readings.pb), sub.map((u) => u.yb));
    return (rs === null || ro === null) ? null : rs - ro;
  };
  const relDiff = {};
  for (const which of ['a', 'b', 'direct']) {
    const src = which === 'direct' ? usable : withAB;
    if (!src.length) { relDiff[which] = null; continue; }
    const r = C.bootCIRaw(src, (sub) => relDiffCI(sub, which), B, SEED);
    relDiff[which] = r ? { lb: r.lo, ub: r.hi, point: relDiffCI(src, which) } : null;
  }
  const c1 = ci.ub !== null && ci.ub <= NONINF_MARGIN;
  const c2 = ci.ub !== null && ci.ub < 0;
  const c3Branches = (relSynth !== null && relA !== null && relB !== null) && relSynth <= relA && relSynth <= relB;
  const c3Direct = (relSynth !== null && relDirect !== null) && relSynth <= relDirect;
  return { n: usable.length, n_missing: units.length - usable.length, delta: st.mean, sd_d: st.sd, mde: st.mde,
    ci: { lb: ci.lb, ub: ci.ub }, rel_synth: relSynth, rel_direct: relDirect, rel_a: relA, rel_b: relB,
    rel_diff_ci: relDiff,
    C1_noninf: c1, C2_better: c2,
    C3_blueprint_branches: c3Branches, C3_v1_text_direct: c3Direct,
    structural_6c_mean: usable.length ? usable.reduce((s, u) => s + (u.structural_6c || 0), 0) / usable.length : null,
    brier_synth: usable.length ? usable.reduce((s, u) => s + C.brier(u.synth, u.y), 0) / usable.length : null,
    brier_direct: usable.length ? usable.reduce((s, u) => s + C.brier(u.direct, u.y), 0) / usable.length : null,
    all_pass: (c1 && c3Branches),
  };
}

function fmt(v) { return (v === null || v === undefined) ? 'n/a' : Number(v).toFixed(6); }

function selftest() {
  // 金样：退化输入（P(A)=直接读数、P(B)=1）⇒ 合成 ≡ 直接 ⇒ Δ≡0、σ̂_d=0、CI=[0,0]
  const ys = [1, 0, 1, 1, 0], ps = [0.7, 0.3, 0.6, 0.8, 0.2];
  const synth = ps.map((p) => C.combineConjunction({ pa: p, pb: 1 }).p);
  const d = ps.map((p, i) => C.brier(synth[i], ys[i]) - C.brier(p, ys[i]));
  const st = C.diffStats(d), ci = C.bootCI(d, B, SEED);
  const ok = d.every((x) => x === 0) && st.mean === 0 && st.sd === 0 && ci.lb === 0 && ci.ub === 0;
  // 边界：缺读数 ⇒ ok:false（不编）——★金样曾抓到的实现 bug：Number(null)===0 静默当 0
  const miss = C.combineConjunction({ pa: null, pb: 0.5 });
  const missU = C.combineConjunction({ pa: undefined, pb: 0.5 });
  // noisy-OR 正例：1−(1−0.5)(1−0.5)=0.75
  const no = C.combineNoisyOr({ branches: [{ p_e_given_b: 0.5 }, { p_e_given_b: 0.5 }] });
  // 全方差：两分支等权、读数 0.2/0.8 ⇒ 结构分量＝0.09
  const vd = C.varianceDecomp({ branches: [{ p_b: 0.5, p_e_given_b: 0.2 }, { p_b: 0.5, p_e_given_b: 0.8 }] });
  const checks = {
    identity: ok, identity_d: d, identity_mean: st.mean, identity_sd: st.sd, identity_ci: ci,
    missing_false: miss.ok === false, missing_undefined_false: missU.ok === false,
    noisy_or_0_75: Math.abs(no.p - 0.75) < 1e-9,
    variance_structural_0_09: Math.abs(vd.structural - 0.09) < 1e-9, variance_within_null: vd.within === null,
  };
  checks.all_pass = checks.identity && checks.missing_false && checks.missing_undefined_false
    && checks.noisy_or_0_75 && checks.variance_structural_0_09 && checks.variance_within_null;
  return checks;
}

/** 分支集冻结块（PREREG §2 判读面；本批＝复用既有族、全集纳入无选择 ⇒ 分支集由 PREREG 冻结） */
function branchSetBlock(units) {
  const defs = FAMILIES.map((f) => ({ id: f.id, parent_sql: f.parent, children: f.children }));
  const ids = units.map((u) => ({ family: u.family, g: u.game_id, p: u.parent_id, c: u.child_ids }));
  return { families: defs, child_sql: CHILD_SQL, unit_count: units.length, selection: '全集纳入（无筛选、无剔除）；缺读数单元计入分母披露',
    freeze_note: '分支集由 PREREG §2 冻结（本批复用既有族；「分支冻结 run_id 先于子题结算」在新产分支时适用——见 v1 §2/收据披露）',
    sha16: crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0, 16) };
}

function main() {
  // ── 开跑令闸（PREREG §5）：无 --arms ⇒ exit 3 零写盘；有则先核**两件**冻结 sha ──
  const { freezeSha } = require('./prereg-freeze.cjs');
  let sha1 = null, m1 = null, sha11 = null, m11 = null;
  try { const r = freezeSha(PREREG); sha1 = r.sha256; m1 = r.match; } catch (e) { sha1 = null; m1 = null; }
  try { const r = freezeSha(PREREG_V11); sha11 = r.sha256; m11 = r.match; } catch (e) { sha11 = null; m11 = null; }
  const gateOk = (m1 === true) && (m11 === true);
  if (!ARMS) {
    console.log('[role3-replay] 闸检：无 --arms ⇒ 不开跑（PREREG §5「冻结的是判据不是开跑令」）。');
    console.log('[role3-replay] v1 sha=' + (sha1 || 'n/a') + ' MATCH=' + String(m1) + '｜v1.1 sha=' + (sha11 || 'n/a') + ' MATCH=' + String(m11));
    console.log('[role3-replay] 加 --arms 真跑；--arms --selftest 跑金样（不读库）。');
    process.exit(3);
  }
  if (!gateOk) {
    process.stderr.write('[role3-replay] 冻结件 sha 不符（v1 MATCH=' + String(m1) + '／v1.1 MATCH=' + String(m11) + '）⇒ exit 3 零写盘。\n');
    process.exit(3);
  }
  if (SELFTEST) {
    const st = selftest();
    console.log('[role3-replay] 金样自检：' + (st.all_pass ? 'PASS' : 'FAIL'));
    console.log(JSON.stringify(st, null, 1));
    process.exit(st.all_pass ? 0 : 1);
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const units = buildUnits(db);
  db.close();
  const m = metricsOf(units);
  const byFam = {};
  for (const u of units) { byFam[u.family] = byFam[u.family] || { units: 0, missing: 0 }; byFam[u.family].units++; if (u.missing) byFam[u.family].missing++; }
  const report = {
    script: 'p1b/scripts/role3-replay.cjs', generated_at: new Date().toISOString(), db: DB_PATH,
    prereg: { v1: { file: path.relative(ROOT, PREREG), sha256: sha1, match: m1 }, v11: { file: path.relative(ROOT, PREREG_V11), sha256: sha11, match: m11 } },
    basis: { run_id: RUN_ID, bootstrap: { B: B, seed: SEED }, noninf_margin: NONINF_MARGIN, mode: 'conjunction', judgement_face: 'N 型合取族（T9/T10）' },
    branch_set: branchSetBlock(units), families: byFam, metrics: m, units: units,
    verdicts_note: 'C1 非劣（CI 上界 ≤ +0.005）／C2 方向（CI 上界 < 0 ⇒ 显著更好，只披露）／C3 校准传播双口径（v1.1 主＝不劣于各分支；并列＝v1 §4 文本 vs 直接）；σ̂_d 与 MDE 必须与 Δ/CI 同报（PREREG §4）。',
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1), 'utf8');

  const L = [];
  L.push('# 角色③ 分支合成 vs 父题直接判词 · 读数（' + DATE_STAMP + '）');
  L.push('');
  L.push('> PREREG v1：`' + path.relative(ROOT, PREREG) + '`（sha ' + String(sha1).slice(0, 8) + '… MATCH=' + m1 + '）');
  L.push('> PREREG v1.1 勘误：`' + path.relative(ROOT, PREREG_V11) + '`（sha ' + String(sha11).slice(0, 8) + '… MATCH=' + m11 + '）');
  L.push('> 判词批 run_id=`' + RUN_ID + '`｜模式=conjunction｜判读面=N 型合取族（T9/T10）｜读数来源＝现役 L6 结构聚合；零 LLM、零账本写。');
  L.push('');
  L.push('## 读数');
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|---|---|');
  L.push('| n（可用单元） | ' + m.n + '（缺 ' + m.n_missing + '） |');
  L.push('| Brier 合成 | ' + fmt(m.brier_synth) + ' |');
  L.push('| Brier 直接 | ' + fmt(m.brier_direct) + ' |');
  L.push('| **ΔBrier（合成−直接）** | **' + fmt(m.delta) + '** |');
  L.push('| σ̂_d | ' + fmt(m.sd_d) + ' |');
  L.push('| MDE（≈2.8σ̂_d/√n） | ' + fmt(m.mde) + ' |');
  L.push('| 95%CI | [' + fmt(m.ci.lb) + ', ' + fmt(m.ci.ub) + '] |');
  L.push('| C1 非劣（上界 ≤ +0.005） | ' + (m.C1_noninf ? '**PASS**' : 'FAIL（未证立）') + ' |');
  L.push('| C2 方向（上界 < 0） | ' + (m.C2_better ? '显著更好' : '不显著') + ' |');
  L.push('| REL 合成 / 直接 / 分支a / 分支b | ' + fmt(m.rel_synth) + ' / ' + fmt(m.rel_direct) + ' / ' + fmt(m.rel_a) + ' / ' + fmt(m.rel_b) + ' |');
  L.push('| C3 校准传播（**主口径**：合成 ≤ 各分支） | ' + (m.C3_blueprint_branches ? '**不劣化**' : '劣化') + ' |');
  L.push('| C3 校准传播（并列：合成 ≤ 直接） | ' + (m.C3_v1_text_direct ? '不劣化' : '劣化') + ' |');
  L.push('| 6C 结构分量均值（披露） | ' + fmt(m.structural_6c_mean) + ' |');
  L.push('| 判据全过（C1 ∧ C3主） | ' + (m.all_pass ? 'PASS' : '**未全过**') + ' |');
  L.push('');
  L.push('★读法：Δ 与 CI **必须与 σ̂_d／MDE 同报**（PREREG §4）；C2 为只披露项，不设承诺；C3 双口径并列（v1.1 勘误）。');
  L.push('');
  fs.writeFileSync(TEXT_OUT, L.join('\n'), 'utf8');
  fs.writeFileSync(JSON_OUT.replace(/\.json$/, '.summary.json'), JSON.stringify({ metrics: m, families: byFam, prereg: report.prereg, branch_set_sha16: report.branch_set.sha16 }, null, 1), 'utf8');

  console.log('[role3-replay] n=' + m.n + '（缺 ' + m.n_missing + '）Δ=' + fmt(m.delta) + ' σ̂_d=' + fmt(m.sd_d) + ' MDE=' + fmt(m.mde)
    + ' CI=[' + fmt(m.ci.lb) + ',' + fmt(m.ci.ub) + ']');
  console.log('[role3-replay] C1=' + (m.C1_noninf ? 'PASS' : 'FAIL') + '｜C2=' + (m.C2_better ? '显著更好' : '不显著')
    + '｜C3主（vs 各分支）=' + (m.C3_blueprint_branches ? '不劣化' : '劣化') + '｜C3并列（vs 直接）=' + (m.C3_v1_text_direct ? '不劣化' : '劣化'));
  console.log('[role3-replay] 产物：' + path.relative(ROOT, JSON_OUT) + '／' + path.relative(ROOT, TEXT_OUT));
  return report;
}

if (require.main === module) main();
module.exports = { buildUnits, metricsOf, selftest, branchSetBlock, FAMILIES, CHILD_SQL, RUN_ID, NONINF_MARGIN };
