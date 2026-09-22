/**
 * 扇形仪表盘（2026-09-22 全方面重构）
 *
 * ★ 克制设计：只显示核心读数 + 阈值线，专业细节收进第二层
 * ★ 大字醒目，绝不溢出容器
 * ★ Accessibility C: 提供切换按钮（默认 gauge 视图，点击切换为 bar 视图）
 */
import { useState } from 'react';
import { norm, seqColor, BRIER_NOINFO } from './scale';

export function Gauge({
  value,
  lo = 0,
  hi = 1,
  label,
  unit,
  threshold,
  thresholdLabel,
  size = 140,
  missingText = '样本不足',
  testId,
}: {
  value: number | null | undefined;
  lo?: number;
  hi?: number;
  label?: string;
  unit?: string;
  threshold?: number;
  thresholdLabel?: string;
  size?: number;
  missingText?: string;
  testId?: string;
}) {
  const [asBar, setAsBar] = useState(false); // Default to gauge view for cleaner UX
  const t = norm(value, lo, hi);
  const missing = t === null;
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const CIRC = Math.PI * r;
  const stroke = 8;

  const arcColor = missing ? 'var(--chart-nodata)' : seqColor(t!);
  const thrT = threshold === undefined ? null : norm(threshold, lo, hi);
  const hasData = typeof value === 'number' && Number.isFinite(value);

  return (
    <div className="gauge" data-testid={testId}>
      {/* Toggle button (keeps gauge as default) */}
      <button
        type="button"
        className="chart-toggle chart-toggle--mini"
        aria-pressed={asBar}
        onClick={() => setAsBar(!asBar)}
        aria-label="切换为条形图"
      >
        {asBar ? '看图表' : '看条形'}
      </button>

      {/* Main visualization */}
      {asBar ? (
        /* Bar view (accessibility fallback) */
        <div className="gauge-bar">
          <div className="gauge-bar-track">
            {hasData && !missing ? (
              <>
                <div className="gauge-bar-fill" style={{ width: `${t! * 100}%` }} />
                {thrT !== null && (
                  <span className="gauge-bar-threshold" style={{ left: `${thrT * 100}%` }} />
                )}
              </>
            ) : (
              <span className="gauge-bar-empty">{missing ? '样本不足' : '—'}</span>
            )}
          </div>
          <div className="gauge-bar-scale">
            <span>{lo}</span>
            {threshold !== undefined && <span className="gauge-bar-thr-label">{thresholdLabel ?? threshold}</span>}
            <span>{hi}</span>
          </div>
        </div>
      ) : (
        /* Gauge view (default) */
        <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`} role="img"
          aria-label={`${label ?? ''} ${missing ? missingText : Number(value!).toFixed(3)}${unit ?? ''}`}>
          {/* Track background */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="var(--panel-2)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {/* Data arc */}
          {!missing && hasData ? (
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke={arcColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${(t! * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`}
            />
          ) : null}
          {/* Threshold marker */}
          {thrT !== null ? (
            <line
              x1={cx - r * Math.cos(Math.PI * thrT)}
              y1={cy - r * Math.sin(Math.PI * thrT) + stroke / 2}
              x2={cx - (r - stroke) * Math.cos(Math.PI * thrT)}
              y2={cy - (r - stroke) * Math.sin(Math.PI * thrT) - stroke / 2}
              stroke="var(--chart-threshold)"
              strokeWidth="2"
              strokeDasharray="2 2"
            />
          ) : null}
        </svg>
      )}

      {/* Numeric value (always visible) */}
      <div className="gauge-value">
        <span className="gauge-num">{missing ? missingText : Number(value!).toFixed(3)}</span>
        {!missing && unit ? <span className="gauge-unit">{unit}</span> : null}
      </div>
      {label ? <div className="gauge-label">{label}</div> : null}
      {thrT !== null ? <div className="gauge-thr-note">阈值 {thresholdLabel}</div> : null}
    </div>
  );
}

export function BrierGauge({ value, label, testId }: { value: number | null | undefined; label?: string; testId?: string }) {
  return (
    <Gauge
      value={value}
      lo={0}
      hi={BRIER_NOINFO}
      label={label}
      threshold={BRIER_NOINFO}
      thresholdLabel="0.25 无信息线"
      missingText="样本不足"
      testId={testId}
    />
  );
}
