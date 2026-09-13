'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// sim-templates-v2.cjs · sim 模板库 v2 · R-B 题源（设计棒微步1 · 2026-09-12）
// 定位：①--dry-run 只读干跑（原样保留）②批次 2-M2 队长授权解锁 --write 落库
//   （显式确认模式：--write 必须搭配 --confirm 才执行；单 --write 仍拒绝退出）。
// --write 口径：对 gid 8-37 按 12 模板生成 cutoff-safe 题，事务落库——
//   statement 前缀标注 cutoff 口径；evidence_json=C2 锚前事件 id（与 R-A 结算证据严格
//   区分）；layer/engine=模板建议值（v2 清单 walkthrough，Q0-3 已由干跑基率表验证）；
//   checklist_hash=v2；resolve 程序真值全回填（ambiguous 如实落）；结算锚写 resolve_note。
// dry-run 零写入保证不变：readonly 连接+全文件无写语句路径不触达。
// 用法：node scripts/sim-templates-v2.cjs --dry-run [--game 37] [--out 文件]
//       node scripts/sim-templates-v2.cjs --write --confirm
// 设计文档：docs/specs/sim-templates-v2-题源设计.md（同棒交付）。
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal'); // 与 src/deps.js 同源解析
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));
const DB_PATH = path.join(P1A_ROOT, 'data', 'p1a.db');

// ── cutoff 锚定义（R-B 判据：判词时点必须早于结算；事件锚而非墙钟）──
// 判词可用证据 = seq ≤ anchorSeq 的全部 events + 其挂载 claims。
const CUTOFFS = {
  C0: { desc: '局开始（题面陈述即定；可用证据=空）',
        pick: function (g) { return 0; } },
  C1: { desc: '昼1死亡公告后/首条发言前',
        pick: function (g) { return g.dawnDeath ? g.dawnDeath.seq : null; } },
  C2: { desc: '发言结束后/计票前（R-B 主判据时点）',
        pick: function (g) { const s = g.events.filter(function (e) { return e.phase !== 'dusk'; }); return s.length ? Math.max.apply(null, s.map(function (e) { return e.seq; })) : null; } },
  C3: { desc: '计票后/终局公告前（预留，现库无此类题）',
        pick: function (g) { return g.endEv ? g.endEv.seq - 1 : null; } },
};

// ── 单局上下文（只读加载+派生量）────────────────────────────────────────────
function countFalseClaims(g) {
  if (!g.roles) return null;
  let n = 0;
  for (const c of g.claims) {
    const subj = g.roles[String(c.subject_seat)];
    if (c.predicate === 'is_wolf' && subj && subj !== 'werewolf') n++;
    else if (c.predicate === 'is_good' && subj && subj !== 'villager') n++;
    else if (c.predicate === 'claims_role' && c.seat === c.subject_seat && String(c.object).indexOf('平民') !== -1 && g.roles[String(c.seat)] !== 'villager') n++;
  }
  return n;
}

function loadGame(db, gid) {
  // events.actor_seat 落库存 players.id（db.js 契约）；读出必须 JOIN players 还原座位号（照 listEvents 口径）
  const events = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id=? ORDER BY e.seq').all(gid);
  const claims = db.prepare("SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object FROM claims c JOIN events e ON c.event_id=e.id WHERE e.game_id=? ORDER BY c.id").all(gid);
  let meta = {};
  try { meta = JSON.parse((db.prepare('SELECT meta FROM games WHERE id=?').get(gid) || {}).meta || '{}'); } catch (e) { meta = {}; }
  const truth = meta.truth || {};
  const g = { gid: gid, events: events, claims: claims, meta: meta, truth: truth, roles: truth.roles || null, wolves: truth.wolves || null, result: truth.result || null };
  g.dawnDeath = events.find(function (e) { return e.type === 'death' && e.phase === 'day'; }) || null;
  g.exileDeath = events.find(function (e) { return e.type === 'death' && e.phase === 'dusk'; }) || null;
  g.endEv = events.filter(function (e) { return e.type === 'system' && e.raw_text.indexOf('游戏结束') !== -1; }).pop() || null;
  g.victim = g.dawnDeath ? g.dawnDeath.actor_seat : null;
  g.exiled = g.exileDeath ? g.exileDeath.actor_seat : null;
  g.tally = null;
  if (g.exileDeath) { const m = g.exileDeath.raw_text.match(/计票：(\{[^}]*\})/); if (m) { try { g.tally = JSON.parse(m[1]); } catch (e) {} } }
  const vals = g.tally ? Object.values(g.tally).sort(function (a, b) { return b - a; }) : [];
  g.voteVals = vals;
  g.maxVotes = vals.length ? vals[0] : null;
  g.statements = events.filter(function (e) { return e.type === 'statement'; });
  g.firstSpeaker = g.statements.length ? g.statements[0].actor_seat : null;
  g.falseClaimCount = countFalseClaims(g);
  g.idClaimCount = g.claims.filter(function (c) { return ['is_wolf', 'is_good', 'claims_role'].indexOf(c.predicate) !== -1; }).length;
  return g;
}

