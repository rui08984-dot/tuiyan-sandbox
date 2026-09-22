/**
 * 折线族（2026-09-22 全方面重构）
 *  LineChart  多序列折线 + 可选差异带 —— 日历页双源到期日对比
 *  Histogram  分布直方 —— 9 路判词单时刻横截面
 *
 * ★ 两条铁律级纪律：
 *  ① LineChart 只用于**真有两个时间轴读数**的数据（如 dual_source_bucket.diff[]
 *     的 {day, ledger, evidence_daemon}）。它**不是**「概率随时间演化」的载体——
 *     账本里没有这种东西（重复读数全产生于真值已知之后，画成线＝把采样噪音讲成认知过程）。
 *  ② 空值断线：null 不连、不补、不当 0（polylinePoints 已保证）。
 */
import type { ReactNode } from 'react';
import { norm } from './scale';

export type Series = {
  name: ReactNode;
  color: string;
  values: (number | null)[];
  /** 线型兜底（色盲：不靠颜色区分序列） */
  dash?: string;
};

export function LineChart({
  xLabels, series, lo, hi, yLabel, bandBetween, height = 120, testId,
}: {
  xLabels: string[];
  series: Series[];
  lo: number;
  hi: number;
  yLabel?: ReactNode;
  /** 在该两条序列之间填充差异带（index 对） */
  bandBetween?: [number, number];
  height?: number;
  testId?: string;
}) {
  const w = 100; // viewBox 宽，实际由 CSS 拉伸
  const h = height;
  const padT = 8;
  const padB = 8;
  const n = xLabels.length;

  const px = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const py = (v: number) => {
    const t = norm(v, lo, hi);
    return t === null ? null : h - padB - t * (h - padT - padB);
  };

  // 逐序列构造 path（null 断开为新 M）
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      const y = typeof v === 'number' && Number.isFinite(v) ? py(v) : null;
      if (y === null) { pen = false; continue; }
      d += (pen ? ' L ' : ' M ') + px(i).toFixed(2) + ' ' + y.toFixed(2);
      pen = true;
    }
    return d.trim();
  });

  // 差异带：两序列逐点配对，任一缺则该段无带
  let bandPath = '';
  if (bandBetween && series[bandBetween[0]] && series[bandBetween[1]]) {
    const A = series[bandBetween[0]].values;
    const B = series[bandBetween[1]].values;
    const up: string[] = [];
    const down: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = A[i];
      const b = B[i];
      if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      const ya = py(a);
      const yb = py(b);
      if (ya === null || yb === null) continue;
      up.push(px(i).toFixed(2) + ' ' + ya.toFixed(2));
      down.unshift(px(i).toFixed(2) + ' ' + yb.toFixed(2));
    }
    if (up.length > 1) bandPath = 'M ' + up.join(' L ') + ' L ' + down.join(' L ') + ' Z';
  }

  return (
    <div className="linechart" data-testid={testId}>
      <div className="linechart-main">
        <div className="linechart-axis" aria-hidden="true">
          <span className="u-mono">{hi}</span>
          {yLabel ? <span className="linechart-ylabel">{yLabel}</span> : null}
          <span className="u-mono">{lo}</span>
        </div>
        <div className="linechart-plot">
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="linechart-svg" role="img"
            aria-label={series.map((s) => `${s.name}: ${s.values.filter((v) => typeof v === 'number').length} 个读数`).join('；')}>
            {/* 低对比水平网格（gridline-subtle：不与数据争视觉） */}
            {[0.25, 0.5, 0.75].map((t) => (
              <line key={t} x1="0" x2={w} y1={(h - padB - t * (h - padT - padB)).toFixed(2)}
                y2={(h - padB - t * (h - padT - padB)).toFixed(2)}
                stroke="var(--chart-grid)" strokeWidth="0.4" />
            ))}
            {bandPath ? <path d={bandPath} fill="var(--accent)" fillOpacity="0.12" /> : null}
            {paths.map((d, i) => d ? (
              <path key={i} d={d} fill="none" stroke={series[i].color} strokeWidth="1.6"
                strokeDasharray={series[i].dash} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
            ) : null)}
          </svg>
          <div className="linechart-xlabels">
            {xLabels.map((lb, i) => (
              <span key={i} className="u-mono" title={String(lb)}>{i === 0 || i === n - 1 || n <= 8 ? lb : ''}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-legend">
        {series.map((s, i) => (
          <span key={i} className="chart-legend-item">
            <span className="chart-swatch chart-swatch--line"
              style={{ background: s.color, opacity: s.dash ? 0.6 : 1 }} aria-hidden="true" />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 分布直方（9 路判词用）
 * ★ 它是**单时刻横截面**（decouple9：全部 created_at 逐位相同），
 *   语义＝重测信度/离散度，**不是时间序列**。页面必须带此口径注记。
 */
export function Histogram({
  bins, maxCount, color = 'var(--accent)', width = 260, height = 64, testId, ariaLabel,
}: {
  bins: { x0: number; x1: number; count: number }[];
  maxCount?: number;
  color?: string;
  width?: number;
  height?: number;
  testId?: string;
  ariaLabel?: string;
}) {
  const peak = maxCount ?? Math.max(1, ...bins.map((b) => b.count));
  const bw = bins.length ? width / bins.length : width;
  return (
    <div className="hist" data-testid={testId}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={ariaLabel ?? '分布直方图：' + bins.map((b) => `${b.x0.toFixed(2)}至${b.x1.toFixed(2)} 共${b.count}`).join('，')}>
        {bins.map((b, i) => {
          const bh = peak > 0 ? (b.count / peak) * (height - 10) : 0;
          return (
            <rect key={i}
              x={(i * bw + 1).toFixed(2)} y={(height - bh).toFixed(2)}
              width={Math.max(1, bw - 2).toFixed(2)} height={bh.toFixed(2)}
              fill={color} rx="1">
              <title>{`[${b.x0.toFixed(2)}, ${b.x1.toFixed(2)}) 计数 ${b.count}`}</title>
            </rect>
          );
        })}
      </svg>
      {/* 数值文本兜底：每柱计数可见，不靠高度估读 */}
      <div className="hist-counts u-mono" aria-hidden="true">
        {bins.map((b, i) => <span key={i}>{b.count}</span>)}
      </div>
    </div>
  );
}
