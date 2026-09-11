'use strict';
/**
 * p1b/sim/sim-loop.cjs —— 自对局 loop（方案 C·sim 源；宪法=docs/specs/2026-09-11-全拟真模拟-design.md）
 * M0 冒烟：一夜狼 6 人（狼×2/民×4），单夜单刀，昼 1 轮发言，投票放逐，放逐即结算。
 * 设计要点：
 *  - 状态机纯代码（角色分配 crypto.randomInt；死亡/投票结算/胜负程序化）；LLM 只出 JSON：
 *    夜刀 {"target_seat":N}；发言 {"speech":"..","claims":[{subject_seat,predicate,object}]}；投票 {"vote_seat":N}
 *  - 直连 p1a db.js v1 对象式接口；games.source/meta 列 additive 补齐（禁破坏既有列），偏差记录在 summary.deviations
 *  - 真值层（角色/夜行动/票型/胜负）写 games.meta，不进公开 events；预注册五元组来自 prereg.json（开跑前冻结）
 *  - 公开层导出 replay md（对齐 p0-replay 样板）+ truth md；哨兵另行跑 sentinel.cjs
 * 用法：node sim-loop.cjs --prereg p1b/sim/prereg.json --db <p1a.db 路径> --out p1b/sim/out --name sim-ownww6p-m0-run1
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbApi = require('../../p1a-terminal/src/db.js');
const { chatOnce } = require('./llm-client.cjs');

function parseArgs(argv) {
  const a = { stage: '1', prereg: 'p1b/sim/prereg.json', db: path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db'), out: path.join(__dirname, 'out'), name: 'sim-ownww6p-m0-run1' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--prereg') a.prereg = argv[++i];
    else if (k === '--db') a.db = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--name') a.name = argv[++i];
    else if (k === '--stage') a.stage = argv[++i];
    else if (k === '--seed') a.seed = argv[++i];
  }
  return a;
}

function loadPrereg(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const k of ['seed', 'model', 'temperature', 'variant', 'prompt_version']) {
    if (j[k] === undefined) throw new Error('prereg 缺五元组字段: ' + k);
  }
  return j;
}

/** mulberry32：投票平票等程序决策用（角色分配走 crypto.randomInt，见任务书） */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function cryptoShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从 LLM 文本里抠 JSON（容忍 ``` 包裹/前后杂text）：取第一个 { 到最后一个 } */
function extractJson(text) {
  const s = String(text).replace(/```(json)?/gi, '');
  const l = s.indexOf('{');
  const r = s.lastIndexOf('}');
  if (l === -1 || r === -1 || r <= l) throw new Error('LLM 输出无 JSON: ' + String(text).slice(0, 120));
  return JSON.parse(s.slice(l, r + 1));
}

/** additive 补齐 games.source/meta 列（只加不改，偏差记录） */
function ensureSimColumns(conn, deviations) {
  const cols = conn.pragma('table_info(games)').map(c => c.name);
  if (!cols.includes('source')) {
    conn.exec("ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'real'");
    deviations.push('ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT real（additive）');
  }
  if (!cols.includes('meta')) {
    conn.exec('ALTER TABLE games ADD COLUMN meta TEXT');
    deviations.push('ALTER TABLE games ADD COLUMN meta TEXT（additive）');
  }
  conn.pragma('busy_timeout = 5000');
}

/** 载入真人发言 few-shot 风格锚（家底 replay 的 E 行，取 2 条） */
function loadStyleAnchors() {
  const f = path.join(__dirname, '..', '..', 'docs', 'sandbox', 'p0-replay', 'replay-werewolf-lyingman-s02e01.md');
  try {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => /^- E-\d+:/.test(l) && l.length > 70);
    return lines.slice(1, 3).map(l => l.replace(/^- E-\d+: /, '').slice(0, 120));
  } catch (e) { return []; }
}
// ── prompt 构建（pv1）────────────────────────────────────────────────
const JSON_RULE = '只输出严格 JSON（禁止 markdown 代码块、禁止任何 JSON 以外字符）。';