// ── 模板定义数组（12 条；layer/engine 为建议值，落库时由审计器按清单终判）──
const R = function (outcome, anchor) { return { outcome: outcome, anchor: anchor || null }; };
const TEMPLATES = [
  { id: 'T1', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: null, children: null,
    params: { N: 1, X_NOTE: 'X 由生成器 1..6 均匀指派（题面局开始即定，与结果解耦）；干跑用 gid%6+1 模拟指派' },
    statement: function (p) { return '本局第 ' + p.N + ' 天结束前，' + p.X + ' 号存活'; },
    evidence: 'C2 前：昼1死亡公告(death/day)＋全部发言(statement)＋claims；判词可推 X 是否夜死者，放逐未定',
    resolve: function (g, p) { if (g.victim === null || g.exiled === null) return R('ambiguous');
      return R(g.victim !== p.X && g.exiled !== p.X ? 'true' : 'false', g.endEv && g.endEv.id); } },
  { id: 'T2', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: null, children: null,
    params: { K: 4 },
    statement: function (p) { return '本局被真值证伪的身份断言（is_wolf/is_good 与结算角色相反，或自称平民实为狼）不少于 ' + p.K + ' 条'; },
    evidence: 'C2 前：全部 claims（谓词+主语）＋发言原文；真值层在 resolve 时由 meta.roles 复算',
    resolve: function (g, p) { if (g.falseClaimCount === null) return R('ambiguous');
      return R(g.falseClaimCount >= p.K ? 'true' : 'false', g.endEv && g.endEv.id); } },
  { id: 'T3', layer: 'L1', engine: 'proc_calc', cutoff: 'C2', parentPid: null, children: null,
    params: {},
    statement: function () { return '本局放逐计票中，最高票与次高票之差不超过 1 票'; },
    evidence: 'C2 前：发言+claims（票型线索）；真值=计票 JSON 公开算术',
    resolve: function (g) { if (!g.tally) return R('ambiguous'); const v = g.voteVals;
      return R(v[0] - (v.length > 1 ? v[1] : 0) <= 1 ? 'true' : 'false', g.exileDeath && g.exileDeath.id); } },
  { id: 'T4', layer: 'L1', engine: 'proc_calc', cutoff: 'C2', parentPid: null, children: null,
    params: {},
    statement: function () { return '本局放逐投票无弃票（全部存活者均投出有效票）'; },
    evidence: 'C2 前：发言+claims；真值=计票 JSON 总票数=存活人数（公开可复算）',
    resolve: function (g) { if (!g.tally || g.exiled === null) return R('ambiguous'); const alive = 6 - (g.victim === null ? 0 : 1);
      return R(Object.values(g.tally).reduce(function (a, b) { return a + b; }, 0) === alive ? 'true' : 'false', g.exileDeath && g.exileDeath.id); } },
  { id: 'T5', layer: 'L1', engine: 'proc_calc', cutoff: 'C2', parentPid: null, children: null,
    params: { M: 4 },
    statement: function (p) { return '本局放逐投票最高票数不少于 ' + p.M + ' 票'; },
    evidence: 'C2 前：发言+claims；真值=计票 JSON max（公开可复算）',
    resolve: function (g, p) { if (g.maxVotes === null) return R('ambiguous');
      return R(g.maxVotes >= p.M ? 'true' : 'false', g.exileDeath && g.exileDeath.id); } },
  { id: 'T6', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: null, children: null,
    params: {},
    statement: function () { return '本局第一条公开发言的玩家未被放逐'; },
    evidence: 'C2 前：首条 statement 已可见（首讲者已定）；放逐未定',
    resolve: function (g) { if (g.firstSpeaker === null || g.exiled === null) return R('ambiguous');
      return R(g.firstSpeaker !== g.exiled ? 'true' : 'false', g.exileDeath && g.exileDeath.id); } },
  { id: 'T7', layer: 'L1', engine: 'proc_calc', cutoff: 'C2', parentPid: null, children: null,
    params: { N: 1, K: 10 },
    statement: function (p) { return '截至第 ' + p.N + ' 天发言结束，全场累计身份声称（is_wolf/is_good/claims_role）不少于 ' + p.K + ' 条'; },
    evidence: 'C2 前：claims 全表计数（公开）；跨天口径预留 N 参数（现语料 N=1）',
    resolve: function (g, p) { return R(g.idClaimCount >= p.K ? 'true' : 'false', g.endEv && g.endEv.id); } },
  { id: 'T8', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: null, children: null,
    params: {},
    statement: function () { return '本局至少有一名狼人获得至少 1 票'; },
    evidence: 'C2 前：发言+claims（归票线索）；真值=计票 JSON × meta.wolves（真值层 join）',
    resolve: function (g) { if (!g.tally || !g.wolves) return R('ambiguous'); const ws = g.wolves.map(String);
      return R(Object.keys(g.tally).some(function (s) { return ws.indexOf(s) !== -1; }) ? 'true' : 'false', g.exileDeath && g.exileDeath.id); } },
  { id: 'T9a', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: 'T9(预留)', children: null,
    params: {},
    statement: function () { return '本局被放逐者是狼人'; },
    evidence: 'C2 前：发言+claims（伪装结构线索）；真值=meta.roles[放逐者]（真值层）',
    resolve: function (g) { if (g.exiled === null || !g.roles) return R('ambiguous');
      return R(g.roles[String(g.exiled)] === 'werewolf' ? 'true' : 'false', g.endEv && g.endEv.id); } },
  { id: 'T9b', layer: 'L1', engine: 'proc_calc', cutoff: 'C2', parentPid: 'T9(预留)', children: null,
    params: {},
    statement: function () { return '本局放逐计票最高票唯一（未触发破平）'; },
    evidence: 'C2 前：发言+claims；真值=计票 JSON 唯一最大值（公开可复算）',
    resolve: function (g) { if (!g.tally) return R('ambiguous'); const v = g.voteVals;
      return R(v.length > 0 && (v.length === 1 || v[0] > v[1]) ? 'true' : 'false', g.exileDeath && g.exileDeath.id); } },
  { id: 'T9', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: null, children: ['T9a', 'T9b'],
    params: {},
    statement: function () { return '本局被放逐者是狼人，且其最高票唯一（无破平）'; },
    evidence: '同 T9a+T9b；组合题：parent_pid 预留——落库时本条父行引用 T9a/T9b 两单题 id（additive 迁移另行微步）',
    resolve: function (g) { const a = TEMPLATES_MAP.T9a.resolve(g); const b = TEMPLATES_MAP.T9b.resolve(g);
      if (a.outcome === 'ambiguous' || b.outcome === 'ambiguous') return R('ambiguous');
      return R(a.outcome === 'true' && b.outcome === 'true' ? 'true' : 'false', g.endEv && g.endEv.id); } },
  { id: 'T10', layer: 'L6', engine: 'structural', cutoff: 'C2', parentPid: null, children: ['T6', 'T4'],
    params: {},
    statement: function () { return '本局第一条公开发言的玩家未被放逐，且投票无弃票'; },
    evidence: '同 T6+T4；组合题：parent_pid 预留（同 T9 口径）',
    resolve: function (g) { const a = TEMPLATES_MAP.T6.resolve(g); const b = TEMPLATES_MAP.T4.resolve(g);
      if (a.outcome === 'ambiguous' || b.outcome === 'ambiguous') return R('ambiguous');
      return R(a.outcome === 'true' && b.outcome === 'true' ? 'true' : 'false', g.endEv && g.endEv.id); } },
];
const TEMPLATES_MAP = {}; TEMPLATES.forEach(function (t) { TEMPLATES_MAP[t.id] = t; });

