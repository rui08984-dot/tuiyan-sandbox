/**
 * 误差须 / 森林图（2026-09-22 全方面重构）
 *
 * 用途：分层 Brier 的 CI 须、分域格 Δ 的森林图（含 0 值阈值虚线）。
 * ★ 纪律：区间任一端缺失 ⇒ **不画须、保留空态文字**（n<30 不出 CI），
 *   绝不把 null 当 0 或把须画成 0 长度——那会谎称「区间极窄」。
 */
import { norm } from './scale';

export function ErrorBar({
  value,
  ciLo,
  ciHi,
  lo,
  hi,
  threshold,
  thresholdLabel,
  label,
  width = 240,
  testId,
}: {
  value: number | null | undefined;
  ciLo?: number | null;
  ciHi?: number | null;
  lo: number;
  hi: number;
  threshold?: number;
  thresholdLabel?: string;
  label?: React.ReactNode;
  width?: number;
  testId?: string;
}) {
  const pad = 10;
  const w = width;
  const h = 26;
  const tv = norm(value, lo, hi);
  const hasCi = ciLo !== null && ciLo !== undefined && ciHi !== null && ciHi !== undefined
    && Number.isFinite(ciLo) && Number.isFinite(ciHi);
  const tl = hasCi ? norm(ciLo as number, lo, hi) : null;
  const th = hasCi ? norm(ciHi as number, lo, hi) : null;
  const tt = threshold === undefined ? null : norm(threshold, lo, hi);

  const x = (t: number) => pad + t * (w - pad * 2);

  return (
    <div className="errbar" data-testid={testId}>
      {label ? <span className="errbar-label">{label}</span> : null}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
        aria-label={`${label ?? ''} ${value ?? '样本不足'}${hasCi ? ` 区间 ${ciLo} 至 ${ciHi}` : ' n<30 不出 CI'}`}>
        {/* 轴 */}
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="var(--chart-axis)" strokeWidth="1" />
        {/* 阈值虚线 */}
        {tt !== null ? (
          <line x1={x(tt)} y1={2} x2={x(tt)} y2={h - 2} stroke="var(--chart-threshold)" strokeWidth="1.5" strokeDasharray="3 3" />
        ) : null}
        {/* CI 须 */}
        {hasCi && tl !== null && th !== null ? (
          <line x1={x(tl)} y1={h / 2} x2={x(th)} y2={h / 2} stroke="var(--accent)" strokeWidth="2" />
        ) : null}
        {/* 端点帽 */}
        {hasCi && tl !== null && th !== null ? (
          <>
            <line x1={x(tl)} y1={h / 2 - 4} x2={x(tl)} y2={h / 2 + 4} stroke="var(--accent)" strokeWidth="2" />
            <line x1={x(th)} y1={h / 2 - 4} x2={x(th)} y2={h / 2 + 4} stroke="var(--accent)" strokeWidth="2" />
          </>
        ) : null}
        {/* 点估计 */}
        {tv !== null ? (
          <circle cx={x(tv)} cy={h / 2} r={4} fill="var(--text)" stroke="var(--panel)" strokeWidth="1" />
        ) : null}
      </svg>
      <span className="errbar-value u-mono">
        {tv === null ? '样本不足' : value!.toFixed(4)}
        {hasCi ? ` [${(ciLo as number).toFixed(3)}, ${(ciHi as number).toFixed(3)}]` : ' n<30 不出 CI'}
      </span>
      {tt !== null && thresholdLabel ? <span className="errbar-thr">{thresholdLabel}</span> : null}
    </div>
  );
}

/** 森林图：多行误差须共享一条 0 阈值线 */
export function ForestPlot({
  rows,
  threshold = 0,
  thresholdLabel = '0 无差异线',
  width = 260,
  testId,
}: {
  rows: {
    label: React.ReactNode;
    value: number | null | undefined;
    ciLo?: number | null;
    ciHi?: number | null;
  }[];
  threshold?: number;
  thresholdLabel?: string;
  width?: number;
  testId?: string;
}) {
  // 共享横轴：由全部点（含 CI 端）推定，保证各行可比
  const nums: number[] = [];
  for (const r of rows) {
    if (typeof r.value === 'number' && Number.isFinite(r.value)) nums.push(r.value);
    if (typeof r.ciLo === 'number' && Number.isFinite(r.ciLo)) nums.push(r.ciLo);
    if (typeof r.ciHi === 'number' && Number.isFinite(r.ciHi)) nums.push(r.ciHi);
  }
  if (threshold !== undefined) nums.push(threshold);
  const rawLo = nums.length ? Math.min(...nums) : -1;
  const rawHi = nums.length ? Math.max(...nums) : 1;
  const pad = (rawHi - rawLo) * 0.12 || 0.1;
  const lo = rawLo - pad;
  const hi = rawHi + pad;

  return (
    <div className="forest" data-testid={testId}>
      {rows.map((r, i) => (
        <ErrorBar
          key={i}
          label={r.label}
          value={r.value}
          ciLo={r.ciLo}
          ciHi={r.ciHi}
          lo={lo}
          hi={hi}
          threshold={threshold}
          thresholdLabel={i === 0 ? thresholdLabel : undefined}
          width={width}
        />
      ))}
    </div>
  );
}
