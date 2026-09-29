/**
 * P1b 前端 API client —— P1B-SPEC.md §3 契约的类型化 fetch 封装。
 *
 * mock 开关：VITE_USE_MOCK=1 时全走 src/mock.ts（内置内存数据，结构与契约一致），
 * 供后端（P1b-1）未就绪期开发；生产构建不带该变量即直连同源 /api。
 */
import type {
  AuditSummary, BotcClaim, Claim, ConfirmPayload, CreateGameInput, EventPhase, Game, GameState, OracleResult, Player, Provider,
  EffectiveProvider, AdapterInfo,
  OracleCastResult, OracleInterpretResult, OracleReadingsResult, PendingCard, ProviderInput, ProviderListResult, ProviderTestResult, TaskStatus,
  ServerCard, ServerCardsResult, SeatRename, SeatsSaveResult,
  IntakeClassifyResult, IntakeRejectsResult, IntakeQuestionsResult,
  AuditG2KpiResult,
} from './types';

// ★错误文案在**抛错那一处**统一成人话，不逐个页面改：
//   所有页面本来就在显示 `e.message`，把文案做在这里 ⇒ 一处改动全部受益。
//   `detail` 另存后端原话，供排错用（用户不必看，开发者要看得到）。
import { describeHttp } from './lib/errorCopy';

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? '') === '1';

/**
 * QC③（p1b2-qc.md）：mock 由静态 import 改为按需异步加载 —— 仅 VITE_USE_MOCK=1 时
 * 才会拉取 mock chunk，生产主包不再打包 mock 假数据（tree-shake 处置）。
 * Proxy 保住全部调用点「mockApi.xxx()」形状零改动：方法被调用时才真正 import。
 */
type MockApi = (typeof import('./mock'))['mockApi'];
let mockPromise: Promise<MockApi> | null = null;
const mockApi = new Proxy({} as MockApi, {
  get(_target, prop: string) {
    return (...args: unknown[]) => {
      if (!mockPromise) mockPromise = import('./mock').then((m) => m.mockApi);
      return mockPromise.then((m) =>
        (m[prop as keyof MockApi] as (...a: unknown[]) => unknown)(...args),
      ) as Promise<unknown>;
    };
  },
});

const BASE = '/api';

