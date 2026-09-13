/**
 * EditSheet —— 已入账 claim / action 的修订抽屉（账本纪律：事件原文不可改，只改结构化字段；
 * retracted 行后端 409，前端不提供入口）。
 */
import { useState } from 'react';
import type { AnyPredicate, BotcScript, Claim, GameAction } from '../../types';
import { botcRoleDisplay, rolesByScript } from '../../botc/roles';
import { ALL_PREDICATES, PRED_LABEL, ROLE_PREDICATES } from './confirm-flow';
import { IconClose } from '../ui';

/** werewolf 局谓词全集（通用 7 枚举，原样保留） */
const PREDICATES: AnyPredicate[] = ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'];

interface EditSheetProps {
  target: { kind: 'claim'; row: Claim } | { kind: 'action'; row: GameAction };
  seats: number[];
  /** B4：botc 局挂的剧本（谓词全集扩 BOTC 专属 4 + 角色名建议）；null = werewolf 原样 */
  botcScript: BotcScript | null;
  busy: boolean;
  error: string | null;
  onSubmit: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}

export default function EditSheet(p: EditSheetProps) {
  const isClaim = p.target.kind === 'claim';
  const c = isClaim ? p.target.row as Claim : null;
  const a = !isClaim ? p.target.row as GameAction : null;
  const [subject, setSubject] = useState(c?.subject_seat ?? 0);
  const [pred, setPred] = useState<AnyPredicate>((c?.predicate ?? 'said') as AnyPredicate);
  const [object, setObject] = useState(c?.object ?? '');
  const [targetSeat, setTargetSeat] = useState(a?.target_seat ?? 0);
  const [result, setResult] = useState(a?.result ?? '');
  const [err, setErr] = useState<string | null>(null);
  // B4：botc 局谓词全集 = 通用 7 + BOTC 专属 4；werewolf 局仍只用通用 7
  const predOptions: AnyPredicate[] = p.botcScript != null ? ALL_PREDICATES : PREDICATES;
  const isRolePred = ROLE_PREDICATES.includes(pred);

  function submit() {
    if (isClaim && c) {
      if (object.trim() === '') { setErr('内容不能为空'); return; }
      setErr(null);
      p.onSubmit({ subject_seat: subject, predicate: pred, object: object.trim() });
    } else if (a) {
      if (!Number.isInteger(targetSeat) || targetSeat < 1) { setErr('目标席位必须是名单内整数'); return; }
      setErr(null);
      p.onSubmit({ target_seat: targetSeat, result: result.trim() });
    }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="修订">
      <div className="sheet">
        <div className="sheet-head">
          <h2>{isClaim ? '修订声称 c' + c!.id : '修订行动 a' + a!.id}</h2>
          <button className="btn btn-ghost" onClick={p.onClose} aria-label="关闭"><IconClose size={16} /></button>
        </div>
        {(p.error ?? err) && <div className="sheet-error">{p.error ?? err}</div>}
        <div className="form-grid">
          {isClaim && c && (
            <>
              <label className="field">
                <span className="field-label">对象席位</span>
                <select value={subject} onChange={(e) => setSubject(Number(e.target.value))}>
                  {p.seats.map((s) => <option key={s} value={s}>{s}号</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">谓词{p.botcScript != null ? '（BOTC 局含阵营/状态）' : ''}</span>
                <select value={pred} onChange={(e) => setPred(e.target.value as AnyPredicate)}>
                  {predOptions.map((x) => <option key={x} value={x}>{PRED_LABEL[x]}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">内容{isRolePred && p.botcScript != null ? '（角色名，中/英）' : ''}</span>
                <input
                  value={object}
                  list={isRolePred && p.botcScript != null ? 'edit-botc-roles-dl' : undefined}
                  onChange={(e) => setObject(e.target.value)}
                />
                {isRolePred && p.botcScript != null && (
                  <>
                    <datalist id="edit-botc-roles-dl">
                      {rolesByScript(p.botcScript).map((r) => (
                        <option key={r.id} value={r.name_zh || r.name_en} />
                      ))}
                    </datalist>
                    {object.trim() !== '' && (
                      <span className="muted" style={{ fontSize: 12.5 }}>当前展示：{botcRoleDisplay(object)}</span>
                    )}
                  </>
                )}
              </label>
            </>
          )}
          {!isClaim && a && (
            <>
              <label className="field">
                <span className="field-label">目标席位</span>
                <select value={targetSeat} onChange={(e) => setTargetSeat(Number(e.target.value))}>
                  {p.seats.map((s) => <option key={s} value={s}>{s}号</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">结果说明（可空）</span>
                <input value={result} onChange={(e) => setResult(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={p.onClose} disabled={p.busy}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={p.busy}>提交修订</button>
        </div>
      </div>
    </div>
  );
}
