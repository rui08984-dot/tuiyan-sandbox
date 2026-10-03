'use strict';
/**
 * 局鉴 · bench/run-bench.cjs —— 真实对局盲测（MECHANICAL PART）
 *
 * ══ 这个 bench 测什么、不测什么（这一段不许含糊）═════════════════════════
 *
 *   测：
 *     M1 矛盾检测引擎在**真实对局**上能不能找到矛盾
 *     M2 找到的矛盾里，有多少涉及真狼（信息量）/ 全是好人（候选误报）
 *     H2 引用真实性：每条矛盾的引用是否都能在账本里回查到
 *     H2' RD1 守卫：引擎原始输出（无无辜解释）送进存储层，是否被如期拒下
 *     COV 抽取覆盖率：档案里多少事件被规则抽取器读成了声称
 *
 *   ★不测（且这些结论**不能**从本 bench 的读数推出）：
 *     · 抽取质量 —— 这里的抽取是**档案格式适配器**（规则），不是产品的 LLM 抽取
 *     · 嫌疑排序是否优于基线 —— 预注册协议已判负（H1 不过），本 bench 不重跑也不翻案
 *     · 矛盾「有效率」（人工抽查可复核的硬矛盾占比）—— 那是**人工判定**，本 bench 只标出来
 *
 * ══ 为什么规则抽取而不是 LLM ════════════════════════════════════════════
 *   一次 LLM 抽取的读数会随模型版本、温度、网络状态漂移。
 *   **不可复跑的评测不是评测，是许愿。** ��本 bench 零网络、逐条可复核。
 *
 * ══ 三条不许放松的纪律 ════════════════════════════════════════════════
 *   ① 切片按预注册协议 §1.2 **强制裁头**（去掉元信息块与叙事标签），不提供开关
 *   ② 解析不了的局**如实跳过并写明原因**，不缩小分母
 *   ③ 读数**报覆盖率**。覆盖率低的地方，读数就该被少信一点 —— 这是本 bench 最重要的一条。
 */

const path = require('node:path');
const store = require('../src/db/store');
const engine = require('../src/kernel/engine');
const parser = require('./parse-archive.cjs');
const { extractClaims } = require('./extract-claims.cjs');

const ARCHIVE_DIR = path.join(__dirname, 'archives');

/** 预注册协议 §3 的三档结局。这里只机械可判的部分，其余标「需人工」。 */
const TIERS = {
  kill: '确定层有效矛盾产不出来（抽查有效率 <50%）⇒ 该方向判负',
  review: '机制层成立、价值层未证 ⇒ 产品是复盘工具',
  solve: '机制层与价值层都成立 ⇒ 才谈得上破案器（★本项目至今未到达）',
};

