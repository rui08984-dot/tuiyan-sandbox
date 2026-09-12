/**
 * P1b 前端契约类型 —— 对应 P1B-SPEC.md §3 API 契约。
 * 数据形状对齐 p1a-terminal/src/db.js（契约 v1）与 src/cards.js（参谋卡 §3）。
 */

// ── 对局 ──

/** 游戏类型 id —— 后端驱动（GET /api/adapters）：新增游戏零改前端，本地只透传字符串 */
export type GameType = string;
/** GET /api/adapters 单条（后端登记表）：id/name/kind/ready 必填，余为适配器可选元信息 */
export interface AdapterInfo {
  id: string;
  name: string;
  kind: string;
  ready: boolean;
  source?: string;
  layer?: string | null;
  checklist?: string | null;
  contract?: string;
  missing?: string[];
}
export type GameStatus = 'active' | 'finished';
/** BOTC 官方三剧本（BRIEFS 拍板三本一起）：暗流涌动/黯月初升/梦殒春宵 */
export type BotcScript = 'tb' | 'bmr' | 'snv';

export interface Game {
  id: number;
  name: string;
  type: GameType;
  player_count: number;
  status: GameStatus;
  created_at: string;
  current_day?: number;
  /** GET /api/games 列表实算字段（详情路由可缺省）；current_day 语义 = max_day||0 */
  event_count?: number;
  max_day?: number;
  /** B2 后端：botc 局挂的剧本（tb|bmr|snv；非 botc 局/未挂剧本为 null） */
  script?: BotcScript | null;
}

export interface Player {
  id?: number;
  seat: number; // 1 基座位号（契约：全程座位号，不见 players.id）
  name: string;
  alive?: boolean | null;
}

// ── 事件账本（db.js 契约 v1）──

export type EventPhase = 'night' | 'day' | 'dusk';

export interface GameEvent {
  id: number;
  day: number;
  phase: EventPhase;
  seq: number;
  type: string;
  actor_seat: number | null;
  raw_text: string;
}

export type Predicate =
  | 'is_wolf' | 'is_good' | 'is_role' | 'claims_role'
  | 'voted' | 'did_action' | 'said';

/** BOTC 专属谓词（B2 后端：落 p1b 私有表 botc_claims；仅 botc 局可录） */
export type BotcPredicate = 'is_demon' | 'is_minion' | 'status_drunk' | 'status_poisoned';
/** 确认卡/编辑表单可选谓词全集 = 通用 7 枚举 + BOTC 专属 4（werewolf 局仍只用通用 7） */
export type AnyPredicate = Predicate | BotcPredicate;

export interface Claim {
  id: number;
  event_id: number;
  day: number;
  phase: EventPhase;
  seat: number;
  subject_seat: number | null;
  predicate: Predicate;
  object: string | null;
  extracted_by?: string | null;
  confirmed_by_user?: number;
}

export interface GameAction {
  id: number;
  event_id: number;
  day: number;
  phase: EventPhase;
  seat: number;
  action: string;
  target_seat: number | null;
  result: string | null;
}

/** GET /api/games/:id/state?uptoDay=N（loadGameState 形状） */
export interface GameState {
  game: Game;
  players: Player[];
  events: GameEvent[];
  claims: Claim[];
  actions: GameAction[];
}

// ── 待确认卡（抽取 → 用户确认 → 入账；与终端确认流同规则）──

export interface PendingEvent {
  day: number;
  phase: EventPhase;
  type: string;
  actor_seat: number | null;
  raw_text: string;
}

export interface PendingClaim {
  seat: number;
  subject_seat?: number | null;
  /** B4：botc 局可为 BOTC 专属谓词（is_demon/is_minion/status_drunk/status_poisoned） */
  predicate: AnyPredicate;
  object?: string | null;
}

export interface PendingAction {
  seat: number;
  action: string;
  target_seat?: number | null;
  result?: string | null;
}