function buildSpeechPrompt(ctx) {
  const { seat, role, wolves, deadSeats, streamText, anchors } = ctx;
  const roleText = role === 'werewolf' ? '狼人（你的队友：' + wolves.filter(w => w !== seat).join('、') + '号；仅你知情，暴露队友身份=风险自负）' : '平民';
  return [
    '你是在「一夜终极狼人杀」6 人对局中的 ' + seat + ' 号玩家，正在白天公开发言。',
    JSON_RULE,
    '输出格式：{"speech":"你的公开发言（80-200 字，口语化，像真人打牌聊天：可质疑、可伪装、可带情绪、可引用别人的话）","claims":[{"subject_seat":座位号整数,"predicate":"is_wolf|is_good|claims_role|said 之一","object":"简短宾语，如 狼人/好人/预言家/大家"}]}',
    'claims 只登记你发言里明确说出口的断言（0-3 条），没说就空数组。',
    '你的真实身份：' + roleText + '。当前已死席位：' + (deadSeats.length ? deadSeats.join('、') + '号' : '无') + '。',
    '',
    '【公开信息流（所有玩家可见）】',
    streamText,
    '',
    anchors.length ? '【真人发言语气参考（学这个味道，禁 AI 腔）】\n- ' + anchors.join('\n- ') : '',
    '',
    '轮到你（' + seat + '号）发言。只输出 JSON。',
  ].filter(Boolean).join('\n');
}

function buildVotePrompt(ctx) {
  const { seat, aliveSeats, claimsSummary } = ctx;
  return [
    '你是「一夜终极狼人杀」6 人局的 ' + seat + ' 号玩家，讨论结束，现在投票放逐一人。',
    JSON_RULE,
    '输出格式：{"vote_seat":整数座位号,"reasoning":"一句内心盘算（不公开）"}',
    '只能投存活者，不能投自己。存活席位：' + aliveSeats.filter(s => s !== seat).join('、') + '号。',
    '',
    '【本轮发言声称速记】', claimsSummary || '（无）', '',
    '轮到你（' + seat + '号）投票。只输出 JSON。',
  ].join('\n');
}

function buildWolfKillPrompt(ctx) {
  const { wolves, aliveGood } = ctx;
  return [
    '你们（' + wolves.join('、') + '号）是「一夜终极狼人杀」6 人局的两只狼人，正在夜里统一决定今晚刀杀目标。',
    JSON_RULE,
    '输出格式：{"target_seat":整数座位号}',
    '只能杀好人阵营存活者：' + aliveGood.join('、') + '号。两人商量一个即可（你就是记票的）。',
    '只输出 JSON。',
  ].join('\n');
}

/** LLM 调用封装：1 次重试（附纠偏提示），usage 累计，parse 失败计数 */
async function callJson(messages, { temperature, model, usageAgg, retries = 1, maxTokens = 2000 }) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const msgs = i === 0 ? messages : messages.concat([{ role: 'user', content: '上一次输出不是合法 JSON 或缺字段。重新输出：只输出严格 JSON。' }]);
      const r = await chatOnce(msgs, { model, temperature, timeoutMs: 60000, maxTokens: i === 0 ? maxTokens : maxTokens + 1500 }); // 重试自增 headroom：glm reasoning 偶发吃穿 max_tokens 致 content 空（M1 熔断根因）
      if (r.usage) { usageAgg.calls += 1; usageAgg.prompt_tokens += r.usage.prompt_tokens || 0; usageAgg.completion_tokens += r.usage.completion_tokens || 0; }
      else usageAgg.calls += 1;
      return { obj: extractJson(r.content), raw: r.content };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── 主流程 ───────────────────────────────────────────────────────────
