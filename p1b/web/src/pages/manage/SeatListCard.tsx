/** SeatListCard —— 座位名单编辑（B6 自 GamesPage 搬出）：乐观 UI + 0.5s 防抖 PUT /seats，失败回滚。 */
import { useEffect, useRef, useState } from 'react';
import * as api from '../../api';
import type { Game, Player } from '../../types';
import { clearSeatNames, defaultSeatName, setSeatName } from '../../lib/seatNames';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function SeatListCard(props: {
  game: Game;
  players: Player[];
  onPlayers: (players: Player[]) => void;
  flashToast: (t: string) => void;
}) {
  const gid = props.game.id;
  const serverPlayersRef = useRef<Player[]>(props.players); // 服务端名单权威副本（改名失败回滚用）
  const dirtySeats = useRef<Map<number, string>>(new Map());
  const flushTimer = useRef(0);
  const [busy, setBusy] = useState(false);

  // 切局重置权威副本
  useEffect(() => { serverPlayersRef.current = props.players; }, [gid]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyServerPlayers(players: Player[]) {
    serverPlayersRef.current = players;
    props.onPlayers(players);
  }

  async function flushSeats() {
    if (dirtySeats.current.size === 0) return;
    const seats = [...dirtySeats.current.entries()].map(([seat, name]) => ({ seat, name }));
    dirtySeats.current.clear();
    try {
      const r = await api.saveSeats(gid, seats);
      applyServerPlayers(r.players);
      for (const s of seats) setSeatName(gid, s.seat, s.name); // 离线镜像缓存同步
    } catch (e) {
      applyServerPlayers(serverPlayersRef.current.map((p) => ({ ...p }))); // 回滚到服务端名
      props.flashToast('座位名保存失败：' + errMsg(e));
    }
  }

  function renameSeat(seat: number, name: string) {
    props.onPlayers(props.players.map((p) => (p.seat === seat ? { ...p, name } : p)));
    dirtySeats.current.set(seat, name);
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => void flushSeats(), 500);
  }

  async function resetNames() {
    setBusy(true);
    try {
      const r = await api.saveSeats(gid, props.players.map((p) => ({ seat: p.seat, name: defaultSeatName(p.seat) })));
      applyServerPlayers(r.players);
      clearSeatNames(gid);
      props.flashToast('已恢复默认「N号」（服务端已落库）');
    } catch (e) {
      props.flashToast('恢复默认失败：' + errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-card">
      <div className="detail-head">
        <span className="detail-title">座位名单</span>
        <span className="detail-meta">{props.players.length} 席 · 服务端名单（改名全端同库可见）</span>
      </div>
      <div className="seat-list">
        {props.players.map((p) => (
          <div className="seat-row" key={p.seat}>
            <span className="seat-badge">{p.seat}号</span>
            <input value={p.name} placeholder={defaultSeatName(p.seat)} aria-label={p.seat + '号真名'}
              onChange={(e) => renameSeat(p.seat, e.target.value)} />
          </div>
        ))}
      </div>
      <p className="seat-hint">真名经 PUT /api/games/{gid}/seats 保存在服务端（同库各端可见）；输入后 0.5s 自动保存。</p>
      <div className="detail-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void resetNames()}>恢复默认「N号」</button>
      </div>
    </div>
  );
}
