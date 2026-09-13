/**
 * Timeline —— 当日事件流（最新在上），claims/actions 同构可 edit/retract。
 * 撤回 = 两击确认（先点变红色「确认撤回」，3 秒不点自动复位），避免误触。
 */
import { useEffect, useRef, useState } from 'react';
import type { BotcClaim, BotcScript, Claim, GameAction, GameEvent } from '../../types';
import { botcRoleDisplay } from '../../botc/roles';
import { BOTC_PRED_LABEL } from './confirm-flow';
import { IconCheck, IconAlert } from '../ui';

const PHASE_CN: Record<string, string> = { night: '夜', day: '昼', dusk: '黄昏' };
const TYPE_CN: Record<string, string> = {
  statement: '发言', vote: '投票', death: '死亡', claim: '声称', action_reveal: '行动公示', system: '系统',
};

interface TimelineProps {
  events: GameEvent[];
  claims: Claim[];
  actions: GameAction[];
  /** B4：botc 局阵营/状态声称（GET botc-claims，按 event_id 合并进事件流）；werewolf 局恒空 */
  botcClaims: BotcClaim[];
  botcScript: BotcScript | null;
  seatName: (seat: number | null) => string;
  busy: boolean;
  onEditClaim: (row: Claim) => void;
  onRetractClaim: (row: Claim) => void;
  onEditAction: (row: GameAction) => void;
  onRetractAction: (row: GameAction) => void;
  onRetractBotcClaim: (row: BotcClaim) => void;
}

function ArmedBtn(props: { label: string; armedLabel: string; disabled?: boolean; onFire: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current); }, []);
  return (
    <button
      type="button"
      className={'btn' + (armed ? ' is-armed' : '')}
      disabled={props.disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 3000);
        } else {
          if (timer.current !== undefined) window.clearTimeout(timer.current);
          setArmed(false);
          props.onFire();
        }
      }}
    >
      {armed ? props.armedLabel : props.label}
    </button>
  );
}

export default function Timeline(p: TimelineProps) {
  const claimsByEvent = new Map<number, Claim[]>();
  for (const c of p.claims) {
    const arr = claimsByEvent.get(c.event_id) ?? [];
    arr.push(c);
    claimsByEvent.set(c.event_id, arr);
  }
  const botcByEvent = new Map<number, BotcClaim[]>();
  for (const bc of p.botcClaims) {
    const arr = botcByEvent.get(bc.event_id) ?? [];
    arr.push(bc);
    botcByEvent.set(bc.event_id, arr);
  }
  const actionsByEvent = new Map<number, GameAction[]>();
  for (const a of p.actions) {
    const arr = actionsByEvent.get(a.event_id) ?? [];
    arr.push(a);
    actionsByEvent.set(a.event_id, arr);
  }
  const sorted = [...p.events].sort((x, y) => (y.seq - x.seq) || (y.id - x.id)); // 最新在上

  if (sorted.length === 0) {
    return <p className="tl-empty">本日暂无已入账事件——在下方输入条记录或用宏录入。</p>;
  }
  return (
    <div className="timeline">
      {sorted.map((ev) => (
        <article key={ev.id} className="tl-item">
          <div className="tl-head">
            <span className="tl-seq">e{ev.id}/seq{ev.seq}</span>
            <span className="tl-type">{TYPE_CN[ev.type] ?? ev.type} · {PHASE_CN[ev.phase] ?? ev.phase}</span>
            <span className="tl-actor">{ev.actor_seat != null ? p.seatName(ev.actor_seat) : '系统'}</span>
          </div>
          <p className="tl-raw">{ev.raw_text}</p>
          <div className="tl-claims">
            {(claimsByEvent.get(ev.id) ?? []).map((c) => (
              <div className="tl-claim" key={c.id}>
                <span className="tl-ext">c{c.id}</span>
                <span className={'pred pred-' + (c.predicate === 'is_wolf' || c.predicate === 'is_good' || c.predicate === 'claims_role' ? c.predicate : 'other')}>
                  {c.predicate}
                </span>
                <span>{c.seat}号 → {c.subject_seat}号{p.botcScript != null && (c.predicate === 'claims_role' || c.predicate === 'is_role') ? '「' + botcRoleDisplay(c.object) + '」' : '「' + c.object + '」'}</span>
                {c.extracted_by === 'macro' && <span className="badge badge-accent">宏</span>}
                {c.confirmed_by_user ? <span className="badge badge-ok"><IconCheck size={12} />确认</span> : <span className="badge badge-warn"><IconAlert size={12} />未确认</span>}
                <span className="tl-row-actions">
                  <button className="btn" disabled={p.busy} onClick={() => p.onEditClaim(c)}>编辑</button>
                  <ArmedBtn label="撤回" armedLabel="确认撤回?" disabled={p.busy} onFire={() => p.onRetractClaim(c)} />
                </span>
              </div>
            ))}
            {(botcByEvent.get(ev.id) ?? []).map((bc) => (
              <div className="tl-claim" key={'b' + bc.id}>
                <span className="tl-ext">b{bc.id}</span>
                <span className="pred pred-botc">{BOTC_PRED_LABEL[bc.predicate] ?? bc.predicate}</span>
                <span>{bc.seat}号 → {bc.subject_seat}号{bc.object ? '（' + bc.object + '）' : ''}</span>
                {bc.confirmed_by_user ? <span className="badge badge-ok"><IconCheck size={12} />确认</span> : <span className="badge badge-warn"><IconAlert size={12} />未确认</span>}
                <span className="tl-row-actions">
                  <ArmedBtn label="撤回" armedLabel="确认撤回?" disabled={p.busy} onFire={() => p.onRetractBotcClaim(bc)} />
                </span>
              </div>
            ))}
            {(actionsByEvent.get(ev.id) ?? []).map((a) => (
              <div className="tl-claim" key={a.id}>
                <span className="tl-ext">a{a.id}</span>
                <span className="pred pred-other">{a.action}</span>
                <span>{a.seat}号{a.target_seat != null ? ' → ' + a.target_seat + '号' : ''}{a.result ? '（' + a.result + '）' : ''}</span>
                <span className="tl-row-actions">
                  <button className="btn" disabled={p.busy} onClick={() => p.onEditAction(a)}>编辑</button>
                  <ArmedBtn label="撤回" armedLabel="确认撤回?" disabled={p.busy} onFire={() => p.onRetractAction(a)} />
                </span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