/** 后端答了但没答对。`message` 已是人话（可安全直接展示）；`detail` 是后端原话，排错用。 */
export class ApiError extends Error {
  status: number;
  /** 后端自己那条原话。**用户不必看**，但不许丢——丢了下次排错只能靠猜。 */
  detail: string;
  /** 要不要重试：null 是「后端没说」，true/false 是它说的。 */
  doNotRetry: boolean | null;
  constructor(status: number, message: string, detail = '', doNotRetry: boolean | null = null) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.doNotRetry = doNotRetry;
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // 后端未启动 / 网络不可达：转成可读 ApiError，由页面兜底展示，避免白屏
    throw new ApiError(0, '无法连接后端服务（/api）。请确认后端已启动（默认 127.0.0.1:8787）后重试。');
  }
  if (!res.ok) {
    // 后端原话先取出来（如实透传进 hint），人话由 describeHttp 按状态码给
    let detail = '';
    let gate: string | undefined;
    let doNotRetry: boolean | null = null;
    try {
      const data = await res.json();
      if (data && typeof data.error === 'string') detail = data.error;
      else if (data && typeof data.message === 'string') detail = data.message;
      // ★若后端带了结构化裁决（gates / mcp 链路会带），那一层仍然归 exitMap 所有，
      //   本文件只消费、不解释——不许在这里按码自己判定含义。
      const v = data && data.verdict;
      if (v && typeof v.gate === 'string') gate = v.gate;
      if (v && typeof v.do_not_retry === 'boolean') doNotRetry = v.do_not_retry;
    } catch { /* 非 JSON 错误体，如实只给状态码那层文案 */ }
    // ★带了 gate 也不在这里改写文案：那一层的裁决归 exitMap 所有，本处只消费不解释
    const c = describeHttp(res.status, detail);
    void gate;
    throw new ApiError(
      res.status,
      c.title + '｜' + c.next + (c.hint ? '（' + c.hint + '）' : ''),
      detail,
      doNotRetry ?? c.doNotRetry,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── 供应商（设置页）──

export function listProviders(): Promise<ProviderListResult> {
  return USE_MOCK ? mockApi.listProviders() : request('/providers', 'GET');
}

/** PUT 语义 = upsert：key 不存在即新建。api_key 留空 = 保留服务端现有值。 */
export function saveProvider(key: string, input: ProviderInput): Promise<{ provider: Provider }> {
  return USE_MOCK ? mockApi.saveProvider(key, input) : request('/providers/' + encodeURIComponent(key), 'PUT', input);
}

export function activateProvider(key: string): Promise<{ ok: boolean; active: string }> {
  return USE_MOCK ? mockApi.activateProvider(key) : request('/providers/' + encodeURIComponent(key) + '/activate', 'POST');
}

export function testProvider(key: string): Promise<ProviderTestResult> {
  return USE_MOCK ? mockApi.testProvider(key) : request('/providers/' + encodeURIComponent(key) + '/test', 'POST');
}

/**
 * GET /api/providers/effective —— 当前实际生效的 LLM 配置（脱敏，实时）。
 * 2026-09-14：双链统一可观测性出口——设置页用它显示「判词链现在实际用哪个模型」，
 * 使「换模型是否真的生效」可在浏览器里直接验证（无需重启 8787）。
 */
export function getEffectiveProvider(): Promise<EffectiveProvider> {
  return USE_MOCK ? mockApi.getEffectiveProvider() : request('/providers/effective', 'GET');
}

/**
 * 契约扩展（与 P1b-1 对齐点）：P1B-SPEC §2.4 要求供应商可删除，
 * §3 未列 DELETE——按 REST 惯例补 DELETE /api/providers/:key。
 */
export function deleteProvider(key: string): Promise<{ ok: boolean }> {
  return USE_MOCK ? mockApi.deleteProvider(key) : request('/providers/' + encodeURIComponent(key), 'DELETE');
}

// ── 对局 ──

export function listGames(): Promise<{ games: Game[] }> {
  return USE_MOCK ? mockApi.listGames() : request('/games', 'GET');
}

/** 后端 201 返回 {game, players}（players=自动建席 1..N）；mock 只回 {game}，故 players 可选 */
export function createGame(input: CreateGameInput): Promise<{ game: Game; players?: Player[] }> {
  return USE_MOCK ? mockApi.createGame(input) : request('/games', 'POST', input);
}

export function getGame(id: number): Promise<{ game: Game; players: Player[] }> {
  return USE_MOCK ? mockApi.getGame(id) : request('/games/' + id, 'GET');
}

export function getGameState(id: number, uptoDay?: number): Promise<GameState> {
  const q = uptoDay != null ? '?uptoDay=' + uptoDay : '';
  return USE_MOCK ? mockApi.getGameState(id, uptoDay) : request('/games/' + id + '/state' + q, 'GET');
}

/** 导出 JSON（返回原始 JSON blob，由调用方决定下载/展示） */
export function exportGame(id: number): Promise<unknown> {
  return USE_MOCK ? mockApi.exportGame(id) : request('/games/' + id + '/export', 'GET');
}

/** 座位真名落库（P1b-4 平迁：PUT /api/games/:id/seats，仅 UPDATE players.name） */
export function saveSeats(gameId: number, seats: SeatRename[]): Promise<SeatsSaveResult> {
  return USE_MOCK ? mockApi.saveSeats(gameId, seats) : request('/games/' + gameId + '/seats', 'PUT', { seats });
}

/** 参谋卡服务端存档列表（按天倒序；矛盾行带 evidence_day） */
export function listServerCards(gameId: number): Promise<ServerCardsResult> {
  return USE_MOCK ? mockApi.listServerCards(gameId) : request('/games/' + gameId + '/cards', 'GET');
}

// ── B4：BOTC 局阵营/状态声称（后端落 p1b 私有表 botc_claims；角色类声称走主表 claims）──

/** GET /api/games/:id/botc-claims —— BOTC 专属谓词（is_demon/is_minion/status_drunk/status_poisoned）声称列表 */
export function getBotcClaims(gameId: number): Promise<{ game_id: number; claims: BotcClaim[] }> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现 BOTC 接口，请直连后端'));
  return request('/games/' + gameId + '/botc-claims', 'GET');
}

/** POST /api/games/:id/botc-claims/:claimId/retract —— 软删（账本纪律：retracted 不可见） */
export function retractBotcClaim(gameId: number, claimId: number): Promise<{ ok: boolean }> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现 BOTC 接口，请直连后端'));
  return request('/games/' + gameId + '/botc-claims/' + claimId + '/retract', 'POST');
}

