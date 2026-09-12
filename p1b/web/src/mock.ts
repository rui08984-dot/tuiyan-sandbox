/**
 * P1b 前端内置 mock（VITE_USE_MOCK=1 时由 api.ts 启用）。
 * 后端（P1b-1）未就绪期的内存假数据；形状与 P1B-SPEC §3 契约一致，仅覆盖前端需要的最小行为。
 * 生产构建不设该变量，走真实 /api。
 * QC③：api.ts 已改动态 import 按需加载，本文件独立分包，不再随主包打包。
 */
import type {
  AdvisorCard, ConfirmPayload, CreateGameInput, Game, GameState, Player,
  AdapterInfo,
  PendingCard, Provider, ProviderInput, ProviderListResult, ProviderTestResult,
  ServerCard, ServerCardsResult, SeatsSaveResult, TaskStatus,
} from './types';

const delay = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms));

// ── 供应商 ──

interface MockProvider {
  label: string;
  base_url: string;
  api_key: string;
  model: string;
  cards_model: string;
}

const providerStore: Record<string, MockProvider> = {
  tokenrhythm: {
    label: 'TokenRhythm（自定义中转）',
    base_url: 'https://tokenrhythm.studio/v1',
    api_key: 'sk_mock_saved_key',
    model: 'glm-5.3-flash',
    cards_model: 'glm-5.3-flash',
  },
  ollama: {
    label: 'Ollama（本地）',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '',
    model: 'qwen2.5:7b',
    cards_model: '',
  },
};
let activeProviderKey = 'tokenrhythm';

function toProvider(key: string, p: MockProvider): Provider {
  return {
    key,
    label: p.label,
    base_url: p.base_url,
    model: p.model,
    cards_model: p.cards_model,
    has_api_key: p.api_key !== '',
    // QC④：掩码与服务端 providersStore.js 统一为「....+后4位」
    api_key_masked: p.api_key ? '....' + p.api_key.slice(-4) : null,
  };
}

// ── 对局 ──

let gameSeq = 2;
const games: Game[] = [
  { id: 1, name: '示例局 · 狼人杀8人', type: 'werewolf', player_count: 8, status: 'active', created_at: '2026-09-08T19:00:00+08:00', current_day: 2 },
];

function mockPlayers(count: number, names?: string[]): Player[] {
  return Array.from({ length: count }, (_, i) => ({ seat: i + 1, name: names?.[i] || (i + 1) + '号', alive: true }));
}
const playersByGame: Record<number, Player[]> = { 1: mockPlayers(8) };

// ── 参谋卡异步任务 ──

let taskSeq = 0;
const taskStore = new Map<string, { startedAt: number; day: number }>();

function mockCard(day: number): AdvisorCard {
  return {
    day,
    contradictions: [
      { underdetermination: 'high', innocent_explanations: ['（mock）3号可能只是口误'] },
    ],
    hypotheses: [
      { content: '（mock）3号持刀，5号倒钩', stance: { '3': 'wolf_suspect' }, support_events: [1], oppose_events: [], tendency: 'mid' },
      { content: '（mock）全场好人局，1号闭眼', stance: { '1': 'good_claim' }, support_events: [], oppose_events: [1], tendency: 'weak' },
    ],
    checkpoints: [{ text: '（mock）明天听 3 号归票逻辑', resolves: [0] }],
    warnings: ['（mock）内存假数据'],
  };
}