// ── 落库模式（批次 2-M2：--write --confirm 显式确认；事务；evidence=cutoff 前事件）──
function writeMode() {
  const predictions = require('../src/db/predictionsStore');
  const db = new Database(DB_PATH); // 读写连接（dry-run 的 readonly 分支不受影响）
  predictions.ensurePredictionsTable(db); // additive 幂等（含 tautology 列）
  const games = db.prepare("SELECT id FROM games WHERE id BETWEEN 8 AND 37 AND source='sim' ORDER BY id").all().map(function (x) { return x.id; });
  const G = games.map(function (gid) { return loadGame(db, gid); });
  const stats = { games: G.length, templates: TEMPLATES.length, inserted: 0, skippedDup: 0, ambiguous: 0, trueN: 0, falseN: 0 };
  const insert = db.transaction(function () {
    for (const g of G) {
      const c2 = CUTOFFS.C2.pick(g);
      const preIds = g.events.filter(function (e) { return c2 !== null && e.seq <= c2; }).map(function (e) { return e.id; });
      for (const t of TEMPLATES) {
        const p = Object.assign({ N: 1, X: g.gid % 6 + 1, K: t.params.K, M: t.params.M }, t.params); // X 指派口径=干跑基率表（gid%6+1，与 Q0-3 验证数据一致）
        const r = t.resolve(g, p);
        const statement = '[cutoff=C2·' + CUTOFFS.C2.desc + '] ' + t.statement(p);
        const dup = db.prepare('SELECT id FROM predictions WHERE game_id = ? AND statement = ?').get(g.gid, statement);
        if (dup) { stats.skippedDup++; continue; }
        const row = predictions.insertPrediction({
          gameId: g.gid, day: 0, sourceType: '预测卡', statement: statement, prob: 0.5,
          layer: t.layer, engine: t.engine, publicExposure: 0, checklistHash: 'v2', gate: 'descriptive', g2Regime: 'R4', maturesAt: null, // botc 无日历到期日：显式 null（#2）
          evidence: preIds, // R-B 口径：cutoff 时点前事件 id（与 R-A 结算证据严格区分）
        });
        stats.inserted++;
        if (r.outcome === 'ambiguous') { stats.ambiguous++; predictions.resolvePrediction(row.id, 'ambiguous', 'R-B 程序结算：锚不足如实 ambiguous'); }
        else {
          if (r.outcome === 'true') stats.trueN++; else stats.falseN++;
          predictions.resolvePrediction(row.id, r.outcome, 'R-B 程序结算真值（cutoff 锚 seq=' + c2 + '；结算锚 ev#' + (r.anchor || '无') + '）');
        }
      }
    }
  });
  insert();
  console.log('WRITE_STATS=' + JSON.stringify(stats));
  const gate = predictions.l0Gate();
  console.log('L0_GATE=' + JSON.stringify(gate));
  db.close();
}

