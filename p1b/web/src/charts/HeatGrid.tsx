/**
 * 分域热力表（2026-09-22 全方面重构）
 *
 * ★ 三条无障碍硬规则逐条落实（设计库判热力图 accessibility=B）：
 *   ① 必须有**数值颜色图例**（带刻度）——见 LegendItem / 底部 colorScaleTicks
 *   ② 色盲兜底：**薄格用斜纹图案**，不是只靠变灰
 *   ③ 每格**数值直接印在格上**，不靠 hover 才看得见
 *
 * ★ 稀疏矩阵纪律（本项目真实坑）：分域格是 29 格 ≠ 5×27=135 全满。
 *   未出现的 layer×domain 组合必须画「无数据」格（--chart-nodata + 破折号），
 *   **绝不当成 Brier=0 的好格**——那会把「没测」谎报成「测得完美」。
 */
import { BRIER_NOINFO, seqColor } from './scale';

export type HeatCell = {
  layer: string;
  domain: string;
  /** 指标值（如 Brier）；null=有该格但无读数 */
  value: number | null;
  n: number | null;
  /** 后端算好的薄格判据（n≥30）；用它而非前端自判 */
  allowed: boolean;
};

export function HeatGrid({
  cells,
  layers,
  domains,
  valueLabel = 'Brier',
  testId,
}: {
  cells: HeatCell[];
  layers: string[];
  domains: string[];
  valueLabel?: string;
  testId?: string;
}) {
  const map = new Map<string, HeatCell>();
  for (const c of cells) map.set(c.layer + '|' + c.domain, c);

  const present = cells.map((c) => c.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const maxV = present.length ? Math.max(BRIER_NOINFO, ...present) : BRIER_NOINFO;

  return (
    <div className="heatgrid-wrap" data-testid={testId}>
      <div
        className="heatgrid"
        style={{ gridTemplateColumns: `var(--heat-row-head) repeat(${domains.length}, var(--heat-cell))` }}
        role="grid"
        aria-label={`${valueLabel} 分域热力表，${layers.length} 层 × ${domains.length} 域`}
      >
        <span className="heat-cell heat-corner" role="columnheader" />
        {domains.map((d) => (
          <span key={d} className="heat-cell heat-colhead u-mono" role="columnheader" title={d}>{d}</span>
        ))}

        {layers.map((L) => (
          <FragmentRow key={L} L={L} domains={domains} map={map} maxV={maxV} valueLabel={valueLabel} />
        ))}
      </div>

      {/* ① 数值颜色图例（带刻度） */}
      <div className="heat-legend">
        <span className="heat-legend-title">{valueLabel}（越低越准）</span>
        <span className="heat-legend-bar" aria-hidden="true" />
        <span className="heat-legend-ticks u-mono">
          <span>0</span>
          <span>{(maxV / 2).toFixed(3)}</span>
          <span>{maxV.toFixed(3)}</span>
        </span>
      </div>
      {/* ② 图案兜底图例：斜纹＝薄格，空格＝无数据（不靠颜色区分） */}
      <div className="heat-legend heat-legend--patterns">
        <span className="chart-legend-item">
          <span className="chart-swatch is-stripe" aria-hidden="true" />薄格 n&lt;30，仅记方向
        </span>
        <span className="chart-legend-item">
          <span className="chart-swatch is-empty" aria-hidden="true" />无数据（该层×域无入账）
        </span>
      </div>
    </div>
  );
}

function FragmentRow({
  L, domains, map, maxV, valueLabel,
}: {
  L: string; domains: string[]; map: Map<string, HeatCell>; maxV: number; valueLabel: string;
}) {
  return (
    <>
      <span className="heat-cell heat-rowhead" role="rowheader">
        <span className="heat-rowhead-swatch" style={{ background: layerVar(L) }} aria-hidden="true" />
        {L}
      </span>
      {domains.map((d) => {
        const c = map.get(L + '|' + d);
        if (!c) {
          // 稀疏：无数据格 ≠ 0 分好格
          return (
            <span key={d} className="heat-cell is-nodata" role="gridcell"
              title={`${L}·${d}：无数据（该层×域无入账）`} aria-label={`${L} ${d} 无数据`}>
              <span aria-hidden="true">—</span>
            </span>
          );
        }
        const t = c.value === null ? null : Math.min(1, Math.max(0, c.value / maxV));
        return (
          <span
            key={d}
            className={'heat-cell' + (c.allowed ? '' : ' is-thin') + (t === null ? ' is-novalue' : '')}
            role="gridcell"
            style={t === null ? undefined : { background: seqColor(t) }}
            title={`${L}·${d}｜${valueLabel} ${c.value === null ? '样本不足' : c.value.toFixed(4)}｜n=${c.n ?? 0}${c.allowed ? '' : '（薄格 n<30 仅记方向）'}`}
            aria-label={`${L} ${d}，${valueLabel} ${c.value === null ? '样本不足' : c.value.toFixed(4)}，样本 ${c.n ?? 0}${c.allowed ? '' : '，薄格仅记方向'}`}
          >
            {/* ③ 数值印在格上 */}
            <span className="heat-num u-mono">{c.value === null ? '不足' : c.value.toFixed(3)}</span>
            <span className="heat-n u-mono">n{c.n ?? 0}</span>
          </span>
        );
      })}
    </>
  );
}

function layerVar(L: string): string {
  const i = String(L).toUpperCase();
  if (i === 'L1') return 'var(--layer-l1)';
  if (i === 'L2') return 'var(--layer-l2)';
  if (i === 'L3') return 'var(--layer-l3)';
  if (i === 'L4') return 'var(--layer-l4)';
  if (i === 'L5') return 'var(--layer-l5)';
  if (i === 'L6') return 'var(--layer-l6)';
  return 'var(--muted)';
}
