/** useLiveGame —— 现场页数据层（B6 自 InputPage 抽出）：选局/加载/座位上下文；修订撤回见 useLedgerOps。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api';
import type { BotcClaim, BotcScript, Claim, EventPhase, Game, GameAction, GameEvent, Player } from '../../types';
import { useLedgerOps } from './useLedgerOps';

const LS_KEY = 'p1b.input.gameId';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useLiveGame() {
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(LS_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [botcClaims, setBotcClaims] = useState<BotcClaim[]>([]);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [day, setDay] = useState(1);
  const [phase, setPhase] = useState<EventPhase>('day');
  const [busy, setBusy] = useState(false);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dayResetPending = useRef(true);

  const flashToast = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 3200);
  }, []);

  const loadGames = useCallback(async () => {
    try { setGames((await api.listGames()).games); } catch (e) { setPageErr(errMsg(e)); }
  }, []);
  useEffect(() => { void loadGames(); }, [loadGames]);

  const loadState = useCallback(async (gid: number, d: number, syncDay: boolean) => {
    setBusy(true);
    try {
      const s = await api.getGameState(gid, d);
      setGame(s.game); setPlayers(s.players); setEvents(s.events); setClaims(s.claims); setActions(s.actions);
      setPageErr(null);
      if (syncDay) setDay(Math.max(1, s.game.current_day ?? 1)); // 切局后对齐最新事件天
    } catch (e) { setPageErr(errMsg(e)); } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (gameId == null) return;
    localStorage.setItem(LS_KEY, String(gameId));
    void loadState(gameId, day, dayResetPending.current);
    dayResetPending.current = false;
  }, [gameId, day, loadState]);

  // botc 局剧本（/state 不带 script → 从局列表取，列表 SQL JOIN botc_games）；werewolf 恒 null
  const script: BotcScript | null = game && game.type === 'botc'
    ? (games.find((g) => g.id === game.id)?.script ?? null)
    : null;

  const loadBotcClaims = useCallback(async (gid: number) => {
    try { setBotcClaims((await api.getBotcClaims(gid)).claims); } catch { setBotcClaims([]); }
  }, []);
  useEffect(() => {
    if (gameId != null && game?.type === 'botc') void loadBotcClaims(gameId);
    else setBotcClaims([]);
  }, [gameId, game?.type, loadBotcClaims]);

  const seats = players.map((pl) => pl.seat);
  const seatCtx = { maxSeat: players.length || (game?.player_count ?? 0), seats };
  const seatName = useCallback((s: number | null) => {
    if (s == null) return '';
    const pl = players.find((x) => x.seat === s);
    return s + '号' + (pl && pl.name !== s + '号' ? '·' + pl.name : '');
  }, [players]);
  const deathSeats = new Set(events.filter((e) => e.type === 'death' && e.actor_seat != null).map((e) => e.actor_seat as number));
  const roster = players.map((pl) => ({ seat: pl.seat, name: pl.name, alive: !deathSeats.has(pl.seat) }));

  /** 确认入账后的全量刷新（state + 局列表 + botc 声称） */
  const reloadAll = useCallback(async (gid: number, d: number) => {
    await loadState(gid, d, false);
    await loadGames();
    await loadBotcClaims(gid);
  }, [loadState, loadGames, loadBotcClaims]);

  function switchGame(id: number) { dayResetPending.current = true; setDay(1); setGameId(id); }

  const ledger = useLedgerOps({ gameId, day, loadState, loadBotcClaims, flashToast, setBusy, setPageErr });

  return {
    games, gameId, game, players, events, claims, botcClaims, actions,
    day, setDay, phase, setPhase, busy, setBusy, pageErr, setPageErr,
    toast, flashToast,
    ...ledger,
    switchGame,
    loadGames, loadState, loadBotcClaims, reloadAll,
    script, seats, seatCtx, seatName, roster,
  };
}