// ── 干跑主流程 ────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const wantWrite = argv.indexOf('--write') !== -1;
  const confirmed = argv.indexOf('--confirm') !== -1;
  if (wantWrite && !confirmed) {
    console.error('REFUSE: --write 为显式确认模式，必须搭配 --confirm（批次 2-M2 队长授权后的双参数门）。');
    process.exit(2);
  }
  if (wantWrite && confirmed) { writeMode(); return; }
  if (!wantWrite && argv.indexOf('--dry-run') === -1) { console.error('用法: node scripts/sim-templates-v2.cjs --dry-run [--game 37]'); process.exit(2); }
  const opt = function (k, dflt) { const i = argv.indexOf('--' + k); return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt; };
  const sampleGid = Number(opt('game', 37));
  const outPath = opt('out', null);

  const db = new Database(DB_PATH, { readonly: true });
  const games = db.prepare("SELECT id FROM games WHERE id BETWEEN 8 AND 37 AND source='sim' ORDER BY id").all().map(function (r) { return r.id; });
  const L = []; const log = function (s) { L.push(s); if (outPath) return; console.log(s); };
  log('=== sim-templates-v2 dry-run · 零 db 写入（readonly）· games=' + games.length + ' ===');

  // Q0-2 机器自检：cutoff(C2/C1) 锚 seq 必须 < 结算锚（exile/end）seq
  let q02bad = 0;
  const G = games.map(function (gid) { const g = loadGame(db, gid);
    const c2 = CUTOFFS.C2.pick(g); const c1 = CUTOFFS.C1.pick(g);
    if (g.exileDeath && ((c2 === null || c2 >= g.exileDeath.seq) || (c1 === null || c1 >= g.exileDeath.seq))) q02bad++;
    return g; });
  log('Q0-2 cutoff 早于结算：' + (q02bad === 0 ? 'PASS（' + G.length + ' 局全部 cutoff.seq < exile.seq）' : 'FAIL bad=' + q02bad));

  // 基率表（Q0-3：0<rate<1 才 PASS，恒定结果=拒收）
  log('\n== 基率表（30 局）==');
  log('id   layer engine      cutoff n_amb true false rate    Q0-3');
  const rates = {};
  for (const t of TEMPLATES) {
    let ok = 0, tr = 0, fa = 0, am = 0;
    for (const g of G) { const r = t.resolve(g, Object.assign({ N: 1, X: g.gid % 6 + 1, K: t.params.K, M: t.params.M }, t.params));
      if (r.outcome === 'ambiguous') am++; else { ok++; if (r.outcome === 'true') tr++; else fa++; } }
    const rate = ok ? tr / ok : NaN;
    rates[t.id] = { ok: ok, tr: tr, fa: fa, am: am, rate: rate };
    log(t.id.padEnd(4) + ' ' + t.layer.padEnd(5) + ' ' + t.engine.padEnd(11) + ' ' + t.cutoff.padEnd(6) + ' ' + String(am).padStart(3) + '  ' + String(tr).padStart(3) + '  ' + String(fa).padStart(3) + '  ' + (isFinite(rate) ? rate.toFixed(3) : ' n/a') + '  ' + (ok && rate > 0 && rate < 1 ? 'PASS' : 'FAIL'));
  }
  // T1 时序题按 X 分列（X=生成器均匀指派；此处用 gid%6+1 模拟指派做 Q0-3 实证）
  log('\n== T1 按存活座位 X 分列 ==');
  for (let X = 1; X <= 6; X++) {
    let ok = 0, tr = 0;
    for (const g of G) { const r = TEMPLATES_MAP.T1.resolve(g, { N: 1, X: X }); if (r.outcome !== 'ambiguous') { ok++; if (r.outcome === 'true') tr++; } }
    log('X=' + X + ': n=' + ok + ' true=' + tr + ' rate=' + (ok ? (tr / ok).toFixed(3) : 'n/a') + ' ' + (ok && tr > 0 && tr < ok ? 'Q0-3 PASS' : 'Q0-3 FAIL'));
  }
  // T2/T7 计数分布（供阈值拍板参考）
  const fc = G.map(function (g) { return g.falseClaimCount; });
  const ic = G.map(function (g) { return g.idClaimCount; });
  const dist = function (arr) { const s = arr.slice().sort(function (a, b) { return a - b; }); return 'min=' + s[0] + ' p25=' + s[Math.floor(s.length * 0.25)] + ' med=' + s[Math.floor(s.length / 2)] + ' p75=' + s[Math.floor(s.length * 0.75)] + ' max=' + s[s.length - 1]; };
  log('\nT2 假声称计数分布: ' + dist(fc));
  log('T7 身份声称计数分布: ' + dist(ic));

  // 样例局全流程 trace（题面→cutoff→证据→resolve）
  const g0 = G.filter(function (g) { return g.gid === sampleGid; })[0] || G[G.length - 1];
  log('\n== 样例局 trace gid=' + g0.gid + '（wolves=' + JSON.stringify(g0.wolves) + ' victim=' + g0.victim + ' exiled=' + g0.exiled + ' result=' + g0.result + '）==');
  const c2 = CUTOFFS.C2.pick(g0);
  const preEvents = g0.events.filter(function (e) { return e.seq <= c2; });
  log('cutoff C2=seq ' + c2 + '（' + CUTOFFS.C2.desc + '）可用证据: ' + preEvents.length + ' events [system:' + preEvents.filter(function (e) { return e.type === 'system'; }).length + ' death:' + preEvents.filter(function (e) { return e.type === 'death'; }).length + ' statement:' + preEvents.filter(function (e) { return e.type === 'statement'; }).length + '] + ' + g0.claims.length + ' claims');
  for (const t of TEMPLATES) {
    const p = Object.assign({ N: 1, X: g0.gid % 6 + 1, K: t.params.K, M: t.params.M }, t.params);
    const r = t.resolve(g0, p);
    log(t.id + ' | ' + t.statement(p) + ' => ' + r.outcome + (r.anchor ? ' (anchor ev#' + r.anchor + ')' : ''));
  }
  log('\n== 零写入声明 ==');
  log('readonly 连接=' + DB_PATH + '；全文件无 INSERT/UPDATE/DELETE/CREATE/ALTER；未触碰 predictions/verdicts。');
  db.close();
  if (outPath) { fs.writeFileSync(outPath, L.join('\n') + '\n', 'utf8'); console.log('written: ' + outPath); }
}

main();





