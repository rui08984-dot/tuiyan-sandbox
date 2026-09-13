/** AdvisorZone —— 时间线顶部可展开参谋卡大卡：生成中/就绪提醒/历史卡按天切换（B6）。 */
import { useEffect, useState } from 'react';
import { fmtTime, listArchive } from '../../lib/adviseArchive';
import AdvisorCardView from '../../components/advisor/AdvisorCardView';
import type { useAdvise } from './useAdvise';
import { IconBrain, IconCheck } from '../../components/ui';

type Advise = ReturnType<typeof useAdvise>;

export default function AdvisorZone(props: { gameId: number; gameName: string; advise: Advise }) {
  const a = props.advise;
  const [expanded, setExpanded] = useState(false);
  const cur = a.current && a.current.gameId === props.gameId ? a.current : null;
  const running = a.task != null && a.task.gameId === props.gameId;
  useEffect(() => { if (cur?.source === 'task') setExpanded(true); }, [cur?.source, cur?.day]); // 就绪自动展开
  const localArchive = a.cardsSource === 'local' ? listArchive(props.gameId) : [];
  const histCount = a.cardsSource === 'server' ? (a.serverCards ?? []).length : localArchive.length;

  return (
    <>
      <div className="adv-strip" data-testid="advisor-strip">
        <span className="adv-strip-title"><IconBrain size={15} /> 参谋卡</span>
        {running && <span className="adv-badge"><span className="spinner" aria-hidden></span>生成中 {a.elapsedSec}s</span>}
        {!running && cur && <span className="adv-badge is-ready"><IconCheck size={13} /> 第 {cur.day} 天{cur.source === 'task' ? '就绪' : '存档'}</span>}
        <span className="adv-strip-meta">{histCount > 0 ? '存档 ' + histCount + ' 天' : '暂无存档'}</span>
        <button type="button" className="btn" onClick={() => setExpanded((o) => !o)}>
          {expanded ? '▲ 收起' : '▼ 展开'}
        </button>
      </div>
      {expanded && (
        <div className="adv-body" data-testid="advisor-body">
          {running && a.task && (
            <div className="adv-running" role="status">
              <span className="spinner" aria-hidden></span>
              <p style={{ margin: 0 }}>
                <strong>参谋卡生成中…</strong> 第 {a.task.day} 天 · 已 {a.elapsedSec}s · 任务 {a.task.id}
                {a.taskStatus ? ' · ' + a.taskStatus.status : ''}
              </p>
            </div>
          )}
          {!running && cur && cur.source === 'task' && (
            <div className="adv-ready" role="status"><IconCheck size={13} /> 第 {cur.day} 天参谋卡就绪（{fmtTime(cur.entry.finished_at) || '刚生成'}）</div>
          )}
          {cur && <AdvisorCardView gameId={cur.gameId} entry={cur.entry} gameName={props.gameName} source={cur.source} />}
          {!cur && !running && (
            <p className="muted" style={{ margin: '4px 0' }}>本局还没有参谋卡——顶部「天结算」提交当日账本生成。</p>
          )}
          <h3 className="adv-sec-title">历史卡（{a.cardsSource === 'server' ? '服务端存档 · 按天' : '本机缓存 · 服务端不可达'}）</h3>
          <div className="adv-hist-row">
            {a.cardsSource === 'server'
              ? (a.serverCards ?? []).map((c) => (
                <button key={c.day} type="button" className={'chip' + (cur && cur.day === c.day ? ' is-on' : '')}
                  onClick={() => void a.openServerCard(props.gameId, c.day)}>
                  第{c.day}天 · {c.hypotheses.length}假设
                </button>
              ))
              : localArchive.map(({ day, entry }) => (
                <button key={day} type="button" className={'chip' + (cur && cur.day === day ? ' is-on' : '')}
                  onClick={() => a.openLocalCard(props.gameId, day, entry)}>
                  第{day}天{entry.finished_at ? ' · ' + fmtTime(entry.finished_at) : ''}
                </button>
              ))}
            {histCount === 0 && <p className="muted" style={{ margin: '4px 0' }}>（暂无存档）</p>}
          </div>
          {/* G1 反馈#2 修复：cardsErr 两种来源都可见——local=服务端不可达兜底说明；server=单次打开失败如实报错 */}
          {a.cardsErr && (
            <p className="seat-hint" style={{ marginTop: 8 }} role="alert">
              {a.cardsSource === 'local'
                ? '服务端存档不可达（' + a.cardsErr + '），显示本机缓存兜底。'
                : a.cardsErr}
            </p>
          )}
        </div>
      )}
    </>
  );
}