/** 单局评测。返回结构化读数，不打印。 */
function runOne(slug, dir) {
  const archive = parser.loadArchive(dir || ARCHIVE_DIR, slug);
  const { pub, truth } = archive;
  const wolves = new Set(truth.wolves);

  store.init(':memory:');
  try {
    const game = store.createGame({
      name: slug, game_type: 'werewolf', player_count: pub.seats.length,
    });

    // ── 逐日装载：事件 + 规则抽出的声称，全部走**真实存储层** ──
    //    走真实存储层是刻意的：RD1、原子性、软删纪律都在那一层，
    //    绕过它就等于测了个不存在的东西。
    const days = [...new Set(pub.sections.map((s) => s.day))].sort((a, b) => a - b);
    let eventsIn = 0, eventsWithClaims = 0, claimsIn = 0;
    for (const day of days) {
      // ★协议 §1.2：裁头只给「给人读」的切片用；装载走原文（它已是公开层）。
      //   切片文本本身在这里被实算一次，确保它**能被复现**，而不是躺在文档里。
      parser.slice(pub, day);
      for (const sec of pub.sections.filter((s) => s.day === day)) {
        for (const ev of sec.events) {
          eventsIn++;
          const claims = extractClaims(ev);
          if (claims.length) eventsWithClaims++;
          claimsIn += claims.length;
          // ★事件归属：档案里大量事件是「全场都知道的事实」而不是某人的发言 ——
          //   「警长竞选：4号、8号、9号、10号共 4 人上警」「公布夜 1 死亡：2 号死亡」
          //   强行挑一个座位当发言人，是**编造归属**。
          //   ⇒ 归为 type:'system'（唯一允许无发言人的类型），语义也正确。
          //   挑不出座位时的另一个选项是猜一个 —— 那会让矛盾检测在错误的作者身上推理。
          const seatM = ev.text.match(/(\d{1,2})\s*号/);
          const actor = seatM && seatM[1] ? Number(seatM[1]) : null;
          const hasClaim = claims.length > 0;
          store.recordEvent({
            game_id: game.id, day, phase: sec.phase,
            type: hasClaim ? 'claim' : (actor ? 'statement' : 'system'),
            actor_seat: hasClaim || actor ? actor : null,
            raw_text: ev.text,
          }, {
            claims: claims.map((c) => Object.assign({}, c, {
              extracted_by: 'bench-adapter', confirmed_by_user: 1,
            })),
          });
        }
      }
    }

    // ── 跑真正的矛盾检测引擎（不是重写一份）──────────────────────────
    const state = store.loadGameState(game.id);
    const pairs = engine.findContradictions(state.claims, state.actions, state.events);

    // ── 逐条核对 ──────────────────────────────────────────────────────
    const claimById = new Map(state.claims.map((c) => [c.id, c]));
    let citationAuthentic = true;
    let withWolf = 0, withoutWolf = 0;
    const details = [];

    // ★RD1 的正确测法：**让矛盾真的过存储层**，看守卫生不生效。
    //
    //   第一版我拿引擎的原始输出直接查 innocent_explanations，判了红 ——
    //   那是**测错了东西**：纯代码比对器本来就不产无辜解释（那是 LLM 层补的），
    //   它的输出从不直接入库。拿它去查 RD1，等于查一条生产路上不存在的路径。
    //
    //   真正该验的是：引擎输出**原样**送进 saveContradictions，
    //   必须被拒（RD1）。守卫生效 = 机制层这条成立。
    let rd1GuardFired = true;
    let rd1ProbeDetail = '';
    if (pairs.length) {
      try {
        store.saveContradictions(game.id, pairs.map((p) => ({
          claim_a: p.claim_a, claim_b: p.claim_b,
          action_a: p.action_a, action_b: p.action_b,
          conflict_desc: p.conflict_desc,
          underdetermination: p.underdetermination,
          innocent_explanations: p.innocent_explanations || [],   // 引擎给什么就是什么
          generated_by: 'code',
        })));
        rd1GuardFired = false;      // 竟然入库了 ⇒ 守卫生效不了
        rd1ProbeDetail = '★引擎原始输出未被 RD1 拦下，检查了「有无辜解释」这条不变式';
      } catch (e) {
        rd1ProbeDetail = 'RD1 如期拦下：' + String(e.message).replace(/^\[jujian-db\]\s*/, '');
      }
    }

    for (const p of pairs) {
      const ids = [p.claim_a, p.claim_b].filter((x) => x !== null && x !== undefined);
      for (const id of ids) {
        if (!claimById.has(id)) citationAuthentic = false;   // 引用了不存在的行 ⇒ 幻觉
      }
      const seatsInvolved = [...new Set(ids.map((id) => claimById.get(id))
        .filter(Boolean).flatMap((c) => [c.seat, c.subject_seat]))];
      const hitWolf = seatsInvolved.some((s) => wolves.has(s));
      if (hitWolf) withWolf++; else withoutWolf++;
      details.push({
        conflict_desc: p.conflict_desc,
        underdetermination: p.underdetermination,
        seats: seatsInvolved,
        involves_real_wolf: hitWolf,
        innocent_explanations: p.innocent_explanations,
      });
    }

    // ── 角色对跳：局鉴真正擅长的那一类矛盾 ────────────────────────────
    const roleBySeat = new Map();
    for (const c of state.claims) {
      if (c.predicate !== 'claims_role') continue;
      if (!roleBySeat.has(c.object)) roleBySeat.set(c.object, new Set());
      roleBySeat.get(c.object).add(c.seat);
    }
    const jumps = [];
    for (const [role, seats] of roleBySeat) {
      if (seats.size < 2) continue;
      const arr = [...seats].sort((a, b) => a - b);
      jumps.push({
        role,
        seats: arr,
        involves_real_wolf: arr.some((s) => wolves.has(s)),
        // ★协议 §2：双轨 Top-2 命中计分口径 —— 这里只报座位，不下「谁是狼」的结论
        wolf_hits: arr.filter((s) => wolves.has(s)).length,
      });
    }

    const total = pairs.length;
    return {
      slug,
      ok: true,
      seats: pub.seats.length,
      days: days.length,
      coverage: {
        events_total: eventsIn,
        events_with_claims: eventsWithClaims,
        extraction_rate: eventsIn ? +(eventsWithClaims / eventsIn).toFixed(3) : 0,
        claims_total: claimsIn,
        claims_role: state.claims.filter((c) => c.predicate === 'claims_role').length,
      },
      contradictions: {
        found: total,
        involving_real_wolf: withWolf,
        candidate_false_positive: withoutWolf,
        citations_authentic: citationAuthentic,
        rd1_guard_fired: rd1GuardFired,
        rd1_probe: rd1ProbeDetail,
        details,
      },
      role_jumps: jumps,
      truth: { wolves: truth.wolves, good_count: truth.good.length, focus: truth.focus, note: truth.note },
      // ★人工判定项：机械读数给不出「有效矛盾率」，如实标出来而不是编一个数
      needs_human_review: '矛盾的有效率（可复核的硬矛盾占比）需人工抽查；本 bench 不代判',
    };
  } finally {
    store.closeCurrent();
  }
}

