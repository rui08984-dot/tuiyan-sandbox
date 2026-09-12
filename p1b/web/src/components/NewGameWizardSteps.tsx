/** NewGameWizardSteps —— 开新局引导流两步表单（B6，纯受控件）。 */
import type { BotcScript } from '../types';
import { FALLBACK_TYPES } from '../lib/adapters';
import type { GameTypeOption } from '../lib/adapters';
import { SCRIPT_LABEL } from '../botc/roles';
import { defaultSeatName } from '../lib/seatNames';

export function Step1Form(p: {
  name: string; setName: (v: string) => void;
  type: string; setType: (v: string) => void;
  script: BotcScript; setScript: (v: BotcScript) => void;
  count: number; applyCount: (n: number) => void;
  /** 游戏类型选项（后端驱动 /api/adapters）；缺省走内置回落，单独渲染不炸 */
  types?: GameTypeOption[];
}) {
  const types = p.types ?? FALLBACK_TYPES;
  return (
    <div className="form-grid">
      <label className="field">
        <span className="field-label">局名</span>
        <input value={p.name} placeholder="如：周五晚狼人杀" onChange={(e) => p.setName(e.target.value)} />
      </label>
      <div className="row2">
        <label className="field">
          <span className="field-label">类型</span>
          <select value={p.type} onChange={(e) => p.setType(e.target.value)}>
            {types.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">人数（自动建席 1..N）</span>
          <input type="number" inputMode="numeric" min={1} max={99} value={p.count}
            onChange={(e) => p.applyCount(Number(e.target.value))} />
        </label>
      </div>
      {p.type === 'botc' && (
        <label className="field">
          <span className="field-label">剧本 <em>BOTC 三本；角色/阵营声称按剧本校验</em></span>
          <select value={p.script} onChange={(e) => p.setScript(e.target.value as BotcScript)}>
            {(Object.keys(SCRIPT_LABEL) as BotcScript[]).map((s) => (<option key={s} value={s}>{SCRIPT_LABEL[s]}</option>))}
          </select>
        </label>
      )}
    </div>
  );
}

export function Step2Form(p: {
  names: string[];
  setNames: (updater: (prev: string[]) => string[]) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">座位名单 <em>默认「N号」，可改真名；创建后直达现场</em></span>
      <div className="seat-list sheet-seats">
        {p.names.map((n, i) => (
          <div className="seat-row" key={i}>
            <span className="seat-badge">{i + 1}号</span>
            <input value={n} placeholder={defaultSeatName(i + 1)} aria-label={(i + 1) + '号真名'}
              onChange={(e) => p.setNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        ))}
      </div>
    </div>
  );
}
