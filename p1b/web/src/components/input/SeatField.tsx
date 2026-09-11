/**
 * SeatField —— 高险字段（席位）键控控件（对齐 p1a-terminal confirmSeat 规则：
 * 合法整数且在名单内才提交；非法拒绝并提示，卡片值不变）。
 * 即时提交合法值：确认卡永远显示已提交值，无「草稿未入卡」的歧义。
 */
import { useEffect, useState } from 'react';
import { seatError, type SeatCtx } from './confirm-flow';

interface SeatFieldProps {
  label: string;
  seat: number | null;
  ctx: SeatCtx;
  /** 该席位当前名单昵称（如「5号·张三」），无则不显示 */
  hint?: string;
  onCommit: (seat: number) => void;
}

export default function SeatField({ label, seat, ctx, hint, onCommit }: SeatFieldProps) {
  const [draft, setDraft] = useState(seat == null ? '' : String(seat));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seat == null ? '' : String(seat));
    setErr(null);
  }, [seat]);

  function handle(v: string) {
    setDraft(v);
    const t = v.trim();
    if (t === '') { setErr('不能为空'); return; }
    const n = Number(t);
    const bad = seatError(n, ctx);
    if (bad) { setErr(bad); return; }
    setErr(null);
    if (n !== seat) onCommit(n); // 只在真变化时提交 → 触发 YD5 重显
  }

  return (
    <span className="seat-field">
      <label>{label}</label>
      <input
        type="number" inputMode="numeric" min={1} max={ctx.maxSeat}
        value={draft} aria-label={label}
        onChange={(e) => handle(e.target.value)}
        onBlur={() => { if (err !== null) { setDraft(seat == null ? '' : String(seat)); setErr(null); } }}
      />
      {hint && <span className="seat-name">{hint}</span>}
      {err && <span className="field-error">{err}</span>}
    </span>
  );
}
