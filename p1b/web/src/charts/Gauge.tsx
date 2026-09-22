/**
 * 扇形仪表盘（2026-09-22 全方面重构）
 *
 * ★ 无障碍处置（关键）：设计库判扇形 accessibility=C——「靠颜色区分，色盲不可用，
 *   禁止作为主图，必须提供堆叠条替代」。本组件的对策：
 *   ① 数值**永远以文字呈现**（大字在扇形中央/旁侧），绝不只在 hover 里
 *   ② `showBar` 开关可切换为堆叠条替代视图（图形挂了也不丢数）
 *   ③ 弧上画阈值刻度（如 0.25 无信息线），刻度有文字标签
 *
 * 实现：SVG 圆弧 + stroke-dasharray，零依赖。
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
  size = 96,
  /** 真值缺失时：画空态弧 + 文字，绝不画成 0 */
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
  const [asBar, setAsBar] = useState(false);
  const t = norm(value, lo, hi);
  const missing = t === null;
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const CIRC = Math.PI * r; // 半圆弧长
  const stroke = 8;

  const arcColor = missing ? 'var(--chart-nodata)' : seqColor(t!);
  const thrT = threshold === undefined ? null : norm(threshold, lo, hi);

  return (
    <div className="gauge" data-testid={testId}>
      <button
        type="button"
        className="chart-toggle chart-toggle--mini"
        aria-pressed={asBar}
        onClick={() => setAsBar((v) => !v)}
        title="切换为堆叠条（不靠颜色也能读）"
      >
        {asBar ? '扇形' : '条形'}
      </button>

      {asBar ? (
        <div className="gauge-bar">
          <div className="gauge-bar-track">
            <div
              className="gauge-bar-fill"
              style={{ width: missing ? '0%' : (t! * 100).toFixed(1) + '%', background: arcColor }}
            />
            {thrT !== null ? (
              <span className="gauge-bar-threshold" style={{ left: (thrT * 100).toFixed(1) + '%' }} title={thresholdLabel} />
            ) : null}
          </div>
          <div className="gauge-bar-scale">
            <span>{lo}</span>
            {thrT !== null ? <span className="gauge-bar-thr-label">{thresholdLabel ?? threshold}</span> : null}
            <span>{hi}</span>
          </div>
        </div>
      ) : (
        <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`} role="img"
          aria-label={`${label ?? ''} ${missing ? missingText : value}${unit ?? ''}`}>
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="var(--panel-2)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {!missing ? (
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke={arcColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${(t! * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`}
            />
          ) : null}
          {thrT !== null ? (
            <g>
              <line
                x1={cx - r * Math.cos(Math.PI * thrT)}
                y1={cy - r * Math.sin(Math.PI * thrT) + stroke / 2}
                x2={cx - (r - stroke) * Math.cos(Math.PI * thrT)}
                y2={cy - (r - stroke) * Math.sin(Math.PI * thrT) - stroke / 2}
                stroke="var(--chart-threshold)"
                strokeWidth="2"
                strokeDasharray="2 2"
              />
            </g>
          ) : null}
        </svg>
      )}

      {/* ★ 数值永在场：这是扇形 accessibility=C 的强制兜底 */}
      <div className="gauge-value">
        <span className="gauge-num">{missing ? missingText : value!.toFixed(4)}</span>
        {!missing && unit ? <span className="gauge-unit">{unit}</span> : null}
      </div>
      {label ? <div className="gauge-label">{label}</div> : null}
      {thrT !== null && !asBar ? <div className="gauge-thr-note">{thresholdLabel ?? '阈值 ' + threshold}</div> : null}
    </div>
  );
}

/** Brier 专用扇形：阈值为 0.25 无信息线 */
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
