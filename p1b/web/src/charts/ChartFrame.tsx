/**
 * 统一图框（2026-09-22 全方面重构）
 *
 * ★ 克制设计原则：
 *   - 主屏只显示核心读数，专业细节收进第二层
 *   - 严格控制内边距和字号，绝不溢出容器
 *   - 留白充足、呼吸感强、对比度清晰
 */
import { useState, type ReactNode } from 'react';
import '../styles/charts.css';

export function ChartFrame({
  title,
  eyebrow,
  legend,
  children,
  sourceFile,
  generatedAt,
  note,
  tableFallback,
  testId,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  sourceFile?: string | null;
  generatedAt?: string | null;
  note?: ReactNode;
  /** 数据表兜底：[[列头...], [行...]]，图形之外的等价文本视图 */
  tableFallback?: (string | number | null)[][];
  testId?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart-frame" data-testid={testId}>
      <figcaption className="chart-frame-head">
        {eyebrow ? <span className="chart-eyebrow">{eyebrow}</span> : null}
        <h3 className="chart-title">{title}</h3>
        <span className="chart-frame-actions">
          {tableFallback && tableFallback.length > 1 ? (
            <button
              type="button"
              className="chart-toggle"
              aria-pressed={showTable}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? '看图形' : '看数据表'}
            </button>
          ) : null}
        </span>
      </figcaption>
      {legend ? <div className="chart-legend">{legend}</div> : null}
      <div className="chart-body">
        {showTable && tableFallback && tableFallback.length > 1 ? (
          <div className="chart-table-wrap">
            <table className="chart-table">
              <tbody>
                {tableFallback.map((row, i) => (
                  <tr key={i}>
                    {row.map((c, j) => (
                      i === 0 ? <th key={j} scope="col">{c ?? '—'}</th> : <td key={j}>{c ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : children}
      </div>
      {note ? <p className="chart-note">{note}</p> : null}
      {(sourceFile || generatedAt) && (
        <footer className="chart-meta">
          {sourceFile ? <span className="u-mono">源 {sourceFile}</span> : null}
          {generatedAt ? <span>生成 {generatedAt}</span> : null}
        </footer>
      )}
    </figure>
  );
}

/** 图例项（色块 + 标签；色块必有边框，不靠颜色单打独斗） */
export function LegendItem({ color, label, pattern }: { color: string; label: ReactNode; pattern?: 'stripe' }) {
  return (
    <span className="chart-legend-item">
      <span
        className={'chart-swatch' + (pattern === 'stripe' ? ' is-stripe' : '')}
        style={pattern === 'stripe' ? undefined : { background: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