export const mockApi = {
  // ── 供应商（设置页）──
  async listProviders(): Promise<ProviderListResult> {
    await delay();
    return {
      providers: Object.entries(providerStore).map(([k, p]) => toProvider(k, p)),
      active: activeProviderKey,
    };
  },

  async saveProvider(key: string, input: ProviderInput): Promise<{ provider: Provider }> {
    await delay();
    const existing = providerStore[key];
    providerStore[key] = {
      label: input.label,
      base_url: input.base_url,
      // api_key 留空 = 保留服务端现有值（契约约定，key 永不出服务端）
      api_key: input.api_key || existing?.api_key || '',
      model: input.model,
      cards_model: input.cards_model || '',
    };
    return { provider: toProvider(key, providerStore[key]) };
  },

  async activateProvider(key: string): Promise<{ ok: boolean; active: string }> {
    await delay();
    if (!providerStore[key]) throw new Error('供应商不存在：' + key);
    activeProviderKey = key;
    return { ok: true, active: key };
  },

  async deleteProvider(key: string): Promise<{ ok: boolean }> {
    await delay();
    if (!providerStore[key]) throw new Error('供应商不存在：' + key);
    // 与服务端 providersStore.js 对齐：删除使用中供应商 = 允许，active 自动回落
    const wasActive = activeProviderKey === key;
    delete providerStore[key];
    if (wasActive) activeProviderKey = Object.keys(providerStore)[0] ?? null;
    return { ok: true };
  },

  async testProvider(key: string): Promise<ProviderTestResult> {
    await delay(600);
    const p = providerStore[key];
    if (!p) throw new Error('供应商不存在：' + key);
    return { ok: true, latency_ms: 320, model: p.model, message: '（mock）连接正常' };
  },

  // ── 对局 ──
  async listGames(): Promise<{ games: Game[] }> {
    await delay();
    return { games: [...games] };
  },

  async createGame(input: CreateGameInput): Promise<{ game: Game }> {
    await delay();
    const game: Game = {
      id: gameSeq++,
      name: input.name,
      type: input.type,
      player_count: input.player_count,
      status: 'active',
      created_at: new Date().toISOString(),
      current_day: 1,
    };
    games.unshift(game);
    playersByGame[game.id] = mockPlayers(input.player_count, input.seat_names);
    return { game };
  },

  async getGame(id: number): Promise<{ game: Game; players: Player[] }> {
    await delay();
    const game = games.find((g) => g.id === id);
    if (!game) throw new Error('对局不存在：' + id);
    return { game, players: playersByGame[id] ?? [] };
  },

  async getGameState(id: number, _uptoDay?: number): Promise<GameState> {
    await delay();
    const game = games.find((g) => g.id === id);
    if (!game) throw new Error('对局不存在：' + id);
    return { game, players: playersByGame[id] ?? [], events: [], claims: [], actions: [] };
  },

  async exportGame(id: number): Promise<unknown> {
    await delay();
    const game = games.find((g) => g.id === id);
    if (!game) throw new Error('对局不存在：' + id);
    return { game, players: playersByGame[id] ?? [], events: [], claims: [], actions: [] };
  },

  // ── P1b-4 平迁：seats / 服务端卡存档（mock 最小行为）──
  async saveSeats(gameId: number, seats: { seat: number; name: string }[]): Promise<SeatsSaveResult> {
    await delay();
    const list = playersByGame[gameId];
    if (!list) throw new Error('对局不存在：' + gameId);
    for (const s of seats) {
      const row = list.find((p) => p.seat === s.seat);
      if (!row) throw new Error('席位不存在：' + s.seat);
      row.name = s.name;
    }
    return { ok: true, players: list.map((p) => ({ ...p })) };
  },

  async listServerCards(gameId: number): Promise<ServerCardsResult> {
    await delay();
    return { game_id: gameId, cards: [] };
  },

  async getServerCard(gameId: number, day: number): Promise<ServerCard> {
    await delay();
    throw new Error('局 ' + gameId + ' 第 ' + day + ' 天没有参谋卡存档');
  },

  // ── 事件抽取 / 确认入账 ──
  async extractEvents(_gameId: number, text: string): Promise<PendingCard> {
    await delay(800);
    return {
      event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: text },
      claims: [{ seat: 3, subject_seat: 5, predicate: 'is_wolf' }],
      actions: [],
      warnings: ['（mock）后端未接入，返回示例待确认卡'],
    };
  },

  async confirmEvents(_gameId: number, _payload: ConfirmPayload): Promise<{ ok: boolean; event_id?: number }> {
    await delay();
    return { ok: true, event_id: 1 };
  },

  async editClaim(): Promise<{ ok: boolean }> { return { ok: true }; },
  async retractClaim(): Promise<{ ok: boolean }> { return { ok: true }; },
  async editAction(): Promise<{ ok: boolean }> { return { ok: true }; },
  async retractAction(): Promise<{ ok: boolean }> { return { ok: true }; },

  // ── 参谋卡异步任务 ──
  async startAdvise(_gameId: number, day: number): Promise<{ task_id: string }> {
    await delay(300);
    const taskId = 'mock-task-' + (++taskSeq);
    taskStore.set(taskId, { startedAt: Date.now(), day });
    return { task_id: taskId };
  },

  async getTask(taskId: string): Promise<TaskStatus> {
    await delay(100);
    const t = taskStore.get(taskId);
    if (!t) throw new Error('任务不存在：' + taskId);
    if (Date.now() - t.startedAt < 2500) return { status: 'running', card: null, error: null };
    return { status: 'done', card: mockCard(t.day), error: null };
  },
  // ── 游戏类型（后端驱动 · 通用化）──
  async listAdapters(): Promise<AdapterInfo[]> {
    await delay();
    return [
      { id: 'werewolf', name: '狼人杀', kind: 'engine', ready: true },
      { id: 'botc', name: '血染钟楼', kind: 'engine', ready: true },
      { id: 'script', name: '剧本', kind: 'script', ready: true },
    ];
  },
};
