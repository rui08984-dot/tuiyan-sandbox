/** useLedgerOps —— 已入账 claim/action 修订与撤回（B6 自 InputPage 抽出，账本纪律：原文不可改）。 */
import { useState } from 'react';
import * as api from '../../api';
import type { BotcClaim, Claim, GameAction } from '../../types';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useLedgerOps(ctx: {
  gameId: number | null;
  day: number;
  loadState: (gid: number, d: number, syncDay: boolean) => Promise<void>;
  loadBotcClaims: (gid: number) => Promise<void>;
  flashToast: (t: string) => void;
  setBusy: (b: boolean) => void;
  setPageErr: (e: string | null) => void;
}) {
  const [editTarget, setEditTarget] = useState<{ kind: 'claim'; row: Claim } | { kind: 'action'; row: GameAction } | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  async function submitEdit(patch: Record<string, unknown>) {
    if (ctx.gameId == null || editTarget == null) return;
    ctx.setBusy(true); setEditErr(null);
    try {
      if (editTarget.kind === 'claim') await api.editClaim(ctx.gameId, editTarget.row.id, patch as api.ClaimPatch);
      else await api.editAction(ctx.gameId, editTarget.row.id, patch as api.ActionPatch);
      setEditTarget(null);
      ctx.flashToast('修订已生效（事件原文不可改）');
      await ctx.loadState(ctx.gameId, ctx.day, false);
    } catch (e) { setEditErr(errMsg(e)); } finally { ctx.setBusy(false); }
  }

  async function doRetract(kind: 'claim' | 'action', row: Claim | GameAction) {
    if (ctx.gameId == null) return;
    ctx.setBusy(true); ctx.setPageErr(null);
    try {
      if (kind === 'claim') await api.retractClaim(ctx.gameId, row.id);
      else await api.retractAction(ctx.gameId, row.id);
      ctx.flashToast('已撤回（账本纪律：retracted 不可见）');
      await ctx.loadState(ctx.gameId, ctx.day, false);
    } catch (e) { ctx.setPageErr(errMsg(e)); } finally { ctx.setBusy(false); }
  }

  async function doRetractBotc(row: BotcClaim) {
    if (ctx.gameId == null) return;
    ctx.setBusy(true); ctx.setPageErr(null);
    try {
      await api.retractBotcClaim(ctx.gameId, row.id);
      ctx.flashToast('阵营/状态声称已撤回（账本纪律：retracted 不可见）');
      await ctx.loadState(ctx.gameId, ctx.day, false);
      await ctx.loadBotcClaims(ctx.gameId);
    } catch (e) { ctx.setPageErr(errMsg(e)); } finally { ctx.setBusy(false); }
  }

  return { editTarget, setEditTarget, editErr, setEditErr, submitEdit, doRetract, doRetractBotc };
}
