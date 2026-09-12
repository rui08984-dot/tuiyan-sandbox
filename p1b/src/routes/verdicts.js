'use strict';
/**
 * p1b/src/routes/verdicts.js —— 多路判词路由（第十棒 W2）：
 *   POST /api/games/:id/predictions/:pid/verdicts → 3 路生成+全量逐行落库（不只存聚合值）。
 *
 * 3 路 = 同 provider（tokenrhythm）× 3 prompt 变体 × 温度多样性（0.2/0.7/1.0）：
 *   v1_evidence  T=0.2  证据聚合视角（合法角色：信息聚合）
 *   v2_skeptical T=0.7  怀疑派视角（发散候选，G-合并 R-b：高温=发散原料非预测信号）
 *   v3_baserate  T=1.0  基率视角（合法角色：基率检索）
 * provider 维度留空待第二把 key 扩展 3×N（表结构已兼容）。
 *
 * 铁律落点（契约设计，写死）：
 *   ①LLM 只产出文本（多路推理=合法四角色之一）；②implied_prob 必须由 extractImpliedProb
 *   按固定输出格式（末行 P=0.xx）正则机械抽取——LLM 不直接给数（项目两次负结果均死于
 *   LLM 直接输出数字）；③抽取失败 → implied_prob=NULL 如实落库（verdict_text 全量保留，
 *   消融时剔除该行），绝不编数；④单路失败不落库不编造，errors 数组如实标注。
 *
 * 批次1-M1（p15）per-path 注入（B1(a) 信息差为准；队长规划 §1.2/§1.3）——
 *   v1_evidence：题面 + 账本证据块（loadEvidence：evidence_json→events id+game_id 双条件，
 *     防跨局悬空；块头恒标「账本事件引用」，不声称结算前信息——90 条系已 resolve 题的
 *     R-A 读数实验口径，读数 ≠ 信息价值）。
 *   v2_skeptical：纯题面（信息差对照臂，零注入）。
 *   v3_baserate：题面 + LOO 基率背景行（loadBaseline：同 game_type 同 layer 已 resolve
 *     true 占比，排除本条自身防自我泄漏；有效 n<10 如实标「基率样本不足」；L1 重言层与
 *     未分类层一律不注入——评审攻击 6：重言基率 0/30 白送）。措辞背景化（J3 FB+J6 Study2：
 *     「仅作背景参考」），禁任何「请据此更新」式更新指令（Schoenegger 实测更新指令劣化）。
 *   输出契约：末行 P=0.xx 不变（extractImpliedProb/judge-runner 全链兼容），其上一行新增
 *   「Range: A%-B%」区间行（区间端点=第二信号源，J2 Lu/J6；宽度入库供批次 1 消融）。
 */
const { db, llm } = require('../deps');
const predictions = require('../db/predictionsStore');
const vstore = require('../db/verdictsStore');
const { chatText } = require('../lib/llmChat');
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404 } = require('./games');
const { httpError, requireInt } = require('../util');

/** 3 路预注册配置（变体×温度配对=任务书降级版；provider 维度留空待补） */
const ROUTES = [
  { variant: 'v1_evidence', temperature: 0.2 },
  { variant: 'v2_skeptical', temperature: 0.7 },
  { variant: 'v3_baserate', temperature: 1.0 },
];

const VARIANT_ANGLE = {
  v1_evidence: '证据聚合视角：基于已给出的判定标准与已知事实链，评估该判定为真的可能性，逐条列出支持与反对证据。',
  v2_skeptical: '怀疑派视角：假设该判定可能不成立，找出反例、信息缺口与替代解释，再给出倾向。',
  v3_baserate: '基率视角：忽略个案细节，从同类局型的历史基率出发评估该判定为真的可能性。',
};

