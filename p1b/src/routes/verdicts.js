'use strict';
/**
 * p1b/src/routes/verdicts.js —— 多路判词路由（第十棒 W2）：
 *   POST /api/games/:id/predictions/:pid/verdicts → 3 路生成+全量逐行落库（不只存聚合值）。
 *
 * 3 路 = 同 provider（tokenrhythm）× 3 prompt 变体 × 温度多样性（0.2/0.7/1.0）：
 *   v1_evidence  T=0.2  证据聚合视角（合法角色：信息聚合）
 *   v2_skeptical T=0.7  怀疑派视角（发散候选，G-合并 R-b：高温=发散原料而非信号源）
 *   v3_baserate  T=1.0  基率视角（合法角色：基率检索）
 * provider 维度留空待第二把 key 扩展 3×N（表结构已兼容）。
 *
 * 铁律落点（契约设计，写死）：
 *   ①LLM 只产出文本（多路推理=合法四角色之一）；②**implied_prob 只从结构化判词块的 p 字段读**
 *   ——形状与机械校验在 `src/evidence/verdictSchema.js`（role/direction/confidence/p/reason/
 *   abstain 六项，p 必须是 [0,1] 的**数值**）；③**缺结构化字段即拒（no_fallback）** ⇒
 *   implied_prob=NULL 如实落库（verdict_text 全量保留，消融时剔除该行），绝不编数；
 *   ④单路失败不落库不编造，errors 数组如实标注。
 *
 * ★2026-09-29 取数闸：把「禁止模型给数字」换成「约束它按结构给数字」
 *   旧解法是「禁数字 ⇒ 逼它写散文 ⇒ 路由再猜它想说什么」。项目两次负结果（模型自由给数 →
 *   稳定地给错同一个数）是**真的**，那次该禁的是"无约束直出"，不该顺带把"给数"也禁了——
 *   于是数字没少，只是从"模型直出"挪到了"正则从散文里猜"。
 *   而猜这一步读得懂「P=0.42」，读不懂「P=0.42 附近」，更分不清「模型声明的置信度」与
 *   「散文里碰巧出现的那个 0.42」——这两样在正则眼里完全一样。
 *   修法＝提示词要求结构化块 → 机械校验类型/枚举/范围 → 越界即拒、缺失即拒，且**不回退**。
 *
 * ★兼容开关 `P1B_VERDICT_LEGACY_TEXT_FALLBACK`（**默认关**，取值 1/on/true/yes/legacy 才开）：
 *   它只为让库里已有的、只有 verdict_text 的旧行仍能取到数（旧数据可读）。
 *   ★新数据不许走老路；且开关**只对"压根没有结构化块"的响应生效**——有块但校验不过的，
 *   任何形态都拒。否则"校验不过"就有了逃生门：模型给 p=1.5，路由从散文里捡一个 0.42 顶上，
 *   那一路的越界就再也拦不住了。
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
 *   输出契约（2026-09-29 扩）：新增**结构化判词块**（`verdict-json` 围栏）——本路由取数的唯一真源；
 *   末行 P=0.xx 仍要求模型给出，但它**只为仍在役的旧消费方保留**（`scripts/decouple9-run.cjs`
 *   直接调 extractImpliedProb，本批禁改面之外），本路由不再读它，提示词要求两者相等；
 *   其上一行是「Range: A%-B%」区间行（区间端点=第二信号源，J2 Lu/J6；宽度入库供批次 1 消融）。
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
 *
 * ★2026-09-29 结算时序闸（本文件只做两件事，判定一律在 store 里）：
 *   1) 写前查一次 `vstore.leakStateOf(pid)`：判词晚于父题结算 → **409**（不是 200 空体）。
 *      文案照 `routes/predictions.js:507` 那条 not_due 的形状：说清为什么拒、什么时候能写。
 *      ★查在 LLM 调用**之前**：已经封口的题再花三路 token 出一份事后读数，钱和时间都是白花。
 *      ⚠ 本路由**不持豁免口**（`saveVerdict` 的 `allowPostSettlement`）——透传即等于把闸拆掉。
 *      读数实验批次要留的，只能由内部脚本显式传该口，落库自报 legacy 态并计入排除数披露。
 *   2) 响应里带 `leak` 排除数披露（照 l6_structural 的 excluded++ 纪律）——本题有多少行
 *      判词进不了 clean 读侧，必须与读数同屏，否则"少了"这件事只有看库的人才知道。
 */