/** POST /api/games/:id/events/extract 的返回（宏路由 /events/macro 同构） */
export interface PendingCard {
  event: PendingEvent;
  claims: PendingClaim[];
  actions: PendingAction[];
  warnings?: string[];
  /** 后端回传：'llm' | 'macro'；前端本地构造宏卡时置 'macro' */
  extracted_by?: string;
  meta?: { source?: string; kind?: string; mode?: string; attempts?: number };
}

/** POST /api/games/:id/events/confirm 的 body（确认后的 event+claims+actions；宏与自由文本同一入库路径） */
export interface ConfirmPayload {
  event: PendingEvent;
  claims: PendingClaim[];
  actions: PendingAction[];
  /** 后端校验 'macro'|'user'|'llm'，缺省 'llm' */
  extracted_by?: string;
}

// ── 参谋卡（cards.js 契约 §3；思路非答案）──

export type Underdetermination = 'high' | 'mid' | 'low';
export type Tendency = 'strong' | 'mid' | 'weak';

export interface Contradiction {
  pair_id?: number | null;
  claim_a?: number | null;
  claim_b?: number | null;
  action_a?: number | null;
  action_b?: number | null;
  underdetermination: Underdetermination;
  innocent_explanations: string[];
}

export interface Hypothesis {
  content: string;
  /** per-player 立场：座位号 → 立场标记（如 {"1":"wolf_suspect"}） */
  stance: Record<string, string>;
  support_events: number[];
  oppose_events: number[];
  tendency: Tendency;
}

export interface Checkpoint {
  text: string;
  /** resolves 的 hypothesis 下标（0 基） */
  resolves: number[];
}

export interface AdvisorCard {
  day: number;
  contradictions: Contradiction[];
  hypotheses: Hypothesis[];
  checkpoints: Checkpoint[];
  warnings?: string[];
}

/** GET /api/tasks/:taskId 轮询返回 */
export interface TaskStatus {
  status: 'running' | 'done' | 'failed';
  card?: AdvisorCard | null;
  error?: string | null;
}

// ── 供应商（设置页；api_key 永不出服务端，前端只见掩码指示）──

export interface Provider {
  key: string;
  label: string;
  base_url: string;
  /** 抽取模型（config 里 provider.model） */
  model: string;
  /** 参谋卡模型（config 里 provider.cards.model；缺省回落 model） */
  cards_model: string;
  /** 服务端已配置 api_key（只回布尔/掩码，不回明文） */
  has_api_key: boolean;
  api_key_masked?: string | null;
}

/** PUT /api/providers/:key 的 body；api_key 留空 = 保留服务端现有值 */
export interface ProviderInput {
  label: string;
  base_url: string;
  api_key?: string;
  model: string;
  cards_model?: string;
}

export interface ProviderListResult {
  providers: Provider[];
  active: string | null;
}

/** POST /api/providers/:key/test 返回（连接测试：发一条 ping 看通不通） */
export interface ProviderTestResult {
  ok: boolean;
  latency_ms?: number;
  model?: string;
  message: string;
}

// ── 对局创建（POST /api/games 的 body；spec §2.1）──

export interface CreateGameInput {
  name: string;
  type: GameType;
  player_count: number;
  /** 座位名单（默认「N号」可改真名）；缺省 = 自动生成「N号」 */
  seat_names?: string[];
  /** B2 后端：botc 局挂剧本（tb|bmr|snv，可选）；werewolf 局不带（后端忽略） */
  script?: BotcScript;
}

/** GET /api/games/:id 的 players 行（座位名单编辑用） */
export type PlayerRow = Player;

// ── P1b-4 平迁：座位真名走服务端（PUT /api/games/:id/seats）──

export interface SeatRename { seat: number; name: string }
export interface SeatsSaveResult { ok: boolean; players: Player[] }

// ── P1b-4 平迁：参谋卡服务端存档（GET /api/games/:id/cards[/:day]）──
// 语义 =「截至该天」：evidence_day ≤ day 的矛盾 + 该天假设；验证点不入库。

