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
 *
 * 证据块 3.0（命题 A 接线；用户 2026-09-13 拍板 Q2=A）——2.0→3.0 差异（**只增不改**）：
 *   2.0 = a 事件流 + b claims 按席位聚合 + c 机械特征卡（三段，纯代码）。
 *   3.0 = 2.0 三段 + d 机械矛盾特征（实跑 detectors/werewolf-contradictions.js 的 W1-W6：
 *     矛盾对数 / 涉及席位 / 类型分布 + 矛盾明细行）。差异仅在**末尾追加 d 段**，a/b/c 逐字节
 *     不变 → 关闭开关时整块逐字节退回 2.0 形状。修复对象=R1-F10 实测的「检测器已落地但判词链
 *     未接线」：loadEvidence 此前从不调用本检测器。
 *   消融开关：env `P1B_EVIDENCE_V3` ∈ {0,off,false,no,disabled} → 关；或 loadEvidence(pred,{contradictions:false})。
 *     默认开启（生产 v1_evidence 走 3.0）；开关只控制 d 段，与 a/b/c 无关。
 *   臂模式（PREREG-命题A-3.0消融 §2 三臂）：env `P1B_EVIDENCE_V3_MODE` ∈ {on,off,sham} 或 opts.contradictionsMode。
 *     off/缺省/非法＝现有行为（由 P1B_EVIDENCE_V3 决定）；on＝真实 d 段；sham＝**等 token 无信息占位 d 段**（C 臂）。
 *   边界：d 段输入=证据窗内 events/claims 副本；检测器真值盲（禁触 games.meta.truth）；
 *     events.actor_seat=players.id 须 JOIN players 还原座位号（acr-run.cjs L21-24 同口径）；
 *     非狼人域局（game_type 解析不出 format）不追加 d 段 → 2.0 形状。
 */
const { db, llm } = require('../deps');
const predictions = require('../db/predictionsStore');
const vstore = require('../db/verdictsStore');
const { chatText } = require('../lib/llmChat');
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404 } = require('./games');
const { httpError, requireInt } = require('../util');
// 3.0 d 段：机械矛盾检测器 W1-W6（真值盲/零 LLM/零网络；avalon.js 已同源只读引用）
const DET = require('../detectors/werewolf-contradictions');

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
// 【2026-09-13 修预存在 bug】corpus 型 predictions 的 evidence 是结构化快照（对象数组）而非事件 id：
const STRUCTURED_EVIDENCE_LINE = '（本条证据为结构化快照·非事件流，判词证据块不适用）';
// ── 证据块版本与 3.0 d 段常量 ──
const EVIDENCE_VERSION = '3.0';                 // 3.0 = 2.0 三段 + d 机械矛盾特征
const EVIDENCE_VERSION_2_0 = '2.0';             // 关闭开关时的形状版本（消融对照臂）
const EVIDENCE_V3_ENV = 'P1B_EVIDENCE_V3';      // 消融开关：0/off/false/no/disabled → 关闭
const V3_OFF_VALUES = ['0', 'off', 'false', 'no', 'disabled', 'none'];
const EVIDENCE_V3_MODE_ENV = 'P1B_EVIDENCE_V3_MODE'; // 臂模式：on | off | sham（缺省 off＝现有行为）
const V3_MODES = ['on', 'off', 'sham'];
const SHAM_HEAD = '账本机械矛盾特征（占位·消融 sham 臂，无真实特征信息）：';
const SHAM_FILLER = '占位';
const CONTRADICTION_HEAD = '账本机械矛盾特征（W1-W6 版型无关检测器，纯代码计算零 LLM）：';
const CONTRADICTION_DETAIL_MAX = 6;             // 明细行上限（防 prompt 膨胀；超出如实标「共 N 对」）

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
 * 3.0 追加 d 段（机械矛盾特征）：仅当开关开启且 game_type 解析出狼人域 format；默认开启，
 *   关闭→ a/b/c 逐字节等于 2.0。
 * @param {object} prediction 预测行（需 id/game_id/evidence）
 * @param {{contradictions?: boolean}} [opts] 消融参数（缺省读 env P1B_EVIDENCE_V3）
 * @returns {string} 多行证据块（零网络，纯查库）
 */
