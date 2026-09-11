/**
 * adviseArchive —— 参谋卡本机存档/验证点/在跑任务（B6 从 AdvisorPage 抽出的纯逻辑层）。
 * 服务端（GET /api/games/:id/cards）为真相源；本层仅兜底缓存 + 勾选持久化。
 */
import type { AdvisorCard, Contradiction } from '../types';

/** 渲染卡：任务卡 + 服务端存档卡（conflict_desc/evidence_day）统一视图模型 */
export type ViewCard = Omit<AdvisorCard, 'contradictions'> & {
  saved?: boolean;
  contradictions: (Contradiction & { conflict_desc?: string | null; evidence_day?: number | null })[];
};
export interface ArchiveEntry { card: ViewCard; finished_at?: string | null; task_id?: string }
export interface CurrentView { source: 'task' | 'server' | 'local'; gameId: number; day: number; entry: ArchiveEntry }
export interface RunningTask { id: string; gameId: number; day: number; startedAt: number }

const LS_CARDS = 'p1b.advisor.cards.v1';
const LS_CHECKS = 'p1b.advisor.checks.v1';
const LS_TASK = 'p1b.advisor.runningTask';

type Archive = Record<string, Record<string, ArchiveEntry>>;

export function loadArchive(): Archive {
  try {
    const raw = localStorage.getItem(LS_CARDS);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Archive) : {};
  } catch { return {}; }
}
export function putArchive(gameId: number, day: number, entry: ArchiveEntry): void {
  const a = loadArchive();
  const gk = String(gameId);
  a[gk] = { ...(a[gk] ?? {}), [String(day)]: entry };
  try { localStorage.setItem(LS_CARDS, JSON.stringify(a)); } catch { /* 写失败静默 */ }
}
/** 某局本机存档列表（按天倒序） */
export function listArchive(gameId: number): { day: number; entry: ArchiveEntry }[] {
  const g = loadArchive()[String(gameId)] ?? {};
  return Object.keys(g).map(Number).filter((d) => Number.isInteger(d)).sort((x, y) => y - x)
    .map((day) => ({ day, entry: g[String(day)] }));
}
export function loadChecks(key: string): number[] {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(LS_CHECKS) || '{}');
    const v = (all as Record<string, unknown>)?.[key];
    return Array.isArray(v) ? (v as unknown[]).filter((x): x is number => Number.isInteger(x)) : [];
  } catch { return []; }
}
export function saveChecks(key: string, idxs: number[]): void {
  try {
    let all: Record<string, number[]> = {};
    try { all = JSON.parse(localStorage.getItem(LS_CHECKS) || '{}') as Record<string, number[]>; } catch { /* 重置 */ }
    all[key] = idxs;
    localStorage.setItem(LS_CHECKS, JSON.stringify(all));
  } catch { /* 静默 */ }
}
export function loadRunningTask(): RunningTask | null {
  try {
    const raw = localStorage.getItem(LS_TASK);
    if (!raw) return null;
    const v = JSON.parse(raw) as RunningTask;
    return v && typeof v.id === 'string' && Number.isInteger(v.gameId) ? v : null;
  } catch { return null; }
}
export function saveRunningTask(t: RunningTask): void {
  try { localStorage.setItem(LS_TASK, JSON.stringify(t)); } catch { /* 静默 */ }
}
export function clearRunningTask(): void {
  try { localStorage.removeItem(LS_TASK); } catch { /* 静默 */ }
}
export function fmtEvs(arr: number[] | undefined): string {
  return arr && arr.length ? arr.map((e) => 'e' + e).join(',') : '-';
}
export function fmtRes(resolves: number[] | undefined, total: number): string {
  const ok = (resolves ?? []).filter((x) => Number.isInteger(x) && x >= 0 && x < total);
  return ok.length ? ok.map((x) => 'H' + (x + 1)).join('/') : '-';
}
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}