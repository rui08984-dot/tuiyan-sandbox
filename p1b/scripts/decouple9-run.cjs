#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/decouple9-run.cjs —— 9 臂解耦实验 · 跑批编排器（2026-09-17）
 *
 * 依据（唯一）：`docs/assets/forecast-debate/PREREG-9臂解耦-v1.md`（**冻结件，本脚本只读不改**；
 *   正文 sha 不符 ⇒ 硬失败 exit 3、零写盘）——PREREG 由 16 号件 §4B「3×3 解耦实验升格为 PREREG 化
 *   多样性测量实验」立题，蓝图 §2.2 #4 写死 0.8 阈值与立项分支，19 号件 §3.2 降级为先导。
 *
 * 臂（写死，见 PREREG §2）：三变体 × 三温度 = 9 臂 ＋ **同批同配置重复臂 1 条**（v1_evidence@0.2 第 2 次）
 *   ⇒ 每题 10 个条件。重复臂的唯一用途 = **阴性对照/噪声底**（同题同提示词重采样差）。
 *
 * ★ 口径（本脚本的三条硬设计，全部写死）：
 *   ① **不写账本**：产物只落 JSONL 工件；`verdicts` 表**一行不写**。理由（本批实测发现的缺陷）：
 *      `l6Structural`（L6 生产引擎）取**每变体 id 最大**的一行、**不按 run_id 过滤** ⇒ 任何新插入的
 *      判词行都会**静默改掉 L6 生产读数**（且非对角臂会被当生产输入 = 口径污染）。⇒ 本批改走工件通道；
 *      是否晋升入账本属拍板项（收据 §披露）。
 *   ② **提示词单一实现**：system/user 提示词一律 require `p1b/src/routes/verdicts.js` 的
 *      `buildSystemPrompt`/`buildUserPrompt`/`loadEvidence`/`loadBaseline`（禁各写一套）；
 *      implied_prob 用同文件的 `extractImpliedProb` 机械抽取（末行 P=0.xx，禁 LLM 自由给数）。
 *   ③ **prompt_sha16 逐行落盘**：同一条件的两份副本必须**逐字节同提示词**（收据须证），
 *      否则重复臂不能当噪声底。
 * 纪律：零账本写／零 8787 接触（进程内直连 LLM，不经 HTTP 路由）／key 只进程内、不进产物与日志；
 *   调用数＋费用双硬闸；断点续跑（state 文件）。**执行顺序＝题主序**（同一题 10 个条件相邻跑），
 *   使上游漂移落在题之间而非臂之间（配对分析按题）。
 * 用法：
 *   node p1b/scripts/decouple9-run.cjs --emit-anchor            # 零 LLM：按冻结规则派生锚题清单并落工件
 *   node p1b/scripts/decouple9-run.cjs --dry-run                # 零 LLM：派生锚题＋验 prompt 与零写盘
 *   node p1b/scripts/decouple9-run.cjs --limit 1 --tag smoke    # 真跑 1 题 10 条件（烟测/成本实测）
 *   node p1b/scripts/decouple9-run.cjs                          # 真跑 40 题 × 10 条件
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

// ── 冻结口径常量（改任一＝版本递进） ────────────────────────────────────────
const PREREG_PATH = path.resolve(arg('prereg', path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'PREREG-9臂解耦-v1.md')));
const ANCHOR_PATH = path.resolve(arg('anchor', path.join(ROOT, 'p1b', 'sim', 'out', 'decouple9-anchor-20260917.json')));
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const TAG = arg('tag', 'main');
const OUT_JSONL = path.resolve(arg('jsonl', path.join(ROOT, 'p1b', 'sim', 'out', 'decouple9-verdicts-20260917.jsonl')));
const STATE_PATH = path.resolve(arg('state', path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'decouple9', 'run-state-' + TAG + '.json')));
const REPORT_JSON = arg('report', null);
const LIMIT = Number(arg('limit', '0')) || null;
const MAX_CALLS = Number(arg('max-calls', '450'));
const MAX_COST = Number(arg('max-cost', '6'));
const CPC = Number(arg('cost-per-call', '0.0054'));   // 保守估（＝R-A 批实测默认思考档 ¥/call；low 档实测更低）
const MODEL_LABEL = arg('model', 'tokenrhythm/glm-5.3-flash');  // 声明标签（事实层由 resolved_model 载）
const DRY = FLAG('dry-run');
const EMIT_ANCHOR = FLAG('emit-anchor');
const RETRY = FLAG('retry');                          // 只重跑「失败/抽取 null」的条件（读 JSONL 定位，不动成功行）
// 按题分片（执行层并发；**按题连续切块**⇒ 同题 10 条件恒同 worker ⇒ 题内配对/臂序不受影响；
//   禁按条件交错分片：那会把「臂」与「worker」绑上，制造新的混淆）
const QSHARD = Math.max(0, Number(arg('qshard', '0')) || 0);
const QSHARDS = Math.max(1, Number(arg('qshards', '1')) || 1);

