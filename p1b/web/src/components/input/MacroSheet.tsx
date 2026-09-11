/**
 * MacroSheet —— 3 宏小表单（底部弹层）：跳身份/查杀/金水。
 * 只做校验与收集；结构化构造在 confirm-flow.buildMacroCard（§4 不走 LLM），
 * 提交后仍出确认卡复核（与自由文本同一入库路径）。
 */
import { useState } from 'react';
import type { BotcScript, EventPhase, Player } from '../../types';
import { rolesByScript } from '../../botc/roles';
import { MACRO_LABEL, type MacroInput, type MacroKind } from './confirm-flow';

const ROLE_SUGGEST = ['预言家', '女巫', '猎人', '守卫', '预言家+守卫', '村民'];

interface MacroSheetProps {
  kind: MacroKind;
  day: number;
  phase: EventPhase;
  players: Player[];
  /** B4：botc 局挂的剧本（角色建议换成本剧本角色名单）；null = werewolf 建议零变化 */
  botcScript: BotcScript | null;
  busy: boolean;
  error: string | null;
  onSubmit: (input: MacroInput) => void;
  onClose: () => void;
}

export default function MacroSheet(p: MacroSheetProps) {
  const [seat, setSeat] = useState(p.players[0]?.seat ?? 1);
  const [role, setRole] = useState('');
  const [target, setTarget] = useState(p.players[1]?.seat ?? p.players[0]?.seat ?? 1);
  const [err, setErr] = useState<string | null>(null);
  const needRole = p.kind === 'claim_role';
  const needTarget = p.kind !== 'claim_role';
  // B4：botc 局跳身份 → 角色建议来自本剧本（中文名，后端入账时归一为角色 id）；werewolf 沿用原建议
  const roleSuggest = p.botcScript
    ? rolesByScript(p.botcScript).map((r) => r.name_zh || r.name_en)
    : ROLE_SUGGEST;

  function submit() {
    if (!Number.isInteger(seat) || seat < 1) { setErr('请选择席位'); return; }
    if (needRole && role.trim() === '') { setErr('角色不能为空'); return; }
    if (needTarget && target === seat) { setErr('查杀/金水的对象不能是自己'); return; }
    setErr(null);
    p.onSubmit({ kind: p.kind, seat, role: role.trim(), target_seat: target, day: p.day, phase: p.phase });
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={MACRO_LABEL[p.kind]}>
      <div className="sheet">
        <div className="sheet-head">
          <h2>{MACRO_LABEL[p.kind]} · 宏录入</h2>
          <button className="btn btn-ghost" onClick={p.onClose} aria-label="关闭">✕</button>
        </div>
        <p className="muted" style={{ margin: '0 0 4px', fontSize: 13 }}>
          第 {p.day} 天 · {p.phase === 'day' ? '白天' : p.phase === 'night' ? '夜晚' : '黄昏'} · 确定后仍出确认卡复核
        </p>
        {(p.error ?? err) && <div className="sheet-error">{p.error ?? err}</div>}
        <div className="form-grid">
          <label className="field">
            <span className="field-label">席位（谁说/谁验）</span>
            <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
              {p.players.map((pl) => <option key={pl.seat} value={pl.seat}>{pl.seat}号 · {pl.name}</option>)}
            </select>
          </label>
          {needRole && (
            <label className="field">
              <span className="field-label">声称角色</span>
              <input value={role} list="role-suggest" placeholder="如：预言家"
                onChange={(e) => setRole(e.target.value)} />
              <datalist id="role-suggest">
                {roleSuggest.map((r) => <option key={r} value={r} />)}
              </datalist>
            </label>
          )}
          {needTarget && (
            <label className="field">
              <span className="field-label">对象席位</span>
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {p.players.filter((pl) => pl.seat !== seat).map((pl) => (
                  <option key={pl.seat} value={pl.seat}>{pl.seat}号 · {pl.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={p.onClose} disabled={p.busy}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={p.busy}>出确认卡</button>
        </div>
      </div>
    </div>
  );
}