/** 单天服务端存档卡（语义=截至该天；404=该天无存档） */
export function getServerCard(gameId: number, day: number): Promise<ServerCard> {
  return USE_MOCK ? mockApi.getServerCard(gameId, day) : request('/games/' + gameId + '/cards/' + day, 'GET');
}

// ── 事件抽取 / 确认入账 ──

/** extract 附加定段参数：day 缺省=当前天、phase 缺省 day、speaker_seat 可选 */
export interface ExtractOptions { day?: number; phase?: EventPhase; speaker_seat?: number | null; }

export function extractEvents(gameId: number, text: string, opts?: ExtractOptions): Promise<PendingCard> {
  if (USE_MOCK) return mockApi.extractEvents(gameId, text);
  return request('/games/' + gameId + '/events/extract', 'POST', { text, ...(opts || {}) });
}

export function confirmEvents(gameId: number, payload: ConfirmPayload): Promise<{ ok: boolean; event_id?: number; seq?: number; claim_ids?: number[]; action_ids?: number[] }> {
  return USE_MOCK ? mockApi.confirmEvents(gameId, payload) : request('/games/' + gameId + '/events/confirm', 'POST', payload);
}

// ── 声称 / 行动 修订（edit / retract 同构）──

export interface ClaimPatch { subject_seat?: number | null; predicate?: Claim['predicate']; object?: string | null; }

export function editClaim(gameId: number, claimId: number, patch: ClaimPatch): Promise<{ ok: boolean }> {
  return USE_MOCK ? mockApi.editClaim() : request('/games/' + gameId + '/claims/' + claimId + '/edit', 'POST', patch);
}

export function retractClaim(gameId: number, claimId: number): Promise<{ ok: boolean }> {
  return USE_MOCK ? mockApi.retractClaim() : request('/games/' + gameId + '/claims/' + claimId + '/retract', 'POST');
}

export interface ActionPatch { target_seat?: number | null; result?: string | null; }

export function editAction(gameId: number, actionId: number, patch: ActionPatch): Promise<{ ok: boolean }> {
  return USE_MOCK ? mockApi.editAction() : request('/games/' + gameId + '/actions/' + actionId + '/edit', 'POST', patch);
}

export function retractAction(gameId: number, actionId: number): Promise<{ ok: boolean }> {
  return USE_MOCK ? mockApi.retractAction() : request('/games/' + gameId + '/actions/' + actionId + '/retract', 'POST');
}

// ── 参谋卡（异步任务：启动 → 轮询）──

export function startAdvise(gameId: number, day: number): Promise<{ task_id: string }> {
  return USE_MOCK ? mockApi.startAdvise(gameId, day) : request('/games/' + gameId + '/day/' + day + '/advise', 'POST');
}

export function getTask(taskId: string): Promise<TaskStatus> {
  return USE_MOCK ? mockApi.getTask(taskId) : request('/tasks/' + encodeURIComponent(taskId), 'GET');
}

// ── P2 W2：对局玄学化判词（赛后娱乐彩蛋；恒挂「娱乐参考」标注，绝不接入游戏研判）──

/** GET /api/games/:id/oracle —— 排盘=纯数学确定性派生，断语=LLM；mock 开发模式未实现（直连后端） */
export function getOracle(gameId: number): Promise<OracleResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现玄学判词接口，请直连后端'));
  return request('/games/' + gameId + '/oracle', 'GET');
}

// ── P9 W2：独立玄学排盘（#/mystic；三法起卦+历史档案；恒挂「娱乐参考」，绝不接入游戏研判）──

/** POST /api/oracle/cast —— 三法起卦+落档（201）；mock 开发模式未实现（直连后端，同 getOracle） */
export function castOracle(
  method: 'numbers' | 'time' | 'random',
  params?: Record<string, unknown>,
  gameId?: number,
): Promise<OracleCastResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现玄学排盘接口，请直连后端'));
  const body: Record<string, unknown> = { method, params: params ?? {} };
  if (gameId != null) body.game_id = gameId;
  return request('/oracle/cast', 'POST', body);
}

