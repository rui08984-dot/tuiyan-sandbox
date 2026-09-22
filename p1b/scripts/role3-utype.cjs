#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/role3-utype.cjs —— U 型（替代路径 / noisy-OR）路径题出题器（2026-09-21 · 四十批）
 *
 * 判据来源（**引用不新造**）：设计题证据件 `.scratch/p29/角色③设计题-分支形态与判读面-证据件-20260920.md` §1.2
 *   ——「U 型（替代路径型）＝noisy-OR，非平凡对打成立：P_synth(E) = 1 − Π_i (1 − P(E|B_i))；
 *      各路径读数来自**不同子命题的独立判词** ⇒ 合成读数含路径间互补信息 ⇒ 与父题直接读数可不同」。
 *   该件同时实测：「账本里**路径型子命题现为 0**」⇒ 本件＝**补上出题**（属角色③本体工作量）。
 *   合成函数已存在（`role3-combiner.cjs` 的 `combineNoisyOr`），本件只负责**产题**。
 *
 * ★为何狼人局是天然 U 型（本批读盘实测）：
 *   `meta.prereg.variant.win_rule = 'exile_wolf -> village_win; else wolf_win'`
 *   ⇒ 父题「本局狼人阵营胜利」成立 ⟺ **放逐的不是狼**。6 人局 2 狼 4 民 ⇒
 *   **放逐 4 个平民中的任一个**都通向狼胜 ⇒ **4 条非互斥替代路径**（任一成立即父题成立）。
 *   ⇒ 这正是 noisy-OR 的适用形态（路径间不互斥、可互补）。
 *
 * ★★局内前瞻（本批的关键设计，解决「局已完结 ⇒ 无法前瞻」的死结）：
 *   首版查「未结算的狼人父题」⇒ **0 条**（sim 局是已完结历史对局）。若强行出题则 cutoff 晚于事件＝
 *   与既有 sim 题的 `created_at == resolved_at` 同病（那是**补录**不是前瞻）。
 *   读 `events` 表发现每局有**天然 cutoff**：`seq8『发言结束，全体投票放逐』` ⇒ 投票发生在 seq9。
 *   ⇒ **cutoff ＝ 发言结束、投票未发生**：此时全部发言已可听、结果未知 ⇒ 真前瞻，且**无需新跑局**。
 *   本件据此出题：题面问「本局会放逐 X 号吗」，cutoff＝发言末、事件＝计票。
 *
 * 协议（本批锁定）：
 *   ① **父题池**：`events` 表内有完整序列（statement → system『发言结束』→ death『计票』）的局。
 *   ② **路径生成**：每局产出 k 条路径子命题（k＝该局平民数），逐条给独立题面 + 机检锚。
 *   ③ **读数来源**：★本批**不出概率**（铁律④：LLM 只出结构）。路径读数须由判词引擎给出；
 *      本批只产**题面与锚**，读数留待判词批（如实标注 `prob: null`）。
 *   ④ **候选留痕**：全部路径落 `<out>/role3-utype-<date>.rows.json`，供 anchor-gate 算过锚率。
 *   ⑤ **零账本写**；产物只落 `p1b/sim/out/`（运行时日期戳）。
 *
 * 用法：
 *   node p1b/scripts/role3-utype.cjs --dry-run
 *   node p1b/scripts/role3-utype.cjs [--limit N]
 *   node p1b/scripts/anchor-gate.cjs --candidates p1b/sim/out/role3-utype-<date>.rows.json --label U型-路径题
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const LIMIT = Number(arg('limit', '0')) || 0;
const DRY = FLAG('dry-run');
const TODAY = new Date().toISOString().slice(0, 10);
const RUN_AT = new Date().toISOString();

// ── 候选留痕旁路（2026-09-22 · 承 corpus-sources-b4.cjs 同款实现）────────────────
// 为什么：角色③／I1 的前置都是「**过锚率 ≥80%**」，而该率的分母＝**提议全集**（含被丢的）。
//   本生成器在「局无 meta／无 villagers／win_rule 不符／缺事件」时直接 continue ⇒ 被丢提议**零留痕**
//   ⇒ 拿现成候选算出的永远是**构造性 100%**。本旁路落「提议全集＋丢弃原因」让过锚率**可测**。
// 纪律：**默认关** ⇒ 不传 `--record-candidates=<path>` 时**零行为变化**（不建数组、不写文件）。
const REC_PATH = (() => { const a = process.argv.find((x) => x.startsWith('--record-candidates=')); return a ? a.slice(20) : null; })();
const DROPS = [];
function recDrop(stage, reason, info) { if (!REC_PATH) return; DROPS.push(Object.assign({ stage: stage, reason: reason }, info || {})); }