export interface ServerCard {
  day: number;
  hypotheses: Hypothesis[];
  contradictions: (Contradiction & {
    conflict_desc?: string | null;
    evidence_day?: number | null;
  })[];
}
export interface ServerCardsResult { game_id: number; cards: ServerCard[] }

// ── B4：BOTC 局阵营/状态声称（GET /api/games/:id/botc-claims；p1b 私有表 botc_claims）──
// 角色类声称（claims_role/is_role）走主表 claims（object 已被后端归一化为角色 id），
// 此处仅为 BOTC 专属谓词行；形状对齐 p1b/src/botc/claims.js listBotcClaims。

export interface BotcClaim {
  id: number;
  game_id: number;
  event_id: number;
  day: number;
  phase: EventPhase;
  seat: number;
  subject_seat: number;
  predicate: BotcPredicate;
  /** 可空备注（阵营/状态谓词无对象语义，缺省 ''） */
  object: string;
  extracted_by: string;
  confirmed_by_user: number;
}

// ── P2 W2：对局玄学化判词（GET /api/games/:id/oracle；赛后娱乐彩蛋）──
// 拍板边界：恒挂「娱乐参考」标注，绝不接入任何游戏研判功能——本类型仅服务前端彩蛋弹层，
// 禁止被参谋/研判类组件引用。形状对齐 p1b/src/lib/oracle.js（meihua 起卦）+ routes/oracle.js。

export interface OracleGua {
  name: string;
  fullName: string;
  upper: string;
  lower: string;
  /** P9 W2 增补（可选）：六爻阴阳（自下而上，1=阳 0=阴）与文字数组——后端 casting 实际返回，
   *  判词弹层未用；独立玄学页六爻图用。可选字段，既有引用零影响。 */
  yao?: number[];
  yinYang?: string[];
}

export interface OracleTiYong {
  trigram: string;
  wuXing: string;
  position: string;
}

export interface OracleCasting {
  numbers: { a: number; b: number };
  benGua: OracleGua;
  huGua: OracleGua;
  bianGua: OracleGua;
  dongYao: number;
  ti: OracleTiYong;
  yong: OracleTiYong;
  tiYongRelation: string;
}

export interface OracleResult {
  game_id: number;
  casting: OracleCasting;
  verdict: string;
  disclaimer: string;
  mode: 'mock' | 'live' | 'mock_fallback';
  llm_error?: string;
}

// ── P9 W1：独立玄学排盘（#/mystic；POST /api/oracle/cast + GET /api/oracle/readings）──
// 拍板边界同上：恒挂「娱乐参考」，绝不接入任何游戏研判功能——本类型仅服务独立玄学页，
// 禁止被参谋/研判类页面引用。形状对齐 p1b/src/lib/oracleCast.js + routes/oracleCast.js。

/** derived_from：起卦输入留档（time 法含农历分量；numbers/random 法含来源说明） */
export interface MysticDerivedFrom {
  method?: string;
  source?: string;
  domain?: string;
  lunar_year?: number;
  lunar_month?: number;
  leap_month?: boolean;
  lunar_day?: number;
  year_zhi?: string;
  year_zhi_number?: number;
  hour_zhi?: string;
  hour_zhi_number?: number;
  local_time?: string;
  calendar?: string;
}

/** 排盘 casting = 对局判词 OracleCasting 同构 + derived_from 留档 */
export type MysticCasting = OracleCasting & { derived_from?: MysticDerivedFrom };

/** POST /api/oracle/cast 响应（201） */
export interface OracleCastResult {
  id: number;
  method: 'numbers' | 'time' | 'random';
  inputs: Record<string, unknown>;
  casting: MysticCasting;
  verdict: string | null;
  disclaimer: string;
  created_at: string;
  game_id: number | null;
}