const RUN_PREFIX = 'decouple9-' + TAG + '-';

// 锚题池选择（写死；见 PREREG §3）：L6 层（唯一消费判词的生产层）× v2 清单 × cutoff 代际 × 三变体判词齐
const POOL = {
  layer: 'L6',
  checklist_hash: 'v2',
  statement_prefix: '[cutoff=',
  min_games: 30,
  first_round: 30,     // 第 1 轮：前 30 局各取 1 题（局序 j ⇒ 局内位置 j mod m_j）
  second_round: 10,    // 第 2 轮：前 10 局各补 1 题（局内位置 (j+1) mod m_j）
};

/**
 * 臂表（写死顺序＝执行顺序；题主序，故表内顺序只在题内生效）。
 * copy=1 为 9 臂本体，copy=2 为 v1@0.2 的同批重复（阴性对照/噪声底）。
 */
const ARMS = [
  { variant: 'v1_evidence', temperature: 0.2, copy: 1, role: 'diag' },
  { variant: 'v1_evidence', temperature: 0.2, copy: 2, role: 'repeat' },
  { variant: 'v2_skeptical', temperature: 0.7, copy: 1, role: 'diag' },
  { variant: 'v3_baserate', temperature: 1.0, copy: 1, role: 'diag' },
  { variant: 'v1_evidence', temperature: 0.7, copy: 1, role: 'offdiag' },
  { variant: 'v1_evidence', temperature: 1.0, copy: 1, role: 'offdiag' },
  { variant: 'v2_skeptical', temperature: 0.2, copy: 1, role: 'offdiag' },
  { variant: 'v2_skeptical', temperature: 1.0, copy: 1, role: 'offdiag' },
  { variant: 'v3_baserate', temperature: 0.2, copy: 1, role: 'offdiag' },
  { variant: 'v3_baserate', temperature: 0.7, copy: 1, role: 'offdiag' },
];
const armKey = (a) => a.variant + '@T' + a.temperature + '#' + a.copy;
const armRunId = (a) => RUN_PREFIX + a.variant.replace('_', '-') + '-T' + String(a.temperature).replace('.', '') + (a.copy > 1 ? '-rep' : '');

// ── 纯函数区（可 require；零副作用、零 IO） ─────────────────────────────────

/** 帧哈希（16 位）：工件与行的绑定指纹（prompt 逐字节 / 题面 / 清单）。 */
function sha16(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16); }

/**
 * 锚题派生（纯函数；规则＝PREREG §3，写死）：输入池行（已按 game_id, id 升序），输出选中行（带 round/pos）。
 * 规则：前 30 局各取 1 题（局序 j ⇒ 局内位置 j mod m_j）＋ 前 10 局各补 1 题（位置 (j+1) mod m_j）。
 * @param {Array<{id:number,game_id:number}>} pool
 */
function deriveAnchor(pool) {
  const games = [];
  const byG = new Map();
  for (const r of pool) {
    if (!byG.has(r.game_id)) { byG.set(r.game_id, []); games.push(r.game_id); }
    byG.get(r.game_id).push(r);
  }
  if (games.length < POOL.min_games) throw new Error('锚题池局数不足：' + games.length + ' < ' + POOL.min_games);
  const out = [];
  for (let j = 0; j < POOL.first_round; j++) {
    const q = byG.get(games[j]);
    out.push(Object.assign({}, q[j % q.length], { round: 1, pos: j % q.length, m: q.length }));
  }
  for (let j = 0; j < POOL.second_round; j++) {
    const q = byG.get(games[j]);
    const pos = (j + 1) % q.length;
    if (q.length < 2) continue;                       // 单题局不重复取（如实跳过）
    out.push(Object.assign({}, q[pos], { round: 2, pos: pos, m: q.length }));
  }
  const ids = out.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new Error('锚题派生出现重复题 id');
  return out;
}

