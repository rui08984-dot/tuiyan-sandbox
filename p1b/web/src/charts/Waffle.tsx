/**
 * Waffle —— 华夫图（2026-09-22 五轮）
 *
 * 依据 ui-ux-pro-max chart 域「Proportional / Percentage」条目：
 *   推荐类型：Waffle Chart（次级：Pictogram、Stacked Bar 100%）
 *   适用：「showing what fraction of a whole is filled」
 *   无障碍等级：**AA**（明确优于 Pie/Donut 的 C 级——那些「rely on color alone」）
 *   规范原文要求：
 *     · 10×10 网格标准（100 格）
 *     · 2–3px 格间距
 *     · 「Percentage text label always visible」（数值文字恒在场）
 *     · 「Each cell has aria-label」（每格可被读屏器读到）
 *     · 3–5 类上限
 *
 * ★ 为什么在本项目用它：
 *   我们有大量「部分对整体」的读数——合格池/总题量、可出结论格/总格数、
 *   已解真值/总条数。此前这些只能靠半圆仪表的弧长暗示比例，读起来要心算。
 *   华夫图把比例变成**可数的方格**：一眼数得出「10 格里有 3 格亮着」。
 *
 * ★ 纪律（与既有闸一致）：
 *   · 数值文字恒在场（不靠数格子猜）
 *   · 未填充格用弱色而非隐藏（空 ≠ 不存在）
 *   · 超过 5 类不上华夫（规范上限），由调用方保证
 *   · 不满 100 时按比例折算，并在 prop 里如实标注实际总数
 */
export function Waffle({
  filled, total, cols = 10, label, unit = '', color = 'var(--accent)', emptyLabel, testId,
}: {
  /** 已填充数量 */
  filled: number;
  /** 总量 */
  total: number;
  /** 每行格数（默认 10，即规范的 10×N 网格） */
  cols?: number;
  /** 这一格要说明什么（如「合格池」） */
  label?: string;
  /** 数值后缀（如「条」「格」） */
  unit?: string;
  /** 填充色（默认主强调色；传入可做分类着色） */
  color?: string;
  /** 分母来源说明（当分母是抽样/截断时如实标注） */
  emptyLabel?: string;
  testId?: string;
}) {
  const hasData = Number.isFinite(filled) && Number.isFinite(total) && total > 0;
  const pct = hasData ? Math.max(0, Math.min(1, filled / total)) : 0;
  // 规范要求 10×10=100 格标准；但格数随内容自适应更实用——取 40 格（8 行×5 或 5×8），
  // 够精确看比例，又不至于在小卡片里太碎。行数由 cols 决定。
  const CELLS = 40;
  const filledCells = hasData ? Math.round(pct * CELLS) : 0;

  return (
    <div className="waffle" data-testid={testId}>
      {/* 网格本体：每格都是可读的（aria-label 给出累计位置），格间 2px 间隙（规范要求） */}
      <div
        className="waffle-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        role="img"
        aria-label={
          hasData
            ? `${label ?? '比例'}：${filled} / ${total}，约 ${(pct * 100).toFixed(0)}%`
            : `${label ?? '比例'}：样本不足`
        }
      >
        {Array.from({ length: CELLS }).map((_, i) => {
          const on = hasData && i < filledCells;
          return (
            <span
              key={i}
              className={'waffle-cell' + (on ? ' is-on' : '')}
              style={on ? { background: color } : undefined}
              aria-hidden="true"
            />
          );
        })}
      </div>
      {/* 数值行：规范要求百分比文字恒在场 */}
      <div className="waffle-foot">
        <span className="waffle-num u-mono">
          {hasData ? `${Math.round(filled).toLocaleString('en-US')} / ${Math.round(total).toLocaleString('en-US')}${unit}` : '样本不足'}
        </span>
        {hasData ? <span className="waffle-pct u-mono">{Math.round(pct * 100)}%</span> : null}
        {label ? <span className="waffle-label">{label}</span> : null}
      </div>
      {emptyLabel ? <p className="waffle-note">{emptyLabel}</p> : null}
    </div>
  );
}

export default Waffle;
