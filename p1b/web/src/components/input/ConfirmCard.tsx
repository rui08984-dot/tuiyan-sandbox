/**
 * ConfirmCard —— 待确认卡全屏模态（YD5 防穿透的网页映射，与 p1a-terminal 同规则）：
 *   · 卡面 = 原文 + 结构化逐条 + 警示；
 *   · 高险席位键控：行为人/声称对象/行动人/行动目标全部 SeatField 可改，非法拒绝；
 *   · 任一修改重显：任何 committed 修改 → 上层 round+1 重显一轮，须复核后再次点击确认；
 *   · 最终确认才入库（放弃=不写库）。事件原文按契约不可改写。
 */
import type { AnyPredicate, BotcPredicate, BotcScript, PendingCard } from '../../types';
import { botcRoleDisplay, rolesByScript } from '../../botc/roles';
import {
  ALL_PREDICATES, BOTC_PREDICATES, PHASES, PHASE_LABEL, PRED_LABEL, ROLE_PREDICATES,
  withActionSeat, withActor, withClaimObject, withClaimPredicate, withClaimSubject, withEventHead,
  type SeatCtx,
} from './confirm-flow';
import SeatField from './SeatField';
import { IconAlert } from '../ui';

interface ConfirmCardProps {
  card: PendingCard;
  round: number;
  reshown: boolean; // 本轮是否因修改重显
  busy: boolean;
  error: string | null;
  ctx: SeatCtx;
  /** B4：botc 局挂的剧本（tb|bmr|snv）；null = werewolf 局（谓词/对象展示保持原样零变化） */
  botcScript: BotcScript | null;
  seatName: (seat: number | null) => string;
  onApply: (mut: (c: PendingCard) => PendingCard) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmCard(p: ConfirmCardProps) {
  const { card: c } = p;
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="待确认卡">
      <div className="confirm-sheet">
        <div className="confirm-head">
          <h2>待确认卡</h2>
          <span className="confirm-round">第 {p.round} 轮</span>
          <span className="badge badge-accent">{c.extracted_by === 'macro' ? '宏录入 · 不走LLM' : 'AI 抽取' + (c.meta?.mode ? ' · ' + c.meta.mode : '')}</span>
        </div>
        <p className="confirm-raw">事件原文：{c.event.raw_text}</p>
        {c.warnings && c.warnings.length > 0 && (
          <div className="confirm-warn"><IconAlert size={14} /> {c.warnings.join('；')}</div>
        )}
        {p.reshown && (
          <div className="confirm-re">检测到修改，已重显第 {p.round} 轮——请复核全部字段后再确认入库。</div>
        )}
        {p.error && <div className="sheet-error">{p.error}</div>}

        <div className="confirm-sec">
          <p className="sec-title">事件（第 {c.event.day} 天 · {PHASE_LABEL[c.event.phase]}）</p>
          <div className="ev-grid">
            <span className="field field-seat">
              <span className="field-label">行为人 <em>高险</em></span>
              <SeatField
                label="行为人" seat={c.event.actor_seat} ctx={p.ctx}
                hint={p.seatName(c.event.actor_seat)}
                onCommit={(s) => p.onApply((x) => withActor(x, s))}
              />
            </span>
            <span className="field">
              <span className="field-label">天数</span>
              <input type="number" inputMode="numeric" min={1} value={c.event.day}
                aria-label="天数"
                onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) p.onApply((x) => withEventHead(x, { day: n })); }} />
            </span>
            <span className="field">
              <span className="field-label">时段</span>
              <select value={c.event.phase} aria-label="时段"
                onChange={(e) => p.onApply((x) => withEventHead(x, { phase: e.target.value as typeof x.event.phase }))}>
                {PHASES.map((ph) => <option key={ph} value={ph}>{PHASE_LABEL[ph]}</option>)}
              </select>
            </span>
            <span className="field">
              <span className="field-label">类型</span>
              <input readOnly value={c.event.type} aria-label="事件类型" />
            </span>
          </div>
        </div>

        <div className="confirm-sec">
          <p className="sec-title">声称 {c.claims.length} 条（{p.botcScript != null ? '谓词/对象/席位可键控修正' : '对象席位可键控修正'}）</p>
          {c.claims.length === 0 && <p className="muted">（无声称）</p>}
          {c.claims.map((cl, i) => (
            <div className="claim-card" key={i}>
              <div className="claim-line">
                {p.botcScript == null ? (
                  <>
                    <span className="badge badge-accent">{cl.predicate}</span>
                    <span className="obj-text">「{cl.object}」</span>
                  </>
                ) : (
                  <>
                    <span className={'badge ' + (BOTC_PREDICATES.includes(cl.predicate as BotcPredicate) ? 'badge-warn' : 'badge-accent')}>
                      {PRED_LABEL[cl.predicate as AnyPredicate] ?? cl.predicate}
                    </span>
                    {ROLE_PREDICATES.includes(cl.predicate as AnyPredicate) && (
                      <span className="obj-text">「{botcRoleDisplay(cl.object)}」</span>
                    )}
                  </>
                )}
              </div>
              {p.botcScript != null && (
                <div className="claim-edit">
                  <label className="field">
                    <span className="field-label">谓词 <em>BOTC 专属：阵营/状态</em></span>
                    <select value={cl.predicate} aria-label={'谓词（第' + (i + 1) + '条）'}
                      onChange={(e) => p.onApply((x) => withClaimPredicate(x, i, e.target.value as AnyPredicate))}>
                      {ALL_PREDICATES.map((pd) => <option key={pd} value={pd}>{PRED_LABEL[pd]}</option>)}
                    </select>
                  </label>
                  {ROLE_PREDICATES.includes(cl.predicate as AnyPredicate) ? (
                    <label className="field">
                      <span className="field-label">角色 <em>中/英文名，入账时按本剧本校验归一</em></span>
                      <input value={cl.object ?? ''} list="botc-roles-dl" placeholder="如：洗衣妇"
                        aria-label={'角色（第' + (i + 1) + '条）'}
                        onChange={(e) => p.onApply((x) => withClaimObject(x, i, e.target.value))} />
                    </label>
                  ) : BOTC_PREDICATES.includes(cl.predicate as BotcPredicate) ? (
                    <label className="field">
                      <span className="field-label">备注 <em>阵营/状态声称无对象，可空</em></span>
                      <input value={cl.object ?? ''} placeholder="备注（可空）"
                        aria-label={'备注（第' + (i + 1) + '条）'}
                        onChange={(e) => p.onApply((x) => withClaimObject(x, i, e.target.value))} />
                    </label>
                  ) : (
                    <label className="field">
                      <span className="field-label">内容</span>
                      <input value={cl.object ?? ''} aria-label={'内容（第' + (i + 1) + '条）'}
                        onChange={(e) => p.onApply((x) => withClaimObject(x, i, e.target.value))} />
                    </label>
                  )}
                </div>
              )}
              <div className="seat-field">
                <SeatField
                  label={'对象（第' + (i + 1) + '条）'} seat={cl.subject_seat ?? null} ctx={p.ctx}
                  hint={p.seatName(cl.subject_seat ?? null)}
                  onCommit={(s) => p.onApply((x) => withClaimSubject(x, i, s))}
                />
              </div>
            </div>
          ))}

          {p.botcScript != null && (
            <datalist id="botc-roles-dl">
              {rolesByScript(p.botcScript).map((r) => (
                <option key={r.id} value={r.name_zh || r.name_en} />
              ))}
            </datalist>
          )}
        </div>

        <div className="confirm-sec">
          <p className="sec-title">行动 {c.actions.length} 条</p>
          {c.actions.length === 0 && <p className="muted">（无行动）</p>}
          {c.actions.map((a, i) => (
            <div className="action-card" key={i}>
              <div className="claim-line"><span className="badge badge-accent">{a.action}</span>{a.result ? <span className="muted">{a.result}</span> : null}</div>
              <SeatField label="行动人" seat={a.seat} ctx={p.ctx} hint={p.seatName(a.seat)}
                onCommit={(s) => p.onApply((x) => withActionSeat(x, i, { seat: s }))} />
              <SeatField label="行动目标" seat={a.target_seat ?? null} ctx={p.ctx} hint={p.seatName(a.target_seat ?? null)}
                onCommit={(s) => p.onApply((x) => withActionSeat(x, i, { target_seat: s }))} />
            </div>
          ))}
        </div>

        <div className="confirm-foot">
          <button className="btn" onClick={p.onCancel} disabled={p.busy}>放弃</button>
          <button className="btn btn-primary" onClick={p.onConfirm} disabled={p.busy}>
            {p.reshown ? '复核无误，确认入账' : '确认入账'}
          </button>
        </div>
      </div>
    </div>
  );
}
