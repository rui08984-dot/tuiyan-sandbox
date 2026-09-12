/**
 * p1b/web/src/lib/adapters.ts —— 游戏类型（适配器）运行时登记：GET /api/adapters 前端侧。
 * 数据源 = 后端登记表（内置 werewolf/botc/script + 扫 adapters/ 目录自动登记，如 avalon）。
 * 降级铁律：接口失败/形状不符 → 回落 FALLBACK_TYPES 硬编码三型（防白屏，不静默空列表）。
 * 缓存：模块级 1 次内存缓存（同会话内所有组件共用一次请求；失败不缓存，下次重试）。
 */
import { listAdapters } from '../api';
import type { AdapterInfo } from '../types';

export interface GameTypeOption { id: string; name: string; kind: string; ready: boolean }

/** 降级基线：后端不可达时仍能开局的三种类型 */
export const FALLBACK_TYPES: GameTypeOption[] = [
  { id: 'werewolf', name: '狼人杀', kind: 'engine', ready: true },
  { id: 'botc', name: '血染钟楼', kind: 'engine', ready: true },
  { id: 'script', name: '剧本', kind: 'script', ready: true },
];

let cache: GameTypeOption[] | null = null;
let inflight: Promise<GameTypeOption[]> | null = null;

/** 形状校验：必须是非空数组，每项有非空 id（缺 name 用 id 兜底） */
export function normalizeTypes(raw: unknown): GameTypeOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: GameTypeOption[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Partial<AdapterInfo>;
    if (typeof o.id !== 'string' || o.id === '') continue;
    out.push({ id: o.id, name: typeof o.name === 'string' && o.name ? o.name : o.id, kind: typeof o.kind === 'string' ? o.kind : 'unknown', ready: o.ready !== false });
  }
  return out.length > 0 ? out : null;
}

/** 拉取类型表；失败回落 FALLBACK_TYPES（永不抛错，调用方无需 try） */
export function loadGameTypes(fetchImpl?: () => Promise<unknown>): Promise<GameTypeOption[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  const get = fetchImpl ?? (() => listAdapters());
  inflight = get()
    .then((raw) => { const t = normalizeTypes(raw); const v = t ?? FALLBACK_TYPES; if (t) cache = v; return v; })
    .catch(() => FALLBACK_TYPES)
    .finally(() => { inflight = null; });
  return inflight;
}

/** id → 中文名（找不到回退 id 本身，不显示空白） */
export function typeLabel(types: GameTypeOption[], id: string): string {
  const hit = types.find((t) => t.id === id);
  return hit ? hit.name : id;
}

/** 测试缝：清缓存 */
export function _resetTypesCache(): void { cache = null; inflight = null; }