/**
 * ★目录可注入 —— 测试要把 ARCHIVE_DIR 指向空目录来验「一局都没跑起来必须抛」。
 *   第一版靠改 module.exports.ARCHIVE_DIR，**没用**：CommonJS 里那是另一个绑定，
 *   改它不影响本函数读到的模块内 const，测试于是假绿。
 */
function runAll(dir) {
  const d = dir || ARCHIVE_DIR;
  const slugs = parser.listArchives(d);
  const results = [];
  const skipped = [];
  for (const s of slugs) {
    try {
      results.push(runOne(s, d));
    } catch (e) {
      // ★解析不了就如实跳过并写明原因，**不缩小分母**
      skipped.push({ slug: s, reason: e.message });
    }
  }
  // ★一局都没跑起来 ⇒ bench 自己没跑起来，不是「结果为空」。
  //   这一条必须炸出来：一份写着「合计 0 局 · 矛盾 0 条」的报告，
  //   读起来和「跑了但没发现矛盾」一模一样 —— 那是本 bench 最危险的失败模式。
  if (!results.length) {
    const e = new Error('bench 一局都没跑起来（' + skipped.length + ' 局全部跳过）。'
      + '这不是「没发现矛盾」，是 bench 坏了：\n  '
      + skipped.map((s) => s.slug + ' —— ' + s.reason).join('\n  '));
    e.benchDidNotRun = true;
    throw e;
  }
  return { results, skipped };
}