const OUTPUT_FORMAT_RULE = '输出要求：正文分析不超过150字；在最后一行之前给一行「Range: A%-B%」格式（本路倾向的置信区间端点，整数百分比，例如 Range: 40%-60%）；最后一行必须严格是「P=0.xx」格式（0到1之间的小数，例如 P=0.65）。';

/** system 首行恒挂边界（思路非答案/参考铁律同源） */
const SYSTEM_HEAD = '你是多路判词实验装置中的一路（合法角色：多路推理）。你的输出仅作复盘参考，不接入现场研判。';

function buildSystemPrompt(variant) {
  return SYSTEM_HEAD + VARIANT_ANGLE[variant] + OUTPUT_FORMAT_RULE;
}

function buildUserPrompt(prediction, game, extras) {
  const o = extras || {};
  const lines = [
    '判定标准：「' + prediction.statement + '」',
    '落注信息：第 ' + prediction.day + ' 天落注；局类型 ' + (game && game.game_type ? game.game_type : 'unknown') + '。',
  ];
  if (o.evidenceBlock) lines.push(o.evidenceBlock); // v1 专属（B1(a)：v2 纯题面作信息差对照）
  const baseLine = formatBaselineLine(o.baseline); // v3 专属（LOO 基率背景行；L1/未分类 → null → 不注入）
  if (baseLine) lines.push(baseLine);
  lines.push('请按你的视角输出分析，并在最后一行给出 P=0.xx。');
  return lines.join('\n');
}

// ── per-path 注入件（批次1-M1，p15）──────────────────────────────────────────

const EVIDENCE_TRUNC = 120;   // 每条事件 raw_text 截 120 字（批次 2-R-C：从 200 降防挤占——诊断 §4：发言中位 178 字、16% 被截）
const LOO_MIN_N = 10;         // 有效基率样本下限（n<10 如实标「基率样本不足」）
const EVIDENCE_HEAD = '账本证据引用（截至 cutoff 的公开记录，非结算信息）：';
const CLAIMS_HEAD = '账本声称记录（claims 结构化，按声称席位聚合）：';
const STATS_HEAD = '账本机械统计（截至 cutoff，纯代码计算零 LLM）：';
const NO_EVIDENCE_LINE = '（本条无证据引用，仅题面陈述）';

/** 截断（超长加省略号） */
function truncateText(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 证据块 2.0（v1 专属，R-C 证据呈现升级；rb-attribution 诊断 2026-09-13 落地）——三段结构化注入：
 *   a) 事件流：evidence_json 事件 id → events id+game_id 双条件查（防跨局悬空），raw_text 截 120 字；
 *   b) 结构化 claims：claims 表按声称席位聚合（条数+逐条谓词→对象，单条截 80 字），标「账本声称记录」
 *      ——诊断 §5 管道层缺口：R-B 时 claims 从不注入，T7 精确规则（idclaims≥10）首因丢失；
 *   c) 机械特征卡：发言条数/总字数/声称总数/身份声称/指认总数/被指认席位数/单席最高被指认/夜死席位
 *      ——全部由 evidence 事件集+其 claims 纯代码计算（零 LLM），标「账本机械统计（截至 cutoff）」；
 *      禁止注入任何结算信息（计票/终局/roles 不触达；夜死席位取自天亮公告文本= cutoff 前公开信息，
 *      正则取「N 号死亡」避开 events.actor_seat=players.id 坑）。
 * 空/全部悬空 → 「（本条无证据引用，仅题面陈述）」。
 * @returns {string} 多行证据块（零网络，纯查库）
 */