/** POST /api/oracle/interpret 响应（201，G1 反馈#1）：读档复用 P8 断语链，mode 三态同 P8 契约 */
export interface OracleInterpretResult {
  id: number;
  method: 'numbers' | 'time' | 'random';
  inputs: Record<string, unknown>;
  casting: MysticCasting;
  verdict: string;
  disclaimer: string;
  mode: 'mock' | 'live' | 'mock_fallback';
  llm_error?: string;
  created_at: string;
  game_id: number | null;
}

/** GET /api/oracle/readings 单条（与 OracleCastResult 同形，复用同一抽屉视图） */
export interface OracleReading {
  id: number;
  method: 'numbers' | 'time' | 'random';
  inputs: Record<string, unknown>;
  casting: MysticCasting;
  verdict: string | null;
  disclaimer: string;
  created_at: string;
  game_id: number | null;
}

export interface OracleReadingsResult {
  items: OracleReading[];
  total: number;
  limit: number;
  offset: number;
}

// ── P18 M2：万物审计仪表盘（GET /api/audit/summary；纯 SQL 只读聚合，零 LLM 零评分）──
// 形状对齐 p1b/src/routes/audit.js。词汇纪律（P18-M2 铁律）：本节类型与 /audit 页全文禁用
// 任务书所列宣称字样，一律用「审计/校准参考/分层账本」；review_unlocked=false 时一切数字只配「参考」。

/** layer×checklist_hash 分组行（审计列 NULL 原样返回 null=未分层，由 UI 标注） */
export interface AuditLayerGroup {
  layer: string | null;
  checklist_hash: string | null;
  n: number;
  /** 组内 tautology=1 计数（重言式题隔离账，不计入门禁有效口径） */
  tautology_n: number;
}

/** gate 分组行（descriptive/scored/blocked，审计列未补录= null） */
export interface AuditGateGroup {
  gate: string | null;
  n: number;
}

/** l0Gate 双口径（对齐 predictionsStore.l0Gate）：records=总账（含重言）；
 *  records_valid=tautology=0 有效口径；review_unlocked=局数≥30 ∧ 有效≥200（重言灌水不解锁） */
export interface AuditL0Gate {
  gate: string;
  games: number;
  records: number;
  records_valid: number;
  resolved: number;
  unresolved: number;
  review_unlocked: boolean;
}

/** 分层校准聚合行（/audit「分层校准」块）：n/resolved 恒为账本计数；
 *  brier=已回填真值且概率非空题上的机械算术（brier_n=0 → brier=null，样本不足不编造）；
 *  base_rate=settled（true/false）中 true 占比（base_rate_n=0 → base_rate=null）。 */
export interface AuditLayerCalibration {
  layer: string | null;
  n: number;
  resolved: number;
  ambiguous: number;
  settled: number;
  brier: number | null;
  brier_n: number;
  base_rate: number | null;
  base_rate_n: number;
}

/** 待解前瞻题行（未回填真值；event_day=null 表示无日粒度，target 保留目标期文本） */
export interface AuditPendingForward {
  id: number;
  statement: string;
  assigned_prob: number | null;
  layer: string | null;
  gate: string | null;
  event_day: string | null;
  target: string | null;
  created_at: string | null;
}

/** GET /api/audit/summary 响应（只记不评账本透出；校准列为机械算术，样本不足留空） */
export interface AuditSummary {
  l0_gate: AuditL0Gate;
  by_layer_checklist: AuditLayerGroup[];
  by_gate: AuditGateGroup[];
  /** 按 layer 聚合账本 + Brier/基率（机械算术；样本不足 null） */
  layer_calibration: AuditLayerCalibration[];
  /** 未回填真值的前瞻题（事件日升序，最多 50 条） */
  pending_forward: AuditPendingForward[];
  /** 前瞻题总数（截断前，供 UI 标「显示前 50 / 共 M」） */
  pending_forward_total: number;
  total: number;
  generated_at: string;
  note: string;
}