/** POST /api/oracle/interpret —— 排盘断语（G1 反馈#1；恒挂「娱乐参考」，mode 三态同 P8）；mock 开发模式未实现 */
export function interpretOracle(id: number): Promise<OracleInterpretResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现玄学排盘接口，请直连后端'));
  return request('/oracle/interpret', 'POST', { id });
}

/** GET /api/oracle/readings —— 排盘历史档案（分页，新→旧） */
export function listOracleReadings(opts?: { limit?: number; offset?: number; gameId?: number }): Promise<OracleReadingsResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现玄学排盘接口，请直连后端'));
  const q: string[] = [];
  if (opts?.limit != null) q.push('limit=' + opts.limit);
  if (opts?.offset != null) q.push('offset=' + opts.offset);
  if (opts?.gameId != null) q.push('game_id=' + opts.gameId);
  return request('/oracle/readings' + (q.length ? '?' + q.join('&') : ''), 'GET');
}

// ── P18 M2：万物审计仪表盘（/audit 页数据源；纯账本统计只记不评）──

/** GET /api/audit/summary —— l0Gate 双口径 + layer×checklist_hash 分组 + gate 分组（纯 SQL 只读，零 LLM 零评分）；mock 开发模式未实现（直连后端） */
export function getAuditSummary(): Promise<AuditSummary> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现审计仪表盘接口，请直连后端'));
  return request('/audit/summary', 'GET');
}
// ── 游戏类型（后端驱动 · 通用化）──
/** GET /api/adapters：可用游戏类型登记表（含 adapters/ 目录自动登记项，如 avalon） */
export function listAdapters(): Promise<AdapterInfo[]> {
  return USE_MOCK ? mockApi.listAdapters() : request('/adapters', 'GET');
}

// ── 阶段 3 出口件：开放接题（#/intake 接题页；只记不评，文案禁用宣称字样）──

/** GET /api/intake/questions —— 接题库只读列表（最新 N 条；只读零写） */
export function listIntakeQuestions(opts?: { limit?: number }): Promise<IntakeQuestionsResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现接题接口，请直连后端'));
  const q = opts?.limit != null ? '?limit=' + opts.limit : '';
  return request('/intake/questions' + q, 'GET');
}

/** POST /api/intake/classify —— 拒收门三问 + 六层判定 + 引擎位（只记不评） */
export function classifyIntake(body: {
  statement: string;
  resolve_spec?: Record<string, unknown>;
  checklist: Record<string, boolean | string | Array<boolean | string>>;
}): Promise<IntakeClassifyResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现接题接口，请直连后端'));
  return request('/intake/classify', 'POST', body);
}

/** GET /api/intake/rejects —— 拒收原因分布（含 0 计数） */
export function listIntakeRejects(opts?: { limit?: number }): Promise<IntakeRejectsResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现接题接口，请直连后端'));
  const q = opts?.limit != null ? '?limit=' + opts.limit : '';
  return request('/intake/rejects' + q, 'GET');
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★2026-09-28：落注（create）—— 「记一笔」的第一条**写**通路
 *
 * 【病象：这一页从头到尾只读不写】
 *   在本函数之前，`api.ts` 里与 predictions 相关的 POST 只有 `/:id/resolve`（真值回填），
 *   没有任何函数创建行 ⇒ 「记一笔」跑完 classify 只得到一句回执，账本里什么都没有；
 *   用户在「你的判断」里填的那个数也一起没了——填了、看到"收下了"、其实没进账。
 *
 * 【为什么落注要挂在外部题容器局上（不是随手选的）】
 *   后端 `predictions.game_id NOT NULL` ⇒ 落注必须挂一局，而外部题没有对局。
 *   端点内部挂的是**显式**的容器局（`games.source='external'`），
 *   既不是真实局、也不是实验场/语料局——人手写的一道题绝不能在统计上冒充灌入的语料。
 *   ⇒ 本函数**不要**传 game_id：让它由后端解析，前端不许自己编一局出来。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 落注入参。`prob` 必填且是 **0-1**（不是界面上那个 0-100 的百分数）。 */
export interface CreatePredictionInput {
  statement: string;
  /** 0-1 数值。**必须来自用户填的那个数**（换算见 lib/noteProb.ts），不许拿基率顶。 */
  prob: number;
  /** 真值锚：{kind, date?, ...}。必填——没有锚的行查不到历史频率，等于没建索引。 */
  resolve_spec: Record<string, unknown>;
  /** 分层信息，来自 classify 的返回（layer/secondary_layer/engine/gate）。 */
  layer?: string;
  secondary_layer?: string | null;
  engine?: string;
  gate?: string;
  /** 关联到接题台账的那一行（classify 返回的 intake_question_id）。 */
  intake_question_id?: number;
}

