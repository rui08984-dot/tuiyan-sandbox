/**
 * TopBar —— 录入页顶部条：局名 + 第 N 天步进器 + 当前存活名单横条。
 * 附带选局/新建局抽屉（对局管理完整版归 P1b-4，这里只做录入页自足的最小建/选）。
 * 存活判定：players 减去 state.events 里 type='death' 的 actor_seat（契约：death 事件填死者座位）。
 */
import { useState } from 'react';
import type { BotcScript, Game, GameType } from '../../types';
import { SCRIPT_LABEL } from '../../botc/roles';
import { useGameTypes } from '../../lib/useGameTypes';

export interface RosterChip { seat: number; name: string; alive: boolean }

interface TopBarProps {
  games: Game[];
  game: Game | null;
  day: number;
  maxDay: number; // = max(1, game.current_day)
  roster: RosterChip[];
  busy: boolean;
  onDay: (n: number) => void;
  onSwitch: (id: number) => void;
  onCreate?: (input: { name: string; type: GameType; player_count: number; script?: BotcScript }) => void;
  /** B6：天结算（现场页内联；缺省不显示按钮） */
  onSettle?: () => void;
  /** B6：天结算任务在跑（按钮禁用 + 生成中角标） */
  settling?: boolean;
  /** B6：开新局分步引导（提供即替换 GameSheet 内联迷你表单为主 CTA） */
  onWizard?: () => void;
}

export default function TopBar(p: TopBarProps) {
  const { label: typeLabel } = useGameTypes(); // 类型名后端驱动（失败回落内置三型）
  const [open, setOpen] = useState(false);
  const alive = p.roster.filter((r) => r.alive).length;
  const upper = Math.max(1, p.maxDay) + 1; // 允许预录下一天
  return (
    <div className="topbar">
      <div className="topbar-row">
        <span className="topbar-name">{p.game ? p.game.name : '未选局'}</span>
        <span className="topbar-meta">{p.game ? typeLabel(p.game.type) + ' · ' + p.game.player_count + '人' : ''}</span>
        <button className="btn" style={{ minHeight: 38 }} onClick={() => setOpen(true)}>切换/建局</button>
      </div>
      <div className="topbar-row" style={{ marginTop: 8 }}>
        <span className="day-stepper">
          <button className="btn" aria-label="前一天" disabled={p.day <= 1 || p.busy}
            onClick={() => p.onDay(Math.max(1, p.day - 1))}>−</button>
          <span className="day-num">第 {p.day} 天</span>
          <button className="btn" aria-label="后一天" disabled={p.day >= upper || p.busy}
            onClick={() => p.onDay(Math.min(upper, p.day + 1))}>＋</button>
        </span>
        <span className="topbar-meta">存活 {alive}/{p.roster.length}</span>
        {p.onSettle && (
          <button className="btn btn-primary" style={{ minHeight: 38 }} disabled={p.busy || p.settling}
            onClick={p.onSettle}>
            {p.settling ? '生成中…' : '⚡ 天结算'}
          </button>
        )}
        {p.settling && <span className="adv-badge"><span className="spinner" aria-hidden></span>生成中</span>}
      </div>
      <div className="roster">
        {p.roster.map((r) => (
          <span key={r.seat} className={'roster-chip' + (r.alive ? '' : ' is-dead')}>
            {r.seat}号·{r.name}
          </span>
        ))}
        {p.roster.length === 0 && <span className="topbar-meta">（无席位）</span>}
      </div>
      {open && (
        <GameSheet
          games={p.games} currentId={p.game?.id ?? null} busy={p.busy}
          onPick={(id) => { p.onSwitch(id); setOpen(false); }}
          onCreate={(input) => { p.onCreate?.(input); setOpen(false); }}
          onWizard={p.onWizard
            ? () => { const wz = p.onWizard; setOpen(false); if (wz) wz(); }
            : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function GameSheet(props: {
  games: Game[]; currentId: number | null; busy: boolean;
  onPick: (id: number) => void; onCreate: (i: { name: string; type: string; player_count: number; script?: BotcScript }) => void;
  onWizard?: () => void;
  onClose: () => void;
}) {
  const { types: gameTypes, label: typeLabel } = useGameTypes(); // 类型表后端驱动（失败回落内置三型）
  const [q, setQ] = useState('');
  const shown = props.games.filter((g) => g.name.includes(q.trim()) || String(g.id).includes(q.trim()));
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('werewolf');
  const [count, setCount] = useState(8);
  const [script, setScript] = useState<BotcScript>('tb'); // B4：botc 局剧本（仅 type=botc 时随局提交）
  const [err, setErr] = useState<string | null>(null);
  function create() {
    if (name.trim() === '') { setErr('局名不能为空'); return; }
    if (!Number.isInteger(count) || count < 1 || count > 99) { setErr('人数需 1-99'); return; }
    setErr(null);
    props.onCreate(type === 'botc'
      ? { name: name.trim(), type, player_count: count, script }
      : { name: name.trim(), type, player_count: count }); // werewolf 局不带 script
  }
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="切换或新建对局">
      <div className="sheet">
        <div className="sheet-head">
          <h2>选局 / 新建局</h2>
          <button className="btn btn-ghost" onClick={props.onClose} aria-label="关闭">✕</button>
        </div>
        {props.games.length === 0 && <p className="muted">（暂无对局，先新建一局）</p>}
        {props.onWizard && (
          <button type="button" className="btn btn-primary sheet-cta" disabled={props.busy} onClick={props.onWizard}>
            ＋ 开新局（分步引导）
          </button>
        )}
        {props.games.length > 0 && (
          <label className="field sheet-search">
            <span className="field-label">搜索历史局（局名 / #id）</span>
            <input value={q} placeholder="如：周五 或 #3" onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        <div className="form-grid">
          {shown.map((g) => (
            <button key={g.id} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              disabled={props.busy} onClick={() => props.onPick(g.id)}>
              #{g.id} {g.name}（{typeLabel(g.type)} {g.player_count}人 · 第{g.current_day ?? 0}天 · {g.event_count ?? 0}事件）
            </button>
          ))}
          {!props.onWizard && (
          <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', width: '100%' }} />
          <label className="field">
            <span className="field-label">新局名</span>
            <input value={name} placeholder="如：周五晚狼人杀" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">类型</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {gameTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">人数（自动建席 1..N）</span>
            <input type="number" inputMode="numeric" min={1} max={99} value={count}
              onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          {type === 'botc' && (
            <label className="field">
              <span className="field-label">剧本 <em>BOTC 三本；角色/阵营声称按剧本校验</em></span>
              <select value={script} onChange={(e) => setScript(e.target.value as BotcScript)}>
                {(Object.keys(SCRIPT_LABEL) as BotcScript[]).map((s) => (
                  <option key={s} value={s}>{SCRIPT_LABEL[s]}</option>
                ))}
              </select>
            </label>
          )}
          </>
          )}
        </div>
        {err && <div className="sheet-error">{err}</div>}
        <div className="sheet-actions">
          <button className="btn" onClick={props.onClose} disabled={props.busy}>取消</button>
          {!props.onWizard && (
            <button className="btn btn-primary" onClick={create} disabled={props.busy}>新建局</button>
          )}
        </div>
      </div>
    </div>
  );
}