function loadEvidence(prediction) {
  const ids = (prediction && Array.isArray(prediction.evidence)) ? prediction.evidence : [];
  if (!ids.length) return NO_EVIDENCE_LINE;
  const conn = db.getConnection();
  // a) 事件流
  const evs = [];
  for (const id of ids) {
    // p14 坑位提示：events.actor_seat 存 players.id 而非座位号——本查询不取该列；夜死席位从公告文本正则取。
    const ev = conn.prepare('SELECT id, game_id, day, phase, type, raw_text FROM events WHERE id = ? AND game_id = ?')
      .get(id, prediction.game_id);
    if (ev) evs.push(ev);
  }
  if (!evs.length) return NO_EVIDENCE_LINE; // 全部悬空
  // b) 结构化 claims（claims.seat/subject_seat=座位号——A0 差异表 L82 口径，与 events.actor_seat 不同）
  const claims = conn.prepare('SELECT seat, subject_seat, predicate, object FROM claims WHERE event_id IN ('
    + ids.map(() => '?').join(',') + ') ORDER BY id').all.apply(
    conn.prepare('SELECT seat, subject_seat, predicate, object FROM claims WHERE event_id IN ('
      + ids.map(() => '?').join(',') + ') ORDER BY id'), ids);
  // 按声称席位聚合
  const bySeat = {};
  for (const c of claims) { (bySeat[c.seat] = bySeat[c.seat] || []).push(c.predicate + '→' + c.object); }
  const claimLines = Object.keys(bySeat).sort((x, y) => x - y).map((seat) =>
    '席位 ' + seat + ' 共声称 ' + bySeat[seat].length + ' 条：' + bySeat[seat].map((s) => truncateText(s, 80)).join('；'));
  // c) 机械特征卡（纯代码；特征定义=rb-attribution §2）
  const stmts = evs.filter((e) => e.type === 'statement');
  const charsTotal = stmts.reduce((a, e) => a + e.raw_text.length, 0);
  const ID_PRED = ['is_wolf', 'is_good', 'claims_role'];
  const idclaims = claims.filter((c) => ID_PRED.indexOf(c.predicate) !== -1).length;
  const wolfAcc = {};
  for (const c of claims) if (c.predicate === 'is_wolf' && String(c.seat) !== String(c.subject_seat)) wolfAcc[c.subject_seat] = (wolfAcc[c.subject_seat] || 0) + 1;
  const wolfaccTotal = Object.values(wolfAcc).reduce((x, y) => x + y, 0);
  const accusedDist = Object.keys(wolfAcc).length;
  const topAccused = wolfaccTotal ? Math.max.apply(null, Object.values(wolfAcc)) : 0;
  let victimSeat = null;
  const nightDeath = evs.find((e) => e.type === 'death' && e.phase === 'day');
  if (nightDeath) { const m = nightDeath.raw_text.match(/(\d+)\s*号死亡/); if (m) victimSeat = m[1]; }
  const statLines = [
    '发言条数：' + stmts.length + '；发言总字数：' + charsTotal,
    '声称总数：' + claims.length + '（其中身份声称 ' + idclaims + '）',
    '指认总数（is_wolf 指认他人）：' + wolfaccTotal + '；被指认席位数：' + accusedDist + '；单席最高被指认：' + topAccused,
    '夜死席位：' + (victimSeat === null ? '无' : victimSeat + ' 号'),
  ];
  // 组装：a 事件流 + b claims + c 特征卡
  const blocks = [EVIDENCE_HEAD];
  for (const ev of evs) blocks.push('事件 #' + ev.id + '（day ' + ev.day + '/' + ev.type + '）：' + truncateText(ev.raw_text, EVIDENCE_TRUNC));
  if (claimLines.length) { blocks.push(CLAIMS_HEAD); blocks.push.apply(blocks, claimLines); }
  blocks.push(STATS_HEAD); blocks.push.apply(blocks, statLines);
  return blocks.join('\n');
}

/**
 * LOO 基率（v3 专属）：同 game_type 同 layer 已 resolve（true/false）点的 true 占比，
 * 排除本条自身（leave-one-out，防自我泄漏；规划 §1.2）。有效样本 n<LOO_MIN_N → rate=null
 * （调用方如实标「基率样本不足」）；layer='L1'（重言）或 layer 未分类 → null（一律不注入）。
 * @returns {{n:number, rate:number|null}|null} null=不注入
 */
