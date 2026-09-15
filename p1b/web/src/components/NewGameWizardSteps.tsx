/** NewGameWizardSteps —— 开新局引导流两步表单（B6，纯受控件）。
 *  2026-09-15 交互改造：① 常用人数快捷键 ② 局名实时校验（不等点下一步）
 *  ③ 席位实时预览＋批量粘贴 ④ 剧本/类型即时说明（治反直觉）。
 */
import type { BotcScript } from '../types';
import { FALLBACK_TYPES } from '../lib/adapters';
import type { GameTypeOption } from '../lib/adapters';
import { SCRIPT_LABEL } from '../botc/roles';
import { defaultSeatName } from '../lib/seatNames';

/** 常用人数快捷键（线下局高频档位；仍可手输 1-99） */
const QUICK_COUNTS = [6, 8, 9, 12];

export function Step1Form(p: {
  name: string; setName: (v: string) => void;
  type: string; setType: (v: string) => void;
  script: BotcScript; setScript: (v: BotcScript) => void;
  count: number; applyCount: (n: number) => void;
  /** 游戏类型选项（后端驱动 /api/adapters）；缺省走内置回落，单独渲染不炸 */
  types?: GameTypeOption[];
}) {
  const types = p.types ?? FALLBACK_TYPES;
  const nameEmpty = p.name.trim() === '';
  const cur = types.find((t) => t.id === p.type);

  return (
    <div className="form-grid">
      <label className="field">
        <span className="field-label">局名</span>
        <input value={p.name} placeholder="如：周五晚狼人杀" onChange={(e) => p.setName(e.target.value)} />
        {/* 实时校验：边打字边提示，不等点“下一步”才报错（治反直觉） */}
        <span className={'field-hint' + (nameEmpty ? ' is-warn' : '')}>
          {nameEmpty ? '给这局起个名字，方便以后找回来' : '之后可以在管理页改'}
        </span>
      </label>

      <label className="field">
        <span className="field-label">类型</span>
        <select value={p.type} onChange={(e) => p.setType(e.target.value)}>
          {types.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
        <span className="field-hint">
          {cur ? (cur.ready ? '可直接开始记录' : '该类型尚未就绪，可能无法记录') : '决定记录哪些信息（发言／投票／技能）'}
        </span>
      </label>

      <div className="field">
        <span className="field-label">人数（会自动建好对应席位）</span>
        {/* 快捷键优先：常用档位一键到位，不用每次手输 */}
        <div className="count-quick" role="group" aria-label="常用人数">
          {QUICK_COUNTS.map((n) => (
            <button type="button" key={n}
              className={'count-chip' + (p.count === n ? ' is-on' : '')}
              aria-pressed={p.count === n}
              onClick={() => p.applyCount(n)}>{n} 人</button>
          ))}
        </div>
        <input type="number" inputMode="numeric" min={1} max={99} value={p.count}
          onChange={(e) => p.applyCount(Number(e.target.value))} />
        {/* 即时预告：选完人数立刻看到会建几个席位、叫什么（治“改完没反应”） */}
        <span className="field-hint">
          将建 {p.count} 个席位：1号{p.count > 1 ? ' … ' + p.count + '号' : ''}
        </span>
      </div>

      {p.type === 'botc' && (
        <label className="field">
          <span className="field-label">剧本</span>
          <select value={p.script} onChange={(e) => p.setScript(e.target.value as BotcScript)}>
            {(Object.keys(SCRIPT_LABEL) as BotcScript[]).map((s) => (<option key={s} value={s}>{SCRIPT_LABEL[s]}</option>))}
          </select>
          <span className="field-hint">剧本决定有哪些角色；选错会导致声称对不上</span>
        </label>
      )}
    </div>
  );
}

export function Step2Form(p: {
  names: string[];
  setNames: (updater: (prev: string[]) => string[]) => void;
}) {
  /** 已改成真名的席位数（默认「N号」不算） */
  const named = p.names.filter((n, i) => (n ?? '').trim() !== '' && (n ?? '').trim() !== defaultSeatName(i + 1)).length;

  /** 批量粘贴：一行一个名字，按当前席位数量截取/补齐 */
  function pasteMany(text: string) {
    const lines = text.split(/[\r\n,，、]+/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    p.setNames((prev) => prev.map((_, i) => lines[i] ?? defaultSeatName(i + 1)));
  }

  return (
    <div className="field">
      <span className="field-label">
        座位名单 <em>已填真名 {named}/{p.names.length}；不改就先用「N号」，进现场后还能改</em>
      </span>
      <div className="seat-list sheet-seats">
        {p.names.map((n, i) => (
          <div className="seat-row" key={i}>
            <span className="seat-badge">{i + 1}号</span>
            <input value={n} placeholder={defaultSeatName(i + 1)} aria-label={(i + 1) + '号真名'}
              onChange={(e) => p.setNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        ))}
      </div>
      <label className="field" style={{ marginTop: 8 }}>
        <span className="field-label">批量填名字（可选）</span>
        <textarea rows={2} placeholder={'一行一个，或用逗号分隔：\n张三\n李四\n王五'}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (t && /[\r\n,，、]/.test(t)) { e.preventDefault(); pasteMany(t); }
          }}
          onBlur={(e) => pasteMany(e.target.value)} />
        <span className="field-hint">粘贴后自动按顺序填入；名字比席位多则截取，少了其余留默认</span>
      </label>
    </div>
  );
}