function render(report) {
  const L = [];
  L.push('');
  L.push('局鉴 · 真实对局盲测（机械可判部分）');
  L.push('─'.repeat(70));
  L.push('档案目录：bench/archives　｜　零网络　｜　逐条可复核');
  L.push('★本 bench 不测：抽取质量、嫌疑排序优于基线（协议已判负）、矛盾有效率（需人工）');
  L.push('');

  for (const r of report.results) {
    L.push('【' + r.slug + '】' + r.seats + ' 人 · ' + r.days + ' 天');
    L.push('  事件 ' + r.coverage.events_total + ' 条，其中抽到声称的 ' + r.coverage.events_with_claims
      + ' 条（覆盖 ' + Math.round(r.coverage.extraction_rate * 100) + '%）｜ 声称 ' + r.coverage.claims_total
      + ' 条（角色 ' + r.coverage.claims_role + '）');
    L.push('  真值：狼 ' + JSON.stringify(r.truth.wolves) + ' ｜ 主考点 ' + (r.truth.focus || '—'));
    L.push('  矛盾 ' + r.contradictions.found + ' 条 ｜ 涉及真狼 ' + r.contradictions.involving_real_wolf
      + ' ｜ 候选误报 ' + r.contradictions.candidate_false_positive);
    L.push('  H2 引用真实性 ' + (r.contradictions.citations_authentic ? '✔ 全部可回查' : '✖ 有引用落空')
      + ' ｜ RD1 守卫 ' + (r.contradictions.rd1_guard_fired ? '✔ 如期拦下无解释的入库' : '✖ 未拦下'));
    // ★覆盖太低时，这条读数本身就不该被当证据 —— 直接写在局下面，不藏在脚注里。
    if (r.coverage.extraction_rate < 0.15) {
      L.push('  ⚠ 抽取覆盖仅 ' + Math.round(r.coverage.extraction_rate * 100)
        + '%，本局读数**不足以支撑任何结论**（没抽到的发言不可能产生矛盾）');
    }
    if (r.role_jumps.length) {
      L.push('  角色对跳：');
      for (const j of r.role_jumps) {
        L.push('    · ' + j.role + ' ← ' + j.seats.join(' vs ') + '　[涉及真狼 ' + j.involves_real_wolf
          + '，命中 ' + j.wolf_hits + '/' + j.seats.length + ']');
      }
    }
    if (r.contradictions.details.length) {
      L.push('  矛盾明细（最多 3 条）：');
      for (const d of r.contradictions.details.slice(0, 3)) {
        L.push('    · ' + String(d.conflict_desc).slice(0, 62) + '  [' + d.seats.join(' vs ') + ']');
      }
    }
    L.push('');
  }

  if (report.skipped.length) {
    L.push('★未覆盖的局（解析不了，如实登记，**未计入分母**）：');
    for (const s of report.skipped) L.push('  · ' + s.slug + ' —— ' + s.reason);
    L.push('');
  }

  // ── 汇总 ──
  const tot = report.results.reduce((a, r) => ({
    events: a.events + r.coverage.events_total,
    extracted: a.extracted + r.coverage.events_with_claims,
    contradictions: a.contradictions + r.contradictions.found,
    withWolf: a.withWolf + r.contradictions.involving_real_wolf,
  }), { events: 0, extracted: 0, contradictions: 0, withWolf: 0 });

  L.push('─'.repeat(70));
  L.push('合计：' + report.results.length + ' 局 ｜ 事件 ' + tot.events + ' ｜ 抽到声称的事件 ' + tot.extracted
    + '（覆盖 ' + Math.round(tot.extracted / tot.events * 100) + '%）');
  L.push('      矛盾 ' + tot.contradictions + ' 条，涉及真狼 ' + tot.withWolf);
  const mech = report.results.every((r) => r.contradictions.citations_authentic && r.contradictions.rd1_guard_fired);
  L.push('      机制层（H2 引用真实性 ＋ H2\' RD1）：' + (mech ? '✔ 全部通过' : '✖ 有局未过'));
  L.push('');
  L.push('三档结局（预注册协议 §3）——');
  L.push('  杀项目档：' + TIERS.kill);
  L.push('  复盘器档：' + TIERS.review);
  L.push('  破案器档：' + TIERS.solve);
  L.push('');
  L.push('★本 bench 的读数只支持机械可判的那几行。');
  L.push('  「矛盾有效率」与「嫌疑排序是否优于基线」不在本读数范围内 ——');
  L.push('  前者需人工抽查（本次共 ' + tot.contradictions + ' 条量级）；');
  L.push('  后者预注册协议已判负，本 bench 不翻案也不重跑。');
  L.push('');
  return L.join('\n');
}

module.exports = { runAll, runOne, render, ARCHIVE_DIR, TIERS };

if (require.main === module) {
  try {
    const report = runAll();
    process.stdout.write(render(report));
    process.stdout.write('\n');
  } catch (e) {
    // ★bench 没跑起来 ≠ 结果为空。退出码非零，让 CI 和人都会看见。
    process.stderr.write('bench 没能跑起来：\n' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(2);
  }
}