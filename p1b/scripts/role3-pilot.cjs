'use strict';
/*
 * p1b/scripts/role3-pilot.cjs —— 角色③「情景分支生成器」· LLM 分解小批（2026-09-19）
 *
 * 判据（**冻结，引用不新造**）：蓝图 20 号件 §第 4 条「角色③情景分支生成器＋分支概率合成器」：
 *   **先决＝子题过锚率 ≥80%**（10 号件原文判据；不设 Brier 承诺）。测量通道＝`anchor-gate.cjs`（Q0 三问）。
 *
 * 协议（本批锁定，落盘可审计）：
 *   ① **父题池**＝账本内未解 `oddsapi_h2h` 且开赛日 > 今日(UTC) 的题（读盘实测 13 场，2026-09-20/10-10/10-11/10-12）。
 *      ★为何只有英超：过锚率的公平测量要求「锚基建在位」（kind 已注册∧解析器自建 URL）——账本里同时满足
 *        「未来事件＋已注册 kind＋可分解结构」的父题**只有比赛族**（气象未来题为 0、对局域 kind 未在
 *        corpus-resolve 注册 ⇒ 纳入会构造性判 no_anchor＝测的是仪器缺口不是角色质量，照 kNN 对 1 教训先行核池）。
 *      池约束如实披露；对局域分支须先扩注册表＝版本递进须拍板，本批不做。
 *   ② **提议**＝每父题 1 次 LLM 调用（temperature 0.2；reasoning_effort=low；llmChat 进程内直连，key 不出进程）。
 *      LLM **只出分支结构**（kind/pick/child_statement），**禁出任何概率**（铁律④）。
 *   ③ **分母＝全部提议分支**：JSON 解析失败、契约违约（kind/pick/match_id 不合法）都作为**失败候选**计入
 *      分母（resolve=null ⇒ gate 判 no_anchor），禁静默丢弃（「我没观测到 ≠ 不存在」）。
 *   ④ **prob（Q0-3 恒定性代理）**＝父题 evidence 的 `marketPrice.p_{pick}`（去水共识，机械来源、逐行留痕；
 *      **仅本测量用**，零账本写，不触「不把市场价塞 baseRate」的生产铁律——该铁律管账本行，本批不入账本）。
 *   ⑤ 过锚率＝anchor-gate.cjs 的 pass/total（Q0-1∧Q0-2∧Q0-3）；**判据 ≥80%**。
 *      另披露：inBand（出题器红线，不混判据）、分区完备性（proposed picks 是否并成 home/draw/away 全集）。
 *   ⑥ 零账本写／8787 零接触；产物只落 `p1b/sim/out/`（运行时日期戳命名——禁写死生成日，2026-09-19 坑②）。
 *
 * 用法：
 *   node p1b/scripts/role3-pilot.cjs --dry-run              # 零 LLM：父题池＋prompt 预览＋零写盘
 *   node p1b/scripts/role3-pilot.cjs --limit 1 --tag smoke  # 真跑 1 父题（烟测/成本实测）
 *   node p1b/scripts/role3-pilot.cjs                        # 真跑全部父题
 *   node p1b/scripts/anchor-gate.cjs --candidates p1b/sim/out/role3-pilot-<date>.rows.json --label role3-分解小批
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const eq = process.argv.find((a) => a.startsWith('--' + n + '=')); if (eq) return eq.split('=').slice(1).join('='); const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;

const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const TAG = arg('tag', 'main');
const LIMIT = Number(arg('limit', 0)) || 0;
const MAX_CALLS = Number(arg('max-calls', 20)) || 20;
const TEMPERATURE = Number(arg('temperature', 0.2));
const DRY = FLAG('dry-run');
const DATE_STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const OUT_JSONL = path.join(OUT_DIR, 'role3-pilot-' + DATE_STAMP + '.jsonl');
const OUT_ROWS = path.join(OUT_DIR, 'role3-pilot-' + DATE_STAMP + '.rows.json');
const STATE_PATH = path.join(ROOT, '.tmp', 'role3-pilot-state-' + TAG + '.json');

const PICKS = ['home', 'draw', 'away'];
const PICK_ZH = { home: '主队获胜', draw: '平局', away: '客队获胜' };

function sha16(s) { return require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16); }

// ── 父题派生（读盘，非回忆）──
function deriveParents() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db.prepare(
    "SELECT id, statement, evidence_json, matures_at FROM predictions" +
    " WHERE resolved_at IS NULL AND json_extract(evidence_json,'$[0].resolve.kind')='oddsapi_h2h' ORDER BY id").all();
  db.close();
  const today = new Date().toISOString().slice(0, 10);
  const parents = [], excluded = [];
  for (const r of rows) {
    const ev = JSON.parse(r.evidence_json || '[]')[0] || {};
    const rz = ev.resolve || {};
    const m = /英超\s+(.+?)\s+vs\s+(.+?)（(\d{4}-\d{2}-\d{2}) 开赛）/.exec(String(r.statement || ''));
    const commence = String(rz.commence_utc || '').slice(0, 10);
    const rec = { id: r.id, statement: r.statement, match_id: rz.match_id, league: rz.league || 'soccer_epl', commence_utc: rz.commence_utc, commence_day: commence, home: m ? m[1] : null, away: m ? m[2] : null, event_day: m ? m[3] : commence, market: ev.marketPrice || null };
    if (commence && commence > today) parents.push(rec); else excluded.push({ id: r.id, why: '开赛日 ≤ 今日(UTC) ⇒ 子题 cutoff 构造性 leak，不入父题池', commence_day: commence });
  }
  return { parents, excluded, all_unresolved: rows.length };
}

// ── 提示词（单一实现；契约给足、分区不给答案）──
function buildPrompt(p) {
  const system = '你是「情景分支生成器」（预测系统的结构化角色）。任务：把一场比赛的结局空间，分解为若干**可独立机检的子命题**——每个子命题将来都能被机械取数单独判定真伪。你只输出分支结构（JSON），**绝对禁止输出任何概率、百分比或赔率数值**（铁律）。';
  const user = [
    '【父题】' + p.statement,
    '【比赛】联赛=' + p.league + '｜主队=' + p.home + '｜客队=' + p.away + '｜开赛(UTC)=' + p.commence_utc + '｜match_id=' + p.match_id,
    '',
    '【机检契约（子命题的唯一合法取数路径）】',
    'kind 固定为 "oddsapi_h2h"；机检源＝The Odds API /v4/scores 的完赛比分。',
    'resolve 必须恰含四个字段：{"kind":"oddsapi_h2h","league":"' + p.league + '","match_id":"' + p.match_id + '","pick":"home"|"draw"|"away"}',
    'pick 语义：home=主队获胜，draw=平局，away=客队获胜。不得发明其他 pick 值或其他 kind。',
    '',
    '【任务】',
    '把这场比赛「90 分钟结局」的情景空间分解为若干互斥子命题：每个子命题都能用上面的机检契约**独立**判定真伪，合起来覆盖比赛结局的主要情景。',
    '输出：只输出一个 JSON 数组（约 3 个对象，不要任何多余文本、不要代码块围栏），每个对象形如：',
    '{"branch_text":"<人话分支名，不超过12字>","child_statement":"【forward】英超 <主队> vs <客队>（<' + p.event_day + '> 开赛）<主队获胜|平局|客队获胜>","resolve":{"kind":"oddsapi_h2h","league":"' + p.league + '","match_id":"' + p.match_id + '","pick":"<home|draw|away>"},"rationale":"<一句话：该分支为何可独立机检>"}',
  ].join('\n');
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
}

// ── 机械解析与契约校验（失败≠丢弃，计分母）──
function parseBranches(content, p) {
  const out = [];
  let arr = null, parseErr = null;
  const s = String(content || '');
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i < 0 || j <= i) parseErr = '输出中找不到 JSON 数组';
  else { try { arr = JSON.parse(s.slice(i, j + 1)); } catch (e) { parseErr = 'JSON 解析失败: ' + String(e.message).slice(0, 120); } }
  if (parseErr || !Array.isArray(arr)) {
    out.push({ valid: false, reason: parseErr || '非数组', branch_text: null, cand: { statement: '（解析失败）' + s.slice(0, 80), resolve: null, meta: { phase: 'role3_pilot_unparseable', cutoff: null }, prob: null } });
    return out;
  }
  for (const item of arr) {
    const errs = [];
    const rz = (item && item.resolve) || {};
    if (!item || typeof item !== 'object') errs.push('非对象');
    if (rz.kind !== 'oddsapi_h2h') errs.push('kind 违约: ' + JSON.stringify(rz.kind));
    if (rz.league !== p.league) errs.push('league 违约: ' + JSON.stringify(rz.league));
    if (String(rz.match_id) !== String(p.match_id)) errs.push('match_id 违约');
    if (PICKS.indexOf(rz.pick) < 0) errs.push('pick 违约: ' + JSON.stringify(rz.pick));
    if (!item || typeof item.child_statement !== 'string' || !item.child_statement.trim()) errs.push('child_statement 缺失');
    if (typeof (item && item.rationale) !== 'string') errs.push('rationale 缺失');
    const prob = p.market && isFinite(p.market['p_' + rz.pick]) ? Number(p.market['p_' + rz.pick]) : null;
    if (errs.length) {
      out.push({ valid: false, reason: errs.join('；'), branch_text: item && item.branch_text || null, cand: { statement: '（契约违约）' + JSON.stringify(item).slice(0, 120), resolve: null, meta: { phase: 'role3_pilot_invalid', cutoff: null }, prob: null } });
    } else {
      out.push({ valid: true, reason: null, branch_text: item.branch_text, cand: { statement: item.child_statement, resolve: { kind: 'oddsapi_h2h', league: p.league, match_id: p.match_id, pick: rz.pick }, meta: { phase: 'role3_pilot', cutoff: null, eventDate: p.event_day, parent_prediction_id: p.id, branch_text: item.branch_text, rationale: item.rationale }, prob: prob, prob_source: 'parent.marketPrice.p_' + rz.pick + '（去水共识；仅本测量用，零账本写）' } });
    }
  }
  return out;
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return { done: {}, calls: 0 }; } }
function saveState(st) { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 1), 'utf8'); }

async function main() {
  const { parents, excluded, all_unresolved } = deriveParents();
  const picked = LIMIT ? parents.slice(0, LIMIT) : parents;
  console.log('[role3] 未解 odds 题=' + all_unresolved + '｜父题池（开赛>今日UTC）=' + parents.length + '｜本轮跑=' + picked.length + '｜排除=' + excluded.length);
  for (const e of excluded) console.log('  [排除] id=' + e.id + ' ' + e.why + '（' + e.commence_day + '）');

  if (DRY) {
    const b = buildPrompt(parents[0]);
    const out = { mode: 'DRY', parents_total: parents.length, this_run: picked.length, excluded, sample_prompt: b, parent_ids: parents.map((p) => p.id) };
    console.log(JSON.stringify(out, null, 1).slice(0, 2600));
    return out;
  }

  const { createProvidersStore } = require(path.join(ROOT, 'p1b', 'src', 'providersStore.js'));
  const { resolveLlmOptions, describeEffective } = require(path.join(ROOT, 'p1b', 'src', 'llmOptions.js'));
  const llmChat = require(path.join(ROOT, 'p1b', 'src', 'lib', 'llmChat.js'));
  const store = createProvidersStore();
  const options = resolveLlmOptions({ store });
  const eff = describeEffective({ store, options });
  if (eff.mode !== 'LIVE') { process.stderr.write('[role3] LLM 非 LIVE（mode=' + eff.mode + '）⇒ exit 2 零调用\n'); process.exit(2); }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const st = loadState();
  const cutoffNow = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T') + '+08:00';
  const t0 = Date.now();
  let calls = 0, stop = null;
  const allRows = [];

  for (const p of picked) {
    const key = 'pid-' + p.id;
    if (st.done[key]) { console.log('[role3] 跳过已完成 ' + key); continue; }
    if (st.calls + 1 > MAX_CALLS) { stop = { reason: 'max_calls', at: key }; break; }
    const b = buildPrompt(p);
    const payload = JSON.stringify(b.messages);
    const row = { at: new Date().toISOString(), tag: TAG, run_id: 'role3-pilot-' + TAG + '-' + DATE_STAMP, parent_prediction_id: p.id, prompt_sha16: sha16(payload), prompt_len: payload.length, model_declared: 'tokenrhythm/glm-5.3-flash', resolved_model: eff.model, reasoning_effort: eff.reasoning_effort, temperature: TEMPERATURE };
    const before = llmChat.getUsageStats();
    const tStart = Date.now();
    try {
      const content = await llmChat.chatText(b.messages, Object.assign({}, options, { temperature: TEMPERATURE }));
      const after = llmChat.getUsageStats();
      row.latency_ms = Date.now() - tStart;
      row.usage = { prompt_tokens: after.prompt_tokens - before.prompt_tokens, completion_tokens: after.completion_tokens - before.completion_tokens };
      if (String(content).indexOf('[MOCK') === 0) { row.error = 'MOCK fallback'; stop = { reason: 'mock_fallback_detected', at: key }; }
      const branches = parseBranches(content, p);
      row.branches_proposed = branches.length;
      row.branches_valid = branches.filter((x) => x.valid).length;
      row.branches = branches.map((x) => ({ valid: x.valid, reason: x.reason, branch_text: x.branch_text }));
      for (const br of branches) {
        const cand = Object.assign({}, br.cand);
        if (cand.meta && cand.meta.phase === 'role3_pilot') cand.meta.cutoff = cutoffNow;
        allRows.push(Object.assign(cand, { _parent_id: p.id, _valid: br.valid, _invalid_reason: br.reason }));
      }
      row.content_head = String(content).slice(0, 200);
    } catch (e) {
      row.latency_ms = Date.now() - tStart;
      row.error = String((e && e.message) ? e.message : e).slice(0, 300);
      allRows.push({ statement: '（调用失败）' + row.error.slice(0, 80), resolve: null, meta: { phase: 'role3_pilot_call_failed', cutoff: null }, prob: null, _parent_id: p.id, _valid: false, _invalid_reason: row.error });
    }
    fs.appendFileSync(OUT_JSONL, JSON.stringify(row) + '\n', 'utf8');
    st.calls += 1; st.done[key] = { at: row.at, error: row.error || null };
    calls++;
    console.log('[role3] ' + key + ' 完成：提议 ' + row.branches_proposed + ' 分支（有效 ' + row.branches_valid + '）' + (row.error ? '｜error=' + row.error : ''));
  }
  saveState(st);

  // 汇总 rows.json（分母＝全部提议分支；含解析失败/违约/调用失败）
  const existing = (() => { try { return JSON.parse(fs.readFileSync(OUT_ROWS, 'utf8')); } catch (e) { return null; } })();
  const merged = existing && Array.isArray(existing.rows) ? existing.rows.concat(allRows) : allRows;
  fs.writeFileSync(OUT_ROWS, JSON.stringify({ label: 'role3-分解小批-' + TAG, generated_at: new Date().toISOString(), cutoff_note: '子题 cutoff＝提议时刻（ runner 注入），事件日=开赛日 ⇒ 未来事件无泄漏', rows: merged }, null, 1), 'utf8');

  const usage = llmChat.getUsageStats();
  const summary = {
    script: 'p1b/scripts/role3-pilot.cjs', mode: 'REAL', tag: TAG, db: DB_PATH,
    llm: { mode: eff.mode, model: eff.model, reasoning_effort: eff.reasoning_effort, temperature: TEMPERATURE },
    parents_total: parents.length, excluded, this_run: picked.length, calls_this_run: calls, state_calls_total: st.calls,
    branches_proposed: merged.length, branches_valid: merged.filter((r) => r._valid).length,
    usage, elapsed_s: Math.round((Date.now() - t0) / 1000), stop_reason: stop ? stop.reason : (calls + 0 === picked.length ? 'complete' : 'partial'),
    jsonl: OUT_JSONL, rows_json: OUT_ROWS, generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(OUT_ROWS.replace('.rows.json', '.summary.json'), JSON.stringify(summary, null, 1), 'utf8');
  console.log('[role3] 完成 calls=' + calls + '｜提议分支（累计）=' + merged.length + '｜usage=' + JSON.stringify(usage));
  console.log('[role3] 下一步：node p1b/scripts/anchor-gate.cjs --candidates ' + path.relative(ROOT, OUT_ROWS) + ' --label role3-分解小批');
  return summary;
}

if (require.main === module) { main().then(() => process.exit(0)).catch((e) => { process.stderr.write('[role3] FAIL ' + (e && e.stack ? e.stack : e) + '\n'); process.exit(1); }); }
module.exports = { deriveParents, buildPrompt, parseBranches };
