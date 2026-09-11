/** NewGameWizard —— 开新局分步引导流（B6）：①局名/类型/剧本[botc]/人数 → ②席位名单 → 创建直达现场。 */
import { useState } from 'react';
import * as api from '../api';
import type { BotcScript, Game, GameType, Player } from '../types';
import { defaultSeatName, setSeatName } from '../lib/seatNames';
import { Step1Form, Step2Form } from './NewGameWizardSteps';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function NewGameWizard(props: {
  onClose: () => void;
  onCreated: (game: Game, players?: Player[]) => void | Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [type, setType] = useState<GameType>('werewolf');
  const [script, setScript] = useState<BotcScript>('tb');
  const [count, setCount] = useState(8);
  const [names, setNames] = useState<string[]>(() => Array.from({ length: 8 }, (_, i) => defaultSeatName(i + 1)));
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function applyCount(n: number) {
    const c = Math.max(1, Math.min(99, Number.isFinite(n) ? Math.floor(n) : 1));
    setCount(c);
    setNames((prev) => Array.from({ length: c }, (_, i) => prev[i] ?? defaultSeatName(i + 1)));
  }

  function next() {
    if (name.trim() === '') { setErr('局名不能为空'); return; }
    setErr(null);
    setStep(2);
  }

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const seat_names = names.map((n, i) => {
        const t = (n ?? '').trim();
        return t === '' ? defaultSeatName(i + 1) : t;
      });
      const r = await api.createGame({
        name: name.trim(), type, player_count: count, seat_names,
        ...(type === 'botc' ? { script } : {}), // B2 后端：werewolf 局不带 script
      });
      // POST 自动建席「N号」→ 真名经 PUT /seats 落服务端；overlay 仅离线镜像
      const renames = seat_names.map((n, i) => ({ seat: i + 1, name: n })).filter((s) => s.name !== defaultSeatName(s.seat));
      if (renames.length > 0) {
        try {
          await api.saveSeats(r.game.id, renames);
          for (const s of renames) setSeatName(r.game.id, s.seat, s.name);
        } catch (se) {
          setErr('局 #' + r.game.id + ' 已创建，但真名保存失败：' + errMsg(se) + '（可稍后在管理页重改）');
          setSubmitting(false);
          await props.onCreated(r.game, r.players);
          return;
        }
      }
      await props.onCreated(r.game, r.players);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="开新局引导">
      <div className="sheet">
        <div className="sheet-head">
          <h2>开新局</h2>
          <button type="button" className="btn btn-ghost" onClick={props.onClose} aria-label="关闭">✕</button>
        </div>
        <div className="wiz-steps" aria-label="步骤">
          <span className={'wiz-step' + (step === 1 ? ' is-on' : '')}>① 局名 · 类型 · 人数</span>
          <span className={'wiz-step' + (step === 2 ? ' is-on' : '')}>② 席位名单</span>
        </div>
        {step === 1 ? (
          <Step1Form name={name} setName={setName} type={type} setType={setType}
            script={script} setScript={setScript} count={count} applyCount={applyCount} />
        ) : (
          <Step2Form names={names} setNames={setNames} />
        )}
        {err && <div className="sheet-error">{err}</div>}
        <div className="sheet-actions">
          {step === 1 ? (
            <>
              <button type="button" className="btn" onClick={props.onClose} disabled={submitting}>取消</button>
              <button type="button" className="btn btn-primary" onClick={next} disabled={submitting}>下一步</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setStep(1)} disabled={submitting}>上一步</button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>
                {submitting ? '创建中…' : '创建局并进入现场'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}