/**
 * 条形族（2026-09-22 全方面重构）
 *  Bar        单值条（带阈值刻度）—— 到期量、来源分布
 *  StackedBar 堆叠条 —— 守恒自检、双源比对五分类
 *  NestedBar  嵌套条 —— 「账本行 vs 可计分 n」这类「部分占整体」
 * 直方条用 div + width:%，零依赖。
 * ★ 每条必带数值文字（设计库：仪表/条 grade=AA 要求数值始终以文本呈现）。
 */
import type { ReactNode } from 'react';

export function Bar({
  value, max, label, valueText, threshold, thresholdLabel, color, testId,
}: {
  value: number | null | undefined;
  max: number;
  label?: ReactNode;
  valueText?: ReactNode;
  /** 阈值（如 n≥30 的 30），画竖刻度 */
  threshold?: number;
  thresholdLabel?: string;
  color?: string;
  testId?: string;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const pctW = has && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const thrPct = threshold !== undefined && max > 0 ? Math.min(100, (threshold / max) * 100) : null;
  return (
    <div className="cbar" data-testid={testId}>
      {label ? <span className="cbar-label">{label}</span> : null}
      <span className="cbar-track">
        <span className="cbar-fill" style={{ width: pctW.toFixed(2) + '%', background: color ?? 'var(--accent)' }} />
        {thrPct !== null ? (
          <span className="cbar-threshold" style={{ left: thrPct.toFixed(2) + '%' }} title={thresholdLabel ?? ('阈值 ' + threshold)} />
        ) : null}
      </span>
      <span className="cbar-value u-mono">{has ? (valueText ?? value) : '样本不足'}</span>
    </div>
  );
}

export function StackedBar({
  segments, total, totalText, testId,
}: {
  /** 段：{label, value, color, pattern?} —— pattern='stripe' 为色盲兜底 */
  segments: { label: ReactNode; value: number; color: string; pattern?: 'stripe' }[];
  total?: number | null;
  totalText?: ReactNode;
  testId?: string;
}) {
  const sum = segments.reduce((a, s) => a + (Number.isFinite(s.value) ? s.value : 0), 0);
  const base = total && total > 0 ? total : sum;
  return (
    <div className="cstack" data-testid={testId}>
      <span className="cstack-track" role="img"
        aria-label={segments.map((s) => `${typeof s.label === 'string' ? s.label : '段'} ${s.value}`).join('，')}>
        {base > 0 && sum > 0 ? segments.map((s, i) => (
          <span
            key={i}
            className={'cstack-seg' + (s.pattern === 'stripe' ? ' is-stripe' : '')}
            style={{
              width: ((s.value / base) * 100).toFixed(2) + '%',
              background: s.pattern === 'stripe' ? undefined : s.color,
            }}
            title={`${typeof s.label === 'string' ? s.label : ''} ${s.value}`}
          />
        )) : <span className="cstack-seg is-empty-track" />}
      </span>
      <span className="cstack-legend">
        {segments.map((s, i) => (
          <span key={i} className="chart-legend-item">
            <span className={'chart-swatch' + (s.pattern === 'stripe' ? ' is-stripe' : '')}
              style={s.pattern === 'stripe' ? undefined : { background: s.color }} aria-hidden="true" />
            {s.label} <b className="u-mono">{s.value}</b>
          </span>
        ))}
      </span>
      {totalText !== undefined ? <span className="cstack-total u-mono">{totalText}</span> : null}
    </div>
  );
}

/** 嵌套条：外＝总量，内＝子量（如 ledger_rows vs scored_n） */
export function NestedBar({
  outer, inner, outerLabel, innerLabel, max, testId,
}: {
  outer: number | null | undefined;
  inner: number | null | undefined;
  outerLabel?: ReactNode;
  innerLabel?: ReactNode;
  max: number;
  testId?: string;
}) {
  const o = typeof outer === 'number' && Number.isFinite(outer) ? outer : null;
  const i = typeof inner === 'number' && Number.isFinite(inner) ? inner : null;
  const ow = o !== null && max > 0 ? Math.min(100, (o / max) * 100) : 0;
  const iw = o !== null && i !== null && o > 0 ? Math.min(100, (i / o) * 100) : 0;
  return (
    <div className="cnest" data-testid={testId}>
      <span className="cnest-track">
        <span className="cnest-outer" style={{ width: ow.toFixed(2) + '%' }}>
          <span className="cnest-inner" style={{ width: iw.toFixed(2) + '%' }} />
        </span>
      </span>
      <span className="cnest-legend">
        <span className="chart-legend-item">
          <span className="chart-swatch" style={{ background: 'var(--panel-3)' }} aria-hidden="true" />
          {outerLabel ?? '总量'} <b className="u-mono">{o ?? '样本不足'}</b>
        </span>
        <span className="chart-legend-item">
          <span className="chart-swatch" style={{ background: 'var(--accent)' }} aria-hidden="true" />
          {innerLabel ?? '可计分'} <b className="u-mono">{i ?? '样本不足'}</b>
        </span>
      </span>
    </div>
  );
}
