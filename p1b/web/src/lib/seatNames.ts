/**
 * 座位真名离线镜像缓存（localStorage）—— P1b-4 平迁后的兜底层。
 *
 * 真相源已迁服务端：PUT /api/games/:id/seats（仅 UPDATE players.name），GET 详情/state 的
 * players.name 即服务端真名，全端同库可见。本文件不再作为显示权威，仅承担：
 *   - PUT 成功后同步镜像一份（离线/后端不可达时的最后兜底显示）；
 *   - 兼容平迁前已写入的旧数据（覆盖显示等价值，无害）。
 */
import type { Player } from '../types';

const LS_KEY = 'p1b.seatNames.v1';

/** seat(数字) -> 真名；省缺 = 沿用服务端名 */
type SeatMap = Record<string, string>;
/** gameId -> SeatMap */
type Store = Record<string, SeatMap>;

function load(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Store) : {};
  } catch {
    return {};
  }
}

function save(s: Store): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* 隐私模式等写入失败：静默降级为会话内生效 */ }
}

/** 默认席位名（服务端口径：座位号 + 「号」） */
export function defaultSeatName(seat: number): string {
  return seat + '号';
}

/** 读某局的真名 overlay（只含显式设置过的席位） */
export function seatOverlay(gameId: number): SeatMap {
  return load()[String(gameId)] ?? {};
}

/** 把 overlay 合并进服务端 players（返回新数组，不改入参） */
export function mergePlayers(gameId: number, players: Player[]): Player[] {
  const overlay = seatOverlay(gameId);
  if (Object.keys(overlay).length === 0) return players;
  return players.map((p) => {
    const real = overlay[String(p.seat)];
    return real ? { ...p, name: real } : p;
  });
}

/** 设置某局某席位的真名；空串或等于默认名 = 清除该条目 */
export function setSeatName(gameId: number, seat: number, name: string): void {
  const store = load();
  const key = String(gameId);
  const seats = { ...(store[key] ?? {}) };
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === defaultSeatName(seat)) delete seats[String(seat)];
  else seats[String(seat)] = trimmed;
  if (Object.keys(seats).length === 0) delete store[key];
  else store[key] = seats;
  save(store);
}

/** 清空某局 overlay（座位名单「重置为服务端名」用） */
export function clearSeatNames(gameId: number): void {
  const store = load();
  delete store[String(gameId)];
  save(store);
}

/** 某局已设置真名的席位数（UI 提示用） */
export function seatNameCount(gameId: number): number {
  return Object.keys(seatOverlay(gameId)).length;
}