/** POST /api/predictions —— 外部题免局落注（201）。
 *  ★后端会在返回里带上 `container`（挂到了哪一局）与 `matures_why`（到期日怎么来的），
 *    页面据此回执，不自己编。mock 模式未实现（直连后端，同 resolvePrediction）。 */
export function createPrediction(
  input: CreatePredictionInput,
): Promise<{
  id: number;
  assigned_prob: number | null;
  statement: string;
  layer: string | null;
  engine: string | null;
  gate: string | null;
  matures_at: string | null;
  matures_why: string | null;
  external: boolean;
  container?: { game_id: number; name: string; scope: string };
}> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现落注接口，请直连后端'));
  return request('/predictions', 'POST', input);
}

// ── UI 重构步 2：审计页 KPI（只读；合格池/最难档/域外计数 + 分层 Brier CI）──

/** GET /api/audit/g2-kpi —— R4 口径只读 KPI（口径与 g2-report.cjs 同源；mock 未实现） */
export function getAuditG2Kpi(): Promise<AuditG2KpiResult> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现审计 KPI 接口，请直连后端'));
  return request('/audit/g2-kpi', 'GET');
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★八轮第五改 · 落定（resolve）—— **本产品题线上的第二个动词**
 *
 * 【为什么这是最重要的一处】独立侦察实测出一条我此前四轮都没看见的事实：
 *   `POST /api/predictions/:id/resolve` 与 `GET /api/predictions/unresolved`
 *   **后端早就写好了**（含 409 不可变守卫、ambiguous 强制附注、L0 判据），
 *   而**前端一次都没调过**。1994 道题全部由 CLI 批量脚本灌入，
 *   人手写的题 0 道，接题表单总共 2 行且都是测试夹具。
 *   ⇒ 题线上**只有"入账"没有"落定"**，而"落定"还发生在终端里。
 *   ⇒ 一个没有第二个动词的界面，长出来必然是仪表盘 —— 这才是
 *     「像个后端维护的东西」的真正来源，不是配色或版式问题。
 *
 * 接上之后，「看数」从**目的地**变成**回声**：按下去的一瞬间，
 * 偏差线就地长出来，而不是让人去某个页面查一个数。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 一条待落定的题（后端 listUnresolved 的行形状，只取前端要用的字段）。 */
export interface UnresolvedRow {
  id: number;
  statement: string;
  layer: string | null;
  matures_at: string | null;
  game_id: number | null;
  created_at: string | null;
  outcome: null;
}

/** GET /api/predictions/unresolved —— 待落定清单（**今天最该点的那一屏**） */
export function listUnresolved(opts?: { limit?: number; offset?: number }): Promise<{
  /** ★实测：后端 listUnresolved 返回的键是 **items**（不是 rows）——
   *   一开始按 rows 读，页面永远空。字段形状以 predictions.js:116 的契约为准。 */
  items: UnresolvedRow[]; total: number; limit?: number; offset?: number; l0_gate?: Record<string, unknown>;
}> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现落定清单接口，请直连后端'));
  const q: string[] = [];
  if (opts?.limit != null) q.push('limit=' + opts.limit);
  if (opts?.offset != null) q.push('offset=' + opts.offset);
  return request('/predictions/unresolved' + (q.length ? '?' + q.join('&') : ''), 'GET');
}

/** 落定结果。★ambiguous 必须附 note——后端会 400 拒收，这是纪律不是限制。 */
export type ResolveOutcome = 'true' | 'false' | 'ambiguous';

/** POST /api/predictions/:id/resolve —— 真值回填（**账本不可变**：已落定返回 409） */
export function resolvePrediction(
  id: number,
  outcome: ResolveOutcome,
  note?: string,
): Promise<{ id: number; outcome: string; resolved_at: string; resolve_note: string | null }> {
  if (USE_MOCK) return Promise.reject(new ApiError(0, 'mock 模式未实现落定接口，请直连后端'));
  return request('/predictions/' + id + '/resolve', 'POST', { outcome, note: note ?? null });
}