(async () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const report = { run_at: RUN_AT, today: TODAY, dry_run: DRY, parents: [], rows: [], totals: {} };

  // ① 父题池：**有完整局内序列**的局（statement → 『发言结束』 → 计票）
  //    ★不查「未结算父题」（sim 局全已结算）；改用**局内天然 cutoff**（发言末、投票前）
  const games = db.prepare(
    "SELECT DISTINCT game_id FROM events WHERE type = 'death' AND raw_text LIKE '%计票%' ORDER BY game_id"
  ).all();
  report.parents_total_unresolved = games.length;   // 字段名沿用（语义＝可用父题数）

  for (const gg of games) {
    const p = { id: null, game_id: gg.game_id };
    const g = db.prepare('SELECT id, meta FROM games WHERE id = ?').get(gg.game_id);
    if (!g || !g.meta) { recDrop('parent', 'no_meta', { game_id: gg.game_id }); report.parents.push({ id: null, game_id: gg.game_id, skipped: '局无 meta（老数据）⇒ 无 truth 可依，不编' }); continue; }
    let m; try { m = JSON.parse(g.meta); } catch (e) { recDrop('parent', 'meta_unparsable', { game_id: gg.game_id }); report.parents.push({ id: null, game_id: gg.game_id, skipped: 'meta 不可解析' }); continue; }
    const truth = m.truth || {};
    const villagers = Array.isArray(truth.villagers) ? truth.villagers : [];
    const wolves = Array.isArray(truth.wolves) ? truth.wolves : [];
    const winRule = ((m.prereg || {}).variant || {}).win_rule || null;
    if (!villagers.length) { recDrop('parent', 'no_villagers', { game_id: gg.game_id }); report.parents.push({ id: null, game_id: gg.game_id, skipped: 'truth 无 villagers ⇒ 路径不可枚举，不编' }); continue; }
    if (!winRule || !/exile_wolf/.test(winRule)) { recDrop('parent', 'win_rule_not_exile_wolf', { game_id: gg.game_id, win_rule: winRule }); report.parents.push({ id: null, game_id: gg.game_id, skipped: 'win_rule 非 exile_wolf 形态 ⇒ 路径语义不同，本批不处理' }); continue; }

    // ★局内 cutoff：『发言结束』事件的 seq（投票在其后）
    const sp = db.prepare(
      "SELECT seq FROM events WHERE game_id = ? AND raw_text LIKE '%发言结束%' ORDER BY seq DESC LIMIT 1"
    ).get(gg.game_id);
    const vote = db.prepare(
      "SELECT seq, raw_text FROM events WHERE game_id = ? AND type = 'death' AND raw_text LIKE '%计票%' ORDER BY seq LIMIT 1"
    ).get(gg.game_id);
    if (!sp || !vote) { recDrop('parent', 'missing_cutoff_or_vote_event', { game_id: gg.game_id, has_speech_end: !!sp, has_vote: !!vote }); report.parents.push({ id: null, game_id: gg.game_id, skipped: '缺『发言结束』或『计票』事件 ⇒ 局内 cutoff 不可定，不编' }); continue; }

    const pr = { id: null, game_id: gg.game_id, wolves, villagers, win_rule: winRule, branches: 0, cutoff_seq: sp.seq, vote_seq: vote.seq, vote_note: String(vote.raw_text).slice(0, 80) };
    // ② 路径：放逐每个平民 ⇒ 狼胜（非互斥：任一成立即父题成立）
    for (const v of villagers) {
      const row = {
        statement: '【U型·路径】sim 局 ' + gg.game_id + '（发言已毕、投票未开）：本局会放逐 ' + v + ' 号吗？'
          + '（该号被放逐 ⇒ 狼人阵营胜利）',
        layer: 'L6',
        resolve: {
          kind: 'sim_exile_seat',
          game_id: gg.game_id,
          seat: v,
          expect: 'exiled',
          anchor: 'events 表 type=death 且 raw_text 含计票 ⇒ 计票 JSON 的键即被放逐座位；games.meta.truth 供角色复核',
        },
        // ★本批不出概率（铁律④）：路径读数须由判词引擎给，本批只产题面与锚
        prob: null,
        prob_source: 'n/a（本批只产结构；读数留待判词批）',
        meta: {
          phase: 'role3_utype',
          cutoff: RUN_AT,                    // 落库时点（**局内**：发言已毕、投票未开）
          cutoff_seq: sp.seq,
          cutoff_event: '发言结束，全体投票放逐',
          eventDate: String(vote.raw_text).slice(0, 0) || null,   // 计票无日期（局内事件）
          parent_prediction_id: null,        // sim 局父题无 predictions 行（已结算族）⇒ 如实置 null
          game_id: gg.game_id,
          path_seat: v,
          path_role: 'villager',
          path_type: 'alternative',          // ★U 型标记（供合成器选 noisy-OR）
          win_rule: winRule,
          independent: true,                 // 路径间非互斥（任一成立即父题成立）
        },
        slug: 'corpus:utype|sim|' + gg.game_id + '|exile|' + v,
      };
      report.rows.push(row); pr.branches++;
      if (LIMIT && report.rows.length >= LIMIT) break;
    }
    report.parents.push(pr);
    if (LIMIT && report.rows.length >= LIMIT) break;
  }

  db.close();

  report.totals = {
    candidates: report.rows.length,
    parents_with_paths: report.parents.filter((x) => x.branches > 0).length,
    parents_skipped: report.parents.filter((x) => x.skipped).length,
    prob_null_all: report.rows.every((r) => r.prob === null),
    path_types: [...new Set(report.rows.map((r) => r.meta.path_type))],
  };

  console.log('== U 型路径题出题器 ' + (DRY ? '（DRY-RUN，不落盘）' : '') + ' ==');
  console.log('父题池（未结算）: ' + report.parents_total_unresolved);
  console.log('产出路径: ' + report.totals.candidates + ' 条（父题 ' + report.totals.parents_with_paths + ' 个，跳过 ' + report.totals.parents_skipped + ' 个）');
  console.log('★全部 prob=null（本批只产结构，不出概率）: ' + (report.totals.prob_null_all ? '是' : '否'));
  console.log('路径类型: ' + report.totals.path_types.join(', '));

  if (!DRY) {
    const stamp = TODAY.replace(/-/g, '');
    const rowsPath = path.join(OUT_DIR, 'role3-utype-' + stamp + '.rows.json');
    const repPath = path.join(OUT_DIR, 'role3-utype-' + stamp + '.json');
    fs.writeFileSync(rowsPath, JSON.stringify(report.rows, null, 1), 'utf8');
    fs.writeFileSync(repPath, JSON.stringify(report, null, 1), 'utf8');
    console.log('产物 ' + rowsPath);
    console.log('产物 ' + repPath);
    // ── 候选留痕落盘（默认关；仅当传 --record-candidates=<path>）──
    if (REC_PATH) {
      const dropByReason = {};
      for (const dz of DROPS) dropByReason[dz.reason] = (dropByReason[dz.reason] || 0) + 1;
      fs.writeFileSync(REC_PATH, JSON.stringify({
        run_at: RUN_AT, source: 'role3-utype.cjs', today: TODAY,
        note: '候选留痕旁路产物（承 corpus-sources-b4.cjs 同款）：candidates＝产出的路径题；drops＝被丢的父题'
          + '（含原因）。过锚率的严格分母＝candidates.length + drops.length（提议全集）。'
          + '★注意：本生成器的 drops 是**父题级**（整局被丢），非路径级——一局被丢则其全部路径都不产出。',
        candidates: report.rows, drops: DROPS,
        counts: { candidates: report.rows.length, drops: DROPS.length, proposed_total: report.rows.length + DROPS.length, drop_by_reason: dropByReason },
      }, null, 1), 'utf8');
      console.log('[record] 候选留痕 -> ' + REC_PATH + '（候选 ' + report.rows.length + ' ＋ 被丢 ' + DROPS.length + ' ＝ 提议全集 ' + (report.rows.length + DROPS.length) + '）');
      console.log('[record] 被丢按原因 ' + JSON.stringify(dropByReason));
    }
    console.log('下一步：node p1b/scripts/role3-freeze.cjs freeze --candidates ' + rowsPath + ' --label utype');
  }
})();