function loadBaseline(prediction) {
  if (!prediction || !prediction.layer) return null;      // 未分类层不注入（layer 绑定是基率语义前提）
  if (prediction.layer === 'L1') return null;             // 重言层不注入（评审攻击 6：0/30 白送）
  const conn = db.getConnection();
  const row = conn.prepare(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN p.outcome = 'true' THEN 1 ELSE 0 END) AS t" +
    ' FROM predictions p JOIN games g ON g.id = p.game_id' +
    ' WHERE g.game_type = (SELECT game_type FROM games WHERE id = ?)' +
    ' AND p.layer = ?' +
    " AND p.outcome IN ('true','false')" +
    ' AND p.id != ?'
  ).get(prediction.game_id, prediction.layer, prediction.id);
  const n = row ? Number(row.n) : 0;
  if (!n || n < LOO_MIN_N) return { n: n, rate: null };   // 样本不足如实返回（n 可为 0）
  return { n: n, rate: Number(row.t) / n };
}

/**
 * 基率行格式化（背景化措辞，J3 FB + J6 Study2）：恒以「仅作背景参考」收尾，
 * 禁任何「请据此更新」式更新指令（Schoenegger 实测更新指令劣化）。
 * @returns {string|null} baseline 为 null → null（不注入）
 */
function formatBaselineLine(baseline) {
  if (!baseline) return null;
  if (baseline.rate === null || baseline.rate === undefined) {
    return '账本历史统计：基率样本不足（同类局型有效样本 n=' + baseline.n + '<' + LOO_MIN_N + '），仅作背景参考';
  }
  const pct = Number((baseline.rate * 100).toFixed(1)); // 0.9→90、0.6667→66.7
  return '账本历史统计（同类局型 n=' + baseline.n + '，true 占比 ' + pct + '%），仅作背景参考';
}

/**
 * implied_prob 机械抽取（契约：末行 P=0.xx；禁 LLM 自由给数）。
 * 只认 [0,1] 小数（P=1 / P=0 合法；P=1.5 / P=65% 不认）；从后往前找首个含 P= 之行。
 * @returns {number|null} 抓不到或越界 → null（不编数）
 */
function extractImpliedProb(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/(^|[^A-Za-z0-9])P\s*=\s*([01](?:\.\d+)?)\s*$/i);
    if (m) {
      const v = parseFloat(m[2]);
      return (v >= 0 && v <= 1) ? v : null;
    }
  }
  return null;
}

/** MOCK 判词（确定性模板，零网络；三路可区分且末行带 P= 供抽取链路烟测）。
 *  批次1-M1 同步：v1 附证据块行（真实查库所得，与 live 同源）；v3 附基率背景行；
 *  三路在末行 P=0.xx 契约之上加「Range: A%-B%」区间行（P±0.10，端点=第二信号源；
 *  extractImpliedProb 仍只认末行 P=，全链兼容不破坏）。 */
function buildMockVerdict(variant, temperature, statement, extras) {
  const o = extras || {};
  const mockProb = { v1_evidence: '0.25', v2_skeptical: '0.50', v3_baserate: '0.75' }[variant] || '0.50';
  const brief = String(statement || '').slice(0, 40);
  const lines = [
    '[MOCK ' + variant + ' T=' + temperature + '] 判词（零网络模板）：就「' + brief
      + '」按本路视角给出复盘参考倾向（思路非答案，仅供消融管线烟测）。',
  ];
  if (variant === 'v1_evidence' && o.evidenceBlock) lines.push(o.evidenceBlock);
  const baseLine = formatBaselineLine(o.baseline);
  if (variant === 'v3_baserate' && baseLine) lines.push(baseLine);
  const p = parseFloat(mockProb);
  const lo = Math.max(0, Math.round((p - 0.10) * 100));
  const hi = Math.min(100, Math.round((p + 0.10) * 100));
  lines.push('Range: ' + lo + '%-' + hi + '%'); // 区间行恒在 P= 之上；不含 P= 不干扰抽取
  lines.push('P=' + mockProb);
  return lines.join('\n');
}