/** 同名 sim 残局清理（上次运行被杀的半成品局；只删 source='sim' 同名局，真人局永不触碰） */
function cleanupPartialSimGames(conn, name) {
  const rows = conn.prepare("SELECT id FROM games WHERE name=? AND (source='sim' OR game_type LIKE 'werewolf_sim_%')").all(name);
  for (const g of rows) {
    conn.prepare('DELETE FROM claims WHERE event_id IN (SELECT id FROM events WHERE game_id=?)').run(g.id);
    conn.prepare('DELETE FROM actions WHERE event_id IN (SELECT id FROM events WHERE game_id=?)').run(g.id);
    conn.prepare('DELETE FROM events WHERE game_id=?').run(g.id);
    conn.prepare('DELETE FROM players WHERE game_id=?').run(g.id);
    conn.prepare('DELETE FROM games WHERE id=?').run(g.id);
  }
  return rows.length;
}

async function main(argv) {
  const args = parseArgs(argv || process.argv);
  fs.mkdirSync(args.out, { recursive: true });
  const stepLogPath = path.join(args.out, args.name + '.steps.log');
  const stepLog = msg => { fs.appendFileSync(stepLogPath, new Date().toISOString() + ' ' + msg + '\n'); };
  stepLog('start');
  const prereg = loadPrereg(path.resolve(args.prereg));
  if (args.seed) prereg.seed = Number(args.seed); // M1 批量：同五元组换 seed（prereg-batch.json 冻结清单）
  const rng = mulberry32(prereg.seed);
  const deviations = [];
  const usageAgg = { calls: 0, prompt_tokens: 0, completion_tokens: 0, parse_fallback: 0 };
  if (args.stage === '2') { await runStage2(args, prereg); return; }

  // 建局
  stepLog('db init: ' + args.db);
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  ensureSimColumns(conn, deviations);
  const cleaned = cleanupPartialSimGames(conn, args.name);
  if (cleaned) stepLog('cleaned partial sim games: ' + cleaned);
  const game = dbApi.createGame(args.name, 'werewolf_sim_6p_onenight', 6);
  stepLog('game created id=' + game.id);
  const gid = game.id;

  // 角色分配（crypto.randomInt 洗牌，任务书指定；真值只进 meta）
  const roles = cryptoShuffle(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  const seatRole = {}; roles.forEach((r0, i) => { seatRole[i + 1] = r0; });
  const wolves = [1, 2, 3, 4, 5, 6].filter(s => seatRole[s] === 'werewolf');
  const villagers = [1, 2, 3, 4, 5, 6].filter(s => seatRole[s] === 'villager');
  const anchors = loadStyleAnchors();
  stepLog('roles assigned; wolves=' + wolves.join(',') + ' anchors=' + anchors.length);

  // ── 夜 1：狼刀（1 次调用，狼队统一决策；actions 记在夜 system 事件上）
  const evNight = dbApi.addEvent({ game_id: gid, day: 1, phase: 'night', type: 'system', actor_seat: null, raw_text: '夜幕降临，全体闭眼；狼人睁眼，商量今晚刀杀目标。' });
  const aliveGoodNight = villagers.slice();
  const kill = await callJson([{ role: 'user', content: buildWolfKillPrompt({ wolves, aliveGood: aliveGoodNight }) }], { temperature: prereg.temperature, model: prereg.model, usageAgg });
  const killTarget = Number(kill.obj.target_seat);
  if (!villagers.includes(killTarget)) throw new Error('狼刀目标非法: ' + killTarget);
  dbApi.addAction({ event_id: evNight.id, seat: wolves[0], action: 'kill_target', target_seat: killTarget, result: '夜刀（狼队统一决策，' + wolves.join('+') + '号）' });
  stepLog('night kill done target=' + killTarget + ' calls=' + usageAgg.calls);

  // ── 天亮：死亡公布（程序结算）
  const victim = killTarget;
  const deadSeats = [victim];
  const evDawn = dbApi.addEvent({ game_id: gid, day: 1, phase: 'day', type: 'death', actor_seat: victim, raw_text: '天亮了。公布夜 1 死亡：' + victim + ' 号死亡，无遗言（一夜狼版型）。' });

  // ── 昼 1：存活者依次发言（发言+声称同调用双输出）
  const aliveAfterNight = [1, 2, 3, 4, 5, 6].filter(s => !deadSeats.includes(s));
  // 两批并行（批间可见批内同快照）：reasoning 模型单调用 15-32s，串行超 120s 命令上限；偏差已记 PROGRESS
  const half = Math.ceil(aliveAfterNight.length / 2);
  const batches = [aliveAfterNight.slice(0, half), aliveAfterNight.slice(half)];
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    stepLog('speech batch' + (bi + 1) + ' seats=' + batch.join(',') + ' start');
    const st = dbApi.loadGameState(gid);
    const streamText = st.events.map(e => 'E-' + e.seq + ': ' + e.raw_text).join('\n');
    await Promise.allSettled(batch.map(async seat => {
      const p = buildSpeechPrompt({ seat, role: seatRole[seat], wolves, deadSeats, streamText, anchors });
      let speech = '', claims = [], fallback = false;
      try {
        const r = await callJson([{ role: 'user', content: p }], { temperature: prereg.temperature, model: prereg.model, usageAgg });
        speech = String(r.obj.speech || '').trim();
        claims = Array.isArray(r.obj.claims) ? r.obj.claims : [];
      } catch (e) { fallback = true; usageAgg.parse_fallback += 1; speech = '（发言解析失败占位：' + String(e.message).slice(0, 80) + '）'; }
      const ev = dbApi.addEvent({ game_id: gid, day: 1, phase: 'day', type: 'statement', actor_seat: seat, raw_text: seat + ' 号：' + speech });
      stepLog('speech seat=' + seat + ' len=' + speech.length + ' claims=' + claims.length + ' calls=' + usageAgg.calls);
      for (const c of claims.slice(0, 3)) {
        const sub = Number(c.subject_seat), pred = String(c.predicate), obj = String(c.object || '').slice(0, 40);
        if (!Number.isInteger(sub) || sub < 1 || sub > 6) continue;
        if (!['is_wolf', 'is_good', 'claims_role', 'said'].includes(pred)) continue;
        dbApi.addClaim({ event_id: ev.id, seat, subject_seat: sub, predicate: pred, object: obj, extracted_by: 'sim-llm' });
      }
    }));
  }

  // ── 投票：存活者各 1 票（1 次调用/人），平票 seed 破平
  const evVote = dbApi.addEvent({ game_id: gid, day: 1, phase: 'day', type: 'system', actor_seat: null, raw_text: '发言结束，全体投票放逐。' });
  const votes = {};
  await Promise.allSettled(aliveAfterNight.map(async seat => {
    const st = dbApi.loadGameState(gid);
    const claimsSummary = st.claims.map(c => c.seat + '号说' + c.subject_seat + '号:' + c.object).join('；').slice(0, 400);
    try {
      const r = await callJson([{ role: 'user', content: buildVotePrompt({ seat, aliveSeats: aliveAfterNight, claimsSummary }) }], { temperature: prereg.temperature, model: prereg.model, usageAgg, maxTokens: 2000 });
      let target = Number(r.obj.vote_seat);
      if (!aliveAfterNight.includes(target) || target === seat) target = aliveAfterNight.find(s => s !== seat); // 非法票改投首位存活者（偏差记 PROGRESS）
      votes[seat] = target;
      dbApi.addAction({ event_id: evVote.id, seat, action: 'vote', target_seat: target, result: r.obj.reasoning ? String(r.obj.reasoning).slice(0, 60) : null });
      stepLog('vote seat=' + seat + ' -> ' + target + ' calls=' + usageAgg.calls);
    } catch (e) {
      votes[seat] = 0;
      dbApi.addAction({ event_id: evVote.id, seat, action: 'abstain', result: 'llm-fail: ' + String(e && e.message).slice(0, 40) });
      stepLog('vote seat=' + seat + ' ABSTAIN(llm-fail)');
    }
  }));
  // ── 阶段拆分：stage1 到投票为止落 meta 返回（结算/导出=stage2 纯本地）；规避 120s 命令上限
  const meta1 = {
    stage: 1, source: 'sim', gid,
    prereg: { seed: prereg.seed, model: prereg.model, temperature: prereg.temperature, prompt_version: prereg.prompt_version, variant: prereg.variant, provider: prereg.provider },
    truth: { roles: seatRole, wolves, villagers, night: { kill_target: killTarget, kill_by: wolves }, deaths: { night1: victim } },
    stage1: { votes, alive_after_night: aliveAfterNight },
    qc: Object.assign({ call_target: '<=40', style_anchor_count: anchors.length }, usageAgg),
    deviations,
  };
  conn.prepare('UPDATE games SET source=?, meta=? WHERE id=?').run('sim', JSON.stringify(meta1), gid);
  stepLog('stage1 done gid=' + gid + ' votes=' + JSON.stringify(votes));
  dbApi.closeCurrent();
  return;

}