function loadEvidence(prediction, opts) {
  // 【2026-09-13 修预存在 bug】1053 条 corpus 型 evidence 为结构化对象数组（非事件 id）。
  // 旧实现把元素直接当 SQL 参数绑定（下方 events 循环与 claims 的 IN 展开）→ RangeError，
  // 生产 POST /predictions/:pid/verdicts 打到 corpus 预测即 500。此处只保留可作事件 id 的标量；
  // 纯结构化快照走专用兜底行（与修复前基线的差异仅出现在这些原本会崩溃的行上）。
  // 命题 A 消融窗口覆盖（additive）：opts.evidenceIds 显式给出事件 id 集时优先（缺省＝prediction.evidence，逐字节不变）。
  const raw = (opts && Array.isArray(opts.evidenceIds)) ? opts.evidenceIds
    : ((prediction && Array.isArray(prediction.evidence)) ? prediction.evidence : []);
  if (!raw.length) return NO_EVIDENCE_LINE;
  const ids = raw.filter((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''));
  if (!ids.length) return STRUCTURED_EVIDENCE_LINE;
  const conn = db.getConnection();
  // a) 事件流
  const evs = [];
  for (const id of ids) {
    // p14 坑位提示：events.actor_seat 存 players.id 而非座位号——c 段夜死席位仍从公告文本正则取（不走该列）。
    // 3.0：补 e.seq（W5 时序序）与还原后的座位号 p.seat（actor_seat=players.id → JOIN 还原，
    // acr-run.cjs L21-24 同口径；game_id 并列进 JOIN 防跨局 id 撞车）。a/b/c 只读 id/day/type/raw_text，不受影响。
    const ev = conn.prepare('SELECT e.id, e.game_id, e.day, e.phase, e.seq, e.type, p.seat AS actor_seat, e.raw_text'
      + ' FROM events e LEFT JOIN players p ON p.id = e.actor_seat AND p.game_id = e.game_id'
      + ' WHERE e.id = ? AND e.game_id = ?')
      .get(id, prediction.game_id);
    if (ev) evs.push(ev);
  }
  if (!evs.length) return NO_EVIDENCE_LINE; // 全部悬空
  // b) 结构化 claims（claims.seat/subject_seat=座位号——A0 差异表 L82 口径，与 events.actor_seat 不同）
  // 3.0：补 c.id/c.event_id（检测器 refs 'c<id>' 与 claim_a/claim_b 需要）；绑定方式与 2.0 等价（apply 展开）。
  const claimStmt = conn.prepare('SELECT id, event_id, seat, subject_seat, predicate, object FROM claims WHERE event_id IN ('
    + ids.map(() => '?').join(',') + ') ORDER BY id');
  const claims = claimStmt.all.apply(claimStmt, ids);
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
  // d) 机械矛盾特征（3.0 新增，纯代码；开关关闭或非狼人域 → 不追加 → 逐字节退回 2.0）
  if (isContradictionEnabled(opts)) {
    const grow = conn.prepare('SELECT game_type FROM games WHERE id = ?').get(prediction.game_id);
    const format = resolveContradictionFormat(grow && grow.game_type);
    if (format) {
      const pairs = DET.detectWerewolfContradictions({ format: format, events: evs, claims: claims });
      blocks.push.apply(blocks, resolveV3Mode(opts) === 'sham' ? renderShamBlock(pairs) : renderContradictionBlock(pairs));
    }
  }
  return blocks.join('\n');
}

/**
 * 3.0 消融开关：opts.contradictions 显式布尔优先；否则读 env P1B_EVIDENCE_V3。
 * 缺省开启（3.0）；env ∈ V3_OFF_VALUES → 关闭（逐字节退回 2.0 形状）。
 * @returns {boolean}
 */
function isContradictionEnabled(opts) {
  if (opts && typeof opts.contradictions === 'boolean') return opts.contradictions;
  const v = process.env[EVIDENCE_V3_ENV];
  if (v === undefined || v === null) return true;
  return V3_OFF_VALUES.indexOf(String(v).trim().toLowerCase()) === -1;
}

/**
 * game_type → 检测器版型（未知/非狼人域 → null；null 即不追加 d 段 = 2.0 形状）。
 * 与 werewolf-contradictions.resolveFormat 的子串口径一致（botc/blood→botc，wolf→werewolf）。
 * @returns {string|null}
 */
function resolveContradictionFormat(gameType) {
  const s = String(gameType === undefined || gameType === null ? '' : gameType).toLowerCase();
  if (s.indexOf('botc') >= 0 || s.indexOf('blood') >= 0) return 'botc';
  if (s.indexOf('wolf') >= 0 || s.indexOf('\u72fc\u4eba') >= 0) return 'werewolf';
  return null;
}