function register(app, ctx) {
  vstore.ensureVerdictsTable(db.getConnection()); // additive 私有表（register 内 ensure，oracleCast 先例）

  app.post('/api/games/:id/predictions/:pid/verdicts', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    const game = getGameOr404(gameId);
    const pid = requireInt('prediction id', req.params.pid, 1);
    const pred = predictions.getPrediction(pid);
    if (!pred || pred.game_id !== gameId) {
      throw httpError(404, '预测记录不存在或不属于该局: ' + pid);
    }
    // 批次2-M1（R-A 后解冻件）：runId/model 可选透传（additive，缺省 NULL）——
    // 跑批批次指纹（PREREG hash 前 12 位）与模型口径入 verdicts 表，供消融按重跑批次分组。
    const bodyRun = req.body || {};
    const runId = (typeof bodyRun.runId === 'string' && bodyRun.runId.trim()) ? bodyRun.runId.trim() : null;
    const model = (typeof bodyRun.model === 'string' && bodyRun.model.trim()) ? bodyRun.model.trim() : null;
    const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
    const mode = llm.resolveMode(options); // mockMode/无 key → MOCK（零网络，与 extract/advise/oracle 同链）
    // per-path 注入件（批次1-M1）：与 variant 无关，循环外各算一次（纯查库零网络）
    const evidenceBlock = loadEvidence(pred);
    const baseline = loadBaseline(pred);
    const saved = [];
    const errors = [];
    for (const route of ROUTES) {
      try {
        let text;
        if (mode === 'MOCK') {
          text = buildMockVerdict(route.variant, route.temperature, pred.statement, { evidenceBlock: evidenceBlock, baseline: baseline });
        } else {
          const extras = {};
          if (route.variant === 'v1_evidence') extras.evidenceBlock = evidenceBlock;
          if (route.variant === 'v3_baserate') extras.baseline = baseline;
          text = await chatText(
            [{ role: 'system', content: buildSystemPrompt(route.variant) }, { role: 'user', content: buildUserPrompt(pred, game, extras) }],
            Object.assign({}, options, { temperature: route.temperature })
          );
        }
        const prob = extractImpliedProb(text); // 机械抽取：数字只从文本正则来
        const row = vstore.saveVerdict({
          predictionId: pid,
          promptVariant: route.variant,
          temperature: route.temperature,
          verdictText: text,
          impliedProb: prob,
          runId: runId,
          model: model,
        });
        saved.push({
          id: row.id,
          prompt_variant: row.prompt_variant,
          temperature: row.temperature,
          implied_prob: row.implied_prob,
          extracted: prob !== null,
          created_at: row.created_at,
          run_id: row.run_id,
          model: row.model,
        });
      } catch (e) {
        // 单路失败不落库不编造（消融数据干净优先）；如实标注
        errors.push({ prompt_variant: route.variant, temperature: route.temperature, error: String((e && e.message) ? e.message : e) });
      }
    }
    return {
      prediction_id: pid,
      mode: mode === 'MOCK' ? 'mock' : 'live',
      saved: saved,
      errors: errors,
      note: 'LLM 只产出文本；implied_prob 由末行「P=0.xx」固定格式正则机械抽取，抽取失败落 NULL 不编数',
      l0_gate: predictions.l0Gate(),
    };
  });
}

module.exports = {
  register, ROUTES, extractImpliedProb, buildMockVerdict, buildSystemPrompt, buildUserPrompt,
  loadEvidence, loadBaseline, formatBaselineLine, // 批次1-M1 per-path 注入件（测试与消融复用）
  EVIDENCE_HEAD, NO_EVIDENCE_LINE, // 注入口径常量（测试断言复用，防文案漂移）
};