/** PREREG 冻结守卫（照 `e2-r1-rules.cjs` 先例）：正文 sha 不符 ⇒ 硬失败（不写任何产物）。
 *  口径＝复用 `prereg-freeze.cjs::freezeSha` **单一实现**（禁各写一套；该文件已加 require.main 守卫）。 */
function verifyPreregFreeze() {
  const tool = require(path.join(__dirname, 'prereg-freeze.cjs'));
  if (typeof tool.freezeSha !== 'function') throw new Error('prereg-freeze.cjs 未导出 freezeSha（口径无法复用）');
  return tool.freezeSha(PREREG_PATH);
}

/** 载入池（readOnly 句柄；零写）。 */
function loadPool() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const sql = "SELECT p.id, p.game_id, p.outcome, p.statement, p.day FROM predictions p"
      + " WHERE p.layer=? AND p.checklist_hash=? AND p.statement LIKE ?"
      + " AND p.id IN (SELECT prediction_id FROM verdicts v WHERE v.implied_prob IS NOT NULL"
      + "   GROUP BY prediction_id HAVING COUNT(DISTINCT prompt_variant)=3)"
      + " ORDER BY p.game_id, p.id";
    return db.prepare(sql).all(POOL.layer, POOL.checklist_hash, POOL.statement_prefix + '%');
  } finally { db.close(); }
}

/** 提示词与证据块构造（单一实现：全部 require 生产路由的导出函数）。
 *  game 对象须带真实 game_type（生产路由由 getGameOr404 提供；此处直查 games 表，禁传 'unknown'）。 */
function makePromptBuilder() {
  const V = require(path.join(ROOT, 'p1b', 'src', 'routes', 'verdicts.js'));
  const ps = require(path.join(ROOT, 'p1b', 'src', 'db', 'predictionsStore.js'));
  const dbMod = require(path.join(ROOT, 'p1b', 'src', 'deps.js')).db;
  const gameCache = new Map();
  return function build(pid, variant) {
    const pred = ps.getPrediction(pid);
    if (!pred) throw new Error('prediction 不存在: ' + pid);
    if (!gameCache.has(pred.game_id)) {
      const g = dbMod.getConnection().prepare('SELECT id, game_type FROM games WHERE id = ?').get(pred.game_id);
      gameCache.set(pred.game_id, g || { id: pred.game_id, game_type: null });
    }
    const game = gameCache.get(pred.game_id);
    const extras = {};
    let evidenceLen = 0;
    if (variant === 'v1_evidence') {
      extras.evidenceBlock = V.loadEvidence(pred, {});
      evidenceLen = extras.evidenceBlock.length;
    } else if (variant === 'v3_baserate') {
      extras.baseline = V.loadBaseline(pred);
    }
    const messages = [
      { role: 'system', content: V.buildSystemPrompt(variant) },
      { role: 'user', content: V.buildUserPrompt(pred, game, extras) },
    ];
    return { messages: messages, evidenceLen: evidenceLen, extract: V.extractImpliedProb, statement: pred.statement };
  };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch (e) { return { tag: TAG, done: {}, calls: 0, cost: 0, failures: [], stop_reason: null, started_at: new Date().toISOString() }; }
}
function saveState(st) { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); st.updated_at = new Date().toISOString(); fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 1), 'utf8'); }