const { db, llm } = require('../deps');
const predictions = require('../db/predictionsStore');
const vstore = require('../db/verdictsStore');
const vviews = require('../db/verdictsViews');
const { chatText } = require('../lib/llmChat');
const { resolveLlmOptions } = require('../llmOptions');
const { getGameOr404 } = require('./games');
const { httpError, requireInt } = require('../util');
// 3.0 d 段：机械矛盾检测器 W1-W6（真值盲/零 LLM/零网络；avalon.js 已同源只读引用）
const DET = require('../detectors/werewolf-contradictions');
// 结构化判词块的形状与机械校验（单一真源；本文件只管"怎么取"，不管"长什么样"）
const vschema = require('../evidence/verdictSchema');

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

const OUTPUT_FORMAT_RULE = '输出要求：正文分析不超过150字；'
  + vschema.describeContract() + '\n'
  + '在最后一行之前给一行「Range: A%-B%」格式（本路倾向的置信区间端点，整数百分比，例如 Range: 40%-60%）；'
  + '最后一行必须严格是「P=0.xx」格式（0到1之间的小数，例如 P=0.65），且必须与结构化块里的 p 相同。';

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
  lines.push('请按你的视角输出分析，给出结构化判词块，并在最后一行给出与该块 p 相同的 P=0.xx。');
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
 * @param {object} prediction 题行（账本行；需 id/game_id/evidence）
 * @param {{contradictions?: boolean}} [opts] 消融参数（缺省读 env P1B_EVIDENCE_V3）
 * @returns {string} 多行证据块（零网络，纯查库）
 */
