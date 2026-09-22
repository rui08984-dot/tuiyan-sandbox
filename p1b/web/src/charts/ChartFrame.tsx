/**
 * 统一图框（2026-09-22 全方面重构）
 *
 * 职责：给每张图一个一致的「标题 + 图例 + 数值兜底 + 元信息行」外壳。
 * ★ 元信息行（源文件名 + 生成时点）对齐参考图的元数据行气质，也是本项目的
 *   「口径可追溯」铁律落点——每张图都能追到它是从哪个件、什么时点算出来的。
 *
 * ★ 数值兜底：设计库对扇形/热力/仪表的共同要求＝「不得只靠颜色传达」。
 *   `tableFallback` 提供可切换的数据表，图形挂了也不丢数。
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
        <span className="chart-title">{title}</span>
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
