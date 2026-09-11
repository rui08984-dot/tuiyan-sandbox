/** DayAdvanceCard —— 天数推进器 + 截至第 N 天账本摘要（B6 自 GamesPage 详情搬出）。 */
import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';

interface StateSummary { events: number; claims: number; actions: number; last: string[] }

export default function DayAdvanceCard(props: { gameId: number; serverDay: number; viewDay: number; onDay: (n: number) => void }) {
  const [stateSum, setStateSum] = useState<StateSummary | null>(null);
  const viewDay = props.viewDay;
  const dayUpper = Math.max(1, props.serverDay) + 1; // 允许预看/预结下一天

  const loadStateSum = useCallback(async (id: number, d: number) => {
    try {
      const s = await api.getGameState(id, d);
      setStateSum({
        events: s.events.length, claims: s.claims.length, actions: s.actions.length,
        last: s.events.slice(-5).reverse().map((e) => 'd' + e.day + '·' + e.phase + ' ' + e.raw_text),
      });
    } catch (e) { setStateSum(null); }
  }, []);
  useEffect(() => { void loadStateSum(props.gameId, viewDay); }, [props.gameId, viewDay, loadStateSum]);

  return (
    <div className="detail-card">
      <div className="detail-head"><span className="detail-title">天数推进器</span></div>
      <div className="day-advance">
        <button type="button" className="btn" aria-label="前一天" disabled={viewDay <= 1}
          onClick={() => props.onDay(Math.max(1, viewDay - 1))}>−</button>
        <span className="day-advance-num" data-testid="manage-day">第 {viewDay} 天</span>
        <button type="button" className="btn" aria-label="后一天" disabled={viewDay >= dayUpper}
          onClick={() => props.onDay(Math.min(dayUpper, viewDay + 1))}>＋</button>
        <span className="detail-meta">服务端最新事件天 {props.serverDay}</span>
      </div>
      {stateSum && (
        <>
          <p className="state-sum">截至第 {viewDay} 天：事件 {stateSum.events} 条 · 声称 {stateSum.claims} 条 · 行动 {stateSum.actions} 条</p>
          {stateSum.last.length > 0 && (
            <ul className="state-events">
              {stateSum.last.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}