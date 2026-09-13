/** useConfirmFlow —— 自由文本抽取→确认卡 YD5 状态机 + 3 宏入口（B6 自 InputPage 抽出）。 */
import { useState } from 'react';
import * as api from '../../api';
import type { EventPhase, PendingCard } from '../../types';
import { buildMacroCard, toConfirmPayload, type MacroInput, type MacroKind } from '../../components/input/confirm-flow';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useConfirmFlow(ctx: {
  gameId: number | null;
  day: number;
  phase: EventPhase;
  setBusy: (b: boolean) => void;
  setPageErr: (e: string | null) => void;
  reloadAll: (gid: number, d: number) => Promise<void>;
  flashToast: (t: string) => void;
}) {
  const [text, setText] = useState('');
  const [card, setCard] = useState<PendingCard | null>(null);
  const [round, setRound] = useState(1);
  const [reshown, setReshown] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);
  const [macroKind, setMacroKind] = useState<MacroKind | null>(null);
  const [macroErr, setMacroErr] = useState<string | null>(null);

  function openCard(c: PendingCard) { setCard(c); setRound(1); setReshown(false); setDirty(false); setCardErr(null); }

  async function sendText() {
    if (ctx.gameId == null || text.trim() === '') return;
    ctx.setBusy(true); ctx.setPageErr(null);
    try {
      openCard(await api.extractEvents(ctx.gameId, text.trim(), { day: ctx.day, phase: ctx.phase }));
    } catch (e) { ctx.setPageErr(errMsg(e)); } finally { ctx.setBusy(false); }
  }

  function macroSubmit(input: MacroInput) {
    setMacroErr(null);
    setMacroKind(null);
    openCard(buildMacroCard(input)); // 宏前端直接构造，不走 LLM
  }

  async function confirmCard() {
    if (card == null || ctx.gameId == null) return;
    if (dirty) { setDirty(false); setReshown(true); setRound((r) => r + 1); return; } // 任一修改重显一轮（YD5）
    ctx.setBusy(true); setCardErr(null);
    try {
      const r = await api.confirmEvents(ctx.gameId, toConfirmPayload(card));
      setCard(null);
      ctx.flashToast('已入账 e' + (r.event_id ?? '?') + '（seq ' + r.seq + '）· 声称 ' + (r.claim_ids?.length ?? 0) + ' 条 · 行动 ' + (r.action_ids?.length ?? 0) + ' 条');
      setText('');
      await ctx.reloadAll(ctx.gameId, ctx.day);
    } catch (e) { setCardErr(errMsg(e)); } finally { ctx.setBusy(false); }
  }

  return {
    text, setText, card, round, reshown, dirty, cardErr, openCard,
    applyCard: (mut: (c: PendingCard) => PendingCard) => { setCard((c) => (c ? mut(c) : c)); setDirty(true); },
    cancelCard: () => setCard(null),
    confirmCard,
    macroKind, setMacroKind, macroErr, setMacroErr, macroSubmit, sendText,
  };
}
