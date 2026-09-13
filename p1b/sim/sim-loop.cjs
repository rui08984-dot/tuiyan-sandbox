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
  const a = { stage: '1', day: 1, variant: 'tubian3d', prereg: 'p1b/sim/prereg.json', db: path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db'), out: path.join(__dirname, 'out'), name: 'sim-ownww6p-m0-run1' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--prereg') a.prereg = argv[++i];
    else if (k === '--db') a.db = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--name') a.name = argv[++i];
    else if (k === '--stage') a.stage = argv[++i];
    else if (k === '--day') a.day = Number(argv[++i]);
    else if (k === '--variant') a.variant = String(argv[++i]);
    else if (k === '--seed') a.seed = argv[++i];
    else if (k === '--maxcalls') a.maxCalls = Number(argv[++i]); // 单次进程 LLM 调用预算（120s 命令上限下分段续跑）
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
function ensureSimColumns(conn, deviations = []) {
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

// ── 多日局（B2）屠边结算核心 ─────────────────────────────────────────
/** 神职集合（§1.1 屠边：神=seer+witch，民=villager；本版型无猎人/守卫） */
const GOD_ROLES = ['seer', 'witch'];

function loadSimGame(conn, name) {
  return conn.prepare("SELECT id, meta FROM games WHERE name=? AND source='sim' ORDER BY id DESC LIMIT 1").get(name);
}

function parseSimMeta(row) {
  if (!row || !row.meta) return null;
  const m = JSON.parse(row.meta);
  return (m && m.source === 'sim') ? m : null;
}

function saveSimMeta(conn, gid, meta) {
  conn.prepare('UPDATE games SET source=?, meta=? WHERE id=?').run('sim', JSON.stringify(meta), gid);
}

/** dead 累积死者数组 → 存活席位升序 */
function aliveSeatsOf(meta) {
  const dead = (meta.truth && meta.truth.dead) || [];
  return Object.keys(meta.truth.roles).map(Number).filter(s => !dead.includes(s)).sort((a, b) => a - b);
}

/** 屠边 resolveWin（§1.1 终局条件①②；③days_max 兜底由调用方按 day 判） */
function resolveWin(seatRole, dead) {
  const seats = Object.keys(seatRole).map(Number);
  const aliveWolves = seats.filter(s => seatRole[s] === 'werewolf' && !dead.includes(s));
  if (!aliveWolves.length) return { result: 'village_win', reason: 'wolves_all_dead' };
  const gods = seats.filter(s => GOD_ROLES.includes(seatRole[s]));
  if (gods.length && gods.every(s => dead.includes(s))) return { result: 'wolf_win', reason: 'gods_all_dead' };
  const vill = seats.filter(s => seatRole[s] === 'villager');
  if (vill.length && vill.every(s => dead.includes(s))) return { result: 'wolf_win', reason: 'villagers_all_dead' };
  return null; // 未终局
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
  const { seat, role, wolves, deadSeats, streamText, anchors, day, checks, potions, nightInfo } = ctx;
  let roleText = '平民';
  if (role === 'werewolf') roleText = '狼人（你的队友：' + wolves.filter(w => w !== seat).join('、') + '号；仅你知情，暴露队友身份=风险自负）';
  else if (role === 'seer') roleText = '预言家（每晚验 1 人，结果仅你可知；你不知道女巫是谁）';
  else if (role === 'witch') roleText = '女巫（解药×1 + 毒药×1 全程各一瓶，同夜至多一瓶；你不知道预言家是谁）';
  // 私有视角段（§2.2:97 / §7.1 长局一致性缓解：注入既往私有摘要，防遗忘污染 T2 真值）
  const priv = [];
  if (role === 'seer' && checks && checks.length) priv.push('你此前的查验记录（仅你可见）：' + checks.map(c => '第' + c.day + '夜 验 ' + c.seat + '号=' + c.result).join('；'));
  if (role === 'witch') {
    if (potions) priv.push('你的药水状态（仅你可见）：' + (potions.save ? '解药可用' : '解药已用') + '、' + (potions.poison ? '毒药可用' : '毒药已用'));
    if (nightInfo) priv.push('昨夜刀口（仅你可见）：' + (nightInfo.kill_target === null || nightInfo.kill_target === undefined ? '无（平安夜）' : nightInfo.kill_target + ' 号'));
  }
  const privateLine = priv.length ? '【你的私有视角（绝不原样念出来，暴露身份=风险自负）】\n' + priv.join('\n') : '';
  return [
    '你是在「多日局标准狼人杀」6 人局（版型 2 狼 / 预言家 / 女巫 / 2 民，屠边）中的 ' + seat + ' 号玩家，第 ' + (day || 1) + ' 天白天公开发言。',
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
    privateLine,
    '',
    '轮到你（' + seat + '号）发言。只输出 JSON。',
  ].filter(Boolean).join('\n');
}

/** 放逐者遗言（§1.2：type=statement, phase=dusk，仅 1 条；夜死者无遗言） */
function buildLastWordsPrompt(ctx) {
  const { seat, role, wolves, day, checks, potions } = ctx;
  let roleText = '平民';
  if (role === 'werewolf') roleText = '狼人（同伙：' + wolves.filter(w => w !== seat).join('、') + '号）';
  else if (role === 'seer') roleText = '预言家';
  else if (role === 'witch') roleText = '女巫';
  const priv = [];
  if (role === 'seer' && checks && checks.length) priv.push('你的查验记录：' + checks.map(c => '第' + c.day + '夜 ' + c.seat + '号=' + c.result).join('；'));
  if (role === 'witch' && potions) priv.push('你的药水状态：' + (potions.save ? '解药可用' : '解药已用') + '、' + (potions.poison ? '毒药可用' : '毒药已用'));
  return [
    '你是「多日局标准狼人杀」6 人局（屠边）的 ' + seat + ' 号玩家，第 ' + (day || 1) + ' 天你被投票放逐，即将出局。这是你的遗言（会被全场听到，之后你不再发言）。',
    JSON_RULE,
    '输出格式：{"speech":"你的遗言（40-150 字，口语化，可交代身份/查验/票数冤枉/甩锅，死人不必再藏但也不必全说）"}',
    '你的真实身份：' + roleText + '。',
    priv.length ? '【你的私有信息（可选择性公开）】' + priv.join('｜') : '',
    '',
    '说出你的遗言。只输出 JSON。',
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

function buildSeerCheckPrompt(ctx) {
  const { seat, aliveSeats, checkedHistory } = ctx;
  return [
    '你是「多日局标准狼人杀」6 人局（狼×2/预言家×1/女巫×1/民×2，屠边）的预言家，座号 ' + seat + ' 号。现在是夜里，轮到你行动。',
    '你是预言家，每晚可查验一名存活玩家的阵营（狼/好人），结果仅你自己知道，不可公开。',
    JSON_RULE,
    '输出格式：{"check_seat":整数座位号}',
    '只能查验存活玩家，可以查验自己以外的任意存活者。存活席位：' + (aliveSeats || []).join('、') + '号。',
    '',
    '【既往查验记录（仅你自己可见）】',
    (checkedHistory && checkedHistory.length) ? checkedHistory.map(h => h.seat + '号=' + h.result).join('；') : '（无，这是你第一次查验）',
    '',
    '选择今晚要查验的座位。只输出 JSON。',
  ].join('\n');
}

function buildWitchPrompt(ctx) {
  const { seat, aliveSeats, killTarget, potions } = ctx;
  const pot = potions || { save: false, poison: false };
  return [
    '你是「多日局标准狼人杀」6 人局（狼×2/预言家×1/女巫×1/民×2，屠边）的女巫，座号 ' + seat + ' 号。现在是夜里，轮到你行动。',
    '你是女巫，解药 1 瓶 + 毒药 1 瓶（全程各一瓶，同夜至多用一瓶），毒不可救，解药生效=平安夜，可自救。',
    JSON_RULE,
    '输出格式：{"save":true/false,"poison_seat":整数座位号或 null}',
    'save=true 表示对刀口使用解药（救活他，本夜平安）；poison_seat=N 表示对 N 号使用毒药；同夜至多用一瓶，故两者不可同时为真。',
    '你的剩余药水：' + (pot.save ? '解药可用' : '解药已用') + '、' + (pot.poison ? '毒药可用' : '毒药已用') + '。',
    '昨夜刀口=' + (killTarget === null || killTarget === undefined ? '（无）' : killTarget + '号') + '。',
    '可以毒杀的存活席位：' + (aliveSeats || []).join('、') + '号。',
    '',
    '决定今晚是否用药。只输出 JSON。',
  ].join('\n');
}

/** LLM 调用封装：1 次重试（附纠偏提示），usage 累计，parse 失败计数 */
async function callJson(messages, { temperature, model, usageAgg, retries = 1, maxTokens = 2000, callTimeoutMs = 75000, httpTimeoutMs = 60000 }) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const msgs = i === 0 ? messages : messages.concat([{ role: 'user', content: '上一次输出不是合法 JSON 或缺字段。重新输出：只输出严格 JSON。' }]);
      // B2 加固：墙钟兜底（AbortController 偶发不触发/流式卡死时，Promise.race 强制断链，防单卡全天挂死）
      const r = await Promise.race([
        chatOnce(msgs, { model, temperature, timeoutMs: httpTimeoutMs, maxTokens: i === 0 ? maxTokens : maxTokens + 1500 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('callJson 墙钟超时')), callTimeoutMs)),
      ]); // 重试自增 headroom：glm reasoning 偶发吃穿 max_tokens 致 content 空（M1 熔断根因）
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
  if (args.stage === 'init') { await runInit(args, prereg); return; }
  if (args.stage === '2') { await runStage2(args, prereg); return; }
  if (args.stage === 'day') { await runDayLegacy(args, prereg); return; }
  if (args.stage === 'night') { await runNight(args, prereg); return; }
  if (args.stage === 'dayphase') { await runDayPhase(args, prereg); return; }
  if (args.stage === 'dusk') { await runDusk(args, prereg); return; }
  if (args.stage === '1') { await runInit(args, prereg); return; } // 多日局：stage1=建局+真值骨架（一夜狼旧路径保留于下方 --stage legacy1）

  // 建局
  stepLog('db init: ' + args.db);
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  ensureSimColumns(conn, deviations);
  const cleaned = cleanupPartialSimGames(conn, args.name);
  if (cleaned) stepLog('cleaned partial sim games: ' + cleaned);
  const game = dbApi.createGame(args.name, 'werewolf_sim_6p_tubian3d', 6);
  stepLog('game created id=' + game.id);
  const gid = game.id;

  // 角色分配（crypto.randomInt 洗牌，任务书指定；真值只进 meta）
  const roles = cryptoShuffle(['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager']);
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


/** init 入口（B2）：建局 + 角色混洗 + 真值骨架落 meta（stage='init'）。零 LLM 调用，秒级。
 * 之后 --stage day --day 1..3 逐日续跑，--stage 2 终结算+导出。 */
async function runInit(args, prereg) {
  fs.mkdirSync(args.out, { recursive: true });
  const stepLog = msg => fs.appendFileSync(path.join(args.out, args.name + '.steps.log'), new Date().toISOString() + ' ' + msg + '\n');
  stepLog('init start');
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  conn.pragma('busy_timeout = 5000');
  const deviations = [];
  ensureSimColumns(conn, deviations); // 新库初始只有 5 列，无 source/meta，init 入口必须先补列
  const cleaned = cleanupPartialSimGames(conn, args.name);
  if (cleaned) stepLog('cleaned partial sim games: ' + cleaned);
  const game = dbApi.createGame(args.name, 'werewolf_sim_6p_tubian3d', 6);
  const gid = game.id;
  stepLog('game created id=' + gid);
  const roles = cryptoShuffle(['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager']);
  const seatRole = {}; roles.forEach((r0, i) => { seatRole[i + 1] = r0; });
  const wolves = [1, 2, 3, 4, 5, 6].filter(s => seatRole[s] === 'werewolf');
  const villagers = [1, 2, 3, 4, 5, 6].filter(s => seatRole[s] === 'villager');
  const gods = [1, 2, 3, 4, 5, 6].filter(s => GOD_ROLES.includes(seatRole[s]));
  const meta = {
    stage: 'init', source: 'sim', gid,
    prereg: { seed: prereg.seed, model: prereg.model, temperature: prereg.temperature, prompt_version: prereg.prompt_version, variant: prereg.variant, provider: prereg.provider },
    truth: { roles: seatRole, wolves, villagers, gods, dead: [], checks: [], potions: { save: true, poison: true }, night: [], exile: [] },
    qc: { calls: 0, prompt_tokens: 0, completion_tokens: 0, parse_fallback: 0 },
    deviations,
  };
  saveSimMeta(conn, gid, meta);
  stepLog('init done gid=' + gid + ' wolves=' + wolves.join(',') + ' gods=' + gods.join(',') + ' villagers=' + villagers.join(','));
  const summary = { ok: true, stage: 'init', game_id: gid, name: args.name, deviations, files: [] };
  fs.writeFileSync(path.join(args.out, args.name + '.init.summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('[INIT-OK] ' + JSON.stringify(summary));
  dbApi.closeCurrent();
}

/** 日段幂等：删除该日已落事件（含其 claims/actions），供断点重跑（B2 续跑锚加固） */
function resetDayEvents(conn, gid, day) {
  const ids = conn.prepare('SELECT id FROM events WHERE game_id=? AND day=?').all(gid, day).map(r => r.id);
  if (!ids.length) return 0;
  const ph = ids.map(() => '?').join(',');
  conn.prepare('DELETE FROM claims WHERE event_id IN (' + ph + ')').run(...ids);
  conn.prepare('DELETE FROM actions WHERE event_id IN (' + ph + ')').run(...ids);
  conn.prepare('DELETE FROM events WHERE game_id=? AND day=?').run(gid, day);
  return ids.length;
}

/** 多日局日段公共装载：--stage day --day N --phase night|day|dusk（B2 续跑锚：每段落 meta.stage） */
async function dayCtx(args, prereg, phase, expectStages) {
  const day = Number(args.day) || 1;
  const daysMax = (prereg.variant && Number(prereg.variant.days_max)) || 3;
  fs.mkdirSync(args.out, { recursive: true });
  const stepLog = msg => fs.appendFileSync(path.join(args.out, args.name + '.steps.log'), new Date().toISOString() + ' ' + msg + '\n');
  stepLog('day' + day + '.' + phase + ' start');
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  conn.pragma('busy_timeout = 5000');
  const deviations = [];
  ensureSimColumns(conn, deviations);
  const row = loadSimGame(conn, args.name);
  if (!row) throw new Error('day 段找不到 sim 局（先跑 --stage init）: ' + args.name);
  const gid = row.id;
  const meta = parseSimMeta(row);
  if (!meta) throw new Error('meta 缺失或非 sim 局: ' + args.name);
  if (meta.stage === 2) throw new Error('该局已终局（stage=2），拒跑: ' + args.name);
  if (expectStages.indexOf(meta.stage) === -1) throw new Error('phase=' + phase + ' 顺序错：当前 meta.stage=' + meta.stage + '，允许=' + expectStages.join('/'));
  if (phase !== 'night' && meta.day !== day) throw new Error('phase=' + phase + ' 的 day 参数=' + day + ' 与 meta.day=' + meta.day + ' 不符');
  const truth = meta.truth;
  const seatRole = truth.roles, wolves = truth.wolves;
  const dead = (truth.dead || []).slice();
  const usageAgg = meta.qc || { calls: 0, prompt_tokens: 0, completion_tokens: 0, parse_fallback: 0 };
  const anchors = loadStyleAnchors();
  const rng = mulberry32(prereg.seed + day * 10 + (phase === 'night' ? 1 : phase === 'day' ? 2 : 3));
  const ctx = { day, daysMax, gid, meta, truth, seatRole, wolves, dead, usageAgg, anchors, rng, deviations, stepLog, conn };
  stepLog('day' + day + '.' + phase + ' gid=' + gid + ' stage=' + meta.stage + ' dead=' + dead.join(',') + ' calls=' + usageAgg.calls);
  return ctx;
}

/** 日段·夜：狼刀 → 预言家验 → 女巫{救?毒?} → 程序结算 deaths[day] → 死亡公告（不公布死因） */
async function runNight(args, prereg) {
  const c = await dayCtx(args, prereg, 'night', ['init', 'day']);
  const { day, gid, meta, truth, seatRole, wolves, dead, usageAgg, anchors, rng, deviations, stepLog, conn } = c;
  const alive = aliveSeatsOf(meta);
  const resetN = resetDayEvents(conn, gid, day); // 幂等：夜段重跑先清当日事件
  if (resetN) stepLog('reset day' + day + ' events=' + resetN);
  const evNight = dbApi.addEvent({ game_id: gid, day, phase: 'night', type: 'system', actor_seat: null,
    raw_text: '第 ' + day + ' 夜：天黑请闭眼。狼人睁眼，商量今晚刀杀目标。' });
  // 狼刀：候选=非狼存活者（B1 遗留①修复：狼可刀预言家/女巫，非只 2 民）
  const aliveGoodNight = alive.filter(s => seatRole[s] !== 'werewolf');
  const aliveWolves = alive.filter(s => seatRole[s] === 'werewolf');
  let killTarget = null;
  if (aliveWolves.length && aliveGoodNight.length) {
    try {
      const kill = await callJson([{ role: 'user', content: buildWolfKillPrompt({ wolves: aliveWolves, aliveGood: aliveGoodNight, day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      const t = Number(kill.obj.target_seat);
      if (!aliveGoodNight.includes(t)) throw new Error('狼刀目标非法: ' + t);
      killTarget = t;
    } catch (e) { usageAgg.parse_fallback += 1; killTarget = aliveGoodNight[Math.floor(rng() * aliveGoodNight.length)];
      deviations.push('day' + day + ' 狼刀降级（seeded_rng）=' + killTarget + '：' + String(e && e.message).slice(0, 60)); }
    dbApi.addAction({ event_id: evNight.id, seat: aliveWolves[0], action: 'kill_target', target_seat: killTarget, result: '第 ' + day + ' 夜刀（狼队统一决策，' + aliveWolves.join('+') + '号）' });
    stepLog('night kill target=' + killTarget + ' calls=' + usageAgg.calls);
  } else { deviations.push('day' + day + ' 夜刀跳过：狼=' + aliveWolves.length + ' 非狼=' + aliveGoodNight.length); }
  // 预言家验：狼存活时；结果仅其私有，不进公开事件
  let checkSeat = null, checkResult = null;
  const seerSeat = alive.find(s => seatRole[s] === 'seer');
  if (seerSeat && aliveWolves.length) {
    try {
      const ck = await callJson([{ role: 'user', content: buildSeerCheckPrompt({ seat: seerSeat, aliveSeats: alive, checkedHistory: truth.checks || [], day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      const t = Number(ck.obj.check_seat);
      if (!alive.includes(t) || t === seerSeat) throw new Error('验人目标非法: ' + t);
      checkSeat = t;
    } catch (e) { usageAgg.parse_fallback += 1; checkSeat = alive.filter(s => s !== seerSeat)[0];
      deviations.push('day' + day + ' 验人降级=' + checkSeat); }
    checkResult = seatRole[checkSeat] === 'werewolf' ? '狼' : '好人';
    dbApi.addAction({ event_id: evNight.id, seat: seerSeat, action: 'check_target', target_seat: checkSeat, result: '第 ' + day + ' 夜验（结果仅预言家私有）' });
    stepLog('night check seat=' + checkSeat + ' result=' + checkResult + ' calls=' + usageAgg.calls);
  } else if (!seerSeat) { deviations.push('day' + day + ' 验人跳过：预言家已死'); }
  // 女巫{救?毒?}：见刀口；同夜至多一瓶（§1.2 裁定）
  const potions = truth.potions || { save: true, poison: true };
  let saved = false, poisonSeat = null;
  const witchSeat = alive.find(s => seatRole[s] === 'witch');
  if (witchSeat && (potions.save || potions.poison)) {
    try {
      const w = await callJson([{ role: 'user', content: buildWitchPrompt({ seat: witchSeat, aliveSeats: alive, killTarget, potions, day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      const pSeat = (w.obj.poison_seat === null || w.obj.poison_seat === undefined) ? null : Number(w.obj.poison_seat);
      if (w.obj.save === true && potions.save && killTarget !== null && killTarget !== undefined) {
        saved = true; potions.save = false;
        deviations.push('day' + day + ' 女巫救人：actions 无 save_target 枚举（db.js:107-108），只落 meta.truth.night[].saved + 平安夜 system 公告（§2.3 缺口）');
      } else if (pSeat !== null && potions.poison && alive.includes(pSeat) && pSeat !== witchSeat) {
        poisonSeat = pSeat; potions.poison = false;
        dbApi.addAction({ event_id: evNight.id, seat: witchSeat, action: 'poison_target', target_seat: poisonSeat, result: '第 ' + day + ' 夜毒杀' });
      }
    } catch (e) { usageAgg.parse_fallback += 1; deviations.push('day' + day + ' 女巫降级（本夜未用药）'); }
    stepLog('night witch saved=' + saved + ' poison=' + poisonSeat + ' calls=' + usageAgg.calls);
  } else if (!witchSeat) { deviations.push('day' + day + ' 女巫跳过：女巫已死'); }
  // 夜段程序结算 deaths[day]；公告不公布死因（刀毒不可分辨）
  const nightDead = [];
  if (killTarget !== null && killTarget !== undefined && !saved) nightDead.push(killTarget);
  if (poisonSeat !== null && nightDead.indexOf(poisonSeat) === -1) nightDead.push(poisonSeat);
  for (const s of nightDead) if (dead.indexOf(s) === -1) dead.push(s);
  dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'system', actor_seat: null,
    raw_text: '第 ' + day + ' 天天亮了。' + (nightDead.length ? '公布昨夜死亡：' + nightDead.join('、') + ' 号出局。' : '昨夜平安，无人死亡。') });
  for (const s of nightDead) {
    dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'death', actor_seat: s,
      raw_text: s + ' 号死亡，无遗言（夜死者无遗言，§1.2）。' });
  }
  stepLog('dawn deaths=' + JSON.stringify(nightDead) + ' saved=' + saved);
  // checkpoint：夜段落 meta（stage='night', day=N），供昼段续跑
  truth.night = (truth.night || []).concat([{ day, kill_target: killTarget, saved, poison: poisonSeat, check_seat: checkSeat, check_result: checkResult, deaths: nightDead.slice() }]);
  truth.checks = (truth.checks || []).concat(checkSeat === null ? [] : [{ day, seat: checkSeat, result: checkResult }]);
  truth.potions = potions;
  truth.dead = dead.slice();
  meta.truth.deaths = { night: truth.night, exile: truth.exile || [] };
  meta.stage = 'night'; meta.day = day; meta.day_last = day; meta.days_max = c.daysMax;
  meta.qc = usageAgg; meta.deviations = (meta.deviations || []).concat(deviations);
  saveSimMeta(conn, gid, meta);
  const win1 = resolveWin(seatRole, dead);
  if (win1) { meta.truth.result = win1.result; meta.truth.result_reason = win1.reason; saveSimMeta(conn, gid, meta); }
  stepLog('day' + day + '.night done win=' + JSON.stringify(win1) + ' calls=' + usageAgg.calls);
  const sumN = { ok: true, stage: 'night', day, game_id: gid, name: args.name, night: truth.night[truth.night.length - 1], win: win1, deviations, files: [] };
  fs.writeFileSync(path.join(args.out, args.name + '.day' + day + '.night.json'), JSON.stringify(sumN, null, 2), 'utf8');
  console.log('[NIGHT-OK] ' + JSON.stringify(sumN));
  dbApi.closeCurrent();
}





/** day 入口（B2）：多日局第 N 天 = 夜段（刀→验→巫）+ 昼段（发言→投票→计票破平→放逐+遗言）+ checkpoint。
 * 单段 ≤3 min；每段结束落 meta（stage='day', day=N）供 --day N+1 续跑。 */
async function runDayLegacy(args, prereg) {
  const day = Number(args.day) || 1;
  const daysMax = (prereg.variant && Number(prereg.variant.days_max)) || 3;
  fs.mkdirSync(args.out, { recursive: true });
  const stepLog = msg => fs.appendFileSync(path.join(args.out, args.name + '.steps.log'), new Date().toISOString() + ' ' + msg + '\n');
  stepLog('day' + day + ' start');
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  conn.pragma('busy_timeout = 5000');
  const deviations = [];
  ensureSimColumns(conn, deviations); // 新库初始只有 5 列，无 source/meta，runDay 入口也必须补列
  const row = loadSimGame(conn, args.name);
  if (!row) throw new Error('runDay 找不到 sim 局（先跑 --stage 1）: ' + args.name);
  const gid = row.id;
  const meta = parseSimMeta(row);
  if (!meta) throw new Error('meta 缺失或非 sim 局: ' + args.name);
  if (meta.stage === 2) throw new Error('该局已终局（stage=2），拒跑 day' + day + '：' + args.name);
  if (meta.day && day <= meta.day) throw new Error('day' + day + ' 已跑过（meta.day=' + meta.day + '），防重入');
  const truth = meta.truth;
  const seatRole = truth.roles, wolves = truth.wolves;
  const dead = (truth.dead || []).slice();
  const alive = aliveSeatsOf(meta);
  const usageAgg = meta.qc || { calls: 0, prompt_tokens: 0, completion_tokens: 0, parse_fallback: 0 };
  const anchors = loadStyleAnchors();
  const rng = mulberry32(prereg.seed + day);
  stepLog('day' + day + ' gid=' + gid + ' alive=' + alive.join(',') + ' dead=' + dead.join(','));
  const resetN = resetDayEvents(conn, gid, day); // 幂等：断点重跑先清当日事件，防重复落库
  if (resetN) stepLog('reset day' + day + ' events=' + resetN);
  // ── 夜 system 事件
  const evNight = dbApi.addEvent({ game_id: gid, day, phase: 'night', type: 'system', actor_seat: null,
    raw_text: '第 ' + day + ' 夜：天黑请闭眼。狼人睁眼，商量今晚刀杀目标。' });
  // ── 夜 1 狼刀：候选=非狼存活者（B1 遗留①修复：狼可刀预言家/女巫）
  const aliveGoodNight = alive.filter(s => seatRole[s] !== 'werewolf');
  const aliveWolves = alive.filter(s => seatRole[s] === 'werewolf');
  let killTarget = null;
  if (aliveWolves.length && aliveGoodNight.length) {
    try {
      const kill = await callJson([{ role: 'user', content: buildWolfKillPrompt({ wolves: aliveWolves, aliveGood: aliveGoodNight, day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      killTarget = Number(kill.obj.target_seat);
      if (!aliveGoodNight.includes(killTarget)) throw new Error('狼刀目标非法: ' + killTarget);
    } catch (e) { usageAgg.parse_fallback += 1; killTarget = aliveGoodNight[Math.floor(rng() * aliveGoodNight.length)];
      deviations.push('day' + day + ' 狼刀 LLM 失败，seeded_rng 兜底=' + killTarget); }
    dbApi.addAction({ event_id: evNight.id, seat: aliveWolves[0], action: 'kill_target', target_seat: killTarget, result: '第 ' + day + ' 夜刀（狼队统一决策，' + aliveWolves.join('+') + '号）' });
    stepLog('night kill target=' + killTarget + ' calls=' + usageAgg.calls);
  } else {
    deviations.push('day' + day + ' 夜刀跳过：狼存活=' + aliveWolves.length + ' 非狼存活=' + aliveGoodNight.length);
  }
  // ── 夜 2 预言家验（狼存活时；结果仅其私有，不进公开事件）
  let checkSeat = null, checkResult = null;
  const seerSeat = alive.find(s => seatRole[s] === 'seer');
  if (seerSeat && aliveWolves.length) {
    try {
      const ck = await callJson([{ role: 'user', content: buildSeerCheckPrompt({ seat: seerSeat, aliveSeats: alive, checkedHistory: truth.checks || [], day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      checkSeat = Number(ck.obj.check_seat);
      if (!alive.includes(checkSeat) || checkSeat === seerSeat) throw new Error('验人目标非法: ' + checkSeat);
    } catch (e) { usageAgg.parse_fallback += 1; checkSeat = alive.filter(s => s !== seerSeat)[0];
      deviations.push('day' + day + ' 预言家验人 LLM 失败，兜底首位存活者=' + checkSeat); }
    checkResult = seatRole[checkSeat] === 'werewolf' ? '狼' : '好人';
    dbApi.addAction({ event_id: evNight.id, seat: seerSeat, action: 'check_target', target_seat: checkSeat, result: '第 ' + day + ' 夜验（结果仅预言家私有，不进公开事件）' });
    stepLog('night check seat=' + checkSeat + ' result=' + checkResult + ' calls=' + usageAgg.calls);
  } else if (!seerSeat) {
    deviations.push('day' + day + ' 验人跳过：预言家已死');
  }
  // ── 夜 3 女巫{救?毒?}（存活时，见刀口；同夜至多一瓶）
  const potions = truth.potions || { save: true, poison: true };
  let saved = false, poisonSeat = null;
  const witchSeat = alive.find(s => seatRole[s] === 'witch');
  if (witchSeat && (potions.save || potions.poison)) {
    try {
      const w = await callJson([{ role: 'user', content: buildWitchPrompt({ seat: witchSeat, aliveSeats: alive, killTarget, potions, day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      const wantSave = w.obj.save === true;
      const pSeat = (w.obj.poison_seat === null || w.obj.poison_seat === undefined) ? null : Number(w.obj.poison_seat);
      if (wantSave && potions.save && killTarget !== null && killTarget !== undefined) {
        // 同夜至多一瓶：救优先（毒作废）
        saved = true; potions.save = false;
        deviations.push('day' + day + ' 女巫救人：actions 无 save_target 枚举（db.js:107-108），只落 meta.truth.night[].saved + 平安夜 system 公告（§2.3 缺口）');
      } else if (pSeat !== null && potions.poison && alive.includes(pSeat) && pSeat !== witchSeat) {
        poisonSeat = pSeat; potions.poison = false;
        dbApi.addAction({ event_id: evNight.id, seat: witchSeat, action: 'poison_target', target_seat: poisonSeat, result: '第 ' + day + ' 夜毒杀' });
      }
    } catch (e) { usageAgg.parse_fallback += 1; deviations.push('day' + day + ' 女巫 LLM 失败，本夜未用药'); }
    stepLog('night witch saved=' + saved + ' poison=' + poisonSeat + ' calls=' + usageAgg.calls);
  } else if (!witchSeat) {
    deviations.push('day' + day + ' 女巫跳过：女巫已死');
  }
  // ── 夜段结算：deaths[day]（救生效=平安夜；毒独立致死；不公布死因）
  const nightDead = [];
  if (killTarget !== null && killTarget !== undefined && !saved) nightDead.push(killTarget);
  if (poisonSeat !== null && poisonSeat !== undefined && nightDead.indexOf(poisonSeat) === -1) nightDead.push(poisonSeat);
  for (const s of nightDead) if (dead.indexOf(s) === -1) dead.push(s);
  const evDawn = dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'system', actor_seat: null,
    raw_text: '第 ' + day + ' 天天亮了。' + (nightDead.length ? '公布昨夜死亡：' + nightDead.join('、') + ' 号出局。' : '昨夜平安，无人死亡。') });
  for (const s of nightDead) {
    dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'death', actor_seat: s,
      raw_text: s + ' 号死亡，无遗言（夜死者无遗言，§1.2）。' });
  }
  stepLog('dawn deaths=' + JSON.stringify(nightDead) + ' saved=' + saved);
  // ── 胜负检查①（夜后；屠边 resolveWin）
  let win = resolveWin(seatRole, dead);
  let ended = !!win;
  if (win) stepLog('win check#1 ' + JSON.stringify(win));
  // ── 昼段：存活者按座次升序发言（双批并行，沿用现役口径）
  let votes = {}, tally = {}, tiebreak = null, exiled = null, lastWords = null;
  const aliveDay = aliveSeatsOf({ truth: Object.assign({}, truth, { dead }) });
  if (!ended && aliveDay.length) {
    const half = Math.ceil(aliveDay.length / 2);
    const batches = [aliveDay.slice(0, half), aliveDay.slice(half)];
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      if (!batch.length) continue;
      stepLog('speech batch' + (bi + 1) + ' seats=' + batch.join(',') + ' start');
      const st = dbApi.loadGameState(gid);
      const streamText = st.events.map(e => 'E-' + e.seq + ': ' + e.raw_text).join('\n');
      await Promise.allSettled(batch.map(async seat => {
        const p = buildSpeechPrompt({ seat, role: seatRole[seat], wolves, deadSeats: dead, streamText, anchors, day,
          checks: seatRole[seat] === 'seer' ? (truth.checks || []) : null,
          potions: seatRole[seat] === 'witch' ? potions : null,
          nightInfo: seatRole[seat] === 'witch' ? { kill_target: killTarget } : null });
        let speech = '', claims = [];
        try {
          const r = await callJson([{ role: 'user', content: p }], { temperature: prereg.temperature, model: prereg.model, usageAgg });
          speech = String(r.obj.speech || '').trim();
          claims = Array.isArray(r.obj.claims) ? r.obj.claims : [];
        } catch (e) { usageAgg.parse_fallback += 1; speech = '（发言解析失败占位：' + String(e.message).slice(0, 80) + '）'; }
        const ev = dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'statement', actor_seat: seat, raw_text: seat + ' 号：' + speech });
        stepLog('speech seat=' + seat + ' len=' + speech.length + ' claims=' + claims.length + ' calls=' + usageAgg.calls);
        for (const c of claims.slice(0, 3)) {
          const sub = Number(c.subject_seat), pred = String(c.predicate), obj = String(c.object || '').slice(0, 40);
          if (!Number.isInteger(sub) || sub < 1 || sub > 6) continue;
          if (!['is_wolf', 'is_good', 'claims_role', 'said', 'did_action', 'was_checked', 'voted_for'].includes(pred)) continue;
          dbApi.addClaim({ event_id: ev.id, seat, subject_seat: sub, predicate: pred, object: obj, extracted_by: 'sim-llm' });
        }
      }));
    }
    // ── 投票
    const evVote = dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'system', actor_seat: null, raw_text: '第 ' + day + ' 天发言结束，全体投票放逐。' });
    await Promise.allSettled(aliveDay.map(async seat => {
      const st = dbApi.loadGameState(gid);
      const claimsSummary = st.claims.map(c => c.seat + '号说' + c.subject_seat + '号:' + c.object).join('；').slice(0, 400);
      try {
        const r = await callJson([{ role: 'user', content: buildVotePrompt({ seat, aliveSeats: aliveDay, claimsSummary, day }) }],
          { temperature: prereg.temperature, model: prereg.model, usageAgg });
        let target = Number(r.obj.vote_seat);
        if (!aliveDay.includes(target) || target === seat) target = aliveDay.find(s => s !== seat);
        votes[seat] = target;
        dbApi.addAction({ event_id: evVote.id, seat, action: 'vote', target_seat: target, result: r.obj.reasoning ? String(r.obj.reasoning).slice(0, 60) : null });
        stepLog('vote seat=' + seat + ' -> ' + target + ' calls=' + usageAgg.calls);
      } catch (e) {
        votes[seat] = 0;
        dbApi.addAction({ event_id: evVote.id, seat, action: 'abstain', result: 'llm-fail: ' + String(e && e.message).slice(0, 40) });
        stepLog('vote seat=' + seat + ' ABSTAIN(llm-fail)');
      }
    }));
    // ── 逐日计票 + seeded 破平（§1.2 平票复用同款，逐日独立）
    for (const s of Object.values(votes)) { if (s > 0) tally[s] = (tally[s] || 0) + 1; }
    const maxV = Object.keys(tally).length ? Math.max.apply(null, Object.values(tally)) : 0;
    let tied = Object.keys(tally).map(Number).filter(s => tally[s] === maxV);
    if (!tied.length) { exiled = aliveDay[Math.floor(rng() * aliveDay.length)]; tiebreak = { method: 'all_abstain_seeded_rng', seed: prereg.seed + day }; }
    else if (tied.length > 1) { tied.sort((a, b) => a - b); exiled = tied[Math.floor(rng() * tied.length)]; tiebreak = { tied: tied.slice(), method: 'seeded_rng', seed: prereg.seed + day }; }
    else exiled = tied[0];
    dbApi.addEvent({ game_id: gid, day, phase: 'dusk', type: 'death', actor_seat: exiled,
      raw_text: '第 ' + day + ' 天计票：' + JSON.stringify(tally) + '。' + exiled + ' 号被放逐出局' + (tiebreak ? '（平票/兜底，seed 破平）' : '') + '。' });
    if (dead.indexOf(exiled) === -1) dead.push(exiled);
    stepLog('exile=' + exiled + ' tally=' + JSON.stringify(tally) + ' tiebreak=' + JSON.stringify(tiebreak));
    // ── 遗言：仅放逐者 1 条（type=statement, phase=dusk）；夜死者无遗言
    try {
      const lw = await callJson([{ role: 'user', content: buildLastWordsPrompt({ seat: exiled, role: seatRole[exiled], wolves, day, checks: truth.checks || [], potions }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      lastWords = String(lw.obj.speech || '').trim();
    } catch (e) { usageAgg.parse_fallback += 1; lastWords = '（遗言解析失败占位）'; }
    dbApi.addEvent({ game_id: gid, day, phase: 'dusk', type: 'statement', actor_seat: exiled, raw_text: exiled + ' 号（遗言）：' + lastWords });
    stepLog('lastwords seat=' + exiled + ' len=' + (lastWords || '').length);
    // ── 胜负检查②（昼后；含 days_max=3 兜底③）
    win = resolveWin(seatRole, dead);
    if (win) { ended = true; }
    else if (day >= daysMax) {
      const wolvesAlive = Object.keys(seatRole).map(Number).filter(s => seatRole[s] === 'werewolf' && dead.indexOf(s) === -1);
      win = { result: 'wolf_win', reason: 'days_max_' + daysMax + '_wolves_alive' };
      ended = true;
      deviations.push('day' + day + ' 触发 days_max=' + daysMax + ' 兜底：狼存活 ' + wolvesAlive.length + ' → wolf_win（§1.1 终局条件③）');
    }
    if (win) stepLog('win check#2 ' + JSON.stringify(win));
  }
  // ── per-day checkpoint：落 meta（stage='day', day=N）供 --day N+1 续跑
  const nightRec = { day, kill_target: killTarget, saved, poison: poisonSeat, check_seat: checkSeat, check_result: checkResult, deaths: nightDead.slice() };
  truth.night = (truth.night || []).concat([nightRec]);
  truth.checks = (truth.checks || []).concat(checkSeat === null ? [] : [{ day, seat: checkSeat, result: checkResult }]);
  truth.potions = potions;
  truth.dead = dead.slice();
  if (exiled !== null) truth.exile = (truth.exile || []).concat([{ day, seat: exiled, votes: Object.assign({}, votes), tally: Object.assign({}, tally), tiebreak, last_words: lastWords }]);
  meta.truth.deaths = { night: truth.night, exile: truth.exile || [] };
  meta.stage = ended ? 'day_final' : 'day';
  meta.day = day;
  meta.day_last = day;
  meta.days_max = daysMax;
  meta.qc = usageAgg;
  meta.deviations = (meta.deviations || []).concat(deviations);
  if (win) { meta.truth.result = win.result; meta.truth.result_reason = win.reason; }
  saveSimMeta(conn, gid, meta);
  stepLog('day' + day + ' checkpoint stage=' + meta.stage + ' calls=' + usageAgg.calls + ' ended=' + ended);
  const summary = { ok: true, stage: meta.stage, day, days_max: daysMax, game_id: gid, name: args.name,
    night: nightRec, exile: exiled, ended, result: win ? win.result : null, deviations, files: [] };
  fs.writeFileSync(path.join(args.out, args.name + '.day' + day + '.summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('[DAY-OK] ' + JSON.stringify(summary));
  dbApi.closeCurrent();
}

/** 日段·昼（发言+投票）：expect stage='night'；落 stage='day'（存档到底； archetype=发言/投票全部完成） */
async function runDayPhase(args, prereg) {
  const c = await dayCtx(args, prereg, 'day', ['night']);
  const { day, gid, meta, truth, seatRole, wolves, dead, usageAgg, anchors, deviations, stepLog, conn } = c;
  // 单次调用预算（防 120s 命令上限截断丢进度）：预算耗尽→落盘返回，下次续跑补缺
  let spent = 0, budgetHit = false;
  const budget = Number(args.maxCalls) || 0;
  const gatedCall = async (msgs, opts) => {
    if (budget > 0 && spent >= budget) { budgetHit = true; throw new Error('CALL_BUDGET_EXHAUSTED'); }
    spent += 1;
    return callJson(msgs, opts);
  };
  if (meta.truth.result) throw new Error('夜后已分胜负（result=' + meta.truth.result + '），昼段拒跑；请直接 --stage 2');
  const aliveDay = aliveSeatsOf(meta);
  if (!aliveDay.length) throw new Error('无存活者，昼段拒跑');
  // 发言：座次升序双批并行（§1.2 沿用现役口径）；增量落盘=断点重跑只补缺失席位
  const spoken = new Set(conn.prepare('SELECT actor_seat FROM events WHERE game_id=? AND day=? AND phase=? AND type=?').all(gid, day, 'day', 'statement').map(r => r.actor_seat));
  const half = Math.ceil(aliveDay.length / 2);
  const batches = [aliveDay.slice(0, half), aliveDay.slice(half)];
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi].filter(s => !spoken.has(s));
    if (!batch.length) continue;
    stepLog('day' + day + ' speech batch' + (bi + 1) + ' seats=' + batch.join(','));
    const st = dbApi.loadGameState(gid);
    const streamText = st.events.map(e => 'E-' + e.seq + ': ' + e.raw_text).join('\n');
    await Promise.allSettled(batch.map(async seat => {
      const p = buildSpeechPrompt({ seat, role: seatRole[seat], wolves, deadSeats: dead, streamText, anchors, day,
        checks: seatRole[seat] === 'seer' ? (truth.checks || []) : null,
        potions: seatRole[seat] === 'witch' ? truth.potions : null,
        nightInfo: seatRole[seat] === 'witch' ? { kill_target: (truth.night || []).filter(n => n.day === day)[0] || {} } : null });
      let speech = '', claims = [];
      try {
        const r = await gatedCall([{ role: 'user', content: p }], { temperature: prereg.temperature, model: prereg.model, usageAgg });
        speech = String(r.obj.speech || '').trim();
        claims = Array.isArray(r.obj.claims) ? r.obj.claims : [];
      } catch (e) { if (String(e.message) === 'CALL_BUDGET_EXHAUSTED') throw e; usageAgg.parse_fallback += 1; speech = '（发言解析失败占位：' + String(e.message).slice(0, 80) + '）'; }
      const ev = dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'statement', actor_seat: seat, raw_text: seat + ' 号：' + speech });
      stepLog('speech seat=' + seat + ' len=' + speech.length + ' claims=' + claims.length + ' calls=' + usageAgg.calls);
      for (const cl of claims.slice(0, 3)) {
        const sub = Number(cl.subject_seat), pred = String(cl.predicate), obj = String(cl.object || '').slice(0, 40);
        if (!Number.isInteger(sub) || sub < 1 || sub > 6) continue;
        if (!['is_wolf', 'is_good', 'claims_role', 'said', 'did_action', 'was_checked', 'voted_for'].includes(pred)) continue;
        dbApi.addClaim({ event_id: ev.id, seat, subject_seat: sub, predicate: pred, object: obj, extracted_by: 'sim-llm' });
      }
      meta.qc = usageAgg; meta.deviations = (meta.deviations || []).concat(deviations); saveSimMeta(conn, gid, meta); // 逐席位落盘：120s 命令上限下被截断也留得住
    }));
  }
  // 投票：全员各 1 票（增量落 votes，断点重跑只补缺票者）
  const votes = ((meta.truth.votes || {})[day]) || {};
  const voted = new Set(conn.prepare("SELECT seat FROM actions WHERE action IN ('vote','abstain') AND event_id IN (SELECT id FROM events WHERE game_id=? AND day=? AND phase='day')").all(gid, day).map(r => r.seat));
  const evVoteRow = conn.prepare("SELECT id FROM events WHERE game_id=? AND day=? AND phase='day' AND type='system' ORDER BY seq DESC LIMIT 1").get(gid, day);
  const evVote = evVoteRow ? { id: evVoteRow.id } : dbApi.addEvent({ game_id: gid, day, phase: 'day', type: 'system', actor_seat: null, raw_text: '第 ' + day + ' 天发言结束，全体投票放逐。' });
  await Promise.allSettled(aliveDay.filter(s => !voted.has(s)).map(async seat => {
    const st = dbApi.loadGameState(gid);
    const claimsSummary = st.claims.map(x => x.seat + '号说' + x.subject_seat + '号:' + x.object).join('；').slice(0, 400);
    try {
      const r = await gatedCall([{ role: 'user', content: buildVotePrompt({ seat, aliveSeats: aliveDay, claimsSummary, day }) }],
        { temperature: prereg.temperature, model: prereg.model, usageAgg });
      let target = Number(r.obj.vote_seat);
      if (!aliveDay.includes(target) || target === seat) target = aliveDay.find(s => s !== seat);
      votes[seat] = target;
      dbApi.addAction({ event_id: evVote.id, seat, action: 'vote', target_seat: target, result: r.obj.reasoning ? String(r.obj.reasoning).slice(0, 60) : null });
      meta.truth.votes = Object.assign(meta.truth.votes || {}, {}); meta.truth.votes[day] = votes; meta.qc = usageAgg; saveSimMeta(conn, gid, meta);
      stepLog('vote seat=' + seat + ' -> ' + target + ' calls=' + usageAgg.calls);
    } catch (e) {
      if (String(e.message) === 'CALL_BUDGET_EXHAUSTED') throw e;
      votes[seat] = 0;
      dbApi.addAction({ event_id: evVote.id, seat, action: 'abstain', result: 'llm-fail: ' + String(e && e.message).slice(0, 40) });
      meta.truth.votes = Object.assign(meta.truth.votes || {}, {}); meta.truth.votes[day] = votes; meta.qc = usageAgg; saveSimMeta(conn, gid, meta);
      stepLog('vote seat=' + seat + ' ABSTAIN(llm-fail)');
    }
  }));
  meta.truth.votes = Object.assign(meta.truth.votes || {}, {});
  meta.truth.votes[day] = votes;
  meta.stage = 'day'; meta.day = day; meta.day_last = day;
  meta.qc = usageAgg; meta.deviations = (meta.deviations || []).concat(deviations);
  saveSimMeta(conn, gid, meta);
  stepLog('day' + day + '.day-phase done votes=' + JSON.stringify(votes) + ' calls=' + usageAgg.calls);
  const allDone = Object.keys(votes).length >= aliveDay.length;
  meta.stage = allDone ? 'day' : 'night'; // 未完成=仍停在 night 面貌，下次续跑从缺口补
  meta.qc = usageAgg; saveSimMeta(conn, gid, meta);
  const sumD = { ok: true, stage: meta.stage, day, game_id: gid, name: args.name, votes, complete: allDone, budgetHit, deviations, files: [] };
  fs.writeFileSync(path.join(args.out, args.name + '.day' + day + '.dayphase.json'), JSON.stringify(sumD, null, 2), 'utf8');
  console.log('[DAYPHASE-OK] ' + JSON.stringify(sumD));
  dbApi.closeCurrent();
}

/** 日段·黄昏（计票破平 + 放逐 + 遗言 1 条 + 胜负检查②+days_max 兜底③）：expect stage='day' */
async function runDusk(args, prereg) {
  const c = await dayCtx(args, prereg, 'dusk', ['day']);
  const { day, gid, meta, truth, seatRole, wolves, dead, usageAgg, rng, deviations, stepLog, conn } = c;
  const votes = (meta.truth.votes || {})[day] || {};
  const tally = {}; for (const s of Object.values(votes)) { if (s > 0) tally[s] = (tally[s] || 0) + 1; }
  const maxV = Object.keys(tally).length ? Math.max.apply(null, Object.values(tally)) : 0;
  let tied = Object.keys(tally).map(Number).filter(s => tally[s] === maxV);
  let exiled, tiebreak = null;
  if (!tied.length) { exiled = aliveSeatsOf(meta)[Math.floor(rng() * aliveSeatsOf(meta).length)]; tiebreak = { method: 'all_abstain_seeded_rng', seed: prereg.seed + day * 10 + 3 }; }
  else if (tied.length > 1) { tied.sort((a, b) => a - b); exiled = tied[Math.floor(rng() * tied.length)]; tiebreak = { tied: tied.slice(), method: 'seeded_rng', seed: prereg.seed + day * 10 + 3 }; }
  else exiled = tied[0];
  dbApi.addEvent({ game_id: gid, day, phase: 'dusk', type: 'death', actor_seat: exiled,
    raw_text: '第 ' + day + ' 天计票：' + JSON.stringify(tally) + '。' + exiled + ' 号被放逐出局' + (tiebreak ? '（平票/兜底，seed 破平）' : '') + '。' });
  if (dead.indexOf(exiled) === -1) dead.push(exiled);
  stepLog('dusk exile=' + exiled + ' tally=' + JSON.stringify(tally) + ' tiebreak=' + JSON.stringify(tiebreak));
  // 遗言：仅放逐者 1 条（type=statement, phase=dusk）；夜死者无遗言
  let lastWords = null;
  try {
    const lw = await callJson([{ role: 'user', content: buildLastWordsPrompt({ seat: exiled, role: seatRole[exiled], wolves, day, checks: truth.checks || [], potions: truth.potions }) }],
      { temperature: prereg.temperature, model: prereg.model, usageAgg });
    lastWords = String(lw.obj.speech || '').trim();
  } catch (e) { usageAgg.parse_fallback += 1; lastWords = '（遗言解析失败占位）'; }
  dbApi.addEvent({ game_id: gid, day, phase: 'dusk', type: 'statement', actor_seat: exiled, raw_text: exiled + ' 号（遗言）：' + lastWords });
  stepLog('dusk lastwords seat=' + exiled + ' len=' + (lastWords || '').length);
  truth.exile = (truth.exile || []).concat([{ day, seat: exiled, role: seatRole[exiled], votes: Object.assign({}, votes), tally: Object.assign({}, tally), tiebreak, last_words: lastWords }]);
  truth.dead = dead.slice();
  meta.truth.deaths = { night: truth.night || [], exile: truth.exile };
  // 胜负检查② + days_max=3 兜底③
  let win = resolveWin(seatRole, dead);
  if (!win && day >= c.daysMax) {
    const wolvesAlive = Object.keys(seatRole).map(Number).filter(s => seatRole[s] === 'werewolf' && dead.indexOf(s) === -1);
    win = { result: 'wolf_win', reason: 'days_max_' + c.daysMax + '_wolves_alive' };
    deviations.push('day' + day + ' 触发 days_max=' + c.daysMax + ' 兜底：狼存活 ' + wolvesAlive.length + ' → wolf_win（§1.1 终局条件③）');
  }
  meta.stage = win ? 'day_final' : 'init';
  meta.day = day; meta.day_last = day; meta.days_max = c.daysMax;
  if (win) { meta.truth.result = win.result; meta.truth.result_reason = win.reason; }
  meta.qc = usageAgg; meta.deviations = (meta.deviations || []).concat(deviations);
  saveSimMeta(conn, gid, meta);
  stepLog('day' + day + '.dusk done stage=' + meta.stage + ' win=' + JSON.stringify(win) + ' calls=' + usageAgg.calls);
  const sumK = { ok: true, stage: meta.stage, day, game_id: gid, name: args.name, exile: exiled, win, deviations, files: [] };
  fs.writeFileSync(path.join(args.out, args.name + '.day' + day + '.dusk.json'), JSON.stringify(sumK, null, 2), 'utf8');
  console.log('[DUSK-OK] ' + JSON.stringify(sumK));
  dbApi.closeCurrent();
}


/** stage2：纯本地结算+导出（读 stage1 meta，零 LLM 调用，秒级） */
async function runStage2(args, prereg) {
  const stepLog = msg => fs.appendFileSync(path.join(args.out, args.name + '.steps.log'), new Date().toISOString() + ' ' + msg + '\n');
  stepLog('stage2 start');
  dbApi.init(path.resolve(args.db));
  const conn = dbApi.getConnection();
  conn.pragma('busy_timeout = 5000');
  const colDev = [];
  ensureSimColumns(conn, colDev); // 新库初始只有 5 列，无 source/meta，必须先补列再查
  if (colDev.length) stepLog('ensureSimColumns: ' + colDev.join(' | '));
  const row = conn.prepare("SELECT id, meta FROM games WHERE name=? AND source='sim' ORDER BY id DESC LIMIT 1").get(args.name);
  if (!row) throw new Error('stage2 找不到 stage1 局: ' + args.name);
  const gid = row.id;
  const m0 = JSON.parse(row.meta || '{}');
  // 兼容旧一夜狼局（stage===1）：原 stage2 逻辑从略，B2 走多日局路径
  if (m0.source !== 'sim') throw new Error('meta 缺失或非 sim 局: ' + args.name);
  if (m0.stage === 1) throw new Error('该局是一夜狼 stage1（stage=' + m0.stage + '），多日局 stage2 需接 day_final；拒跑：' + args.name);
  if (m0.stage !== 'day' && m0.stage !== 'day_final') throw new Error('meta.stage=' + m0.stage + '，需先跑 --stage day 至终局或 days_max；拒跑');
  const m = m0;
  const truth = m.truth;
  const seatRole = truth.roles, wolves = truth.wolves, villagers = truth.villagers, gods = truth.gods || [];
  const usageAgg = m.qc || { calls: 0, prompt_tokens: 0, completion_tokens: 0, parse_fallback: 0 };
  const deviations = (m.deviations || []).concat(colDev);
  const daysMax = m.days_max || 3;
  const lastDay = m.day_last || m.day || 0;
  // ── 胜负：优先取 day 段已判结果；未判则按 days_max 兜底③再判一次
  let result = truth.result || null, reason = truth.result_reason || null;
  const dead = (truth.dead || []).slice();
  if (!result) {
    const w = resolveWin(seatRole, dead);
    if (w) { result = w.result; reason = w.reason; }
    else if (lastDay >= daysMax) {
      const wolvesAlive = Object.keys(seatRole).map(Number).filter(s => seatRole[s] === 'werewolf' && dead.indexOf(s) === -1);
      result = 'wolf_win'; reason = 'days_max_' + daysMax + '_wolves_alive';
      deviations.push('stage2 触发 days_max=' + daysMax + ' 兜底：狼存活 ' + wolvesAlive.length + ' → wolf_win（§1.1 终局条件③）');
    }
  }
  if (!result) throw new Error('胜负未决且未到 days_max：请继续 --stage day');
  const aliveFinal = aliveSeatsOf({ truth: truth });
  const resultText = result === 'village_win'
    ? '好人阵营胜利（狼人全灭：' + wolves.join('、') + ' 号；存活 ' + aliveFinal.join('、') + '）'
    : '狼人阵营胜利（' + ({ gods_all_dead: '神职全灭', villagers_all_dead: '平民全灭' }[reason] || reason) + '；狼人 ' + wolves.join('、') + ' 号）';
  dbApi.addEvent({ game_id: gid, day: lastDay, phase: 'dusk', type: 'system', actor_seat: null, raw_text: '游戏结束（第 ' + lastDay + ' 天结算）：' + resultText + '。' });
  truth.result = result; truth.result_reason = reason; truth.result_text = resultText;
  truth.deaths = { night: truth.night || [], exile: truth.exile || [] };
  truth.alive_final = aliveFinal;
  m.stage = 2; m.source = 'sim';
  saveSimMeta(conn, gid, m);
  stepLog('stage2 resolved result=' + result + ' reason=' + reason + ' day=' + lastDay);
  // ── 导出 replay md（对齐 p0-replay 样板）+ truth md（逐日节，§6 B2）
  const st = dbApi.loadGameState(gid);
  const VARIANT_LINE = '版型：6 人标准狼 3 天屠边——狼人×2 / 预言家×1 / 女巫×1 / 平民×2；每夜 狼刀1→预言家验1→女巫{救|毒}（同夜至多一瓶）；每昼 存活者发言→投票放逐1→遗言；狼全灭=好人胜，神全灭∨民全灭=狼胜，第 3 昼未分胜负=狼胜。';
  const replayHead = [
    '# replay-' + args.name + ' ｜ 公开信息流（盲测 AI 可读）', '',
    '对局：多日局标准狼人杀 · 6 人（sim 自对局 B2 端到端；账本 game_id=' + gid + '）',
    VARIANT_LINE,
    '还原完整度：100%（程序生成全量事件；发言/遗言为 LLM 生成——sim 语料非真人，恒挂「模拟语料」标注）。',
    '说明：本文件只含公开信息流；真值在 .truth.md 与 games.meta。玩家名单：1-6 号（sim-座位号）。死亡公告不公布死因（刀毒不可分辨）。',
    '预注册五元组：seed=' + prereg.seed + ' model=' + prereg.model + ' temperature=' + prereg.temperature + ' variant=' + prereg.variant.id + ' prompt_version=' + prereg.prompt_version + '（prereg-multi.json 冻结前草案）。',
    '局况：共 ' + lastDay + ' 天（days_max=' + daysMax + '）。',
    '',
  ].join('\n');
  // 逐日节：按 events.day 分组，日标题下按 phase 顺序出 E 行
  const days = Array.from(new Set(st.events.map(e => e.day))).sort((a, b) => a - b);
  const daySections = days.map(d => {
    const evs = st.events.filter(e => e.day === d);
    const night = evs.filter(e => e.phase === 'night');
    const dayp = evs.filter(e => e.phase === 'day');
    const dusk = evs.filter(e => e.phase === 'dusk');
    const lines = evs.map(e => '- E-' + e.seq + ': ' + e.raw_text);
    return ['## 第 ' + d + ' 天', '',
      '小结：夜 ' + night.length + ' 条 / 昼 ' + dayp.length + ' 条 / 黄昏 ' + dusk.length + ' 条。',
      '', ...lines, ''].join('\n');
  });
  const replay = replayHead + '\n' + daySections.join('\n') + '\n'
  const ROLE_CN = { werewolf: '狼人', seer: '预言家', witch: '女巫', villager: '平民' };
  const roleTable = Object.keys(seatRole).map(Number).sort((a, b) => a - b)
    .map(s => '| ' + s + ' | ' + ROLE_CN[seatRole[s]] + ' | ' + (dead.indexOf(s) === -1 ? '存活' : '出局') + ' |').join('\n');
  const nightRows = (truth.night || []).map(n => '| 第 ' + n.day + ' 夜 | ' + (n.kill_target === null ? '—' : n.kill_target) + ' | ' + (n.saved ? '是（平安）' : '否') + ' | ' + (n.check_seat === null ? '—' : n.check_seat + '=' + n.check_result) + ' | ' + (n.poison === null ? '—' : n.poison) + ' | ' + ((n.deaths || []).join('、') || '（平安夜）') + ' |').join('\n');
  const exileRows = (truth.exile || []).map(x => '| 第 ' + x.day + ' 昼 | ' + x.seat + ' | ' + ROLE_CN[seatRole[x.seat]] + ' | ' + JSON.stringify(x.tally) + (x.tiebreak ? '（' + x.tiebreak.method + ' 破平）' : '') + ' |').join('\n');
  const truthMd = [
    '# replay-' + args.name + ' ｜ 真相层（盲测 AI 不得阅读）', '',
    '- **狼人阵营**：' + wolves.join('、') + ' 号',
    '- **神职**：' + gods.map(s => s + ' 号(' + ROLE_CN[seatRole[s]] + ')').join('、') + '；**平民**：' + villagers.join('、') + ' 号',
    '- **胜负：' + resultText + '**（reason=' + reason + '，第 ' + lastDay + ' 天结算，days_max=' + daysMax + '）',
    '- 最终存活：' + aliveFinal.join('、') + ' 号；出局：' + dead.join('、') + ' 号', '',
    '## 角色表（机检基准）', '', '| 席位 | 角色 | 终态 |', '|---|---|---|', roleTable, '',
    '## 逐夜真值（刀/救/验/毒/死）', '', '| 夜 | 刀口 | 女巫救 | 预言家验 | 毒 | 夜死者 |', '|---|---|---|---|---|---|',
    nightRows || '| — | — | — | — | — | — |', '',
    '## 逐昼放逐', '', '| 昼 | 放逐 | 角色 | 票型 |', '|---|---|---|---|',
    exileRows || '| — | — | — | — |', '',
    '## QC（B2 端到端）', '',
    '- LLM 调用数：' + usageAgg.calls + '；prompt_tokens=' + usageAgg.prompt_tokens + '；completion_tokens=' + usageAgg.completion_tokens + '；解析降级=' + usageAgg.parse_fallback,
    '- 事件数=' + st.events.length + '；claims=' + st.claims.length + '；actions=' + st.actions.length,
    '- 偏差记录：' + (deviations.length ? '\n  - ' + deviations.join('\n  - ') : '无'),
    '- 模型=' + prereg.model + '；provider=' + (prereg.provider || 'tokenrhythm') + '；prompt_version=' + prereg.prompt_version, '',
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


