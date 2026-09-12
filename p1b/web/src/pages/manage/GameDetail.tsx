/** GameDetail —— 管理页局详情：导出/天数推进/账本摘要/BOTC 卡/座位（B6 自 GamesPage 搬出）。 */
import { useEffect, useState } from 'react';
import * as api from '../../api';
import type { Game, Player } from '../../types';
import { SCRIPT_LABEL } from '../../botc/roles';
import { useGameTypes } from '../../lib/useGameTypes';
import BotcClaimsCard from './BotcClaimsCard';
import DayAdvanceCard from './DayAdvanceCard';
import SeatListCard from './SeatListCard';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function GameDetail(props: { gameId: number; flashToast: (t: string) => void; onGoLive: () => void }) {
  const { label: typeLabel } = useGameTypes(); // 类型名后端驱动（失败回落内置三型）
  const [detail, setDetail] = useState<{ game: Game; players: Player[] } | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewDay, setViewDay] = useState(1); // 工作日：查看截至第 N 天（BOTC 声称过滤用）

  useEffect(() => { // 详情：服务端 players 即真名
    let cancelled = false;
    setDetailErr(null);
    (async () => {
      try {
        const r = await api.getGame(props.gameId);
        if (cancelled) return;
        setDetail({ game: r.game, players: r.players });
        setViewDay(Math.max(1, r.game.current_day ?? 1));
      } catch (e) {
        if (!cancelled) { setDetail(null); setDetailErr(errMsg(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [props.gameId]);

  async function doExport() {
    if (!detail) return;
    setBusy(true); setDetailErr(null);
    try {
      const data = await api.exportGame(detail.game.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'p1b-game-' + detail.game.id + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      props.flashToast('✓ 已导出 p1b-game-' + detail.game.id + '.json（' + blob.size + ' 字节）');
    } catch (e) { setDetailErr(errMsg(e)); } finally { setBusy(false); }
  }

  if (!detail) {
    return detailErr
      ? <div className="banner banner-error" role="alert"><p>{detailErr}</p></div>
      : <p className="muted">加载详情中…</p>;
  }
  const g = detail.game;
  const detailScript = g.type === 'botc' ? (g.script ?? null) : null;

  return (
    <>
      <div className="detail-card">
        <div className="detail-head">
          <span className="detail-title">{g.name}</span>
          <span className="detail-meta">
            #{g.id} · {typeLabel(g.type)}{detailScript ? '·' + SCRIPT_LABEL[detailScript] : ''} · {g.player_count}人 · 服务端当前第 {g.current_day ?? 0} 天
          </span>
        </div>
        <div className="detail-actions">
          <button type="button" className="btn" onClick={() => props.onGoLive()}>✍️ 去现场</button>
          <button type="button" className="btn" onClick={() => void doExport()} disabled={busy}>
            {busy ? '导出中…' : '⬇ 导出 JSON'}
          </button>
        </div>
      </div>

      <DayAdvanceCard gameId={g.id} serverDay={g.current_day ?? 0} viewDay={viewDay} onDay={setViewDay} />

      {g.type === 'botc' && <BotcClaimsCard game={g} script={detailScript} viewDay={viewDay} />}

      <SeatListCard game={g} players={detail.players}
        onPlayers={(players) => setDetail((d) => (d ? { ...d, players } : d))}
        flashToast={props.flashToast} />
    </>
  );
}