function loadEvidence(prediction, opts) {
  // 【2026-09-13 修预存在 bug】1053 条 corpus 型 evidence 为结构化对象数组（非事件 id）。
  // 旧实现把元素直接当 SQL 参数绑定（下方 events 循环与 claims 的 IN 展开）→ RangeError，
  // 生产 POST /predictions/:pid/verdicts 打到 corpus 型题即 500。此处只保留可作事件 id 的标量；
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
 * implied_prob 机械抽取（**旧路**，契约：末行 P=0.xx）。
 * 只认 [0,1] 小数（P=1 / P=0 合法；P=1.5 / P=65% 不认）；从后往前找首个含 P= 之行。
 *
 * ★2026-09-29 起本函数**不再是取数真源**，只在两处活着：
 *   ① 兼容开关 `P1B_VERDICT_LEGACY_TEXT_FALLBACK` 打开、且响应压根没有结构化块时（让旧行可读）；
 *   ② `scripts/decouple9-run.cjs` 等仍直接调它的旧消费方（本批禁改面之外）。
 *   新写入一律走 `readImpliedProb`。**不许**把它接回默认路径——那正是这次要拆掉的土办法。
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

// ── 兼容开关（默认关）──────────────────────────────────────────────────────
// 名字按"它打开的是什么能力"来：它打开的是**回退到文本抽取**这件事，所以默认就是关的。
// 反过来写成 `P1B_VERDICT_NO_FALLBACK=1` 会让"关掉闸"看起来像"打开功能"，容易被人顺手删掉。
const LEGACY_TEXT_FALLBACK_ENV = 'P1B_VERDICT_LEGACY_TEXT_FALLBACK';
const LEGACY_TEXT_FALLBACK_ON_VALUES = ['1', 'on', 'true', 'yes', 'legacy'];

/**
 * 兼容开关读值。**默认关**（env 未设 ⇒ false）；非法取值同样按"关"处理——
 * 闸的默认值必须落在收紧的那一侧：拼错一个 env 名就等于悄悄把闸拆了。
 * opts.legacyTextFallback 显式布尔优先（消融脚本要能单次覆盖，不必改进程环境）。
 * @param {{legacyTextFallback?:boolean}} [opts]
 * @returns {boolean}
 */
function legacyTextFallbackEnabled(opts) {
  if (opts && typeof opts.legacyTextFallback === 'boolean') return opts.legacyTextFallback;
  const v = process.env[LEGACY_TEXT_FALLBACK_ENV];
  if (v === undefined || v === null) return false;
  return LEGACY_TEXT_FALLBACK_ON_VALUES.indexOf(String(v).trim().toLowerCase()) !== -1;
}

/**
 * ★取数闸（2026-09-29）：**结构化优先，缺结构化字段即拒**（no_fallback）。
 *
 * 三条分支，每条都给得出「这个数是怎么来的」（source）——因为库里 p=NULL 有两种天差地别的成因：
 * 模型说"我答不了"（合法拒答）和模型没按格式输出（坏数据），合成一种就再也分不开了。
 *   structured                     结构化块合格 ⇒ 直接读 p（不经任何文本解析）
 *   structured_refusal             块合格但 abstain=true ⇒ 合法拒答，p 必为 NULL
 *   no_fallback_structured_missing 压根没有块 ⇒ **拒，不回退**（默认形态）
 *   no_fallback_structured_invalid 有块但不合格 ⇒ **拒，任何形态都拒**（开关救不了）
 *   legacy_text / legacy_text_no_match 开关开启且无块时走老路（自报家门，让新旧数据在库里可区分）
 *
 * ★为什么"有块但不合格"不设逃生门：否则模型给 p=1.5 时，路由能从散文里捡一个 0.42 顶上，
 *   那一路的越界就永远拦不住——闸会变成"校验失败时按老规矩办"，而老规矩正是错的那个。
 *
 * @param {string} text LLM 响应文本
 * @param {{legacyTextFallback?:boolean}} [opts]
 * @returns {{prob:number|null, source:string, ok:boolean, why:string, structured:object}}
 */
function readImpliedProb(text, opts) {
  const found = vschema.parseStructured(text);
  if (found.found) {
    const v = vschema.validateStructured(found.payload);
    if (v.ok) {
      const base = { structured: { found: true, value: v.value, errors: [] } };
      if (v.value.abstain) {
        return Object.assign(base, {
          prob: null, source: 'structured_refusal', ok: true,
          why: '这一路按结构化契约显式拒答（abstain=true）⇒ 不给数是它自己的判断，如实留空'
            + '（★不许拿散文里的 P= 顶上：拒答就是拒答）',
        });
      }
      return Object.assign(base, {
        prob: v.value.p, source: 'structured', ok: true,
        why: 'implied_prob 直接读自结构化块的 p 字段（类型与范围经机械校验），不经文本抽取',
      });
    }
    const detail = found.parseError
      ? 'JSON 解析失败：' + found.parseError
      : v.errors.join('；');
    return {
      prob: null, source: 'no_fallback_structured_invalid', ok: false,
      structured: { found: true, value: null, errors: v.errors.concat(found.parseError ? [found.parseError] : []) },
      why: '结构化块在、但不合格（' + detail + '）⇒ 拒，不编数。'
        + '★此分支不受兼容开关影响：一条走了形状校验的响应没有退路，否则越界就等于没查',
    };
  }
  if (legacyTextFallbackEnabled(opts)) {
    const legacy = extractImpliedProb(text);
    return {
      prob: legacy,
      source: legacy === null ? 'legacy_text_no_match' : 'legacy_text',
      ok: legacy !== null,
      structured: { found: false, value: null, errors: [] },
      why: legacy === null
        ? '响应里没有结构化判词块；兼容开关已开，但老路也没抽到数 ⇒ 如实留空，不编数'
        : '响应里没有结构化判词块；兼容开关已开（' + LEGACY_TEXT_FALLBACK_ENV + '）⇒ 走了旧的「末行 P=0.xx」抽取。'
          + '新数据不该走到这里（走了说明模型没按结构化契约输出）',
    };
  }
  return {
    prob: null, source: 'no_fallback_structured_missing', ok: false,
    structured: { found: false, value: null, errors: [] },
    why: '响应里没有结构化判词块 ⇒ 拒（no_fallback）。'
      + '★不回退到「末行 P=0.xx」文本抽取：正则分不清"模型声明的数"和"散文里碰巧出现的数"',
  };
}

/** MOCK 判词的固定档（确定性模板，零网络）。
 *  三路各给一个**说得通的组合**，而不是随手配三个字段：p 决定方向与档位，否则夹具自己
 *  就会造出"p=0.25 却报 confidence=high"这种自相矛盾的行，把读侧教成"这两个字段可以随便填"。
 *  p 的三个值（0.25/0.50/0.75）是既有测试钉死的契约，一个不许动。 */
const MOCK_VERDICTS = {
  v1_evidence: { pText: '0.25', role: 'evidence_aggregation', direction: 'against', confidence: 'mid' },
  v2_skeptical: { pText: '0.50', role: 'skeptical', direction: 'mixed', confidence: 'low' },
  v3_baserate: { pText: '0.75', role: 'base_rate', direction: 'for', confidence: 'mid' },
};

/** MOCK 判词（确定性模板，零网络；三路可区分且带结构化块供取数闸烟测）。
 *  批次1-M1 同步：v1 附证据块行（真实查库所得，与 live 同源）；v3 附基率背景行；
 *  三路在结构化块之外保留「Range: A%-B%」区间行（P±0.10，端点=第二信号源）与末行 P=0.xx
 *  （老契约，供 scripts/decouple9-run.cjs 那一类仍直接调 extractImpliedProb 的消费方）。
 *  ★MOCK 走结构化块而不是靠末行 P=：否则"管线烟测"测的还是那条已经拆掉的土办法。 */
function buildMockVerdict(variant, temperature, statement, extras) {
  const o = extras || {};
  const spec = MOCK_VERDICTS[variant] || MOCK_VERDICTS.v2_skeptical;
  const brief = String(statement || '').slice(0, 40);
  const lines = [
    '[MOCK ' + variant + ' T=' + temperature + '] 判词（零网络模板）：就「' + brief
      + '」按本路视角给出复盘参考倾向（思路非答案，仅供消融管线烟测）。',
  ];
  if (variant === 'v1_evidence' && o.evidenceBlock) lines.push(o.evidenceBlock);
  const baseLine = formatBaselineLine(o.baseline);
  if (variant === 'v3_baserate' && baseLine) lines.push(baseLine);
  const p = parseFloat(spec.pText);
  const lo = Math.max(0, Math.round((p - 0.10) * 100));
  const hi = Math.min(100, Math.round((p + 0.10) * 100));
  lines.push(vschema.buildBlock({
    role: spec.role, direction: spec.direction, confidence: spec.confidence,
    p: p, reason: 'MOCK 夹具：零网络模板，不代表任何真实判断。', abstain: false,
  }));
  lines.push('Range: ' + lo + '%-' + hi + '%'); // 区间行恒在 P= 之上；不含 P= 不干扰老路
  lines.push('P=' + spec.pText);                // 老契约行仍在（禁改面之外的旧消费方），本路由不再读它
  return lines.join('\n');
}

function register(app, ctx) {
  vstore.ensureVerdictsTable(db.getConnection()); // additive 私有表（register 内 ensure，oracleCast 先例）
  vviews.ensureVerdictsCleanView(db.getConnection()); // 读侧收口视图（additive；须在补列之后——见 verdictsViews 头注）
  // ── 结果缓存**生产接线**（2026-09-17 第十九批 additive；蓝图 §2.1#7 尾巴）──────────────────
  // 默认**关闭**：env `P1B_RESULT_CACHE_DIR` 未设 ⇒ 零行为变化（不读不写缓存）。
  // 键＝`keyOfMessages()`（**严格键**：实际 messages 逐字入哈希 ＋ 温度 ＋ 模型）——**不用**冻结的
  //   `cacheKey()`，因为它在「证据窗覆盖」路径上会撞键（见 resultCache.js 头注）。
  // ★禁用场景：**重复采样类实验**（同配置重跑必须重新采样；开缓存会把噪声底变成构造性的 0）。
  const cacheDir = String(process.env.P1B_RESULT_CACHE_DIR || '').trim();
  const cacheStore = cacheDir ? require('../lib/resultCache').createStore(cacheDir) : null;
  const keyOfMessages = require('../lib/resultCache').keyOfMessages;

  app.post('/api/games/:id/predictions/:pid/verdicts', async (req) => {
    const gameId = requireInt('game id', req.params.id, 1);
    const game = getGameOr404(gameId);
    const pid = requireInt('prediction id', req.params.pid, 1);
    const pred = predictions.getPrediction(pid);
    if (!pred || pred.game_id !== gameId) {
      throw httpError(404, '记录不存在或不属于该局: ' + pid);
    }
    // ── 结算时序闸（2026-09-29）：查在 LLM 之前。判据不写在这里（store 是唯一真源）。
    //   409 而非 200+空体——本项目吃过一次亏（routes/predictions.js:504-508 记着：not_due
    //   一路落到 return，账本虽没被写、HTTP 却回 200，状态码会骗人）。
    const gate = vstore.leakStateOf(pid);
    if (gate.state === 'post_settlement') {
      throw httpError(409, '这道题已结算（结算于 ' + gate.resolved_at + '），判词要到 ' + gate.now
        + ' 才生成——那是拿着答案回头看，不是对这道题的信息读数。'
        + '判词这一层只有在父题结算之前生成时才是信号，所以现在不能写。'
        + '已结算之后仍要留读数（读数实验口径）的，走内部豁免口落库并自报为读数行、计入排除数披露；'
        + '本接口不开放该入口。');
    }
    // 批次2-M1（R-A 后解冻件）：runId/model 可选透传（additive，缺省 NULL）——
    // 跑批批次指纹（PREREG hash 前 12 位）与模型口径入 verdicts 表，供消融按重跑批次分组。
    const bodyRun = req.body || {};
    const runId = (typeof bodyRun.runId === 'string' && bodyRun.runId.trim()) ? bodyRun.runId.trim() : null;
    const model = (typeof bodyRun.model === 'string' && bodyRun.model.trim()) ? bodyRun.model.trim() : null;
  const options = resolveLlmOptions({ store: ctx.store, llmMock: ctx.llmMock, fetchImpl: ctx.fetchImpl });
  const mode = llm.resolveMode(options); // mockMode/无 key → MOCK（零网络，与 extract/advise/oracle 同链）
  // 事实层（2026-09-14 additive）：本批次实际生效的模型（现算，实时代理 providers.json）。
  // 与 body.model（声明标签）分离——见 verdictsStore VERSION_COLUMNS 注释。MOCK 时 null（无真实模型）。
  const resolvedModel = (() => {
    try {
      const { describeEffective } = require('../llmOptions');
      return describeEffective({ store: ctx.store, llmMock: ctx.llmMock, options }).model;
    } catch (e) { return null; }
  })();
    // per-path 注入件（批次1-M1）：与 variant 无关，循环外各算一次（纯查库零网络）
    // 命题 A 消融窗口覆盖（additive）：body.evidenceIds 由编排器按 prereg-a-windows 计算后传入；缺省＝现状。
    const windowIds = (req.body && Array.isArray(req.body.evidenceIds)) ? req.body.evidenceIds : undefined;
    // 命题 A 重试通道（additive）：body.onlyVariants 限定本 POST 只跑指定变体（跑批第二遍外科单变体重试用）；缺省＝现状（三路全跑）。
    const onlyVariants = (req.body && Array.isArray(req.body.onlyVariants)) ? req.body.onlyVariants.filter((v) => typeof v === 'string') : null;
    const evidenceBlock = loadEvidence(pred, { evidenceIds: windowIds });
    const baseline = loadBaseline(pred);
    const saved = [];
    const errors = [];
    for (const route of ROUTES) {
      if (onlyVariants && onlyVariants.indexOf(route.variant) === -1) continue; // additive：单变体重试过滤（缺省不过滤）
      try {
        let text;
        let cacheHit = false;                                  // 结果缓存命中标记（默认 false；env 未设时恒 false）
        if (mode === 'MOCK') {
          text = buildMockVerdict(route.variant, route.temperature, pred.statement, { evidenceBlock: evidenceBlock, baseline: baseline });
        } else {
          const extras = {};
          if (route.variant === 'v1_evidence') extras.evidenceBlock = evidenceBlock;
          if (route.variant === 'v3_baserate') extras.baseline = baseline;
          const messages = [
            { role: 'system', content: buildSystemPrompt(route.variant) },
            { role: 'user', content: buildUserPrompt(pred, game, extras) },
          ];
          const ck = cacheStore ? keyOfMessages({ messages: messages, temperature: route.temperature, model: options.model || '' }) : null;
          const hit = (cacheStore && ck) ? cacheStore.get(ck) : null;
          if (hit && typeof hit.verdict_text === 'string' && hit.verdict_text) {
            text = hit.verdict_text;                           // 命中：不调 LLM（成本省；同提示词同参数 ⇒ 结果可复用）
            cacheHit = true;
          } else {
            text = await chatText(messages, Object.assign({}, options, { temperature: route.temperature }));
            if (cacheStore && ck) cacheStore.put(ck, { verdict_text: text, model: options.model || null, at: new Date().toISOString() });
          }
        }
        // ★取数走结构化闸：缺结构化字段即拒（no_fallback），不回退文本抽取（见文件头注）。
        const read = readImpliedProb(text);
        const prob = read.prob;
        const row = vstore.saveVerdict({
          predictionId: pid,
          promptVariant: route.variant,
          temperature: route.temperature,
          verdictText: text,
          impliedProb: prob,
          runId: runId,
          model: model,
          resolvedModel: resolvedModel,
        });
        // 兜底闸：进循环前已查过一次 leakStateOf；这里再查一次是因为两次之间可能刚好结算了。
        //   拒写不是"单路失败"——它不是某一路挂了，是整批的前提不成立，所以照 not_due 抛 409，
        //   不塞进 errors 里当 200 返回（那正是本项目吃过一次亏的坑）。
        if (row && row.ok === false) {
          throw httpError(409, '判词未落库：' + row.why
            + '（写入发生在检查之后，期间本题完成结算）');
        }
        saved.push({
          id: row.id,
          prompt_variant: row.prompt_variant,
          temperature: row.temperature,
          implied_prob: row.implied_prob,
          extracted: prob !== null,
          prob_source: read.source,   // ★这个数是怎么来的（读侧据此分"合法拒答/坏数据/走了老路"）
          prob_why: read.why,
          created_at: row.created_at,
          run_id: row.run_id,
          model: row.model,
          resolved_model: row.resolved_model,
          leak_state: row.leak_state,                          // clean＝进得了 clean 读侧；其余态一律进不了
          cache_hit: cacheHit,                                 // 结果缓存命中（env 未设时恒 false）
        });
      } catch (e) {
        // 单路失败不落库不编造（消融数据干净优先）；如实标注。
        // ★但 httpError 不进 errors：它不是"某一路挂了"，是整批的前提不成立——
        //   塞进 errors 再回 200，等于把拒写说成"三路里有一路没成"（同 409 分支的坑）。
        if (e && e.statusCode) throw e;
        errors.push({ prompt_variant: route.variant, temperature: route.temperature, error: String((e && e.message) ? e.message : e) });
      }
    }
    // 读侧收口披露（照 l6_structural 的 excluded++ 纪律）：本题有多少行判词进不了 clean 读侧，
    // 与读数同屏。"从视图里消失"本身是要告知的事实——静默过滤会把"一半的行不能用"说成"就这些行"。
    const leak = vviews.leakDisclosure(pid);
    return {
      prediction_id: pid,
      mode: mode === 'MOCK' ? 'mock' : 'live',
      saved: saved,
      errors: errors,
      leak: leak,
      note: 'implied_prob 只从结构化判词块的 p 字段读（类型与范围经机械校验，越界即拒、不编数）；'
        + '响应里没有结构化块就如实落 NULL——★不回退到「末行 P=0.xx」文本抽取。'
        + '每行的 prob_source 说明那个数是怎么来的。'
        + '本次写入的行 leak_state=clean（父题结算之前生成，可进 clean 读侧）'
        + (leak.note ? '；' + leak.note : ''),
      l0_gate: predictions.l0Gate(),
    };
  });
}

module.exports = {
  register, ROUTES, extractImpliedProb, buildMockVerdict, buildSystemPrompt, buildUserPrompt,
  loadEvidence, loadBaseline, formatBaselineLine, // 批次1-M1 per-path 注入件（测试与消融复用）
  // 2026-09-29 取数闸：路由读数走 readImpliedProb（结构化优先、缺字段即拒）；extractImpliedProb
  //   降级为旧路，只在兼容开关打开且响应无结构化块时、以及旧消费方手里活着。
  readImpliedProb, legacyTextFallbackEnabled, LEGACY_TEXT_FALLBACK_ENV, LEGACY_TEXT_FALLBACK_ON_VALUES,
  MOCK_VERDICTS,
  EVIDENCE_HEAD, NO_EVIDENCE_LINE, // 注入口径常量（测试断言复用，防文案漂移）
  // 证据块 3.0（命题 A 接线）：d 段常量 + 消融开关解析（测试/消融复用）
  EVIDENCE_VERSION, EVIDENCE_VERSION_2_0, EVIDENCE_V3_ENV,
  CONTRADICTION_HEAD, isContradictionEnabled, resolveContradictionFormat, renderContradictionBlock,
  // PREREG-命题A-3.0消融：C 臂（sham 等 token 空特征对照）
  EVIDENCE_V3_MODE_ENV, V3_MODES, SHAM_HEAD, resolveV3Mode, renderShamBlock,
};