/**
 * d 段渲染（3.0）：矛盾对数 / 涉及席位 / 类型分布 + 明细（前 CONTRADICTION_DETAIL_MAX 对）。
 * 涉及席位口径=矛盾对描述中出现的座位号（正则 座位N / N 号）去重升序——纯文本确定性，零额外查库。
 * @returns {string[]} 行数组（空 pairs → 只出块头+零值行，仍如实呈现「矛盾对数：0」）
 */
function renderContradictionBlock(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  const hist = DET.summarize(list);
  const seatSet = new Set();
  for (const p of list) {
    const re = /\u5ea7\u4f4d(\d+)|(\d+)\s*\u53f7/g;
    let m;
    while ((m = re.exec(p.desc)) !== null) seatSet.add(Number(m[1] !== undefined ? m[1] : m[2]));
  }
  const seats = Array.from(seatSet).sort(function (a, b) { return a - b; });
  const dist = DET.RULES.filter(function (r) { return hist[r]; })
    .map(function (r) { return r + '\u00d7' + hist[r]; }).join('\u3001');
  const lines = [CONTRADICTION_HEAD];
  lines.push('\u77db\u76fe\u5bf9\u6570\uff1a' + hist.total + '\uff1b\u6d89\u53ca\u5e2d\u4f4d\uff1a'
    + (seats.length ? seats.join('\u3001') : '\u65e0') + '\uff1b\u7c7b\u578b\u5206\u5e03\uff1a' + (dist || '\u65e0'));
  const detail = list.slice(0, CONTRADICTION_DETAIL_MAX);
  for (const p of detail) lines.push('[' + p.rule + '] ' + truncateText(p.desc, 120));
  if (list.length > detail.length) {
    lines.push('\uff08\u660e\u7ec6\u4ec5\u793a\u524d ' + detail.length + ' \u5bf9\uff0c\u5171 ' + list.length + ' \u5bf9\uff09');
  }
  return lines;
}

/**
 * 3.0 臂模式解析（PREREG-命题A-3.0消融 §2 三臂）：opts.contradictionsMode 优先；否则 env P1B_EVIDENCE_V3_MODE。
 * 缺省/非法 → 'off'（＝现有行为：是否追加真实 d 段仍由 P1B_EVIDENCE_V3 决定）；'on'＝真实 d 段；'sham'＝等 token 占位（C 臂）。
 * @returns {'on'|'off'|'sham'}
 */
function resolveV3Mode(opts) {
  const raw = (opts && typeof opts.contradictionsMode === 'string') ? opts.contradictionsMode : process.env[EVIDENCE_V3_MODE_ENV];
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  return V3_MODES.indexOf(v) === -1 ? 'off' : v;
}

/**
 * sham d 段（C 臂「等 token 空特征对照」）：**行数与总字符长度与真实 d 段对齐**（实现为等长；验收阈值 ±5%），
 * 内容为中性占位（无数字/无规则名/无明细/无席位），**不含任何真实矛盾信息**。仅用于消融 C 臂。
 * @param {Array<{rule:string,desc:string}>} pairs 与 on 臂同一入参（用于对齐长度；内容不进入输出）
 * @returns {string[]} 行数组（行数＝真实 d 段行数）
 */
function renderShamBlock(pairs) {
  const real = renderContradictionBlock(pairs);
  const n = real.length;
  const target = real.join('\n').length;
  const lines = [SHAM_HEAD];
  let remaining = target - SHAM_HEAD.length - (n - 1);
  for (let i = 1; i < n; i++) {
    const need = Math.max(1, Math.floor(remaining / (n - i)));
    lines.push(SHAM_FILLER.repeat(Math.ceil(need / SHAM_FILLER.length) + 1).slice(0, need));
    remaining -= need;
  }
  return lines;
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
    // 命题 A 消融窗口覆盖（additive）：body.evidenceIds 由编排器按 prereg-a-windows 计算后传入；缺省＝现状。
    const windowIds = (req.body && Array.isArray(req.body.evidenceIds)) ? req.body.evidenceIds : undefined;
    const evidenceBlock = loadEvidence(pred, { evidenceIds: windowIds });
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
  // 证据块 3.0（命题 A 接线）：d 段常量 + 消融开关解析（测试/消融复用）
  EVIDENCE_VERSION, EVIDENCE_VERSION_2_0, EVIDENCE_V3_ENV,
  CONTRADICTION_HEAD, isContradictionEnabled, resolveContradictionFormat, renderContradictionBlock,
  // PREREG-命题A-3.0消融：C 臂（sham 等 token 空特征对照）
  EVIDENCE_V3_MODE_ENV, V3_MODES, SHAM_HEAD, resolveV3Mode, renderShamBlock,
};