/** stage2：纯本地结算+导出（读 stage1 meta，零 LLM 调用，秒级） */
async function runStage2(args, prereg) {
  const stepLog = msg => fs.appendFileSync(path.join(args.out, args.name + '.steps.log'), new Date().toISOString() + ' ' + msg + '\n');
  stepLog('stage2 start');
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  conn.pragma('busy_timeout = 5000');
  const row = conn.prepare("SELECT id, meta FROM games WHERE name=? AND source='sim' ORDER BY id DESC LIMIT 1").get(args.name);
  if (!row) throw new Error('stage2 找不到 stage1 局: ' + args.name);
  const gid = row.id;
  const m = JSON.parse(row.meta || '{}');
  if (m.stage !== 1) throw new Error('meta.stage!=' + m.stage + '，stage1 未完成');
  const truth = m.truth;
  const seatRole = truth.roles, wolves = truth.wolves, villagers = truth.villagers;
  const killTarget = truth.night.kill_target, victim = truth.deaths.night1;
  const votes = m.stage1.votes;
  const usageAgg = m.qc, deviations = m.deviations || [];
  const rng = mulberry32(prereg.seed);
  const aliveAfterNight = m.stage1.alive_after_night.slice();
  const tally = {}; for (const s of Object.values(votes)) { if (s > 0) tally[s] = (tally[s] || 0) + 1; }
  const maxV = Object.keys(tally).length ? Math.max(...Object.values(tally)) : 0;
  let tied = Object.keys(tally).map(Number).filter(s => tally[s] === maxV);
  let exiled, tiebreak = null;
  if (!tied.length) { exiled = aliveAfterNight.sort((a, b) => a - b)[Math.floor(rng() * aliveAfterNight.length)]; tiebreak = { method: 'all_abstain_seeded_rng', seed: prereg.seed }; }
  else if (tied.length > 1) { tied.sort((a, b) => a - b); exiled = tied[Math.floor(rng() * tied.length)]; tiebreak = { tied, method: 'seeded_rng', seed: prereg.seed }; }
  else exiled = tied[0];
  dbApi.addEvent({ game_id: gid, day: 1, phase: 'dusk', type: 'death', actor_seat: exiled, raw_text: '计票：' + JSON.stringify(tally) + '。' + exiled + ' 号被放逐出局' + (tiebreak ? '（平票/兜底，seed 破平）' : '') + '。' });
  const result = seatRole[exiled] === 'werewolf' ? 'village_win' : 'wolf_win';
  const resultText = result === 'village_win' ? '好人阵营胜利（放逐了狼人 ' + exiled + ' 号）' : '狼人阵营胜利（放逐的 ' + exiled + ' 号是平民，狼人 ' + wolves.join('、') + ' 号存活）';
  dbApi.addEvent({ game_id: gid, day: 1, phase: 'dusk', type: 'system', actor_seat: null, raw_text: '游戏结束：' + resultText + '。' });
  const meta = {
    stage: 2, source: 'sim', prereg: { seed: prereg.seed, model: prereg.model, temperature: prereg.temperature, prompt_version: prereg.prompt_version, variant: prereg.variant, provider: prereg.provider },
    truth: { roles: seatRole, wolves, villagers, night: { kill_target: killTarget, kill_by: wolves }, deaths: { night1: victim, exile: exiled }, votes, tally, tiebreak, result, result_text: resultText },
    qc: usageAgg,
    deviations,
  };
  conn.prepare('UPDATE games SET source=?, meta=? WHERE id=?').run('sim', JSON.stringify(meta), gid);
  // ── 导出 replay md（对齐 p0-replay 样板）+ truth md
  const st = dbApi.loadGameState(gid);
  const eLines = st.events.map(e => '- E-' + e.seq + ': ' + e.raw_text).join('\n');
  const replay = [
    '# replay-' + args.name + ' ｜ 公开信息流（盲测 AI 可读）', '',
    '对局：一夜终极狼人杀 · 6 人（sim 自对局 M0 冒烟；账本 game_id=' + gid + '）',
    '版型：一夜狼——狼人×2 / 平民×4；单夜单刀；昼 1 轮发言；投票放逐即结算；放逐狼人则好人胜，否则狼人胜。',
    '还原完整度：100%（程序生成全量事件；发言为 LLM 生成——sim 语料非真人，恒挂「模拟语料」标注）。',
    '说明：本文件只含公开信息流；真值在 .truth.md 与 games.meta。玩家名单：1-6 号（sim-座位号）。',
    '预注册五元组：seed=' + prereg.seed + ' model=' + prereg.model + ' temperature=' + prereg.temperature + ' variant=' + prereg.variant.id + ' prompt_version=' + prereg.prompt_version + '（prereg.json 冻结）。',
    '', '## 夜 1', '', '## 昼 1', '', eLines, '',
  ].join('\n');
  const truthMd = [
    '# replay-' + args.name + ' ｜ 真相层（盲测 AI 不得阅读）', '',
    '- **狼人阵营**：' + wolves.join('、') + ' 号',
    '- **好人阵营**：' + villagers.join('、') + ' 号（全部平民）',
    '- 夜 1 刀杀：' + killTarget + ' 号（狼队统一决策）',
    '- 昼 1 放逐：' + exiled + ' 号（票型 ' + JSON.stringify(tally) + (tiebreak ? '；平票/兜底 seed 破平' : '') + '）',
    '- **胜负：' + resultText + '**', '',
    '## QC（M0 冒烟）', '',
    '- LLM 调用数：' + usageAgg.calls + '（口径上限 40）；prompt_tokens=' + usageAgg.prompt_tokens + '；completion_tokens=' + usageAgg.completion_tokens + '；解析降级=' + usageAgg.parse_fallback,
    '- 偏差记录：' + (deviations.length ? deviations.join('；') : '无'),
    '- 模型=' + prereg.model + '；provider=tokenrhythm；发言拟真度目检=见 p11-PROGRESS.md（aidetect 集成下回合）', '',
  ].join('\n');
  stepLog('exporting replay+truth+summary');
  fs.writeFileSync(path.join(args.out, args.name + '.replay.md'), replay, 'utf8');
  fs.writeFileSync(path.join(args.out, args.name + '.truth.md'), truthMd, 'utf8');
  const summary = { ok: true, game_id: gid, name: args.name, events: st.events.length, claims: st.claims.length, actions: st.actions.length, result, usage: usageAgg, deviations, files: [args.name + '.replay.md', args.name + '.truth.md'] };
  fs.writeFileSync(path.join(args.out, args.name + '.summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('[M0-OK] ' + JSON.stringify(summary));
  dbApi.closeCurrent();
}

if (require.main === module) {
  main().catch(e => {
    console.error('[M0-FAIL]', e && e.stack || e);
    try { fs.writeFileSync(path.join(parseArgs(process.argv).out, 'm0-fail.txt'), String(e && e.stack || e), 'utf8'); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { main };