// ── 主流程（只在 CLI 直跑时执行；require 零副作用） ─────────────────────────
async function main() {
  const pool = loadPool();
  const anchor = deriveAnchor(pool);
  console.log('[decouple9] 池=' + pool.length + ' 题／' + new Set(pool.map((r) => r.game_id)).size + ' 局 ⇒ 锚题 ' + anchor.length + ' 题');

  // 冻结守卫
  const fr = verifyPreregFreeze();
  console.log('[decouple9] PREREG sha=' + fr.sha256.slice(0, 12) + '… recorded=' + (fr.recorded ? fr.recorded.slice(0, 12) + '…' : '(无)') + ' MATCH=' + fr.match);
  if (!fr.match) { process.stderr.write('[decouple9] 冻结校验失败（PREREG 正文被改或未冻结）⇒ exit 3，零写盘\n'); process.exit(3); }

  if (EMIT_ANCHOR) {
    const out = {
      script: 'p1b/scripts/decouple9-run.cjs', kind: 'anchor-set', version: 1, frozen_at: null,
      rule: {
        pool: Object.assign({}, POOL),
        round1: '前 30 局各取 1 题（局序 j ⇒ 局内位置 j mod m_j）',
        round2: '前 10 局各补 1 题（局内位置 (j+1) mod m_j；单题局跳过）',
      },
      derivable: '任一持有同库者按上式重算须得同一 id 集合（runner 逐题核，不符 exit 3）',
      pool_size: pool.length, pool_games: new Set(pool.map((r) => r.game_id)).size,
      n_questions: anchor.length,
      questions: anchor.map((r) => ({ id: r.id, game_id: r.game_id, outcome: r.outcome, round: r.round, pos: r.pos,
        m: r.m, statement_sha16: sha16(r.statement) })),
      prereg_sha256: fr.sha256,
      generated_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(ANCHOR_PATH), { recursive: true });
    fs.writeFileSync(ANCHOR_PATH, JSON.stringify(out, null, 1), 'utf8');
    console.log('[decouple9] 锚题工件已落 ' + ANCHOR_PATH);
    return { emitted: ANCHOR_PATH, n: anchor.length };
  }

  // 与冻结锚题工件核对（存在则逐题核 + PREREG sha 互锁；缺件＝首跑，不阻断但在报告中如实标）
  let anchorFrozen = null;
  try { anchorFrozen = JSON.parse(fs.readFileSync(ANCHOR_PATH, 'utf8')); } catch (e) { anchorFrozen = null; }
  if (anchorFrozen) {
    if (anchorFrozen.prereg_sha256 && anchorFrozen.prereg_sha256 !== fr.sha256) {
      process.stderr.write('[decouple9] 锚题工件记录的 PREREG sha 与当前冻结件不符 ⇒ exit 3（工件被换？）\n');
      process.exit(3);
    }
    const a = anchor.map((r) => r.id).join(',');
    const b = (anchorFrozen.questions || []).map((q) => q.id).join(',');
    if (a !== b) { process.stderr.write('[decouple9] 锚题集合与冻结工件不符 ⇒ exit 3\n'); process.exit(3); }
    console.log('[decouple9] 锚题与冻结工件一致（' + anchor.length + ' 题）；工件 prereg_sha256 互锁 ✓');
  } else {
    console.log('[decouple9] ⚠ 无冻结锚题工件（' + ANCHOR_PATH + '）——本次运行将派生并落工件（首跑）');
  }

  // LLM 通道（生产同源：createProvidersStore + resolveLlmOptions + llmChat.chatText）
  const { createProvidersStore } = require(path.join(ROOT, 'p1b', 'src', 'providersStore.js'));
  const { resolveLlmOptions, describeEffective } = require(path.join(ROOT, 'p1b', 'src', 'llmOptions.js'));
  const llmChat = require(path.join(ROOT, 'p1b', 'src', 'lib', 'llmChat.js'));
  const dbMod = require(path.join(ROOT, 'p1b', 'src', 'deps.js')).db;
  dbMod.init(DB_PATH);
  const store = createProvidersStore();
  const options = resolveLlmOptions({ store: store });
  const eff = describeEffective({ store: store, options: options });
  const build = makePromptBuilder();

  if (DRY) {
    const rows = [];
    for (const q of anchor) {
      for (const a of ARMS) {
        const b = build(q.id, a.variant);
        const payload = JSON.stringify(b.messages);
        rows.push({ pid: q.id, arm: armKey(a), prompt_sha16: sha16(payload), prompt_len: payload.length, evidence_len: b.evidenceLen });
      }
    }
    const byArm = {};
    for (const r of rows) { const k = r.arm; byArm[k] = byArm[k] || { n: 0, min: 1e9, max: 0 }; byArm[k].n++; byArm[k].min = Math.min(byArm[k].min, r.prompt_len); byArm[k].max = Math.max(byArm[k].max, r.prompt_len); }
    // 重复臂同题 prompt 逐字节一致性（阴性对照有效性的前提）
    let same = 0, diff = [];
    for (const q of anchor) {
      const a1 = rows.find((r) => r.pid === q.id && r.arm === 'v1_evidence@T0.2#1');
      const a2 = rows.find((r) => r.pid === q.id && r.arm === 'v1_evidence@T0.2#2');
      if (a1 && a2 && a1.prompt_sha16 === a2.prompt_sha16) same++; else diff.push(q.id);
    }
    const out = { mode: 'DRY', db: DB_PATH, llm: { mode: eff.mode, model: eff.model, base_url: eff.base_url, key_source: eff.key_source, reasoning_effort: eff.reasoning_effort },
      anchor_n: anchor.length, conditions: rows.length, by_arm: byArm, repeat_prompt_identical: { same: same, diff_pids: diff },
      sample_rows: rows.slice(0, 3) };
    console.log(JSON.stringify(out, null, 1));
    if (REPORT_JSON) fs.writeFileSync(path.resolve(REPORT_JSON), JSON.stringify(out, null, 1), 'utf8');
    return out;
  }

  // ── 真跑 ──
  if (eff.mode !== 'LIVE') { process.stderr.write('[decouple9] LLM 非 LIVE（mode=' + eff.mode + '）⇒ exit 2 零调用\n'); process.exit(2); }
  fs.mkdirSync(path.dirname(OUT_JSONL), { recursive: true });
  const st = loadState();
  let questions = LIMIT ? anchor.slice(0, LIMIT) : anchor;
  if (QSHARDS > 1) {                                        // 按题连续切块（同题恒同 worker）
    const per = Math.ceil(questions.length / QSHARDS);
    questions = questions.slice(QSHARD * per, Math.min(questions.length, (QSHARD + 1) * per));
    console.log('[decouple9] 分片 ' + QSHARD + '/' + QSHARDS + ' ⇒ 本题片 ' + questions.length + ' 题（' + questions[0].id + '..' + questions[questions.length - 1].id + '）');
  }
  const conditions = [];
  for (const q of questions) for (const a of ARMS) conditions.push({ pid: q.id, a: a, key: q.id + '|' + armKey(a) });

  // 重试模式：从 JSONL（**全部 tag**）定位「至今未成功」的条件 ⇒ **白名单过滤 + 从 state 摘除** ⇒ 只重跑这些。
  // ★修正（本批自查）：首版是「清 state 后跑全集」⇒ 忘带 --qshard 时会把其他分片已成功的条件全部重跑
  //   （实测发生：154 行重复执行，浪费且污染「同批」语义）。现改为白名单，且不依赖 tag（跨分片统一补漏）。
  if (RETRY) {
    const seen = new Map();
    if (fs.existsSync(OUT_JSONL)) {
      for (const l of fs.readFileSync(OUT_JSONL, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        let r; try { r = JSON.parse(l); } catch (e) { continue; }
        const k = r.pid + '|' + r.arm;
        if (!seen.has(k) || r.extracted) seen.set(k, r);      // 首个成功行优先（与判据机同口径）
      }
    }
    const bad = new Set();
    for (const c of conditions) { const r = seen.get(c.key); if (!r || !r.extracted) bad.add(c.key); }
    const kept = conditions.filter((c) => bad.has(c.key));
    conditions.length = 0;
    for (const c of kept) conditions.push(c);
    let cleared = 0;
    for (const c of conditions) if (st.done[c.key]) { delete st.done[c.key]; cleared++; }
    st.retry_at = new Date().toISOString(); st.retry_n = conditions.length;
    console.log('[decouple9] 重试模式：未成功条件 ' + conditions.length + ' 个（白名单；已从 state 摘除 ' + cleared + ' 个）');
    if (!conditions.length) { console.log('[decouple9] 无需重试 ⇒ 退出（零调用）'); return { mode: 'RETRY', n: 0 }; }
  }

  let stop = null, done = 0, skipped = 0;
  const t0 = Date.now();
  for (const c of conditions) {
    if (st.done[c.key]) { skipped++; continue; }
    if (st.calls + 1 > MAX_CALLS) { stop = { reason: 'max_calls', at: c.key, calls: st.calls, cost: st.cost }; break; }
    if (st.cost + CPC > MAX_COST) { stop = { reason: 'max_cost', at: c.key, calls: st.calls, cost: st.cost }; break; }
    const b = build(c.pid, c.a.variant);
    const payload = JSON.stringify(b.messages);
    const row = {
      at: new Date().toISOString(), tag: TAG, run_id: armRunId(c.a), pid: c.pid, variant: c.a.variant,
      temperature: c.a.temperature, copy: c.a.copy, role: c.a.role, arm: armKey(c.a),
      prompt_sha16: sha16(payload), prompt_len: payload.length, evidence_len: b.evidenceLen,
      statement_sha16: sha16(b.statement), model_declared: MODEL_LABEL, resolved_model: eff.model,
      reasoning_effort: eff.reasoning_effort,
    };
    const before = llmChat.getUsageStats();
    const tStart = Date.now();
    try {
      const content = await llmChat.chatText(b.messages, Object.assign({}, options, { temperature: c.a.temperature }));
      const after = llmChat.getUsageStats();
      row.latency_ms = Date.now() - tStart;
      row.implied_prob = b.extract(content);
      row.extracted = row.implied_prob !== null;
      row.verdict_text = content;
      row.usage = { prompt_tokens: after.prompt_tokens - before.prompt_tokens, completion_tokens: after.completion_tokens - before.completion_tokens };
      if (String(content).indexOf('[MOCK') === 0) { stop = { reason: 'mock_fallback_detected', at: c.key }; row.error = 'MOCK fallback'; }
    } catch (e) {
      row.latency_ms = Date.now() - tStart;
      row.implied_prob = null; row.extracted = false; row.verdict_text = null;
      row.error = String((e && e.message) ? e.message : e).slice(0, 300);
      st.failures.push({ key: c.key, error: row.error });
    }
    fs.appendFileSync(OUT_JSONL, JSON.stringify(row) + '\n', 'utf8');
    st.calls += 1;
    st.cost = Number((st.cost + CPC).toFixed(6));
    st.done[c.key] = { prob: row.implied_prob, error: row.error || null, at: row.at };
    done++;
    if (done % 20 === 0) { saveState(st); console.log('[decouple9] ' + done + ' 条件完成 / calls=' + st.calls + ' / 计时 ' + Math.round((Date.now() - t0) / 1000) + 's'); }
    if (stop && stop.reason === 'mock_fallback_detected') break;
  }
  st.stop_reason = stop ? stop.reason : 'complete';
  saveState(st);
  const usage = llmChat.getUsageStats();
  const out = {
    script: 'p1b/scripts/decouple9-run.cjs', mode: 'REAL', tag: TAG, db: DB_PATH,
    llm: { mode: eff.mode, model: eff.model, base_url: eff.base_url, key_source: eff.key_source, reasoning_effort: eff.reasoning_effort },
    anchor_n: anchor.length, questions_this_run: questions.length, conditions_total: conditions.length,
    completed_this_run: done, skipped_done: skipped, calls: st.calls, est_cost_cny: st.cost,
    usage: usage, measured_cost_cny_at_3_per_m: Number((usage.total_tokens / 1e6 * 3).toFixed(4)),
    elapsed_s: Math.round((Date.now() - t0) / 1000), stop_reason: out_stop(stop), stop_detail: stop,
    failures: st.failures.slice(-20), failure_n: st.failures.length,
    jsonl: OUT_JSONL, state_file: STATE_PATH,
    prereg_sha256: fr.sha256, generated_at: new Date().toISOString(),
  };
  function out_stop(s) { return s ? s.reason : 'complete'; }
  console.log('[decouple9] 完成 ' + done + ' 条件／calls=' + st.calls + '／usage=' + JSON.stringify(usage)
    + '／measured≈¥' + out.measured_cost_cny_at_3_per_m + '／' + out.elapsed_s + 's／stop=' + out.stop_reason);
  if (REPORT_JSON) fs.writeFileSync(path.resolve(REPORT_JSON), JSON.stringify(out, null, 1), 'utf8');
  return out;
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => {
    process.stderr.write('[decouple9] FAIL ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  });
}

module.exports = { deriveAnchor, armKey, armRunId, sha16, ARMS, POOL };
