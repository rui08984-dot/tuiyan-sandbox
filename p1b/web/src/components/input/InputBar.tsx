/**
 * InputBar —— 常驻输入条（吸附内容底部、Tab 栏之上）：
 * 时段 chips + 自由文本 textarea + 发送（AI 拆解）+ 3 宏大按钮（触控区 ≥44px）。
 */
import type { EventPhase } from '../../types';
import { MACRO_KINDS, MACRO_LABEL, PHASES, PHASE_LABEL } from './confirm-flow';

interface InputBarProps {
  text: string;
  phase: EventPhase;
  busy: boolean;
  hasGame: boolean;
  onText: (t: string) => void;
  onPhase: (p: EventPhase) => void;
  onSend: () => void;
  onMacro: (k: (typeof MACRO_KINDS)[number]) => void;
}

const MACRO_SUB: Record<string, string> = {
  claim_role: '席位+角色', check: '席位→对象', good: '席位→对象',
};

export default function InputBar(p: InputBarProps) {
  return (
    <div className="input-bar">
      <div className="phase-row" role="radiogroup" aria-label="时段">
        {PHASES.map((ph) => (
          <button
            key={ph} type="button"
            className={'chip' + (p.phase === ph ? ' chip-on' : '')}
            style={p.phase === ph ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => p.onPhase(ph)}
            aria-pressed={p.phase === ph}
          >
            {PHASE_LABEL[ph]}
          </button>
        ))}
      </div>
      <div className="macro-row">
        {MACRO_KINDS.map((k) => (
          <button key={k} type="button" className="btn macro-btn" disabled={!p.hasGame || p.busy}
            onClick={() => p.onMacro(k)}>
            {MACRO_LABEL[k]}
            <small>{MACRO_SUB[k]}</small>
          </button>
        ))}
      </div>
      <div className="input-main">
        <textarea
          value={p.text}
          rows={2}
          placeholder={p.hasGame ? '自由文本记录，如：3号说自己是预言家，说5号是查杀' : '先选择或新建一局'}
          disabled={!p.hasGame || p.busy}
          onChange={(e) => p.onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); p.onSend(); }
          }}
        />
        <button type="button" className="btn btn-primary input-send" disabled={!p.hasGame || p.busy || p.text.trim() === ''}
          onClick={p.onSend}>
          {p.busy ? '…' : 'AI 拆解'}
        </button>
      </div>
    </div>
  );
}
