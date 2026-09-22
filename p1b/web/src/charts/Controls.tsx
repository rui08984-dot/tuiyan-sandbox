/**
 * 筛选 chip 栏 + 迷你折线 + 可靠性图（2026-09-22 全方面重构）
 *
 *  FilterChips  层/域/仅看可出结论 的多选筛选（对齐参考图顶部 chip 栏气质）
 *  Sparkline    表格内联迷你条/迷你线（信息密度：一行里塞进趋势）
 *  Reliability  可靠性图（x=mean_p, y=obs_rate，对角虚线＝完美校准）
 */
import { useState, type ReactNode } from 'react';
import { norm } from './scale';

export function FilterChips({
  groups, testId,
}: {
  groups: {
    label: ReactNode;
    options: { id: string; label: ReactNode; color?: string }[];
    value: string[];
    onChange: (next: string[]) => void;
    /** 单选组（如「仅看可出结论」开关式） */
    single?: boolean;
  }[];
  testId?: string;
}) {
  return (
    <div className="chips" data-testid={testId} role="group" aria-label="筛选">
      {groups.map((g, gi) => (
        <span key={gi} className="chips-group">
          <span className="chart-eyebrow">{g.label}</span>
          {g.options.map((o) => {
            const on = g.value.indexOf(o.id) >= 0;
            return (
              <button key={o.id} type="button"
                className={'chip-btn' + (on ? ' is-on' : '')}
                aria-pressed={on}
                style={on && o.color ? { borderColor: o.color, color: o.color } : undefined}
                onClick={() => {
                  if (g.single) g.onChange(on ? [] : [o.id]);
                  else g.onChange(on ? g.value.filter((v) => v !== o.id) : g.value.concat([o.id]));
                }}>
                {o.color ? <span className="chip-dot" style={{ background: o.color }} aria-hidden="true" /> : null}
                {o.label}
              </button>
            );
          })}
        </span>
      ))}
    </div>
  );
}

/** 单层受控/非控封装：页面只给选项与回调，内部管状态 */
export function ChipFilter({
  label, options, onPick, initial = [], single = false, testId,
}: {
  label: ReactNode;
  options: { id: string; label: ReactNode; color?: string }[];
  onPick?: (ids: string[]) => void;
  initial?: string[];
  single?: boolean;
  testId?: string;
}) {
  const [v, setV] = useState<string[]>(initial);
  return (
    <FilterChips testId={testId} groups={[{
      label, options, value: v, single,
      onChange: (next) => { setV(next); if (onPick) onPick(next); },
    }]} />
  );
}

/** 迷你条：表格单元内的一行读数（宽度＝占比，文字＝真值，二者并存） */
export function SparkBar({
  value, max, color = 'var(--accent)', text, threshold, thresholdLabel, testId,
}: {
  value: number | null | undefined; max: number; color?: string; text?: ReactNode;
  /** 阈值刻度（如工程下限 20）：画竖线 + title，不靠颜色暗示 */
  threshold?: number; thresholdLabel?: string; testId?: string;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const w = has && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tw = typeof threshold === 'number' && Number.isFinite(threshold) && max > 0
    ? Math.min(100, Math.max(0, (threshold / max) * 100)) : null;
  return (
    <span className="sparkbar" data-testid={testId}>
      <span className="sparkbar-track">
        <span className="sparkbar-fill" style={{ width: w.toFixed(1) + '%', background: color }} />
        {tw !== null ? (
          <span className="sparkbar-threshold" style={{ left: tw.toFixed(1) + '%' }}
            title={thresholdLabel ?? ('阈值 ' + threshold)} />
        ) : null}
      </span>
      <span className="sparkbar-text u-mono">{has ? (text ?? value) : '样本不足'}</span>
    </span>
  );
}

/**
 * 可靠性图（校准散点）：x=mean_p（该格报出的概率均值），y=观测频率 obs_rate
 * 对角虚线＝完美校准参照；点大小＝scored_n（第三变量）。
 * ★ 只画**真实存在**的点；null 点如实计数并显示「未绘 N 格（样本不足）」。
 */
export function ReliabilityPlot({
  points, size = 220, testId,
}: {
  points: { x: number | null; y: number | null; n: number | null; label?: string }[];
  size?: number;
  testId?: string;
}) {
  const valid = points.filter((p) =>
    typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y));
  const skipped = points.length - valid.length;
  const maxN = Math.max(1, ...valid.map((p) => (typeof p.n === 'number' && p.n > 0 ? p.n : 1)));
  const pad = 14;
  const inner = size - pad * 2;
  const X = (v: number) => pad + (norm(v, 0, 1) ?? 0) * inner;
  const Y = (v: number) => size - pad - (norm(v, 0, 1) ?? 0) * inner;

  return (
    <div className="reliability" data-testid={testId}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`可靠性图，${valid.length} 个点${skipped ? '，' + skipped + ' 格样本不足未绘' : ''}`}>
        {/* 网格 */}
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t}>
            <line x1={X(t)} y1={pad} x2={X(t)} y2={size - pad} stroke="var(--chart-grid)" strokeWidth="1" />
            <line x1={pad} y1={Y(t)} x2={size - pad} y2={Y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
          </g>
        ))}
        {/* 对角＝完美校准（虚线，非装饰，承载语义） */}
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)}
          stroke="var(--chart-threshold)" strokeWidth="1.5" strokeDasharray="4 3" />
        {valid.map((p, i) => {
          const r = 2.5 + ((p.n ?? 0) / maxN) * 5;
          return (
            <circle key={i} cx={X(p.x as number).toFixed(1)} cy={Y(p.y as number).toFixed(1)}
              r={r.toFixed(1)} fill="var(--accent)" fillOpacity="0.55"
              stroke="var(--accent)" strokeWidth="1">
              <title>{`${p.label ?? ''} mean_p=${(p.x as number).toFixed(3)} obs=${(p.y as number).toFixed(3)} n=${p.n ?? 0}`}</title>
            </circle>
          );
        })}
        {/* 轴框 */}
        <rect x={pad} y={pad} width={inner} height={inner} fill="none" stroke="var(--chart-axis)" strokeWidth="1" />
      </svg>
      <div className="reliability-axis-x">说出的概率 →</div>
      <div className="reliability-axis-y">实际发生频率 →</div>
      <p className="chart-note">
        对角虚线＝「说多少就发生多少」的参照；点越大说明样本越多。
        {skipped > 0 ? ` 另有 ${skipped} 格样本不足，未绘（不以 0 填充）。` : ''}
      </p>
    </div>
  );
}
