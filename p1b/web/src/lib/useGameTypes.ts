/**
 * p1b/web/src/lib/useGameTypes.ts —— 游戏类型（后端驱动）React 绑定。
 * 初值恒 FALLBACK_TYPES（首帧不空、不白屏）；挂载后拉 /api/adapters 替换；失败保持回落。
 * 缓存由 lib/adapters.ts 兜（同会话仅一次请求）。
 */
import { useEffect, useState } from 'react';
import { FALLBACK_TYPES, loadGameTypes, typeLabel } from './adapters';
import type { GameTypeOption } from './adapters';

export function useGameTypes(): { types: GameTypeOption[]; label: (id: string) => string } {
  const [types, setTypes] = useState<GameTypeOption[]>(FALLBACK_TYPES);
  useEffect(() => {
    let on = true;
    void loadGameTypes().then((t) => { if (on) setTypes(t); });
    return () => { on = false; };
  }, []);
  return { types, label: (id: string) => typeLabel(types, id) };
}